import { app } from './app.js';
import { env } from './config/env.js';
import { logger } from './utils/logger.js';
import { closeDb } from './db/client.js';

const server = app.listen(env.PORT, '0.0.0.0', () => {
  console.log(`Server running on http://127.0.0.1:${env.PORT}`);
});

const gracefulShutdown = async (_signal: string) => {
  server.close(async () => {
    await closeDb();
    process.exit(0);
  });

  setTimeout(() => {
    logger.error('Forcefully shutting down due to timeout.');
    process.exit(1);
  }, 10000);
};

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));
