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
4. Runs 67 tests sequentially (`--test-concurrency=1`). Tests that need extra master data
   (an enterprise QA vehicle/driver/user, inspection templates, contracts) create their own
   rows, so count-based assertions tolerate those fixtures.

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
| `ux-phases.test.js` | httpOnly cookie session, notification preferences, series-wide cancel (+RBAC), vehicle checklist templates, Excel export |
| `enterprise.test.js` | route recommendations (+RBAC/ranking/404) · emergency transport create/validation/scope/decision/summary · inspection template + inspection lifecycle → FAILED critical defect · maintenance predictions (4 rules, RBAC) → work order from defect → start/complete resolves defect · driver-scoped fuel submission (trip ownership, 120 L anomaly) + review RBAC · SLA contract create/duplicate/range validation + scorecard · intelligence KPI library/data-quality/widgets (+RBAC) · read-only assistant suggestions/query/validation (+RBAC) |

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
15. Transport Darurat: create as an employee (short reason is rejected), approve as fleet,
    assign as dispatcher; verify KPI cards and that cancel is blocked once assigned.
16. Bahan Bakar: submit as driver from Tugas Saya (110 L triggers a FLAGGED anomaly), review
    as fleet officer (APPROVE/CLEAR), and check the per-vehicle km/L in the summary.
17. Inspeksi: create from a template, complete with a critical item unchecked → FAILED, one
    CRITICAL defect appears in Maintenance and can be converted to a work order.
18. Maintenance predictive panel: verify due/overdue reasons cite odometer, last service and
    open defects; employee token → 403.
19. SLA Vendor: create a contract with 2 metrics, confirm duplicate numbers → 409, check the
    scorecard only uses data entered by the user (no invented values).
20. Fleet Intelligence: KPI library (14 KPIs, formulas), data-quality monitor (12 checks),
    widget toggle persists on the dashboard.
21. Asisten: ask a suggested question; confirm the answer states it is rule-based/read-only
    and employee token → 403.
22. Menu grouping: staff sidebar shows Workspace/Operations/Intelligence/Governance with no
    duplicate items; driver sidebar shows only Tugas Saya/Trip/Notifikasi/Profil. Repeat in
    dark mode and at 390 px width (drawer + bottom nav).

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
