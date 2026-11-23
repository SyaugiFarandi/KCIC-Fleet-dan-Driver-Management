import express from 'express';
import { z } from 'zod';
import { prisma } from '../db.js';
import { HttpError, asyncRoute, pagination, paged } from '../lib/http.js';
import { can, requirePermission } from '../lib/permissions.js';
import { writeAudit } from '../lib/audit.js';
import { notify } from '../lib/notifications.js';

const router = express.Router();

const templateItemSchema = z.object({
  key: z.string().trim().regex(/^[a-z0-9_]{2,40}$/, 'Key item tidak valid'),
  label: z.string().trim().min(3, 'Label item wajib diisi').max(140),
  critical: z.boolean().default(false),
});

const templateSchema = z
  .object({
    name: z.string().trim().min(3).max(120),
    description: z.string().trim().max(300).optional().nullable(),
    category: z.enum(['PRE_TRIP', 'POST_TRIP', 'RELEASE', 'GENERAL']).default('GENERAL'),
    items: z.array(templateItemSchema).min(1, 'Minimal 1 item inspeksi').max(30),
    active: z.boolean().optional(),
  })
  .refine((value) => new Set(value.items.map((item) => item.key)).size === value.items.length, {
    message: 'Key item inspeksi tidak boleh duplikat',
    path: ['items'],
  });

const createSchema = z.object({
  vehicleId: z.string().trim().optional(),
  driverId: z.string().trim().optional().nullable(),
  tripId: z.string().trim().optional().nullable(),
  templateId: z.string().trim().optional().nullable(),
  type: z.enum(['PRE_TRIP', 'POST_TRIP', 'RELEASE']),
  odometerKm: z.coerce.number().int().min(0).max(5_000_000).optional().nullable(),
  notes: z.string().trim().max(500).optional().nullable(),
});

const detailInclude = {
  vehicle: { select: { id: true, plateNumber: true, brand: true, model: true, status: true } },
  driver: { select: { id: true, name: true, userId: true } },
  trip: { select: { id: true, status: true, booking: { select: { code: true } } } },
  template: { select: { id: true, name: true, category: true } },
  startedBy: { select: { id: true, name: true } },
  completedBy: { select: { id: true, name: true } },
  items: { orderBy: { label: 'asc' } },
  defects: { orderBy: { createdAt: 'desc' } },
};

function scopeFor(user) {
  if (user.role === 'DRIVER') return { driver: { is: { userId: user.id } } };
  return {};
}

async function getInspection(id) {
  const inspection = await prisma.inspection.findUnique({ where: { id }, include: detailInclude });
  if (!inspection) throw new HttpError(404, 'Inspeksi tidak ditemukan');
  return inspection;
}

router.get('/templates', requirePermission('inspection:read'), asyncRoute(async (req, res) => {
  const items = await prisma.inspectionTemplate.findMany({
    where: req.query.includeInactive === 'true' ? {} : { active: true },
    orderBy: { name: 'asc' },
  });
  res.json({ items });
}));

router.post('/templates', requirePermission('inspection:template'), asyncRoute(async (req, res) => {
  const data = templateSchema.parse(req.body);
  const exists = await prisma.inspectionTemplate.findUnique({ where: { name: data.name } });
  if (exists) throw new HttpError(409, 'Nama template inspeksi sudah digunakan');
  const template = await prisma.inspectionTemplate.create({
    data: {
      name: data.name,
      description: data.description || '',
      category: data.category,
      items: data.items,
      active: data.active ?? true,
    },
  });
  await writeAudit({
    userId: req.user.id,
    action: 'INSPECTION_TEMPLATE_CREATE',
    entity: 'InspectionTemplate',
    entityId: template.id,
    detail: `${template.name} (${data.items.length} item)`,
  });
  res.status(201).json(template);
}));

router.patch('/templates/:id', requirePermission('inspection:template'), asyncRoute(async (req, res) => {
  const schema = templateSchema.partial();
  const data = schema.parse(req.body);
  const existing = await prisma.inspectionTemplate.findUnique({ where: { id: req.params.id } });
  if (!existing) throw new HttpError(404, 'Template inspeksi tidak ditemukan');
  const updated = await prisma.inspectionTemplate.update({
    where: { id: existing.id },
    data: {
      ...(data.name !== undefined ? { name: data.name } : {}),
      ...(data.description !== undefined ? { description: data.description || '' } : {}),
      ...(data.category !== undefined ? { category: data.category } : {}),
      ...(data.items !== undefined ? { items: data.items } : {}),
      ...(data.active !== undefined ? { active: data.active } : {}),
    },
  });
  await writeAudit({
    userId: req.user.id,
    action: 'INSPECTION_TEMPLATE_UPDATE',
    entity: 'InspectionTemplate',
    entityId: updated.id,
    detail: updated.name,
  });
  res.json(updated);
}));

