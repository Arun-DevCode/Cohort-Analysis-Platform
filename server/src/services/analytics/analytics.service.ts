import { getDb } from '../../db/client.js';
import {
  snapshots,
  studentSnapshots,
  students,
  assignmentItems,
  assignmentResults,
  weeklyConsumption,
  sessions,
  attendance,
} from '../../db/schema/index.js';
import { eq, and, asc, desc, inArray } from 'drizzle-orm';
import { AppError } from '../../middleware/errorHandler.js';
import { computeAverage, computeDelta, getTrendDirection } from './metrics.js';
import {
  compareSnapshotStudents,
  StudentSnapshotFact,
  SegmentType,
} from './segments.js';
import {
  identifyAtRiskStudents,
  AtRiskCandidate,
  AtRiskStudentResult,
} from './atRisk.js';

export interface ScorecardMetric {
  title: string;
  currentValue: number;
  previousValue: number | null;
  deltaPts: number | null;
  trend: 'up' | 'down' | 'flat' | null;
}

export interface BatchOverviewData {
  batchId: string;
  snapshotId: string;
  snapshotDate: string;
  totalStudents: number;
  scorecards: {
    assignment: ScorecardMetric;
    consumption: ScorecardMetric;
    liveAttendance: ScorecardMetric;
    liveOrRecAttendance: ScorecardMetric;
  };
  trendSeries: {
    snapshotId: string;
    snapshotDate: string;
    assignmentAvg: number;
    consumptionAvg: number;
    liveAttendanceAvg: number;
    liveOrRecAvg: number;
  }[];
  segmentDistribution: {
    snapshotId: string;
    snapshotDate: string;
    high: number;
    medium: number;
    low: number;
  }[];
  topImprovers: {
    studentId: string;
    name: string;
    phoneE164: string;
    deltaPts: number;
    segment: string;
  }[];
  needsAttention: {
    studentId: string;
    name: string;
    phoneE164: string;
    reasons: string[];
    segment: string;
  }[];
}

export class AnalyticsService {
  /**
   * Helper to retrieve student facts for a given snapshot
   */
  static async getStudentFactsForSnapshot(snapshotId: string): Promise<StudentSnapshotFact[]> {
    const db = getDb();
    const rows = await db
      .select({
        studentId: students.id,
        externalStudentId: students.externalStudentId,
        name: students.name,
        phoneE164: students.phoneE164,
        assignmentSubmissionPct: studentSnapshots.assignmentSubmissionPct,
        totalConsumptionPct: studentSnapshots.totalConsumptionPct,
        livePct: studentSnapshots.livePct,
        liveOrRecPct: studentSnapshots.liveOrRecPct,
        segment: studentSnapshots.segment,
      })
      .from(studentSnapshots)
      .innerJoin(students, eq(studentSnapshots.studentId, students.id))
      .where(eq(studentSnapshots.snapshotId, snapshotId));

    return rows.map((r) => ({
      studentId: r.studentId,
      externalStudentId: r.externalStudentId,
      name: r.name,
      phoneE164: r.phoneE164,
      assignmentSubmissionPct: Number(r.assignmentSubmissionPct),
      totalConsumptionPct: Number(r.totalConsumptionPct),
      livePct: Number(r.livePct),
      liveOrRecPct: Number(r.liveOrRecPct),
      segment: r.segment as SegmentType,
    }));
  }

  /**
   * Helper to resolve and validate that a snapshot belongs to a batch
   */
  static async resolveBatchSnapshot(batchId: string, snapshotId?: string) {
    const db = getDb();
    if (snapshotId) {
      const snap = await db.query.snapshots.findFirst({
        where: and(eq(snapshots.id, snapshotId), eq(snapshots.batchId, batchId)),
      });
      if (!snap) {
        throw new AppError(`Snapshot with id ${snapshotId} not found in this batch`, 404, 'NOT_FOUND');
      }
      return snap;
    }

    const latest = await db.query.snapshots.findFirst({
      where: eq(snapshots.batchId, batchId),
      orderBy: [desc(snapshots.snapshotDate)],
    });
    if (!latest) {
      throw new AppError('No snapshots available for this batch', 404, 'NOT_FOUND');
    }
    return latest;
  }

