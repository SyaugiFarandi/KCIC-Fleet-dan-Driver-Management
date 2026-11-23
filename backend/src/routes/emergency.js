import express from 'express';
import { z } from 'zod';
import { prisma } from '../db.js';
import { HttpError, asyncRoute, pagination, paged } from '../lib/http.js';
import { PERMISSIONS, can, requirePermission } from '../lib/permissions.js';
import { writeAudit } from '../lib/audit.js';
import { ACTIVE_TRIP_STATUSES } from '../lib/workflow.js';
import { notify } from '../lib/notifications.js';

const router = express.Router();
router.use(requirePermission('emergency:read'));

const APPROVER_ROLES = PERMISSIONS['emergency:decide'];
const BOOKING_STATUSES = ['PENDING', 'APPROVED', 'REJECTED', 'ASSIGNED', 'COMPLETED', 'CANCELLED'];

const include = {
  requester: { select: { id: true, name: true, email: true, department: true } },
  decidedBy: { select: { id: true, name: true } },
  route: { select: { id: true, code: true, origin: true, destination: true } },
  trip: {
    select: {
      id: true,
      status: true,
      assignedAt: true,
      startedAt: true,
      completedAt: true,
      vehicle: { select: { id: true, plateNumber: true, brand: true, model: true } },
      driver: { select: { id: true, name: true } },
    },
  },
};

const requestSchema = z
  .object({
    purpose: z.string().trim().min(3, 'Tujuan mobilisasi wajib diisi').max(300),
    reason: z.string().trim().min(10, 'Alasan darurat minimal 10 karakter').max(500),
    department: z.string().trim().max(120).optional(),
    passengerCount: z.coerce.number().int().min(1, 'Minimal 1 penumpang').max(80),
    routeId: z.string().trim().optional().nullable(),
    origin: z.string().trim().min(2).max(120).optional(),
    destination: z.string().trim().min(2).max(120).optional(),
    departureAt: z.coerce.date().optional(),
    returnAt: z.coerce.date().optional().nullable(),
  })
  .refine((value) => value.routeId || (value.origin && value.destination), {
    message: 'Asal dan tujuan wajib diisi',
    path: ['origin'],
  })
  .refine((value) => !value.returnAt || !value.departureAt || value.returnAt > value.departureAt, {
    message: 'Waktu kembali harus setelah keberangkatan',
    path: ['returnAt'],
  });

function scopeFor(user) {
  if (can(user.role, 'bookings:read:all')) return {};
  return { requesterId: user.id };
}

