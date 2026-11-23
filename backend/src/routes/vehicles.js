import express from 'express';
import { z } from 'zod';
import { prisma } from '../db.js';
import { HttpError, asyncRoute, pagination, paged } from '../lib/http.js';
import { requirePermission } from '../lib/permissions.js';
import { writeAudit } from '../lib/audit.js';
import { ACTIVE_TRIP_STATUSES } from '../lib/workflow.js';
import { CHECKLIST_MAX_ITEMS, normalizeChecklistItems } from '../lib/checklist.js';

const router = express.Router();

const checklistItemsSchema = z
  .array(z.string().trim().min(3, 'Item checklist minimal 3 karakter').max(120, 'Item checklist maksimal 120 karakter'))
  .max(CHECKLIST_MAX_ITEMS, `Maksimal ${CHECKLIST_MAX_ITEMS} item checklist`)
  .optional()
  .nullable();

const baseSchema = {
  plateNumber: z.string().trim().min(3, 'Nomor polisi minimal 3 karakter').max(20),
  brand: z.string().trim().min(1, 'Merek wajib diisi').max(60),
  model: z.string().trim().min(1, 'Model wajib diisi').max(60),
  category: z.string().trim().min(2, 'Kategori wajib diisi').max(40),
  capacity: z.coerce.number().int().min(1, 'Kapasitas minimal 1').max(80, 'Kapasitas maksimal 80'),
  ownership: z.enum(['KCIC', 'VENDOR']).default('KCIC'),
  year: z.coerce.number().int().min(1990).max(new Date().getFullYear() + 1).optional().nullable(),
  color: z.string().trim().max(30).optional().nullable(),
  odometerKm: z.coerce.number().int().min(0).max(2_000_000).optional().nullable(),
  lastServiceAt: z.coerce.date().optional().nullable(),
  stnkExpiry: z.coerce.date({ invalid_type_error: 'Tanggal STNK tidak valid' }).optional().nullable(),
  insuranceExpiry: z.coerce.date({ invalid_type_error: 'Tanggal asuransi tidak valid' }).optional().nullable(),
  notes: z.string().trim().max(500).optional().nullable(),
  vendorId: z.string().trim().optional().nullable(),
  status: z.enum(['AVAILABLE', 'INACTIVE']).optional(),
  checklistItems: checklistItemsSchema,
};

const createSchema = z.object(baseSchema);
const updateSchema = z.object({
  plateNumber: baseSchema.plateNumber.optional(),
  brand: baseSchema.brand.optional(),
  model: baseSchema.model.optional(),
  category: baseSchema.category.optional(),
  capacity: baseSchema.capacity.optional(),
  ownership: baseSchema.ownership.optional(),
  year: baseSchema.year,
  color: baseSchema.color,
  odometerKm: baseSchema.odometerKm,
  lastServiceAt: baseSchema.lastServiceAt,
  stnkExpiry: baseSchema.stnkExpiry,
  insuranceExpiry: baseSchema.insuranceExpiry,
  notes: baseSchema.notes,
  vendorId: baseSchema.vendorId,
  status: baseSchema.status,
  checklistItems: checklistItemsSchema,
});

function checklistTemplateFrom(items) {
  if (!Array.isArray(items)) return null;
  const normalized = normalizeChecklistItems(items);
  return normalized.length ? { items: normalized } : null;
}

async function resolveVendor(ownership, vendorId) {
  if (ownership === 'VENDOR') {
    if (!vendorId) throw new HttpError(400, 'Vendor wajib dipilih untuk kendaraan milik vendor');
    const vendor = await prisma.vendor.findUnique({ where: { id: vendorId } });
    if (!vendor) throw new HttpError(404, 'Vendor tidak ditemukan');
    return vendorId;
  }
  return null;
}

router.get('/', requirePermission('vehicles:read'), asyncRoute(async (req, res) => {
  const page = pagination(req);
  const { q, status, ownership, vendorId } = req.query;
  const where = {
    ...(q
      ? {
          OR: [
            { plateNumber: { contains: q, mode: 'insensitive' } },
            { brand: { contains: q, mode: 'insensitive' } },
            { model: { contains: q, mode: 'insensitive' } },
          ],
        }
      : {}),
    ...(status ? { status } : {}),
    ...(ownership ? { ownership } : {}),
    ...(vendorId ? { vendorId } : {}),
  };
  const [items, total] = await Promise.all([
    prisma.vehicle.findMany({
      where,
      include: {
        vendor: { select: { id: true, name: true } },
        _count: { select: { trips: true, maintenance: true } },
      },
      orderBy: { plateNumber: 'asc' },
      skip: page.skip,
      take: page.take,
    }),
    prisma.vehicle.count({ where }),
  ]);
  res.json(paged(items, total, page));
}));