  /**
   * B7: Batch Overview Endpoint
   */
  static async getBatchOverview(
    batchId: string,
    targetSnapshotId?: string
  ): Promise<BatchOverviewData> {
    const db = getDb();

    // 1. Fetch all snapshots for batch ordered chronologically
    const allSnapshots = await db.query.snapshots.findMany({
      where: eq(snapshots.batchId, batchId),
      orderBy: [asc(snapshots.snapshotDate)],
    });

    if (allSnapshots.length === 0) {
      throw new AppError('No snapshots available for this batch', 404, 'NOT_FOUND');
    }

    // 2. Determine current & previous snapshot
    const currentIndex = targetSnapshotId
      ? allSnapshots.findIndex((s) => s.id === targetSnapshotId)
      : allSnapshots.length - 1;

    if (currentIndex === -1) {
      throw new AppError(`Snapshot with id ${targetSnapshotId} not found in this batch`, 404, 'NOT_FOUND');
    }

    const currentSnapshot = allSnapshots[currentIndex];
    const previousSnapshot = currentIndex > 0 ? allSnapshots[currentIndex - 1] : null;

    // 3. Compute trend series and segment counts across all snapshots
    const trendSeries = [];
    const segmentDistribution = [];

    for (const snap of allSnapshots) {
      const snapFacts = await this.getStudentFactsForSnapshot(snap.id);
      const assignmentAvg = computeAverage(snapFacts.map((s) => s.assignmentSubmissionPct));
      const consumptionAvg = computeAverage(snapFacts.map((s) => s.totalConsumptionPct));
      const liveAttendanceAvg = computeAverage(snapFacts.map((s) => s.livePct));
      const liveOrRecAvg = computeAverage(snapFacts.map((s) => s.liveOrRecPct));

      trendSeries.push({
        snapshotId: snap.id,
        snapshotDate: snap.snapshotDate,
        assignmentAvg,
        consumptionAvg,
        liveAttendanceAvg,
        liveOrRecAvg,
      });

      let high = 0;
      let medium = 0;
      let low = 0;
      for (const s of snapFacts) {
        if (s.segment === 'high') high++;
        else if (s.segment === 'medium') medium++;
        else low++;
      }

      segmentDistribution.push({
        snapshotId: snap.id,
        snapshotDate: snap.snapshotDate,
        high,
        medium,
        low,
      });
    }

    // 4. Current & previous facts for scorecards
    const currentFacts = await this.getStudentFactsForSnapshot(currentSnapshot.id);
    const previousFacts = previousSnapshot
      ? await this.getStudentFactsForSnapshot(previousSnapshot.id)
      : [];

    const currentAssignAvg = computeAverage(currentFacts.map((s) => s.assignmentSubmissionPct));
    const prevAssignAvg = previousSnapshot
      ? computeAverage(previousFacts.map((s) => s.assignmentSubmissionPct))
      : null;
    const assignDelta = computeDelta(currentAssignAvg, prevAssignAvg);

    const currentConsAvg = computeAverage(currentFacts.map((s) => s.totalConsumptionPct));
    const prevConsAvg = previousSnapshot
      ? computeAverage(previousFacts.map((s) => s.totalConsumptionPct))
      : null;
    const consDelta = computeDelta(currentConsAvg, prevConsAvg);

    const currentLiveAvg = computeAverage(currentFacts.map((s) => s.livePct));
    const prevLiveAvg = previousSnapshot
      ? computeAverage(previousFacts.map((s) => s.livePct))
      : null;
    const liveDelta = computeDelta(currentLiveAvg, prevLiveAvg);

    const currentLiveRecAvg = computeAverage(currentFacts.map((s) => s.liveOrRecPct));
    const prevLiveRecAvg = previousSnapshot
      ? computeAverage(previousFacts.map((s) => s.liveOrRecPct))
      : null;
    const liveRecDelta = computeDelta(currentLiveRecAvg, prevLiveRecAvg);

    const scorecards = {
      assignment: {
        title: 'Assignment Submission',
        currentValue: currentAssignAvg,
        previousValue: prevAssignAvg,
        deltaPts: assignDelta,
        trend: getTrendDirection(assignDelta),
      },
      consumption: {
        title: 'Content Consumption',
        currentValue: currentConsAvg,
        previousValue: prevConsAvg,
        deltaPts: consDelta,
        trend: getTrendDirection(consDelta),
      },
      liveAttendance: {
        title: 'Live Attendance',
        currentValue: currentLiveAvg,
        previousValue: prevLiveAvg,
        deltaPts: liveDelta,
        trend: getTrendDirection(liveDelta),
      },
      liveOrRecAttendance: {
        title: 'Live + Recording',
        currentValue: currentLiveRecAvg,
        previousValue: prevLiveRecAvg,
        deltaPts: liveRecDelta,
        trend: getTrendDirection(liveRecDelta),
      },
    };

    // 5. Top 5 Improvers
    let topImprovers: BatchOverviewData['topImprovers'] = [];
    if (previousSnapshot) {
      const comparison = compareSnapshotStudents(previousFacts, currentFacts);
      topImprovers = comparison.improved
        .sort((a, b) => {
          const compA = (a.assignmentDelta + a.consumptionDelta + a.attendanceDelta) / 3;
          const compB = (b.assignmentDelta + b.consumptionDelta + b.attendanceDelta) / 3;
          return compB - compA;
        })
        .slice(0, 5)
        .map((c) => ({
          studentId: c.studentId,
          name: c.name,
          phoneE164: c.phoneE164,
          deltaPts: Number(
            ((c.assignmentDelta + c.consumptionDelta + c.attendanceDelta) / 3).toFixed(1)
          ),
          segment: c.segmentB,
        }));
    } else {
      topImprovers = [...currentFacts]
        .sort((a, b) => b.totalConsumptionPct - a.totalConsumptionPct)
        .slice(0, 5)
        .map((s) => ({
          studentId: s.studentId,
          name: s.name,
          phoneE164: s.phoneE164,
          deltaPts: 0,
          segment: s.segment,
        }));
    }

    // 6. Top 5 Needs Attention
    const candidateRows = await db
      .select({
        studentId: students.id,
        externalStudentId: students.externalStudentId,
        name: students.name,
        phoneE164: students.phoneE164,
        assignmentSubmissionPct: studentSnapshots.assignmentSubmissionPct,
        assignmentsSubmitted: studentSnapshots.assignmentsSubmitted,
        totalConsumptionPct: studentSnapshots.totalConsumptionPct,
        livePct: studentSnapshots.livePct,
        liveOrRecPct: studentSnapshots.liveOrRecPct,
        segment: studentSnapshots.segment,
      })
      .from(studentSnapshots)
      .innerJoin(students, eq(studentSnapshots.studentId, students.id))
      .where(eq(studentSnapshots.snapshotId, currentSnapshot.id));

    const candidates: AtRiskCandidate[] = candidateRows.map((r) => ({
      studentId: r.studentId,
      externalStudentId: r.externalStudentId,
      name: r.name,
      phoneE164: r.phoneE164,
      assignmentSubmissionPct: Number(r.assignmentSubmissionPct),
      assignmentsSubmitted: r.assignmentsSubmitted,
      totalConsumptionPct: Number(r.totalConsumptionPct),
      livePct: Number(r.livePct),
      liveOrRecPct: Number(r.liveOrRecPct),
      segment: r.segment as SegmentType,
    }));

    const atRiskList = identifyAtRiskStudents(candidates);
    const needsAttention = atRiskList.slice(0, 5).map((s) => ({
      studentId: s.studentId,
      name: s.name,
      phoneE164: s.phoneE164,
      reasons: s.reasons,
      segment: s.segment,
    }));

    return {
      batchId,
      snapshotId: currentSnapshot.id,
      snapshotDate: currentSnapshot.snapshotDate,
      totalStudents: currentFacts.length,
      scorecards,
      trendSeries,
      segmentDistribution,
      topImprovers,
      needsAttention,
    };
  }

