import {
  OpenAPIRegistry,
  OpenApiGeneratorV3,
  extendZodWithOpenApi,
} from '@asteasolutions/zod-to-openapi';
import { z } from 'zod';

// Extend Zod with OpenAPI functionality
extendZodWithOpenApi(z);

export const registry = new OpenAPIRegistry();

// Security Scheme
const bearerAuth = registry.registerComponent('securitySchemes', 'bearerAuth', {
  type: 'http',
  scheme: 'bearer',
  bearerFormat: 'JWT',
});

// --- Auth Schemas ---
const loginSchema = registry.register(
  'LoginInput',
  z.object({
    email: z.string().email(),
    password: z.string().min(8),
  })
);

const tokenResponseSchema = registry.register(
  'TokenResponse',
  z.object({
    accessToken: z.string(),
    refreshToken: z.string(),
    user: z.object({
      id: z.string().uuid(),
      email: z.string().email(),
      role: z.enum(['admin', 'manager', 'trainer']),
    }),
  })
);

// --- User Schemas ---
const userSchema = registry.register(
  'User',
  z.object({
    id: z.string().uuid(),
    email: z.string().email(),
    role: z.enum(['admin', 'manager', 'trainer']),
    createdAt: z.string().datetime(),
  })
);

const createUserSchema = registry.register(
  'CreateUserInput',
  z.object({
    email: z.string().email(),
    password: z.string().min(8),
    role: z.enum(['admin', 'manager', 'trainer']),
  })
);

// --- Batch Schemas ---
const batchSchema = registry.register(
  'Batch',
  z.object({
    id: z.string().uuid(),
    name: z.string(),
    externalBatchId: z.string(),
    startDate: z.string().nullable().optional(),
    createdAt: z.string().datetime(),
  })
);

const createBatchSchema = registry.register(
  'CreateBatchInput',
  z.object({
    name: z.string().min(1),
    externalBatchId: z.string().min(1),
    startDate: z.string().optional(),
  })
);

// --- Settings Schemas ---
const thresholdsSchema = registry.register(
  'Thresholds',
  z.object({
    assignmentSubmissionAtRisk: z.number().min(0).max(100),
    consumptionAtRisk: z.number().min(0).max(100),
    liveAttendanceAtRisk: z.number().min(0).max(100),
    highSegmentMin: z.number().min(0).max(100),
    mediumSegmentMin: z.number().min(0).max(100),
  })
);

// --- Follow-up Schemas ---
const followupSchema = registry.register(
  'Followup',
  z.object({
    id: z.string().uuid(),
    studentId: z.string().uuid(),
    studentName: z.string().optional(),
    snapshotId: z.string().uuid().nullable().optional(),
    ownerId: z.string().uuid(),
    ownerEmail: z.string().optional(),
    note: z.string(),
    status: z.enum(['open', 'in_progress', 'done']),
    createdAt: z.string().datetime(),
  })
);

// --- Register Paths ---

// 1. Health
registry.registerPath({
  method: 'get',
  path: '/api/v1/health',
  summary: 'Liveness and database health check',
  responses: {
    200: {
      description: 'System health status',
      content: {
        'application/json': {
          schema: z.object({
            status: z.string(),
            database: z.string(),
            timestamp: z.string(),
          }),
        },
      },
    },
  },
});

// 2. Auth Register & Login & Me
const registerInputSchema = registry.register(
  'RegisterInput',
  z.object({
    name: z.string().min(1),
    email: z.string().email(),
    password: z.string().min(6),
    role: z.enum(['admin', 'manager', 'trainer']).default('trainer'),
  })
);

registry.registerPath({
  method: 'post',
  path: '/api/v1/auth/register',
  summary: 'Register a new user account with email, name, and password',
  request: {
    body: {
      content: { 'application/json': { schema: registerInputSchema } },
    },
  },
  responses: {
    201: {
      description: 'Account created with access and refresh tokens',
      content: { 'application/json': { schema: tokenResponseSchema } },
    },
    409: { description: 'Email already exists' },
  },
});

registry.registerPath({
  method: 'post',
  path: '/api/v1/auth/login',
  summary: 'Authenticate with email and password',
  request: {
    body: {
      content: { 'application/json': { schema: loginSchema } },
    },
  },
  responses: {
    200: {
      description: 'Access and refresh tokens',
      content: { 'application/json': { schema: tokenResponseSchema } },
    },
    401: { description: 'Invalid credentials' },
  },
});

registry.registerPath({
  method: 'get',
  path: '/api/v1/auth/me',
  summary: 'Retrieve authenticated user profile',
  security: [{ [bearerAuth.name]: [] }],
  responses: {
    200: {
      description: 'Current user profile',
      content: { 'application/json': { schema: z.object({ user: userSchema }) } },
    },
    401: { description: 'Not authenticated' },
  },
});

// 3. Batches List & Create
registry.registerPath({
  method: 'get',
  path: '/api/v1/batches',
  summary: 'List accessible batches',
  security: [{ [bearerAuth.name]: [] }],
  responses: {
    200: {
      description: 'List of batches',
      content: { 'application/json': { schema: z.object({ batches: z.array(batchSchema) }) } },
    },
  },
});

registry.registerPath({
  method: 'post',
  path: '/api/v1/batches',
  summary: 'Create a new batch (Admin only)',
  security: [{ [bearerAuth.name]: [] }],
  request: {
    body: {
      content: { 'application/json': { schema: createBatchSchema } },
    },
  },
  responses: {
    201: {
      description: 'Created batch',
      content: { 'application/json': { schema: z.object({ batch: batchSchema }) } },
    },
  },
});

