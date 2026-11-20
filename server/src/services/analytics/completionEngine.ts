export interface CompletionAreaMetric {
  currentPct: number;
  minimumPct: number;
  status: 'Met' | 'Behind';
  currentItems: number;
  totalItems: number;
  neededItems: number;
  requiredPacePerWeek: number | null;
  normalPacePerWeek: number;
  catchupMultiple: number | null;
  needsText: string;
}

export interface CompletionLearnerResult {
  studentId: string;
  name: string;
  phoneE164: string;
  assignments: CompletionAreaMetric;
  content: CompletionAreaMetric;
  attendance: CompletionAreaMetric;
  readinessScore: number;
  outlook: 'On track' | 'Recoverable' | 'Unlikely' | 'Too early';
}

export interface CompletionRoadmapInfo {
  version: string | null;
  startDate: string;
  endDate: string;
  reportDate: string;
  totalDays: number;
  elapsedDays: number;
  daysToEnd: number;
  elapsedPct: number;
  weeksLeft: number;
  roadmapWeeks: number;
  totalRegularAssignments: number;
  regularAssignmentsDue: number;
  totalLiveSessions: number;
  remainingLiveSessions: number;
  totalHeldLiveSessions: number;
  totalContentReleased: number;
  note: string | null;
}

export interface CompletionSettings {
  minAssignments: number;
  minContent: number;
  minAttendance: number;
  wAssignments: number;
  wContent: number;
  wAttendance: number;
  tooEarlyMinDue: number;
  tooEarlyMinElapsedPct: number;
  catchupLimit: number;
}

export const DEFAULT_COMPLETION_SETTINGS: CompletionSettings = {
  minAssignments: 70,
  minContent: 60,
  minAttendance: 50,
  wAssignments: 50,
  wContent: 30,
  wAttendance: 20,
  tooEarlyMinDue: 3,
  tooEarlyMinElapsedPct: 25,
  catchupLimit: 2.0,
};

export interface CompletionEngineInputLearner {
  studentId: string;
  name: string;
  phoneE164: string;
  regularAssignmentsSubmitted: number;
  totalConsumptionPct: number;
  liveOrRecPct: number;
  liveAttended?: number;
  liveHeld?: number;
}

export interface CompletionEngineInput {
  settings: CompletionSettings;
  roadmap: {
    version: string | null;
    startDate: string; // YYYY-MM-DD
    endDate: string;   // YYYY-MM-DD
    totalRegularAssignments: number;
    regularAssignmentsDue: number;
    totalLiveSessions: number;
    remainingLiveSessions: number;
    totalHeldLiveSessions: number;
    totalContentReleased: number;
    note: string | null;
  } | null;
  reportDate: string; // YYYY-MM-DD
  learners: CompletionEngineInputLearner[];
}

export interface CompletionAnalyticsResponse {
  summary: {
    totalLearners: number;
    onTrack: number;
    recoverable: number;
    unlikely: number;
    tooEarly: number;
    forecastFloor: number;
    forecastCeiling: number;
    forecastTotal: number;
    rangeSentence: string | null;
  };
  roadmap: CompletionRoadmapInfo | null;
  settings: CompletionSettings;
  learners: CompletionLearnerResult[];
  histogram: { bin: string; count: number }[];
}

function formatDateShort(dateStr: string): string {
  try {
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return dateStr;
    const day = d.getDate();
    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    return `${day} ${months[d.getMonth()]}`;
  } catch {
    return dateStr;
  }
}

