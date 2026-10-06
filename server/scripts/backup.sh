#!/usr/bin/env bash
# A backup of the database (docs/SERVER.md "Backups"): pg_dump in its custom format, encrypted with AES-256
# (gpg, a passphrase) — what's kept is never readable without the passphrase.
#   DATABASE_URL=… BACKUP_PASSPHRASE=… server/scripts/backup.sh out.dump.gpg
set -euo pipefail
out="${1:?the file to write}"
: "${DATABASE_URL:?DATABASE_URL isn't set}" "${BACKUP_PASSPHRASE:?BACKUP_PASSPHRASE isn't set}"
pg_dump --format=custom --no-owner --no-privileges --dbname="$DATABASE_URL" \
  | gpg --batch --yes --symmetric --cipher-algo AES256 --pinentry-mode loopback --passphrase-fd 3 --output "$out" 3<<<"$BACKUP_PASSPHRASE"
echo "backup written: $out ($(du -h "$out" | cut -f1))"
