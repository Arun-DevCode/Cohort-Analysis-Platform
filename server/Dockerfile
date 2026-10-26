# Multi-stage Dockerfile for Student Progress Analytics Backend
# Stage 1: Build
FROM node:20-alpine AS builder

WORKDIR /app

# Copy dependency manifests
COPY package*.json tsconfig.json ./

# Install dependencies including devDependencies
RUN npm ci

# Copy application source
COPY src/ ./src/
COPY drizzle.config.ts ./

# Build TypeScript to dist
RUN npm run build

# Stage 2: Production Runner
FROM node:20-alpine AS runner

WORKDIR /app

ENV NODE_ENV=production
ENV PORT=4000

# Install production dependencies only
COPY package*.json ./
RUN npm ci --omit=dev

# Copy compiled assets from builder
COPY --from=builder /app/dist ./dist
COPY src/db/migrations ./dist/db/migrations

# Create non-root user and assign permissions
USER node

EXPOSE 4000

# Health check
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:4000/api/v1/health || exit 1

CMD ["node", "dist/server.js"]
