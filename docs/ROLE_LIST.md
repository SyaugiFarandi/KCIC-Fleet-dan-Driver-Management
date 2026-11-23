# Demo roles & server-side permissions

Roles: `SYSTEM_ADMIN`, `FLEET_MANAGER`, `OPERATIONAL_MANAGER`, `DISPATCHER`,
`TRANSPORT_COORDINATOR`, `FLEET_OFFICER`, `DRIVER_COORDINATOR`, `MAINTENANCE_OFFICER`,
`VENDOR_MANAGER`, `DRIVER`, `CREW_EMPLOYEE`.

Authorization is enforced by API middleware (`requirePermission`) for every sensitive route.
Hiding a menu in the frontend is convenience only; requests are rejected regardless of UI.

| Permission | Roles |
| --- | --- |
| `users:manage` | SYSTEM_ADMIN |
| `audit:read` | SYSTEM_ADMIN, FLEET_MANAGER, OPERATIONAL_MANAGER |
| `vehicles:read` | all staff roles |
| `vehicles:write` | SYSTEM_ADMIN, FLEET_MANAGER, FLEET_OFFICER |
| `vehicles:delete` | SYSTEM_ADMIN, FLEET_MANAGER |
| `drivers:read` | all staff roles |
| `drivers:write` | SYSTEM_ADMIN, FLEET_MANAGER, DRIVER_COORDINATOR |
| `drivers:delete` | SYSTEM_ADMIN, FLEET_MANAGER |
| `vendors:read` | all staff roles |
| `vendors:write` | SYSTEM_ADMIN, FLEET_MANAGER, VENDOR_MANAGER |
| `vendors:delete` | SYSTEM_ADMIN, FLEET_MANAGER |
| `routes:read` | all staff roles |
| `routes:write` | SYSTEM_ADMIN, FLEET_MANAGER, TRANSPORT_COORDINATOR, FLEET_OFFICER |
| `routes:delete` | SYSTEM_ADMIN, FLEET_MANAGER |
| `bookings:read:all` | all staff roles |
| `bookings:decide` | SYSTEM_ADMIN, FLEET_MANAGER, OPERATIONAL_MANAGER, TRANSPORT_COORDINATOR |
| `bookings:delete` | SYSTEM_ADMIN |
| `trips:read:all` | all staff roles |
| `trips:assign` | SYSTEM_ADMIN, FLEET_MANAGER, DISPATCHER, TRANSPORT_COORDINATOR |
| `trips:update:any` | SYSTEM_ADMIN, FLEET_MANAGER, OPERATIONAL_MANAGER, DISPATCHER, TRANSPORT_COORDINATOR |
| `maintenance:read` | all staff roles |
| `maintenance:write` | SYSTEM_ADMIN, FLEET_MANAGER, MAINTENANCE_OFFICER, FLEET_OFFICER |
| `maintenance:delete` | SYSTEM_ADMIN, FLEET_MANAGER |
| `gps:read` | all staff roles (DRIVER and CREW_EMPLOYEE get 403) |
| `gps:write` | SYSTEM_ADMIN, FLEET_MANAGER, FLEET_OFFICER (geofence, device, event acknowledge) |
| `reports:read` | all staff roles (summary + CSV; DRIVER and CREW_EMPLOYEE get 403) |

"Staff" = every role except `DRIVER` and `CREW_EMPLOYEE`.

Additional scoping rules:

- `CREW_EMPLOYEE` only sees their own bookings and can only cancel/edit their own pending ones.
- `DRIVER` only sees trips assigned to their own driver profile and can only advance the
  status of those trips.
- Geofence and GPS device mutations are audited (`GEOFENCE_*`, `GPS_DEVICE_*`).
