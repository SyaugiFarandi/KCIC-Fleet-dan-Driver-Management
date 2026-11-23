import express from 'express';
import { z } from 'zod';
import { prisma } from '../db.js';
import { HttpError, asyncRoute, pagination, paged } from '../lib/http.js';
import { requirePermission } from '../lib/permissions.js';
import { writeAudit } from '../lib/audit.js';

const router = express.Router();

const createSchema = z.object({
  name: z.string().trim().min(2, 'Nama vendor minimal 2 karakter').max(120),
  contactName: z.string().trim().min(2, 'Nama PIC wajib diisi').max(120),
  phone: z.string().trim().min(6, 'Telepon wajib diisi').max(30),
  email: z.string().trim().email('Format email tidak valid').optional().nullable().or(z.literal('')),
  address: z.string().trim().max(300).optional().nullable(),
  active: z.boolean().optional(),
});

const updateSchema = createSchema.partial();

router.get('/', requirePermission('vendors:read'), asyncRoute(async (req, res) => {
  const page = pagination(req);
  const { q, active } = req.query;
  const where = {
    ...(q
      ? {
          OR: [
            { name: { contains: q, mode: 'insensitive' } },
            { contactName: { contains: q, mode: 'insensitive' } },
            { phone: { contains: q, mode: 'insensitive' } },
          ],
        }
      : {}),
    ...(active === 'true' ? { active: true } : active === 'false' ? { active: false } : {}),
  };
  const [items, total] = await Promise.all([
    prisma.vendor.findMany({
      where,
      include: { _count: { select: { vehicles: true, drivers: true } } },
      orderBy: { name: 'asc' },
      skip: page.skip,
      take: page.take,
    }),
    prisma.vendor.count({ where }),
  ]);
  res.json(paged(items, total, page));
}));

router.post('/', requirePermission('vendors:write'), asyncRoute(async (req, res) => {
  const data = createSchema.parse(req.body);
  const vendor = await prisma.vendor.create({
    data: {
      name: data.name,
      contactName: data.contactName,
      phone: data.phone,
      email: data.email || null,
      address: data.address || null,
      active: data.active ?? true,
    },
    include: { _count: { select: { vehicles: true, drivers: true } } },
  });
  await writeAudit({ userId: req.user.id, action: 'VENDOR_CREATE', entity: 'Vendor', entityId: vendor.id, detail: vendor.name });
  res.status(201).json(vendor);
}));

router.patch('/:id', requirePermission('vendors:write'), asyncRoute(async (req, res) => {
  const data = updateSchema.parse(req.body);
  const vendor = await prisma.vendor.update({
    where: { id: req.params.id },
    data: {
      ...(data.name !== undefined ? { name: data.name } : {}),
      ...(data.contactName !== undefined ? { contactName: data.contactName } : {}),
      ...(data.phone !== undefined ? { phone: data.phone } : {}),
      ...(data.email !== undefined ? { email: data.email || null } : {}),
      ...(data.address !== undefined ? { address: data.address || null } : {}),
      ...(data.active !== undefined ? { active: data.active } : {}),
    },
    include: { _count: { select: { vehicles: true, drivers: true } } },
  });
  await writeAudit({ userId: req.user.id, action: 'VENDOR_UPDATE', entity: 'Vendor', entityId: vendor.id, detail: vendor.name });
  res.json(vendor);
}));

router.delete('/:id', requirePermission('vendors:delete'), asyncRoute(async (req, res) => {
  const vendor = await prisma.vendor.findUnique({
    where: { id: req.params.id },
    include: { _count: { select: { vehicles: true, drivers: true } } },
  });
  if (!vendor) throw new HttpError(404, 'Vendor tidak ditemukan');
  if (vendor._count.vehicles > 0 || vendor._count.drivers > 0) {
    throw new HttpError(409, 'Vendor masih memiliki kendaraan/driver. Nonaktifkan vendor sebagai gantinya.');
  }
  await prisma.vendor.delete({ where: { id: vendor.id } });
  await writeAudit({ userId: req.user.id, action: 'VENDOR_DELETE', entity: 'Vendor', entityId: vendor.id, detail: vendor.name });
  res.json({ ok: true });
}));

export default router;
