import { getDb, closeDb } from './client.js';
import { users, settings } from './schema/index.js';
import { AuthService } from '../services/auth.service.js';
import { env } from '../config/env.js';
import { logger } from '../utils/logger.js';
import { eq } from 'drizzle-orm';
import { fileURLToPath } from 'url';

export async function seedDatabase() {
  const db = getDb();

  logger.info('Seeding database initial state...');

  // 1. Seed Initial Admin
  const existingAdmin = await db.query.users.findFirst({
    where: eq(users.email, env.INITIAL_ADMIN_EMAIL),
  });

  if (!existingAdmin) {
    const passwordHash = await AuthService.hashPassword(env.INITIAL_ADMIN_PASSWORD);
    await db.insert(users).values({
      name: 'System Administrator',
      email: env.INITIAL_ADMIN_EMAIL,
      passwordHash,
      role: 'admin',
    });
    logger.info({ email: env.INITIAL_ADMIN_EMAIL }, 'Default admin user seeded successfully.');
  } else {
    logger.info('Admin user already exists.');
  }

  // 2. Seed Default Settings
  const defaultThresholds = {
    segments: { high: 80, medium: 50 },
    deltaTolerance: 2,
    atRisk: {
      consumption: 50,
      attendance: 50,
      liveLow: 30,
      liveOrRecHigh: 70,
      liveHigh: 70,
      assignmentLow: 25,
    },
  };

  const existingThresholds = await db.query.settings.findFirst({
    where: eq(settings.key, 'thresholds'),
  });

  if (!existingThresholds) {
    await db.insert(settings).values({
      key: 'thresholds',
      value: defaultThresholds,
    });
    logger.info('Default thresholds seeded.');
  }

  logger.info('Database seeding completed.');
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  seedDatabase()
    .then(async () => {
      await closeDb();
      process.exit(0);
    })
    .catch(async (err) => {
      logger.error({ err }, 'Seeding failed');
      await closeDb();
      process.exit(1);
    });
}
