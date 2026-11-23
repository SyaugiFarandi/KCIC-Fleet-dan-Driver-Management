# Testing guide

## Automated API tests

```bash
cd backend
npm test
```

The script:

1. Creates the `fleet_test` database if missing (default
   `postgresql://fleet:fleet_demo_password@localhost:5544/fleet_test`).
2. Resets it with `prisma migrate reset --force --skip-seed`.
3. Inserts deterministic fixtures: 12 users, 2 vendors, 2 routes, 4 vehicles (two with
   document expiry dates), 4 drivers, 1 geofence, 3 GPS devices, 2 GPS events.
4. Runs 54 tests sequentially (`--test-concurrency=1`).

Coverage by file:

| File | Area |
| --- | --- |
| `auth.test.js` | login, JWT, profile, password change, deactivated accounts, 404 JSON |
| `rbac.test.js` | per-role 403 checks, booking scoping, dashboard scoping |
| `workflow.test.js` | booking → approval → dispatch → trip completion, conflicts, maintenance, reassignment |
| `master-data.test.js` | vehicle/vendor/driver/route CRUD, validation, reference protection, audit |
| `users.test.js` | user CRUD, pagination/filtering, self-protection rules |
| `gps.test.js` | staff-only access; motion status derivation; status/ownership/driver/search filters; detail; history range/limit; trip replay; events filters; geofence CRUD (+validation, 409, audit); GPS device CRUD (+409 duplicates, audit) |
| `features.test.js` | notifications (scoping, read/mark-all, dedupe, sweep) · reports summary + CSV (RBAC, range, unknown dataset 400) · recurring booking series · checklist template + `PICKED_UP` gate · vehicle document expiry fields · GPS ETA/deviation · event acknowledgement (+403/404/409, audit) |

The GPS simulator is disabled automatically under `NODE_ENV=test`, so tests are deterministic.

Frontend production build check:

```bash
cd frontend
npm run build
```

## Manual smoke test (Docker)

1. `docker compose up --build` then open http://localhost:8090.
2. Login `admin@demo.local` / `Demo123!`. Verify dashboard KPIs load from the API.
3. Booking: create as `employee@demo.local`, approve as `fleet@demo.local`, assign in
   Perjalanan as `dispatch@demo.local`, advance status as `driver@demo.local`.
4. GPS Monitoring: check counters, click markers/list entries, open Riwayat Koordinat,
   play Trip Replay, open Event GPS / Geofence / Perangkat GPS modals, try filters.
5. Confirm the DEMO GPS banner is visible and coordinates update roughly every 15 s.
6. Maintenance: create → start (vehicle becomes unavailable) → complete.
7. Audit Log: confirm entries for booking, trip, maintenance, geofence/device changes.
8. RBAC: login as `driver@demo.local`; GPS Monitoring is absent and
   `GET /api/gps/positions` returns 403 with the driver token.
9. Notifikasi: badge unread count, open dropdown, "Tandai semua dibaca", open
   `/notifications`, switch type tabs, toggle "Belum dibaca".
10. Laporan: pick a range, verify KPIs/tables, download CSV, try "Cetak / PDF"; with a driver
    token `/api/reports/summary` returns 403.
11. Booking: switch to Kalender, run "Cek ketersediaan", create a booking with
    "Buat jadwal berulang" (WEEKLY ×3) and confirm the series toast + tags.
12. Perjalanan: try `PICKED_UP` on a trip with an incomplete checklist (rejected with the
    missing items), complete the checklist, then retry.
13. Kendaraan/Driver: check document expiry badges; edit STNK/insurance dates.
14. GPS: verify ETA chips, "Deviasi Rute" KPI and detail banner, acknowledge an event in
    "Event GPS" (unacknowledged count decreases).

## GPS acceptance checks

- Map pans and zooms; markers are clickable; popups show plate/speed/destination/driver.
- KPI cards filter the fleet list (moving/stopped/offline) and only matching markers render.
- Search matches plate, destination, driver, vendor; ownership and driver filters combine.
- Vehicle detail values match the database (speed, coordinates, device IMEI, last ping).
- Positions change over time (simulator tick every 15 s; UI polling every 8 s).
- Demo disclaimers present on the page and in API responses (`source: DEMO_SIMULATOR`).

## Notes

- Test DB URL override: `TEST_DATABASE_URL=... npm test`.
- Seeding (`node prisma/seed.js`) is idempotent and can be re-run without duplicating data.
- Stop the API before `npx prisma generate` on Windows if it holds file locks on the client.
