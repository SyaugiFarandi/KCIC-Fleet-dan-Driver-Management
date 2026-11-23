#!/usr/bin/env bash
# Logical backup (pg_dump custom format) of the fleet database.
# Usage: scripts/backup.sh [output-dir]
# Env: DB_CONTAINER (default kcic-fleet-db-dev), DB_NAME, DB_USER
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BACKUP_DIR="${1:-$ROOT_DIR/backups}"
DB_CONTAINER="${DB_CONTAINER:-kcic-fleet-db-dev}"
DB_NAME="${DB_NAME:-fleet_demo}"
DB_USER="${DB_USER:-fleet}"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
BASE="${DB_NAME}_${STAMP}"
FILE="$BACKUP_DIR/${BASE}.dump"

if ! docker inspect "$DB_CONTAINER" --format '{{.State.Running}}' 2>/dev/null | grep -q true; then
  echo "ERROR: container '$DB_CONTAINER' tidak berjalan." >&2
  exit 1
fi
if ! docker exec "$DB_CONTAINER" psql -U "$DB_USER" -d postgres -tAc \
  "select 1 from pg_database where datname = '$DB_NAME'" | grep -q 1; then
  echo "ERROR: database '$DB_NAME' tidak ditemukan di container '$DB_CONTAINER'." >&2
  exit 1
fi

mkdir -p "$BACKUP_DIR"
start=$(date +%s)
docker exec "$DB_CONTAINER" pg_dump -U "$DB_USER" -d "$DB_NAME" -Fc --no-owner --no-privileges > "$FILE"
end=$(date +%s)

( cd "$BACKUP_DIR" && sha256sum "${BASE}.dump" > "${BASE}.dump.sha256" )

cat > "$BACKUP_DIR/${BASE}.meta" <<META
database=$DB_NAME
user=$DB_USER
container=$DB_CONTAINER
created_utc=$STAMP
format=custom
size_bytes=$(wc -c < "$FILE" | tr -d ' ')
pg_version=$(docker exec "$DB_CONTAINER" pg_dump --version)
META

echo "Backup OK: $FILE ($(du -h "$FILE" | cut -f1), $((end - start))s)"
echo "Checksum: $BACKUP_DIR/${BASE}.dump.sha256"
