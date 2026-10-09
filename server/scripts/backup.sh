#!/usr/bin/env bash
# A backup of the database (docs/SERVER.md "Backups"; docs/DISASTER_RECOVERY.md): pg_dump in its custom format,
# encrypted with AES-256 (gpg, a passphrase) — what's kept is never readable without the passphrase. pg_dump must be
# at least as new as the database's PostgreSQL (PlanetScale runs 17 or 18: the backup workflow's PG_MAJOR): checked
# first, with a plain message. The file appears only once it's whole.
#   DATABASE_URL=… BACKUP_PASSPHRASE=… server/scripts/backup.sh out.dump.gpg
set -euo pipefail
out="${1:?the file to write}"
: "${DATABASE_URL:?DATABASE_URL is not set}" "${BACKUP_PASSPHRASE:?BACKUP_PASSPHRASE is not set}"
# (sslmode=verify-full, as PlanetScale's address asks: the server's certificate checked against the system's
# certificate authorities, unless the address names its own)
case "$DATABASE_URL" in *sslrootcert=*) ;; *sslmode=verify-*) export PGSSLROOTCERT="${PGSSLROOTCERT:-system}" ;; esac
server=$(psql "$DATABASE_URL" -X -At -c 'show server_version_num')
client=$(pg_dump --version | grep -oE '[0-9]+' | head -1)
if [ "$client" -lt $((server / 10000)) ]; then
  echo "pg_dump is PostgreSQL $client's, the database runs PostgreSQL $((server / 10000)): a newer pg_dump is needed (the backup workflow: PG_MAJOR=$((server / 10000)))" >&2
  exit 1
fi
echo "the database: PostgreSQL $((server / 10000)) ($server); $(pg_dump --version)"
trap 'rm -f "$out.part"' EXIT
pg_dump --format=custom --no-owner --no-privileges --dbname="$DATABASE_URL" \
  | gpg --batch --yes --symmetric --cipher-algo AES256 --pinentry-mode loopback --passphrase-fd 3 --output "$out.part" 3<<<"$BACKUP_PASSPHRASE"
mv "$out.part" "$out"
echo "backup written: $out ($(du -h "$out" | cut -f1))"
