#!/usr/bin/env bash
# SSH from a GitHub Actions job to the server (the deploy and server-setup workflows): the deploy key, the server's
# own key, and the name "server" for it (the user ubuntu; one connection, opened here, shared by every ssh and scp after).
#   DEPLOY_SSH_KEY=… SERVER_HOST=… [SERVER_SSH_HOST_KEY=…] server/scripts/ssh-setup.sh
#   then: ssh server 'docker compose ps', scp file server:/opt/ognistrada/
# The server's own key (what proves it's our server): the repository variable SERVER_SSH_HOST_KEY when it's set
# (pinned: any other key is refused); otherwise read from the server on this first contact (ssh-keyscan) and trusted,
# and the run says so, with the line to pin it.
set -euo pipefail
: "${DEPLOY_SSH_KEY:?the secret DEPLOY_SSH_KEY is not set (docs/GO_LIVE.md Part 5)}"
: "${SERVER_HOST:?the repository variable SERVER_HOST is not set (docs/GO_LIVE.md Part 5)}"
# (the server's address kept out of the logs: they're public, and nothing points at the server but the tunnel)
[ "${GITHUB_ACTIONS:-}" = true ] && echo "::add-mask::$SERVER_HOST"

install -d -m 700 ~/.ssh
( umask 077; printf '%s\n' "$DEPLOY_SSH_KEY" | tr -d '\r' > ~/.ssh/ognistrada_deploy )
# (what's wrong with it, as precisely as can be told — without ever printing it)
if ! why=$(ssh-keygen -y -P '' -f ~/.ssh/ognistrada_deploy 2>&1 > /dev/null); then
  first=$(head -n 1 ~/.ssh/ognistrada_deploy)
  if [[ "$first" == ssh-* || "$first" == ecdsa-* ]]; then
    hint="that's the PUBLIC half (the file ognistrada_deploy.pub): the secret must be the private file ognistrada_deploy, without .pub"
  elif grep -qi 'passphrase' <<<"$why"; then
    hint="the key has a passphrase, which GitHub can't type: on your computer run  ssh-keygen -p -f ~/.ssh/ognistrada_deploy  (old passphrase, then just Enter twice for none), then paste the file into the secret again — the server needs no change"
  elif grep -q '^PuTTY-User-Key-File' ~/.ssh/ognistrada_deploy; then
    hint="that's a PuTTY key (.ppk): GitHub needs the OpenSSH file ognistrada_deploy made with ssh-keygen (docs/GO_LIVE.md Part 0)"
  elif ! grep -q -- '-----BEGIN' ~/.ssh/ognistrada_deploy || ! grep -q -- '-----END' ~/.ssh/ognistrada_deploy; then
    # (which line is missing — the key's own text is never shown; 'b3BlbnNzaC1rZXktdjE' is every OpenSSH key's fixed start)
    missing=$({ grep -q -- '-----BEGIN' ~/.ssh/ognistrada_deploy || printf 'the -----BEGIN line'; } ; { grep -q -- '-----END' ~/.ssh/ognistrada_deploy || printf '%sthe -----END line' "$(grep -q -- '-----BEGIN' ~/.ssh/ognistrada_deploy || printf ' and ')"; })
    body=''; grep -q '^b3BlbnNzaC1rZXktdjE' ~/.ssh/ognistrada_deploy && body=' (the middle of the key is there: only the first and/or last line were left out when copying)'
    hint="$missing is missing$body — the secret had $(grep -c . ~/.ssh/ognistrada_deploy) line(s); the file has about 7: paste the whole file, from -----BEGIN OPENSSH PRIVATE KEY----- to -----END OPENSSH PRIVATE KEY-----"
  elif [ "$(wc -l < ~/.ssh/ognistrada_deploy)" -lt 3 ]; then
    hint="its line breaks were lost (it arrived as $(wc -l < ~/.ssh/ognistrada_deploy) line(s)): copy the file with  pbcopy < ~/.ssh/ognistrada_deploy  (Mac) or open it in a plain text editor and copy everything"
  else
    hint="ssh can't read it ($(tr -d '\n' <<<"$why" | cut -c1-120)): paste the whole private file ognistrada_deploy again"
  fi
  echo "::error title=DEPLOY_SSH_KEY::$hint (docs/GO_LIVE.md Part 5)"
  exit 1
fi

if [ -n "${SERVER_SSH_HOST_KEY:-}" ]; then
  printf '%s %s\n' "$SERVER_HOST" "$SERVER_SSH_HOST_KEY" > ~/.ssh/known_hosts
  echo "the server's SSH key: pinned (the repository variable SERVER_SSH_HOST_KEY)"
else
  keys=$(ssh-keyscan -T 20 -t ed25519 "$SERVER_HOST" 2> /dev/null || true)
  if [ -z "$keys" ]; then
    echo "::error title=No answer from the server::nothing answered on SSH's port 22 — is the server running (OVHcloud's control panel)? Is SERVER_HOST its IPv4 address?"
    exit 1
  fi
  printf '%s\n' "$keys" > ~/.ssh/known_hosts
  echo "::notice title=SSH: first contact::trusted the server's SSH key as it answered just now ($(ssh-keygen -lf ~/.ssh/known_hosts | awk '{ print $2 }')). To pin it, so that only this server is ever trusted, add the repository variable SERVER_SSH_HOST_KEY with the value: $(awk '{ print $2, $3; exit }' ~/.ssh/known_hosts)"
fi

cat > ~/.ssh/config <<EOF
Host server
  HostName $SERVER_HOST
  User ubuntu
  IdentityFile ~/.ssh/ognistrada_deploy
  IdentitiesOnly yes
  StrictHostKeyChecking yes
  UserKnownHostsFile ~/.ssh/known_hosts
  BatchMode yes
  ConnectTimeout 20
  ServerAliveInterval 30
  ServerAliveCountMax 6
  ControlPath ~/.ssh/cm-%C
  LogLevel ERROR
EOF
chmod 600 ~/.ssh/config

# (the shared connection, opened here in the background with nothing of the step's attached — a connection that held
# the step's output would keep the step from ending; every ssh after this goes through it, or connects on its own)
if ! ssh -o ControlMaster=yes -o ControlPersist=30m -fN server < /dev/null > /dev/null 2> ~/.ssh/master.log || ! ssh server true; then
  sed 's/^/  /' ~/.ssh/master.log 2> /dev/null || true
  echo "::error title=SSH sign-in refused::couldn't sign in as ubuntu with DEPLOY_SSH_KEY: is ognistrada_deploy.pub in /home/ubuntu/.ssh/authorized_keys on the server (docs/GO_LIVE.md Part 2), and is DEPLOY_SSH_KEY its private half?"
  exit 1
fi
echo "signed in to the server as ubuntu"
