# Enterprise modules (phases A–K)

Reference for the Enterprise Fleet & Driver Management upgrade built on top of the original
localhost demo. Everything here is **DEMO data and rule-based logic** — no KCIC production
system, fuel card, contract document, hardware or AI provider is integrated.

## Navigation groups

| Group | Menus (staff) |
| --- | --- |
| Workspace | Dashboard, Booking, Transport Darurat, Perjalanan, Notifikasi, Profil |
| Operations | GPS Monitoring, Kendaraan, Driver, Vendor, SLA Vendor, Rute, Inspeksi Kendaraan, Maintenance, Bahan Bakar |
| Intelligence | Laporan, Fleet Intelligence |
| Governance | Audit Log, Fleet Assistant, Pengguna |

Drivers see only Workspace: `Tugas Saya` (`/driver`), Perjalanan, Notifikasi, Profil — in the
sidebar and in the 4-item mobile bottom bar. Menus are hidden as convenience only; every
endpoint re-checks permissions server-side (`backend/src/lib/permissions.js`).

## Modules

| Module | Page | API | Permissions |
| --- | --- | --- | --- |
| Fuel management | `/fuel` | `GET/POST /api/fuel`, `GET /api/fuel/summary`, `GET /api/fuel/prices`, `PATCH /api/fuel/:id/review`, `PATCH /api/fuel/prices/:fuelType` | `fuel:read`, `fuel:write` (driver submissions allowed for own trips), `fuel:review` |
| Digital inspection | `/inspection` | `GET/POST /api/inspections`, `GET /api/inspections/summary`, `GET /api/inspections/templates`, `POST/PATCH /api/inspections/templates`, `PATCH /api/inspections/:id/items`, `PATCH /api/inspections/:id/complete`, `GET /api/defects` | `inspection:read`, `inspection:write` (driver: own trips), `inspection:template` |
| Predictive maintenance & work orders | `/maintenance` | `GET /api/maintenance/predictions`, `POST /api/maintenance`, `PATCH /api/maintenance/:id`, `PATCH /api/maintenance/:id/start`, `PATCH /api/maintenance/:id/complete`, `PATCH /api/maintenance/:id/cancel` | `maintenance:read`, `maintenance:write`, `maintenance:delete` |
| Vendor SLA | `/sla` | `GET /api/sla/overview`, `POST /api/sla/contracts`, `PATCH /api/sla/contracts/:id` | `vendors:sla` |
| Route recommendations | `/routes` | `GET /api/routes`, `GET /api/routes/recommendations?bookingId=…`, `PUT /api/routes/:id/points` | `routes:read`, `routes:optimize`, `routes:write` |
| Emergency transport | `/emergency` | `GET /api/emergency`, `GET /api/emergency/summary`, `POST /api/emergency/requests`, `PATCH /api/emergency/:id/decision`, `PATCH /api/emergency/:id/cancel` | `emergency:read`, `emergency:decide` (create: staff/crew employee; cancel: requester or decider) |
| Fleet Intelligence | `/intelligence` | `GET /api/intelligence/kpis`, `GET /api/intelligence/data-quality`, `PUT /api/intelligence/widgets` | `intelligence:read` |
| Fleet Assistant | `/assistant` | `GET /api/assistant/suggestions`, `POST /api/assistant/query` | `assistant:ask` |
| Driver PWA | `/driver` | `GET /api/trips` (server scopes drivers to their own trips), `PATCH /api/trips/:id/status`, `POST /api/fuel`, `POST /api/inspections` | driver role + own-trip ownership checks |

## Business rules

### Fuel

- Staff may log a transaction for any vehicle; a driver must select one of **their own trips**
  and can only use the fuel-card payment method.
- Reference prices live in `FuelPrice`; an explicit price is accepted but flagged when it is
  more than 15% above the reference.
- Additional anomaly rules: volume above 100 L, odometer not higher than the previous record
  for that vehicle.
- Flagged transactions require `fuel:review` to APPROVE (accepted with a note) or CLEAR
  (false alarm); every decision is audited.
- Summary computes liters, cost, flagged/approved counts, per-vehicle km/L and cost/km from
  consecutive odometer readings, and daily cost trend.

### Digital inspection

