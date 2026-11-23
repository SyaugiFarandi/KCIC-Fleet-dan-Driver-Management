# Project Scope & Architecture

## Applications

- Web operations console: dashboards, booking approval, dispatch, trips, GPS monitoring,
  fleet master data, maintenance, reports/CSV export, notification center, audit log, user
  administration.
- Employee portal: book a vehicle, track own bookings (role-scoped).
- Driver access: view and advance own assigned trips.

## Architecture

Browser (React/Vite) → Nginx (Docker) or Vite dev proxy → Express REST API → Prisma ORM → PostgreSQL.

- The API authenticates with JWT and authorizes every sensitive route with role permissions
  (`backend/src/lib/permissions.js`). Frontend menu visibility is convenience only, never a
  security boundary.
- All business transitions (booking decisions, dispatch conflicts, trip status, maintenance,
  GPS geofence/device changes) are validated and executed server-side with zod schemas.
- Key mutations write audit events (`AuditLog`).
- Docker Compose orchestrates PostgreSQL, API, and frontend.

## Data model (high level)

User, Vendor, Vehicle, Driver, Route, Booking, Trip, TripEvent, Maintenance, AuditLog,
Notification, GpsDevice, VehicleLocation, GpsEvent, Geofence.

GPS entities integrate with existing data instead of duplicating it:

- `GpsDevice` — one optional device per vehicle (`vehicleId` unique), IMEI unique.
- `VehicleLocation` — telemetry points linked to vehicle, optional device and trip.
- `GpsEvent` — alerts linked to vehicle, device, optional trip and geofence.
- `Geofence` — circular zones used by the simulator and geofence event generation.

## MVP business workflows

1. Employee submits a booking.
2. Authorized approver approves/rejects (rejection requires a reason).
3. Dispatcher/fleet assigns an available vehicle and driver; conflicts are rejected.
4. Driver completes the pre-trip checklist (service-side gate), then advances trip status.
5. Completed/cancelled trips release vehicle and driver.
6. Maintenance marks vehicles unavailable and blocks unsafe starts/assignments.
7. GPS simulator continuously records demo positions, geofence events, and alerts.
8. Booking decisions, trip assignments, GPS alerts, document expiry, and maintenance due feed
   the per-user in-app notification center.

## GPS monitoring module (DEMO)

- Map: Leaflet 1.9 + OpenStreetMap, dominant interactive map with status markers,
  geofence circles, vehicle side list, and counters (total/moving/stopped/offline).
- Vehicle detail: speed, coordinates, heading, destination, driver, requester, device.
- Coordinate history (default 24 h) and trip replay with playback slider.
- Filters: motion status, ownership, driver, free-text search (plate/destination/driver/vendor).
- Geofence management (create/edit/delete) and GPS device management (create/edit/delete).
- GPS event & alerts browser with type/vehicle/text filters and acknowledgement
  (`gps:write`, audited).
- ETA per active trip (on time/due soon/overdue) and deterministic route-deviation alerts
  (>1.5 km off corridor), both derived from the simulator and labeled DEMO.
- Simulation: route-interpolated movement along the Whoosh corridor; deterministic shape;
  source tagged `DEMO_SIMULATOR`; persistent DEMO banner; no claim of real live GPS.

## Demo-only limitations

- Seed dataset is synthetic; no KCIC official data.
- No real GPS hardware/provider integration, SSO, email/SMS/Telegram, or vendor billing.
- Dispatch conflict detection is basic availability/overlap validation, not a solver.
- UI is a functional MVP console, not final brand-approved design.
- Single-tenant localhost configuration; not hardened for public deployment.
