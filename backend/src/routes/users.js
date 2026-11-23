import express from 'express';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { config } from '../config.js';
import { prisma } from '../db.js';
import { HttpError, asyncRoute, pagination, paged } from '../lib/http.js';
import { requirePermission, ROLES, ROLE_LABELS } from '../lib/permissions.js';
import { writeAudit } from '../lib/audit.js';

const router = express.Router();
router.use(requirePermission('users:manage'));

const userSelect = {
  id: true,
  name: true,
  email: true,
  role: true,
  department: true,
  phone: true,
  active: true,
  createdAt: true,
};

const createSchema = z.object({
  name: z.string().trim().min(2, 'Nama minimal 2 karakter').max(120),
  email: z.string().trim().email('Format email tidak valid').transform((v) => v.toLowerCase()),
  password: z.string().min(8, 'Password minimal 8 karakter'),
  role: z.enum(ROLES),
  department: z.string().trim().max(120).optional().nullable(),
  phone: z.string().trim().max(30).optional().nullable(),
});

const updateSchema = z.object({
  name: z.string().trim().min(2).max(120).optional(),
  role: z.enum(ROLES).optional(),
  department: z.string().trim().max(120).optional().nullable(),
  phone: z.string().trim().max(30).optional().nullable(),
  active: z.boolean().optional(),
  password: z.string().min(8, 'Password minimal 8 karakter').optional(),
});

async function assertAdminRemains(targetId, nextRole, nextActive) {
  const target = await prisma.user.findUnique({ where: { id: targetId } });
  if (!target) throw new HttpError(404, 'Pengguna tidak ditemukan');
  if (target.role !== 'SYSTEM_ADMIN' || !target.active) return;
  const stillAdmin = (nextRole ?? target.role) === 'SYSTEM_ADMIN' && (nextActive ?? target.active) === true;
  if (stillAdmin) return;
  const otherAdmins = await prisma.user.count({
    where: { role: 'SYSTEM_ADMIN', active: true, id: { not: targetId } },
  });
  if (otherAdmins === 0) throw new HttpError(409, 'Minimal harus ada satu System Administrator aktif');
}

router.get('/', asyncRoute(async (req, res) => {
  const page = pagination(req);
  const { q, role, active } = req.query;
  const where = {
    ...(q ? { OR: [{ name: { contains: q, mode: 'insensitive' } }, { email: { contains: q, mode: 'insensitive' } }] } : {}),
    ...(role ? { role } : {}),
    ...(active === 'true' ? { active: true } : active === 'false' ? { active: false } : {}),
  };
  const [items, total] = await Promise.all([
    prisma.user.findMany({ where, select: userSelect, orderBy: { name: 'asc' }, skip: page.skip, take: page.take }),
    prisma.user.count({ where }),
  ]);
  res.json({ ...paged(items, total, page), roles: ROLES.map((r) => ({ value: r, label: ROLE_LABELS[r] })) });
}));

router.post('/', asyncRoute(async (req, res) => {
  const data = createSchema.parse(req.body);
  const passwordHash = await bcrypt.hash(data.password, config.bcryptRounds);
  const user = await prisma.user.create({
    data: {
      name: data.name,
      email: data.email,
      passwordHash,
      role: data.role,
      department: data.department || null,
      phone: data.phone || null,
    },
    select: userSelect,
  });
  await writeAudit({ userId: req.user.id, action: 'USER_CREATE', entity: 'User', entityId: user.id, detail: `${user.email} (${user.role})` });
  res.status(201).json(user);
}));

router.patch('/:id', asyncRoute(async (req, res) => {
  const data = updateSchema.parse(req.body);
  if (req.params.id === req.user.id && (data.active === false || (data.role && data.role !== 'SYSTEM_ADMIN'))) {
    throw new HttpError(400, 'Tidak dapat menonaktifkan atau menurunkan role akun sendiri');
  }
  await assertAdminRemains(req.params.id, data.role, data.active);

  const user = await prisma.user.update({
    where: { id: req.params.id },
    data: {
      ...(data.name !== undefined ? { name: data.name } : {}),
      ...(data.role !== undefined ? { role: data.role } : {}),
      ...(data.department !== undefined ? { department: data.department || null } : {}),
      ...(data.phone !== undefined ? { phone: data.phone || null } : {}),
      ...(data.active !== undefined ? { active: data.active } : {}),
      ...(data.password ? { passwordHash: await bcrypt.hash(data.password, config.bcryptRounds) } : {}),
    },
    select: userSelect,
  });
  await writeAudit({
    userId: req.user.id,
    action: 'USER_UPDATE',
    entity: 'User',
    entityId: user.id,
    detail: `Perubahan akun ${user.email}${data.active === false ? ' (dinonaktifkan)' : ''}`,
  });
  res.json(user);
}));

router.delete('/:id', asyncRoute(async (req, res) => {
  if (req.params.id === req.user.id) throw new HttpError(400, 'Tidak dapat menghapus akun sendiri');
  await assertAdminRemains(req.params.id, undefined, false);

  const counts = await prisma.user.findUnique({
    where: { id: req.params.id },
    select: {
      email: true,
      _count: {
        select: {
          bookings: true,
          decisions: true,
          assignedTrips: true,
          tripEvents: true,
          maintenanceItems: true,
          auditLogs: true,
        },
      },
      driverProfile: { select: { id: true } },
    },
  });
  if (!counts) throw new HttpError(404, 'Pengguna tidak ditemukan');
  const refs = Object.values(counts._count).reduce((a, b) => a + b, 0) + (counts.driverProfile ? 1 : 0);
  if (refs > 0) {
    throw new HttpError(409, 'Akun memiliki riwayat aktivitas sehingga tidak dapat dihapus. Nonaktifkan akun sebagai gantinya.');
  }
  await prisma.user.delete({ where: { id: req.params.id } });
  await writeAudit({ userId: req.user.id, action: 'USER_DELETE', entity: 'User', entityId: req.params.id, detail: counts.email });
  res.json({ ok: true });
}));

export default router;
