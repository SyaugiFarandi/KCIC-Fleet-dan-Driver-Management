# KCIC Fleet & Driver Management — Local Demo

A runnable full-stack demo of a fleet and driver operations system for the KCIC/Whoosh
context: booking → approval → dispatch → trip execution, plus maintenance, master data,
audit trail, role-based access control, and a DEMO GPS monitoring module.

> **All data in this project is synthetic DEMO data.** Nothing here comes from KCIC and it
> must not be treated as official KCIC data or used in production as-is.

## Stack

- Frontend: React 18 + Vite 5 (lazy-loaded routes), Leaflet 1.9 + OpenStreetMap (GPS map),
  custom CSS with design tokens, light/dark themes via `data-theme` tokens, visible focus
  states, skip link, focus-trapped modals, reduced-motion support, installable PWA
  (manifest + service worker with offline fallback)
- Backend: Node.js 20+, Express 4, Prisma 5, zod validation, bcrypt, httpOnly cookie
  session (Bearer token still accepted for API tests/tooling), Server-Sent Events for
  live notifications and GPS positions
- Database: PostgreSQL 16
- Tests: node:test + supertest (59 automated API tests)
- Packaging: Docker Compose (PostgreSQL + API + Nginx-served frontend)

## Run with Docker (recommended)

```bash
cp .env.example .env        # optional: adjust ports/secrets
docker compose up --build
```

| Service | URL |
| --- | --- |
| Web console | http://localhost:8090 |
| API health | http://localhost:4010/api/health |
| PostgreSQL (host) | localhost:5544 |

Host ports are configurable via `DB_PORT`, `API_PORT`, `WEB_PORT` in `.env`.

On start the API container runs `prisma generate`, `prisma migrate deploy`, the idempotent
seed, then the server. Seeding is safe to re-run.

## Demo accounts

Password for every account: `Demo123!`

| Role | Email |
| --- | --- |
| System Administrator | `admin@demo.local` |
| Fleet Manager | `fleet@demo.local` |
| Operational Manager | `ops@demo.local` |
| Dispatcher | `dispatch@demo.local` |
| Transport Coordinator | `transport@demo.local` |
| Fleet Officer | `fleetofficer@demo.local` |
| Driver Coordinator | `drivercoord@demo.local` |
| Maintenance Officer | `maintenance@demo.local` |
| Vendor Manager | `vendor@demo.local` |
| Driver | `driver@demo.local` |
| Crew Employee | `employee@demo.local`, `employee2@demo.local`, `employee3@demo.local` |

## Manual development

```bash
# 1) database (Docker just for PostgreSQL)
docker compose up -d db

# 2) backend (http://localhost:4010)
cd backend
npm install
export DATABASE_URL="postgresql://fleet:fleet_demo_password@localhost:5544/fleet_demo?schema=public"
export JWT_SECRET="dev-local-secret"
npx prisma generate
npx prisma migrate deploy
node prisma/seed.js
npm run dev

# 3) frontend (http://localhost:5180, proxies /api to :4010)
cd ../frontend
npm install
npm run dev
```

## Modules

- **Dashboard** — live KPIs and recent activity from the database, scoped by role.
- **Booking** — employee requests, approval/rejection with reason, cancellation; list view
  plus month **calendar view**, availability check (vehicles + drivers for a time window), and
  **recurring series** (`DAILY`/`WEEKLY`, 2–8 occurrences, linked by `seriesId`) with a
  **"Batalkan Seluruh Seri"** action, bulk approval of selected pending rows, saved
  filters/column visibility, and delayed **undo delete**.
- **Perjalanan (Trips)** — dispatch assignment, reassignment, status lifecycle
  (`SCHEDULED → DRIVER_ACCEPTED → PICKED_UP → IN_PROGRESS → COMPLETED`), timeline, and a
  **pre-trip checklist** that the API enforces before `PICKED_UP`; each vehicle can carry its
  own checklist template (defaults to the system template).
- **GPS Monitoring** — Leaflet/OSM fleet map, vehicle side list, counters
  (moving/stopped/offline/deviations), filters (status, ownership, driver, free-text), vehicle
  detail (speed, position, destination, driver, device), **ETA to destination**, **route
  deviation alerts**, coordinate history, trip replay with playback slider, GPS event & alerts
  with **acknowledge**, geofence CRUD, GPS device CRUD.
- **Kendaraan / Driver / Vendor / Rute** — master data CRUD with reference protection;
  document expiry fields with "segera habis" badges (STNK + asuransi on vehicles, SIM on drivers).
- **Maintenance** — planned → in progress → completed lifecycle, blocks assignment while busy.
- **Laporan** — time-range analytics (utilization, approval rate, cost per trip, maintenance
  cost, booking recap per department) with **CSV and Excel (`.xls`) export** and print/PDF
  layout.
- **Notifikasi** — in-app notification center (topbar bell + page): booking decisions, trip
  assignments, GPS alerts, document reminders, and maintenance due; mark read / mark all.
  The bell count updates live via SSE, and each user can switch off notification types in
  **Profil → Preferensi Notifikasi** (applied server-side to the list and badge).
