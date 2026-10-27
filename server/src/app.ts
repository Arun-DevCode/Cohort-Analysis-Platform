import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import { pinoHttp } from 'pino-http';
import swaggerUi from 'swagger-ui-express';
import { env } from './config/env.js';
import { logger } from './utils/logger.js';
import { apiRouter } from './routes/index.js';
import { errorHandler } from './middleware/errorHandler.js';
import { generateOpenApiDocument } from './docs/openapi.js';
import { getDb } from './db/client.js';
import { sql } from 'drizzle-orm';

export const app = express();

// Security middlewares
app.use(
  helmet({
    contentSecurityPolicy: false, // Allow Swagger UI assets
  })
);
app.use(
  cors({
    origin: env.CORS_ORIGINS.split(',').map((o) => o.trim()),
    credentials: true,
  })
);

// Logging middleware
app.use(
  pinoHttp({
    logger,
    autoLogging: false,
  })
);

// Body parsing
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// OpenAPI / Swagger Documentation
const openApiDoc = generateOpenApiDocument();
app.get('/api-docs.json', (req, res) => {
  res.setHeader('Content-Type', 'application/json');
  res.send(openApiDoc);
});
app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(openApiDoc));

// Root health check endpoint (standard for Render, Docker, AWS, and K8s probes)
app.get('/health', async (_req, res) => {
  let dbStatus: 'connected' | 'disconnected' = 'connected';
  try {
    const db = getDb();
    await db.execute(sql`SELECT 1`);
  } catch {
    dbStatus = 'disconnected';
  }

  const isHealthy = dbStatus === 'connected';
  res.status(isHealthy ? 200 : 503).json({
    status: isHealthy ? 'ok' : 'degraded',
    uptime: process.uptime(),
    database: dbStatus,
    timestamp: new Date().toISOString(),
  });
});

// API v1 routes
app.use('/api/v1', apiRouter);

// 404 handler
app.use((req, res) => {
  res.status(404).json({
    code: 'NOT_FOUND',
    message: `Cannot ${req.method} ${req.originalUrl}`,
  });
});

// Centralized error handler
app.use(errorHandler);
