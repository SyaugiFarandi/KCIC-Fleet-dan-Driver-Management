# Baseline Audit — KCIC Fleet & Driver Management

Date: 2026-11-23 · Scope: current workspace (localhost demo, branch `main` @ `d7d6778`)

## 1. Architecture

| Layer | Technology | Notes |
| --- | --- | --- |
| Frontend | React 18 + Vite 5, react-router-dom 6 (lazy routes) | Custom CSS token system (`style.css` → `extras.css` → `polish.css`), brand #831d27, light/dark via `data-theme`, installable PWA |
| Backend | Node 24 runtime, Express 4 (ESM) | zod validation, centralized `HttpError`/`asyncRoute`, pagination helper |
| ORM / DB | Prisma 5.22, PostgreSQL 16 (host port 5544) | Dev DB `fleet_demo`, test DB `fleet_test`; migrations under `backend/prisma/migrations` |
| Auth | bcrypt + JWT | httpOnly cookie `fleet_session` (SameSite=Lax, Secure in prod); Bearer accepted for tests/tooling |
| RBAC | `backend/src/lib/permissions.js` + `requirePermission` middleware | 11 roles; data scoping in queries (requester/driver self-scope) |
| Realtime | SSE (`/api/notifications/stream`, `/api/gps/stream`) | In-process event bus (`lib/events.js`) |
| Tests | node:test + supertest, 59 tests | `cd backend && npm test` |
| Packaging | Docker Compose (db + api + nginx web) | SPA served with CSP and immutable asset caching |

## 2. Data model (current)

`User`, `Vendor`, `Vehicle`, `Driver`, `Route`, `Booking`, `Trip`, `TripEvent`, `Maintenance`,
`AuditLog`, `GpsDevice`, `VehicleLocation`, `GpsEvent`, `Notification`, `Geofence`.
Migration `20261123000000_ux_phases` added `User.notificationPrefs` (JSONB) and
`Vehicle.checklistTemplate` (JSONB).

Key relations: Booking → Trip (1:1) → TripEvent (n), Vehicle/Driver assignments via Trip;
Maintenance blocks vehicle status; GPS device per vehicle; audit log for every mutation.

## 3. Roles

`SYSTEM_ADMIN`, `FLEET_MANAGER`, `OPERATIONAL_MANAGER`, `DISPATCHER`,
`TRANSPORT_COORDINATOR`, `FLEET_OFFICER`, `DRIVER_COORDINATOR`, `MAINTENANCE_OFFICER`,
`VENDOR_MANAGER`, `DRIVER`, `CREW_EMPLOYEE` — all permissions checked server-side.

## 4. Pages and menus (working)

Dashboard (role-scoped), Booking (+calendar, recurring series, bulk approve, series cancel,
undo delete), Perjalanan/Trips (dispatch, lifecycle, checklist, timeline), GPS Monitoring
(demo simulator, live SSE, replay, events, geofences, devices), Kendaraan (CRUD, documents,
checklist template), Driver (CRUD, documents), Vendor (CRUD), Rute (CRUD), Maintenance
(lifecycle), Laporan (KPIs, CSV + XLS export, print), Audit Log, Pengguna, Notifikasi
(preferences, SSE badge), Profil, Login, 404.

## 5. API surface (verified by tests and browser runs)

- `/api/auth` login/logout/me/preferences/password
- `/api/users`, `/api/vehicles`, `/api/drivers`, `/api/vendors`, `/api/routes` CRUD
- `/api/bookings` list/calendar/availability/create (recurring)/decision/cancel/series cancel/delete
- `/api/trips` assign/reassign/status/replay
- `/api/maintenance` lifecycle
- `/api/gps` positions/stream/detail/history/replay/events/geofence/devices
- `/api/reports` summary + `export.csv` + `export.xls`
- `/api/notifications` list/read/stream
- `/api/dashboard`, `/api/audit`

## 6. Verified working (2026-11-23)

- Booking → approval → dispatch → trip completion releases vehicle/driver (tests).
- Conflict guards: overlapping vehicle/driver assignment, capacity, expired SIM, maintenance
  block (tests).
- RBAC: driver/crew 403 on GPS, reports, master data, users (tests per role).
- Demo GPS clearly labeled `DEMO_SIMULATOR` everywhere; no real tracking claims.
- 59/59 backend tests, production build OK, PWA assets served, dark mode and command palette
  verified in browser.

## 7. Gaps confirmed against the enterprise master prompt

No schema/API/UI yet for: fuel transactions and analytics, digital inspection templates and
defect blocking, vendor contracts/SLA scorecards, work-order extensions (repair requests,
release inspection), predictive maintenance forecasts, route points/restrictions/estimation,
emergency booking priority, BI/KPI builder, data quality monitor, rule-based fleet assistant,
driver offline queue. Sidebar lacks the enterprise grouping (Operations / Intelligence).

See `FEATURE_GAP_ANALYSIS.md` and `IMPLEMENTATION_BACKLOG.md`.
