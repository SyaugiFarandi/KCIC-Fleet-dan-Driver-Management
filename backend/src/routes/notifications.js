import express from 'express';
import { prisma } from '../db.js';
import { HttpError, asyncRoute, paged, pagination } from '../lib/http.js';
import { NOTIFICATION_TYPE_LABELS, refreshUserNotifications } from '../lib/notifications.js';

const router = express.Router();

router.get('/', asyncRoute(async (req, res) => {
  await refreshUserNotifications(req.user);
  const page = pagination(req, { defaultPageSize: 20, maxPageSize: 100 });
  const unreadOnly = req.query.unreadOnly === 'true';
  const type = req.query.type && req.query.type !== 'ALL' ? String(req.query.type) : null;
  const where = {
    userId: req.user.id,
    ...(unreadOnly ? { readAt: null } : {}),
    ...(type ? { type } : {}),
  };
  const [items, total, unreadCount] = await Promise.all([
    prisma.notification.findMany({ where, orderBy: { createdAt: 'desc' }, skip: page.skip, take: page.take }),
    prisma.notification.count({ where }),
    prisma.notification.count({ where: { userId: req.user.id, readAt: null } }),
  ]);
  res.json({ ...paged(items, total, page), unreadCount, typeLabels: NOTIFICATION_TYPE_LABELS });
}));

router.post('/read-all', asyncRoute(async (req, res) => {
  const result = await prisma.notification.updateMany({
    where: { userId: req.user.id, readAt: null },
    data: { readAt: new Date() },
  });
  res.json({ ok: true, updated: result.count });
}));

router.patch('/:id/read', asyncRoute(async (req, res) => {
  const item = await prisma.notification.findUnique({ where: { id: req.params.id } });
  if (!item) throw new HttpError(404, 'Notifikasi tidak ditemukan');
  if (item.userId !== req.user.id) throw new HttpError(403, 'Notifikasi ini bukan milik Anda');
  const updated = item.readAt ? item : await prisma.notification.update({ where: { id: item.id }, data: { readAt: new Date() } });
  res.json(updated);
}));

export default router;
