import express from "express";
import helmet from "helmet";
import cors from "cors";
import { pinoHttp } from "pino-http";
import swaggerUi from "swagger-ui-express";
import { env } from "./config/env.js";
import { logger } from "./utils/logger.js";
import { apiRouter } from "./routes/index.js";
import { fileRouter } from "./routes/file.routes.js";
import { errorHandler } from "./middleware/errorHandler.js";
import { generateOpenApiDocument } from "./docs/openapi.js";
import { getDb } from "./db/client.js";
import { sql } from "drizzle-orm";

export const app = express();

// Security middlewares
const helmetMiddleware: any = (helmet as any).default || helmet;
app.use(
  helmetMiddleware({
    contentSecurityPolicy: false, // Allow Swagger UI assets
  }),
);

const allowedOrigins = env.CORS_ORIGINS ? env.CORS_ORIGINS.split(',').map((o) => o.trim()) : ['http://localhost:5173'];
app.use(
  cors({
    origin: (origin, callback) => {
      if (!origin || allowedOrigins.includes(origin) || allowedOrigins.includes('*') || origin.endsWith('.vercel.app') || origin === 'http://localhost:5173') {
        callback(null, true);
      } else {
        callback(null, true);
      }
    },
    credentials: true,
  }),
);

// Logging middleware
app.use(
  pinoHttp({
    logger,
    autoLogging: false,
  }),
);

// Body parsing
app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true, limit: "10mb" }));

// OpenAPI / Swagger Documentation
const openApiDoc = generateOpenApiDocument();
app.get("/api-docs.json", (req, res) => {
  res.setHeader("Content-Type", "application/json");
  res.send(openApiDoc);
});
app.use("/api-docs", swaggerUi.serve, swaggerUi.setup(openApiDoc));

// Root health check endpoint (standard for Render, Docker, AWS, and K8s probes)
app.get("/health", async (_req, res) => {
  let dbStatus: "connected" | "disconnected" = "connected";
  try {
    const db = getDb();
    await db.execute(sql`SELECT 1`);
  } catch {
    dbStatus = "disconnected";
  }

  const isHealthy = dbStatus === "connected";
  res.status(isHealthy ? 200 : 503).json({
    status: isHealthy ? "ok" : "degraded",
    uptime: process.uptime(),
    database: dbStatus,
    timestamp: new Date().toISOString(),
  });
});

// API v1 routes
app.use("/api/v1", apiRouter);
app.use("/files", fileRouter);

// 404 handler
app.use((req, res) => {
  res.status(404).json({
    code: "NOT_FOUND",
    message: `Cannot ${req.method} ${req.originalUrl}`,
  });
});

// Centralized error handler
app.use(errorHandler);

export default app;