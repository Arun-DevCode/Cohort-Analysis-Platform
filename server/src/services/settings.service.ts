import { getDb } from '../db/client.js';
import { settings } from '../db/schema/index.js';
import { eq } from 'drizzle-orm';
import { DEFAULT_THRESHOLDS, Thresholds, thresholdsSchema } from '../validators/settings.validator.js';
import { AuditService } from './audit.service.js';

export class SettingsService {
  static async getThresholds(): Promise<Thresholds> {
    const db = getDb();
    const rows = await db
      .select()
      .from(settings)
      .where(eq(settings.key, 'thresholds'))
      .limit(1);

    if (rows.length === 0 || !rows[0].value) {
      return DEFAULT_THRESHOLDS;
    }

    const parsed = thresholdsSchema.safeParse(rows[0].value);
    if (!parsed.success) {
      return DEFAULT_THRESHOLDS;
    }

    return parsed.data;
  }

  static async updateThresholds(data: Thresholds, userId?: string): Promise<Thresholds> {
    const db = getDb();
    const validated = thresholdsSchema.parse(data);

    await db
      .insert(settings)
      .values({
        key: 'thresholds',
        value: validated,
      })
      .onConflictDoUpdate({
        target: settings.key,
        set: {
          value: validated,
        },
      });

    await AuditService.log({
      userId,
      action: 'update_settings',
      entity: 'settings',
      entityId: 'thresholds',
      meta: validated,
    });

    return validated;
  }
}
