import { getDb } from '../db/client.js';
import { auditLogs, users } from '../db/schema/index.js';
import { desc, eq } from 'drizzle-orm';

export interface AuditLogEntry {
  userId?: string | null;
  action: string;
  entity: string;
  entityId?: string | null;
  meta?: Record<string, any>;
}

export class AuditService {
  static async log(entry: AuditLogEntry): Promise<void> {
    try {
      const db = getDb();
      await db.insert(auditLogs).values({
        userId: entry.userId || null,
        action: entry.action,
        entity: entry.entity,
        entityId: entry.entityId || null,
        meta: entry.meta || null,
      });
    } catch (err) {
      // Non-blocking failure for logging
      console.error('Failed to write audit log:', err);
    }
  }

  static async listLogs(query: {
    page?: number;
    pageSize?: number;
    action?: string;
    entity?: string;
  }) {
    const db = getDb();
    const page = Math.max(1, query.page || 1);
    const pageSize = Math.min(100, Math.max(1, query.pageSize || 20));
    const offset = (page - 1) * pageSize;

    const baseQuery = db
      .select({
        id: auditLogs.id,
        action: auditLogs.action,
        entity: auditLogs.entity,
        entityId: auditLogs.entityId,
        meta: auditLogs.meta,
        createdAt: auditLogs.createdAt,
        user: {
          id: users.id,
          email: users.email,
          role: users.role,
        },
      })
      .from(auditLogs)
      .leftJoin(users, eq(auditLogs.userId, users.id))
      .orderBy(desc(auditLogs.createdAt))
      .limit(pageSize)
      .offset(offset);

    const rows = await baseQuery;

    return {
      data: rows,
      page,
      pageSize,
    };
  }
}
