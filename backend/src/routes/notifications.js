import express from 'express';
import { prisma } from '../db.js';
import { HttpError, asyncRoute, paged, pagination } from '../lib/http.js';
import { NOTIFICATION_TYPE_LABELS, enabledNotificationTypes, refreshUserNotifications } from '../lib/notifications.js';
import { subscribeUser } from '../lib/events.js';

const router = express.Router();
const SSE_HEARTBEAT_MS = 25000;

router.get('/stream', async (req, res) => {
  res.set({
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  res.flushHeaders();
  res.write('retry: 15000\n\n');

  let closed = false;
  let queued = false;

  const push = async () => {
    queued = false;
    if (closed) return;
    try {
      const user = await prisma.user.findUnique({ where: { id: req.user.id }, select: { notificationPrefs: true } });
      if (!user) {
        cleanup();
        res.end();
        return;
      }
      const unreadCount = await prisma.notification.count({
        where: { userId: req.user.id, readAt: null, type: { in: enabledNotificationTypes(user) } },
      });
      if (closed) return;
      res.write(`event: unread\ndata: ${JSON.stringify({ unreadCount, at: Date.now() })}\n\n`);
    } catch (err) {
      console.error('[sse] notification stream failed', err.message);
    }
  };

  const schedule = () => {
    if (queued || closed) return;
    queued = true;
    push();
  };

  const heartbeat = setInterval(() => {
    if (!closed) res.write(': ping\n\n');
  }, SSE_HEARTBEAT_MS);
  const unsubscribe = subscribeUser(req.user.id, schedule);

  function cleanup() {
    if (closed) return;
    closed = true;
    clearInterval(heartbeat);
    unsubscribe();
  }

  req.on('close', cleanup);
  res.on('error', cleanup);
  await push();
});

router.get('/', asyncRoute(async (req, res) => {
  await refreshUserNotifications(req.user);
  const page = pagination(req, { defaultPageSize: 20, maxPageSize: 100 });
  const allowedTypes = enabledNotificationTypes(req.user);
  const unreadOnly = req.query.unreadOnly === 'true';
  const requestedType = req.query.type && req.query.type !== 'ALL' ? String(req.query.type) : null;
  const type = requestedType && allowedTypes.includes(requestedType) ? requestedType : null;
  const where = {
    userId: req.user.id,
    type: { in: type ? [type] : allowedTypes },
    ...(unreadOnly ? { readAt: null } : {}),
  };
  const [items, total, unreadCount] = await Promise.all([
    prisma.notification.findMany({ where, orderBy: { createdAt: 'desc' }, skip: page.skip, take: page.take }),
    prisma.notification.count({ where }),
    prisma.notification.count({ where: { userId: req.user.id, readAt: null, type: { in: allowedTypes } } }),
  ]);
  res.json({
    ...paged(items, total, page),
    unreadCount,
    typeLabels: NOTIFICATION_TYPE_LABELS,
    enabledTypes: allowedTypes,
  });
}));

router.post('/read-all', asyncRoute(async (req, res) => {
  const result = await prisma.notification.updateMany({
    where: { userId: req.user.id, readAt: null, type: { in: enabledNotificationTypes(req.user) } },
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
