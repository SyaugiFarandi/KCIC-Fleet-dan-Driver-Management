import express from 'express';
import { z } from 'zod';
import { prisma } from '../db.js';
import { HttpError, asyncRoute, pagination, paged } from '../lib/http.js';
import { requirePermission } from '../lib/permissions.js';
import { writeAudit } from '../lib/audit.js';
import { ACTIVE_TRIP_STATUSES } from '../lib/workflow.js';
import { refreshVehicleStatus } from '../lib/resourceStatus.js';
import { buildPredictions, severityPriority } from '../lib/maintenancePrediction.js';

const router = express.Router();

const KINDS = ['PREVENTIVE', 'CORRECTIVE', 'INSPECTION'];
const PRIORITIES = ['LOW', 'NORMAL', 'HIGH', 'URGENT'];

const createSchema = z.object({
  vehicleId: z.string().trim().min(1, 'Kendaraan wajib dipilih'),
  title: z.string().trim().min(3, 'Jenis perawatan wajib diisi').max(120),
  description: z.string().trim().max(500).optional().nullable(),
  scheduledAt: z.coerce.date({ invalid_type_error: 'Jadwal maintenance tidak valid' }),
  cost: z.coerce.number().min(0, 'Biaya tidak boleh negatif').max(1_000_000_000).optional().default(0),
  kind: z.enum(KINDS).optional(),
  priority: z.enum(PRIORITIES).optional(),
  defectId: z.string().trim().min(1).optional().nullable(),
});

const updateSchema = z.object({
  title: z.string().trim().min(3).max(120).optional(),
  description: z.string().trim().max(500).optional().nullable(),
  scheduledAt: z.coerce.date().optional(),
  cost: z.coerce.number().min(0).max(1_000_000_000).optional(),
  kind: z.enum(KINDS).optional(),
  priority: z.enum(PRIORITIES).optional(),
});

const include = {
  vehicle: { select: { id: true, plateNumber: true, brand: true, model: true, status: true } },
  createdBy: { select: { id: true, name: true } },
  requestedBy: { select: { id: true, name: true } },
  defects: { select: { id: true, title: true, severity: true, status: true, inspectionId: true } },
};


async function getItem(id) {
  const item = await prisma.maintenance.findUnique({ where: { id }, include });
  if (!item) throw new HttpError(404, 'Data maintenance tidak ditemukan');
  return item;
}

router.get('/', requirePermission('maintenance:read'), asyncRoute(async (req, res) => {
  const page = pagination(req);
  const { q, status, vehicleId, kind, priority } = req.query;
  const where = {
    ...(q
      ? {
          OR: [
            { title: { contains: q, mode: 'insensitive' } },
            { description: { contains: q, mode: 'insensitive' } },
            { vehicle: { is: { plateNumber: { contains: q, mode: 'insensitive' } } } },
          ],
        }
      : {}),
    ...(status ? { status } : {}),
    ...(vehicleId ? { vehicleId } : {}),
    ...(kind && KINDS.includes(kind) ? { kind } : {}),
    ...(priority && PRIORITIES.includes(priority) ? { priority } : {}),
  };
  const [items, total] = await Promise.all([
    prisma.maintenance.findMany({ where, include, orderBy: { scheduledAt: 'desc' }, skip: page.skip, take: page.take }),
    prisma.maintenance.count({ where }),
  ]);
  res.json(paged(items, total, page));
}));

router.get('/predictions', requirePermission('maintenance:read'), asyncRoute(async (_req, res) => {
  res.json(await buildPredictions(prisma));
}));

