#!/usr/bin/env bash
# The server's setup (docs/DEPLOYMENT.md; docs/GO_LIVE.md step 8): the OVHcloud VPS in Sydney (Ubuntu 24.04, the
# user ubuntu) made ready for deploy/compose.yml. Run by the server-setup workflow (.github/workflows/server-setup.yml),
# a dry run first. Safe to run again and again: each step looks first and only changes what isn't so already.
#   sudo bash server-setup.sh [--dry-run]
#     --dry-run   say everything it would do, and change nothing
# In order:
#   - the clock in UTC; the packages brought up to date
#   - Docker and Compose: Ubuntu's own packages (docker.io, docker-compose-v2) rather than Docker's repository —
#     nothing from outside Ubuntu's archive to trust and keep working (no extra repository or signing key), versions
#     that are current in 24.04 (Engine 29, Compose 2.40) and tested by Ubuntu with its kernel, AppArmor and firewall,
#     and their security fixes arrive with the rest of the system's. Docker's logs rotated; live-restore, so the
#     containers keep running while an update restarts Docker itself
#   - security updates installed every night by themselves (unattended-upgrades, at about 17:00 UTC), and when one
#     needs a reboot, the reboot at 17:30 UTC (about 04:00 in Adelaide)
#   - the firewall (ufw): nothing comes in but SSH (the game's traffic arrives through the tunnel, which connects out)
#   - fail2ban: an address that keeps failing to sign in over SSH is shut out for an hour
#   - SSH: passwords off — only once the user ubuntu has a key, so it never locks the owner out
#   - a 1 GB swap file
#   - /opt/ognistrada (the deploy's folder) for ubuntu, ubuntu in the docker group, and the real-time server's secret
#     /opt/ognistrada/rt.secret: made once (48 random hex characters), only ubuntu can read it; each deploy puts it
#     in the server's settings as RT_SECRET, so it never leaves the server
set -euo pipefail

DRY=0
for a in "$@"; do
  case "$a" in
    --dry-run) DRY=1 ;;
    *) echo "unknown option: $a (only --dry-run)" >&2; exit 2 ;;
  esac
done
if [ "$(id -u)" -ne 0 ]; then exec sudo bash "$0" "$@"; fi

U=ubuntu DIR=/opt/ognistrada
export DEBIAN_FRONTEND=noninteractive NEEDRESTART_MODE=a
APT=(apt-get -y -q -o DPkg::Lock::Timeout=600 -o Dpkg::Options::=--force-confdef -o Dpkg::Options::=--force-confold)
CHANGES=() WARNINGS=()

step() { echo; echo "== $*"; }
did() { CHANGES+=("$*"); }
warn() { echo "   WARNING: $*"; WARNINGS+=("$*"); }
# a command that changes something: run (and shown), or in a dry run only shown
run() {
  if [ "$DRY" = 1 ]; then echo "   would run: $*"; else echo "   + $*"; "$@"; fi
}
# a file given exactly this content (stdin) and mode; true when it was (or would be) changed, false when it was
# already so — always called as `if put …`
put() {
  local path=$1 mode=$2 tmp
  tmp=$(mktemp); cat > "$tmp"
  if [ -f "$path" ] && cmp -s "$tmp" "$path" && [ "$(stat -c %a "$path")" = "$mode" ]; then
    echo "   $path: as it should be"; rm -f "$tmp"; return 1
  fi
  if [ "$DRY" = 1 ]; then
    echo "   would write $path (mode $mode):"; sed 's/^/     | /' "$tmp"
  else
    install -D -m "$mode" "$tmp" "$path" || { rm -f "$tmp"; echo "   couldn't write $path" >&2; exit 1; }
    echo "   wrote $path"
  fi
  rm -f "$tmp"; return 0
}
installed() { dpkg-query -W -f='${Status}' "$1" 2>/dev/null | grep -q 'install ok installed'; }

[ "$DRY" = 1 ] && echo "DRY RUN: nothing on this server is changed."
id "$U" > /dev/null 2>&1 || { echo "the user $U isn't on this server (docs/GO_LIVE.md Part 2)" >&2; exit 1; }
# shellcheck source=/dev/null
. /etc/os-release
[ "${VERSION_ID:-}" = 24.04 ] || warn "this is ${PRETTY_NAME:-an unknown system}, not Ubuntu 24.04: carrying on, but check what follows"

# ---------- the clock ----------
step "The clock: UTC"
if [ "$(timedatectl show -p Timezone --value 2>/dev/null)" = UTC ]; then echo "   already UTC"
else run timedatectl set-timezone UTC; did "time zone set to UTC"; fi

