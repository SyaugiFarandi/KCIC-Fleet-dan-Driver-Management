import express from 'express';
import { z } from 'zod';
import { prisma } from '../db.js';
import { HttpError, asyncRoute, pagination, paged } from '../lib/http.js';
import { requirePermission } from '../lib/permissions.js';
import { writeAudit } from '../lib/audit.js';
import { ACTIVE_TRIP_STATUSES } from '../lib/workflow.js';
import { refreshVehicleStatus } from '../lib/resourceStatus.js';

const router = express.Router();

const createSchema = z.object({
  vehicleId: z.string().trim().min(1, 'Kendaraan wajib dipilih'),
  title: z.string().trim().min(3, 'Jenis perawatan wajib diisi').max(120),
  description: z.string().trim().max(500).optional().nullable(),
  scheduledAt: z.coerce.date({ invalid_type_error: 'Jadwal maintenance tidak valid' }),
  cost: z.coerce.number().min(0, 'Biaya tidak boleh negatif').max(1_000_000_000).optional().default(0),
});

const updateSchema = z.object({
  title: z.string().trim().min(3).max(120).optional(),
  description: z.string().trim().max(500).optional().nullable(),
  scheduledAt: z.coerce.date().optional(),
  cost: z.coerce.number().min(0).max(1_000_000_000).optional(),
});

const include = {
  vehicle: { select: { id: true, plateNumber: true, brand: true, model: true, status: true } },
  createdBy: { select: { id: true, name: true } },
};

async function getItem(id) {
  const item = await prisma.maintenance.findUnique({ where: { id }, include });
  if (!item) throw new HttpError(404, 'Data maintenance tidak ditemukan');
  return item;
}

router.get('/', requirePermission('maintenance:read'), asyncRoute(async (req, res) => {
  const page = pagination(req);
  const { q, status, vehicleId } = req.query;
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
  };
  const [items, total] = await Promise.all([
    prisma.maintenance.findMany({ where, include, orderBy: { scheduledAt: 'desc' }, skip: page.skip, take: page.take }),
    prisma.maintenance.count({ where }),
  ]);
  res.json(paged(items, total, page));
}));

router.post('/', requirePermission('maintenance:write'), asyncRoute(async (req, res) => {
  const data = createSchema.parse(req.body);
  const vehicle = await prisma.vehicle.findUnique({ where: { id: data.vehicleId } });
  if (!vehicle) throw new HttpError(404, 'Kendaraan tidak ditemukan');
  if (vehicle.status === 'INACTIVE') throw new HttpError(409, 'Kendaraan tidak aktif dan tidak dapat dijadwalkan maintenance');

  const item = await prisma.maintenance.create({
    data: {
      vehicleId: data.vehicleId,
      title: data.title,
      description: data.description || '',
      scheduledAt: data.scheduledAt,
      cost: data.cost ?? 0,
      createdById: req.user.id,
      status: 'PLANNED',
    },
    include,
  });
  await writeAudit({
    userId: req.user.id,
    action: 'MAINTENANCE_CREATE',
    entity: 'Maintenance',
    entityId: item.id,
    detail: `${item.vehicle.plateNumber}: ${item.title}`,
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
    await refreshVehicleStatus(tx, item.vehicleId);
    return result;
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
  await prisma.maintenance.delete({ where: { id: item.id } });
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