router.get('/', requirePermission('inspection:read'), asyncRoute(async (req, res) => {
  const page = pagination(req);
  const { q, status, type, vehicleId, from, to } = req.query;
  const where = {
    ...scopeFor(req.user),
    ...(status ? { status } : {}),
    ...(type ? { type } : {}),
    ...(vehicleId ? { vehicleId } : {}),
    ...(from || to
      ? {
          createdAt: {
            ...(from ? { gte: new Date(from) } : {}),
            ...(to ? { lte: new Date(to) } : {}),
          },
        }
      : {}),
    ...(q
      ? {
          OR: [
            { vehicle: { is: { plateNumber: { contains: q, mode: 'insensitive' } } } },
            { driver: { is: { name: { contains: q, mode: 'insensitive' } } } },
            { notes: { contains: q, mode: 'insensitive' } },
          ],
        }
      : {}),
  };
  const [items, total] = await Promise.all([
    prisma.inspection.findMany({
      where,
      include: {
        vehicle: { select: { id: true, plateNumber: true, brand: true, model: true, status: true } },
        driver: { select: { id: true, name: true } },
        trip: { select: { id: true, booking: { select: { code: true } } } },
        template: { select: { id: true, name: true } },
        _count: { select: { items: true, defects: true } },
      },
      orderBy: { createdAt: 'desc' },
      skip: page.skip,
      take: page.take,
    }),
    prisma.inspection.count({ where }),
  ]);
  res.json(paged(items, total, page));
}));

router.get('/summary', requirePermission('inspection:read'), asyncRoute(async (req, res) => {
  if (req.user.role === 'DRIVER') throw new HttpError(403, 'Ringkasan inspeksi hanya untuk staf');
  const { from, to } = req.query;
  const fromDate = from ? new Date(from) : new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  const toDate = to ? new Date(to) : new Date();
  if (Number.isNaN(fromDate.getTime()) || Number.isNaN(toDate.getTime()) || fromDate > toDate) {
    throw new HttpError(400, 'Rentang tanggal inspeksi tidak valid');
  }
  const where = { createdAt: { gte: fromDate, lte: toDate }, ...scopeFor(req.user) };

  const [inspections, defects] = await Promise.all([
    prisma.inspection.findMany({ where, select: { type: true, status: true, createdAt: true } }),
    prisma.defect.findMany({
      where: { reportedAt: { gte: fromDate, lte: toDate } },
      include: { vehicle: { select: { plateNumber: true } } },
      orderBy: { reportedAt: 'desc' },
      take: 100,
    }),
  ]);

  const byStatus = { DRAFT: 0, PASSED: 0, DEFECTS: 0, FAILED: 0 };
  const byType = { PRE_TRIP: 0, POST_TRIP: 0, RELEASE: 0 };
  for (const inspection of inspections) {
    byStatus[inspection.status] = (byStatus[inspection.status] || 0) + 1;
    byType[inspection.type] = (byType[inspection.type] || 0) + 1;
  }
  const completed = byStatus.PASSED + byStatus.DEFECTS + byStatus.FAILED;
  const openDefects = defects.filter((defect) => defect.status !== 'RESOLVED');
  const bySeverity = { LOW: 0, MEDIUM: 0, HIGH: 0, CRITICAL: 0 };
  for (const defect of defects) bySeverity[defect.severity] = (bySeverity[defect.severity] || 0) + 1;

  res.json({
    range: { from: fromDate.toISOString(), to: toDate.toISOString() },
    totals: {
      inspections: inspections.length,
      completed,
      passRate: completed ? Math.round((byStatus.PASSED / completed) * 100) : null,
      drafts: byStatus.DRAFT,
      failed: byStatus.FAILED,
      openDefects: openDefects.length,
      criticalOpen: openDefects.filter((defect) => defect.severity === 'CRITICAL').length,
    },
    byStatus,
    byType,
    bySeverity,
    recentDefects: defects.slice(0, 8).map((defect) => ({
      id: defect.id,
      vehicle: defect.vehicle.plateNumber,
      title: defect.title,
      severity: defect.severity,
      status: defect.status,
      reportedAt: defect.reportedAt,
    })),
  });
}));