# ---------- packages ----------
step "Packages brought up to date"
upgradable() { apt-get -s -o Debug::NoLocking=1 upgrade --with-new-pkgs 2>/dev/null | grep -c '^Inst ' || true; }
if [ "$DRY" = 1 ]; then
  echo "   would run: apt-get update, then apt-get upgrade --with-new-pkgs ($(upgradable) to upgrade by the package lists this server has now)"
  did "packages brought up to date"
else
  run "${APT[@]}" update
  n=$(upgradable)
  if [ "$n" -gt 0 ]; then run "${APT[@]}" upgrade --with-new-pkgs; did "$n packages upgraded"; else echo "   all up to date"; fi
fi

# (Docker's settings before Docker itself, so it starts with them)
step "Docker's settings: logs rotated (10 MB × 3 a container), containers kept running while Docker restarts"
docker_conf_changed=0
if put /etc/docker/daemon.json 644 <<'EOF'
{
  "log-driver": "json-file",
  "log-opts": { "max-size": "10m", "max-file": "3" },
  "live-restore": true
}
EOF
then docker_conf_changed=1; did "Docker's settings (/etc/docker/daemon.json)"; fi

step "Docker, Compose, unattended-upgrades, the firewall, fail2ban"
had_docker=0; { installed docker.io || installed docker-ce; } && had_docker=1
need=()
for p in docker.io docker-compose-v2 unattended-upgrades update-notifier-common ufw fail2ban python3-systemd openssl; do installed "$p" || need+=("$p"); done
if installed docker-ce && [[ " ${need[*]} " == *" docker.io "* ]]; then
  warn "Docker is already installed from Docker's own repository (docker-ce): kept, not replaced with Ubuntu's"
  mapfile -t need < <(printf '%s\n' "${need[@]}" | grep -vx -e docker.io -e docker-compose-v2)
