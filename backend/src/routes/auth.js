import express from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { z } from 'zod';
import { config } from '../config.js';
import { prisma } from '../db.js';
import { HttpError, asyncRoute } from '../lib/http.js';
import { requireAuth } from '../middleware/auth.js';
import { writeAudit } from '../lib/audit.js';
import { clearSessionCookie, setSessionCookie } from '../lib/session.js';
import { DEFAULT_NOTIFICATION_PREFS, NOTIFICATION_TYPES, enabledNotificationTypes } from '../lib/notifications.js';

const router = express.Router();

const loginSchema = z.object({
  email: z.string().trim().email('Format email tidak valid').transform((v) => v.toLowerCase()),
  password: z.string().min(1, 'Password wajib diisi'),
});

const passwordSchema = z.object({
  currentPassword: z.string().min(1, 'Password saat ini wajib diisi'),
  newPassword: z.string().min(8, 'Password baru minimal 8 karakter'),
});

const preferencesSchema = z.object({
  types: z.array(z.enum(NOTIFICATION_TYPES)).max(NOTIFICATION_TYPES.length),
});

const MAX_ATTEMPTS = 10;
const WINDOW_MS = 15 * 60 * 1000;
const failedLogins = new Map();

function rateKey(req, email) {
  return `${req.ip}|${email}`;
}

function assertNotBlocked(key) {
  const entry = failedLogins.get(key);
  if (!entry) return;
  if (entry.resetAt < Date.now()) {
    failedLogins.delete(key);
    return;
  }
  if (entry.count >= MAX_ATTEMPTS) {
    throw new HttpError(429, 'Terlalu banyak percobaan login. Coba lagi dalam 15 menit.');
  }
}

function recordFailure(key) {
  if (failedLogins.size > 5000) {
    const now = Date.now();
    for (const [storedKey, entry] of failedLogins) {
      if (entry.resetAt < now) failedLogins.delete(storedKey);
    }
  }
  const entry = failedLogins.get(key);
  if (!entry || entry.resetAt < Date.now()) {
    failedLogins.set(key, { count: 1, resetAt: Date.now() + WINDOW_MS });
  } else {
    entry.count += 1;
  }
}

function publicUser(user) {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    role: user.role,
    department: user.department,
    phone: user.phone,
    active: user.active,
    notificationTypes: enabledNotificationTypes(user),
  };
}

router.post(
  '/login',
  asyncRoute(async (req, res) => {
    const { email, password } = loginSchema.parse(req.body);
    const key = rateKey(req, email);
    assertNotBlocked(key);

    const user = await prisma.user.findUnique({ where: { email } });
    const valid = user ? await bcrypt.compare(password, user.passwordHash) : false;
    if (!user || !user.active || !valid) {
      recordFailure(key);
      await writeAudit({
        action: 'LOGIN_FAILED',
        entity: 'User',
        entityId: user?.id || '-',
        detail: `Login gagal untuk ${email}`,
      });
      throw new HttpError(401, 'Email atau password salah');
    }

    failedLogins.delete(key);
    const token = jwt.sign({ sub: user.id, role: user.role }, config.jwtSecret, {
      expiresIn: config.jwtExpiresIn,
    });
    await writeAudit({ userId: user.id, action: 'LOGIN', entity: 'User', entityId: user.id, detail: 'Login berhasil' });
    setSessionCookie(res, token);
    res.json({ ...(config.isProduction ? {} : { token }), user: publicUser(user) });
  })
);

router.get('/me', requireAuth, asyncRoute(async (req, res) => {
  res.json({ user: publicUser(req.user), preferences: { ...DEFAULT_NOTIFICATION_PREFS, types: enabledNotificationTypes(req.user) } });
}));

router.post('/logout', requireAuth, asyncRoute(async (req, res) => {
  await writeAudit({ userId: req.user.id, action: 'LOGOUT', entity: 'User', entityId: req.user.id, detail: 'Logout' });
  clearSessionCookie(res);
  res.json({ ok: true });
}));

router.patch('/preferences', requireAuth, asyncRoute(async (req, res) => {
  const { types } = preferencesSchema.parse(req.body);
  const updated = await prisma.user.update({
    where: { id: req.user.id },
    data: { notificationPrefs: { types } },
    select: { id: true, name: true, email: true, role: true, department: true, phone: true, active: true, notificationPrefs: true },
  });
  await writeAudit({ userId: req.user.id, action: 'UPDATE_PREFERENCES', entity: 'User', entityId: req.user.id, detail: 'Preferensi notifikasi diperbarui' });
  res.json({ user: publicUser(updated), preferences: { types: enabledNotificationTypes(updated) } });
}));

router.patch('/password', requireAuth, asyncRoute(async (req, res) => {
  const { currentPassword, newPassword } = passwordSchema.parse(req.body);
  const user = await prisma.user.findUnique({ where: { id: req.user.id } });
  if (!user || !(await bcrypt.compare(currentPassword, user.passwordHash))) {
    throw new HttpError(400, 'Password saat ini tidak sesuai');
  }
  const passwordHash = await bcrypt.hash(newPassword, config.bcryptRounds);
  await prisma.user.update({ where: { id: user.id }, data: { passwordHash } });
  await writeAudit({ userId: user.id, action: 'CHANGE_PASSWORD', entity: 'User', entityId: user.id, detail: 'Password diubah' });
  res.json({ ok: true });
}));

export default router;