- **Audit Log** — mutation trail for master data, bookings, trips, maintenance, geofences,
  GPS devices, and GPS event acknowledgements.
- **Pengguna / Profil** — user administration and self-service password change.

### Console UX

- **Command palette** (`Ctrl/⌘ + K`) for jumping to pages and actions; `?` opens a keyboard
  shortcut reference, `Alt + D` toggles the theme.
- Skeleton loaders, empty states with a call to action, inline field validation, and an
  unsaved-changes guard on create/edit forms.
- Data tables with result counts, pagination, column visibility, saved filters per page.
- Dark mode built on the same CSS tokens (brand colour preserved), persisted per browser.
- On small screens a bottom navigation bar replaces the sidebar; the app is installable and
  served by a service worker that falls back to an offline page (API calls are never cached).
- Friendly 403/404 pages, an offline/network banner, and a session-expired modal that appears
  when the cookie session ends.

## GPS module: DEMO simulator, not real tracking

- Coordinates are produced by a local simulator (`backend/src/lib/gpsSimulator.js`) that
  interpolates positions along the planned route (Jakarta–Karawang–Padalarang–Tegalluar
  corridor). It starts with the API unless `GPS_SIM_ENABLED=false` or `NODE_ENV=test`.
- Default update interval is 15 s (`GPS_SIM_INTERVAL_MS`); the UI polls positions every 8 s.
- Every telemetry row and event is tagged `source = DEMO_SIMULATOR`, and the page shows a
  persistent DEMO GPS banner. **The app never claims these are real vehicle locations.**
- Moving vehicles follow the route of their active trip; parked vehicles stay at a
  deterministic spot near their base. No GPS hardware, vendor API, or KCIC system is used.

## Role-based access control

Authorization is enforced in API middleware (`backend/src/lib/permissions.js`), not only by
hiding menus. For example `gps:read` is limited to staff roles (`DRIVER` and `CREW_EMPLOYEE`
receive HTTP 403), geofence/device changes and GPS event acknowledgement require `gps:write`
(`SYSTEM_ADMIN`, `FLEET_MANAGER`, `FLEET_OFFICER`), and reports (`reports:read`) are staff-only
(`DRIVER`/`CREW_EMPLOYEE` get 403 on both summary and CSV). See `docs/ROLE_LIST.md`.

## Security notes (local demo hardening)

- The nginx image sends a strict CSP plus `X-Content-Type-Options`, `X-Frame-Options:
  DENY`, Referrer-Policy, Permissions-Policy and COOP/CORP; the Express app sends the same
  browser headers for manual/dev runs. Verified: `nginx -t` passes and the built SPA loads
  with **0 CSP violations** (Google Fonts and OSM tiles explicitly allowed).
- API CORS uses an allowlist. Override with `CORS_ORIGIN` (comma-separated origins) if you
  change host ports.
- CSV and Excel exports are guarded against spreadsheet formula injection.
- The API container runs as the non-root `node` user.
- Login sets the JWT in an httpOnly, SameSite=Lax cookie (`fleet_session`; `Secure` when
  `NODE_ENV=production`) so client JS cannot read it; CORS allows credentials only for the
  configured origins. Bearer tokens remain supported for the API test suite and tooling.
  Production still needs HTTPS/HSTS and externalized secrets.

## Tests

```bash
cd backend
npm test    # resets the fleet_test DB, seeds fixtures, runs 59 API tests
```

Covers auth, RBAC (403 checks per role), booking/approval/dispatch/trip workflow,
maintenance lifecycle, master data CRUD + validation, users, GPS
(positions/filters/detail/history/replay/events/geofence/device CRUD, demo metadata), and the
enhancements: notifications (per-user scoping, read/mark-all, dedupe), reports summary + CSV,
recurring booking series, trip checklist gate, document expiry fields, GPS ETA/deviation, and
event acknowledgement (RBAC + audit), plus cookie-session auth, series-wide cancel, per-user
notification preferences, vehicle checklist templates, and Excel export.

Frontend production build: `cd frontend && npm run build`.

## Known limitations (honest list)

- Synthetic data only; no KCIC production systems, SSO, email/SMS, or vendor contracts.
- GPS is a demo simulator; no real tracking device integration.
- Dispatch conflict checks cover basic overlap/availability, not calendar-wide
  optimization or concurrency locking.
- Geofence enter/exit events are generated by the simulator for demonstration.
- Notifications are in-app only (no email/WhatsApp/Telegram delivery); document and
  maintenance reminders are generated by a sweep on notification reads/polls.
- Recurring bookings create independent bookings linked by `seriesId`; the series can be
  cancelled as a whole from the booking detail, but editing one occurrence still does not
  cascade to the rest of the series.
- The pre-trip checklist is enforced as a hard gate; each vehicle can define its own template
  (max 20 items, 3–120 characters each), otherwise the system default applies.
- GPS ETA/deviation are derived from the simulator's own progress, labeled DEMO in the UI.
- This is a functional local demo, not a production-approved KCIC system.

See `docs/AUDIT_REPORT.md` for the per-area implementation status.