  /**
   * B8: Compare Two Snapshots
   */
  /**
   * B8: Compare multiple snapshots (supports 2 or more snapshots)
   */
  static async compareMultiSnapshots(
    batchId: string,
    snapshotIds: string[],
    tolerance = 2
  ) {
    if (snapshotIds.length < 2) {
      throw new AppError(
        'Only reports of the same course with different dates can be compared',
        422,
        'UNPROCESSABLE_ENTITY'
      );
    }

    const db = getDb();
    const snaps = await db.query.snapshots.findMany({
      where: and(inArray(snapshots.id, snapshotIds), eq(snapshots.batchId, batchId)),
      orderBy: [asc(snapshots.snapshotDate)],
    });

    if (snaps.length !== snapshotIds.length) {
      throw new AppError(
        'Only reports of the same course with different dates can be compared',
        422,
        'UNPROCESSABLE_ENTITY'
      );
    }

    const dateSet = new Set(snaps.map((s) => s.snapshotDate));
    if (dateSet.size !== snaps.length) {
      throw new AppError(
        'Only reports of the same course with different dates can be compared',
        422,
        'UNPROCESSABLE_ENTITY'
      );
    }

    const sortedSnaps = [...snaps].sort((a, b) => a.snapshotDate.localeCompare(b.snapshotDate));
    const firstSnap = sortedSnaps[0];
    const lastSnap = sortedSnaps[sortedSnaps.length - 1];

    const factsFirst = await this.getStudentFactsForSnapshot(firstSnap.id);
    const factsLast = await this.getStudentFactsForSnapshot(lastSnap.id);

    const baseComparison = compareSnapshotStudents(factsFirst, factsLast, tolerance);

    // Identify students present in only one report
    const mapFirst = new Map(factsFirst.map((f) => [f.studentId, f]));
    const mapLast = new Map(factsLast.map((f) => [f.studentId, f]));

    const onlyInFirst = factsFirst
      .filter((f) => !mapLast.has(f.studentId))
      .map((f) => ({
        studentId: f.studentId,
        externalStudentId: f.externalStudentId,
        name: f.name,
        phoneE164: f.phoneE164,
      }));

    const onlyInSecond = factsLast
      .filter((f) => !mapFirst.has(f.studentId))
      .map((f) => ({
        studentId: f.studentId,
        externalStudentId: f.externalStudentId,
        name: f.name,
        phoneE164: f.phoneE164,
      }));

    // Compute metric averages
    const assignAvgFirst = computeAverage(factsFirst.map((f) => f.assignmentSubmissionPct));
    const assignAvgLast = computeAverage(factsLast.map((f) => f.assignmentSubmissionPct));
    const assignDelta = computeDelta(assignAvgLast, assignAvgFirst) ?? 0;

    const consAvgFirst = computeAverage(factsFirst.map((f) => f.totalConsumptionPct));
    const consAvgLast = computeAverage(factsLast.map((f) => f.totalConsumptionPct));
    const consDelta = computeDelta(consAvgLast, consAvgFirst) ?? 0;

    const liveAvgFirst = computeAverage(factsFirst.map((f) => f.livePct));
    const liveAvgLast = computeAverage(factsLast.map((f) => f.livePct));
    const liveDelta = computeDelta(liveAvgLast, liveAvgFirst) ?? 0;

    const liveRecAvgFirst = computeAverage(factsFirst.map((f) => f.liveOrRecPct));
    const liveRecAvgLast = computeAverage(factsLast.map((f) => f.liveOrRecPct));
    const liveRecDelta = computeDelta(liveRecAvgLast, liveRecAvgFirst) ?? 0;

    const formatArrow = (delta: number) => {
      if (delta > 0) return `+${delta.toFixed(1)}% ↑`;
      if (delta < 0) return `${delta.toFixed(1)}% ↓`;
      return '0.0% →';
    };

    const metrics = {
      assignment: {
        oldValue: assignAvgFirst,
        newValue: assignAvgLast,
        deltaPts: assignDelta,
        arrow: formatArrow(assignDelta),
      },
      content: {
        oldValue: consAvgFirst,
        newValue: consAvgLast,
        deltaPts: consDelta,
        arrow: formatArrow(consDelta),
      },
      attendance: {
        oldValue: liveAvgFirst,
        newValue: liveAvgLast,
        deltaPts: liveDelta,
        arrow: formatArrow(liveDelta),
      },
      liveOrRecAttendance: {
        oldValue: liveRecAvgFirst,
        newValue: liveRecAvgLast,
        deltaPts: liveRecDelta,
        arrow: formatArrow(liveRecDelta),
      },
    };

    // Compare Assignment Items between firstSnap and lastSnap
    const itemsFirst = await db.query.assignmentItems.findMany({
      where: eq(assignmentItems.snapshotId, firstSnap.id),
    });
    const itemsLast = await db.query.assignmentItems.findMany({
      where: eq(assignmentItems.snapshotId, lastSnap.id),
    });

    const itemNamesFirst = new Set(itemsFirst.map((i) => i.name));
    const itemNamesLast = new Set(itemsLast.map((i) => i.name));
    const allItemNames = new Set([
      ...itemsFirst.map((i) => i.name),
      ...itemsLast.map((i) => i.name),
    ]);

    const assignmentComparison: Array<{
      name: string;
      status: 'SAME' | 'NEW' | 'REMOVED';
    }> = [];

    for (const name of allItemNames) {
      if (itemNamesFirst.has(name) && itemNamesLast.has(name)) {
        assignmentComparison.push({ name, status: 'SAME' });
      } else if (itemNamesLast.has(name)) {
        assignmentComparison.push({ name, status: 'NEW' });
      } else {
        assignmentComparison.push({ name, status: 'REMOVED' });
      }
    }

    // Compare Sessions between firstSnap and lastSnap
    const sessionsFirst = await db.query.sessions.findMany({
      where: eq(sessions.snapshotId, firstSnap.id),
    });
    const sessionsLast = await db.query.sessions.findMany({
      where: eq(sessions.snapshotId, lastSnap.id),
    });

    const sessionTitlesFirst = new Set(sessionsFirst.map((s) => s.title));
    const sessionTitlesLast = new Set(sessionsLast.map((s) => s.title));
    const allSessionTitles = new Set([
      ...sessionsFirst.map((s) => s.title),
      ...sessionsLast.map((s) => s.title),
    ]);

    const sessionComparison: Array<{
      title: string;
      date: string | null;
      status: 'SAME' | 'NEW' | 'REMOVED';
    }> = [];

    for (const title of allSessionTitles) {
      const sLast = sessionsLast.find((s) => s.title === title);
      const sFirst = sessionsFirst.find((s) => s.title === title);
      const sessionDate = sLast?.sessionDate || sFirst?.sessionDate || null;

      if (sessionTitlesFirst.has(title) && sessionTitlesLast.has(title)) {
        sessionComparison.push({ title, date: sessionDate, status: 'SAME' });
      } else if (sessionTitlesLast.has(title)) {
        sessionComparison.push({ title, date: sessionDate, status: 'NEW' });
      } else {
        sessionComparison.push({ title, date: sessionDate, status: 'REMOVED' });
      }
    }

    // Trend series when 3 or more snapshots are selected
    let trendSeries:
      | Array<{
          snapshotId: string;
          snapshotDate: string;
          assignmentAvg: number;
          consumptionAvg: number;
          liveAttendanceAvg: number;
          liveOrRecAvg: number;
        }>
      | undefined;

    if (sortedSnaps.length >= 3) {
      trendSeries = [];
      for (const s of sortedSnaps) {
        const sFacts = await this.getStudentFactsForSnapshot(s.id);
        trendSeries.push({
          snapshotId: s.id,
          snapshotDate: s.snapshotDate,
          assignmentAvg: computeAverage(sFacts.map((f) => f.assignmentSubmissionPct)),
          consumptionAvg: computeAverage(sFacts.map((f) => f.totalConsumptionPct)),
          liveAttendanceAvg: computeAverage(sFacts.map((f) => f.livePct)),
          liveOrRecAvg: computeAverage(sFacts.map((f) => f.liveOrRecPct)),
        });
      }
    }

    return {
      fromSnapshotId: firstSnap.id,
      toSnapshotId: lastSnap.id,
      fromSnapshotDate: firstSnap.snapshotDate,
      toSnapshotDate: lastSnap.snapshotDate,
      metrics,
      comparisons: baseComparison.comparisons,
      improved: baseComparison.improved,
      same: baseComparison.same,
      declined: baseComparison.declined,
      matrix: baseComparison.matrix,
      onlyInFirst,
      onlyInSecond,
      assignmentComparison,
      sessionComparison,
      ...(trendSeries ? { trendSeries } : {}),
    };
  }

