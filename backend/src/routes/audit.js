import express from 'express';
import { prisma } from '../db.js';
import { asyncRoute, pagination, paged } from '../lib/http.js';
import { requirePermission } from '../lib/permissions.js';

const router = express.Router();
router.use(requirePermission('audit:read'));

router.get('/', asyncRoute(async (req, res) => {
  const page = pagination(req, { defaultPageSize: 50 });
  const { q, action, entity, from, to } = req.query;
  const where = {
    ...(action ? { action } : {}),
    ...(entity ? { entity } : {}),
    ...(q
      ? {
          OR: [
            { detail: { contains: q, mode: 'insensitive' } },
            { entityId: { contains: q, mode: 'insensitive' } },
            { user: { is: { name: { contains: q, mode: 'insensitive' } } } },
            { user: { is: { email: { contains: q, mode: 'insensitive' } } } },
          ],
        }
      : {}),
    ...(from || to
      ? {
          createdAt: {
            ...(from ? { gte: new Date(from) } : {}),
            ...(to ? { lte: new Date(to) } : {}),
          },
        }
      : {}),
  };
  const [items, total, actionRows, entityRows] = await Promise.all([
    prisma.auditLog.findMany({
      where,
      include: { user: { select: { id: true, name: true, email: true, role: true } } },
      orderBy: { createdAt: 'desc' },
      skip: page.skip,
      take: page.take,
    }),
    prisma.auditLog.count({ where }),
    prisma.auditLog.groupBy({ by: ['action'], _count: { _all: true }, orderBy: { action: 'asc' } }),
    prisma.auditLog.groupBy({ by: ['entity'], _count: { _all: true }, orderBy: { entity: 'asc' } }),
  ]);
  res.json({
    ...paged(items, total, page),
    filters: {
      actions: actionRows.map((r) => r.action),
      entities: entityRows.map((r) => r.entity),
    },
  });
}));

export default router;
