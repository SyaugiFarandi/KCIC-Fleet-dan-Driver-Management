import express from 'express';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { prisma } from '../db.js';
import { HttpError, asyncRoute, pagination, paged } from '../lib/http.js';
import { can, requirePermission } from '../lib/permissions.js';
import { writeAudit } from '../lib/audit.js';
import { ACTIVE_TRIP_STATUSES, assertTransition, BOOKING_TRANSITIONS } from '../lib/workflow.js';
import { refreshDriverAvailability, refreshVehicleStatus } from '../lib/resourceStatus.js';
import { notify } from '../lib/notifications.js';

const router = express.Router();

const bookingInclude = {
  requester: { select: { id: true, name: true, email: true, department: true } },
  decidedBy: { select: { id: true, name: true } },
  route: true,
  trip: {
    include: {
      vehicle: { select: { id: true, plateNumber: true, brand: true, model: true } },
      driver: { select: { id: true, name: true, phone: true } },
    },
  },
};

const bookingDetailInclude = {
  ...bookingInclude,
  trip: {
    include: {
      vehicle: { include: { vendor: { select: { id: true, name: true } } } },
      driver: { include: { vendor: { select: { id: true, name: true } }, user: { select: { id: true, email: true } } } },
      assignedBy: { select: { id: true, name: true } },
      events: {
        include: { actor: { select: { id: true, name: true } } },
        orderBy: { createdAt: 'asc' },
      },
    },
  },
};

function scopeFor(user) {
  if (user.role === 'CREW_EMPLOYEE') return { requesterId: user.id };
  if (user.role === 'DRIVER') return { trip: { is: { driver: { is: { userId: user.id } } } } };
  return {};
}

export function canReadBooking(user, booking) {
  if (user.role === 'CREW_EMPLOYEE') return booking.requesterId === user.id;
  if (user.role === 'DRIVER') return booking.trip?.driver?.userId === user.id;
  return can(user.role, 'bookings:read:all');
}

const recurrenceSchema = z.object({
  frequency: z.enum(['DAILY', 'WEEKLY']),
  count: z.coerce.number().int().min(2, 'Minimal 2 jadwal berulang').max(8, 'Maksimal 8 jadwal berulang'),
});

const createSchema = z
  .object({
    department: z.string().trim().max(120).optional(),
    purpose: z.string().trim().min(3, 'Tujuan perjalanan wajib diisi').max(300),
    passengerCount: z.coerce.number().int().min(1, 'Minimal 1 penumpang').max(80, 'Maksimal 80 penumpang'),
    routeId: z.string().trim().optional().nullable(),
    origin: z.string().trim().max(120).optional(),
    destination: z.string().trim().max(120).optional(),
    departureAt: z.coerce.date({ invalid_type_error: 'Waktu keberangkatan tidak valid' }),
    returnAt: z.coerce.date({ invalid_type_error: 'Waktu kembali tidak valid' }).optional().nullable(),
    recurrence: recurrenceSchema.optional().nullable(),
  })
  .refine((v) => v.routeId || (v.origin && v.destination), {
    message: 'Asal dan tujuan wajib diisi',
    path: ['origin'],
  })
  .refine((v) => !v.returnAt || v.returnAt > v.departureAt, {
    message: 'Waktu kembali harus setelah waktu keberangkatan',
    path: ['returnAt'],
  });

const updateSchema = z
  .object({
    department: z.string().trim().min(1).max(120).optional(),
    purpose: z.string().trim().min(3).max(300).optional(),
    passengerCount: z.coerce.number().int().min(1).max(80).optional(),
    routeId: z.string().trim().optional().nullable(),
    origin: z.string().trim().min(2).max(120).optional(),
    destination: z.string().trim().min(2).max(120).optional(),
    departureAt: z.coerce.date().optional(),
    returnAt: z.coerce.date().optional().nullable(),
  })
  .refine((v) => !v.returnAt || !v.departureAt || v.returnAt > v.departureAt, {
    message: 'Waktu kembali harus setelah waktu keberangkatan',
    path: ['returnAt'],
  });

function generateCode() {
  const d = new Date();
  const stamp = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
  return `BKG-${stamp}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`;
}

