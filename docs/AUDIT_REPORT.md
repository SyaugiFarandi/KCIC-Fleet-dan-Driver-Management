# Implementation Audit Report

Status date: 2026-11-23 · Environment: localhost demo (Docker or manual Node + PostgreSQL)

Scope: the original brief (complete all menus, backend-enforced RBAC, real workflows,
migrations/seed/validation/audit/tests, Docker Compose, no dummy data presented as official
KCIC data), the added **GPS Fleet Monitoring** feature request, and the follow-up enhancement
round (notification center, document/SIM reminders, reports + CSV export, booking calendar &
recurring series, pre-trip checklist, GPS ETA/deviation/acknowledge).

Legend: **PASS** = implemented and verified; **PARTIAL** = implemented with documented
constraints; **NOT IMPLEMENTED** = not built.

## Overall

- All menus are functional and backed by real API + PostgreSQL data (no decorative buttons).
- Role restrictions are enforced server-side; frontend hides menus only as convenience.
- Automated API suite: **59 tests, 59 passing** (`cd backend && npm test`).
- Frontend production build: **passing** (`cd frontend && npm run build`).
- Docker Compose stack starts db → api (migrate + seed) → web; verified end to end.

## Verification log (2026-11-23)

- `cd backend && npm test` → **47 tests, 47 pass, 0 fail** (~11 s; pre-enhancement run — the
  current suite is 54 tests, see the enhancement log below).
- `cd frontend && npm run build` → success (JS 477.71 kB / CSS 47.07 kB, gzip 135/13 kB).
- `docker compose up --build` (host ports 5545/4011/8091 during verification):
  - db healthy; api ran `prisma generate` → `prisma migrate deploy` → seed → server, then
    passed its healthcheck; web container served the built SPA.
  - `GET /api/health` → `{"ok":true,...,"database":"up"}`.
  - Admin login via the nginx-served app worked; Dashboard showed seeded KPIs.
  - `/api/gps/positions` → 18 vehicles, `source: DEMO_SIMULATOR`, counts 4 moving /
    10 stopped / 4 offline (relative to seed), disclaimer present.
  - Driver token on `/api/gps/positions` → HTTP 403.
- Browser checks on the built app: dashboard data, GPS map with 18 markers, DEMO GPS banner,
  filters, detail tabs (Detail / Riwayat Koordinat / Trip Replay / Event Kendaraan),
  Event GPS, Geofence and Perangkat GPS modals.
- Backend Docker image installs `openssl` (Prisma engine requirement on Alpine).

## Enhancement verification log (2026-11-23, dev stack)

- `cd backend && npm test` → **54 tests, 54 pass, 0 fail** (~17 s).
- `cd frontend && npm run build` → success.
- Notification bell: badge showed 18 unread (document + maintenance sweep); dropdown listed
  type badges/messages; "Tandai semua dibaca" cleared badge to 0 and disabled the action;
  `/notifications` page showed 18 items with per-type tabs and unread toggle.
- `/reports`: real KPIs from DB (13 bookings, 5 completed trips, 100% approval, 72%
  utilization, Rp 5.170.000 maintenance cost), 4 tables, CSV export with BOM + attachment
  header; driver token → 403 on summary and CSV (backend RBAC).
- Bookings calendar: month grid, status-toned pills, day panel, availability check returned
  10 vehicles / 9 drivers; created a 3-occurrence WEEKLY series → toast with first…last codes
  and "Seri berulang" tags on all three rows.
- Trips checklist: `PICKED_UP` attempt on an incomplete trip returned the 409-style notice
  listing 6 missing items; after checking all items the transition succeeded.
- Vehicles: "Dokumen" column with red/amber expiry badges; edit modal shows STNK + insurance
  dates.
- GPS: "Deviasi Rute" KPI = 1, ETA chips per vehicle, deviation banner in detail (2.4 km,
  unacknowledged, DEMO note), Event GPS modal with acknowledgement filter; acknowledging an
  event reduced the unacknowledged count 14 → 13 and toggled the "Dikonfirmasi" state.

## UX phases 1–3 verification log (2026-11-23, dev stack)

Implemented on top of the existing design system (`frontend/src/polish.css` stays the last
stylesheet layer; no framework swap, brand palette kept).

