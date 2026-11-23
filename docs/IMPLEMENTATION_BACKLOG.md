# Implementation Backlog — Enterprise Upgrade

Working rules: implement directly in this project, extend (never replace) existing modules,
server-side RBAC for every endpoint, DEMO labels for synthetic data, no fake ML or invented
contracts/credentials. Status is updated as work lands.

## Phase A — Schema batch 1 + permissions (foundation)

- [ ] Migration `enterprise_batch1`:
  - `InspectionTemplate`, `Inspection`, `InspectionItem`, `Defect`
  - `FuelTransaction`, `FuelPriceReference`
  - `VendorContract`, `SlaDefinition`
  - `RoutePoint`; `Route.restrictions` JSONB
  - `Booking.priority` (NORMAL|EMERGENCY), `Booking.emergencyReason`
  - `Vehicle.serviceIntervalKm`, `Vehicle.serviceIntervalDays`
  - `Maintenance.kind`, `Maintenance.priority`, `Maintenance.requestedById`
  - `User.dashboardPrefs` JSONB
- [ ] Permissions: `inspection:read|write`, `fuel:read|write`, `vendors:sla`, extend role matrix.
- [ ] Seed extensions (idempotent): inspection templates, sample inspections/defects, fuel
  transactions + price reference, vendor contracts + SLA definitions, route points, one
  emergency booking.

Acceptance: migration applies cleanly on `fleet_demo` and `fleet_test`; seed re-runs without
duplicates; existing 59 tests still pass.

## Phase B — Fuel Management (end-to-end)

- API `/api/fuel`:
  - `GET /` list (filters: vehicle, driver, date range, anomaly) paginated
  - `POST /` create (vehicle, liters, cost, odometer, payment method, card ref)
  - `PATCH /:id/review` anomaly review (APPROVED|FLAGGED + note)
  - `GET /summary` totals, cost, km/L per vehicle, monthly trend, anomaly list
  - `GET /price-reference`, `PATCH /price-reference` (single active reference)
- Anomaly heuristics: consumption deviation > 25% vs vehicle median, duplicate liters within
  1 h, odometer regression — stored as `anomalyStatus` + reason, never auto-rejected.
- RBAC: `fuel:read` staff roles; `fuel:write` admin/fleet/officer; drivers submit only own.
- UI: menu **BBM (Fuel)** with KPI cards, transactions table, filter, create modal, review
  action, price reference editor, efficiency table.
- Tests: CRUD validation, anomaly flags, RBAC, summary math, price reference RBAC.

## Phase C — Digital Inspection (end-to-end)

- API `/api/inspections`:
  - Templates: list/create/update (items with key/label/critical), vehicle template fallback.
  - Runs: create draft for vehicle/trip with type PRE_TRIP|POST_TRIP|RELEASE; save items;
    complete → PASS/DEFECTS/FAIL; critical unchecked → creates CRITICAL defect.
  - Defects: list, update status (OPEN → IN_REPAIR → RESOLVED), audit.
  - `GET /summary`: pass rate, open defects, critical count.
- Dispatch block: assignment rejects vehicles with open CRITICAL/HIGH defects per policy
  (config constant) and requires no failed RELEASE inspection in the last N days? (policy:
  open CRITICAL/HIGH only; documented).
- UI: menu **Inspeksi** with templates and runs, defect queue, mobile-friendly forms.
- Tests: template defaults, completion outcomes, defect creation, dispatch block, RBAC.

## Phase D — Predictive Maintenance + work orders

- `GET /api/maintenance/predictions`: per vehicle next service from interval km/days,
  average daily km (trips/fuel odometer), status OVERDUE/DUE_SOON/OK with formula fields.
- Extend Maintenance with kind/priority/requester; UI adds "Ajukan perbaikan" flow and
  predictions panel; link defects to maintenance.
- Tests: prediction math, request validation, RBAC.

## Phase E — Vendor SLA

- API `/api/vendor-contracts`: CRUD (vendor, number, period, value, status) + SLA definitions.
- Scorecard: computed per vendor from trips (on-time start, completion) and maintenance
  response time; returns metrics vs target, exceptions.
- Contract expiry alerts through notification sweep.
- UI: Vendor page tabs (registry, contracts, SLA scorecard, exceptions).
- Tests: contract validation, scorecard math, expiry alert dedupe, RBAC.

## Phase F — Route points, estimation, recommendations

- `RoutePoint` CRUD inside Routes page; `Route.restrictions` fields.
- `POST /api/routes/estimate` haversine distance + duration at configurable speed; returns
  points and restriction warnings; dispatcher makes the final choice (no auto-assign).
- Tests: distance math, validation, RBAC.

## Phase G — Emergency transport

- Booking priority + emergency reason (required), faster approval path (same endpoint,
  priority flag), badges/filters in list and calendar, emergency KPI in reports.
- UI toggle in booking form, filter chip, detail banner.
- Tests: validation, filter, RBAC, report count.

## Phase H — Fleet Intelligence

- Reports extensions: trip performance (on-time %), driver performance, cost per km
  (maintenance + fuel), maintenance trend, fuel efficiency, vendor performance summary.
- New **Fleet Intelligence** page: KPI library (formula, source, period, refresh time),
  performance tables, data quality monitor (`/api/intelligence/data-quality`: missing docs,
  stale GPS, open critical defects, contracts expiring, fuel anomalies).
- Dashboard widgets preference (`User.dashboardPrefs`) with toggle/reorder persisted.
- Tests: KPI math on seeded data, RBAC, data-quality checks.

## Phase I — Rule-based fleet assistant

- `POST /api/assistant/query` (read-only): intents for utilization, cost, maintenance due,
  driver performance, vendor SLA, daily summary. Answers cite data rows and period; every
  query is RBAC-filtered; no approvals/assignments/status changes.
- UI: **Asisten** page with suggested questions and structured answers.
- Tests: intent routing, RBAC scoping, read-only guarantee (no audit mutations other than
  optional query log).

## Phase J — Driver PWA & offline queue

- Driver-focused home (assignments, next trip, quick actions) inside existing dashboard
  routing; mobile-first layout.
- Offline queue (`localStorage`) for trip status updates, inspections, fuel submissions with
  sync status chip and retry; never cache authenticated API responses in the SW.
- Tests: queue serialization + sync endpoint behavior (unit-level).

## Phase K — Menu grouping, docs, QA, commit

- Sidebar groups: Workspace / Operations / Intelligence / Governance; no duplicate menus.
- Update README, AUDIT_REPORT, new docs; browser QA desktop+mobile, dark mode.
- Run full tests + build; local commit. No push without explicit approval.

## Deferred / needs external configuration

- Real GPS devices, fuel cards, contract documents, AI provider keys, photo storage.
  Adapters and UI entry points stay configuration-only; never claimed as active integrations.
- True DB-level concurrency control (advisory locks) — verify and document before claiming.
