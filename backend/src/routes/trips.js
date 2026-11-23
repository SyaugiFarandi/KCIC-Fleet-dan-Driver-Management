import express from 'express';
import { z } from 'zod';
import { prisma } from '../db.js';
import { HttpError, asyncRoute, pagination, paged } from '../lib/http.js';
import { can, requirePermission } from '../lib/permissions.js';
import { writeAudit } from '../lib/audit.js';
import { assertTransition, TRIP_TRANSITIONS, TRIP_STATUS_LABELS } from '../lib/workflow.js';
import { availabilityFor, assertAssignable, lockAssignmentResources } from '../lib/assignments.js';
import { refreshDriverAvailability, refreshVehicleStatus } from '../lib/resourceStatus.js';
import { notify } from '../lib/notifications.js';
import { TRIP_CHECKLIST_ITEMS, checklistItemsFor } from '../lib/checklist.js';

const router = express.Router();

const tripInclude = {
  booking: {
    include: {
      requester: { select: { id: true, name: true, email: true } },
      route: true,
    },
  },
  vehicle: { include: { vendor: { select: { id: true, name: true } } } },
  driver: {
    include: {
      vendor: { select: { id: true, name: true } },
      user: { select: { id: true, email: true } },
    },
  },
  assignedBy: { select: { id: true, name: true } },
};

const detailInclude = {
  ...tripInclude,
  events: {
    include: { actor: { select: { id: true, name: true } } },
    orderBy: { createdAt: 'asc' },
  },
};

function scopeFor(user) {
  if (user.role === 'DRIVER') return { driver: { is: { userId: user.id } } };
  return {};
}

export function canReadTrip(user, trip) {
  if (user.role === 'DRIVER') return trip.driver?.userId === user.id;
  return can(user.role, 'trips:read:all');
}

const assignSchema = z.object({
  bookingId: z.string().trim().min(1, 'Booking wajib dipilih'),
  vehicleId: z.string().trim().min(1, 'Kendaraan wajib dipilih'),
  driverId: z.string().trim().min(1, 'Driver wajib dipilih'),
  notes: z.string().trim().max(300).optional(),
});

const reassignSchema = z.object({
  vehicleId: z.string().trim().min(1, 'Kendaraan wajib dipilih'),
  driverId: z.string().trim().min(1, 'Driver wajib dipilih'),
  notes: z.string().trim().max(300).optional(),
});

