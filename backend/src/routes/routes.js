import express from 'express';
import { z } from 'zod';
import { Prisma } from '@prisma/client';
import { prisma } from '../db.js';
import { HttpError, asyncRoute, pagination, paged } from '../lib/http.js';
import { requirePermission } from '../lib/permissions.js';
import { writeAudit } from '../lib/audit.js';

const router = express.Router();

const codeSchema = z
  .string()
  .trim()
  .max(30)
  .transform((v) => v.toUpperCase())
  .optional()
  .nullable();

const restrictionsSchema = z
  .object({
    maxHeightM: z.coerce.number().min(0.5, 'Tinggi maksimum tidak valid').max(10).optional().nullable(),
    maxWeightTon: z.coerce.number().min(0.1, 'Bobot maksimum tidak valid').max(100).optional().nullable(),
    notes: z.string().trim().max(300).optional().nullable(),
  })
  .optional()
  .nullable();

const createSchema = z.object({
  code: codeSchema,
  origin: z.string().trim().min(2, 'Asal wajib diisi').max(120),
  destination: z.string().trim().min(2, 'Tujuan wajib diisi').max(120),
  estimatedMinutes: z.coerce.number().int().min(1, 'Estimasi minimal 1 menit').max(1440, 'Estimasi maksimal 24 jam'),
  distanceKm: z.coerce.number().min(0.1, 'Jarak minimal 0.1 km').max(2000, 'Jarak maksimal 2000 km'),
  active: z.boolean().optional(),
  restrictions: restrictionsSchema,
});

const updateSchema = createSchema.partial();

const pointSchema = z.object({
  name: z.string().trim().min(2, 'Nama titik wajib diisi').max(120),
  kind: z.enum(['PICKUP', 'WAYPOINT', 'DROP_OFF']).default('WAYPOINT'),
  lat: z.coerce.number().min(-90, 'Latitude tidak valid').max(90, 'Latitude tidak valid'),
  lng: z.coerce.number().min(-180, 'Longitude tidak valid').max(180, 'Longitude tidak valid'),
  notes: z.string().trim().max(200).optional().nullable(),
});

const pointsSchema = z.object({
  points: z.array(pointSchema).min(1, 'Minimal 1 titik rute').max(30, 'Maksimal 30 titik rute'),
});

const include = { points: { orderBy: { sequence: 'asc' } } };

function cleanRestrictions(value) {
  if (!value) return Prisma.JsonNull;
  const entries = Object.entries(value).filter(([, v]) => v !== null && v !== undefined && v !== '');
  return entries.length ? Object.fromEntries(entries) : Prisma.JsonNull;
}

function normalizeText(value) {
  return String(value || '').trim().toLowerCase();
}

function textMatchScore(a, b) {
  const left = normalizeText(a);
  const right = normalizeText(b);
  if (!left || !right) return 0;
  if (left === right) return 2;
  if (left.includes(right) || right.includes(left)) return 1;
  return 0;
}

function buildWarnings(route, { passengers, vehicle, matchScore }) {
  const warnings = [];
  let penalty = 0;
  let blocked = false;

  if (matchScore === 0) {
    warnings.push('Asal/tujuan rute tidak cocok dengan permintaan. Verifikasi apakah rute masih relevan.');
    penalty += 60;
  } else if (matchScore === 1) {
    warnings.push('Asal/tujuan hanya cocok sebagian. Konfirmasi titik jemput dan antar.');
    penalty += 20;
  }

  const restrictions = route.restrictions && typeof route.restrictions === 'object' ? route.restrictions : null;
  if (restrictions) {
    const parts = [];
    if (restrictions.maxHeightM != null) {
      parts.push(`tinggi maksimum ${restrictions.maxHeightM} m`);
      penalty += 10;
    }
    if (restrictions.maxWeightTon != null) {
      parts.push(`bobot maksimum ${restrictions.maxWeightTon} ton`);
      penalty += 10;
    }
    if (restrictions.notes) parts.push(restrictions.notes);
    if (parts.length) warnings.push(`Restriksi rute: ${parts.join('; ')}. Data dimensi kendaraan tidak tersedia, verifikasi manual sebelum penugasan.`);
  }

  const points = route.points || [];
  const pickupFirst = points[0]?.kind === 'PICKUP';
  const dropOffLast = points[points.length - 1]?.kind === 'DROP_OFF';
  if (points.length === 0) {
    warnings.push('Rute belum memiliki titik jemput/antar.');
    penalty += 15;
  } else if (!pickupFirst || !dropOffLast) {
    warnings.push('Urutan titik belum lengkap: titik pertama sebaiknya PICKUP dan terakhir DROP_OFF.');
    penalty += 10;
  }

  if (passengers && !vehicle) {
    warnings.push('Kapasitas kendaraan belum diverifikasi; validasi dilakukan saat penugasan kendaraan.');
  }

  if (vehicle) {
    if (vehicle.status !== 'AVAILABLE') warnings.push(`Status kendaraan saat ini ${vehicle.status}; penugasan akan divalidasi ulang.`);
    if (passengers && vehicle.capacity < passengers) {
      warnings.push(`Kapasitas ${vehicle.plateNumber} (${vehicle.capacity} kursi) kurang dari ${passengers} penumpang.`);
      penalty += 120;
      blocked = true;
    }
  }

  return { warnings, penalty, blocked };
}