  static async compareSnapshots(
    batchId: string,
    fromSnapshotId: string,
    toSnapshotId: string,
    tolerance = 2
  ) {
    return this.compareMultiSnapshots(batchId, [fromSnapshotId, toSnapshotId], tolerance);
  }

  /**
   * B9: At-Risk Endpoint
   */
  static async getAtRiskStudents(
    batchId: string,
    snapshotId?: string
  ): Promise<AtRiskStudentResult[]> {
    const snap = await this.resolveBatchSnapshot(batchId, snapshotId);
    const targetId = snap.id;
    const db = getDb();

    const rows = await db
      .select({
        studentId: students.id,
        externalStudentId: students.externalStudentId,
        name: students.name,
        phoneE164: students.phoneE164,
        assignmentSubmissionPct: studentSnapshots.assignmentSubmissionPct,
        assignmentsSubmitted: studentSnapshots.assignmentsSubmitted,
        totalConsumptionPct: studentSnapshots.totalConsumptionPct,
        livePct: studentSnapshots.livePct,
        liveOrRecPct: studentSnapshots.liveOrRecPct,
        segment: studentSnapshots.segment,
      })
      .from(studentSnapshots)
      .innerJoin(students, eq(studentSnapshots.studentId, students.id))
      .where(eq(studentSnapshots.snapshotId, targetId));

    const candidates: AtRiskCandidate[] = rows.map((r) => ({
      studentId: r.studentId,
      externalStudentId: r.externalStudentId,
      name: r.name,
      phoneE164: r.phoneE164,
      assignmentSubmissionPct: Number(r.assignmentSubmissionPct),
      assignmentsSubmitted: r.assignmentsSubmitted,
      totalConsumptionPct: Number(r.totalConsumptionPct),
      livePct: Number(r.livePct),
      liveOrRecPct: Number(r.liveOrRecPct),
      segment: r.segment as SegmentType,
    }));

    return identifyAtRiskStudents(candidates);
  }

