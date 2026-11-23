export const ROLES = [
  'SYSTEM_ADMIN',
  'FLEET_MANAGER',
  'OPERATIONAL_MANAGER',
  'DISPATCHER',
  'TRANSPORT_COORDINATOR',
  'FLEET_OFFICER',
  'DRIVER_COORDINATOR',
  'MAINTENANCE_OFFICER',
  'VENDOR_MANAGER',
  'DRIVER',
  'CREW_EMPLOYEE',
];

export const ROLE_LABELS = {
  SYSTEM_ADMIN: 'System Administrator',
  FLEET_MANAGER: 'Fleet Manager',
  OPERATIONAL_MANAGER: 'Operational Manager',
  DISPATCHER: 'Dispatcher',
  TRANSPORT_COORDINATOR: 'Transport Coordinator',
  FLEET_OFFICER: 'Fleet Officer',
  DRIVER_COORDINATOR: 'Driver Coordinator',
  MAINTENANCE_OFFICER: 'Maintenance Officer',
  VENDOR_MANAGER: 'Vendor Manager',
  DRIVER: 'Driver',
  CREW_EMPLOYEE: 'Crew Employee',
};

const STAFF = ROLES.filter((role) => role !== 'DRIVER' && role !== 'CREW_EMPLOYEE');

export const PERMISSIONS = {
  'users:manage': ['SYSTEM_ADMIN'],
  'audit:read': ['SYSTEM_ADMIN', 'FLEET_MANAGER', 'OPERATIONAL_MANAGER'],

  'vehicles:read': STAFF,
  'vehicles:write': ['SYSTEM_ADMIN', 'FLEET_MANAGER', 'FLEET_OFFICER'],
  'vehicles:delete': ['SYSTEM_ADMIN', 'FLEET_MANAGER'],

  'drivers:read': STAFF,
  'drivers:write': ['SYSTEM_ADMIN', 'FLEET_MANAGER', 'DRIVER_COORDINATOR'],
  'drivers:delete': ['SYSTEM_ADMIN', 'FLEET_MANAGER'],

  'vendors:read': STAFF,
  'vendors:write': ['SYSTEM_ADMIN', 'FLEET_MANAGER', 'VENDOR_MANAGER'],
  'vendors:delete': ['SYSTEM_ADMIN', 'FLEET_MANAGER'],

  'routes:read': STAFF,
  'routes:write': ['SYSTEM_ADMIN', 'FLEET_MANAGER', 'TRANSPORT_COORDINATOR', 'FLEET_OFFICER'],
  'routes:delete': ['SYSTEM_ADMIN', 'FLEET_MANAGER'],

  'bookings:read:all': STAFF,
  'bookings:decide': ['SYSTEM_ADMIN', 'FLEET_MANAGER', 'OPERATIONAL_MANAGER', 'TRANSPORT_COORDINATOR'],
  'bookings:delete': ['SYSTEM_ADMIN'],

  'trips:read:all': STAFF,
  'trips:assign': ['SYSTEM_ADMIN', 'FLEET_MANAGER', 'DISPATCHER', 'TRANSPORT_COORDINATOR'],
  'trips:update:any': ['SYSTEM_ADMIN', 'FLEET_MANAGER', 'OPERATIONAL_MANAGER', 'DISPATCHER', 'TRANSPORT_COORDINATOR'],

  'maintenance:read': STAFF,
  'maintenance:write': ['SYSTEM_ADMIN', 'FLEET_MANAGER', 'MAINTENANCE_OFFICER', 'FLEET_OFFICER'],
  'maintenance:delete': ['SYSTEM_ADMIN', 'FLEET_MANAGER'],

  'gps:read': STAFF,
  'gps:write': ['SYSTEM_ADMIN', 'FLEET_MANAGER', 'FLEET_OFFICER'],

  'reports:read': STAFF,
};

export function can(role, permission) {
  return Boolean(role && PERMISSIONS[permission]?.includes(role));
}

export function isStaff(role) {
  return STAFF.includes(role);
}

export const roleLabel = (role) => ROLE_LABELS[role] || role || '';