router.get('/:id', requirePermission('inspection:read'), asyncRoute(async (req, res) => {
  const inspection = await getInspection(req.params.id);
  if (req.user.role === 'DRIVER' && inspection.driver?.userId !== req.user.id) {
    throw new HttpError(403, 'Anda tidak memiliki akses ke inspeksi ini');
  }
  res.json(inspection);
}));

router.post('/', asyncRoute(async (req, res) => {
  const isDriver = req.user.role === 'DRIVER';
  if (!isDriver && !can(req.user.role, 'inspection:write')) {
    throw new HttpError(403, 'Anda tidak memiliki akses untuk membuat inspeksi');
  }
  const data = createSchema.parse(req.body);

  let vehicleId = data.vehicleId;
  let driverId = data.driverId || null;
  let tripId = data.tripId || null;

  if (isDriver) {
    if (!data.tripId) throw new HttpError(400, 'Driver wajib memilih trip untuk inspeksi');
    const trip = await prisma.trip.findUnique({ where: { id: data.tripId }, include: { driver: true } });
    if (!trip) throw new HttpError(404, 'Trip tidak ditemukan');
    if (trip.driver?.userId !== req.user.id) throw new HttpError(403, 'Anda hanya dapat membuat inspeksi untuk trip sendiri');
    vehicleId = trip.vehicleId;
    driverId = trip.driverId;
    tripId = trip.id;
  }

  if (!vehicleId) throw new HttpError(400, 'Kendaraan wajib dipilih');
  const vehicle = await prisma.vehicle.findUnique({ where: { id: vehicleId } });
  if (!vehicle) throw new HttpError(404, 'Kendaraan tidak ditemukan');

  if (tripId) {
    const trip = await prisma.trip.findUnique({ where: { id: tripId } });
    if (!trip) throw new HttpError(404, 'Trip tidak ditemukan');
    if (trip.vehicleId !== vehicleId) throw new HttpError(409, 'Trip tidak menggunakan kendaraan yang dipilih');
    driverId = driverId || trip.driverId;
  }
  if (driverId) {
    const driver = await prisma.driver.findUnique({ where: { id: driverId } });
    if (!driver) throw new HttpError(404, 'Driver tidak ditemukan');
  }

  let template = null;
  if (data.templateId) {
    template = await prisma.inspectionTemplate.findUnique({ where: { id: data.templateId } });
    if (!template || !template.active) throw new HttpError(404, 'Template inspeksi tidak ditemukan atau tidak aktif');
  } else {
    template =
      (await prisma.inspectionTemplate.findFirst({ where: { active: true, category: data.type }, orderBy: { name: 'asc' } })) ||
      (await prisma.inspectionTemplate.findFirst({ where: { active: true }, orderBy: { name: 'asc' } }));
    if (!template) throw new HttpError(400, 'Belum ada template inspeksi aktif');
  }

  const items = Array.isArray(template.items) ? template.items : [];
  const inspection = await prisma.inspection.create({
    data: {
      vehicleId,
      driverId,
      tripId,
      templateId: template.id,
      type: data.type,
      status: 'DRAFT',
      odometerKm: data.odometerKm ?? vehicle.odometerKm ?? null,
      notes: data.notes || '',
      startedById: req.user.id,
      items: {
        create: items.map((item) => ({
          key: item.key,
          label: item.label,
          critical: Boolean(item.critical),
          checked: false,
        })),
      },
    },
    include: detailInclude,
  });

  await writeAudit({
    userId: req.user.id,
    action: 'INSPECTION_CREATE',
    entity: 'Inspection',
    entityId: inspection.id,
    detail: `${inspection.vehicle.plateNumber}: ${inspection.type} (${template.name})`,
  });
  res.status(201).json(inspection);
}));

router.patch('/:id/items', requirePermission('inspection:write'), asyncRoute(async (req, res) => {
  const schema = z.object({
    items: z
      .array(
        z.object({
          key: z.string().trim(),
          checked: z.boolean(),
          note: z.string().trim().max(300).optional().nullable(),
        })
      )
      .min(1)
      .max(60),
  });
  const data = schema.parse(req.body);
  const inspection = await getInspection(req.params.id);
  if (inspection.status !== 'DRAFT') throw new HttpError(409, 'Hanya inspeksi DRAFT yang dapat diubah');
  if (req.user.role === 'DRIVER' && inspection.startedBy?.id !== req.user.id) {
    throw new HttpError(403, 'Anda tidak dapat mengubah inspeksi ini');
  }

  const known = new Set(inspection.items.map((item) => item.key));
  for (const entry of data.items) {
    if (!known.has(entry.key)) throw new HttpError(400, `Item inspeksi tidak dikenal: ${entry.key}`);
    await prisma.inspectionItem.update({
      where: { inspectionId_key: { inspectionId: inspection.id, key: entry.key } },
      data: { checked: entry.checked, note: entry.note || '' },
    });
  }

  const updated = await getInspection(inspection.id);
  res.json(updated);
}));

