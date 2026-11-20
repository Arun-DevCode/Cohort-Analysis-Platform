import { describe, it, expect } from 'vitest';
import {
  computeLateSubmissions,
  isSubmittedStatus,
  SnapshotInputData,
  ScheduleInputData,
} from '../services/analytics/lateSubmissionEngine.js';
import { normalizeAssignmentTitle } from '../services/roadmap/roadmapParser.js';

describe('Stage 2: Late-Submission Estimation Engine Tests', () => {
  const batchId = 'batch-b49';
  const assignmentName = 'Assignment: 1 (Build a Restaurant Menu Page)';
  const dueDate = '2026-09-04';

  const schedule: ScheduleInputData[] = [
    {
      lmsAssignmentName: assignmentName,
      dueDate: dueDate,
      type: 'regular',
      roadmapKey: 'rm-1',
    },
  ];

  // Helper to build a snapshot record
  const createSnapshot = (
    id: string,
    snapshotDate: string,
    learnerStatuses: Array<{ studentId: string; status: string; studentName?: string }>
  ): SnapshotInputData => ({
    id,
    snapshotDate,
    assignments: learnerStatuses.map((l) => ({
      studentId: l.studentId,
      studentName: l.studentName || `Learner ${l.studentId}`,
      phoneE164: `+91987654321${l.studentId.slice(-1)}`,
      assignmentName,
      status: l.status,
      score: isSubmittedStatus(l.status) ? 10 : null,
    })),
  });

  describe('Boundary Condition', () => {
    it('treats submission dated exactly on the due date as on_time (S_sub date <= D)', () => {
      // Due date is 2026-09-04
      // Snapshot 1 is dated exactly 2026-09-04 and learner is PASSED
      const snap1 = createSnapshot('snap-1', '2026-09-04', [
        { studentId: 'student-boundary', status: 'PASSED' },
      ]);

      const result = computeLateSubmissions({
        batchId,
        selectedSnapshotId: 'snap-1',
        allBatchSnapshots: [snap1],
        schedule,
      });

      expect(result.certainLateTotal).toBe(0);
      expect(result.possiblyLateTotal).toBe(0);
      expect(result.onTimeTotal).toBe(1);

      const learner = result.assignments[0].learners.find(
        (l) => l.studentId === 'student-boundary'
      );
      expect(learner).toBeDefined();
      expect(learner?.status).toBe('on_time');
      expect(learner?.submissionDateEstimate).toContain('2026-09-04');
      expect(learner?.windowText).toContain('4 Sep');
    });
  });

  describe('Sequence of 3 Uploads', () => {
    it('reports late (not possibly_late) when learner was pending in upload 2 after due date and submitted in upload 3', () => {
      // Due date: 2026-09-04
      // Upload 1: 2026-08-28 (before due date) -> pending
      // Upload 2: 2026-09-11 (after due date) -> pending (S_prev date > D => certain late!)
      // Upload 3: 2026-09-18 (after due date) -> submitted (S_sub date > D)
      const snap1 = createSnapshot('snap-1', '2026-08-28', [
        { studentId: 's1', status: 'SUBMISSION_PENDING' },
      ]);
      const snap2 = createSnapshot('snap-2', '2026-09-11', [
        { studentId: 's1', status: 'SUBMISSION_PENDING' },
      ]);
      const snap3 = createSnapshot('snap-3', '2026-09-18', [
        { studentId: 's1', status: 'PASSED' },
      ]);

      const result = computeLateSubmissions({
        batchId,
        selectedSnapshotId: 'snap-3',
        allBatchSnapshots: [snap1, snap2, snap3],
        schedule,
      });

      expect(result.certainLateTotal).toBe(1);
      expect(result.possiblyLateTotal).toBe(0);
      expect(result.onTimeTotal).toBe(0);

      const learner = result.assignments[0].learners[0];
      expect(learner.status).toBe('late');
      expect(learner.windowStart).toBe('2026-09-11');
      expect(learner.windowEnd).toBe('2026-09-18');
      expect(learner.windowText).toBe('Submitted late (between 11 Sep and 18 Sep)');
    });

    it('reports possibly_late when latest pending snapshot was before due date and submitted snapshot was after due date', () => {
      // Due date: 2026-09-04
      // Upload 1: 2026-08-28 (before due date) -> pending (S_prev date <= D)
      // Upload 2: 2026-09-08 (after due date) -> submitted (S_sub date > D)
      const snap1 = createSnapshot('snap-1', '2026-08-28', [
        { studentId: 's2', status: 'SUBMISSION_PENDING' },
      ]);
      const snap2 = createSnapshot('snap-2', '2026-09-08', [
        { studentId: 's2', status: 'PASSED' },
      ]);

      const result = computeLateSubmissions({
        batchId,
        selectedSnapshotId: 'snap-2',
        allBatchSnapshots: [snap1, snap2],
        schedule,
      });

      expect(result.certainLateTotal).toBe(0);
      expect(result.possiblyLateTotal).toBe(1);
      expect(result.onTimeTotal).toBe(0);

      const learner = result.assignments[0].learners[0];
      expect(learner.status).toBe('possibly_late');
      expect(learner.windowStart).toBe('2026-08-28');
      expect(learner.windowEnd).toBe('2026-09-08');
      expect(learner.windowText).toBe('Submitted between 28 Aug and 8 Sep');
    });
  });

  describe('Out-of-Order Uploads', () => {
    it('sorts snapshots chronologically by report date regardless of array order and produces identical results', () => {
      const snap1 = createSnapshot('snap-1', '2026-08-28', [
        { studentId: 's1', status: 'SUBMISSION_PENDING' },
      ]);
      const snap2 = createSnapshot('snap-2', '2026-09-11', [
        { studentId: 's1', status: 'SUBMISSION_PENDING' },
      ]);
      const snap3 = createSnapshot('snap-3', '2026-09-18', [
        { studentId: 's1', status: 'PASSED' },
      ]);

      // Provide snapshots scrambled: snap3, snap1, snap2
      const scrambledSnapshots = [snap3, snap1, snap2];

      const result = computeLateSubmissions({
        batchId,
        selectedSnapshotId: 'snap-3',
        allBatchSnapshots: scrambledSnapshots,
        schedule,
      });

      expect(result.snapshotDates).toEqual(['2026-08-28', '2026-09-11', '2026-09-18']);
      expect(result.certainLateTotal).toBe(1);
      expect(result.assignments[0].learners[0].status).toBe('late');
      expect(result.assignments[0].learners[0].windowStart).toBe('2026-09-11');
      expect(result.assignments[0].learners[0].windowEnd).toBe('2026-09-18');
    });
  });

  describe('Replacement and Deletion Handling', () => {
    it('recalculates dynamically when a snapshot is deleted without manual cache invalidation', () => {
      // Originally: snap1 (pending 28 Aug), snap2 (pending 11 Sep), snap3 (submitted 18 Sep) => late
      // If snap2 is deleted, snapshots are snap1 (28 Aug) and snap3 (18 Sep).
      // Now S_prev is 28 Aug (<= due date 04 Sep), so it becomes possibly_late!
      const snap1 = createSnapshot('snap-1', '2026-08-28', [
        { studentId: 's1', status: 'SUBMISSION_PENDING' },
      ]);
      const snap3 = createSnapshot('snap-3', '2026-09-18', [
        { studentId: 's1', status: 'PASSED' },
      ]);

      const result = computeLateSubmissions({
        batchId,
        selectedSnapshotId: 'snap-3',
        allBatchSnapshots: [snap1, snap3],
        schedule,
      });

      expect(result.certainLateTotal).toBe(0);
      expect(result.possiblyLateTotal).toBe(1);
      expect(result.assignments[0].learners[0].status).toBe('possibly_late');
      expect(result.assignments[0].learners[0].windowStart).toBe('2026-08-28');
    });

    it('recalculates dynamically when a snapshot is replaced with corrected submission status', () => {
      // Replaced snap2 with a corrected status where learner was already PASSED on 11 Sep
      const snap1 = createSnapshot('snap-1', '2026-08-28', [
        { studentId: 's1', status: 'SUBMISSION_PENDING' },
      ]);
      const replacedSnap2 = createSnapshot('snap-2-replaced', '2026-09-11', [
        { studentId: 's1', status: 'PASSED' },
      ]);

      const result = computeLateSubmissions({
        batchId,
        selectedSnapshotId: 'snap-2-replaced',
        allBatchSnapshots: [snap1, replacedSnap2],
        schedule,
      });

      // S_sub is now 2026-09-11, S_prev is 2026-08-28 (<= due date 04 Sep) => possibly_late
      expect(result.assignments[0].learners[0].firstSubmittedSnapshotDate).toBe('2026-09-11');
      expect(result.assignments[0].learners[0].status).toBe('possibly_late');
      expect(result.assignments[0].learners[0].windowStart).toBe('2026-08-28');
      expect(result.assignments[0].learners[0].windowEnd).toBe('2026-09-11');
    });
  });

  describe('Missing Learner Handling', () => {
    it('handles learner present in upload 2 but missing in upload 1 gracefully as unknown', () => {
      // Upload 1: s1 is present, s_new is missing.
      // Upload 2: s_new is present and PASSED on 2026-09-11 (after due date 2026-09-04).
      // Since s_new was not present in upload 1, there is no S_prev where s_new was pending!
      const snap1 = createSnapshot('snap-1', '2026-08-28', [
        { studentId: 's1', status: 'SUBMISSION_PENDING' },
      ]);
      const snap2 = createSnapshot('snap-2', '2026-09-11', [
        { studentId: 's1', status: 'SUBMISSION_PENDING' },
        { studentId: 's_new', status: 'PASSED' },
      ]);

      const result = computeLateSubmissions({
        batchId,
        selectedSnapshotId: 'snap-2',
        allBatchSnapshots: [snap1, snap2],
        schedule,
      });

      const newLearner = result.assignments[0].learners.find(
        (l) => l.studentId === 's_new'
      );
      expect(newLearner).toBeDefined();
      expect(newLearner?.status).toBe('unknown');
      expect(newLearner?.windowStart).toBeNull();
      expect(newLearner?.windowEnd).toBe('2026-09-11');
      expect(newLearner?.windowText).toContain('Timing unknown');
    });
  });

  describe('Assignment with No Due Date', () => {
    it('excludes assignment with no due date from lateness counts without errors', () => {
      const scheduleWithoutDueDate: ScheduleInputData[] = [
        {
          lmsAssignmentName: 'Assignment Without Date',
          dueDate: null,
          type: 'regular',
        },
      ];

      const snap = {
        id: 'snap-1',
        snapshotDate: '2026-09-11',
        assignments: [
          {
            studentId: 's1',
            studentName: 'Learner 1',
            phoneE164: '+919999999999',
            assignmentName: 'Assignment Without Date',
            status: 'PASSED',
            score: 10,
          },
        ],
      };

      const result = computeLateSubmissions({
        batchId,
        selectedSnapshotId: 'snap-1',
        allBatchSnapshots: [snap],
        schedule: scheduleWithoutDueDate,
      });

      expect(result.missingDueDatesCount).toBe(1);
      expect(result.certainLateTotal).toBe(0);
      expect(result.onTimeTotal).toBe(0);
      expect(result.assignments[0].hasDueDate).toBe(false);
      expect(result.assignments[0].learners[0].status).toBe('no_due_date');
    });
  });

  describe('Selected Snapshot Isolation', () => {
    it('uses only snapshots on or before the selected snapshot and never leaks future snapshots', () => {
      // Upload 1: 2026-08-28 -> pending
      // Upload 2: 2026-09-04 -> pending
      // Upload 3: 2026-09-18 -> passed
      // If user is viewing Upload 2, learner is still pending, NOT passed!
      const snap1 = createSnapshot('snap-1', '2026-08-28', [
        { studentId: 's1', status: 'SUBMISSION_PENDING' },
      ]);
      const snap2 = createSnapshot('snap-2', '2026-09-04', [
        { studentId: 's1', status: 'SUBMISSION_PENDING' },
      ]);
      const snap3 = createSnapshot('snap-3', '2026-09-18', [
        { studentId: 's1', status: 'PASSED' },
      ]);

      const result = computeLateSubmissions({
        batchId,
        selectedSnapshotId: 'snap-2',
        allBatchSnapshots: [snap1, snap2, snap3],
        schedule,
      });

      expect(result.snapshotDate).toBe('2026-09-04');
      expect(result.totalSnapshotsConsidered).toBe(2);
      expect(result.snapshotDates).toEqual(['2026-08-28', '2026-09-04']);

      const learner = result.assignments[0].learners[0];
      expect(learner.status).toBe('not_submitted');
      expect(learner.rawStatus).toBe('SUBMISSION_PENDING');
    });
  });

  describe('Auto-Match Title Normalization', () => {
    it('normalizes LMS and Roadmap assignment titles matching prefixes, punctuation, and case', () => {
      const roadmap1 = normalizeAssignmentTitle(
        'Assignment: 1 (Build a Restaurant Menu Page)'
      );
      const lms1 = normalizeAssignmentTitle('Build a Restaurant Menu Page');
      expect(lms1).toBe('build a restaurant menu page');
      expect(roadmap1).toBe('build a restaurant menu page');
      expect(lms1).toBe(roadmap1);

      const roadmap2 = normalizeAssignmentTitle(
        'Module-End 1 (ShopNest Static Website - HTML and CSS)'
      );
      const lms2 = normalizeAssignmentTitle(
        'M1 - ShopNest Static Website - HTML and CSS Module End'
      );
      expect(roadmap2).toBe('shopnest static website html and css');
      expect(lms2).toBe('shopnest static website html and css module end');

      // Word overlap test
      const words1 = new Set(roadmap2.split(' '));
      const words2 = new Set(lms2.split(' '));
      let overlap = 0;
      for (const w of words1) {
        if (words2.has(w)) overlap++;
      }
      expect(overlap).toBeGreaterThanOrEqual(5);
    });
  });
});