router.post('/', requirePermission('maintenance:write'), asyncRoute(async (req, res) => {
  const data = createSchema.parse(req.body);
  const vehicle = await prisma.vehicle.findUnique({ where: { id: data.vehicleId } });
  if (!vehicle) throw new HttpError(404, 'Kendaraan tidak ditemukan');
  if (vehicle.status === 'INACTIVE') throw new HttpError(409, 'Kendaraan tidak aktif dan tidak dapat dijadwalkan maintenance');

  let defect = null;
  if (data.defectId) {
    defect = await prisma.defect.findUnique({ where: { id: data.defectId } });
    if (!defect) throw new HttpError(404, 'Defect tidak ditemukan');
    if (defect.vehicleId !== data.vehicleId) throw new HttpError(409, 'Defect bukan milik kendaraan yang dipilih');
    if (defect.status === 'RESOLVED') throw new HttpError(409, 'Defect sudah selesai dan tidak perlu work order');
  }

  const kind = data.kind || (defect ? 'CORRECTIVE' : 'PREVENTIVE');
  const priority = data.priority || (defect ? severityPriority(defect.severity) : 'NORMAL');

  const item = await prisma.$transaction(async (tx) => {
    const created = await tx.maintenance.create({
      data: {
        vehicleId: data.vehicleId,
        title: data.title,
        description: data.description || '',
        scheduledAt: data.scheduledAt,
        cost: data.cost ?? 0,
        kind,
        priority,
        createdById: req.user.id,
        requestedById: req.user.id,
        status: 'PLANNED',
      },
      include,
    });
    if (defect) {
      await tx.defect.update({
        where: { id: defect.id },
        data: { maintenanceId: created.id, status: defect.status === 'OPEN' ? 'IN_REPAIR' : defect.status },
      });
    }
    return tx.maintenance.findUnique({ where: { id: created.id }, include });
  });
  await writeAudit({
    userId: req.user.id,
    action: 'MAINTENANCE_CREATE',
    entity: 'Maintenance',
    entityId: item.id,
    detail: `${item.vehicle.plateNumber}: ${item.title}${defect ? ` (defect ${defect.title})` : ''}`,
  });
  res.status(201).json(item);
}));


router.patch('/:id', requirePermission('maintenance:write'), asyncRoute(async (req, res) => {
  const data = updateSchema.parse(req.body);
  const current = await getItem(req.params.id);
  if (current.status !== 'PLANNED') throw new HttpError(409, 'Hanya maintenance berstatus PLANNED yang dapat diubah');

  const item = await prisma.maintenance.update({
    where: { id: current.id },
    data: {
      ...(data.title !== undefined ? { title: data.title } : {}),
      ...(data.description !== undefined ? { description: data.description || '' } : {}),
      ...(data.scheduledAt !== undefined ? { scheduledAt: data.scheduledAt } : {}),
      ...(data.cost !== undefined ? { cost: data.cost } : {}),
      ...(data.kind !== undefined ? { kind: data.kind } : {}),
      ...(data.priority !== undefined ? { priority: data.priority } : {}),
    },
    include,
  });
  await writeAudit({ userId: req.user.id, action: 'MAINTENANCE_UPDATE', entity: 'Maintenance', entityId: item.id, detail: item.title });
  res.json(item);
}));

router.patch('/:id/start', requirePermission('maintenance:write'), asyncRoute(async (req, res) => {
  const item = await getItem(req.params.id);
  if (item.status !== 'PLANNED') throw new HttpError(409, `Maintenance berstatus ${item.status} tidak dapat dimulai`);

  const activeMaintenance = await prisma.maintenance.count({
    where: { vehicleId: item.vehicleId, status: 'IN_PROGRESS', id: { not: item.id } },
  });
  if (activeMaintenance > 0) throw new HttpError(409, 'Kendaraan sedang memiliki maintenance lain yang berjalan');

  const activeTrips = await prisma.trip.count({
    where: { vehicleId: item.vehicleId, status: { in: ACTIVE_TRIP_STATUSES } },
  });
  if (activeTrips > 0) {
    throw new HttpError(409, 'Kendaraan masih memiliki trip aktif. Selesaikan atau batalkan trip terlebih dahulu.');
  }

  const updated = await prisma.$transaction(async (tx) => {
    const result = await tx.maintenance.update({
      where: { id: item.id },
      data: { status: 'IN_PROGRESS', startedAt: new Date() },
      include,
    });
    await refreshVehicleStatus(tx, item.vehicleId);
    return result;
  });
  await writeAudit({
    userId: req.user.id,
    action: 'MAINTENANCE_START',
    entity: 'Maintenance',
    entityId: item.id,
    detail: `${updated.vehicle.plateNumber}: ${updated.title}`,
  });
  res.json(updated);
}));

