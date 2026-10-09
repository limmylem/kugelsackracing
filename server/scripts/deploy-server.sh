#!/usr/bin/env bash
# The server at one commit (the deploy workflow's step 2; docs/DEPLOYMENT.md "Deploying"), from a GitHub Actions job,
# after server/scripts/ssh-setup.sh:
#   - deploy/compose.yml → /opt/ognistrada/compose.yml
#   - /opt/ognistrada/.env (mode 600), the server's settings and secrets: sent over SSH's input, never on a command
#     line; RT_SECRET added on the server from its rt.secret (it never leaves the server); TUNNEL_TOKEN, the tunnel's
#     token, read from Cloudflare (the tunnel "ognistrada")
#   - the image ghcr.io/limmylem/kugelsackracing:<commit> pulled (logged in to ghcr.io with the job's own token, and
#     out again), then `docker compose up -d --remove-orphans` — on the server by itself, so a dropped connection
#     can't leave it half done; "<UTC time> <commit>" added to /opt/ognistrada/deployed.log once it has started
#   - then a wait (up to 13 minutes: the real-time server finishes the races running first, up to 10) until the API
#     and the real-time server, as players reach them, both say they're this commit and healthy
# Nothing the containers log is shown here (the repository's logs are public): `docker compose logs` on the server.
#
#   SHA=<full commit> GHCR_USER=… GHCR_TOKEN=… CLOUDFLARE_API_TOKEN=… CLOUDFLARE_ACCOUNT_ID=… DATABASE_URL=… \
#   BETTER_AUTH_SECRET=… EDGE_SECRET=… RESEND_SMTP_KEY=… ADMIN_EMAIL=… ALERT_EMAIL=… TURNSTILE_SITE_KEY=… \
#   TURNSTILE_SECRET_KEY=… [HSTS=on] [SENTRY_DSN=…] [SENTRY_CLIENT_DSN=…] [LOADTEST_TOKEN=…] server/scripts/deploy-server.sh

# (the commands sent to the server are put together here, on purpose: only paths and the commit, never a secret)
# shellcheck disable=SC2029
set -euo pipefail
shopt -s inherit_errexit

GAME=https://ognistrada.com API=https://api.ognistrada.com TILES=https://tiles.ognistrada.com RT=wss://rt.ognistrada.com
DIR=/opt/ognistrada TUNNEL=ognistrada WAIT_SEC=${WAIT_SEC:-780}
fail() { echo "::error title=${2:-Deploying the server}::$1"; exit 1; }

# ---------- the settings: all there, and in shape ----------
missing=()
for n in SHA GHCR_USER GHCR_TOKEN CLOUDFLARE_API_TOKEN CLOUDFLARE_ACCOUNT_ID DATABASE_URL BETTER_AUTH_SECRET EDGE_SECRET \
  RESEND_SMTP_KEY ADMIN_EMAIL TURNSTILE_SITE_KEY TURNSTILE_SECRET_KEY; do
  [ -n "${!n:-}" ] || missing+=("$n")
