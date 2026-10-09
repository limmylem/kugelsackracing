#!/usr/bin/env bash
# A backup put back (docs/SERVER.md "Restoring"; docs/DISASTER_RECOVERY.md): decrypted, restored into the database
# TARGET_URL names (an empty one, or one to overwrite: --clean drops what's there first), then checked — the tables
# there, the migrations recorded, rows counted. Every object must come back without an error, except an extension the
# target's PostgreSQL hasn't got (one of PlanetScale's own, say): the game needs only PostGIS, made here first.
# In GitHub Actions a failure names the objects only, not pg_restore's messages: the repository's logs are public,
# and a message can quote a row.
#   TARGET_URL=… BACKUP_PASSPHRASE=… server/scripts/restore.sh backup.dump.gpg [--clean]
set -euo pipefail
in="${1:?the backup file}"; clean="${2:-}"
: "${TARGET_URL:?TARGET_URL is not set}" "${BACKUP_PASSPHRASE:?BACKUP_PASSPHRASE is not set}"
case "$TARGET_URL" in *sslrootcert=*) ;; *sslmode=verify-*) export PGSSLROOTCERT="${PGSSLROOTCERT:-system}" ;; esac
tmp="$(mktemp)" log="$(mktemp)"; trap 'rm -f "$tmp" "$log"' EXIT
gpg --batch --yes --decrypt --pinentry-mode loopback --passphrase-fd 3 --output "$tmp" "$in" 3<<<"$BACKUP_PASSPHRASE"
psql "$TARGET_URL" -X -v ON_ERROR_STOP=1 -q -c "set client_min_messages = warning; create extension if not exists postgis"
pg_restore --verbose --no-owner --no-privileges ${clean:+--clean --if-exists} --dbname="$TARGET_URL" "$tmp" > "$log" 2>&1 || true
# (each error follows the line naming its object: "from TOC entry 222; 1259 18619 TABLE users kr")
failed=$(awk '/^pg_restore: from TOC entry / { e = $0; sub(/^pg_restore: from TOC entry [0-9]+; [0-9]+ [0-9]+ /, "", e) }
  /^pg_restore: error: / { print (e != "" ? e : "(not an object: " substr($0, 20, 160) ")"); e = "" }' "$log" | sort -u)
left=$(grep -E '^(EXTENSION|COMMENT EXTENSION) ' <<<"$failed" || true)
bad=$(grep -vE '^(EXTENSION|COMMENT EXTENSION) ' <<<"$failed" | grep . || true)
[ -z "$left" ] || echo "left out — extensions this PostgreSQL hasn't got (the game doesn't use them): $(sed -E 's/^(COMMENT )?EXTENSION ([^ ]+).*/\2/' <<<"$left" | sort -u | tr '\n' ' ')"
if [ -n "$failed" ] && [ "${GITHUB_ACTIONS:-}" != true ]; then
  echo "pg_restore's errors:"; grep -E -A3 '^pg_restore: (from TOC entry|error:)' "$log" | grep -v '^--$' | sed 's/^/  /'
fi
if [ -n "$bad" ]; then
  echo "the restore FAILED: these didn't come back —"; awk '{ print "  " $0 }' <<<"$bad"
  [ "${GITHUB_ACTIONS:-}" != true ] || echo "(pg_restore's messages aren't shown here: this repository's logs are public, and a message can quote a row — run server/scripts/restore.sh on your own computer to see them)"
  exit 1
fi
psql "$TARGET_URL" -X -v ON_ERROR_STOP=1 -At -c "
  select 'migrations: ' || count(*) from drizzle.__drizzle_migrations;
  select 'users: ' || count(*) from users;
  select 'world content rows: ' || count(*) from content_items;
  select 'track results: ' || count(*) from track_results;
  select 'replays: ' || count(*) from replays;"
echo "restored into the target database"
