import jwt from 'jsonwebtoken';
import { config } from '../config.js';
import { prisma } from '../db.js';
import { HttpError, asyncRoute } from '../lib/http.js';

export const requireAuth = asyncRoute(async (req, res, next) => {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : '';
  if (!token) throw new HttpError(401, 'Sesi tidak ditemukan, silakan login');

  let payload;
  try {
    payload = jwt.verify(token, config.jwtSecret);
  } catch {
    throw new HttpError(401, 'Sesi kedaluwarsa, silakan login ulang');
  }

  const user = await prisma.user.findUnique({
    where: { id: payload.sub },
    select: { id: true, name: true, email: true, role: true, department: true, phone: true, active: true },
  });
  if (!user || !user.active) throw new HttpError(401, 'Akun tidak ditemukan atau sudah dinonaktifkan');

  req.user = user;
  next();
});