router.get('/', requirePermission('routes:read'), asyncRoute(async (req, res) => {
  const page = pagination(req);
  const { q, active } = req.query;
  const where = {
    ...(q
      ? {
          OR: [
            { code: { contains: q, mode: 'insensitive' } },
            { origin: { contains: q, mode: 'insensitive' } },
            { destination: { contains: q, mode: 'insensitive' } },
          ],
        }
      : {}),
    ...(active === 'true' ? { active: true } : active === 'false' ? { active: false } : {}),
  };
  const [items, total] = await Promise.all([
    prisma.route.findMany({ where, include, orderBy: [{ origin: 'asc' }, { destination: 'asc' }], skip: page.skip, take: page.take }),
    prisma.route.count({ where }),
  ]);
  res.json(paged(items, total, page));
}));

router.get('/recommendations', requirePermission('routes:optimize'), asyncRoute(async (req, res) => {
  const query = z
    .object({
      bookingId: z.string().trim().optional(),
      origin: z.string().trim().min(2).optional(),
      destination: z.string().trim().min(2).optional(),
      passengers: z.coerce.number().int().min(1).max(80).optional(),
      vehicleId: z.string().trim().optional(),
    })
    .parse(req.query);

  const [booking, vehicle, routes] = await Promise.all([
    query.bookingId
      ? prisma.booking.findUnique({
          where: { id: query.bookingId },
          select: { id: true, code: true, status: true, origin: true, destination: true, passengerCount: true, routeId: true },
        })
      : null,
    query.vehicleId
      ? prisma.vehicle.findUnique({ where: { id: query.vehicleId }, select: { id: true, plateNumber: true, capacity: true, status: true } })
      : null,
    prisma.route.findMany({ where: { active: true }, include, orderBy: [{ estimatedMinutes: 'asc' }, { distanceKm: 'asc' }] }),
  ]);

  if (query.bookingId && !booking) throw new HttpError(404, 'Booking tidak ditemukan');
  if (query.vehicleId && !vehicle) throw new HttpError(404, 'Kendaraan tidak ditemukan');
  const origin = booking?.origin ?? query.origin;
  const destination = booking?.destination ?? query.destination;
  const passengers = booking?.passengerCount ?? query.passengers ?? null;
  if (!origin || !destination) throw new HttpError(400, 'Asal dan tujuan wajib diisi atau pilih booking');

  const candidates = routes.map((route) => {
    const originScore = textMatchScore(route.origin, origin);
    const destinationScore = textMatchScore(route.destination, destination);
    const matchScore = Math.min(originScore, destinationScore);
    const { warnings, penalty, blocked } = buildWarnings(route, { passengers, vehicle, matchScore });
    return {
      id: route.id,
      code: route.code,
      origin: route.origin,
      destination: route.destination,
      estimatedMinutes: route.estimatedMinutes,
      distanceKm: route.distanceKm,
      restrictions: route.restrictions,
      points: route.points,
      current: booking?.routeId === route.id,
      matchScore,
      warnings,
      blocked,
      score: route.estimatedMinutes + penalty,
    };
  });

  candidates.sort((a, b) => Number(a.blocked) - Number(b.blocked) || a.score - b.score || a.estimatedMinutes - b.estimatedMinutes);
  candidates.forEach((candidate, index) => {
    candidate.rank = index + 1;
  });

  res.json({
    input: {
      booking,
      vehicle,
      origin,
      destination,
      passengers,
    },
    rules: {
      scoring:
        'Skor = estimasi menit + 60 bila asal/tujuan tidak cocok (+20 bila cocok sebagian) + 10 per batas restriksi + 120 bila kapasitas kendaraan kurang + penalti titik rute tidak lengkap. Skor rendah diprioritaskan.',
      limitations: [
        'Estimasi berasal dari master rute (data DEMO), bukan mesin rute eksternal.',
        'Data kendaraan tidak memuat dimensi/bobot sehingga restriksi tinggi/bobot diverifikasi manual.',
        'Sistem hanya memberi rekomendasi; dispatcher menetapkan rute akhir pada booking.',
      ],
    },
    candidates,
    generatedAt: new Date().toISOString(),
  });
}));

