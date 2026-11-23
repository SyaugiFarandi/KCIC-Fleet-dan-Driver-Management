import express from 'express';
import { z } from 'zod';
import { prisma } from '../db.js';
import { HttpError, asyncRoute, pagination, paged } from '../lib/http.js';
import { can, requirePermission } from '../lib/permissions.js';
import { writeAudit } from '../lib/audit.js';

const router = express.Router();

const include = {
  vehicle: { select: { id: true, plateNumber: true, brand: true, model: true } },
  inspection: { select: { id: true, type: true, status: true } },
  maintenance: { select: { id: true, title: true, status: true } },
  reportedBy: { select: { id: true, name: true } },
};

const ALLOWED_TRANSITIONS = {
  OPEN: ['IN_REPAIR', 'RESOLVED'],
  IN_REPAIR: ['RESOLVED', 'OPEN'],
  RESOLVED: ['OPEN'],
};

router.get('/', requirePermission('inspection:read'), asyncRoute(async (req, res) => {
  if (req.user.role === 'DRIVER') throw new HttpError(403, 'Daftar defect hanya untuk staf');
  const page = pagination(req);
  const { q, status, severity, vehicleId } = req.query;
  const where = {
    ...(status ? { status } : {}),
    ...(severity ? { severity } : {}),
    ...(vehicleId ? { vehicleId } : {}),
    ...(q
      ? {
          OR: [
            { title: { contains: q, mode: 'insensitive' } },
            { description: { contains: q, mode: 'insensitive' } },
            { vehicle: { is: { plateNumber: { contains: q, mode: 'insensitive' } } } },
          ],
        }
      : {}),
  };
  const [items, total] = await Promise.all([
    prisma.defect.findMany({ where, include, orderBy: { reportedAt: 'desc' }, skip: page.skip, take: page.take }),
    prisma.defect.count({ where }),
  ]);
  res.json(paged(items, total, page));
}));

router.post('/', asyncRoute(async (req, res) => {
  const isDriver = req.user.role === 'DRIVER';
  if (!isDriver && !can(req.user.role, 'inspection:write')) {
    throw new HttpError(403, 'Anda tidak memiliki akses untuk melaporkan defect');
  }
  const schema = z.object({
    vehicleId: z.string().trim().optional(),
    tripId: z.string().trim().optional().nullable(),
    inspectionId: z.string().trim().optional().nullable(),
    title: z.string().trim().min(3, 'Judul defect wajib diisi').max(120),
    description: z.string().trim().max(500).optional().nullable(),
    severity: z.enum(['LOW', 'MEDIUM', 'HIGH', 'CRITICAL']).default('MEDIUM'),
  });
  const data = schema.parse(req.body);

  let vehicleId = data.vehicleId;
  if (isDriver) {
    if (!data.tripId) throw new HttpError(400, 'Driver wajib memilih trip untuk laporan defect');
    const trip = await prisma.trip.findUnique({ where: { id: data.tripId }, include: { driver: true } });
    if (!trip) throw new HttpError(404, 'Trip tidak ditemukan');
    if (trip.driver?.userId !== req.user.id) throw new HttpError(403, 'Anda hanya dapat melaporkan defect untuk trip sendiri');
    vehicleId = trip.vehicleId;
  }
  if (!vehicleId) throw new HttpError(400, 'Kendaraan wajib dipilih');
  const vehicle = await prisma.vehicle.findUnique({ where: { id: vehicleId } });
  if (!vehicle) throw new HttpError(404, 'Kendaraan tidak ditemukan');
  if (data.inspectionId) {
    const inspection = await prisma.inspection.findUnique({ where: { id: data.inspectionId } });
    if (!inspection) throw new HttpError(404, 'Inspeksi tidak ditemukan');
    if (inspection.vehicleId !== vehicleId) throw new HttpError(409, 'Inspeksi tidak terkait kendaraan ini');
  }

  const defect = await prisma.defect.create({
    data: {
      vehicleId,
      inspectionId: data.inspectionId || null,
      title: data.title,
      description: data.description || '',
      severity: data.severity,
      status: 'OPEN',
      reportedById: req.user.id,
    },
    include,
  });
  await writeAudit({
    userId: req.user.id,
    action: 'DEFECT_REPORT',
    entity: 'Defect',
    entityId: defect.id,
    detail: `${defect.vehicle.plateNumber}: ${defect.title} (${defect.severity})`,
  });
  res.status(201).json(defect);
}));

router.patch('/:id', requirePermission('inspection:write'), asyncRoute(async (req, res) => {
  const schema = z.object({
    status: z.enum(['OPEN', 'IN_REPAIR', 'RESOLVED']).optional(),
    severity: z.enum(['LOW', 'MEDIUM', 'HIGH', 'CRITICAL']).optional(),
    resolutionNote: z.string().trim().max(400).optional().nullable(),
  });
  const data = schema.parse(req.body);
  const defect = await prisma.defect.findUnique({ where: { id: req.params.id }, include });
  if (!defect) throw new HttpError(404, 'Defect tidak ditemukan');

  if (data.status && data.status !== defect.status) {
    const allowed = ALLOWED_TRANSITIONS[defect.status] || [];
    if (!allowed.includes(data.status)) {
      throw new HttpError(409, `Defect berstatus ${defect.status} tidak dapat diubah ke ${data.status}`);
    }
  }
  if (data.status === 'RESOLVED' && (!data.resolutionNote || data.resolutionNote.trim().length < 3)) {
    throw new HttpError(400, 'Catatan penyelesaian wajib diisi saat menutup defect');
  }

  const updated = await prisma.defect.update({
    where: { id: defect.id },
    data: {
      ...(data.status !== undefined ? { status: data.status } : {}),
      ...(data.severity !== undefined ? { severity: data.severity } : {}),
      ...(data.resolutionNote !== undefined ? { resolutionNote: data.resolutionNote || null } : {}),
      ...(data.status === 'RESOLVED' ? { resolvedAt: new Date() } : {}),
      ...(data.status && data.status !== 'RESOLVED' && defect.status === 'RESOLVED' ? { resolvedAt: null } : {}),
    },
    include,
  });
  await writeAudit({
    userId: req.user.id,
    action: 'DEFECT_UPDATE',
    entity: 'Defect',
    entityId: defect.id,
    detail: `${updated.vehicle.plateNumber}: ${updated.title} → ${updated.status}`,
  });
  res.json(updated);
}));

export default router;