export function computeCompletionAnalytics(input: CompletionEngineInput): CompletionAnalyticsResponse {
  const { settings, roadmap, reportDate, learners } = input;

  let roadmapInfo: CompletionRoadmapInfo | null = null;
  let totalDays = 0;
  let elapsedDays = 0;
  let daysToEnd = 0;
  let elapsedPct = 0;
  let weeksLeft = 0;
  let roadmapWeeks = 0;
  let elapsedWeeks = 0;
  let isPastEnd = false;

  const repDate = new Date(reportDate);

  if (roadmap) {
    const start = new Date(roadmap.startDate);
    const end = new Date(roadmap.endDate);

    totalDays = Math.max(1, Math.round((end.getTime() - start.getTime()) / (1000 * 3600 * 24)));
    elapsedDays = Math.max(0, Math.round((repDate.getTime() - start.getTime()) / (1000 * 3600 * 24)));
    daysToEnd = Math.round((end.getTime() - repDate.getTime()) / (1000 * 3600 * 24));
    elapsedPct = Math.min(100, Math.max(0, Number(((elapsedDays / totalDays) * 100).toFixed(1))));

    roadmapWeeks = totalDays / 7;
    elapsedWeeks = Math.max(0.1, elapsedDays / 7);
    weeksLeft = daysToEnd / 7;
    isPastEnd = daysToEnd <= 0;

    roadmapInfo = {
      version: roadmap.version,
      startDate: roadmap.startDate,
      endDate: roadmap.endDate,
      reportDate,
      totalDays,
      elapsedDays,
      daysToEnd,
      elapsedPct,
      weeksLeft: Number(weeksLeft.toFixed(2)),
      roadmapWeeks: Number(roadmapWeeks.toFixed(2)),
      totalRegularAssignments: roadmap.totalRegularAssignments,
      regularAssignmentsDue: roadmap.regularAssignmentsDue,
      totalLiveSessions: roadmap.totalLiveSessions,
      remainingLiveSessions: roadmap.remainingLiveSessions,
      totalHeldLiveSessions: roadmap.totalHeldLiveSessions,
      totalContentReleased: roadmap.totalContentReleased,
      note: roadmap.note,
    };
  }

  const regularDue = roadmap ? roadmap.regularAssignmentsDue : 0;
  const totalRegular = roadmap ? roadmap.totalRegularAssignments : 0;
  const contentReleased = roadmap ? roadmap.totalContentReleased : 0;
  const heldSessions = roadmap ? roadmap.totalHeldLiveSessions : 0;
  const remainingLive = roadmap ? roadmap.remainingLiveSessions : 0;
  const totalLiveRoadmap = roadmap ? roadmap.totalLiveSessions : 0;
  const totalAttendanceExpected = heldSessions + remainingLive;

  // Normal paces
  const normalPaceAssignments = roadmapWeeks > 0 ? totalRegular / roadmapWeeks : 0;
  const normalPaceContent = elapsedWeeks > 0 ? contentReleased / elapsedWeeks : 0;
  const normalPaceAttendance = roadmapWeeks > 0 ? totalLiveRoadmap / roadmapWeeks : 0;

  // Minimum item thresholds
  const assignMinItems = Math.ceil((settings.minAssignments / 100) * totalRegular);
  const contentMinItems = Math.ceil((settings.minContent / 100) * contentReleased);
  const attendanceMinItems = Math.ceil((settings.minAttendance / 100) * totalAttendanceExpected);

  // Too early check
  const isTooEarly =
    regularDue < settings.tooEarlyMinDue ||
    (roadmapInfo !== null && elapsedPct < settings.tooEarlyMinElapsedPct);

  const formattedEndDate = roadmap ? formatDateShort(roadmap.endDate) : 'end date';

  const learnerResults: CompletionLearnerResult[] = learners.map((l) => {
    // 1. Assignments
    const assignSubmitted = l.regularAssignmentsSubmitted;
    const assignCurrentPct = regularDue > 0 ? Number(((assignSubmitted / regularDue) * 100).toFixed(1)) : 0;
    const assignStatus: 'Met' | 'Behind' = assignCurrentPct >= settings.minAssignments ? 'Met' : 'Behind';
    const assignNeeded = Math.max(0, assignMinItems - assignSubmitted);
    let assignReqPace: number | null = null;
    let assignMultiple: number | null = null;
    let assignNeedsText = 'Met';

    if (assignStatus === 'Behind') {
      if (isPastEnd) {
        assignNeedsText = `Roadmap ended on ${formattedEndDate} — minimum not reached`;
      } else if (weeksLeft > 0) {
        assignReqPace = Number((assignNeeded / weeksLeft).toFixed(2));
        assignMultiple = normalPaceAssignments > 0 ? Number((assignReqPace / normalPaceAssignments).toFixed(2)) : 0;
        assignNeedsText = `needs ${assignNeeded} of ${totalRegular} assignments by ${formattedEndDate}: ${assignReqPace.toFixed(1)} per week (${assignMultiple.toFixed(1)}x the normal pace)`;
      }
    }

    // 2. Content
    const contentPct = Number(Number(l.totalConsumptionPct || 0).toFixed(1));
    const contentConsumed = Math.round((contentPct / 100) * contentReleased);
    const contentStatus: 'Met' | 'Behind' = contentPct >= settings.minContent ? 'Met' : 'Behind';
    const contentNeeded = Math.max(0, contentMinItems - contentConsumed);
    let contentReqPace: number | null = null;
    let contentMultiple: number | null = null;
    let contentNeedsText = 'Met';

    if (contentStatus === 'Behind') {
      if (isPastEnd) {
        contentNeedsText = `Roadmap ended on ${formattedEndDate} — minimum not reached`;
      } else if (weeksLeft > 0) {
        contentReqPace = Number((contentNeeded / weeksLeft).toFixed(2));
        contentMultiple = normalPaceContent > 0 ? Number((contentReqPace / normalPaceContent).toFixed(2)) : 0;
        contentNeedsText = `needs ${contentNeeded} of ${contentReleased} items by ${formattedEndDate}: ${contentReqPace.toFixed(1)} per week (${contentMultiple.toFixed(1)}x the normal pace)`;
      }
    }

    // 3. Attendance
    const attPct = Number(Number(l.liveOrRecPct || 0).toFixed(1));
    const attendedSessions = Math.round((attPct / 100) * heldSessions);
    const attStatus: 'Met' | 'Behind' = attPct >= settings.minAttendance ? 'Met' : 'Behind';
    const attNeeded = Math.max(0, attendanceMinItems - attendedSessions);
    let attReqPace: number | null = null;
    let attMultiple: number | null = null;
    let attNeedsText = 'Met';

    if (attStatus === 'Behind') {
      if (isPastEnd) {
        attNeedsText = `Roadmap ended on ${formattedEndDate} — minimum not reached`;
      } else if (weeksLeft > 0) {
        attReqPace = Number((attNeeded / weeksLeft).toFixed(2));
        attMultiple = normalPaceAttendance > 0 ? Number((attReqPace / normalPaceAttendance).toFixed(2)) : 0;
        attNeedsText = `needs ${attNeeded} sessions by ${formattedEndDate}: ${attReqPace.toFixed(1)} per week (${attMultiple.toFixed(1)}x the normal pace)`;
      }
    }

    // Readiness score
    const readiness = Number(
      (
        (assignCurrentPct * settings.wAssignments +
          contentPct * settings.wContent +
          attPct * settings.wAttendance) /
        100
      ).toFixed(1)
    );

    // Outlook
    let outlook: 'On track' | 'Recoverable' | 'Unlikely' | 'Too early';
    if (isTooEarly) {
      outlook = 'Too early';
    } else {
      const allMet = assignStatus === 'Met' && contentStatus === 'Met' && attStatus === 'Met';
      if (allMet) {
        outlook = 'On track';
      } else if (isPastEnd) {
        outlook = 'Unlikely';
      } else {
        const multiples: number[] = [];
        if (assignStatus === 'Behind' && assignMultiple !== null) multiples.push(assignMultiple);
        if (contentStatus === 'Behind' && contentMultiple !== null) multiples.push(contentMultiple);
        if (attStatus === 'Behind' && attMultiple !== null) multiples.push(attMultiple);

        const anyExceeds = multiples.some((m) => m > settings.catchupLimit);
        outlook = anyExceeds ? 'Unlikely' : 'Recoverable';
      }
    }

    return {
      studentId: l.studentId,
      name: l.name,
      phoneE164: l.phoneE164,
      readinessScore: readiness,
      outlook,
      assignments: {
        currentPct: assignCurrentPct,
        minimumPct: settings.minAssignments,
        status: assignStatus,
        currentItems: assignSubmitted,
        totalItems: totalRegular,
        neededItems: assignNeeded,
        requiredPacePerWeek: assignReqPace,
        normalPacePerWeek: Number(normalPaceAssignments.toFixed(3)),
        catchupMultiple: assignMultiple,
        needsText: assignNeedsText,
      },
      content: {
        currentPct: contentPct,
        minimumPct: settings.minContent,
        status: contentStatus,
        currentItems: contentConsumed,
        totalItems: contentReleased,
        neededItems: contentNeeded,
        requiredPacePerWeek: contentReqPace,
        normalPacePerWeek: Number(normalPaceContent.toFixed(3)),
        catchupMultiple: contentMultiple,
        needsText: contentNeedsText,
      },
      attendance: {
        currentPct: attPct,
        minimumPct: settings.minAttendance,
        status: attStatus,
        currentItems: attendedSessions,
        totalItems: totalAttendanceExpected,
        neededItems: attNeeded,
        requiredPacePerWeek: attReqPace,
        normalPacePerWeek: Number(normalPaceAttendance.toFixed(3)),
        catchupMultiple: attMultiple,
        needsText: attNeedsText,
      },
    };
  });

  // Sort learners by readinessScore descending
  learnerResults.sort((a, b) => b.readinessScore - a.readinessScore);

  // Histogram (10 bins: 0-9, 10-19, ..., 90-100)
  const bins = [
    '0-9', '10-19', '20-29', '30-39', '40-49',
    '50-59', '60-69', '70-79', '80-89', '90-100'
  ];
  const histogramMap = new Map<string, number>(bins.map((b) => [b, 0]));
  for (const r of learnerResults) {
    const val = r.readinessScore;
    const binIdx = Math.min(9, Math.floor(val / 10));
    const binKey = bins[binIdx];
    histogramMap.set(binKey, (histogramMap.get(binKey) || 0) + 1);
  }
  const histogram = bins.map((bin) => ({ bin, count: histogramMap.get(bin) || 0 }));

  // Summary counts
  let onTrack = 0;
  let recoverable = 0;
  let unlikely = 0;
  let tooEarly = 0;

  for (const r of learnerResults) {
    if (r.outlook === 'On track') onTrack++;
    else if (r.outlook === 'Recoverable') recoverable++;
    else if (r.outlook === 'Unlikely') unlikely++;
    else if (r.outlook === 'Too early') tooEarly++;
  }

  const forecastFloor = onTrack;
  const forecastCeiling = onTrack + recoverable;
  const forecastTotal = learnerResults.length - tooEarly;

  let rangeSentence: string | null = null;
  if (forecastTotal > 0) {
    rangeSentence = `Completion forecast: between ${forecastFloor} and ${forecastCeiling} of ${forecastTotal} learners are on track to complete.`;
  }

  return {
    summary: {
      totalLearners: learnerResults.length,
      onTrack,
      recoverable,
      unlikely,
      tooEarly,
      forecastFloor,
      forecastCeiling,
      forecastTotal,
      rangeSentence,
    },
    roadmap: roadmapInfo,
    settings,
    learners: learnerResults,
    histogram,
  };
}