  /**
   * B10: Per-Assignment Stats
   */
  static async getAssignmentStats(batchId: string, snapshotId?: string) {
    const snap = await this.resolveBatchSnapshot(batchId, snapshotId);
    const targetId = snap.id;
    const db = getDb();

    const items = await db.query.assignmentItems.findMany({
      where: eq(assignmentItems.snapshotId, targetId),
    });

    const results = await db
      .select({
        itemId: assignmentResults.assignmentItemId,
        studentId: students.id,
        name: students.name,
        phoneE164: students.phoneE164,
        status: assignmentResults.status,
        score: assignmentResults.score,
      })
      .from(assignmentResults)
      .innerJoin(students, eq(assignmentResults.studentId, students.id))
      .innerJoin(assignmentItems, eq(assignmentResults.assignmentItemId, assignmentItems.id))
      .where(eq(assignmentItems.snapshotId, targetId));

    return items.map((item) => {
      const itemResults = results.filter((r) => r.itemId === item.id);
      const total = itemResults.length;
      let submitted = 0;
      let delayed = 0;
      let notSubmitted = 0;
      const scores: number[] = [];
      const nonSubmitters: { studentId: string; name: string; phoneE164: string; status: string }[] = [];

      for (const r of itemResults) {
        const st = r.status.toUpperCase();
        if (st === 'PASSED' || st === 'SUBMITTED') {
          submitted++;
          if (r.score !== null) scores.push(Number(r.score));
        } else if (st === 'DELAYED') {
          delayed++;
          if (r.score !== null) scores.push(Number(r.score));
          nonSubmitters.push({ studentId: r.studentId, name: r.name, phoneE164: r.phoneE164, status: r.status });
        } else {
          notSubmitted++;
          nonSubmitters.push({ studentId: r.studentId, name: r.name, phoneE164: r.phoneE164, status: r.status });
        }
      }

      const submissionRate = total > 0 ? Number(((submitted / total) * 100).toFixed(1)) : 0;
      const averageScore = computeAverage(scores);

      return {
        id: item.id,
        name: item.name,
        total,
        submitted,
        delayed,
        notSubmitted,
        submissionRate,
        averageScore,
        nonSubmitters,
      };
    });
  }

