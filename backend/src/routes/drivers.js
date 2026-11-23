import express from 'express';
import { z } from 'zod';
import { prisma } from '../db.js';
import { HttpError, asyncRoute, pagination, paged } from '../lib/http.js';
import { requirePermission } from '../lib/permissions.js';
import { writeAudit } from '../lib/audit.js';
import { ACTIVE_TRIP_STATUSES } from '../lib/workflow.js';

const router = express.Router();

const baseSchema = {
  name: z.string().trim().min(2, 'Nama minimal 2 karakter').max(120),
  phone: z.string().trim().min(6, 'Nomor telepon wajib diisi').max(30),
  licenseNumber: z.string().trim().min(3, 'Nomor SIM wajib diisi').max(40),
  licenseCategory: z.string().trim().max(20).optional(),
  licenseExpiry: z.coerce.date({ error: 'Tanggal SIM tidak valid' }),
  type: z.enum(['INTERNAL', 'VENDOR']).default('INTERNAL'),
  vendorId: z.string().trim().optional().nullable(),
  userId: z.string().trim().optional().nullable(),
  notes: z.string().trim().max(500).optional().nullable(),
  active: z.boolean().optional(),
};

const createSchema = z.object(baseSchema);
const updateSchema = z.object({
  name: baseSchema.name.optional(),
  phone: baseSchema.phone.optional(),
  licenseNumber: baseSchema.licenseNumber.optional(),
  licenseCategory: baseSchema.licenseCategory,
  licenseExpiry: baseSchema.licenseExpiry.optional(),
  type: baseSchema.type.optional(),
  vendorId: baseSchema.vendorId,
  userId: baseSchema.userId,
  notes: baseSchema.notes,
  active: baseSchema.active,
});

async function resolveRelations(type, vendorId, userId, ignoreDriverId) {
  let resolvedVendorId = null;
  if (type === 'VENDOR') {
    if (!vendorId) throw new HttpError(400, 'Vendor wajib dipilih untuk driver vendor');
    const vendor = await prisma.vendor.findUnique({ where: { id: vendorId } });
    if (!vendor) throw new HttpError(404, 'Vendor tidak ditemukan');
    resolvedVendorId = vendorId;
  }

  let resolvedUserId = null;
  if (userId) {
    const user = await prisma.user.findUnique({ where: { id: userId }, include: { driverProfile: true } });
    if (!user) throw new HttpError(404, 'Akun pengguna tidak ditemukan');
    if (user.role !== 'DRIVER') throw new HttpError(400, 'Akun yang ditautkan harus memiliki role Driver');
    if (user.driverProfile && user.driverProfile.id !== ignoreDriverId) {
      throw new HttpError(409, 'Akun pengguna sudah tertaut ke driver lain');
    }
    resolvedUserId = userId;
  }
  return { vendorId: resolvedVendorId, userId: resolvedUserId };
}

const driverInclude = {
  vendor: { select: { id: true, name: true } },
  user: { select: { id: true, email: true, active: true } },
  _count: { select: { trips: true } },
};

router.get('/user-candidates', requirePermission('drivers:write'), asyncRoute(async (req, res) => {
  const items = await prisma.user.findMany({
    where: { role: 'DRIVER', active: true },
    select: { id: true, name: true, email: true, driverProfile: { select: { id: true, name: true } } },
    orderBy: { name: 'asc' },
  });
  res.json({ items });
}));

router.get('/', requirePermission('drivers:read'), asyncRoute(async (req, res) => {
  const page = pagination(req);
  const { q, type, available, vendorId, active } = req.query;
  const where = {
    ...(q
      ? {
          OR: [
            { name: { contains: q, mode: 'insensitive' } },
            { phone: { contains: q, mode: 'insensitive' } },
            { licenseNumber: { contains: q, mode: 'insensitive' } },
          ],
        }
      : {}),
    ...(type ? { type } : {}),
    ...(available === 'true' ? { available: true } : available === 'false' ? { available: false } : {}),
    ...(active === 'true' ? { active: true } : active === 'false' ? { active: false } : {}),
    ...(vendorId ? { vendorId } : {}),
  };
  const [items, total] = await Promise.all([
    prisma.driver.findMany({ where, include: driverInclude, orderBy: { name: 'asc' }, skip: page.skip, take: page.take }),
    prisma.driver.count({ where }),
  ]);
  res.json(paged(items, total, page));
}));