// 4. Batch Upload
registry.registerPath({
  method: 'post',
  path: '/api/v1/batches/{id}/uploads',
  summary: 'Upload LMS Excel export file (Admin, Trainer)',
  security: [{ [bearerAuth.name]: [] }],
  request: {
    params: z.object({ id: z.string().uuid() }),
    body: {
      content: {
        'multipart/form-data': {
          schema: z.object({
            file: z.any().openapi({ type: 'string', format: 'binary' }),
            snapshotDate: z.string().optional(),
            replace: z.string().optional(),
          }),
        },
      },
    },
  },
  responses: {
    201: { description: 'Snapshot created successfully' },
    409: { description: 'Duplicate snapshot date without replace flag' },
  },
});

// 5. Batch Overview Analytics
registry.registerPath({
  method: 'get',
  path: '/api/v1/batches/{id}/overview',
  summary: 'Batch overview metrics, scorecards, and segment breakdown',
  security: [{ [bearerAuth.name]: [] }],
  request: {
    params: z.object({ id: z.string().uuid() }),
    query: z.object({ snapshotId: z.string().uuid().optional() }),
  },
  responses: {
    200: { description: 'Batch overview metrics' },
  },
});

// 6. Batch Comparison
registry.registerPath({
  method: 'get',
  path: '/api/v1/batches/{id}/compare',
  summary: 'Compare two snapshots with deltas and 3x3 segment movement matrix',
  security: [{ [bearerAuth.name]: [] }],
  request: {
    params: z.object({ id: z.string().uuid() }),
    query: z.object({ from: z.string().uuid(), to: z.string().uuid() }),
  },
  responses: {
    200: { description: 'Comparison metrics and movement matrix' },
  },
});

// 7. Batch At-Risk Learners
registry.registerPath({
  method: 'get',
  path: '/api/v1/batches/{id}/at-risk',
  summary: 'List learners flagged at-risk with triggered criteria (supports CSV)',
  security: [{ [bearerAuth.name]: [] }],
  request: {
    params: z.object({ id: z.string().uuid() }),
    query: z.object({
      snapshotId: z.string().uuid().optional(),
      format: z.enum(['json', 'csv']).optional(),
    }),
  },
  responses: {
    200: { description: 'At-risk learners list or CSV download' },
  },
});

// 8. Student Profile
registry.registerPath({
  method: 'get',
  path: '/api/v1/students/{id}',
  summary: 'Student profile with longitudinal trajectory, assignments, and attendance',
  security: [{ [bearerAuth.name]: [] }],
  request: {
    params: z.object({ id: z.string().uuid() }),
  },
  responses: {
    200: { description: 'Comprehensive student profile' },
    404: { description: 'Student not found' },
  },
});

// 9. Followups
registry.registerPath({
  method: 'get',
  path: '/api/v1/followups',
  summary: 'List student follow-up notes',
  security: [{ [bearerAuth.name]: [] }],
  responses: {
    200: {
      description: 'Follow-ups list',
      content: { 'application/json': { schema: z.object({ data: z.array(followupSchema) }) } },
    },
  },
});

// 10. Settings Thresholds
registry.registerPath({
  method: 'get',
  path: '/api/v1/settings/thresholds',
  summary: 'Get current risk and segment thresholds',
  security: [{ [bearerAuth.name]: [] }],
  responses: {
    200: {
      description: 'Current thresholds',
      content: { 'application/json': { schema: thresholdsSchema } },
    },
  },
});

registry.registerPath({
  method: 'put',
  path: '/api/v1/settings/thresholds',
  summary: 'Update risk and segment thresholds (Admin only)',
  security: [{ [bearerAuth.name]: [] }],
  request: {
    body: {
      content: { 'application/json': { schema: thresholdsSchema } },
    },
  },
  responses: {
    200: {
      description: 'Updated thresholds',
      content: { 'application/json': { schema: thresholdsSchema } },
    },
  },
});

// 11. Report Export
registry.registerPath({
  method: 'get',
  path: '/api/v1/batches/{id}/report',
  summary: 'Export executive batch report as formatted Excel workbook (Admin, Manager)',
  security: [{ [bearerAuth.name]: [] }],
  request: {
    params: z.object({ id: z.string().uuid() }),
    query: z.object({
      format: z.literal('xlsx').optional(),
      snapshotId: z.string().uuid().optional(),
    }),
  },
  responses: {
    200: {
      description: 'Excel report workbook (.xlsx)',
      content: {
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': {
          schema: z.any().openapi({ type: 'string', format: 'binary' }),
        },
      },
    },
  },
});

// Generate OpenAPI 3.0 Document
export function generateOpenApiDocument() {
  const generator = new OpenApiGeneratorV3(registry.definitions);

  return generator.generateDocument({
    openapi: '3.0.0',
    info: {
      title: 'Student Progress Analytics Platform API',
      version: '1.0.0',
      description:
        'RESTful API for Student Progress Analytics, LMS Excel Ingestion, Longitudinal Trajectories, and At-Risk Intervention.',
      contact: {
        name: 'Analytics Engineering Team',
      },
    },
    servers: [
      {
        url: 'http://localhost:4000',
        description: 'Local development server',
      },
    ],
  });
}
