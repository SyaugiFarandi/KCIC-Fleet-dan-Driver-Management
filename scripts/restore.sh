#!/usr/bin/env bash
# Restore a pg_dump custom-format backup into a NEW database.
# Refuses to overwrite the live database or any pre-existing database.
# Usage: scripts/restore.sh <dump-file> <target-db>
# Env: DB_CONTAINER (default kcic-fleet-db-dev), DB_USER, LIVE_DB
set -euo pipefail

DUMP_FILE="${1:-}"
TARGET_DB="${2:-}"
if [[ -z "$DUMP_FILE" || -z "$TARGET_DB" ]]; then
  echo "Usage: scripts/restore.sh <dump-file> <target-db>" >&2
  exit 1
fi
if [[ ! -f "$DUMP_FILE" ]]; then
  echo "ERROR: dump file '$DUMP_FILE' tidak ditemukan." >&2
  exit 1
fi
if [[ ! "$TARGET_DB" =~ ^[A-Za-z0-9_]+$ ]]; then
  echo "ERROR: nama database target hanya boleh huruf, angka dan underscore." >&2
  exit 1
fi

DB_CONTAINER="${DB_CONTAINER:-kcic-fleet-db-dev}"
DB_USER="${DB_USER:-fleet}"
LIVE_DB="${LIVE_DB:-fleet_demo}"

if [[ "$TARGET_DB" == "$LIVE_DB" ]]; then
  echo "REFUSED: target '$TARGET_DB' adalah database live. Restore harus ke database baru." >&2
  exit 2
fi

if [[ -f "$DUMP_FILE.sha256" ]]; then
  ( cd "$(dirname "$DUMP_FILE")" && sha256sum -c "$(basename "$DUMP_FILE").sha256" )
else
  echo "WARN: checksum file tidak ditemukan; lanjut tanpa verifikasi integritas." >&2
fi

exists=$(docker exec "$DB_CONTAINER" psql -U "$DB_USER" -d postgres -tAc \
  "select 1 from pg_database where datname = '$TARGET_DB'")
if [[ -n "$exists" ]]; then
  echo "REFUSED: database '$TARGET_DB' sudah ada. Hapus manual atau pilih nama lain." >&2
  exit 2
fi

start=$(date +%s)
docker exec "$DB_CONTAINER" psql -U "$DB_USER" -d postgres -v ON_ERROR_STOP=1 \
  -c "CREATE DATABASE \"$TARGET_DB\"" >/dev/null
docker exec -i "$DB_CONTAINER" pg_restore -U "$DB_USER" -d "$TARGET_DB" \
  --no-owner --no-privileges --exit-on-error < "$DUMP_FILE"
end=$(date +%s)

tables=$(docker exec "$DB_CONTAINER" psql -U "$DB_USER" -d "$TARGET_DB" -tAc \
  "select count(*) from information_schema.tables where table_schema = 'public'")
migrations=$(docker exec "$DB_CONTAINER" psql -U "$DB_USER" -d "$TARGET_DB" -tAc \
  "select count(*) from \"_prisma_migrations\" where finished_at is not null" 2>/dev/null || echo "n/a")
users=$(docker exec "$DB_CONTAINER" psql -U "$DB_USER" -d "$TARGET_DB" -tAc \
  "select count(*) from \"User\"" 2>/dev/null || echo "n/a")
bookings=$(docker exec "$DB_CONTAINER" psql -U "$DB_USER" -d "$TARGET_DB" -tAc \
  "select count(*) from \"Booking\"" 2>/dev/null || echo "n/a")
trips=$(docker exec "$DB_CONTAINER" psql -U "$DB_USER" -d "$TARGET_DB" -tAc \
  "select count(*) from \"Trip\"" 2>/dev/null || echo "n/a")

echo "Restore OK: '$TARGET_DB' dari $(basename "$DUMP_FILE") dalam $((end - start))s"
echo "Verify: tables=$tables migrations=$migrations users=$users bookings=$bookings trips=$trips"
echo "Cleanup (manual, setelah verifikasi): docker exec $DB_CONTAINER psql -U $DB_USER -d postgres -c 'DROP DATABASE \"$TARGET_DB\"'"
