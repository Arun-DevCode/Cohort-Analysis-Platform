# Student Progress Analytics Backend API

Production-ready RESTful backend API for **Student Progress Analytics**, built with **Node.js 20**, **Express.js**, **TypeScript (Strict)**, **PostgreSQL**, and **Drizzle ORM**. It ingests multi-sheet LMS Excel exports, computes longitudinal student performance metrics, detects at-risk learners, provides executive Excel reports, and powers the companion React frontend.

---

## 1. Architecture Overview

The system adheres to an **MVC + Pure Services** architecture:
- **Models (`src/models/`):** Thin Drizzle query wrappers interfacing directly with PostgreSQL tables.
- **Services (`src/services/`):** Pure, deterministic business logic (parsers, identity resolvers, metric engines, at-risk detectors, Excel report generators, audit logging).
- **Controllers (`src/controllers/`):** Request/response coordination without embedded domain logic.
- **Views (`src/views/`):** Consistent JSON response shaping and presentation filtering.
- **Middleware (`src/middleware/`):** JWT authentication, RBAC, trainer batch-ownership verification, rate limiting, Multer file limits, centralized error handling.
- **Validators (`src/validators/`):** Zod schemas validating request params, queries, bodies, and parsed Excel rows.

---

## 2. Tech Stack

- **Runtime & Language:** Node.js 20 LTS, TypeScript 5.7 (ESM, strict mode)
- **Framework:** Express 4.21 with Helmet, CORS, and Express Rate Limit
- **Database & ORM:** PostgreSQL 16, Drizzle ORM 0.38, Drizzle Kit 0.30
- **Validation & Docs:** Zod 3.24, `@asteasolutions/zod-to-openapi`, Swagger UI Express
- **Security:** Argon2id password hashing, JWT access (15m) + rotating refresh (7d) tokens
- **Excel Processing:** ExcelJS 4.4 (streaming value reader & styled report generator)
- **Logging:** Pino 9 with PII redaction (`authorization`, `password`, `token`, `phone`)
- **Testing:** Vitest 3.0, Supertest 7.0, `@electric-sql/pglite` (WASM PostgreSQL in-memory test runner)

---

## 3. Database Schema

The database consists of **16 PostgreSQL tables** with strict foreign keys, indexes, and cascade rules:

| Table | Purpose | Primary Keys & Indexes |
|---|---|---|
| `users` | System users (admin, manager, trainer) | `id` (UUID PK), `email` (Unique) |
| `batches` | Training batches | `id` (UUID PK), `external_batch_id` (Unique) |
| `batch_trainers` | Trainer-to-batch assignments | `(batch_id, user_id)` Composite PK |
| `students` | Normalized student roster | `id` (UUID PK), `external_student_id` (Unique), `phone_e164` |
| `batch_students` | Student-to-batch membership | `(batch_id, student_id)` Composite PK |
| `uploads` | File upload tracking and error reports | `id` (UUID PK), `status` enum, `batch_id` FK |
| `snapshots` | Dated progress snapshot headers | `id` (UUID PK), `(batch_id, snapshot_date)` Unique |
| `student_snapshots` | Longitudinal metrics per student per snapshot | `id` (UUID PK), `(snapshot_id, student_id)` Index |
| `assignment_items` | Distinct assignment catalog per snapshot | `id` (UUID PK), `snapshot_id` FK |
| `assignment_results` | Student scores and submission statuses | `id` (UUID PK), `(assignment_item_id, student_id)` |
| `weekly_consumption`| Content consumed vs total per week | `id` (UUID PK), `(snapshot_id, student_id, week_no)` |
| `sessions` | Live class sessions per snapshot | `id` (UUID PK), `snapshot_id` FK |
| `attendance` | Live and recorded attendance per student | `id` (UUID PK), `(session_id, student_id)` |
| `followups` | Intervention notes on learners | `id` (UUID PK), `student_id` FK, `owner_id` FK |
| `settings` | Dynamic threshold configuration | `key` (PK), `value` JSONB |
| `audit_logs` | Immutability audit trail | `id` (UUID PK), `user_id` FK, `action`, `created_at` |

---

## 4. Ingestion Pipeline & Golden Test

The ingestion pipeline (`src/services/ingestion/`) is designed for resilient parsing of real-world LMS workbooks:

1. **Upload Validation:** `multer` receives up to 25 MB in memory; checks MIME type and magic bytes.
2. **Deduplication:** Computes SHA-256 hash. Duplicate hashes within the same batch return the earlier upload immediately.
3. **Dynamic Sheet Detection:** Scans worksheet names, falling back to header signatures to identify the 5 required sheets:
   - Overview / Cumulative Progress
   - Assignment Submissions & Scores
   - Week-wise Content Consumption
   - Live Session Attendance
   - Summary
