import express from 'express';
import { z } from 'zod';
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

const createSchema = z.object({
  code: codeSchema,
  origin: z.string().trim().min(2, 'Asal wajib diisi').max(120),
  destination: z.string().trim().min(2, 'Tujuan wajib diisi').max(120),
  estimatedMinutes: z.coerce.number().int().min(1, 'Estimasi minimal 1 menit').max(1440, 'Estimasi maksimal 24 jam'),
  distanceKm: z.coerce.number().min(0.1, 'Jarak minimal 0.1 km').max(2000, 'Jarak maksimal 2000 km'),
  active: z.boolean().optional(),
});

const updateSchema = createSchema.partial();

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
    prisma.route.findMany({ where, orderBy: [{ origin: 'asc' }, { destination: 'asc' }], skip: page.skip, take: page.take }),
    prisma.route.count({ where }),
  ]);
  res.json(paged(items, total, page));
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
    },
  });
  await writeAudit({ userId: req.user.id, action: 'ROUTE_CREATE', entity: 'Route', entityId: route.id, detail: `${route.origin} → ${route.destination}` });
  res.status(201).json(route);
}));

router.patch('/:id', requirePermission('routes:write'), asyncRoute(async (req, res) => {
  const data = updateSchema.parse(req.body);
  const route = await prisma.route.update({
    where: { id: req.params.id },
    data: {
      ...(data.code !== undefined && data.code !== null ? { code: data.code } : {}),
      ...(data.origin !== undefined ? { origin: data.origin } : {}),
      ...(data.destination !== undefined ? { destination: data.destination } : {}),
      ...(data.estimatedMinutes !== undefined ? { estimatedMinutes: data.estimatedMinutes } : {}),
      ...(data.distanceKm !== undefined ? { distanceKm: data.distanceKm } : {}),
      ...(data.active !== undefined ? { active: data.active } : {}),
    },
  });
  await writeAudit({ userId: req.user.id, action: 'ROUTE_UPDATE', entity: 'Route', entityId: route.id, detail: `${route.origin} → ${route.destination}` });
  res.json(route);
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