fi
if [ ${#need[@]} -eq 0 ]; then echo "   all installed"
else run "${APT[@]}" install "${need[@]}"; did "installed ${need[*]}"; fi
if [ "$had_docker" = 1 ] && [ "$docker_conf_changed" = 1 ]; then
  run systemctl restart docker; did "Docker restarted for its new settings (the containers start again by themselves)"
fi
if systemctl is-enabled --quiet docker 2>/dev/null && systemctl is-active --quiet docker 2>/dev/null; then echo "   Docker: running, starts at boot"
else run systemctl enable --now docker; did "Docker started, and starts at boot"; fi
if id -nG "$U" | tr ' ' '\n' | grep -qx docker; then echo "   $U is in the docker group"
else run usermod -aG docker "$U"; did "$U added to the docker group"; fi

# ---------- updates by themselves ----------
step "Security updates every night by themselves; a reboot, when one needs it, at 17:30 UTC (about 04:00 in Adelaide)"
if put /etc/apt/apt.conf.d/52ognistrada-upgrades 644 <<'EOF'
// deploy/server-setup.sh: the security updates (50unattended-upgrades' origins) every night, and when one needs a
// reboot, the reboot at 17:30 UTC (about 04:00 in Adelaide)
APT::Periodic::Update-Package-Lists "1";
APT::Periodic::Unattended-Upgrade "1";
APT::Periodic::AutocleanInterval "7";
Unattended-Upgrade::Automatic-Reboot "true";
Unattended-Upgrade::Automatic-Reboot-WithUsers "true";
Unattended-Upgrade::Automatic-Reboot-Time "17:30";
Unattended-Upgrade::Remove-Unused-Kernel-Packages "true";
Unattended-Upgrade::Remove-Unused-Dependencies "true";
EOF
then did "unattended-upgrades: every night, reboot at 17:30 UTC when needed"; fi
# (Ubuntu installs them at 06:00–07:00 UTC — the afternoon in Australia: moved to the night, just before the reboot)
timer_changed=0
if put /etc/systemd/system/apt-daily-upgrade.timer.d/ognistrada.conf 644 <<'EOF'
# deploy/server-setup.sh: the updates installed at about 17:00 UTC (03:30 in Adelaide), before the 17:30 reboot
[Timer]
OnCalendar=
OnCalendar=*-*-* 17:00
RandomizedDelaySec=10m
EOF
then timer_changed=1; did "the nightly updates moved to 17:00 UTC"; fi
if [ "$timer_changed" = 1 ]; then run systemctl daemon-reload; run systemctl restart apt-daily-upgrade.timer; fi
for t in apt-daily.timer apt-daily-upgrade.timer; do
  if systemctl is-enabled --quiet "$t" 2>/dev/null; then echo "   $t: on"; else run systemctl enable --now "$t"; did "$t on"; fi
done

# ---------- the firewall ----------
step "The firewall (ufw): nothing comes in but SSH"
# (SSH's port as sshd has it — 22 unless someone changed it: allowed before the firewall goes on, never locked out)
mapfile -t ssh_ports < <(sshd -T 2>/dev/null | awk '$1 == "port" { print $2 }' | sort -u)
[ ${#ssh_ports[@]} -gt 0 ] || ssh_ports=(22)
if command -v ufw > /dev/null; then
  added=$(ufw show added 2>/dev/null || true)
  grep -qx 'ufw allow OpenSSH' <<<"$added" || { run ufw allow OpenSSH; did "firewall: SSH allowed in"; }
  for p in "${ssh_ports[@]}"; do
    [ "$p" = 22 ] || grep -qx "ufw allow $p/tcp" <<<"$added" || { run ufw allow "$p/tcp"; did "firewall: SSH's port $p allowed in"; }
  done
  verbose=$(ufw status verbose 2>/dev/null || true)
  grep -q 'deny (incoming)' <<<"$verbose" || { run ufw default deny incoming; did "firewall: everything else coming in refused"; }
  grep -q 'allow (outgoing)' <<<"$verbose" || { run ufw default allow outgoing; did "firewall: going out allowed"; }
  if grep -q '^Status: active' <<<"$verbose"; then echo "   on"
  else run ufw --force enable; did "firewall on"; fi
else
  echo "   would set: allow OpenSSH (port ${ssh_ports[*]}), refuse everything else coming in, then switch it on"
  did "firewall: SSH only, on"
fi

# ---------- fail2ban ----------
step "fail2ban: five failed SSH sign-ins within 10 minutes shut that address out for an hour"
f2b_changed=0
if put /etc/fail2ban/jail.d/ognistrada.local 644 <<'EOF'
# deploy/server-setup.sh: SSH's failed sign-ins, read from the system journal
[sshd]
enabled = true
backend = systemd
maxretry = 5
findtime = 10m
bantime = 1h
EOF
then f2b_changed=1; did "fail2ban: SSH watched"; fi
if [ "$f2b_changed" = 1 ] || ! systemctl is-active --quiet fail2ban 2>/dev/null; then
  run systemctl enable fail2ban
  run systemctl restart fail2ban || warn "fail2ban didn't start: sudo journalctl -u fail2ban on the server says why"
else echo "   running"; fi

# ---------- SSH ----------
step "SSH: passwords off (only once $U has a key)"
keys="$(getent passwd "$U" | cut -d: -f6)/.ssh/authorized_keys"
if [ -s "$keys" ] && grep -qE '(^|[[:space:]])(ssh-(ed25519|rsa)|ecdsa-sha2-[a-z0-9-]+|sk-[a-z0-9@.-]+)[[:space:]]+AAAA' "$keys"; then
  echo "   $U has $(grep -cE 'AAAA' "$keys") key(s) in $keys"
  # (sshd keeps the first value it reads, and reads sshd_config.d/ in order: 10- comes before cloud-init's 50-)
  if put /etc/ssh/sshd_config.d/10-ognistrada.conf 644 <<'EOF'
# deploy/server-setup.sh: keys only (the owner's and the deploy's), no passwords
PasswordAuthentication no
KbdInteractiveAuthentication no
EOF
  then
    if [ "$DRY" = 0 ]; then
      install -d -m 755 /run/sshd          # (sshd -t wants it; 24.04 makes it only while sshd runs)
      if sshd -t; then run systemctl reload-or-restart ssh
      else rm -f /etc/ssh/sshd_config.d/10-ognistrada.conf; echo "   sshd didn't accept it: taken out again, SSH left as it was" >&2; exit 1; fi
    else echo "   would run: sshd -t, then systemctl reload-or-restart ssh (signed-in sessions stay)"; fi
    did "SSH: passwords off"
  fi
else
  warn "SSH passwords left on: $U has no key in $keys yet (docs/GO_LIVE.md Part 2) — turning them off now could lock you out"
fi

# ---------- swap ----------
step "A 1 GB swap file"
active=$(swapon --noheadings --show=NAME 2>/dev/null || true) ours=1
if [ -z "$active" ]; then
  run fallocate -l 1G /swapfile; run chmod 600 /swapfile; run mkswap /swapfile; run swapon /swapfile
  did "1 GB swap file (/swapfile)"
elif grep -qx /swapfile <<<"$active"; then echo "   on: /swapfile"
else echo "   swap already on: $(tr '\n' ' ' <<<"$active")(not ours: left as it is)"; ours=0; fi
if [ "$ours" = 1 ] && ! grep -qE '^/swapfile[[:space:]]' /etc/fstab; then
  run sh -c 'echo "/swapfile none swap sw 0 0" >> /etc/fstab'; did "the swap file on at boot (/etc/fstab)"
fi
# (only when memory is really short: the game's processes stay in memory)
if put /etc/sysctl.d/90-ognistrada.conf 644 <<'EOF'
# deploy/server-setup.sh: swap only when memory is really short
vm.swappiness = 10
EOF
then run sysctl -q -p /etc/sysctl.d/90-ognistrada.conf; did "vm.swappiness 10"; fi

# ---------- the deploy's folder and the real-time server's secret ----------
step "$DIR, and the real-time server's secret"
if [ -d "$DIR" ] && [ "$(stat -c %U:%G:%a "$DIR")" = "$U:$U:750" ]; then echo "   $DIR: there, $U's"
else run install -d -o "$U" -g "$U" -m 750 "$DIR"; did "$DIR for $U"; fi
secret="$DIR/rt.secret"
if [ -s "$secret" ]; then
  echo "   $secret: there (kept: a new one would only cut off the players connected for a minute, but there's no need)"
  [ "$(tr -d '\n' < "$secret" | wc -c)" -ge 32 ] || warn "$secret is shorter than 32 characters: the real-time server won't take it (delete it and run this again)"
  if [ "$(stat -c %U:%a "$secret")" != "$U:600" ]; then run chown "$U:$U" "$secret"; run chmod 600 "$secret"; did "$secret: only $U can read it"; fi
elif [ "$DRY" = 1 ]; then
  echo "   would make $secret: 48 random hex characters, mode 600, $U's"; did "the real-time server's secret made"
else
  ( umask 077; openssl rand -hex 24 > "$secret.new" )
  chown "$U:$U" "$secret.new"; mv "$secret.new" "$secret"
  echo "   made $secret (48 random hex characters, mode 600, $U's)"; did "the real-time server's secret made"
fi

# ---------- summary ----------
step "Summary$([ "$DRY" = 1 ] && echo ' (DRY RUN: nothing was changed)')"
if [ ${#CHANGES[@]} -eq 0 ]; then echo "   nothing to change: everything was already so"
else
  echo "   $([ "$DRY" = 1 ] && echo 'would change' || echo 'changed'):"
  printf '     - %s\n' "${CHANGES[@]}"
fi
echo "   now:"
or() { [ -n "$1" ] && echo "$1" || echo "$2"; }
echo "     system:     ${PRETTY_NAME:-?}, kernel $(uname -r), $(free -h | awk '/^Mem:/ { print $2 }') memory, $(df -h / | awk 'NR == 2 { print $4 }') disk free"
echo "     Docker:     $(or "$(docker version --format '{{.Server.Version}}' 2> /dev/null || true)" 'not running'), Compose $(or "$(docker compose version --short 2> /dev/null || true)" 'missing')"
echo "     firewall:   $(or "$(ufw status 2> /dev/null | sed -n 's/^Status: //p' || true)" 'not installed') ($(ufw status 2> /dev/null | grep -c ALLOW || true) allow rules)"
echo "     fail2ban:   $(or "$(systemctl is-active fail2ban 2> /dev/null || true)" '?')$(fail2ban-client status sshd 2> /dev/null | grep -o 'Currently banned:.*' | sed 's/^/, /' || true)"
echo "     SSH:        password sign-in $(or "$(sshd -T 2> /dev/null | awk '$1 == "passwordauthentication" { print $2 }' || true)" '?')"
echo "     swap:       $(or "$(swapon --noheadings --show=NAME,SIZE 2> /dev/null | tr -s ' \n' ' ' || true)" 'none')"
echo "     updates:    $(or "$(systemctl list-timers apt-daily-upgrade.timer --no-legend 2> /dev/null | awk '{ print "next", $1, $2, $3 }' || true)" '?')"
echo "     $DIR: $(or "$(find "$DIR" -mindepth 1 -maxdepth 1 -printf '%f ' 2> /dev/null || true)" '(not there)')"
if [ -f /var/run/reboot-required ]; then
  echo "     reboot:     needed for the updates — it happens by itself at 17:30 UTC (or now: sudo reboot)"
fi
if [ ${#WARNINGS[@]} -gt 0 ]; then echo "   warnings:"; printf '     - %s\n' "${WARNINGS[@]}"; fi
