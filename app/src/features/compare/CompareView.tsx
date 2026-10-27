import React, { useState, useMemo, useEffect } from 'react';
import { Card } from '@/ui/Card';
import { Button } from '@/ui/Button';
import { usePlatformStore, type ActiveTab } from '@/store/usePlatformStore';
import { formatStudentName, formatStudentPhone } from '@/core/identity/mask';
import {
  compareSnapshotsLocal,
  type StrictCompareResult,
  type CompatibilityCheckItem,
} from '@/core/analytics/clientStrictCompare';
import { apiClient } from '@/core/api/client';
import type { Snapshot, StudentSnapshot, Student, AssignmentResult, Session } from '@/types';
import {
  GitCompare,
  UploadCloud,
  Search,
  CheckCircle2,
  XCircle,
  Calendar,
  AlertCircle,
  AlertTriangle,
  Download,
  Info,
  TrendingUp,
  TrendingDown,
  Minus,
  Sparkles,
  ArrowRight,
  ChevronDown,
  ChevronUp,
  Table as TableIcon,
  BarChart3,
  Layers,
} from 'lucide-react';
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  Legend,
  ScatterChart,
  Scatter,
  ReferenceLine,
  Cell,
} from 'recharts';

interface CompareViewProps {
  snapshots: Snapshot[];
  allStudentSnapshots: StudentSnapshot[];
  students: Student[];
  assignmentResults?: AssignmentResult[];
  sessions?: Session[];
}

export const CompareView: React.FC<CompareViewProps> = ({
  snapshots,
  allStudentSnapshots: _allStudentSnapshots,
  students: _students,
}) => {
  const {
    settings,
    setSelectedStudentId,
    setActiveTab,
    setUploadModalOpen,
    comparePreselected,
    setComparePreselected,
    selectedBatchId,
    backendConnected,
  } = usePlatformStore();

  // Filter snapshots strictly to the selected batch and sort chronologically
  const batchSnapshots = useMemo(() => {
    return [...snapshots]
      .filter((s) => !selectedBatchId || s.batchId === selectedBatchId)
      .sort((a, b) => a.snapshotDate.localeCompare(b.snapshotDate));
  }, [snapshots, selectedBatchId]);

  // State 0: No reports in this batch
  if (batchSnapshots.length === 0) {
    return (
      <Card>
        <div className="py-16 px-4 text-center space-y-4 max-w-md mx-auto">
          <div className="w-14 h-14 rounded-2xl bg-primary/10 text-primary flex items-center justify-center mx-auto shadow-xs border border-primary/20">
            <GitCompare className="w-7 h-7" />
          </div>
          <div className="space-y-1.5">
            <h3 className="text-base font-semibold text-foreground font-heading">
              No reports yet for this course
            </h3>
            <p className="text-xs text-muted-foreground leading-relaxed">
              Upload a cumulative report to begin tracking cohort progress and enable strict comparative analytics.
            </p>
          </div>
          <Button
            onClick={() => setUploadModalOpen(true, true)}
            className="gap-2 mx-auto mt-2 bg-primary hover:bg-primary/90 text-primary-foreground"
          >
            <UploadCloud className="w-4 h-4" />
            Upload Report
          </Button>
        </div>
      </Card>
    );
  }

  // State 1: Exactly 1 report in this batch
  if (batchSnapshots.length === 1) {
    return (
      <Card>
        <div className="py-16 px-4 text-center space-y-4 max-w-md mx-auto">
          <div className="w-14 h-14 rounded-2xl bg-amber-500/10 text-amber-600 dark:text-amber-400 flex items-center justify-center mx-auto shadow-xs border border-amber-500/20">
            <Layers className="w-7 h-7" />
          </div>
          <div className="space-y-1.5">
            <h3 className="text-base font-semibold text-foreground font-heading">
              Upload another report of this batch to compare
            </h3>
            <p className="text-xs text-muted-foreground leading-relaxed">
              Strict comparison requires at least two snapshots of different dates in the same batch to measure cohort trajectory and learner progression.
            </p>
          </div>
          <Button
            onClick={() => setUploadModalOpen(true, true)}
            className="gap-2 mx-auto mt-2 bg-primary hover:bg-primary/90 text-primary-foreground"
          >
            <UploadCloud className="w-4 h-4" />
            Upload Report
          </Button>
        </div>
      </Card>
    );
  }

  // State 2: 2 or more reports available in this batch
  return (
    <StrictCompareContainer
      batchSnapshots={batchSnapshots}
      batchId={selectedBatchId || batchSnapshots[0].batchId}
      settings={settings}
      backendConnected={backendConnected}
      comparePreselected={comparePreselected}
      setComparePreselected={setComparePreselected}
      setSelectedStudentId={setSelectedStudentId}
      setActiveTab={setActiveTab}
    />
  );
};

// --------------------------------------------------------------------------------------------------
// Main Comparative Container
// --------------------------------------------------------------------------------------------------
interface StrictCompareContainerProps {
  batchSnapshots: Snapshot[];
  batchId: string;
  settings: { deltaTolerance: number; maskPii: boolean };
  backendConnected: boolean;
  comparePreselected: { leftId: string; rightId: string } | null;
  setComparePreselected: (val: { leftId: string; rightId: string } | null) => void;
  setSelectedStudentId: (id: string | null) => void;
  setActiveTab: (tab: ActiveTab) => void;
}