4. **Value Normalization:** Strips formulas, normalizes phone numbers to E.164 (`+91...`), cleans names, parses percentages (`"62.1%"` -> `62.1`), maps attendance codes (`"P"`, `"A"`, `"Recording"`), and parses session dates.
5. **Zod Row Validation:** Validates row data with refinements ensuring `consumed <= total` and `assignmentsSubmitted <= assignmentsTotal`.
6. **Multi-Sheet Identity Resolver:** Reconciles student records across sheets using a priority cascade:
   $$\text{Student ID} \longrightarrow \text{E.164 Phone} \longrightarrow \text{Normalized Name}$$
7. **Atomic Transaction Loader:** Inserts snapshot header, students, student snapshots, assignments, weekly consumption, sessions, and attendance in **one single PostgreSQL transaction**.
8. **Audit Trail:** Updates upload status to `'done'` with unmatched row reports and writes an audit log entry.

### Golden Ingestion Benchmark
Validated against `Cumulative_Report_Batch_15748.xlsx`:
- **Total Students:** 31
- **Assignment Submission Average:** 62.1%
- **Content Consumption Average:** 67.8%
- **Live Attendance Average:** 72.9%
- **Live + Recorded Attendance Average:** 78.0%
- **Assignment Results Loaded:** 124 (4 assignments x 31 students)
- **Weekly Consumption Loaded:** 310 (10 weeks x 31 students)
- **Attendance Records Loaded:** 899 (29 sessions x 31 students)

---

## 5. REST API Reference

Interactive Swagger documentation is available at **`/api-docs`** and raw OpenAPI 3.0 JSON at **`/api-docs.json`**.

### Authentication (`/api/v1/auth`)
| Method | Endpoint | Role | Description |
|---|---|---|---|
| `POST` | `/api/v1/auth/login` | Public | Authenticate with email & password, returns JWT tokens |
| `POST` | `/api/v1/auth/refresh` | Public | Exchange refresh token for fresh 15-minute access token |
| `POST` | `/api/v1/auth/logout` | Public | Invalidate active session |

### User Management (`/api/v1/users`)
| Method | Endpoint | Role | Description |
|---|---|---|---|
| `GET` | `/api/v1/users` | Admin | List all system users |
| `POST` | `/api/v1/users` | Admin | Create user with role (`admin`, `manager`, `trainer`) |
| `PATCH` | `/api/v1/users/:id` | Admin | Update user role or password |

### Batches & Uploads (`/api/v1/batches`)
| Method | Endpoint | Role | Description |
|---|---|---|---|
| `GET` | `/api/v1/batches` | All (RBAC) | List batches (trainers see assigned batches only) |
| `POST` | `/api/v1/batches` | Admin | Create new training batch |
| `GET` | `/api/v1/batches/:id` | All (RBAC) | Get batch details |
| `PATCH` | `/api/v1/batches/:id` | Admin | Update batch name, code, or dates |
| `DELETE` | `/api/v1/batches/:id` | Admin | Delete batch and cascade all associated data |
| `POST` | `/api/v1/batches/:id/trainers` | Admin | Assign trainers to batch |
| `POST` | `/api/v1/batches/:id/uploads` | Admin, Trainer | Upload LMS Excel report (`replace=true` for re-upload) |
| `GET` | `/api/v1/uploads/:id` | Admin, Trainer | Check upload processing status and error report |
| `GET` | `/api/v1/batches/:id/snapshots` | All (RBAC) | List all dated snapshots for batch |

### Analytics & Reports (`/api/v1/batches/:id/*`)
| Method | Endpoint | Role | Description |
|---|---|---|---|
| `GET` | `/api/v1/batches/:id/overview` | All (RBAC) | Scorecards, trends, segment distribution, top movers |
| `GET` | `/api/v1/batches/:id/compare?from=&to=` | All (RBAC) | Compare two snapshots with 3x3 movement matrix |
| `GET` | `/api/v1/batches/:id/at-risk` | All (RBAC) | List at-risk learners (`format=csv` supported) |
| `GET` | `/api/v1/batches/:id/assignments` | All (RBAC) | Per-assignment completion rates & non-submitters |
| `GET` | `/api/v1/batches/:id/content` | All (RBAC) | Week-by-week consumption matrix |
| `GET` | `/api/v1/batches/:id/attendance` | All (RBAC) | Session-wise attendance stats & recording-only learners |
| `GET` | `/api/v1/batches/:id/report?format=xlsx` | Admin, Manager | Export styled multi-tab executive Excel workbook |

