# Backup & Restore Runbook

P0 remediation for production blocker #4 (backup/restore). Applies to the PostgreSQL 16
database of KCIC Fleet & Driver Management. All data is synthetic DEMO data.

## 1. What is backed up

| Asset | Method | Notes |
| --- | --- | --- |
| PostgreSQL (`fleet_demo`) | `pg_dump -Fc` (custom format) | Schema + data + `_prisma_migrations` history |
| Application containers | Rebuilt from source / image | Stateless; no local file uploads |
| Frontend assets | Built into the nginx image | Rebuilt from source |
| Secrets (`JWT_SECRET`, DB password) | **Not** in the database dump | Managed via `.env` / secret manager; back up separately in the secret store |

The dump **does** contain password hashes, emails and audit records. Treat every dump as
confidential PII: restrict access, keep it off shared drives, and encrypt at rest.

## 2. Targets

| Metric | Local demo target | Production recommendation |
| --- | --- | --- |
| RPO (max data loss) | 24 h (daily dump) | ≤ 15 min with WAL archiving / managed PITR |
| RTO (restore time) | ≤ 15 min | ≤ 1 h, rehearsed quarterly |
| Retention | 7 daily + 4 weekly | Per policy, minimum 30 days, offsite copy |

`pg_dump` alone gives point-in-time-at-dump only. For production, enable continuous WAL
archiving (e.g. `pgBackRest`, `wal-g`, or a managed service) to reach a low RPO.

## 3. Backup procedure

Script: [`scripts/backup.sh`](../scripts/backup.sh)

```bash
# default: writes to ./backups, reads fleet_demo from kcic-fleet-db-dev
./scripts/backup.sh

# explicit target directory
./scripts/backup.sh /secure/backups
```

Output per run:

- `<db>_<UTC timestamp>.dump` — custom-format dump
- `.dump.sha256` — integrity checksum
- `.meta` — database, container, size, pg version, timestamp

The script refuses to run if the DB container is not running or the database is missing.
Schedule daily with cron/Task Scheduler, e.g. `0 2 * * * cd /srv/kcic && ./scripts/backup.sh`.

## 4. Restore procedure (never overwrite live data)

Script: [`scripts/restore.sh`](../scripts/restore.sh)

```bash
./scripts/restore.sh backups/fleet_demo_<stamp>.dump fleet_restore_check
```

Hard guards:

1. Target equal to the live database (`fleet_demo`) → **refused**, exit 2.
2. Target database already exists → **refused**, exit 2 (create a fresh name).
3. Dump checksum is verified against `.sha256` before any write.

The script creates the new database, runs `pg_restore --exit-on-error`, then prints
verification counts (`tables`, `migrations`, `users`, `bookings`, `trips`).

After verifying, remove the staging DB manually (the script never drops anything):

```bash
docker exec kcic-fleet-db-dev psql -U fleet -d postgres -c 'DROP DATABASE "fleet_restore_check"'
```

### Post-restore verification checklist

1. Row counts match the source for `User`, `Booking`, `Trip`, `Vehicle`, `AuditLog`.
2. `_prisma_migrations` has no failed rows: `select count(*) from "_prisma_migrations" where finished_at is null;` → 0.
3. Point a throwaway API instance at the restored DB (`DATABASE_URL=.../fleet_restore_check`)
   and check `GET /api/health` returns `database: "up"` plus one login.
4. Only then is the restore considered successful.

## 5. Verified restore drill (evidence)

Executed 2026-11-23 against the local dev database:

| Step | Result |
| --- | --- |
| `./scripts/backup.sh` | OK — `fleet_demo_20261123T093922Z.dump`, 312 KB, 1 s |
| Checksum verification | OK |
| `./scripts/restore.sh ... fleet_restore_check` | OK — restored in 4 s |
| Restored object counts | tables=25, migrations=5, users=13, bookings=37, trips=13, vehicles=18, audit=93 |
| Source vs restored counts | identical (13/37/13/18/93) |
| Refusal into live DB `fleet_demo` | refused, exit 2 |
| Refusal into existing DB | refused, exit 2 |
| Staging DB cleanup | dropped after verification; live DB untouched |

Measured recovery time for this dataset: **4 seconds** restore + ~1 minute verification on a
local container. Volume and network will dominate at production scale; rehearse there.

## 6. Failure scenarios

| Scenario | Action |
| --- | --- |
| Corrupt table / bad migration | Restore latest dump into a new DB, verify, repoint `DATABASE_URL`, restart API |
| Accidental `DROP` / data loss | Stop API, restore the most recent good dump to a new DB, verify, switch over |
| Container loss | Recreate DB container, restore dump, run `prisma migrate deploy` only if schema is behind |
| Ransomware / total host loss | Restore from offsite copy into a fresh host, rotate secrets, rebuild images |

Never run `prisma migrate reset` or `seed` against a production database as a recovery step —
it destroys data. Use the dump.

## 7. Known gaps

- No automated backup scheduler is installed in this repo; the script is the unit to schedule.
- No WAL archiving/PITR configured → production RPO is bounded by dump frequency until added.
- No backup-encryption step in the scripts; rely on an encrypted volume or add `age`/`gpg`.
- Restore drill is manual; put it on the runbook calendar quarterly.