const statusSchema = z.object({
  status: z.enum(['SCHEDULED', 'DRIVER_ACCEPTED', 'PICKED_UP', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED']),
  note: z.string().trim().max(300).optional(),
});

router.get('/', asyncRoute(async (req, res) => {
  if (!can(req.user.role, 'trips:read:all') && req.user.role !== 'DRIVER') {
    throw new HttpError(403, 'Anda tidak memiliki akses ke data perjalanan');
  }
  const page = pagination(req);
  const { q, status, from, to } = req.query;
  const statuses = status ? String(status).split(',').filter(Boolean) : [];
  const where = {
    ...scopeFor(req.user),
    ...(statuses.length ? { status: { in: statuses } } : {}),
    ...(q
      ? {
          OR: [
            { booking: { is: { code: { contains: q, mode: 'insensitive' } } } },
            { booking: { is: { destination: { contains: q, mode: 'insensitive' } } } },
            { vehicle: { is: { plateNumber: { contains: q, mode: 'insensitive' } } } },
            { driver: { is: { name: { contains: q, mode: 'insensitive' } } } },
          ],
        }
      : {}),
    ...(from || to
      ? {
          booking: {
            is: {
              departureAt: {
                ...(from ? { gte: new Date(from) } : {}),
                ...(to ? { lte: new Date(to) } : {}),
              },
            },
          },
        }
      : {}),
  };
  const [items, total] = await Promise.all([
    prisma.trip.findMany({ where, include: tripInclude, orderBy: { assignedAt: 'desc' }, skip: page.skip, take: page.take }),
    prisma.trip.count({ where }),
  ]);
  res.json(paged(items, total, page));
}));

router.get('/availability', requirePermission('trips:assign'), asyncRoute(async (req, res) => {
  const { bookingId, excludeTripId, from, to } = req.query;
  if (!bookingId) {
    const fromDate = from ? new Date(String(from)) : null;
    if (!fromDate || Number.isNaN(fromDate.getTime())) {
      throw new HttpError(400, 'bookingId atau rentang from/to wajib diisi');
    }
    const toDate = to ? new Date(String(to)) : new Date(fromDate.getTime() + 4 * 60 * 60 * 1000);
    if (Number.isNaN(toDate.getTime()) || toDate.getTime() <= fromDate.getTime()) {
      throw new HttpError(400, 'Rentang ketersediaan tidak valid');
    }
    const passengerCount = Math.min(80, Math.max(1, Number(req.query.passengerCount) || 1));
    const availability = await availabilityFor(prisma, {
      departureAt: fromDate,
      returnAt: toDate,
      passengerCount,
    });
    res.json({ ...availability, passengerCount });
    return;
  }
  const booking = await prisma.booking.findUnique({ where: { id: String(bookingId) }, include: { trip: true } });
  if (!booking) throw new HttpError(404, 'Booking tidak ditemukan');
  if (!['APPROVED', 'ASSIGNED'].includes(booking.status)) {
    throw new HttpError(409, 'Ketersediaan hanya dapat dicek untuk booking yang sudah disetujui');
  }
  const exclude = excludeTripId ? String(excludeTripId) : booking.trip?.id;
  const availability = await availabilityFor(prisma, booking, exclude);
  res.json({ booking: { id: booking.id, code: booking.code, passengerCount: booking.passengerCount, departureAt: booking.departureAt, returnAt: booking.returnAt }, ...availability });
}));

router.get('/checklist-template', asyncRoute(async (req, res) => {
  if (!can(req.user.role, 'trips:read:all') && req.user.role !== 'DRIVER') {
    throw new HttpError(403, 'Anda tidak memiliki akses ke checklist perjalanan');
  }
  const vehicleId = req.query.vehicleId ? String(req.query.vehicleId) : null;
  if (vehicleId) {
    const vehicle = await prisma.vehicle.findUnique({ where: { id: vehicleId }, select: { checklistTemplate: true } });
    if (!vehicle) throw new HttpError(404, 'Kendaraan tidak ditemukan');
    const items = checklistItemsFor(vehicle);
    return res.json({ items, source: vehicle.checklistTemplate?.items?.length ? 'VEHICLE' : 'DEFAULT' });
  }
  res.json({ items: TRIP_CHECKLIST_ITEMS, source: 'DEFAULT' });
}));

const checklistSchema = z.object({
  items: z.array(z.object({ key: z.string().trim().min(1), checked: z.boolean() })).min(1, 'Checklist tidak boleh kosong'),
  note: z.string().trim().max(300).optional(),
});

router.patch('/:id/checklist', asyncRoute(async (req, res) => {
  const { items, note } = checklistSchema.parse(req.body);
  const trip = await prisma.trip.findUnique({
    where: { id: req.params.id },
    include: { driver: true, booking: true, vehicle: { select: { checklistTemplate: true } } },
  });
  if (!trip) throw new HttpError(404, 'Trip tidak ditemukan');

  const isOwnDriver = req.user.role === 'DRIVER' && trip.driver.userId === req.user.id;
  if (!isOwnDriver && !can(req.user.role, 'trips:update:any')) {
    throw new HttpError(403, 'Anda tidak berhak mengisi checklist trip ini');
  }
  if (['COMPLETED', 'CANCELLED'].includes(trip.status)) {
    throw new HttpError(409, 'Checklist trip yang sudah selesai/dibatalkan tidak dapat diubah');
  }

  const template = checklistItemsFor(trip.vehicle);
  const normalized = template.map((item) => ({
    key: item.key,
    label: item.label,
    checked: Boolean(items.find((entry) => entry.key === item.key)?.checked),
  }));
  const checkedCount = normalized.filter((item) => item.checked).length;
  const checklist = {
    items: normalized,
    complete: checkedCount === normalized.length,
    note: note || null,
    updatedAt: new Date().toISOString(),
    updatedById: req.user.id,
  };

  const updated = await prisma.trip.update({ where: { id: trip.id }, data: { checklist } });
  await prisma.tripEvent.create({
    data: {
      tripId: trip.id,
      status: trip.status,
      note: `Checklist pra-perjalanan ${checkedCount}/${normalized.length} item${note ? ` — ${note}` : ''}`,
      actorId: req.user.id,
    },
  });
  await writeAudit({
    userId: req.user.id,
    action: 'TRIP_CHECKLIST',
    entity: 'Trip',
    entityId: trip.id,
    detail: `${trip.booking.code}: ${checkedCount}/${normalized.length} item`,
  });
  const detail = await prisma.trip.findUnique({ where: { id: updated.id }, include: detailInclude });
  res.json(detail);
}));

router.get('/:id', asyncRoute(async (req, res) => {
  const trip = await prisma.trip.findUnique({ where: { id: req.params.id }, include: detailInclude });
  if (!trip) throw new HttpError(404, 'Trip tidak ditemukan');
  if (!canReadTrip(req.user, trip)) throw new HttpError(403, 'Anda tidak memiliki akses ke trip ini');
  res.json(trip);
}));

router.post('/', requirePermission('trips:assign'), asyncRoute(async (req, res) => {
  const { bookingId, vehicleId, driverId, notes } = assignSchema.parse(req.body);

  const trip = await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "Booking" WHERE id = ${bookingId} FOR UPDATE`;
    const booking = await tx.booking.findUnique({ where: { id: bookingId }, include: { trip: true } });
    if (!booking) throw new HttpError(404, 'Booking tidak ditemukan');
    if (booking.trip) throw new HttpError(409, 'Booking sudah memiliki penugasan');
    if (booking.status !== 'APPROVED') {
      throw new HttpError(409, `Booking harus berstatus APPROVED sebelum penugasan (saat ini ${booking.status})`);
    }
    await lockAssignmentResources(tx, { vehicleId, driverId });
    await assertAssignable(tx, booking, { vehicleId, driverId });

    const created = await tx.trip.create({
      data: {
        bookingId,
        vehicleId,
        driverId,
        assignedById: req.user.id,
        status: 'SCHEDULED',
        notes: notes || null,
      },
    });
    await tx.booking.update({ where: { id: bookingId }, data: { status: 'ASSIGNED' } });
    await tx.tripEvent.create({
      data: { tripId: created.id, status: 'SCHEDULED', note: notes || 'Penugasan kendaraan dan driver dibuat', actorId: req.user.id },
    });
    await refreshVehicleStatus(tx, vehicleId);
    await refreshDriverAvailability(tx, driverId);
    return tx.trip.findUnique({ where: { id: created.id }, include: detailInclude });
  });

  await writeAudit({
    userId: req.user.id,
    action: 'TRIP_ASSIGN',
    entity: 'Trip',
    entityId: trip.id,
    detail: `${trip.booking.code}: ${trip.vehicle.plateNumber} / ${trip.driver.name}`,
  });
  const schedule = `${trip.booking.origin} → ${trip.booking.destination}, ${new Date(trip.booking.departureAt).toLocaleString('id-ID')}`;
  if (trip.driver.userId) {
    await notify({
      userId: trip.driver.userId,
      type: 'TRIP',
      title: `Penugasan perjalanan ${trip.booking.code}`,
      message: `Anda ditugaskan dengan ${trip.vehicle.plateNumber}. ${schedule}.`,
      link: '/trips',
    });
  }
  if (trip.booking.requesterId !== req.user.id) {
    await notify({
      userId: trip.booking.requesterId,
      type: 'TRIP',
      title: `Booking ${trip.booking.code} sudah dijadwalkan`,
      message: `${trip.vehicle.plateNumber} dengan driver ${trip.driver.name}. ${schedule}.`,
      link: '/bookings',
    });
  }
  res.status(201).json(trip);
}));

router.patch('/:id/assignment', requirePermission('trips:assign'), asyncRoute(async (req, res) => {
  const { vehicleId, driverId, notes } = reassignSchema.parse(req.body);

  const updated = await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "Trip" WHERE id = ${req.params.id} FOR UPDATE`;
    const trip = await tx.trip.findUnique({ where: { id: req.params.id }, include: { booking: true } });
    if (!trip) throw new HttpError(404, 'Trip tidak ditemukan');
    if (['COMPLETED', 'CANCELLED'].includes(trip.status)) {
      throw new HttpError(409, 'Trip yang sudah selesai/dibatalkan tidak dapat ditugaskan ulang');
    }
    if (trip.vehicleId === vehicleId && trip.driverId === driverId) return trip;

    await lockAssignmentResources(tx, { vehicleId, driverId });
    await assertAssignable(tx, trip.booking, { vehicleId, driverId, excludeTripId: trip.id });
    const oldVehicleId = trip.vehicleId;
    const oldDriverId = trip.driverId;

    const result = await tx.trip.update({
      where: { id: trip.id },
      data: { vehicleId, driverId, assignedById: req.user.id },
    });
    await tx.tripEvent.create({
      data: {
        tripId: trip.id,
        status: trip.status,
        note: notes || 'Penugasan kendaraan/driver diperbarui',
        actorId: req.user.id,
      },
    });
    await refreshVehicleStatus(tx, oldVehicleId);
    await refreshDriverAvailability(tx, oldDriverId);
    await refreshVehicleStatus(tx, vehicleId);
    await refreshDriverAvailability(tx, driverId);
    return tx.trip.findUnique({ where: { id: result.id }, include: detailInclude });
  });

  await writeAudit({
    userId: req.user.id,
    action: 'TRIP_REASSIGN',
    entity: 'Trip',
    entityId: updated.id,
    detail: `${updated.booking.code}: ${updated.vehicle.plateNumber} / ${updated.driver.name}`,
  });
  if (updated.driver.userId) {
    await notify({
      userId: updated.driver.userId,
      type: 'TRIP',
      title: `Penugasan diperbarui: ${updated.booking.code}`,
      message: `Anda sekarang ditugaskan dengan ${updated.vehicle.plateNumber}. ${updated.booking.origin} → ${updated.booking.destination}.`,
      link: '/trips',
    });
  }
  if (updated.booking.requesterId !== req.user.id) {
    await notify({
      userId: updated.booking.requesterId,
      type: 'TRIP',
      title: `Penugasan booking ${updated.booking.code} diperbarui`,
      message: `Kendaraan/driver diganti menjadi ${updated.vehicle.plateNumber} / ${updated.driver.name}.`,
      link: '/bookings',
    });
  }
  res.json(updated);
}));