- **Phase 1 — interaction fundamentals:** command palette (`Ctrl/⌘+K`, navigated to
  Kendaraan from "kendaraan"), lazy-loaded routes with Suspense, skeleton loaders, empty
  states with CTA, inline form validation (empty vehicle form showed
  "Nomor Polisi minimal 3 karakter."), unsaved-changes guard driven by a JSON baseline
  (Escape with untouched form closes silently), undo-delete toast (8 s delayed delete),
  booking table with result count ("34 dari 34 booking"), column picker, pagination
  (1–25 of 34), row selection and bulk-approve bar.
- **Phase 2 — role dashboards & mobile:** dashboard was already role-scoped (driver personal
  view vs requester vs staff); PWA manifest, SVG icons, service worker (prod-only
  registration, network-first navigation, `/offline.html` fallback, `/api/*` never cached),
  mobile bottom navigation under 980 px, GPS page consumes SSE `positions` stream,
  series-wide cancel via `PATCH /api/bookings/series/:seriesId/cancel` (permission enforced
  server-side), vehicle checklist template editor (saved through `checklistItems`),
  per-user notification preferences in Profil (`POST /api/users/me/notification-prefs`).
- **Phase 3 — session & resilience:** login now sets the httpOnly `fleet_session` cookie
  (verified: `Set-Cookie` on login, `/api/auth/me` 200 without Bearer), Bearer still works
  for tests, session-expired modal + `/auth/me` bootstrap, CSV **and** Excel export from
  Laporan (verified in-browser: `export.xls` → 200, `application/vnd.ms-excel`,
  `attachment; filename="laporan-bookings-20261025.xls"`, 10 KB; `export.csv` → 200
  `text/csv` with Indonesian headers), friendly 404 with dashboard/booking/palette actions,
  offline network banner, dark mode via `data-theme` tokens (verified light→dark→light,
  `--bg` #f4f6f9 ↔ #0f131a, persisted in `localStorage.fleet_theme`), keyboard shortcut
  overlay.
- PWA assets served with correct types: `manifest.webmanifest` (application/manifest+json),
  `sw.js` (text/javascript), `offline.html`, `icons/icon.svg` — all 200.
- `cd backend && npm test` → **59 tests, 59 pass** (5 new tests in `test/ux-phases.test.js`
  cover the httpOnly cookie session, notification preferences, series-wide cancel + RBAC,
  vehicle checklist templates, and Excel export); `cd frontend && npm run build` →
  success with PWA assets copied to `dist`.

## Area status

| Area | Status | Evidence / notes |
| --- | --- | --- |
| Authentication (JWT login/logout, bcrypt, password change) | PASS | `auth.test.js` |
| Server-side RBAC for all modules | PASS | `rbac.test.js`, `permissions.js` middleware; driver/crew get 403 on GPS and admin routes |
| Dashboard with real DB KPIs | PASS | role-scoped personal vs operations dashboards |
| Booking → approval/rejection → cancellation | PASS | reason required for rejection; employee scoping (`workflow.test.js`) |
| Dispatch, assignment, reassignment, trip lifecycle | PASS | conflict detection for vehicle/driver/capacity/expired SIM; timeline events |
| Vehicle, driver, vendor, route CRUD | PASS | validation, unique constraints, reference protection (409) |
| Maintenance lifecycle | PASS | planned → in progress → completed; vehicle status sync; blocks assignment |
| Audit log for key mutations | PASS | booking, trip, maintenance, master data, geofence, GPS device actions |
| User administration + profile | PASS | pagination/filtering, self-protection rules (`users.test.js`) |
| Relational demo seed (idempotent) | PASS | 13 users, vendors, 18 vehicles/drivers, bookings, trips, maintenance, GPS data |
| Migrations | PASS | `prisma migrate deploy` includes GPS migration `20260102000000_gps` |
| GPS Fleet Monitoring — live map (Leaflet + OSM) | PASS | pan/zoom, markers, popups, 18 vehicles, geofence circles |
| GPS — vehicle detail panel | PASS | DB-backed speed, coordinates, destination, driver, requester, device |
| GPS — trip history & coordinate history | PASS | 24 h window, limit control, chronological |
| GPS — trip replay | PASS | playback slider/interval, polyline trace, demo disclaimer |
| GPS — geofence management | PASS | CRUD + validation + duplicate name 409 + audit |
| GPS — GPS device management | PASS | CRUD, one device per vehicle, unique IMEI, audit |
| GPS — event & alerts | PASS | paginated, type/vehicle/text filters, Indonesian labels |
| GPS — ETA & route deviation | PASS | ETA status (on time/due soon/overdue) per active trip; deterministic deviation flagged at >1.5 km; demo-labeled |
| GPS — event acknowledgement | PASS | `gps:write` only, 404/409 handling, audit trail, unacknowledged counter/filter |
| GPS — simulation fidelity & honesty | PASS | route-consistent movement, `DEMO_SIMULATOR` source, persistent DEMO banner, no live-GPS claims |
| Notification center (in-app) | PASS | per-user list, unread badge per type, read/read-all, dedupe per user/day, bell + page |
| Document & SIM expiry reminders | PASS | STNK/insurance date fields + badges (≤30 days amber, expired red); sweep notifications; report columns |
| Reports & CSV export | PASS | summary KPIs, per-vehicle utilization/cost, department recap, maintenance; CSV + print layout; staff-only RBAC |
| Booking calendar & availability | PASS | month grid with status pills, day panel, availability check by time window/pax |
| Recurring / multi-day bookings | PARTIAL | DAILY/WEEKLY series (2–8) linked by `seriesId`; no series-wide edit/cancel |
| Pre-trip checklist gate | PASS | template + saved JSON per trip; API rejects `PICKED_UP` until complete (with missing-item list) |
| External notification delivery (email/SMS/WhatsApp/Telegram) | NOT IMPLEMENTED | In-app only; out of scope for this demo |
| Per-vehicle checklist templates | NOT IMPLEMENTED | Single generic template used for all vehicles |
| Docker Compose (db + api + web) | PASS | ports configurable; api runs generate → migrate → seed → server; healthchecks |
| Real GPS hardware/provider integration | NOT IMPLEMENTED | Explicitly out of scope; simulator is isolated behind `backend/src/lib/gps.js` for future swap |
| SSO, email/SMS/Telegram notifications | NOT IMPLEMENTED | Out of scope for this demo |
| Production hardening (TLS, secrets management, public deployment) | PARTIAL | Security headers, CSP, CORS allowlist, CSV injection guard and non-root API image added; still no TLS/secrets manager (local demo) |
| Calendar-wide dispatch optimization / concurrency locking | PARTIAL | Basic overlap/availability validation only |
| Real KCIC data / official records | NOT APPLICABLE | All data synthetic; UI labels DEMO everywhere |

## GPS acceptance criteria check

| Criterion | Result |
| --- | --- |
| Map can be panned and zoomed | Verified in browser |
| Vehicle markers clickable | Verified (popups + selects detail) |
| Filters work (status/ownership/driver/search) | Verified in browser and API tests |
| Vehicle detail matches database | Verified against API/DB rows |
| Simulated coordinates update periodically | Verified (speeds/positions changed between 8 s polls; simulator every 15 s) |
| No claim of real live GPS | DEMO banner, API `disclaimer`, `source: DEMO_SIMULATOR` |

## UI/UX polish & security audit (2026-11-23)

Design pass applied on the existing custom CSS system (no framework swap) through a single
last-loaded layer, `frontend/src/polish.css`, so the brand palette (#831d27) and page
markup stay untouched.

### UI/UX changes

- Sentence-case labels everywhere; removed tracked caps from eyebrows, table heads, nav
  captions, crumbs and badges (letter-spacing + uppercase removed).
- Visible `:focus-visible` ring on every interactive element (links, buttons, inputs,
  table scroll regions, sidebar items), plus an inline brand focus style for fields.
- Skip link ("Lewati ke konten utama") as the first tab stop; `<main>` is focusable.
- Modal: focus trap, initial focus, Escape to close, focus restore, body scroll lock,
  `aria-labelledby`, labelled close button.
- Mobile sidebar: backdrop is a real button, `aria-expanded`/`aria-controls`, Escape closes.
- Login: show/hide password toggle (`aria-pressed`, labelled), demo-account fillers reset it.
- Tables: sticky action column on desktop only (≥981 px); below that the table scrolls
  horizontally inside `.table-wrap` (page never scrolls sideways). Long cell text wraps at
  desktop; plates stay on one line on mobile. Row height compacted for 1440×900 fit
  (bookings measured 1090 px wide = 1090 px wrapper).
- Touch targets ≥44 px at ≤720 px; report KPI grid 3/2/1 columns by breakpoint; KPI values
  use tabular numerals and aligned tops.
- `prefers-reduced-motion` fallback for all animation/transition, `overflow-x: clip` on
  html/body, password field restructured outside `<label>` for valid interactive nesting.

### Security changes

| Item | Fix | Verification |
| --- | --- | --- |
| Missing browser hardening headers | nginx sends CSP, `X-Content-Type-Options`, `X-Frame-Options: DENY`, Referrer-Policy, Permissions-Policy, COOP/CORP; Express sends the same for dev/manual runs | `nginx:alpine nginx -t` → OK; headers confirmed via `curl -I` |
| XSS via injected scripts | CSP `script-src 'self'`; `connect-src 'self'`; `object-src 'none'`; `frame-ancestors 'none'`; Google Fonts and OSM tiles explicitly allowed | Headless Chrome loaded dashboard + GPS under nginx+CSP → **0 CSP violations** |
| Open CORS in dev/manual mode | `CORS_ORIGIN` now defaults to localhost allowlist (5180/5181/8090, 127.0.0.1 variants) instead of a permissive value | `backend/src/config.js` |
| CSV formula injection (opened in Excel) | Values starting with `= + @` (or `-` that is not a number) and tab/CR are prefixed with `'` before quoting | `backend/src/lib/csv.js`; export still valid CSV |
| Container runs as root | API image creates/chowns `/app` and runs `USER node` | Dockerfile reviewed; generate/migrate/seed still start at compose boot |
| Unvalidated asset caching | Hashed assets cached 1 year immutable; `index.html` no-store | `frontend/nginx.conf` |

### Residual risks (documented, accepted for a local demo)

- The session JWT now lives in an httpOnly, SameSite=Lax cookie (`Secure` in production), so
  client JS cannot read it; Bearer tokens remain for tests/tooling. Production still needs
  HTTPS/HSTS and externalized secrets.
- Login rate limiting is in-process memory (per IP+email), not shared across instances.
- No HSTS because local HTTP is used; enable behind TLS.
- Demo passwords (`Demo123!`) and the seeded JWT secret are not production credentials.

## Enhancement acceptance criteria check

| Criterion | Result |
| --- | --- |
| Notifications reach the right user only | Cross-user read attempt → 403 (`features.test.js`) |
| Document reminders appear when expiry ≤ 30 days or passed | Sweep creates per-vehicle STNK/insurance notifications; badges verified in vehicles table |
| Reports reflect DB data for a chosen range | KPIs recomputed per range; verified against seeded counts |
| CSV export is usable | `text/csv; charset=utf-8`, attachment filename, UTF-8 BOM, Indonesian headers |
| Calendar shows bookings per day and tones by status | Verified month grid + pills + day panel |
| Recurring booking creates linked occurrences | 3-row series with shared `seriesId`; tags in list |
| Checklist blocks start until complete | 409 with missing-item list, then transition allowed after save |
| GPS ETA/deviation/acknowledge visible and actionable | ETA chips, deviation KPI/banner, ack filter + confirm, audit written |
| Reports restricted server-side | Driver token → 403 on `/api/reports/summary` and `export.csv` |

## Honest caveats

- The GPS module is fully demo: coordinates are simulated locally and must never be read as
  real vehicle positions. ETA and deviation values are derived from the same simulator.
- Notifications are in-app only; document/maintenance reminders are generated by a
  read-triggered sweep (deduped per user/day), not a scheduled background job.
- Recurring bookings are independent rows sharing a `seriesId`; cancellation can be applied
  to the whole series in one action, but edits still apply per occurrence.
- Demo passwords (`Demo123!`) and the default JWT secret are for local evaluation only.
- Windows note: stop the API before `npx prisma generate` if Prisma reports locked files.