function bookingCode() {
  const now = new Date();
  const stamp = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}`;
  return `EMG-${stamp}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`;
}

function minutesBetween(from, to) {
  if (!from || !to) return null;
  return Math.max(0, Math.round((new Date(to).getTime() - new Date(from).getTime()) / 60000));
}

function average(values) {
  const filled = values.filter((value) => typeof value === 'number' && Number.isFinite(value));
  if (!filled.length) return null;
  return Math.round(filled.reduce((sum, value) => sum + value, 0) / filled.length);
}

async function notifyApprovers({ excludeUserId, type, title, message, link }) {
  const approvers = await prisma.user.findMany({
    where: { active: true, role: { in: APPROVER_ROLES }, ...(excludeUserId ? { id: { not: excludeUserId } } : {}) },
    select: { id: true },
  });
  for (const approver of approvers) {
    await notify({ userId: approver.id, type, title, message, link });
  }
}

router.get('/', asyncRoute(async (req, res) => {
  const page = pagination(req);
  const { q, status } = req.query;
  const statuses = status ? String(status).split(',').filter((value) => BOOKING_STATUSES.includes(value)) : [];
  const where = {
    priority: 'EMERGENCY',
    ...scopeFor(req.user),
    ...(statuses.length ? { status: { in: statuses } } : {}),
    ...(q
      ? {
          OR: [
            { code: { contains: q, mode: 'insensitive' } },
            { origin: { contains: q, mode: 'insensitive' } },
            { destination: { contains: q, mode: 'insensitive' } },
            { emergencyReason: { contains: q, mode: 'insensitive' } },
          ],
        }
      : {}),
  };
  const [items, total] = await Promise.all([
    prisma.booking.findMany({ where, include, orderBy: { createdAt: 'desc' }, skip: page.skip, take: page.take }),
    prisma.booking.count({ where }),
  ]);
  res.json(paged(items, total, page));
}));

router.get('/summary', asyncRoute(async (req, res) => {
  const bookings = await prisma.booking.findMany({
    where: { priority: 'EMERGENCY', ...scopeFor(req.user) },
    select: {
      id: true,
      status: true,
      createdAt: true,
      decidedAt: true,
      trip: { select: { status: true, assignedAt: true, startedAt: true, completedAt: true } },
    },
  });
  const now = Date.now();
  const counts = Object.fromEntries(BOOKING_STATUSES.map((status) => [status, 0]));
  for (const booking of bookings) counts[booking.status] = (counts[booking.status] || 0) + 1;
  const assigned = bookings.filter((booking) => booking.trip?.assignedAt);
  const activeTrips = bookings.filter((booking) => booking.trip && ACTIVE_TRIP_STATUSES.includes(booking.trip.status));
  const pending = bookings.filter((booking) => booking.status === 'PENDING');
  const oldestPending = pending.length
    ? Math.max(...pending.map((booking) => Math.round((now - new Date(booking.createdAt).getTime()) / 60000)))
    : null;

  res.json({
    total: bookings.length,
    counts,
    pendingApproval: counts.PENDING,
    awaitingAssignment: bookings.filter((booking) => booking.status === 'APPROVED' && !booking.trip).length,
    dispatched: assigned.length,
    activeTrips: activeTrips.length,
    completed: counts.COMPLETED,
    rejected: counts.REJECTED,
    cancelled: counts.CANCELLED,
    avgApprovalMinutes: average(bookings.filter((booking) => booking.decidedAt).map((booking) => minutesBetween(booking.createdAt, booking.decidedAt))),
    avgDispatchMinutes: average(assigned.map((booking) => minutesBetween(booking.createdAt, booking.trip.assignedAt))),
    avgApprovalToDispatchMinutes: average(
      assigned.map((booking) => (booking.decidedAt ? minutesBetween(booking.decidedAt, booking.trip.assignedAt) : null))
    ),
    oldestPendingMinutes: oldestPending,
    demoNote: 'KPI dihitung dari data DEMO pada basis data lokal, bukan data operasional resmi KCIC.',
  });
}));

router.post('/requests', asyncRoute(async (req, res) => {
  if (!can(req.user.role, 'bookings:read:all') && req.user.role !== 'CREW_EMPLOYEE') {
    throw new HttpError(403, 'Role Anda tidak dapat mengajukan transport darurat');
  }
  const data = requestSchema.parse(req.body);
  let origin = data.origin;
  let destination = data.destination;
  if (data.routeId) {
    const route = await prisma.route.findUnique({ where: { id: data.routeId } });
    if (!route) throw new HttpError(404, 'Rute tidak ditemukan');
    if (!route.active) throw new HttpError(409, 'Rute tidak aktif');
    origin = route.origin;
    destination = route.destination;
  }
  const departureAt = data.departureAt ?? new Date(Date.now() + 15 * 60000);

  const booking = await prisma.booking.create({
    data: {
      code: bookingCode(),
      requesterId: req.user.id,
      department: data.department || req.user.department || 'Operasional',
      purpose: data.purpose,
      passengerCount: data.passengerCount,
      origin,
      destination,
      routeId: data.routeId || null,
      departureAt,
      returnAt: data.returnAt ?? null,
      priority: 'EMERGENCY',
      emergencyReason: data.reason,
      status: 'PENDING',
    },
    include,
  });

  await writeAudit({
    userId: req.user.id,
    action: 'EMERGENCY_CREATE',
    entity: 'Booking',
    entityId: booking.id,
    detail: `${booking.code}: ${booking.origin} → ${booking.destination} (${data.reason})`,
  });
  await notifyApprovers({
    excludeUserId: req.user.id,
    type: 'BOOKING',
    title: `Darurat ${booking.code}: ${booking.origin} → ${booking.destination}`,
    message: `${booking.passengerCount} penumpang. ${data.reason}`,
    link: '/emergency',
  });
  res.status(201).json(booking);
}));

router.patch('/:id/decision', asyncRoute(async (req, res) => {
  if (!can(req.user.role, 'emergency:decide')) throw new HttpError(403, 'Anda tidak memiliki akses untuk memutuskan transport darurat');
  const schema = z.object({
    decision: z.enum(['APPROVED', 'REJECTED']),
    reason: z.string().trim().max(300).optional(),
  });
  const { decision, reason } = schema.parse(req.body);
  const booking = await prisma.booking.findUnique({ where: { id: req.params.id } });
  if (!booking) throw new HttpError(404, 'Permintaan darurat tidak ditemukan');
  if (booking.priority !== 'EMERGENCY') throw new HttpError(409, 'Booking ini bukan transport darurat');
  if (booking.status !== 'PENDING') throw new HttpError(409, `Permintaan berstatus ${booking.status} tidak dapat diputuskan`);
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
    include,
  });
  await writeAudit({
    userId: req.user.id,
    action: decision === 'APPROVED' ? 'EMERGENCY_APPROVE' : 'EMERGENCY_REJECT',
    entity: 'Booking',
    entityId: booking.id,
    detail: `${booking.code}${decision === 'REJECTED' ? `: ${reason}` : ''}`,
  });
  if (booking.requesterId !== req.user.id) {
    await notify({
      userId: booking.requesterId,
      type: 'BOOKING',
      title: `Darurat ${booking.code} ${decision === 'APPROVED' ? 'disetujui' : 'ditolak'}`,
      message: decision === 'APPROVED' ? 'Permintaan transport darurat disetujui dan menunggu penugasan kendaraan.' : `Alasan: ${reason}`,
      link: '/emergency',
    });
  }
  res.json(updated);
}));

router.patch('/:id/cancel', asyncRoute(async (req, res) => {
  const schema = z.object({ reason: z.string().trim().min(3, 'Alasan pembatalan wajib diisi').max(300) });
  const { reason } = schema.parse(req.body ?? {});
  const booking = await prisma.booking.findUnique({ where: { id: req.params.id }, include: { trip: true } });
  if (!booking) throw new HttpError(404, 'Permintaan darurat tidak ditemukan');
  if (booking.priority !== 'EMERGENCY') throw new HttpError(409, 'Booking ini bukan transport darurat');
  const allowed = booking.requesterId === req.user.id || can(req.user.role, 'emergency:decide');
  if (!allowed) throw new HttpError(403, 'Anda tidak dapat membatalkan permintaan ini');
  if (!['PENDING', 'APPROVED'].includes(booking.status) || booking.trip) {
    throw new HttpError(409, 'Permintaan yang sudah ditugaskan atau selesai tidak dapat dibatalkan');
  }

  const updated = await prisma.booking.update({
    where: { id: booking.id },
    data: { status: 'CANCELLED', cancelledReason: reason },
    include,
  });
  await writeAudit({
    userId: req.user.id,
    action: 'EMERGENCY_CANCEL',
    entity: 'Booking',
    entityId: booking.id,
    detail: `${booking.code}: ${reason}`,
  });
  if (booking.requesterId !== req.user.id) {
    await notify({
      userId: booking.requesterId,
      type: 'BOOKING',
      title: `Darurat ${booking.code} dibatalkan`,
      message: reason,
      link: '/emergency',
    });
  }
  res.json(updated);
}));

export default router;