  /**
   * B10: Week-wise Content Consumption
   */
  static async getContentStats(batchId: string, snapshotId?: string) {
    const snap = await this.resolveBatchSnapshot(batchId, snapshotId);
    const targetId = snap.id;
    const db = getDb();

    const weeks = await db
      .select({
        studentId: students.id,
        name: students.name,
        phoneE164: students.phoneE164,
        weekNo: weeklyConsumption.weekNo,
        consumed: weeklyConsumption.consumed,
        total: weeklyConsumption.total,
      })
      .from(weeklyConsumption)
      .innerJoin(students, eq(weeklyConsumption.studentId, students.id))
      .where(eq(weeklyConsumption.snapshotId, targetId));

    // Group by weekNo
    const weekMap = new Map<
      number,
      { weekNo: number; totalConsumed: number; totalAvailable: number; studentCount: number }
    >();

    for (const row of weeks) {
      let entry = weekMap.get(row.weekNo);
      if (!entry) {
        entry = { weekNo: row.weekNo, totalConsumed: 0, totalAvailable: 0, studentCount: 0 };
        weekMap.set(row.weekNo, entry);
      }
      entry.totalConsumed += row.consumed;
      entry.totalAvailable += row.total;
      entry.studentCount++;
    }

    const weeklyBreakdown = Array.from(weekMap.values())
      .sort((a, b) => a.weekNo - b.weekNo)
      .map((w) => ({
        weekNo: w.weekNo,
        totalConsumed: w.totalConsumed,
        totalAvailable: w.totalAvailable,
        consumptionPct:
          w.totalAvailable > 0
            ? Number(((w.totalConsumed / w.totalAvailable) * 100).toFixed(1))
            : 0,
      }));

    return {
      snapshotId: targetId,
      weeks: weeklyBreakdown,
      studentWeeklyProgress: weeks,
    };
  }

