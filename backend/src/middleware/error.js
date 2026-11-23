import { ZodError } from 'zod';
import { Prisma } from '@prisma/client';
import { HttpError } from '../lib/http.js';
import { config } from '../config.js';

export function notFound(req, res) {
  res.status(404).json({ error: 'Endpoint tidak ditemukan' });
}

export function errorHandler(err, req, res, next) {
  if (res.headersSent) return next(err);

  if (err instanceof ZodError) {
    const details = err.issues.map((i) => ({ path: i.path.join('.'), message: i.message }));
    return res.status(400).json({ error: details[0]?.message || 'Data tidak valid', details });
  }

  if (err instanceof HttpError) {
    return res.status(err.status).json({ error: err.message, ...(err.details ? { details: err.details } : {}) });
  }

  if (err instanceof Prisma.PrismaClientKnownRequestError) {
    if (err.code === 'P2002') {
      const target = Array.isArray(err.meta?.target) ? err.meta.target.join(', ') : err.meta?.target;
      return res.status(409).json({ error: `Data sudah digunakan (${target || 'unik'})` });
    }
    if (err.code === 'P2025') return res.status(404).json({ error: 'Data tidak ditemukan' });
    if (err.code === 'P2003') return res.status(409).json({ error: 'Data masih direferensikan oleh data lain' });
  }

  if (!config.isTest) console.error('[server-error]', err);
  res.status(500).json({
    error: 'Terjadi kesalahan pada server',
    ...(config.env === 'development' && !config.isTest ? { detail: err.message } : {}),
  });
}