### Students & Profiles (`/api/v1/students`)
| Method | Endpoint | Role | Description |
|---|---|---|---|
| `GET` | `/api/v1/students/:id` | All (RBAC) | Student profile with longitudinal trajectory and details |

### Follow-ups & Interventions (`/api/v1/followups`)
| Method | Endpoint | Role | Description |
|---|---|---|---|
| `GET` | `/api/v1/followups` | Admin, Trainer | List follow-up notes (trainers filtered to their students) |
| `POST` | `/api/v1/followups` | Admin, Trainer | Create follow-up note for student |
| `PATCH` | `/api/v1/followups/:id` | Admin, Trainer | Update status (`open`, `in_progress`, `done`) or note |
| `DELETE` | `/api/v1/followups/:id` | Admin, Owner | Remove follow-up record |

### Settings & Configuration (`/api/v1/settings`)
| Method | Endpoint | Role | Description |
|---|---|---|---|
| `GET` | `/api/v1/settings/thresholds` | All | Get current risk and segment thresholds |
| `PUT` | `/api/v1/settings/thresholds` | Admin | Update risk thresholds and segment cutoff percentages |

### Audit Logs (`/api/v1/audit-logs`)
| Method | Endpoint | Role | Description |
|---|---|---|---|
| `GET` | `/api/v1/audit-logs` | Admin | Paginated audit trail of uploads, exports, role changes |

---

## 6. Analytical Metrics & Risk Logic

### Segment Classification
Students are placed into one of three engagement tiers based on average performance:
- **High ($\ge 80\%$):** Consistent engagement across submissions, attendance, and videos.
- **Medium ($50\% - 79.9\%$):** Moderate engagement requiring encouragement.
- **Low ($< 50\%$):** Low engagement requiring intervention.

### At-Risk Criteria
A learner is flagged as **At-Risk** if **ANY** of the following conditions trigger:
1. **Zero Submissions:** `assignmentsSubmitted === 0`
2. **Low Submission Rate:** `assignmentSubmissionPct < 25%`
3. **Low Content Consumption:** `totalConsumptionPct < 50%`
4. **Low Overall Attendance:** `liveOrRecPct < 50%`
5. **Passive Recording Attendance:** `livePct < 30%` and `liveOrRecPct >= 70%` (watching recordings only)
6. **Low Engagement Tier:** `segment === 'low'`

### 3x3 Transition Matrix
When comparing Snapshot $A$ (earlier) to Snapshot $B$ (later), learners are categorized into a 9-cell movement grid:
$$\begin{pmatrix} \text{High}\to\text{High} & \text{High}\to\text{Med} & \text{High}\to\text{Low} \\ \text{Med}\to\text{High} & \text{Med}\to\text{Med} & \text{Med}\to\text{Low} \\ \text{Low}\to\text{High} & \text{Low}\to\text{Med} & \text{Low}\to\text{Low} \end{pmatrix}$$
This directly identifies **Improvers**, **Stable Learners**, and **Drop-offs**.

---

## 7. Local Development & Setup

### Prerequisites
- Node.js 20+
- PostgreSQL 16 (or Docker)

### Installation
```bash
cd server
npm install
```

### Environment Configuration
Copy `.env.example` to `.env`:
```env
PORT=4000
NODE_ENV=development
DATABASE_URL=postgres://postgres:postgres@localhost:5432/student_progress
JWT_SECRET=super_secret_jwt_key_32chars_long_min
REFRESH_SECRET=super_secret_refresh_key_32chars_long
CORS_ORIGINS=http://localhost:5173,http://localhost:3000
INITIAL_ADMIN_EMAIL=admin@entri.app
INITIAL_ADMIN_PASSWORD=AdminPassword123!
```

### Database Migrations & Seeding
```bash
# Generate migrations from Drizzle schema
npm run db:generate

# Apply migrations to database
npm run db:migrate

# Seed initial admin user and default settings
npm run db:seed
```

### Running Locally
```bash
# Start development server with hot-reload
npm run dev

# Compile TypeScript
npm run build

# Start production server
npm start
```

### Running Tests
The test suite utilizes `@electric-sql/pglite` (WebAssembly real PostgreSQL) to execute full transactional queries in-memory without external dependencies:
```bash
# Run all unit and integration tests
npm test

# Type-check TypeScript
npm run lint
```

---

## 8. Docker Deployment

Launch PostgreSQL and the API server with one command:
```bash
# From workspace root
docker compose up --build -d
```

- API Server: `http://localhost:4000`
- Swagger UI: `http://localhost:4000/api-docs`
- Health Check: `http://localhost:4000/api/v1/health`
- PostgreSQL: `localhost:5432`