router.post('/', requirePermission('drivers:write'), asyncRoute(async (req, res) => {
  const data = createSchema.parse(req.body);
  const relations = await resolveRelations(data.type, data.vendorId, data.userId, null);
  const driver = await prisma.driver.create({
    data: {
      name: data.name,
      phone: data.phone,
      licenseNumber: data.licenseNumber.toUpperCase(),
      licenseCategory: data.licenseCategory || 'SIM A',
      licenseExpiry: data.licenseExpiry,
      type: data.type,
      vendorId: relations.vendorId,
      userId: relations.userId,
      notes: data.notes || null,
      active: data.active ?? true,
    },
    include: driverInclude,
  });
  await writeAudit({ userId: req.user.id, action: 'DRIVER_CREATE', entity: 'Driver', entityId: driver.id, detail: driver.name });
  res.status(201).json(driver);
}));

router.patch('/:id', requirePermission('drivers:write'), asyncRoute(async (req, res) => {
  const data = updateSchema.parse(req.body);
  const current = await prisma.driver.findUnique({ where: { id: req.params.id } });
  if (!current) throw new HttpError(404, 'Driver tidak ditemukan');

  if (data.active === false) {
    const activeTrips = await prisma.trip.count({
      where: { driverId: current.id, status: { in: ACTIVE_TRIP_STATUSES } },
    });
    if (activeTrips > 0) throw new HttpError(409, 'Driver masih memiliki trip aktif dan tidak dapat dinonaktifkan');
  }

  const type = data.type ?? current.type;
  const relations = await resolveRelations(
    type,
    data.vendorId !== undefined ? data.vendorId : current.vendorId,
    data.userId !== undefined ? data.userId : current.userId,
    current.id
  );

  const driver = await prisma.driver.update({
    where: { id: current.id },
    data: {
      ...(data.name !== undefined ? { name: data.name } : {}),
      ...(data.phone !== undefined ? { phone: data.phone } : {}),
      ...(data.licenseNumber !== undefined ? { licenseNumber: data.licenseNumber.toUpperCase() } : {}),
      ...(data.licenseCategory !== undefined ? { licenseCategory: data.licenseCategory || 'SIM A' } : {}),
      ...(data.licenseExpiry !== undefined ? { licenseExpiry: data.licenseExpiry } : {}),
      ...(data.type !== undefined ? { type: data.type } : {}),
      ...(data.notes !== undefined ? { notes: data.notes || null } : {}),
      ...(data.active !== undefined ? { active: data.active, ...(data.active === false ? { available: false } : {}) } : {}),
      vendorId: relations.vendorId,
      userId: relations.userId,
    },
    include: driverInclude,
  });
  await writeAudit({ userId: req.user.id, action: 'DRIVER_UPDATE', entity: 'Driver', entityId: driver.id, detail: driver.name });
  res.json(driver);
}));

router.delete('/:id', requirePermission('drivers:delete'), asyncRoute(async (req, res) => {
  const driver = await prisma.driver.findUnique({
    where: { id: req.params.id },
    include: { _count: { select: { trips: true } } },
  });
  if (!driver) throw new HttpError(404, 'Driver tidak ditemukan');
  if (driver._count.trips > 0) {
    throw new HttpError(409, 'Driver memiliki riwayat trip. Nonaktifkan driver sebagai gantinya.');
  }
  await prisma.driver.delete({ where: { id: driver.id } });
  await writeAudit({ userId: req.user.id, action: 'DRIVER_DELETE', entity: 'Driver', entityId: driver.id, detail: driver.name });
  res.json({ ok: true });
}));

export default router;