  /**
   * B10: Session-wise Attendance Stats
   */
  static async getAttendanceStats(batchId: string, snapshotId?: string) {
    const snap = await this.resolveBatchSnapshot(batchId, snapshotId);
    const targetId = snap.id;
    const db = getDb();

    const sessionList = await db.query.sessions.findMany({
      where: eq(sessions.snapshotId, targetId),
    });

    const attRecords = await db
      .select({
        sessionId: attendance.sessionId,
        studentId: attendance.studentId,
        liveStatus: attendance.liveStatus,
        liveOrRecStatus: attendance.liveOrRecStatus,
      })
      .from(attendance)
      .innerJoin(sessions, eq(attendance.sessionId, sessions.id))
      .where(eq(sessions.snapshotId, targetId));

    const sessionStats = sessionList.map((sess) => {
      const records = attRecords.filter((r) => r.sessionId === sess.id);
      const total = records.length;
      const attended = records.filter(
        (r) => r.liveStatus === 'PRESENT' || r.liveStatus === 'PARTIAL'
      ).length;
      const rate = total > 0 ? Number(((attended / total) * 100).toFixed(1)) : 0;

      return {
        id: sess.id,
        title: sess.title,
        sessionDate: sess.sessionDate,
        total,
        attended,
        attendanceRate: rate,
      };
    });

    // Recording-only learners
    const studentFacts = await this.getStudentFactsForSnapshot(targetId);
    const recordingOnlyLearners = studentFacts.filter(
      (s) => s.livePct < 30 && s.liveOrRecPct > 70
    );

    return {
      snapshotId: targetId,
      sessions: sessionStats,
      recordingOnlyLearners,
    };
  }