router.get('/', asyncRoute(async (req, res) => {
  const page = pagination(req);
  const { q, status, from, to } = req.query;
  const statuses = status ? String(status).split(',').filter(Boolean) : [];
  const where = {
    ...scopeFor(req.user),
    ...(statuses.length ? { status: { in: statuses } } : {}),
    ...(q
      ? {
          OR: [
            { code: { contains: q, mode: 'insensitive' } },
            { origin: { contains: q, mode: 'insensitive' } },
            { destination: { contains: q, mode: 'insensitive' } },
            { purpose: { contains: q, mode: 'insensitive' } },
            { requester: { is: { name: { contains: q, mode: 'insensitive' } } } },
          ],
        }
      : {}),
    ...(from || to
      ? {
          departureAt: {
            ...(from ? { gte: new Date(from) } : {}),
            ...(to ? { lte: new Date(to) } : {}),
          },
        }
      : {}),
  };
  const [items, total] = await Promise.all([
    prisma.booking.findMany({
      where,
      include: bookingInclude,
      orderBy: { createdAt: 'desc' },
      skip: page.skip,
      take: page.take,
    }),
    prisma.booking.count({ where }),
  ]);
  res.json(paged(items, total, page));
}));

router.get('/options', asyncRoute(async (req, res) => {
  const [routes, departments] = await Promise.all([
    prisma.route.findMany({ where: { active: true }, orderBy: [{ origin: 'asc' }, { destination: 'asc' }] }),
    prisma.user.findMany({ where: { active: true }, distinct: ['department'], select: { department: true } }),
  ]);
  res.json({
    routes,
    departments: departments.map((d) => d.department).filter(Boolean).sort(),
  });
}));

router.get('/:id', asyncRoute(async (req, res) => {
  const booking = await prisma.booking.findUnique({ where: { id: req.params.id }, include: bookingDetailInclude });
  if (!booking) throw new HttpError(404, 'Booking tidak ditemukan');
  if (!canReadBooking(req.user, booking)) throw new HttpError(403, 'Anda tidak memiliki akses ke booking ini');
  res.json(booking);
}));

router.post('/', asyncRoute(async (req, res) => {
  const data = createSchema.parse(req.body);
  if (data.departureAt.getTime() < Date.now() - 5 * 60 * 1000) {
    throw new HttpError(400, 'Waktu keberangkatan tidak boleh di masa lalu');
  }

  let { origin, destination } = data;
  if (data.routeId) {
    const route = await prisma.route.findUnique({ where: { id: data.routeId } });
    if (!route) throw new HttpError(404, 'Rute tidak ditemukan');
    if (!route.active) throw new HttpError(400, 'Rute sedang tidak aktif');
    origin = route.origin;
    destination = route.destination;
  }
  if (!origin || !destination) throw new HttpError(400, 'Asal dan tujuan wajib diisi');

  const recurrence = data.recurrence || null;
  const count = recurrence?.count || 1;
  const stepMs = recurrence?.frequency === 'WEEKLY' ? 7 * 24 * 60 * 60 * 1000 : 24 * 60 * 60 * 1000;
  const durationMs = data.returnAt ? data.returnAt.getTime() - data.departureAt.getTime() : null;
  const seriesId = recurrence ? randomUUID() : null;

  const bookings = await prisma.$transaction(async (tx) => {
    const created = [];
    for (let index = 0; index < count; index += 1) {
      const departureAt = new Date(data.departureAt.getTime() + index * stepMs);
      const booking = await tx.booking.create({
        data: {
          code: generateCode(),
          requesterId: req.user.id,
          department: data.department?.trim() || req.user.department || 'Operasional',
          purpose: data.purpose,
          passengerCount: data.passengerCount,
          origin,
          destination,
          routeId: data.routeId || null,
          departureAt,
          returnAt: durationMs ? new Date(departureAt.getTime() + durationMs) : null,
          seriesId,
          status: 'PENDING',
        },
        include: bookingInclude,
      });
      created.push(booking);
    }
    return created;
  });

  const booking = bookings[0];
  await writeAudit({
    userId: req.user.id,
    action: 'BOOKING_CREATE',
    entity: 'Booking',
    entityId: booking.id,
    detail: `${booking.code}${recurrence ? ` (seri ${count} jadwal ${recurrence.frequency === 'WEEKLY' ? 'mingguan' : 'harian'})` : ''}: ${booking.origin} → ${booking.destination}`,
  });
  res.status(201).json(
    recurrence
      ? { ...booking, series: { id: seriesId, count, frequency: recurrence.frequency, codes: bookings.map((item) => item.code) } }
      : booking
  );
}));