const StrictCompareContainer: React.FC<StrictCompareContainerProps> = ({
  batchSnapshots,
  batchId,
  settings,
  backendConnected,
  comparePreselected,
  setComparePreselected,
  setSelectedStudentId,
  setActiveTab,
}) => {
  // Default to preselected or the oldest and newest reports
  const [leftId, setLeftId] = useState<string>(() => {
    if (comparePreselected?.leftId && batchSnapshots.some((s) => s.id === comparePreselected.leftId)) {
      return comparePreselected.leftId;
    }
    return batchSnapshots[0].id;
  });

  const [rightId, setRightId] = useState<string>(() => {
    if (comparePreselected?.rightId && batchSnapshots.some((s) => s.id === comparePreselected.rightId)) {
      return comparePreselected.rightId;
    }
    return batchSnapshots[batchSnapshots.length - 1].id;
  });

  const [sameItems, setSameItems] = useState(false);
  const [isComparing, setIsComparing] = useState(false);
  const [compareResult, setCompareResult] = useState<StrictCompareResult | null>(null);
  const [notComparableError, setNotComparableError] = useState<{
    shortReason: string;
    checks: CompatibilityCheckItem[];
  } | null>(null);
  const [showFailedChecks, setShowFailedChecks] = useState(true);
  const [showHelpModal, setShowHelpModal] = useState(false);
  const [activeSubTab, setActiveSubTab] = useState<'summary' | 'learners' | 'assignments' | 'content' | 'attendance'>('summary');

  // Clear preselected once initialized
  useEffect(() => {
    if (comparePreselected) {
      setComparePreselected(null);
    }
  }, [comparePreselected, setComparePreselected]);

  // Execute comparison
  const runComparison = async (idA: string, idB: string, sameItemsOnly: boolean) => {
    if (!idA || !idB || idA === idB) return;
    setIsComparing(true);
    setNotComparableError(null);

    try {
      let res: StrictCompareResult;

      // 1. If backend API is connected and authenticated, query server
      if (backendConnected && apiClient.isAuthenticated()) {
        try {
          res = await apiClient.compareSnapshots(batchId, idA, idB, {
            sameItems: sameItemsOnly,
            tolerance: settings.deltaTolerance,
          });
        } catch (apiErr: any) {
          if (apiErr?.code === 'NOT_COMPARABLE' || apiErr?.status === 422) {
            setCompareResult(null);
            setNotComparableError({
              shortReason: apiErr.shortReason || 'Reports do not meet compatibility criteria',
              checks: apiErr.checks || [],
            });
            return;
          }
          // Fall back to local comparison if network issue
          res = await compareSnapshotsLocal(batchId, idA, idB, {
            tolerance: settings.deltaTolerance,
            sameItems: sameItemsOnly,
          });
        }
      } else {
        // Pure local Dexie comparison
        res = await compareSnapshotsLocal(batchId, idA, idB, {
          tolerance: settings.deltaTolerance,
          sameItems: sameItemsOnly,
        });
      }

      if (!res.isComparable) {
        setCompareResult(null);
        setNotComparableError({
          shortReason: res.shortReason || 'Reports are incompatible',
          checks: res.checks || [],
        });
      } else {
        setCompareResult(res);
        setNotComparableError(null);
      }
    } catch (err: any) {
      setCompareResult(null);
      setNotComparableError({
        shortReason: err.message || 'Comparison failed',
        checks: [],
      });
    } finally {
      setIsComparing(false);
    }
  };

  // Run automatically on first mount or when IDs change
  useEffect(() => {
    if (leftId && rightId && leftId !== rightId) {
      runComparison(leftId, rightId, sameItems);
    }
  }, [leftId, rightId, sameItems, batchId]);

  // Sort helpers
  const handleLeftChange = (selected: string) => {
    setLeftId(selected);
  };

  const handleRightChange = (selected: string) => {
    setRightId(selected);
  };

  return (
    <div className="space-y-4">
      {/* Selector & Actions Bar */}
      <Card className="p-4 bg-surface border border-border/70 shadow-xs">
        <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-3">
            {/* Left (Baseline) Dropdown */}
            <div className="space-y-1">
              <label className="block text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">
                Baseline Report (Left)
              </label>
              <select
                value={leftId}
                onChange={(e) => handleLeftChange(e.target.value)}
                className="text-xs font-medium border border-border rounded-[8px] px-3 py-1.5 bg-background text-foreground focus:ring-1 focus:ring-primary focus:outline-none cursor-pointer"
              >
                {batchSnapshots.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.snapshotDate} ({s.fileName || 'Report'})
                  </option>
                ))}
              </select>
            </div>

            <div className="text-muted-foreground pt-4">
              <ArrowRight className="w-4 h-4" />
            </div>

            {/* Right (Current) Dropdown */}
            <div className="space-y-1">
              <label className="block text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">
                Current Report (Right)
              </label>
              <select
                value={rightId}
                onChange={(e) => handleRightChange(e.target.value)}
                className="text-xs font-medium border border-border rounded-[8px] px-3 py-1.5 bg-background text-foreground focus:ring-1 focus:ring-primary focus:outline-none cursor-pointer"
              >
                {batchSnapshots.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.snapshotDate} ({s.fileName || 'Report'})
                  </option>
                ))}
              </select>
            </div>

            <div className="pt-4">
              <Button
                size="sm"
                onClick={() => runComparison(leftId, rightId, sameItems)}
                disabled={leftId === rightId || isComparing}
                className="text-xs h-8 px-4 bg-primary text-primary-foreground hover:bg-primary/90 font-medium"
              >
                {isComparing ? 'Comparing...' : 'Compare Cohorts'}
              </Button>
            </div>
          </div>

          <div className="flex items-center gap-2 pt-2 md:pt-0">
            <button
              onClick={() => setShowHelpModal(true)}
              className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground px-2.5 py-1.5 rounded-[8px] border border-border/60 hover:bg-muted/40 transition-colors"
            >
              <Info className="w-3.5 h-3.5 text-primary" />
              <span>How to read this</span>
            </button>
          </div>
        </div>

        {leftId === rightId && (
          <p className="text-[11px] text-amber-600 dark:text-amber-400 mt-2 flex items-center gap-1">
            <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
            Select two different report dates to compare cohort progress.
          </p>
        )}
      </Card>

      {/* Incompatibility / Failed Checks Panel */}
      {notComparableError && (
        <Card className="p-4 border-destructive/30 bg-destructive/5 space-y-3">
          <div className="flex items-start justify-between">
            <div className="flex items-start gap-2.5">
              <AlertCircle className="w-5 h-5 text-destructive shrink-0 mt-0.5" />
              <div>
                <h4 className="text-xs font-semibold text-destructive">
                  Compare correct document
                </h4>
                <p className="text-xs text-destructive/90 mt-0.5 font-medium">
                  {notComparableError.shortReason}
                </p>
              </div>
            </div>
            {notComparableError.checks.length > 0 && (
              <button
                onClick={() => setShowFailedChecks(!showFailedChecks)}
                className="text-xs text-destructive hover:underline flex items-center gap-1 font-medium"
              >
                {showFailedChecks ? 'Hide Details' : 'View Details'}
                {showFailedChecks ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
              </button>
            )}
          </div>

          {showFailedChecks && notComparableError.checks.length > 0 && (
            <div className="pt-2 border-t border-destructive/20 space-y-2">
              <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">
                Compatibility Verification Checks
              </p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs">
                {notComparableError.checks.map((c, i) => (
                  <div
                    key={i}
                    className={`p-2.5 rounded-[8px] border flex items-start gap-2 ${
                      c.passed
                        ? 'bg-emerald-500/5 border-emerald-500/20 text-emerald-700 dark:text-emerald-300'
                        : 'bg-destructive/10 border-destructive/30 text-destructive'
                    }`}
                  >
                    {c.passed ? (
                      <CheckCircle2 className="w-4 h-4 text-emerald-600 dark:text-emerald-400 shrink-0 mt-0.5" />
                    ) : (
                      <XCircle className="w-4 h-4 text-destructive shrink-0 mt-0.5" />
                    )}
                    <div>
                      <p className="font-semibold text-xs">{c.name}</p>
                      <p className="text-[11px] opacity-90 mt-0.5">{c.detail}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </Card>
      )}

      {/* Comparison Successful View */}
      {compareResult && compareResult.isComparable && (
        <div className="space-y-4 animate-in fade-in duration-200">
          {/* Top Strip with Chips, Day Gap, Fair Comparison Toggle & CSV Export */}
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 p-3 bg-muted/20 border border-border/60 rounded-[12px]">
            <div className="flex flex-wrap items-center gap-2 text-xs">
              <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-[6px] bg-surface border border-border font-medium text-foreground">
                <Calendar className="w-3.5 h-3.5 text-muted-foreground" />
                Baseline: <strong className="num">{compareResult.fromSnapshotDate}</strong>
              </span>
              <span className="text-muted-foreground">→</span>
              <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-[6px] bg-surface border border-border font-medium text-foreground">
                <Calendar className="w-3.5 h-3.5 text-primary" />
                Current: <strong className="num">{compareResult.toSnapshotDate}</strong>
              </span>
              {compareResult.daysGap !== undefined && (
                <span className="px-2 py-0.5 rounded-[6px] bg-primary/10 text-primary font-medium text-[11px] num">
                  {compareResult.daysGap} days apart
                </span>
              )}
            </div>

            <div className="flex items-center gap-3">
              {/* Fair Comparison Toggle */}
              <div className="flex items-center gap-2 bg-surface border border-border rounded-[8px] p-0.5 text-xs">
                <button
                  type="button"
                  onClick={() => setSameItems(false)}
                  className={`px-2.5 py-1 rounded-[6px] font-medium transition-colors ${
                    !sameItems ? 'bg-primary text-primary-foreground shadow-xs' : 'text-muted-foreground hover:text-foreground'
                  }`}
                >
                  Reported values
                </button>
                <button
                  type="button"
                  onClick={() => setSameItems(true)}
                  className={`px-2.5 py-1 rounded-[6px] font-medium transition-colors ${
                    sameItems ? 'bg-primary text-primary-foreground shadow-xs' : 'text-muted-foreground hover:text-foreground'
                  }`}
                >
                  Same items only
                </button>
              </div>

              {/* Export CSV */}
              <Button
                variant="outline"
                size="sm"
                onClick={() => exportComparisonCSV(compareResult, settings.maskPii)}
                className="text-xs h-7 px-2.5 rounded-[8px] gap-1.5"
              >
                <Download className="w-3.5 h-3.5" />
                Export CSV
              </Button>
            </div>
          </div>

          {compareResult.fairComparisonNote && (
            <p className="text-[11px] text-muted-foreground px-1 italic">
              Notice: {compareResult.fairComparisonNote}. Switch to "Same items only" to isolate performance across common curriculum items.
            </p>
          )}

          {/* Row of 3 Headline KPI Cards */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            {/* 1. Assignment Submission */}
            <HeadlineKpiCard
              title="Assignment Submission"
              metric={compareResult.metrics?.assignmentSubmission}
              subtext="Cohort-wide completion rate across assigned tasks"
            />

            {/* 2. Content Consumption */}
            <HeadlineKpiCard
              title="Content Consumption"
              metric={compareResult.metrics?.contentConsumption}
              subtext="Video, reading material and module progress"
            />

            {/* 3. Live Attendance (with Live+Rec beside) */}
            <HeadlineKpiCard
              title="Session Attendance"
              metric={compareResult.metrics?.liveAttendance}
              secondaryMetric={compareResult.metrics?.attendance}
              subtext="Live class participation (Live + Recording)"
            />
          </div>

          {/* Deterministic Plain-Language Insights Strip */}
          {compareResult.insights && (
            <Card className="p-3.5 bg-surface border border-border/70 space-y-2">
              <div className="flex items-center gap-1.5 text-xs font-semibold text-foreground uppercase tracking-wider">
                <Sparkles className="w-3.5 h-3.5 text-primary" />
                Cohort Performance Key Takeaways
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs">
                {compareResult.insights.positives.map((text, i) => (
                  <div
                    key={i}
                    className="p-2.5 rounded-[8px] bg-emerald-500/5 border border-emerald-500/20 text-emerald-800 dark:text-emerald-200 flex items-start gap-2"
                  >
                    <TrendingUp className="w-4 h-4 text-emerald-600 dark:text-emerald-400 shrink-0 mt-0.5" />
                    <span>{text}</span>
                  </div>
                ))}
                {compareResult.insights.concerns.map((text, i) => (
                  <div
                    key={i}
                    className="p-2.5 rounded-[8px] bg-amber-500/5 border border-amber-500/20 text-amber-800 dark:text-amber-200 flex items-start gap-2"
                  >
                    <TrendingDown className="w-4 h-4 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
                    <span>{text}</span>
                  </div>
                ))}
              </div>
            </Card>
          )}

          {/* 5 View Tabs */}
          <div className="space-y-3">
            <div className="flex items-center gap-1 border-b border-border/60 pb-1 text-xs">
              {[
                { key: 'summary', label: 'Summary & Distributions' },
                { key: 'learners', label: `Learners (${compareResult.learnerComparisons?.length || 0})` },
                { key: 'assignments', label: `Assignments (${compareResult.assignmentComparison?.length || 0})` },
                { key: 'content', label: `Content Weeks (${compareResult.contentComparison?.length || 0})` },
                { key: 'attendance', label: `Attendance (${compareResult.sessionComparison?.length || 0})` },
              ].map((tab) => (
                <button
                  key={tab.key}
                  onClick={() => setActiveSubTab(tab.key as any)}
                  className={`px-3 py-1.5 rounded-[8px] font-medium transition-colors ${
                    activeSubTab === tab.key
                      ? 'bg-primary/10 text-primary font-semibold'
                      : 'text-muted-foreground hover:text-foreground hover:bg-muted/30'
                  }`}
                >
                  {tab.label}
                </button>
              ))}
            </div>

            {/* TAB 1: SUMMARY */}
            {activeSubTab === 'summary' && (
              <div className="space-y-4">
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                  {/* Dumbbell / Progress Chart */}
                  <Card className="p-4 space-y-3">
                    <h4 className="text-xs font-semibold text-foreground flex items-center justify-between">
                      <span>Cohort Trajectory (Baseline vs Current)</span>
                      <span className="text-[11px] text-muted-foreground font-normal">Percentage points</span>
                    </h4>
                    <div className="h-60">
                      <ResponsiveContainer width="100%" height="100%">
                        <BarChart
                          data={[
                            {
                              name: 'Assignments',
                              Baseline: compareResult.metrics?.assignmentSubmission?.leftAvg || 0,
                              Current: compareResult.metrics?.assignmentSubmission?.rightAvg || 0,
                            },
                            {
                              name: 'Content',
                              Baseline: compareResult.metrics?.contentConsumption?.leftAvg || 0,
                              Current: compareResult.metrics?.contentConsumption?.rightAvg || 0,
                            },
                            {
                              name: 'Live Class',
                              Baseline: compareResult.metrics?.liveAttendance?.leftAvg || 0,
                              Current: compareResult.metrics?.liveAttendance?.rightAvg || 0,
                            },
                            {
                              name: 'Live + Rec',
                              Baseline: compareResult.metrics?.attendance?.leftAvg || 0,
                              Current: compareResult.metrics?.attendance?.rightAvg || 0,
                            },
                          ]}
                          margin={{ top: 10, right: 10, left: -20, bottom: 0 }}
                        >
                          <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
                          <XAxis dataKey="name" tick={{ fontSize: 11 }} />
                          <YAxis domain={[0, 100]} tick={{ fontSize: 11 }} />
                          <Tooltip />
                          <Legend wrapperStyle={{ fontSize: 11 }} />
                          <Bar dataKey="Baseline" fill="#94a3b8" radius={[4, 4, 0, 0]} />
                          <Bar dataKey="Current" fill="#0d9488" radius={[4, 4, 0, 0]} />
                        </BarChart>
                      </ResponsiveContainer>
                    </div>
                  </Card>

                  {/* Scatter Plot: Baseline vs Current with y = x Reference Line */}
                  <Card className="p-4 space-y-3">
                    <h4 className="text-xs font-semibold text-foreground flex items-center justify-between">
                      <span>Learner Composite Distribution</span>
                      <span className="text-[11px] text-muted-foreground font-normal">Diagonal = no change</span>
                    </h4>
                    <div className="h-60">
                      <ResponsiveContainer width="100%" height="100%">
                        <ScatterChart margin={{ top: 10, right: 20, bottom: 10, left: -20 }}>
                          <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
                          <XAxis
                            type="number"
                            dataKey="leftComposite"
                            name="Baseline %"
                            domain={[0, 100]}
                            tick={{ fontSize: 11 }}
                          />
                          <YAxis
                            type="number"
                            dataKey="rightComposite"
                            name="Current %"
                            domain={[0, 100]}
                            tick={{ fontSize: 11 }}
                          />
                          <Tooltip
                            cursor={{ strokeDasharray: '3 3' }}
                            formatter={(val: any) => [`${val}%`, '']}
                            labelFormatter={(_label, payload) => {
                              const d = payload?.[0]?.payload;
                              return d
                                ? `${formatStudentName(d.name, settings.maskPii)} (${d.status}: ${d.compositeChange >= 0 ? '+' : ''}${d.compositeChange} pp)`
                                : '';
                            }}
                          />
                          <ReferenceLine x={0} y={0} stroke="#64748b" strokeDasharray="3 3" />
                          <ReferenceLine
                            segment={[
                              { x: 0, y: 0 },
                              { x: 100, y: 100 },
                            ]}
                            stroke="#0d9488"
                            strokeWidth={1.5}
                            strokeDasharray="4 4"
                          />
                          <Scatter data={compareResult.learnerComparisons || []}>
                            {(compareResult.learnerComparisons || []).map((entry, index) => {
                              const color =
                                entry.status === 'Improved'
                                  ? '#10b981'
                                  : entry.status === 'Declined'
                                  ? '#ef4444'
                                  : '#94a3b8';
                              return <Cell key={`cell-${index}`} fill={color} />;
                            })}
                          </Scatter>
                        </ScatterChart>
                      </ResponsiveContainer>
                    </div>
                  </Card>
                </div>

                {/* 3x3 Segment Movement Matrix & At-Risk Summary */}
                <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
                  {/* Segment Movement Matrix */}
                  <Card className="p-4 lg:col-span-2 space-y-3">
                    <div className="flex items-center justify-between">
                      <h4 className="text-xs font-semibold text-foreground">
                        3x3 Segment Migration Matrix
                      </h4>
                      <div className="flex items-center gap-2 text-[10px] text-muted-foreground">
                        <span className="flex items-center gap-1">
                          <span className="w-2 h-2 rounded-full bg-emerald-500" />
                          Upgraded: <strong>{compareResult.segmentMatrix?.movedUp || 0}</strong>
                        </span>
                        <span className="flex items-center gap-1">
                          <span className="w-2 h-2 rounded-full bg-slate-400" />
                          Retained: <strong>{compareResult.segmentMatrix?.unchanged || 0}</strong>
                        </span>
                        <span className="flex items-center gap-1">
                          <span className="w-2 h-2 rounded-full bg-rose-500" />
                          Downgraded: <strong>{compareResult.segmentMatrix?.movedDown || 0}</strong>
                        </span>
                      </div>
                    </div>

                    <div className="overflow-x-auto">
                      <table className="w-full text-center text-xs border-collapse">
                        <thead>
                          <tr>
                            <th className="p-2 border border-border/60 bg-muted/20 text-muted-foreground font-medium text-[11px]">
                              Baseline \ Current
                            </th>
                            <th className="p-2 border border-border/60 bg-muted/20 font-semibold text-emerald-700 dark:text-emerald-400">
                              High (≥80%)
                            </th>
                            <th className="p-2 border border-border/60 bg-muted/20 font-semibold text-amber-700 dark:text-amber-400">
                              Medium (50-79%)
                            </th>
                            <th className="p-2 border border-border/60 bg-muted/20 font-semibold text-rose-700 dark:text-rose-400">
                              Low (&lt;50%)
                            </th>
                          </tr>
                        </thead>
                        <tbody>
                          {(['High', 'Medium', 'Low'] as const).map((fromSeg) => (
                            <tr key={fromSeg}>
                              <td className="p-2 border border-border/60 font-semibold bg-muted/10 text-left">
                                {fromSeg}
                              </td>
                              {(['High', 'Medium', 'Low'] as const).map((toSeg) => {
                                const count =
                                  compareResult.segmentMatrix?.matrix?.[fromSeg]?.[toSeg] || 0;
                                const isUpgrade =
                                  (fromSeg === 'Low' && (toSeg === 'Medium' || toSeg === 'High')) ||
                                  (fromSeg === 'Medium' && toSeg === 'High');
                                const isDowngrade =
                                  (fromSeg === 'High' && (toSeg === 'Medium' || toSeg === 'Low')) ||
                                  (fromSeg === 'Medium' && toSeg === 'Low');
                                const isSame = fromSeg === toSeg;

                                const bg = isUpgrade
                                  ? 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 font-bold'
                                  : isDowngrade
                                  ? 'bg-rose-500/10 text-rose-700 dark:text-rose-300 font-bold'
                                  : isSame
                                  ? 'bg-surface font-semibold text-foreground'
                                  : 'bg-muted/5';

                                return (
                                  <td key={toSeg} className={`p-2 border border-border/60 num ${bg}`}>
                                    {count}
                                  </td>
                                );
                              })}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </Card>

                  {/* At-Risk Movement Summary */}
                  <Card className="p-4 space-y-3">
                    <h4 className="text-xs font-semibold text-foreground">
                      At-Risk Learner Transitions
                    </h4>
                    <div className="space-y-2 text-xs">
                      <div className="p-2.5 rounded-[8px] bg-rose-500/10 border border-rose-500/20 text-rose-800 dark:text-rose-200">
                        <div className="flex items-center justify-between font-semibold">
                          <span>Newly At-Risk</span>
                          <span className="num">{compareResult.atRiskMovement?.newlyAtRisk?.length || 0}</span>
                        </div>
                        <p className="text-[10px] text-rose-700 dark:text-rose-300 mt-0.5">
                          Fell below 50% assignment or critical composite
                        </p>
                      </div>

                      <div className="p-2.5 rounded-[8px] bg-emerald-500/10 border border-emerald-500/20 text-emerald-800 dark:text-emerald-200">
                        <div className="flex items-center justify-between font-semibold">
                          <span>Recovered</span>
                          <span className="num">{compareResult.atRiskMovement?.recovered?.length || 0}</span>
                        </div>
                        <p className="text-[10px] text-emerald-700 dark:text-emerald-300 mt-0.5">
                          Progressed out of critical danger zone
                        </p>
                      </div>

                      <div className="p-2.5 rounded-[8px] bg-amber-500/10 border border-amber-500/20 text-amber-800 dark:text-amber-200">
                        <div className="flex items-center justify-between font-semibold">
                          <span>Persistent At-Risk</span>
                          <span className="num">{compareResult.atRiskMovement?.stillAtRisk?.length || 0}</span>
                        </div>
                        <p className="text-[10px] text-amber-700 dark:text-amber-300 mt-0.5">
                          Remained critical in both snapshots
                        </p>
                      </div>
                    </div>
                  </Card>
                </div>

                {/* Top 5 Improvers & Top 5 Decliners */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {/* Top Improvers */}
                  <Card className="p-4 space-y-2.5">
                    <h4 className="text-xs font-semibold text-emerald-700 dark:text-emerald-400 flex items-center gap-1.5">
                      <TrendingUp className="w-4 h-4" />
                      Top 5 Improvers
                    </h4>
                    <div className="space-y-1.5">
                      {(compareResult.topImprovers || []).map((imp) => (
                        <div
                          key={imp.studentId}
                          onClick={() => {
                            setSelectedStudentId(imp.studentId);
                            setActiveTab('students');
                          }}
                          className="p-2 rounded-[8px] border border-border/60 hover:bg-muted/40 cursor-pointer flex items-center justify-between text-xs transition-colors"
                        >
                          <div>
                            <p className="font-medium text-foreground">
                              {formatStudentName(imp.name, settings.maskPii)}
                            </p>
                            <p className="text-[10px] text-muted-foreground">
                              {formatStudentPhone(imp.phoneE164, settings.maskPii)}
                            </p>
                          </div>
                          <span className="px-2 py-0.5 rounded-[6px] bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 font-bold num text-[11px]">
                            +{imp.deltaPts} pp
                          </span>
                        </div>
                      ))}
                    </div>
                  </Card>

                  {/* Top Decliners */}
                  <Card className="p-4 space-y-2.5">
                    <h4 className="text-xs font-semibold text-rose-700 dark:text-rose-400 flex items-center gap-1.5">
                      <TrendingDown className="w-4 h-4" />
                      Top 5 Decliners
                    </h4>
                    <div className="space-y-1.5">
                      {(compareResult.topDecliners || []).map((dec) => (
                        <div
                          key={dec.studentId}
                          onClick={() => {
                            setSelectedStudentId(dec.studentId);
                            setActiveTab('students');
                          }}
                          className="p-2 rounded-[8px] border border-border/60 hover:bg-muted/40 cursor-pointer flex items-center justify-between text-xs transition-colors"
                        >
                          <div>
                            <p className="font-medium text-foreground">
                              {formatStudentName(dec.name, settings.maskPii)}
                            </p>
                            <p className="text-[10px] text-muted-foreground">
                              {formatStudentPhone(dec.phoneE164, settings.maskPii)}
                            </p>
                          </div>
                          <span className="px-2 py-0.5 rounded-[6px] bg-rose-500/10 text-rose-600 dark:text-rose-400 font-bold num text-[11px]">
                            {dec.deltaPts} pp
                          </span>
                        </div>
                      ))}
                    </div>
                  </Card>
                </div>
              </div>
            )}

            {/* TAB 2: LEARNERS */}
            {activeSubTab === 'learners' && (
              <LearnersComparisonTab
                learners={compareResult.learnerComparisons || []}
                maskPii={settings.maskPii}
                onSelectStudent={(id) => {
                  setSelectedStudentId(id);
                  setActiveTab('students');
                }}
              />
            )}

            {/* TAB 3: ASSIGNMENTS */}
            {activeSubTab === 'assignments' && (
              <AssignmentsComparisonTab items={compareResult.assignmentComparison || []} />
            )}

            {/* TAB 4: CONTENT */}
            {activeSubTab === 'content' && (
              <ContentComparisonTab items={compareResult.contentComparison || []} />
            )}

            {/* TAB 5: ATTENDANCE */}
            {activeSubTab === 'attendance' && (
              <AttendanceComparisonTab sessions={compareResult.sessionComparison || []} />
            )}
          </div>
        </div>
      )}

      {/* "How to read this" Modal */}
      {showHelpModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-background/80 backdrop-blur-sm animate-in fade-in duration-150">
          <Card className="max-w-lg w-full p-5 space-y-4 shadow-xl border border-border">
            <div className="flex items-center justify-between border-b border-border/60 pb-3">
              <h3 className="text-sm font-semibold text-foreground flex items-center gap-2">
                <Info className="w-4 h-4 text-primary" />
                How to Read Cohort Comparisons
              </h3>
              <button
                onClick={() => setShowHelpModal(false)}
                className="text-muted-foreground hover:text-foreground text-xs"
              >
                ✕
              </button>
            </div>

            <div className="space-y-3 text-xs leading-relaxed text-muted-foreground">
              <p>
                <strong className="text-foreground">Strict Comparison Rules:</strong> Reports are compared only if they belong to the exact same batch, have different report dates, share 100% of the same learners, and maintain continuous curriculum progression.
              </p>
              <p>
                <strong className="text-foreground">Tolerance Threshold (±{settings.deltaTolerance} pp):</strong> Learner changes within ±{settings.deltaTolerance} percentage points are categorized as <span className="text-slate-500 font-semibold">Same</span> to prevent overreacting to normal day-to-day noise.
              </p>
              <p>
                <strong className="text-foreground">Segment Migration:</strong> High (≥80%), Medium (50-79%), and Low (&lt;50%). The 3x3 matrix tracks movements between these performance brackets.
              </p>
              <p>
                <strong className="text-foreground">Fair Comparison:</strong> "Reported values" shows current snapshot averages including newly added curriculum. "Same items only" filters out newly added assignments/sessions to measure growth on baseline materials alone.
              </p>
            </div>

            <div className="pt-2 flex justify-end">
              <Button size="sm" onClick={() => setShowHelpModal(false)} className="text-xs h-7 px-3">
                Got it
              </Button>
            </div>
          </Card>
        </div>
      )}
    </div>
  );
};

// --------------------------------------------------------------------------------------------------
// Headline KPI Card Component
// --------------------------------------------------------------------------------------------------
interface HeadlineKpiCardProps {
  title: string;
  metric?: {
    leftAvg: number;
    rightAvg: number;
    deltaPts: number;
    status: 'Improved' | 'Same' | 'Declined';
    leftMedian: number;
    rightMedian: number;
  };
  secondaryMetric?: {
    leftAvg: number;
    rightAvg: number;
    deltaPts: number;
  };
  subtext: string;
}

const HeadlineKpiCard: React.FC<HeadlineKpiCardProps> = ({
  title,
  metric,
  secondaryMetric,
  subtext,
}) => {
  if (!metric) return null;

  const delta = metric.deltaPts;
  const isPositive = delta > 0;
  const isNegative = delta < 0;

  return (
    <Card className="p-4 space-y-2 border border-border/70 shadow-xs bg-surface">
      <div className="flex items-center justify-between">
        <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
          {title}
        </span>
        <span
          className={`px-2 py-0.5 rounded-[6px] text-xs font-bold num flex items-center gap-1 ${
            isPositive
              ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400'
              : isNegative
              ? 'bg-rose-500/10 text-rose-600 dark:text-rose-400'
              : 'bg-muted text-muted-foreground'
          }`}
        >
          {isPositive ? <TrendingUp className="w-3 h-3" /> : isNegative ? <TrendingDown className="w-3 h-3" /> : <Minus className="w-3 h-3" />}
          {delta >= 0 ? `+${delta}` : delta} pp
        </span>
      </div>

      <div className="flex items-baseline gap-2">
        <span className="text-2xl font-bold text-foreground num">{metric.rightAvg}%</span>
        <span className="text-xs text-muted-foreground font-medium">
          from <span className="num font-semibold text-foreground/80">{metric.leftAvg}%</span>
        </span>
      </div>

      {secondaryMetric && (
        <div className="text-[11px] text-muted-foreground pt-1 border-t border-border/50 flex items-center justify-between">
          <span>Live + Recording Rate:</span>
          <span className="font-semibold text-foreground num">
            {secondaryMetric.leftAvg}% → {secondaryMetric.rightAvg}% ({secondaryMetric.deltaPts >= 0 ? '+' : ''}{secondaryMetric.deltaPts} pp)
          </span>
        </div>
      )}

      <div className="text-[10px] text-muted-foreground flex items-center justify-between pt-0.5">
        <span>Median: {metric.leftMedian}% → {metric.rightMedian}%</span>
        <span className="truncate">{subtext}</span>
      </div>
    </Card>
  );
};

// --------------------------------------------------------------------------------------------------
// Sub-Tab 2: Learners Detail Tab
// --------------------------------------------------------------------------------------------------
interface LearnersComparisonTabProps {
  learners: NonNullable<StrictCompareResult['learnerComparisons']>;
  maskPii: boolean;
  onSelectStudent: (studentId: string) => void;
}

const LearnersComparisonTab: React.FC<LearnersComparisonTabProps> = ({
  learners,
  maskPii,
  onSelectStudent,
}) => {
  const [filter, setFilter] = useState<'ALL' | 'Improved' | 'Same' | 'Declined'>('ALL');
  const [query, setQuery] = useState('');

  const filtered = useMemo(() => {
    return learners.filter((l) => {
      if (filter !== 'ALL' && l.status !== filter) return false;
      if (query.trim()) {
        const q = query.toLowerCase();
        return (
          l.name.toLowerCase().includes(q) ||
          l.phoneE164.includes(q) ||
          l.externalStudentId.toLowerCase().includes(q)
        );
      }
      return true;
    });
  }, [learners, filter, query]);

  return (
    <Card className="p-4 space-y-3">
      {/* Search & Filter pills */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2.5">
        <div className="flex items-center gap-1.5 text-xs">
          {(['ALL', 'Improved', 'Same', 'Declined'] as const).map((opt) => (
            <button
              key={opt}
              onClick={() => setFilter(opt)}
              className={`px-2.5 py-1 rounded-[6px] font-medium transition-colors ${
                filter === opt
                  ? 'bg-primary text-primary-foreground font-semibold shadow-xs'
                  : 'bg-muted/40 text-muted-foreground hover:text-foreground'
              }`}
            >
              {opt} ({opt === 'ALL' ? learners.length : learners.filter((l) => l.status === opt).length})
            </button>
          ))}
        </div>

        <div className="relative w-full sm:w-64">
          <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <input
            type="text"
            placeholder="Search learner name or phone..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="w-full text-xs pl-8 pr-2.5 py-1.5 border border-border rounded-[8px] bg-background text-foreground focus:ring-1 focus:ring-primary focus:outline-none"
          />
        </div>
      </div>

      {/* Table */}
      <div className="overflow-x-auto border border-border/60 rounded-[10px]">
        <table className="w-full text-xs text-left border-collapse">
          <thead>
            <tr className="bg-muted/20 border-b border-border/60 text-muted-foreground text-[11px] font-medium">
              <th className="p-2.5">Learner</th>
              <th className="p-2.5">Segment Migration</th>
              <th className="p-2.5 text-right">Composite Change</th>
              <th className="p-2.5 text-right">Assignment Δ</th>
              <th className="p-2.5 text-right">Content Δ</th>
              <th className="p-2.5 text-right">Attendance Δ</th>
              <th className="p-2.5 text-center">Status</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border/40">
            {filtered.map((l) => (
              <tr
                key={l.studentId}
                onClick={() => onSelectStudent(l.studentId)}
                className="hover:bg-muted/30 cursor-pointer transition-colors"
              >
                <td className="p-2.5">
                  <p className="font-semibold text-foreground">
                    {formatStudentName(l.name, maskPii)}
                  </p>
                  <p className="text-[10px] text-muted-foreground font-mono">
                    {formatStudentPhone(l.phoneE164, maskPii)}
                  </p>
                </td>
                <td className="p-2.5">
                  <span className="font-medium text-[11px] text-muted-foreground">
                    {l.leftSegment} → <strong className="text-foreground">{l.rightSegment}</strong>
                  </span>
                </td>
                <td className="p-2.5 text-right num font-semibold">
                  <span
                    className={
                      l.compositeChange > 0
                        ? 'text-emerald-600 dark:text-emerald-400'
                        : l.compositeChange < 0
                        ? 'text-rose-600 dark:text-rose-400'
                        : 'text-muted-foreground'
                    }
                  >
                    {l.compositeChange >= 0 ? `+${l.compositeChange}` : l.compositeChange} pp
                  </span>
                </td>
                <td className="p-2.5 text-right num">
                  {l.assignmentDelta >= 0 ? `+${l.assignmentDelta}` : l.assignmentDelta} pp
                </td>
                <td className="p-2.5 text-right num">
                  {l.contentDelta >= 0 ? `+${l.contentDelta}` : l.contentDelta} pp
                </td>
                <td className="p-2.5 text-right num">
                  {l.liveOrRecDelta >= 0 ? `+${l.liveOrRecDelta}` : l.liveOrRecDelta} pp
                </td>
                <td className="p-2.5 text-center">
                  <span
                    className={`inline-block px-2 py-0.5 rounded-[6px] text-[10px] font-semibold ${
                      l.status === 'Improved'
                        ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400'
                        : l.status === 'Declined'
                        ? 'bg-rose-500/10 text-rose-600 dark:text-rose-400'
                        : 'bg-muted text-muted-foreground'
                    }`}
                  >
                    {l.status}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
};

// --------------------------------------------------------------------------------------------------
// Sub-Tab 3: Assignments Comparison Tab
// --------------------------------------------------------------------------------------------------
const AssignmentsComparisonTab: React.FC<{
  items: NonNullable<StrictCompareResult['assignmentComparison']>;
}> = ({ items }) => {
  const [showTableOnly, setShowTableOnly] = useState(false);

  return (
    <Card className="p-4 space-y-3">
      <div className="flex items-center justify-between">
        <h4 className="text-xs font-semibold text-foreground">
          Assignment Task Submission Rates
        </h4>
        <Button
          variant="outline"
          size="sm"
          onClick={() => setShowTableOnly(!showTableOnly)}
          className="text-xs h-7 px-2.5 gap-1.5"
        >
          {showTableOnly ? <BarChart3 className="w-3.5 h-3.5" /> : <TableIcon className="w-3.5 h-3.5" />}
          {showTableOnly ? 'Show Chart' : 'Show Table'}
        </Button>
      </div>

      {!showTableOnly && (
        <div className="h-64">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart
              data={items.map((it) => ({
                name: it.name.length > 20 ? it.name.slice(0, 18) + '...' : it.name,
                fullName: it.name,
                Baseline: it.leftSubmissionRate ?? 0,
                Current: it.rightSubmissionRate,
                isNew: it.isNew,
              }))}
              margin={{ top: 10, right: 10, left: -20, bottom: 40 }}
            >
              <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
              <XAxis dataKey="name" angle={-30} textAnchor="end" interval={0} tick={{ fontSize: 10 }} />
              <YAxis domain={[0, 100]} tick={{ fontSize: 11 }} />
              <Tooltip />
              <Legend wrapperStyle={{ fontSize: 11 }} verticalAlign="top" />
              <Bar dataKey="Baseline" fill="#94a3b8" radius={[4, 4, 0, 0]} />
              <Bar dataKey="Current" fill="#0d9488" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}

      <div className="overflow-x-auto border border-border/60 rounded-[10px]">
        <table className="w-full text-xs text-left border-collapse">
          <thead>
            <tr className="bg-muted/20 border-b border-border/60 text-muted-foreground text-[11px] font-medium">
              <th className="p-2.5">Assignment Task</th>
              <th className="p-2.5 text-center">Status</th>
              <th className="p-2.5 text-right">Baseline Rate</th>
              <th className="p-2.5 text-right">Current Rate</th>
              <th className="p-2.5 text-right">Point Change</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border/40">
            {items.map((it, i) => (
              <tr key={i} className="hover:bg-muted/20">
                <td className="p-2.5 font-medium text-foreground">{it.name}</td>
                <td className="p-2.5 text-center">
                  {it.isNew ? (
                    <span className="px-2 py-0.5 rounded-[6px] bg-primary/10 text-primary font-bold text-[10px]">
                      NEW
                    </span>
                  ) : (
                    <span className="px-2 py-0.5 rounded-[6px] bg-muted text-muted-foreground text-[10px]">
                      EXISTING
                    </span>
                  )}
                </td>
                <td className="p-2.5 text-right num text-muted-foreground">
                  {it.leftSubmissionRate !== null ? `${it.leftSubmissionRate}%` : '—'}
                </td>
                <td className="p-2.5 text-right num font-semibold text-foreground">
                  {it.rightSubmissionRate}%
                </td>
                <td className="p-2.5 text-right num font-semibold">
                  {it.deltaPts !== null ? (
                    <span
                      className={
                        it.deltaPts > 0
                          ? 'text-emerald-600 dark:text-emerald-400'
                          : it.deltaPts < 0
                          ? 'text-rose-600 dark:text-rose-400'
                          : 'text-muted-foreground'
                      }
                    >
                      {it.deltaPts >= 0 ? `+${it.deltaPts}` : it.deltaPts} pp
                    </span>
                  ) : (
                    '—'
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
};

// --------------------------------------------------------------------------------------------------
// Sub-Tab 4: Content Comparison Tab
// --------------------------------------------------------------------------------------------------
const ContentComparisonTab: React.FC<{
  items: NonNullable<StrictCompareResult['contentComparison']>;
}> = ({ items }) => {
  return (
    <Card className="p-4 space-y-3">
      <h4 className="text-xs font-semibold text-foreground">
        Weekly Content Consumption Trajectory
      </h4>
      <div className="h-60">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart
            data={items.map((w) => ({
              week: `Week ${w.weekNo}`,
              Baseline: w.leftConsumedPct ?? 0,
              Current: w.rightConsumedPct,
              isNew: w.isNew,
            }))}
            margin={{ top: 10, right: 10, left: -20, bottom: 0 }}
          >
            <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
            <XAxis dataKey="week" tick={{ fontSize: 11 }} />
            <YAxis domain={[0, 100]} tick={{ fontSize: 11 }} />
            <Tooltip />
            <Legend wrapperStyle={{ fontSize: 11 }} />
            <Bar dataKey="Baseline" fill="#94a3b8" radius={[4, 4, 0, 0]} />
            <Bar dataKey="Current" fill="#0d9488" radius={[4, 4, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>

      <div className="overflow-x-auto border border-border/60 rounded-[10px]">
        <table className="w-full text-xs text-left border-collapse">
          <thead>
            <tr className="bg-muted/20 border-b border-border/60 text-muted-foreground text-[11px] font-medium">
              <th className="p-2.5">Week Module</th>
              <th className="p-2.5 text-center">Status</th>
              <th className="p-2.5 text-right">Baseline Consumption</th>
              <th className="p-2.5 text-right">Current Consumption</th>
              <th className="p-2.5 text-right">Point Change</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border/40">
            {items.map((w) => (
              <tr key={w.weekNo} className="hover:bg-muted/20">
                <td className="p-2.5 font-semibold text-foreground">Week {w.weekNo}</td>
                <td className="p-2.5 text-center">
                  {w.isNew ? (
                    <span className="px-2 py-0.5 rounded-[6px] bg-primary/10 text-primary font-bold text-[10px]">
                      NEW
                    </span>
                  ) : (
                    <span className="px-2 py-0.5 rounded-[6px] bg-muted text-muted-foreground text-[10px]">
                      EXISTING
                    </span>
                  )}
                </td>
                <td className="p-2.5 text-right num text-muted-foreground">
                  {w.leftConsumedPct !== null ? `${w.leftConsumedPct}%` : '—'}
                </td>
                <td className="p-2.5 text-right num font-semibold text-foreground">
                  {w.rightConsumedPct}%
                </td>
                <td className="p-2.5 text-right num font-semibold">
                  {w.deltaPts !== null ? (
                    <span
                      className={
                        w.deltaPts > 0
                          ? 'text-emerald-600 dark:text-emerald-400'
                          : w.deltaPts < 0
                          ? 'text-rose-600 dark:text-rose-400'
                          : 'text-muted-foreground'
                      }
                    >
                      {w.deltaPts >= 0 ? `+${w.deltaPts}` : w.deltaPts} pp
                    </span>
                  ) : (
                    '—'
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
};

// --------------------------------------------------------------------------------------------------
// Sub-Tab 5: Attendance Comparison Tab
// --------------------------------------------------------------------------------------------------
const AttendanceComparisonTab: React.FC<{
  sessions: NonNullable<StrictCompareResult['sessionComparison']>;
}> = ({ sessions }) => {
  return (
    <Card className="p-4 space-y-3">
      <h4 className="text-xs font-semibold text-foreground">
        Live and Recorded Attendance Progression per Session
      </h4>

      <div className="overflow-x-auto border border-border/60 rounded-[10px]">
        <table className="w-full text-xs text-left border-collapse">
          <thead>
            <tr className="bg-muted/20 border-b border-border/60 text-muted-foreground text-[11px] font-medium">
              <th className="p-2.5">Session Title</th>
              <th className="p-2.5">Date</th>
              <th className="p-2.5 text-center">Status</th>
              <th className="p-2.5 text-right">Live Rate</th>
              <th className="p-2.5 text-right">Live + Rec Rate</th>
              <th className="p-2.5 text-right">Attendance Δ</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border/40">
            {sessions.map((s, i) => (
              <tr key={i} className="hover:bg-muted/20">
                <td className="p-2.5 font-medium text-foreground max-w-xs truncate">{s.title}</td>
                <td className="p-2.5 text-muted-foreground num">{s.date || '—'}</td>
                <td className="p-2.5 text-center">
                  {s.isNew ? (
                    <span className="px-2 py-0.5 rounded-[6px] bg-primary/10 text-primary font-bold text-[10px]">
                      NEW
                    </span>
                  ) : (
                    <span className="px-2 py-0.5 rounded-[6px] bg-muted text-muted-foreground text-[10px]">
                      EXISTING
                    </span>
                  )}
                </td>
                <td className="p-2.5 text-right num text-foreground font-semibold">
                  {s.rightLiveRate}%
                </td>
                <td className="p-2.5 text-right num text-foreground font-semibold">
                  {s.rightLiveRecRate}%
                </td>
                <td className="p-2.5 text-right num font-semibold">
                  {s.liveRecDeltaPts !== null ? (
                    <span
                      className={
                        s.liveRecDeltaPts > 0
                          ? 'text-emerald-600 dark:text-emerald-400'
                          : s.liveRecDeltaPts < 0
                          ? 'text-rose-600 dark:text-rose-400'
                          : 'text-muted-foreground'
                      }
                    >
                      {s.liveRecDeltaPts >= 0 ? `+${s.liveRecDeltaPts}` : s.liveRecDeltaPts} pp
                    </span>
                  ) : (
                    '—'
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
};

// --------------------------------------------------------------------------------------------------
// CSV Export Utility
// --------------------------------------------------------------------------------------------------
function exportComparisonCSV(result: StrictCompareResult, maskPii: boolean) {
  const learners = result.learnerComparisons || [];
  const rows: string[] = [];

  // Header
  rows.push([
    'Student ID',
    'Student Name',
    'Phone',
    'Baseline Segment',
    'Current Segment',
    'Baseline Composite',
    'Current Composite',
    'Composite Change (pp)',
    'Assignment Delta (pp)',
    'Content Delta (pp)',
    'Attendance Delta (pp)',
    'Status',
  ].join(','));

  for (const l of learners) {
    rows.push([
      `"${l.externalStudentId}"`,
      `"${formatStudentName(l.name, maskPii)}"`,
      `"${formatStudentPhone(l.phoneE164, maskPii)}"`,
      `"${l.leftSegment}"`,
      `"${l.rightSegment}"`,
      l.leftComposite,
      l.rightComposite,
      l.compositeChange,
      l.assignmentDelta,
      l.contentDelta,
      l.liveOrRecDelta,
      `"${l.status}"`,
    ].join(','));
  }

  const blob = new Blob([rows.join('\n')], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.setAttribute('href', url);
  link.setAttribute('download', `cohort_comparison_${result.fromSnapshotDate}_to_${result.toSnapshotDate}.csv`);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}
