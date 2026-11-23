import { prisma } from '../db.js';
import { ROLES } from './permissions.js';
import { publishNotification } from './events.js';

const STAFF_ROLES = ROLES.filter((role) => role !== 'DRIVER' && role !== 'CREW_EMPLOYEE');

export const NOTIFICATION_TYPE_LABELS = {
  BOOKING: 'Booking',
  TRIP: 'Perjalanan',
  GPS_ALERT: 'Peringatan GPS',
  DOCUMENT: 'Dokumen',
  MAINTENANCE_DUE: 'Jadwal perawatan',
};

export const NOTIFICATION_TYPES = Object.keys(NOTIFICATION_TYPE_LABELS);

export const DEFAULT_NOTIFICATION_PREFS = { types: NOTIFICATION_TYPES };

export function enabledNotificationTypes(user) {
  const types = user?.notificationPrefs?.types;
  if (!Array.isArray(types)) return NOTIFICATION_TYPES;
  return types.filter((type) => NOTIFICATION_TYPES.includes(type));
}

const GPS_ALERT_EVENT_TYPES = new Set([
  'OVERSPEED',
  'ROUTE_DEVIATION',
  'GEOFENCE_ENTER',
  'GEOFENCE_EXIT',
  'DEVICE_OFFLINE',
  'IDLE',
  'HARSH_BRAKING',
]);

const DAY_MS = 24 * 60 * 60 * 1000;

export async function notify({ userId, type, title, message, link = null }) {
  if (!userId) return null;
  try {
    const item = await prisma.notification.create({ data: { userId, type, title, message, link } });
    publishNotification([userId]);
    return item;
  } catch (err) {
    console.error('[notify] failed to create notification', type, err.message);
    return null;
  }
}

export async function notifyStaff({ type, title, message, link = null }) {
  try {
    const staff = await prisma.user.findMany({
      where: { active: true, role: { in: STAFF_ROLES } },
      select: { id: true },
    });
    if (!staff.length) return 0;
    await prisma.notification.createMany({
      data: staff.map((user) => ({ userId: user.id, type, title, message, link })),
    });
    publishNotification(staff.map((user) => user.id));
    return staff.length;
  } catch (err) {
    console.error('[notify] failed to broadcast staff notification', type, err.message);
    return 0;
  }
}

/** Broadcasts a GPS alert to all staff accounts. Demo telemetry, not a real provider. */
export async function notifyGpsEvent(event) {
  if (!event || !GPS_ALERT_EVENT_TYPES.has(event.type)) return;
  const vehicle = event.vehicle ?? (await prisma.vehicle.findUnique({ where: { id: event.vehicleId }, select: { plateNumber: true } }));
  if (!vehicle) return;
  const label = event.type === 'ROUTE_DEVIATION' ? 'Deviasi rute' : event.type === 'OVERSPEED' ? 'Melebihi kecepatan' : event.type.replaceAll('_', ' ').toLowerCase();
  await notifyStaff({
    type: 'GPS_ALERT',
    title: `${vehicle.plateNumber}: ${label}`,
    message: event.message,
    link: `/gps?vehicle=${event.vehicleId}`,
  });
}

function daysUntil(date, now = Date.now()) {
  return Math.ceil((new Date(date).getTime() - now) / DAY_MS);
}

function startOfDay(now = new Date()) {
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);
  return start;
}

/**
 * Generates documents/maintenance reminders for staff users. Deduplicated per
 * day and per title so repeated dashboard/notification polling is idempotent.
 */
export async function refreshUserNotifications(user) {
  if (!STAFF_ROLES.includes(user.role)) return 0;
  const now = new Date();
  const horizon = new Date(now.getTime() + 30 * DAY_MS);

  const [vehicles, drivers, maintenance, existing] = await Promise.all([
    prisma.vehicle.findMany({
      where: {
        status: { not: 'INACTIVE' },
        OR: [{ stnkExpiry: { not: null, lte: horizon } }, { insuranceExpiry: { not: null, lte: horizon } }],
      },
      select: { id: true, plateNumber: true, stnkExpiry: true, insuranceExpiry: true },
    }),
    prisma.driver.findMany({
      where: { active: true, licenseExpiry: { lte: horizon } },
      select: { id: true, name: true, licenseNumber: true, licenseExpiry: true },
    }),
    prisma.maintenance.findMany({
      where: { status: 'PLANNED', scheduledAt: { lte: new Date(now.getTime() + 3 * DAY_MS) } },
      include: { vehicle: { select: { id: true, plateNumber: true } } },
      orderBy: { scheduledAt: 'asc' },
    }),
    prisma.notification.findMany({
      where: { userId: user.id, type: { in: ['DOCUMENT', 'MAINTENANCE_DUE'] }, createdAt: { gte: startOfDay(now) } },
      select: { title: true },
    }),
  ]);

  const seen = new Set(existing.map((n) => n.title));
  const pending = [];

  const pushDocument = (title, expiry, name, link) => {
    if (seen.has(title)) return;
    const days = daysUntil(expiry, now.getTime());
    pending.push({
      userId: user.id,
      type: 'DOCUMENT',
      title,
      message:
        days < 0
          ? `${name} sudah kedaluwarsa ${Math.abs(days)} hari lalu. Segera perbarui dokumen.`
          : `${name} akan habis dalam ${days === 0 ? 'hari ini' : `${days} hari`} (${new Date(expiry).toLocaleDateString('id-ID')}).`,
      link,
    });
    seen.add(title);
  };

  for (const vehicle of vehicles) {
    if (vehicle.stnkExpiry) {
      pushDocument(`STNK ${vehicle.plateNumber}`, vehicle.stnkExpiry, `STNK ${vehicle.plateNumber}`, `/vehicles?q=${encodeURIComponent(vehicle.plateNumber)}`);
    }
    if (vehicle.insuranceExpiry) {
      pushDocument(`Asuransi ${vehicle.plateNumber}`, vehicle.insuranceExpiry, `Asuransi ${vehicle.plateNumber}`, `/vehicles?q=${encodeURIComponent(vehicle.plateNumber)}`);
    }
  }
  for (const driver of drivers) {
    pushDocument(`SIM ${driver.name}`, driver.licenseExpiry, `SIM ${driver.name} (${driver.licenseNumber})`, '/drivers');
  }
  for (const item of maintenance) {
    const title = `Perawatan ${item.vehicle.plateNumber}: ${item.title}`;
    if (seen.has(title)) continue;
    const days = daysUntil(item.scheduledAt, now.getTime());
    pending.push({
      userId: user.id,
      type: 'MAINTENANCE_DUE',
      title,
      message:
        days < 0
          ? `Jadwal perawatan sudah lewat ${Math.abs(days)} hari dan belum dimulai.`
          : `Jadwal perawatan ${days === 0 ? 'hari ini' : `dalam ${days} hari`} (${new Date(item.scheduledAt).toLocaleDateString('id-ID')}).`,
      link: '/maintenance',
    });
    seen.add(title);
  }

  if (!pending.length) return 0;
  try {
    await prisma.notification.createMany({ data: pending });
    publishNotification([user.id]);
    return pending.length;
  } catch (err) {
    console.error('[notify] failed to create reminder sweep', err.message);
    return 0;
  }
}