router.post('/', requirePermission('vehicles:write'), asyncRoute(async (req, res) => {
  const data = createSchema.parse(req.body);
  const vendorId = await resolveVendor(data.ownership, data.vendorId);
  const vehicle = await prisma.vehicle.create({
    data: {
      plateNumber: data.plateNumber.toUpperCase(),
      brand: data.brand,
      model: data.model,
      category: data.category,
      capacity: data.capacity,
      ownership: data.ownership,
      year: data.year ?? null,
      color: data.color || null,
      odometerKm: data.odometerKm ?? null,
      lastServiceAt: data.lastServiceAt ?? null,
      stnkExpiry: data.stnkExpiry ?? null,
      insuranceExpiry: data.insuranceExpiry ?? null,
      notes: data.notes || null,
      status: data.status || 'AVAILABLE',
      vendorId,
      checklistTemplate: checklistTemplateFrom(data.checklistItems),
    },
    include: { vendor: { select: { id: true, name: true } } },
  });
  await writeAudit({ userId: req.user.id, action: 'VEHICLE_CREATE', entity: 'Vehicle', entityId: vehicle.id, detail: vehicle.plateNumber });
  res.status(201).json(vehicle);
}));

router.patch('/:id', requirePermission('vehicles:write'), asyncRoute(async (req, res) => {
  const data = updateSchema.parse(req.body);
  const current = await prisma.vehicle.findUnique({ where: { id: req.params.id } });
  if (!current) throw new HttpError(404, 'Kendaraan tidak ditemukan');

  if (data.status && ['ASSIGNED', 'MAINTENANCE'].includes(current.status)) {
    throw new HttpError(409, 'Status kendaraan sedang dikelola otomatis oleh trip atau maintenance');
  }
  if (data.status === 'INACTIVE') {
    const active = await prisma.trip.count({
      where: { vehicleId: current.id, status: { in: ACTIVE_TRIP_STATUSES } },
    });
    if (active > 0) throw new HttpError(409, 'Kendaraan masih memiliki trip aktif dan tidak dapat dinonaktifkan');
  }

  const ownership = data.ownership ?? current.ownership;
  const vendorId = await resolveVendor(ownership, data.vendorId !== undefined ? data.vendorId : current.vendorId);

  const vehicle = await prisma.vehicle.update({
    where: { id: current.id },
    data: {
      ...(data.plateNumber !== undefined ? { plateNumber: data.plateNumber.toUpperCase() } : {}),
      ...(data.brand !== undefined ? { brand: data.brand } : {}),
      ...(data.model !== undefined ? { model: data.model } : {}),
      ...(data.category !== undefined ? { category: data.category } : {}),
      ...(data.capacity !== undefined ? { capacity: data.capacity } : {}),
      ...(data.ownership !== undefined ? { ownership: data.ownership } : {}),
      ...(data.year !== undefined ? { year: data.year ?? null } : {}),
      ...(data.color !== undefined ? { color: data.color || null } : {}),
      ...(data.odometerKm !== undefined ? { odometerKm: data.odometerKm ?? null } : {}),
      ...(data.lastServiceAt !== undefined ? { lastServiceAt: data.lastServiceAt ?? null } : {}),
      ...(data.stnkExpiry !== undefined ? { stnkExpiry: data.stnkExpiry ?? null } : {}),
      ...(data.insuranceExpiry !== undefined ? { insuranceExpiry: data.insuranceExpiry ?? null } : {}),
      ...(data.notes !== undefined ? { notes: data.notes || null } : {}),
      ...(data.status !== undefined ? { status: data.status } : {}),
      ...(data.checklistItems !== undefined ? { checklistTemplate: checklistTemplateFrom(data.checklistItems) } : {}),
      vendorId,
    },
    include: { vendor: { select: { id: true, name: true } } },
  });
  await writeAudit({ userId: req.user.id, action: 'VEHICLE_UPDATE', entity: 'Vehicle', entityId: vehicle.id, detail: vehicle.plateNumber });
  res.json(vehicle);
}));

router.delete('/:id', requirePermission('vehicles:delete'), asyncRoute(async (req, res) => {
  const vehicle = await prisma.vehicle.findUnique({
    where: { id: req.params.id },
    include: { _count: { select: { trips: true, maintenance: true } } },
  });
  if (!vehicle) throw new HttpError(404, 'Kendaraan tidak ditemukan');
  if (vehicle._count.trips > 0 || vehicle._count.maintenance > 0) {
    throw new HttpError(409, 'Kendaraan memiliki riwayat trip/maintenance. Nonaktifkan kendaraan sebagai gantinya.');
  }
  await prisma.vehicle.delete({ where: { id: vehicle.id } });
  await writeAudit({ userId: req.user.id, action: 'VEHICLE_DELETE', entity: 'Vehicle', entityId: vehicle.id, detail: vehicle.plateNumber });
  res.json({ ok: true });
}));

export default router;