  /**
   * Students in Batch Snapshot Endpoint
   */
  static async getBatchStudents(batchId: string, snapshotId?: string) {
    const snap = await this.resolveBatchSnapshot(batchId, snapshotId);
    const targetId = snap.id;
    const db = getDb();

    const rows = await db
      .select({
        id: students.id,
        studentId: students.externalStudentId,
        name: students.name,
        phone: students.phoneE164,
        totalConsumptionPct: studentSnapshots.totalConsumptionPct,
        videoPct: studentSnapshots.videoPct,
        pdfPct: studentSnapshots.pdfPct,
        quizPct: studentSnapshots.quizPct,
        flashcardsPct: studentSnapshots.flashcardsPct,
        aiContentPct: studentSnapshots.aiContentPct,
        assignmentSubmissionPct: studentSnapshots.assignmentSubmissionPct,
        assignmentScorePct: studentSnapshots.assignmentScorePct,
        livePct: studentSnapshots.livePct,
        liveOrRecPct: studentSnapshots.liveOrRecPct,
        segment: studentSnapshots.segment,
        assignmentsTotal: studentSnapshots.assignmentsTotal,
        assignmentsSubmitted: studentSnapshots.assignmentsSubmitted,
        liveTotal: studentSnapshots.liveTotal,
        liveAttended: studentSnapshots.liveAttended,
      })
      .from(studentSnapshots)
      .innerJoin(students, eq(studentSnapshots.studentId, students.id))
      .where(eq(studentSnapshots.snapshotId, targetId))
      .orderBy(students.name);

    return {
      batchId,
      snapshotId: targetId,
      snapshotDate: snap.snapshotDate,
      totalStudents: rows.length,
      students: rows.map((r) => ({
        ...r,
        totalConsumptionPct: Number(r.totalConsumptionPct),
        videoPct: Number(r.videoPct),
        pdfPct: Number(r.pdfPct),
        quizPct: Number(r.quizPct),
        flashcardsPct: Number(r.flashcardsPct),
        aiContentPct: Number(r.aiContentPct),
        assignmentSubmissionPct: Number(r.assignmentSubmissionPct),
        assignmentScorePct: Number(r.assignmentScorePct),
        livePct: Number(r.livePct),
        liveOrRecPct: Number(r.liveOrRecPct),
      })),
    };
  }
}
