import { prisma } from '../db.js';
import { logger } from './logger.js';

export async function writeAudit({ userId = null, action, entity, entityId, detail = '' }) {
  try {
    await prisma.auditLog.create({ data: { userId, action, entity, entityId, detail } });
  } catch (err) {
    logger.error('audit_write_failed', { action, entity, entityId, error: err.message });
  }
}
