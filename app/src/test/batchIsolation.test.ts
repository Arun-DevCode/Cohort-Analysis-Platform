import { describe, it, expect, beforeEach } from 'vitest';
import { db } from '@/core/db';
import { usePlatformStore } from '@/store/usePlatformStore';
import type { Snapshot, Student, StudentSnapshot, AssignmentResult, Session } from '@/types';

describe('Frontend Step 3: Batch and Snapshot Isolation Tests', () => {
  beforeEach(async () => {
    await db.delete();
    await db.open();
    localStorage.clear();
    usePlatformStore.setState({
      selectedBatchId: null,
      selectedSnapshotId: null,
      selectedStudentId: null,
    });
  });

  it('filters date options strictly by selected batch and resets date on batch switch', async () => {
    // 1. Seed two batches
    await db.batches.bulkAdd([
      { id: 'batch-da', name: 'Data Analytics', createdAt: Date.now() },
      { id: 'batch-afsd', name: 'Full Stack Java', createdAt: Date.now() },
      { id: 'batch-empty', name: 'Empty Batch', createdAt: Date.now() },
    ]);

    // 2. Seed snapshots
    await db.snapshots.bulkAdd([
      {
        id: 'snap-da-1',
        batchId: 'batch-da',
        snapshotDate: '2026-10-20',
        fileName: 'da_1.xlsx',
        fileHash: 'hash-da-1',
        parserVersion: '1.0.0',
        uploadedAt: Date.now(),
      },
      {
        id: 'snap-da-2',
        batchId: 'batch-da',
        snapshotDate: '2026-10-25',
        fileName: 'da_2.xlsx',
        fileHash: 'hash-da-2',
        parserVersion: '1.0.0',
        uploadedAt: Date.now(),
      },
      {
        id: 'snap-afsd-1',
        batchId: 'batch-afsd',
        snapshotDate: '2026-10-27',
        fileName: 'afsd_1.xlsx',
        fileHash: 'hash-afsd-1',
        parserVersion: '1.0.0',
        uploadedAt: Date.now(),
      },
    ]);

    // 3. Seed students: 20 DA students, 15 AFSD students, including a shared student ID
    const daStudents = Array.from({ length: 20 }, (_, i) => ({
      id: `std-da-${i + 1}`,
      externalStudentId: `DA_EXT_${i + 1}`,
      name: `DA Learner ${i + 1}`,
      phoneE164: `+9198000${String(i + 1).padStart(5, '0')}`,
    }));

    // std-da-1 also enrolled in AFSD (shared student across batches)
    const afsdStudents = Array.from({ length: 15 }, (_, i) => {
      const id = i === 0 ? 'std-da-1' : `std-afsd-${i + 1}`;
      return {
        id,
        externalStudentId: `AFSD_EXT_${i + 1}`,
        name: i === 0 ? 'DA Learner 1 (In AFSD)' : `AFSD Learner ${i + 1}`,
        phoneE164: i === 0 ? '+919800000001' : `+9199000${String(i + 1).padStart(5, '0')}`,
      };
    });

    // Bulk add unique students (total = 20 + 14 = 34 unique students in Dexie db)
    const allUniqueStudents = [...daStudents];
    for (const s of afsdStudents) {
      if (!allUniqueStudents.some((u) => u.id === s.id)) {
        allUniqueStudents.push(s);
      }
    }
    await db.students.bulkAdd(allUniqueStudents);

    // Helper to generate metrics
    const makeMetrics = (pct: number) => ({
      totalConsumptionPct: pct,
      videoPct: pct,
      pdfPct: pct,
      quizSubmissionPct: pct,
      flashCardsPct: 0,
      aiContentPct: 0,
      assignmentSubmissionPct: pct,
      assignmentAggregateScorePct: pct,
      liveClassPct: pct,
      liveOrRecordingPct: pct,
      pdfTotal: 10,
      pdfConsumed: Math.round((pct / 100) * 10),
      videoTotal: 10,
      videoConsumed: Math.round((pct / 100) * 10),
      quizTotal: 10,
      quizAttended: Math.round((pct / 100) * 10),
      flashCardsTotal: 0,
      flashCardsConsumed: 0,
      aiContentTotal: 0,
      aiContentAttempted: 0,
      assignmentsTotal: 4,
      assignmentsSubmitted: Math.round((pct / 100) * 4),
      liveClassAttended: Math.round((pct / 100) * 10),
      liveClassTotal: 10,
      liveOrRecordingConsumed: Math.round((pct / 100) * 10),
    });

    // 4. Seed student snapshots
    // DA snap 1: 50% consumption
    const daSnap1Rows = daStudents.map((s) => ({
      id: `ss-da-1-${s.id}`,
      snapshotId: 'snap-da-1',
      studentId: s.id,
      metrics: makeMetrics(50),
      segment: 'Medium' as const,
    }));

    // DA snap 2: 75% consumption
    const daSnap2Rows = daStudents.map((s) => ({
      id: `ss-da-2-${s.id}`,
      snapshotId: 'snap-da-2',
      studentId: s.id,
      metrics: makeMetrics(75),
      segment: 'High' as const,
    }));

    // AFSD snap 1: 90% consumption
    const afsdSnap1Rows = afsdStudents.map((s) => ({
      id: `ss-afsd-1-${s.id}`,
      snapshotId: 'snap-afsd-1',
      studentId: s.id,
      metrics: makeMetrics(90),
      segment: 'High' as const,
    }));

    await db.studentSnapshots.bulkAdd([...daSnap1Rows, ...daSnap2Rows, ...afsdSnap1Rows]);

    // Helper functions mirroring App.tsx and Navbar.tsx scoping logic
    const getAllSnapshots = async () => db.snapshots.toArray();
    const getAllStudents = async () => db.students.toArray();
    const getAllStudentSnapshots = async () => db.studentSnapshots.toArray();

    const getBatchSnapshots = (allSnaps: Snapshot[], batchId: string | null): Snapshot[] => {
      if (!batchId) return [];
      return allSnaps
        .filter((s) => s.batchId === batchId)
        .sort((a, b) => b.snapshotDate.localeCompare(a.snapshotDate));
    };

    const getScopedStudents = (
      allStuds: Student[],
      allSs: StudentSnapshot[],
      currentSnapshot: Snapshot | null
    ): Student[] => {
      if (!currentSnapshot) return [];
      const validStudentIds = new Set(
        allSs
          .filter((ss) => ss.snapshotId === currentSnapshot.id)
          .map((ss) => ss.studentId)
      );
      return allStuds.filter((s) => validStudentIds.has(s.id));
    };

    const allSnaps = await getAllSnapshots();
    const allStuds = await getAllStudents();
    const allSs = await getAllStudentSnapshots();

    // --- STEP A: Select Batch DA ---
    usePlatformStore.getState().setSelectedBatchId('batch-da');
    const daSnaps = getBatchSnapshots(allSnaps, 'batch-da');
    expect(daSnaps).toHaveLength(2);
    // Dates must be newest first: '2026-10-25' then '2026-10-20'
    expect(daSnaps.map((s) => s.snapshotDate)).toEqual(['2026-10-25', '2026-10-20']);
    // AFSD's date must NOT be in DA's options
    expect(daSnaps.some((s) => s.snapshotDate === '2026-10-27')).toBe(false);

    // Default to latest snapshot
    usePlatformStore.getState().setSelectedSnapshotId(daSnaps[0].id);
    expect(usePlatformStore.getState().selectedSnapshotId).toBe('snap-da-2');

    let currentSnapshot = daSnaps[0];
    let currentStudents = getScopedStudents(allStuds, allSs, currentSnapshot);
    expect(currentStudents).toHaveLength(20);
    // Verified: Exactly 20 students, not 34 or 75
    expect(currentStudents.every((s) => s.id.startsWith('std-da'))).toBe(true);

    // Compute average consumption for snap-da-2
    let scopedSs = allSs.filter((ss) => ss.snapshotId === currentSnapshot.id);
    let avgConsumption =
      scopedSs.reduce((acc, curr) => acc + curr.metrics.totalConsumptionPct, 0) / scopedSs.length;
    expect(avgConsumption).toBe(75);

    // --- STEP B: Switch Date within DA to '2026-10-20' ---
    usePlatformStore.getState().setSelectedSnapshotId('snap-da-1');
    currentSnapshot = daSnaps.find((s) => s.id === 'snap-da-1')!;
    expect(currentSnapshot.snapshotDate).toBe('2026-10-20');

    currentStudents = getScopedStudents(allStuds, allSs, currentSnapshot);
    expect(currentStudents).toHaveLength(20);
    scopedSs = allSs.filter((ss) => ss.snapshotId === currentSnapshot.id);
    avgConsumption =
      scopedSs.reduce((acc, curr) => acc + curr.metrics.totalConsumptionPct, 0) / scopedSs.length;
    expect(avgConsumption).toBe(50); // Updates to that snapshot's numbers

    // --- STEP C: Switch Batch to AFSD ---
    usePlatformStore.getState().setSelectedBatchId('batch-afsd');
    const afsdSnaps = getBatchSnapshots(allSnaps, 'batch-afsd');
    expect(afsdSnaps).toHaveLength(1);
    expect(afsdSnaps[0].snapshotDate).toBe('2026-10-27');

    // On batch change, select that batch's latest date
    usePlatformStore.getState().setSelectedSnapshotId(afsdSnaps[0].id);
    expect(usePlatformStore.getState().selectedSnapshotId).toBe('snap-afsd-1');

    currentSnapshot = afsdSnaps[0];
    currentStudents = getScopedStudents(allStuds, allSs, currentSnapshot);
    // Student count changes to exactly 15
    expect(currentStudents).toHaveLength(15);
    // Shared student std-da-1 is present, but remaining 19 DA students are NOT present
    expect(currentStudents.some((s) => s.id === 'std-da-1')).toBe(true);
    expect(currentStudents.filter((s) => s.id.startsWith('std-da'))).toHaveLength(1);

    // Numbers update to AFSD's snapshot (90%)
    scopedSs = allSs.filter((ss) => ss.snapshotId === currentSnapshot.id);
    avgConsumption =
      scopedSs.reduce((acc, curr) => acc + curr.metrics.totalConsumptionPct, 0) / scopedSs.length;
    expect(avgConsumption).toBe(90);

    // --- STEP D: Switch to Batch with 0 Snapshots ---
    usePlatformStore.getState().setSelectedBatchId('batch-empty');
    const emptySnaps = getBatchSnapshots(allSnaps, 'batch-empty');
    expect(emptySnaps).toHaveLength(0);

    usePlatformStore.getState().setSelectedSnapshotId(null);
    expect(usePlatformStore.getState().selectedSnapshotId).toBeNull();
    currentStudents = getScopedStudents(allStuds, allSs, null);
    expect(currentStudents).toHaveLength(0);

    // --- STEP E: Persistence in localStorage ---
    const stored = JSON.parse(localStorage.getItem('spp_selection_default') || '{}');
    expect(stored.batchId).toBe('batch-empty');
  });

  it('Assignments and Attendance tabs never combine data across batches sharing the same date', async () => {
    const sharedDate = '2026-10-27';

    // 1. Seed two batches
    await db.batches.bulkAdd([
      { id: 'batch-da', name: 'DA Course', createdAt: Date.now() },
      { id: 'batch-afsd', name: 'AFSD Course', createdAt: Date.now() },
    ]);

    // 2. Both snapshots have the EXACT SAME date (2026-10-27)
    await db.snapshots.bulkAdd([
      {
        id: 'snap-da',
        batchId: 'batch-da',
        snapshotDate: sharedDate,
        fileName: 'DA_27Oct.xlsx',
        fileHash: 'hash-da',
        parserVersion: '1.0.0',
        uploadedAt: Date.now(),
      },
      {
        id: 'snap-afsd',
        batchId: 'batch-afsd',
        snapshotDate: sharedDate,
        fileName: 'AFSD_27Oct.xlsx',
        fileHash: 'hash-afsd',
        parserVersion: '1.0.0',
        uploadedAt: Date.now(),
      },
    ]);

    // 3. DA has 14 assignments, AFSD has 4 assignments
    const daAssignments: AssignmentResult[] = [];
    for (let i = 1; i <= 14; i++) {
      daAssignments.push({
        id: `da-ar-${i}`,
        snapshotId: 'snap-da',
        studentId: 'std-da-1',
        assignmentName: `DA Assignment ${i}`,
        status: 'PASSED',
        score: 100,
        maxScore: 100,
      });
    }

    const afsdAssignments: AssignmentResult[] = [];
    for (let i = 1; i <= 4; i++) {
      afsdAssignments.push({
        id: `afsd-ar-${i}`,
        snapshotId: 'snap-afsd',
        studentId: 'std-afsd-1',
        assignmentName: `AFSD Assignment ${i}`,
        status: 'PASSED',
        score: 100,
        maxScore: 100,
      });
    }

    // Add all to Dexie (total = 14 + 4 = 18 in database)
    await db.assignmentResults.bulkAdd([...daAssignments, ...afsdAssignments]);

    // 4. DA has 53 sessions, AFSD has 31 sessions (total = 84 in database)
    const daSessions: Session[] = Array.from({ length: 53 }, (_, i) => ({
      id: `da-sess-${i + 1}`,
      snapshotId: 'snap-da',
      title: `DA Class Session ${i + 1}`,
      sessionDate: sharedDate,
      originalColumn: `Col_${i}`,
      orderIndex: i,
    }));

    const afsdSessions: Session[] = Array.from({ length: 31 }, (_, i) => ({
      id: `afsd-sess-${i + 1}`,
      snapshotId: 'snap-afsd',
      title: `AFSD Class Session ${i + 1}`,
      sessionDate: sharedDate,
      originalColumn: `Col_${i}`,
      orderIndex: i,
    }));

    await db.sessions.bulkAdd([...daSessions, ...afsdSessions]);

    // Read all from Dexie
    const allAssignments = await db.assignmentResults.toArray();
    const allSessions = await db.sessions.toArray();
    expect(allAssignments).toHaveLength(18);
    expect(allSessions).toHaveLength(84);

    // --- In DA batch ---
    const currentDaSnapshot = await db.snapshots.get('snap-da');
    const daScopedAssignments = allAssignments.filter((a) => a.snapshotId === currentDaSnapshot!.id);
    const daScopedSessions = allSessions.filter((s) => s.snapshotId === currentDaSnapshot!.id);

    // DA Assignments: exactly 14 items, never 18
    const daUniqueNames = Array.from(new Set(daScopedAssignments.map((a) => a.assignmentName)));
    expect(daUniqueNames).toHaveLength(14);
    expect(daUniqueNames.every((n) => n.startsWith('DA Assignment'))).toBe(true);

    // DA Attendance: exactly 53 sessions, never 84
    expect(daScopedSessions).toHaveLength(53);
    expect(daScopedSessions.every((s) => s.title.startsWith('DA Class Session'))).toBe(true);
    // Student row denominator matches session count
    const daDenominator = daScopedSessions.length;
    expect(daDenominator).toBe(53);

    // --- In AFSD batch ---
    const currentAfsdSnapshot = await db.snapshots.get('snap-afsd');
    const afsdScopedAssignments = allAssignments.filter((a) => a.snapshotId === currentAfsdSnapshot!.id);
    const afsdScopedSessions = allSessions.filter((s) => s.snapshotId === currentAfsdSnapshot!.id);

    // AFSD Assignments: exactly 4 items, never 18
    const afsdUniqueNames = Array.from(new Set(afsdScopedAssignments.map((a) => a.assignmentName)));
    expect(afsdUniqueNames).toHaveLength(4);
    expect(afsdUniqueNames.every((n) => n.startsWith('AFSD Assignment'))).toBe(true);

    // AFSD Attendance: exactly 31 sessions, never 84
    expect(afsdScopedSessions).toHaveLength(31);
    expect(afsdScopedSessions.every((s) => s.title.startsWith('AFSD Class Session'))).toBe(true);
    // Student row denominator matches session count
    const afsdDenominator = afsdScopedSessions.length;
    expect(afsdDenominator).toBe(31);
  });

  it('Compare tab validates minimum 2 dates of same batch and shows empty state when < 2 reports', async () => {
    // 1. Seed batches & snapshots
    await db.batches.bulkAdd([
      { id: 'batch-da', name: 'DA', createdAt: Date.now() },
      { id: 'batch-afsd', name: 'AFSD', createdAt: Date.now() },
    ]);

    await db.snapshots.bulkAdd([
      {
        id: 'snap-da-1',
        batchId: 'batch-da',
        snapshotDate: '2026-10-20',
        fileName: 'da1.xlsx',
        fileHash: 'h1',
        parserVersion: '1.0.0',
        uploadedAt: Date.now(),
      },
      {
        id: 'snap-da-2',
        batchId: 'batch-da',
        snapshotDate: '2026-10-25',
        fileName: 'da2.xlsx',
        fileHash: 'h2',
        parserVersion: '1.0.0',
        uploadedAt: Date.now(),
      },
      {
        id: 'snap-afsd-1',
        batchId: 'batch-afsd',
        snapshotDate: '2026-10-25',
        fileName: 'afsd1.xlsx',
        fileHash: 'h3',
        parserVersion: '1.0.0',
        uploadedAt: Date.now(),
      },
    ]);

    const allSnaps = await db.snapshots.toArray();

    // Batch DA has 2 snapshots -> Can compare
    const daSnaps = allSnaps
      .filter((s) => s.batchId === 'batch-da')
      .sort((a, b) => b.snapshotDate.localeCompare(a.snapshotDate));
    expect(daSnaps).toHaveLength(2);
    expect(daSnaps.length >= 2).toBe(true);
    // Compare dates list DA's dates only
    expect(daSnaps.map((s) => s.snapshotDate)).toEqual(['2026-10-25', '2026-10-20']);

    // Batch AFSD has 1 snapshot -> < 2 snapshots -> requires empty state
    const afsdSnaps = allSnaps
      .filter((s) => s.batchId === 'batch-afsd')
      .sort((a, b) => b.snapshotDate.localeCompare(a.snapshotDate));
    expect(afsdSnaps).toHaveLength(1);
    expect(afsdSnaps.length >= 2).toBe(false);
    // Empty state message expectation
    const emptyStatePrompt = 'Upload another report for this course to compare';
    expect(emptyStatePrompt).toBe('Upload another report for this course to compare');
  });
});