router.patch('/:id/complete', requirePermission('maintenance:write'), asyncRoute(async (req, res) => {
  const schema = z.object({ cost: z.coerce.number().min(0).max(1_000_000_000).optional() });
  const data = schema.parse(req.body ?? {});
  const item = await getItem(req.params.id);
  if (item.status !== 'IN_PROGRESS') throw new HttpError(409, 'Hanya maintenance yang sedang berjalan yang dapat diselesaikan');

  const now = new Date();
  const updated = await prisma.$transaction(async (tx) => {
    const result = await tx.maintenance.update({
      where: { id: item.id },
      data: {
        status: 'COMPLETED',
        completedAt: now,
        ...(data.cost !== undefined ? { cost: data.cost } : {}),
      },
      include,
    });
    await tx.vehicle.update({ where: { id: item.vehicleId }, data: { lastServiceAt: now } });
    const linkedDefects = await tx.defect.findMany({
      where: { maintenanceId: item.id, status: { not: 'RESOLVED' } },
      select: { id: true, resolutionNote: true },
    });
    for (const defect of linkedDefects) {
      await tx.defect.update({
        where: { id: defect.id },
        data: {
          status: 'RESOLVED',
          resolvedAt: now,
          ...(defect.resolutionNote ? {} : { resolutionNote: `Diselesaikan melalui work order: ${item.title}` }),
        },
      });
    }
    await refreshVehicleStatus(tx, item.vehicleId);
    return tx.maintenance.findUnique({ where: { id: item.id }, include });
  });
  await writeAudit({
    userId: req.user.id,
    action: 'MAINTENANCE_COMPLETE',
    entity: 'Maintenance',
    entityId: item.id,
    detail: `${updated.vehicle.plateNumber}: ${updated.title}`,
  });
  res.json(updated);
}));


router.patch('/:id/cancel', requirePermission('maintenance:write'), asyncRoute(async (req, res) => {
  const item = await getItem(req.params.id);
  if (!['PLANNED', 'IN_PROGRESS'].includes(item.status)) {
    throw new HttpError(409, 'Maintenance ini tidak dapat dibatalkan');
  }
  const updated = await prisma.$transaction(async (tx) => {
    const result = await tx.maintenance.update({
      where: { id: item.id },
      data: { status: 'CANCELLED' },
      include,
    });
    if (item.status === 'IN_PROGRESS') await refreshVehicleStatus(tx, item.vehicleId);
    await tx.defect.updateMany({ where: { maintenanceId: item.id, status: 'IN_REPAIR' }, data: { status: 'OPEN' } });
    await tx.defect.updateMany({ where: { maintenanceId: item.id }, data: { maintenanceId: null } });
    return result;
  });
  await writeAudit({
    userId: req.user.id,
    action: 'MAINTENANCE_CANCEL',
    entity: 'Maintenance',
    entityId: item.id,
    detail: `${updated.vehicle.plateNumber}: ${updated.title}`,
  });
  res.json(updated);
}));

router.delete('/:id', requirePermission('maintenance:delete'), asyncRoute(async (req, res) => {
  const item = await getItem(req.params.id);
  if (!['PLANNED', 'CANCELLED'].includes(item.status)) {
    throw new HttpError(409, 'Hanya maintenance berstatus PLANNED/CANCELLED yang dapat dihapus');
  }
  await prisma.$transaction(async (tx) => {
    await tx.defect.updateMany({ where: { maintenanceId: item.id, status: 'IN_REPAIR' }, data: { status: 'OPEN' } });
    await tx.defect.updateMany({ where: { maintenanceId: item.id }, data: { maintenanceId: null } });
    await tx.maintenance.delete({ where: { id: item.id } });
  });
  await writeAudit({
    userId: req.user.id,
    action: 'MAINTENANCE_DELETE',
    entity: 'Maintenance',
    entityId: item.id,
    detail: `${item.vehicle.plateNumber}: ${item.title}`,
  });
  res.json({ ok: true });
}));

export default router;