done
[ ${#missing[@]} -eq 0 ] || fail "not set: ${missing[*]} (the secrets and variables: docs/GO_LIVE.md Part 5)" 'Settings missing'
[ -n "${ALERT_EMAIL:-}" ] || echo "::warning::ALERT_EMAIL isn't set: the server's alerts go nowhere"
[[ "$DATABASE_URL" =~ ^postgres(ql)?:// ]] || fail "DATABASE_URL isn't a postgresql:// address (PlanetScale's connection string: docs/GO_LIVE.md Part 3)"
[[ "$DATABASE_URL" != *:6432/* ]] || fail "DATABASE_URL is PlanetScale's pooler (port 6432): use the direct connection, port 5432 (docs/GO_LIVE.md Part 3)"
[ ${#BETTER_AUTH_SECRET} -ge 32 ] || fail "BETTER_AUTH_SECRET is shorter than 32 characters (openssl rand -base64 32)"
[ ${#EDGE_SECRET} -ge 24 ] || fail "EDGE_SECRET is shorter than 24 characters (openssl rand -hex 24)"
[[ "$SHA" =~ ^[0-9a-f]{40}$ ]] || fail "SHA must be a full commit hash"
# (libpq's sslrootcert=system — the usual certificate authorities — is what Node does anyway with sslmode=verify-full,
# and node-postgres would take it for a file's name: left out of the server's copy)
db_url=$(sed -E 's/([?&])sslrootcert=system(&|$)/\1/; s/[?&]$//' <<<"$DATABASE_URL")

# ---------- the tunnel's token, from Cloudflare ----------
cf() { curl -sS -m 30 -H @<(printf 'Authorization: Bearer %s\n' "$CLOUDFLARE_API_TOKEN") "https://api.cloudflare.com/client/v4/accounts/$CLOUDFLARE_ACCOUNT_ID/$1"; }
tunnel_token='' why=''
tunnels=$(cf "cfd_tunnel?name=$TUNNEL&is_deleted=false" || true)
id=$(jq -r --arg n "$TUNNEL" '[.result[]? | select(.name == $n and .deleted_at == null)][0].id // empty' <<<"$tunnels" 2> /dev/null || true)
if [ -n "$id" ]; then
  answer=$(cf "cfd_tunnel/$id/token" || true)
  tunnel_token=$(jq -r 'if .success then .result else empty end' <<<"$answer" 2> /dev/null || true)
  [ -n "$tunnel_token" ] || why=$(jq -r '[.errors[]?.message] | join("; ")' <<<"$answer" 2> /dev/null || echo 'no answer')
elif jq -e '.success' <<<"$tunnels" > /dev/null 2>&1; then why="there's no tunnel called $TUNNEL: run the infra workflow (docs/GO_LIVE.md step 6)"
else why=$(jq -r '[.errors[]?.message] | join("; ")' <<<"$tunnels" 2> /dev/null || echo 'no answer'); fi
if [ -n "$tunnel_token" ]; then
  echo "::add-mask::$tunnel_token"
  echo "the tunnel's token: read from Cloudflare (tunnel $TUNNEL, $id)"
else
  echo "::warning title=The tunnel's token::couldn't read it from Cloudflare (${why:-?}) — keeping the one the server already has, if any. The deploy token (CLOUDFLARE_API_TOKEN) needs Account → Cloudflare Tunnel → Read (docs/GO_LIVE.md Part 1 step 7)."
fi

# ---------- the server's settings (.env) ----------
# (one line each, NAME='value': in single quotes Compose takes the value exactly as it is)
q() {
  case "$2" in *"'"* | *$'\n'*) echo "::error::$1 has a quote or a line break in it, which the server's .env can't hold" >&2; return 1 ;; esac
  printf "%s='%s'\n" "$1" "$2"
}
settings() {
  q APP_ENV production
  q PUBLIC_URL "$API"
  q GAME_URL "$GAME"
  q TILES_URL "$TILES"
  q RT_URL "$RT"
  q MAIL_FROM 'Kugelsack Racing <noreply@ognistrada.com>'
  q HSTS "$([ "${HSTS:-}" = on ] && echo on || echo off)"
  q DATABASE_URL "$db_url"
  q BETTER_AUTH_SECRET "$BETTER_AUTH_SECRET"
  q EDGE_SECRET "$EDGE_SECRET"
  # (Resend's SMTP: the user is "resend", the password the sending key)
  q SMTP_URL "smtps://resend:$(jq -Rr @uri <<<"$RESEND_SMTP_KEY")@smtp.resend.com:465"
  q ADMIN_EMAIL "$ADMIN_EMAIL"
  [ -z "${ALERT_EMAIL:-}" ] || q ALERT_EMAIL "$ALERT_EMAIL"
  q TURNSTILE_SITE_KEY "$TURNSTILE_SITE_KEY"
  q TURNSTILE_SECRET_KEY "$TURNSTILE_SECRET_KEY"
  [ -z "${SENTRY_DSN:-}" ] || q SENTRY_DSN "$SENTRY_DSN"
  [ -z "${SENTRY_CLIENT_DSN:-}" ] || q SENTRY_CLIENT_DSN "$SENTRY_CLIENT_DSN"
  [ -z "${LOADTEST_TOKEN:-}" ] || q LOADTEST_TOKEN "$LOADTEST_TOKEN"
  # (Compose's: the image's tag, and the tunnel's token for cloudflared; GIT_COMMIT is the image's own)
  q IMAGE_TAG "$SHA"
  [ -z "$tunnel_token" ] || q TUNNEL_TOKEN "$tunnel_token"
}
env_content=$(settings)

# ---------- the server: set up? ----------
ssh server "test -d $DIR -a -w $DIR -a -s $DIR/rt.secret && docker compose version > /dev/null" \
  || fail "the server isn't set up yet (or ubuntu isn't in the docker group): run the server-setup workflow (docs/GO_LIVE.md step 8)" 'Server not set up'
# (a deploy that gave up waiting leaves its docker compose up running until the races end: never two at once)
if ssh server "pgrep -f '[d]ocker compose up' > /dev/null"; then
  fail "an earlier deploy is still starting the server (the real-time server finishing its races: up to 10 minutes) — run this again once it's done" 'Server busy'
fi

echo "== compose.yml and .env"
scp -q deploy/compose.yml "server:$DIR/compose.yml"
printf '%s\n' "$env_content" | ssh server "umask 077 && cat > $DIR/.env.new"
ssh server bash -s <<'REMOTE' || fail "couldn't put the settings on the server (above)"
set -euo pipefail
cd /opt/ognistrada
printf "RT_SECRET='%s'\n" "$(tr -d '\n' < rt.secret)" >> .env.new
if ! grep -q '^TUNNEL_TOKEN=' .env.new; then
  grep '^TUNNEL_TOKEN=' .env >> .env.new 2> /dev/null || { rm -f .env.new; echo "no tunnel token: Cloudflare didn't give it, and the server hasn't one from an earlier deploy" >&2; exit 1; }
  echo "(the tunnel's token kept from the last deploy)"
fi
chmod 600 .env.new && mv .env.new .env
echo "written: compose.yml, .env ($(grep -c = .env) settings)"
REMOTE

echo "== the image ghcr.io/limmylem/kugelsackracing:$SHA"
printf '%s\n' "$GHCR_TOKEN" | ssh server "docker login ghcr.io -u '$GHCR_USER' --password-stdin > /dev/null"
ssh server "cd $DIR && docker compose pull --quiet; s=\$?; docker logout ghcr.io > /dev/null; exit \$s" || fail "couldn't pull the image for $SHA (is it built? the server workflow's image job)"

echo "== started on the server (docker compose up -d)"
ssh server bash -s -- "$SHA" <<'REMOTE'
set -euo pipefail
cd /opt/ognistrada
rm -f up.status
# (on its own: it carries on if this connection drops; up.status says how it ended)
setsid nohup bash -c '
  docker compose up -d --remove-orphans > up.log 2>&1; s=$?
  [ "$s" != 0 ] || echo "$(date -u +%Y-%m-%dT%H:%M:%SZ) $1" >> deployed.log
  echo "$s" > up.status' _ "$1" > /dev/null 2>&1 < /dev/null &
REMOTE

# ---------- the wait: both at this commit, healthy, as players reach them ----------
short=${SHA:0:7} start=$SECONDS
echo "== waiting for the API and the real-time server to say they're $short (up to $((WAIT_SEC / 60)) minutes: the real-time server finishes its running races first)"
show() { # one health answer, short
  jq -r 'if type != "object" then "not answering"
    else "\((.version // "?")[0:7]) \(if .draining then "draining, \(.races // 0) race(s) running" elif .ok then "ok" else "not ok" end)" end' <<<"${1:-null}" 2> /dev/null || echo 'not answering'
}
server_state() {
  echo "-- docker compose ps"; ssh server "cd $DIR && docker compose ps -a --format 'table {{.Service}}\t{{.Image}}\t{{.Status}}'" || true
  echo "-- docker compose up said"; ssh server "cat $DIR/up.log 2> /dev/null | tail -n 30" || true
  echo "(the containers' own logs aren't shown here — this repository's logs are public: ssh ubuntu@<the server> 'cd $DIR && docker compose logs --tail 100 api rt')"
}
while :; do
  api=$(curl -sS -m 10 "$API/api/v1/health" 2> /dev/null || true)
  rt=$(curl -sS -m 10 "${RT/wss:/https:}/health" 2> /dev/null || true)
  up=$(ssh server "cat $DIR/up.status 2> /dev/null" || true)
  t=$((SECONDS - start)) compose="failed ($up)"
  [ -n "$up" ] || compose=running
  [ "$up" != 0 ] || compose=finished
  printf '  %d:%02d  api %s · rt %s · compose up %s\n' $((t / 60)) $((t % 60)) "$(show "$api")" "$(show "$rt")" "$compose"
  if [ "$up" = 0 ] && jq -e --arg v "$SHA" '.ok == true and .version == $v' <<<"$api" > /dev/null 2>&1 \
    && jq -e --arg v "$SHA" '.ok == true and .version == $v' <<<"$rt" > /dev/null 2>&1; then
    break
  fi
  if [ -n "$up" ] && [ "$up" != 0 ]; then server_state; fail "docker compose up failed on the server (above)"; fi
  if [ "$t" -ge "$WAIT_SEC" ]; then server_state; fail "after $((WAIT_SEC / 60)) minutes the API and the real-time server still don't both say they're $short and healthy"; fi
  sleep 15
done
echo "the server runs $short: $(jq -c '{ok, version, env, db}' <<<"$api") · $(jq -c '{ok, version, rooms, players, races}' <<<"$rt")"
# (images not used by a container for a week: removed, so the disk doesn't fill; a rollback pulls its image again)
ssh server "docker image prune -af --filter until=168h > /dev/null" || true