router.patch('/:id', asyncRoute(async (req, res) => {
  const data = updateSchema.parse(req.body);
  const booking = await prisma.booking.findUnique({ where: { id: req.params.id }, include: { trip: true } });
  if (!booking) throw new HttpError(404, 'Booking tidak ditemukan');

  const isElevated = ['SYSTEM_ADMIN', 'FLEET_MANAGER'].includes(req.user.role);
  const isOwner = booking.requesterId === req.user.id;
  if (!(isElevated && ['PENDING', 'APPROVED'].includes(booking.status)) && !(isOwner && booking.status === 'PENDING')) {
    throw new HttpError(403, 'Booking hanya dapat diubah saat masih menunggu persetujuan');
  }
  if (booking.status === 'ASSIGNED') throw new HttpError(409, 'Booking yang sudah ditugaskan tidak dapat diubah');

  let origin = data.origin ?? booking.origin;
  let destination = data.destination ?? booking.destination;
  if (data.routeId !== undefined) {
    if (data.routeId) {
      const route = await prisma.route.findUnique({ where: { id: data.routeId } });
      if (!route) throw new HttpError(404, 'Rute tidak ditemukan');
      origin = route.origin;
      destination = route.destination;
    }
  }
  const departureAt = data.departureAt ?? booking.departureAt;
  const returnAt = data.returnAt !== undefined ? data.returnAt : booking.returnAt;
  if (returnAt && returnAt <= departureAt) throw new HttpError(400, 'Waktu kembali harus setelah waktu keberangkatan');
  if (data.departureAt && data.departureAt.getTime() < Date.now() - 5 * 60 * 1000 && data.departureAt.getTime() !== booking.departureAt.getTime()) {
    throw new HttpError(400, 'Waktu keberangkatan tidak boleh di masa lalu');
  }

  const updated = await prisma.booking.update({
    where: { id: booking.id },
    data: {
      ...(data.department !== undefined ? { department: data.department } : {}),
      ...(data.purpose !== undefined ? { purpose: data.purpose } : {}),
      ...(data.passengerCount !== undefined ? { passengerCount: data.passengerCount } : {}),
      ...(data.routeId !== undefined ? { routeId: data.routeId || null } : {}),
      ...(data.origin !== undefined || data.routeId !== undefined ? { origin } : {}),
      ...(data.destination !== undefined || data.routeId !== undefined ? { destination } : {}),
      ...(data.departureAt !== undefined ? { departureAt } : {}),
      ...(data.returnAt !== undefined ? { returnAt } : {}),
    },
    include: bookingInclude,
  });
  await writeAudit({ userId: req.user.id, action: 'BOOKING_UPDATE', entity: 'Booking', entityId: updated.id, detail: updated.code });
  res.json(updated);
}));

router.patch('/:id/decision', requirePermission('bookings:decide'), asyncRoute(async (req, res) => {
  const schema = z.object({
    decision: z.enum(['APPROVED', 'REJECTED']),
    reason: z.string().trim().max(300).optional(),
  });
  const { decision, reason } = schema.parse(req.body);
  const booking = await prisma.booking.findUnique({ where: { id: req.params.id } });
  if (!booking) throw new HttpError(404, 'Booking tidak ditemukan');
  assertTransition(BOOKING_TRANSITIONS, booking.status, decision, `Booking berstatus ${booking.status} tidak dapat diputuskan`);
  if (decision === 'REJECTED' && (!reason || reason.trim().length < 3)) {
    throw new HttpError(400, 'Alasan penolakan wajib diisi');
  }

  const updated = await prisma.booking.update({
    where: { id: booking.id },
    data: {
      status: decision,
      decidedById: req.user.id,
      decidedAt: new Date(),
      rejectionReason: decision === 'REJECTED' ? reason : null,
    },
    include: bookingInclude,
  });
  await writeAudit({
    userId: req.user.id,
    action: decision === 'APPROVED' ? 'BOOKING_APPROVE' : 'BOOKING_REJECT',
    entity: 'Booking',
    entityId: booking.id,
    detail: `${booking.code}${reason ? ` — ${reason}` : ''}`,
  });
  if (booking.requesterId !== req.user.id) {
    await notify({
      userId: booking.requesterId,
      type: 'BOOKING',
      title: decision === 'APPROVED' ? `Booking ${booking.code} disetujui` : `Booking ${booking.code} ditolak`,
      message:
        decision === 'APPROVED'
          ? `${booking.origin} → ${booking.destination} telah disetujui. Menunggu penugasan kendaraan.`
          : `${booking.origin} → ${booking.destination} ditolak${reason ? ` — ${reason}` : ''}.`,
      link: '/bookings',
    });
  }
  res.json(updated);
}));

