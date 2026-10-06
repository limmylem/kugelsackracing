#!/usr/bin/env bash
# A backup put back (docs/SERVER.md "Restoring"): decrypted, restored into the database TARGET_URL names
# (an empty one, or one to overwrite: --clean drops what's there first), then checked — the tables there,
# the migrations recorded, rows counted.
#   TARGET_URL=… BACKUP_PASSPHRASE=… server/scripts/restore.sh backup.dump.gpg [--clean]
set -euo pipefail
in="${1:?the backup file}"; clean="${2:-}"
: "${TARGET_URL:?TARGET_URL isn't set}" "${BACKUP_PASSPHRASE:?BACKUP_PASSPHRASE isn't set}"
tmp="$(mktemp)"; trap 'rm -f "$tmp"' EXIT
gpg --batch --yes --decrypt --pinentry-mode loopback --passphrase-fd 3 --output "$tmp" "$in" 3<<<"$BACKUP_PASSPHRASE"
psql "$TARGET_URL" -v ON_ERROR_STOP=1 -q -c "create extension if not exists postgis"
pg_restore --no-owner --no-privileges ${clean:+--clean --if-exists} --exit-on-error --dbname="$TARGET_URL" "$tmp" 2>&1 | grep -v 'extension "postgis" already exists' || true
psql "$TARGET_URL" -v ON_ERROR_STOP=1 -At -c "
  select 'migrations: ' || count(*) from drizzle.__drizzle_migrations;
  select 'users: ' || count(*) from users;
  select 'world content rows: ' || count(*) from content_items;
  select 'track results: ' || count(*) from track_results;
  select 'replays: ' || count(*) from replays;"
echo "restored into the target database"
