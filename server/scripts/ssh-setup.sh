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
if ! ssh-keygen -y -f ~/.ssh/ognistrada_deploy > /dev/null 2>&1; then
  echo "::error title=DEPLOY_SSH_KEY::it isn't a private key ssh can read: paste the whole file ognistrada_deploy, from the -----BEGIN line to the -----END line (docs/GO_LIVE.md Part 5)"
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