router.patch('/:id/complete', requirePermission('inspection:write'), asyncRoute(async (req, res) => {
  const schema = z.object({
    odometerKm: z.coerce.number().int().min(0).max(5_000_000).optional().nullable(),
    notes: z.string().trim().max(500).optional().nullable(),
  });
  const data = schema.parse(req.body ?? {});
  const inspection = await getInspection(req.params.id);
  if (inspection.status !== 'DRAFT') throw new HttpError(409, 'Inspeksi ini sudah diselesaikan');
  if (req.user.role === 'DRIVER' && inspection.startedBy?.id !== req.user.id) {
    throw new HttpError(403, 'Anda tidak dapat menyelesaikan inspeksi ini');
  }

  const failedItems = inspection.items.filter((item) => !item.checked);
  const criticalFailed = failedItems.some((item) => item.critical);
  const status = failedItems.length === 0 ? 'PASSED' : criticalFailed ? 'FAILED' : 'DEFECTS';

  const result = await prisma.$transaction(async (tx) => {
    const updated = await tx.inspection.update({
      where: { id: inspection.id },
      data: {
        status,
        completedAt: new Date(),
        completedById: req.user.id,
        odometerKm: data.odometerKm ?? inspection.odometerKm,
        notes: data.notes ?? inspection.notes,
      },
    });

    for (const item of failedItems) {
      const title = item.label.length > 120 ? item.label.slice(0, 120) : item.label;
      const existing = await tx.defect.findFirst({ where: { inspectionId: inspection.id, title } });
      if (existing) continue;
      await tx.defect.create({
        data: {
          vehicleId: inspection.vehicleId,
          inspectionId: inspection.id,
          title,
          description: item.note || `Ditemukan saat inspeksi ${inspection.type} (DEMO).`,
          severity: item.critical ? 'CRITICAL' : 'MEDIUM',
          status: 'OPEN',
          reportedById: req.user.id,
        },
      });
    }

    if (data.odometerKm != null && data.odometerKm > (inspection.vehicle.odometerKm || 0)) {
      await tx.vehicle.update({ where: { id: inspection.vehicleId }, data: { odometerKm: data.odometerKm } });
    }
    return updated;
  });

  await writeAudit({
    userId: req.user.id,
    action: 'INSPECTION_COMPLETE',
    entity: 'Inspection',
    entityId: inspection.id,
    detail: `${inspection.vehicle.plateNumber}: ${inspection.type} → ${status}${failedItems.length ? ` (${failedItems.length} temuan)` : ''}`,
  });

  if (criticalFailed) {
    const staff = await prisma.user.findMany({
      where: { active: true, role: { in: ['FLEET_MANAGER', 'MAINTENANCE_OFFICER', 'OPERATIONAL_MANAGER'] } },
      select: { id: true },
    });
    for (const staffUser of staff) {
      await notify({
        userId: staffUser.id,
        type: 'MAINTENANCE',
        title: `Inspeksi kritis gagal: ${inspection.vehicle.plateNumber}`,
        message: `${failedItems.filter((item) => item.critical).length} item kritis gagal. Kendaraan diblokir dari penugasan sampai defect kritis diselesaikan.`,
        link: '/inspection',
      });
    }
  }

  res.json(await getInspection(result.id));
}));

router.delete('/:id', asyncRoute(async (req, res) => {
  const inspection = await getInspection(req.params.id);
  if (inspection.status !== 'DRAFT') throw new HttpError(409, 'Hanya inspeksi DRAFT yang dapat dihapus');
  const canDelete = can(req.user.role, 'inspection:template') || inspection.startedBy?.id === req.user.id;
  if (!canDelete) throw new HttpError(403, 'Anda tidak dapat menghapus inspeksi ini');
  await prisma.inspection.delete({ where: { id: inspection.id } });
  await writeAudit({
    userId: req.user.id,
    action: 'INSPECTION_DELETE',
    entity: 'Inspection',
    entityId: inspection.id,
    detail: `${inspection.vehicle.plateNumber}: ${inspection.type}`,
  });
  res.json({ ok: true });
}));

export default router;