router.patch('/:id/status', asyncRoute(async (req, res) => {
  const { status, note } = statusSchema.parse(req.body);

  const trip = await prisma.trip.findUnique({
    where: { id: req.params.id },
    include: { driver: true, booking: true, vehicle: true },
  });
  if (!trip) throw new HttpError(404, 'Trip tidak ditemukan');

  const isOwnDriver = req.user.role === 'DRIVER' && trip.driver.userId === req.user.id;
  if (req.user.role === 'DRIVER' && !isOwnDriver) throw new HttpError(403, 'Trip ini bukan penugasan Anda');
  if (!isOwnDriver && !can(req.user.role, 'trips:update:any')) {
    throw new HttpError(403, 'Anda tidak berhak mengubah status trip');
  }
  if (trip.booking.status !== 'ASSIGNED') {
    throw new HttpError(409, `Booking sudah berstatus ${trip.booking.status}; status trip tidak dapat diubah`);
  }
  assertTransition(
    TRIP_TRANSITIONS,
    trip.status,
    status,
    `Status tidak dapat berubah dari ${TRIP_STATUS_LABELS[trip.status]} ke ${TRIP_STATUS_LABELS[status]}`
  );

  if (status === 'PICKED_UP') {
    const checkedKeys = new Set(
      (Array.isArray(trip.checklist?.items) ? trip.checklist.items : [])
        .filter((item) => item?.checked)
        .map((item) => item.key)
    );
    const missing = checklistItemsFor(trip.vehicle).filter((item) => !checkedKeys.has(item.key));
    if (missing.length) {
      throw new HttpError(409, `Checklist pra-perjalanan belum lengkap (${missing.length} item): ${missing.map((item) => item.label).join(', ')}`);
    }
  }

  const now = new Date();
  const data = {
    status,
    ...(status === 'DRIVER_ACCEPTED' ? { acceptedAt: now } : {}),
    ...(status === 'IN_PROGRESS' ? { startedAt: now } : {}),
    ...(status === 'COMPLETED' ? { completedAt: now } : {}),
    ...(status === 'CANCELLED' ? { cancelledAt: now } : {}),
    ...(note ? { notes: note } : {}),
  };

  const updated = await prisma.$transaction(async (tx) => {
    const result = await tx.trip.updateMany({ where: { id: trip.id, status: trip.status }, data });
    if (result.count === 0) {
      throw new HttpError(409, 'Status trip sudah berubah. Muat ulang data sebelum mencoba lagi.');
    }
    await tx.tripEvent.create({ data: { tripId: trip.id, status, note: note || TRIP_STATUS_LABELS[status], actorId: req.user.id } });

    if (status === 'COMPLETED') {
      await tx.booking.update({ where: { id: trip.bookingId }, data: { status: 'COMPLETED' } });
    }
    if (status === 'CANCELLED') {
      await tx.booking.update({
        where: { id: trip.bookingId },
        data: { status: 'CANCELLED', cancelledReason: note || 'Trip dibatalkan' },
      });
    }
    if (['COMPLETED', 'CANCELLED'].includes(status)) {
      await refreshVehicleStatus(tx, trip.vehicleId);
      await refreshDriverAvailability(tx, trip.driverId);
    }
    return { id: trip.id };
  });

  await writeAudit({
    userId: req.user.id,
    action: 'TRIP_STATUS',
    entity: 'Trip',
    entityId: trip.id,
    detail: `${trip.booking.code} → ${status}${note ? ` (${note})` : ''}`,
  });
  if (trip.booking.requesterId !== req.user.id) {
    await notify({
      userId: trip.booking.requesterId,
      type: 'TRIP',
      title: `Perjalanan ${trip.booking.code}: ${TRIP_STATUS_LABELS[status]}`,
      message: `${trip.vehicle.plateNumber} / ${trip.driver.name}${note ? ` — ${note}` : ''}.`,
      link: '/bookings',
    });
  }

  const detail = await prisma.trip.findUnique({ where: { id: updated.id }, include: detailInclude });
  res.json(detail);
}));

export default router;