- Templates are named, categorized (PRE_TRIP/POST_TRIP/RELEASE/GENERAL) and hold 1–30 items
  with unique keys and a `critical` flag.
- Starting an inspection copies the template items as unchecked rows on a DRAFT inspection.
- Completing it marks PASSED (all checked), DEFECTS (non-critical unchecked) or FAILED (any
  critical unchecked). Each unchecked item creates one defect (CRITICAL severity when the
  item is critical) inside a transaction.
- Critical failures notify Fleet Manager, Maintenance Officer and Operational Manager.
- Drivers see and edit only inspections they started; staff see all.

### Predictive maintenance

- `GET /api/maintenance/predictions` is advisory and rule-based: service interval exceeded by
  odometer, time since last completed service, open defects (severity-weighted), and vehicle
  status / odometer staleness. Each prediction lists human-readable reasons.
- Work orders have type (PREVENTIVE/CORRECTIVE), priority, schedule and cost; starting one sets
  the vehicle to `IN_REPAIR` (blocking dispatch), completing returns it to `AVAILABLE` and
  resolves the linked defect. All transitions are audited and notify the fleet team.

### Vendor SLA

- Contracts carry vendor, number, period, monthly value, status and SLA definitions
  (ON_TIME_DEPARTURE, TRIP_COMPLETION, AVAILABILITY, RESPONSE_TIME) with targets entered by
  the user. The system never invents a target, value or document.
- The scorecard is computed for the selected date range from trips (on-time start with a
  15-minute tolerance, completion ratio, assignment→acceptance response time) and vehicles
  (availability share). Contracts without evidence return `value: null` and a NO_DATA
  exception instead of a fabricated score.
- Additional exceptions: metric breach, missing definitions, expiring within 30 days,
  expired-but-ACTIVE, inactive vendor.

### Route recommendations

- `GET /api/routes/recommendations?bookingId=…` ranks active routes for the booking (capacity,
  restriction penalty, duration) and returns the reasons. It never assigns anything — the
  dispatcher still creates the trip explicitly.

### Emergency transport

- Creates a `priority: EMERGENCY` booking with a mandatory reason (min. 10 chars) and
  optional route or origin/destination pair.
- Approvers with `emergency:decide` approve/reject (rejection reason required); the requester
  is notified. Assignment uses the normal dispatch flow, so all conflict checks still apply.
- Summary exposes pending approval, awaiting assignment, dispatched, active, completed,
  average approval/dispatch minutes and oldest pending age, with a DEMO note.

### Fleet Intelligence

- 14 KPIs grouped as fleet, operations, cost and compliance; each returns its formula,
  data source, period, value, target status, and a DEMO disclaimer.
- Data-quality monitor runs 12 checks (missing documents, stale GPS, open critical defects,
  contracts expiring, fuel anomalies, unassigned approved bookings, etc.) and returns a
  numeric score plus the failing checks.
- Dashboard widgets are stored per user (`/api/intelligence/widgets`) and rendered on the
  dashboard with their own status badges.

### Fleet Assistant

- Deterministic intent routing over RBAC-scoped data; the response includes the intent,
  citations (rows/period) and `readOnly: true`. It cannot approve, assign or mutate anything
  and makes no external model call.

### Driver PWA and offline queue

- `/driver` lists today's assignments, next trip, quick status actions, inspection and fuel
  launch points, and an online/offline chip with the pending queue count.
- Trip status updates that fail while offline are stored in `localStorage`
  (`fleet_offline_queue`) and flushed on reconnect. The service worker never caches `/api/*`
  responses; conflicts (404/409) drop the queued item with a toast instead of retrying.

## Verification

- `backend/test/enterprise.test.js` (8 tests) exercises the RBAC, validation and happy paths
  for every module above; the full suite is 67 tests.
- Browser QA: desktop 1440×900, mobile 390×844, light and dark themes; screenshots captured
  for the grouped sidebar, drawer and driver portal.

## Explicitly not implemented

- Real GPS devices, fuel cards, contract documents, photo storage, AI/LLM keys — adapters and
  UI entry points stay manual/configuration-only.
- Database-level advisory locking for concurrent dispatch (per-assignment validation exists).
- Series-wide editing of recurring bookings (cancellation is series-wide).