router.post('/', requirePermission('routes:write'), asyncRoute(async (req, res) => {
  const data = createSchema.parse(req.body);
  const route = await prisma.route.create({
    data: {
      code: data.code || `RTE-${Date.now().toString(36).toUpperCase()}`,
      origin: data.origin,
      destination: data.destination,
      estimatedMinutes: data.estimatedMinutes,
      distanceKm: data.distanceKm,
      active: data.active ?? true,
      ...(data.restrictions ? { restrictions: cleanRestrictions(data.restrictions) } : {}),
    },
    include,
  });
  await writeAudit({ userId: req.user.id, action: 'ROUTE_CREATE', entity: 'Route', entityId: route.id, detail: `${route.origin} → ${route.destination}` });
  res.status(201).json(route);
}));

router.get('/:id', requirePermission('routes:read'), asyncRoute(async (req, res) => {
  const route = await prisma.route.findUnique({ where: { id: req.params.id }, include });
  if (!route) throw new HttpError(404, 'Rute tidak ditemukan');
  res.json(route);
}));

router.patch('/:id', requirePermission('routes:write'), asyncRoute(async (req, res) => {
  const data = updateSchema.parse(req.body);
  const existing = await prisma.route.findUnique({ where: { id: req.params.id } });
  if (!existing) throw new HttpError(404, 'Rute tidak ditemukan');
  const route = await prisma.route.update({
    where: { id: existing.id },
    data: {
      ...(data.code !== undefined && data.code !== null ? { code: data.code } : {}),
      ...(data.origin !== undefined ? { origin: data.origin } : {}),
      ...(data.destination !== undefined ? { destination: data.destination } : {}),
      ...(data.estimatedMinutes !== undefined ? { estimatedMinutes: data.estimatedMinutes } : {}),
      ...(data.distanceKm !== undefined ? { distanceKm: data.distanceKm } : {}),
      ...(data.active !== undefined ? { active: data.active } : {}),
      ...(data.restrictions !== undefined ? { restrictions: cleanRestrictions(data.restrictions) } : {}),
    },
    include,
  });
  await writeAudit({ userId: req.user.id, action: 'ROUTE_UPDATE', entity: 'Route', entityId: route.id, detail: `${route.origin} → ${route.destination}` });
  res.json(route);
}));

router.put('/:id/points', requirePermission('routes:write'), asyncRoute(async (req, res) => {
  const { points } = pointsSchema.parse(req.body);
  const route = await prisma.route.findUnique({ where: { id: req.params.id }, select: { id: true } });
  if (!route) throw new HttpError(404, 'Rute tidak ditemukan');

  const updated = await prisma.$transaction(async (tx) => {
    await tx.routePoint.deleteMany({ where: { routeId: route.id } });
    await tx.routePoint.createMany({
      data: points.map((point, index) => ({
        routeId: route.id,
        name: point.name,
        kind: point.kind,
        lat: point.lat,
        lng: point.lng,
        sequence: index + 1,
        notes: point.notes || null,
      })),
    });
    return tx.route.findUnique({ where: { id: route.id }, include });
  });
  await writeAudit({
    userId: req.user.id,
    action: 'ROUTE_POINTS_UPDATE',
    entity: 'Route',
    entityId: route.id,
    detail: `${updated.code}: ${points.length} titik`,
  });
  res.json(updated);
}));

router.delete('/:id', requirePermission('routes:delete'), asyncRoute(async (req, res) => {
  const route = await prisma.route.findUnique({
    where: { id: req.params.id },
    include: { _count: { select: { bookings: true } } },
  });
  if (!route) throw new HttpError(404, 'Rute tidak ditemukan');
  if (route._count.bookings > 0) {
    throw new HttpError(409, 'Rute sudah dipakai pada booking. Nonaktifkan rute sebagai gantinya.');
  }
  await prisma.route.delete({ where: { id: route.id } });
  await writeAudit({ userId: req.user.id, action: 'ROUTE_DELETE', entity: 'Route', entityId: route.id, detail: `${route.origin} → ${route.destination}` });
  res.json({ ok: true });
}));

export default router;