router.patch('/:id/cancel', asyncRoute(async (req, res) => {
  const schema = z.object({ reason: z.string().trim().max(300).optional() });
  const { reason } = schema.parse(req.body ?? {});

  const booking = await prisma.booking.findUnique({
    where: { id: req.params.id },
    include: { trip: true },
  });
  if (!booking) throw new HttpError(404, 'Booking tidak ditemukan');

  const isOwner = booking.requesterId === req.user.id;
  const isApprover = can(req.user.role, 'bookings:decide');
  const tripRunning = booking.trip && ['PICKED_UP', 'IN_PROGRESS'].includes(booking.trip.status);
  if (tripRunning) {
    throw new HttpError(409, 'Trip sedang berjalan dan tidak dapat dibatalkan melalui booking');
  }
  const cancellableByOwner = isOwner && ['PENDING', 'APPROVED', 'ASSIGNED'].includes(booking.status);
  if (!isApprover && !cancellableByOwner) {
    throw new HttpError(403, 'Anda tidak berhak membatalkan booking ini');
  }
  if (!['PENDING', 'APPROVED', 'ASSIGNED'].includes(booking.status)) {
    throw new HttpError(409, `Booking berstatus ${booking.status} tidak dapat dibatalkan`);
  }

  const updated = await prisma.$transaction(async (tx) => {
    if (booking.trip && ACTIVE_TRIP_STATUSES.includes(booking.trip.status)) {
      await tx.trip.update({
        where: { id: booking.trip.id },
        data: { status: 'CANCELLED', cancelledAt: new Date(), notes: `Dibatalkan melalui booking${reason ? `: ${reason}` : ''}` },
      });
      await tx.tripEvent.create({
        data: { tripId: booking.trip.id, status: 'CANCELLED', note: reason || 'Booking dibatalkan', actorId: req.user.id },
      });
      await refreshVehicleStatus(tx, booking.trip.vehicleId);
      await refreshDriverAvailability(tx, booking.trip.driverId);
    }
    return tx.booking.update({
      where: { id: booking.id },
      data: {
        status: 'CANCELLED',
        cancelledReason: reason || 'Dibatalkan',
        ...(booking.trip && ACTIVE_TRIP_STATUSES.includes(booking.trip.status) ? {} : {}),
      },
      include: bookingInclude,
    });
  });

  await writeAudit({
    userId: req.user.id,
    action: 'BOOKING_CANCEL',
    entity: 'Booking',
    entityId: booking.id,
    detail: `${booking.code}${reason ? ` — ${reason}` : ''}`,
  });
  if (booking.requesterId !== req.user.id) {
    await notify({
      userId: booking.requesterId,
      type: 'BOOKING',
      title: `Booking ${booking.code} dibatalkan`,
      message: `${booking.origin} → ${booking.destination} dibatalkan oleh staf${reason ? ` — ${reason}` : ''}.`,
      link: '/bookings',
    });
  }
  res.json(updated);
}));

router.delete('/:id', requirePermission('bookings:delete'), asyncRoute(async (req, res) => {
  const booking = await prisma.booking.findUnique({ where: { id: req.params.id }, include: { trip: true } });
  if (!booking) throw new HttpError(404, 'Booking tidak ditemukan');
  if (booking.trip) throw new HttpError(409, 'Booking memiliki riwayat trip dan tidak dapat dihapus');
  if (!['REJECTED', 'CANCELLED'].includes(booking.status)) {
    throw new HttpError(409, 'Hanya booking yang ditolak/dibatalkan yang dapat dihapus');
  }
  await prisma.booking.delete({ where: { id: booking.id } });
  await writeAudit({ userId: req.user.id, action: 'BOOKING_DELETE', entity: 'Booking', entityId: booking.id, detail: booking.code });
  res.json({ ok: true });
}));

export default router;
