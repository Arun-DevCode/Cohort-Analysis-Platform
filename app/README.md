# Student Progress Analytics Platform

A high-performance, **frontend-only** cohort progress and longitudinal analytics platform designed for trainers, mentors, and academic program managers.

Built with **React 19 + TypeScript + Vite + Tailwind CSS**, the application runs 100% inside the browser with **zero backend server, API, or external database**. Student personally identifiable information (PII) never leaves the user's local machine.

---

## 🌟 Key Features

1. **In-Browser LMS Workbook Ingestion**:
   - Parses multi-sheet Excel exports (`.xlsx`) directly in the browser via **SheetJS in a dedicated Web Worker** (`src/workers/parse.worker.ts`) so the UI never stutters.
   - Dynamic column parser detects assignments, curriculum weeks (Weeks 1 to 10), and session dates (`DD-MM-YYYY`).
   - Normalizes percentages, `STATUS / score` cells, week progress `consumed/total`, and phone numbers to **E.164** standard.
   - Robust cross-sheet identity resolution (`Student ID` / `User ID` $\to$ E.164 phone $\to$ normalized name).
   - Filters out non-student LMS summary rows (e.g. `AVERAGE` row in the Assignments sheet).

2. **Immutable IndexedDB Snapshots (Dexie)**:
   - Each upload is persisted as a dated snapshot in **IndexedDB** using Dexie.
   - Atomic transactions across `batches`, `students`, `snapshots`, `studentSnapshots`, `assignmentResults`, `weeklyConsumption`, `sessions`, `attendance`, `followups`, and `settings`.
   - Automatic SHA-256 file hashing for deduplication, and confirmation prompts when overwriting an existing date snapshot.

3. **Core Analytics & Batch Overview Dashboard**:
   - **Scorecards**: Assignment Submission %, Content Consumption %, Live Attendance %, and Live+Recording % with **percentage-point deltas** ($\pm$ signed points) and trend indicators vs prior snapshot.
   - **Trends Over Time**: Multi-snapshot longitudinal line chart with **interactive table view toggle**.
   - **Segment Distribution**: Stacked bar chart for **High ($\ge 80\%$)**, **Medium ($50-79\%$)**, and **Low ($<50\%$)** student cohorts with table toggle.
   - **Top 5 Improvers & Needs Attention**: Instant actionable widgets for mentor interventions.

4. **Snapshot Comparison View**:
   - Dual snapshot selector ($A \to B$).
   - Metric delta comparison table.
   - **$3 \times 3$ Segment Movement Transition Matrix** (High, Medium, Low transitions).
   - Student movement lists categorized into **Improved** ($\ge +2$ pts), **Same** (within 2 pts), and **Declined** ($\le -2$ pts).

5. **At-Risk Learner Engine**:
   - Automatically flags students based on:
     - 0 assignments submitted
     - Total content consumption $< 50\%$
     - Live class attendance $< 50\%$
     - **Recording-only learners** (Live attendance $< 30\%$ and Live+Recording $> 70\%$)
     - **Attends but does not submit** (Live attendance $\ge 70\%$ and Assignment submission $< 25\%$)
   - Filterable table with reason chips and **one-click CSV export**.

6. **Deep-Dive Tabs & Student Profile**:
   - **Assignments View**: Status breakdown (Passed, Delayed, Pending) and a **Non-Submitters Modal** with contact info.
   - **Content Heatmap**: Student $\times$ Week (Weeks 1 to 10) intensity heatmap to pinpoint exactly where student drop-off begins.
   - **Attendance View**: Session-by-session attendance rate bar chart and recording-only learner filter.
   - **Student Profile**: Individual trajectory sparklines, assignment audit, week-wise progress, and local **Follow-up Notes** with status tracking (`PENDING`, `IN_PROGRESS`, `RESOLVED`).

7. **Client-Side Reports & Encrypted Backup**:
   - **One-Page Manager PDF**: Executive progress brief generated client-side using `html2canvas` + `jsPDF`.
   - **Multi-Sheet Excel Export**: Detailed workbook export generated client-side using `xlsx`.
   - **Backup & Restore**: Full JSON database export/import with optional **Web Crypto AES-GCM password encryption**.
   - **Privacy / Presentation Mode**: One-click **Mask PII** toggle (`G***** R**` / `+91 ******9297`) for shared screen presentations.

---

## 🎯 Verified Golden Test Baseline (Batch 15748)

The test suite validates the sample LMS Excel fixture (`Cumulative_Report_Batch_15748.xlsx`) against the exact baseline metrics:

| Metric | Reference Value | Test Assertion |
| :--- | :--- | :--- |
| **Cohort Size** | 31 Students | `31` ✅ |
| **Assignment Submission Avg** | 62.1% | `62.1%` ✅ |
| **Total Consumption Avg** | 67.8% | `67.8%` ✅ |
| **Live Attendance Avg** | 72.9% | `72.9%` ✅ |
| **Live or Recording Avg** | 78.0% | `78.0%` ✅ |
| **Students with 0 Assignments** | 7 | `7` ✅ |
| **Students < 50% Consumption** | 8 | `8` ✅ |
| **Students with 0 Quiz Attempts**| 12 | `12` ✅ |
| **Assignment Results** | 124 records | `124` ✅ |
| **Weekly Consumption** | 310 records | `310` ✅ |
| **Live Sessions** | 29 sessions | `29` ✅ |
| **Attendance Records** | 899 records | `899` ✅ |

---

## 🏗️ Architecture & Project Structure

```text
src/
  app/                    # Global navbar and application layout
    Navbar.tsx
  features/               # Domain-specific feature modules
    upload/               # Web Worker Excel dropzone, validation, preview
    dashboard/            # Metric scorecards, trend line & segment charts
    compare/              # Snapshot A vs B comparison & transition matrix
    assignments/          # Per-assignment stats & non-submitters drawer
    content/              # Week-by-week consumption heatmap & modalities
    attendance/           # Session attendance rates & recording-only learners
    students/             # Student profile, history trajectory, local notes
    atrisk/               # At-risk detector, reason chips, CSV export
    reports/              # Client-side 1-page PDF and Excel builders
    backup/               # JSON export/import with Web Crypto AES-GCM
    settings/             # Thresholds, PII masking, clear storage
  core/                   # Pure business logic & database layer
    parsers/              # SheetJS parser, normalizers, SHA-256 hash
    identity/             # E.164 phone normalizer, fuzzy name matcher, PII mask
    validation/           # Zod schemas, sheet signature & duplicate checks
    analytics/            # Pure functions: deltas, scorecards, movement, at-risk
    db/                   # Dexie IndexedDB schema & atomic repositories
  workers/                # Web Worker for non-blocking workbook parsing
    parse.worker.ts
  ui/                     # Accessible UI components (Badge, Button, Card, Modal)
  store/                  # Zustand store for batch, snapshot, and active tabs
  test/                   # Vitest setup with fake-indexeddb and jest-dom
```

---

## 🚀 Getting Started

### Prerequisites
* **Node.js**: v18.0.0 or higher (v20+ recommended)
* **npm**: v9.0.0 or higher

### Installation
```bash
git clone <repository-url>
cd student-progress-platform
npm install
```

### Running Locally
```bash
npm run dev
```
Open [http://localhost:5173](http://localhost:5173) in your browser.

> **Tip**: Click **"Quick Load Demo Fixture"** on the empty state screen to instantly populate the platform with the full 31-student LMS sample report!

---

## 🧪 Testing and Quality Checks

### Run Unit & Golden File Tests
```bash
npm test
```
Executes all 5 test suites (27 tests) using Vitest:
- Parser normalizers test (`normalizers.test.ts`)
- Phone and identity resolution test (`phone.test.ts`)
- Pure analytics & scorecard logic test (`index.test.ts`)
- IndexedDB snapshot repository transaction test (`snapshotRepository.test.ts`)
- Fixture golden test against `Cumulative_Report_Batch_15748.xlsx` (`workbookParser.test.ts`)

### Run Linter
```bash
npm run lint
```

### Type Checking & Production Build
```bash
npm run build
```
Generates an optimized static bundle in the `dist/` directory.

### Preview Production Build Locally
```bash
npm run preview
```

---

## 🌐 Deploying to Static Hosting

Because this application is 100% frontend with no server, API, or server-side database, it can be deployed for free to any static hosting provider.

### 1. Vercel
1. Install Vercel CLI: `npm i -g vercel`
2. Run `vercel` in the project root.
3. Set build settings:
   - **Framework Preset**: Vite
   - **Build Command**: `npm run build`
   - **Output Directory**: `dist`

### 2. Netlify
1. Connect your repository on [Netlify](https://www.netlify.com/).
2. Configure build settings:
   - **Build command**: `npm run build`
   - **Publish directory**: `dist`
3. Optional `netlify.toml`:
   ```toml
   [[redirects]]
     from = "/*"
     to = "/index.html"
     status = 200
   ```

### 3. Cloudflare Pages
1. In Cloudflare Dashboard, go to **Workers & Pages** $\to$ **Create Application** $\to$ **Pages**.
2. Connect Git repository.
3. Build configuration:
   - **Framework preset**: Vite
   - **Build command**: `npm run build`
   - **Build output directory**: `dist`

### 4. GitHub Pages
1. In `vite.config.ts`, ensure `base: './'` or your repository name.
2. Build and push `dist/` to the `gh-pages` branch.

---

## 🔒 Security & Privacy Architecture

- **No Remote Calls with PII**: Data parsed from `.xlsx` files remains strictly within the client device's IndexedDB. No server database is queried.
- **Client-Side Encryption**: JSON backups can be encrypted using browser-native Web Crypto PBKDF2 + AES-GCM (256-bit) before downloading.
- **PII Masking**: Toggle **Mask PII** in the top bar to obfuscate student names and phone numbers during live presentations or shared screen reviews.
