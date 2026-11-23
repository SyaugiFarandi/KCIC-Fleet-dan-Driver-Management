import { prisma } from '../db.js';

export async function writeAudit({ userId = null, action, entity, entityId, detail = '' }) {
  try {
    await prisma.auditLog.create({ data: { userId, action, entity, entityId, detail } });
  } catch (err) {
    console.error('[audit] failed to write entry', action, entity, entityId, err.message);
  }
}
