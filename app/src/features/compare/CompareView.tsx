import React, { useState, useMemo, useEffect } from "react";
import { Card } from "@/ui/Card";
import { Button } from "@/ui/Button";
import { usePlatformStore, type ActiveTab } from "@/store/usePlatformStore";
import {
  compareSnapshotsLocal,
  type StrictCompareResult,
  type CompatibilityCheckItem,
} from "@/core/analytics/clientStrictCompare";
import { downloadComparisonCsv } from "@/core/analytics/sharedMetrics";
import { apiClient } from "@/core/api/client";
import type {
  Snapshot,
  StudentSnapshot,
  Student,
  AssignmentResult,
  Session,
} from "@/types";
import {
  GitCompare,
  UploadCloud,
  Search,
  CheckCircle2,
  XCircle,
  AlertCircle,
  AlertTriangle,
  Download,
  Info,
  Minus,
  ChevronDown,
  ChevronUp,
  Table as TableIcon,
  BarChart3,
  Layers,
  ArrowUpRight,
  ArrowDownRight,
  RotateCcw,
} from "lucide-react";
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
} from "recharts";

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
      <div className="bg-[#fdfdff] dark:bg-[#181b2a] border border-[#e3e5ef] dark:border-[#282c40] rounded-2xl p-12 text-center max-w-md mx-auto space-y-4 my-8">
        <div className="w-14 h-14 rounded-2xl bg-[#4338ca]/10 text-[#4338ca] flex items-center justify-center mx-auto shadow-xs border border-[#4338ca]/20">
          <GitCompare className="w-7 h-7" />
        </div>
        <div className="space-y-1.5">
          <h3 className="text-base font-bold text-[#14162b] dark:text-[#f1f3fa] font-sans">
            No reports yet for this course
          </h3>
          <p className="text-xs text-muted-foreground leading-relaxed">
            Upload a cumulative report to begin tracking cohort progress and
            enable strict comparative analytics.
          </p>
        </div>
        <Button
          onClick={() => setUploadModalOpen(true, true)}
          className="gap-2 mx-auto mt-2 bg-[#4338ca] hover:bg-[#3730a3] text-white text-xs font-semibold"
        >
          <UploadCloud className="w-4 h-4" />
          Upload Report
        </Button>
      </div>
    );
  }

  // State 1: Exactly 1 report in this batch
  if (batchSnapshots.length === 1) {
    return (
      <div className="bg-[#fdfdff] dark:bg-[#181b2a] border border-[#e3e5ef] dark:border-[#282c40] rounded-2xl p-12 text-center max-w-md mx-auto space-y-4 my-8">
        <div className="w-14 h-14 rounded-2xl bg-amber-500/10 text-amber-600 dark:text-amber-400 flex items-center justify-center mx-auto shadow-xs border border-amber-500/20">
          <Layers className="w-7 h-7" />
        </div>
        <div className="space-y-1.5">
          <h3 className="text-base font-bold text-[#14162b] dark:text-[#f1f3fa] font-sans">
            Upload another report of this batch to compare
          </h3>
          <p className="text-xs text-muted-foreground leading-relaxed">
            Strict comparison requires at least two snapshots of different dates
            in the same batch to measure cohort trajectory and learner
            progression.
          </p>
        </div>
        <Button
          onClick={() => setUploadModalOpen(true, true)}
          className="gap-2 mx-auto mt-2 bg-[#4338ca] hover:bg-[#3730a3] text-white text-xs font-semibold"
        >
          <UploadCloud className="w-4 h-4" />
          Upload Report
        </Button>
      </div>
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
  settings: { deltaTolerance: number };
  backendConnected: boolean;
  comparePreselected: { leftId: string; rightId: string } | null;
  setComparePreselected: (
    val: { leftId: string; rightId: string } | null,
  ) => void;
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
  const [leftId, setLeftId] = useState<string>(() => {
    if (
      comparePreselected?.leftId &&
      batchSnapshots.some((s) => s.id === comparePreselected.leftId)
    ) {
      return comparePreselected.leftId;
    }
    return batchSnapshots[0].id;
  });

  const [rightId, setRightId] = useState<string>(() => {
    if (
      comparePreselected?.rightId &&
      batchSnapshots.some((s) => s.id === comparePreselected.rightId)
    ) {
      return comparePreselected.rightId;
    }
    return batchSnapshots[batchSnapshots.length - 1].id;
  });

  const [sameItems, setSameItems] = useState(false);
  const [isComparing, setIsComparing] = useState(false);
  const [compareResult, setCompareResult] =
    useState<StrictCompareResult | null>(null);
  const [notComparableError, setNotComparableError] = useState<{
    shortReason: string;
    checks: CompatibilityCheckItem[];
  } | null>(null);
  const [showFailedChecks, setShowFailedChecks] = useState(true);
  const [showHelpModal, setShowHelpModal] = useState(false);
  const [activeSubTab, setActiveSubTab] = useState<
    "summary" | "learners" | "assignments" | "content" | "attendance"
  >("summary");

  // Clear preselected once initialized
  useEffect(() => {
    if (comparePreselected) {
      setComparePreselected(null);
    }
  }, [comparePreselected, setComparePreselected]);

  // Execute comparison
  const runComparison = async (
    idA: string,
    idB: string,
    sameItemsOnly: boolean,
  ) => {
    if (!idA || !idB || idA === idB) return;
    setIsComparing(true);
    setNotComparableError(null);

    try {
      let res: StrictCompareResult;

      if (backendConnected && apiClient.isAuthenticated()) {
        try {
          res = await apiClient.compareSnapshots(batchId, idA, idB, {
            sameItems: sameItemsOnly,
            tolerance: settings.deltaTolerance,
          });
        } catch (apiErr: any) {
          if (apiErr?.code === "NOT_COMPARABLE" || apiErr?.status === 422) {
            setCompareResult(null);
            setNotComparableError({
              shortReason:
                apiErr.shortReason ||
                "Reports do not meet compatibility criteria",
              checks: apiErr.checks || [],
            });
            return;
          }
          res = await compareSnapshotsLocal(batchId, idA, idB, {
            tolerance: settings.deltaTolerance,
            sameItems: sameItemsOnly,
          });
        }
      } else {
        res = await compareSnapshotsLocal(batchId, idA, idB, {
          tolerance: settings.deltaTolerance,
          sameItems: sameItemsOnly,
        });
      }

      if (!res.isComparable) {
        setCompareResult(null);
        setNotComparableError({
          shortReason: res.shortReason || "Reports are incompatible",
          checks: res.checks || [],
        });
      } else {
        setCompareResult(res);
        setNotComparableError(null);
      }
    } catch (err: any) {
      setCompareResult(null);
      setNotComparableError({
        shortReason: err.message || "Comparison failed",
        checks: [],
      });
    } finally {
      setIsComparing(false);
    }
  };

  useEffect(() => {
    if (leftId && rightId && leftId !== rightId) {
      runComparison(leftId, rightId, sameItems);
    }
  }, [leftId, rightId, sameItems, batchId]);

  // Extract batch display code (e.g. "AFSD · Code B49")
  const currentBatchObj = batchSnapshots[0];
  const batchNameStr = currentBatchObj?.batchId
    ? currentBatchObj.batchId
    : "Unknown";
  const detectedCode = "Uknown";

  const handleExportCsv = () => {
    if (compareResult?.sharedData) {
      downloadComparisonCsv(compareResult.sharedData);
    }
  };

  return (
    <div className="space-y-6 text-[#14162b] dark:text-[#f1f3fa]">
      {/* 1. Page Header & Pickers Controls */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
        <div>
          <div className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider mb-1">
            Batch {batchNameStr} · Code {detectedCode}
          </div>
          <h1 className="text-3xl font-extrabold tracking-tight text-[#14162b] dark:text-[#f1f3fa] font-sans">
            Cohort comparison
          </h1>
          <p className="text-xs text-muted-foreground mt-1 max-w-2xl leading-relaxed">
            See how assignments, content and attendance changed between two
            report snapshots. Choose a baseline and a current report, then
            compare.
          </p>
        </div>

        {/* Pickers & Compare Button */}
        <div className="flex flex-wrap sm:flex-nowrap items-center gap-2.5">
          <select
            value={leftId}
            onChange={(e) => setLeftId(e.target.value)}
            aria-label="Baseline Report Picker"
            className="text-xs font-mono font-medium border border-[#e3e5ef] dark:border-[#282c40] rounded-lg px-3 py-2 bg-[#fdfdff] dark:bg-[#181b2a] text-[#14162b] dark:text-[#f1f3fa] focus:ring-2 focus:ring-[#4338ca] outline-none cursor-pointer"
          >
            {batchSnapshots.map((s) => (
              <option key={s.id} value={s.id}>
                {s.snapshotDate} · {s.fileName || "Report.xlsx"}
              </option>
            ))}
          </select>

          <span className="text-muted-foreground text-xs font-mono select-none">
            →
          </span>

          <select
            value={rightId}
            onChange={(e) => setRightId(e.target.value)}
            aria-label="Current Report Picker"
            className="text-xs font-mono font-medium border border-[#e3e5ef] dark:border-[#282c40] rounded-lg px-3 py-2 bg-[#fdfdff] dark:bg-[#181b2a] text-[#14162b] dark:text-[#f1f3fa] focus:ring-2 focus:ring-[#4338ca] outline-none cursor-pointer"
          >
            {batchSnapshots.map((s) => (
              <option key={s.id} value={s.id}>
                {s.snapshotDate} · {s.fileName || "Report.xlsx"}
              </option>
            ))}
          </select>

          <button
            type="button"
            onClick={() => runComparison(leftId, rightId, sameItems)}
            disabled={leftId === rightId || isComparing}
            className="px-4 py-2 bg-[#4338ca] hover:bg-[#3730a3] disabled:opacity-50 text-white text-xs font-semibold rounded-lg shadow-xs transition-colors cursor-pointer shrink-0 whitespace-nowrap"
          >
            {isComparing ? "Comparing..." : "Compare"}
          </button>
        </div>
      </div>

      {leftId === rightId && (
        <div className="p-3 bg-amber-500/10 border border-amber-500/30 rounded-xl text-xs text-amber-700 dark:text-amber-400 flex items-center gap-2">
          <AlertTriangle className="w-4 h-4 shrink-0" />
          <span>
            Select two different report dates to compare cohort progress.
          </span>
        </div>
      )}

      {/* Incompatibility / Error State */}
      {notComparableError && (
        <div className="p-5 border border-rose-300 dark:border-rose-900/50 bg-rose-50/60 dark:bg-rose-950/20 rounded-2xl space-y-3">
          <div className="flex items-start justify-between">
            <div className="flex items-start gap-3">
              <AlertCircle className="w-5 h-5 text-rose-600 dark:text-rose-400 shrink-0 mt-0.5" />
              <div>
                <h4 className="text-xs font-bold text-rose-700 dark:text-rose-300">
                  Reports cannot be compared
                </h4>
                <p className="text-xs text-rose-600 dark:text-rose-400 mt-0.5">
                  {notComparableError.shortReason}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={() => runComparison(leftId, rightId, sameItems)}
                className="text-xs px-2.5 py-1 bg-white dark:bg-[#181b2a] border border-rose-300 dark:border-rose-800 rounded-md text-rose-700 dark:text-rose-300 hover:bg-rose-50 flex items-center gap-1 font-medium"
              >
                <RotateCcw className="w-3 h-3" /> Retry
              </button>
              {notComparableError.checks.length > 0 && (
                <button
                  onClick={() => setShowFailedChecks(!showFailedChecks)}
                  className="text-xs text-rose-700 dark:text-rose-300 hover:underline flex items-center gap-1 font-medium"
                >
                  {showFailedChecks ? "Hide Details" : "View Details"}
                  {showFailedChecks ? (
                    <ChevronUp className="w-3.5 h-3.5" />
                  ) : (
                    <ChevronDown className="w-3.5 h-3.5" />
                  )}
                </button>
              )}
            </div>
          </div>

          {showFailedChecks && notComparableError.checks.length > 0 && (
            <div className="pt-3 border-t border-rose-200 dark:border-rose-900/40 space-y-2">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs">
                {notComparableError.checks.map((c, i) => (
                  <div
                    key={i}
                    className={`p-2.5 rounded-lg border flex items-start gap-2 ${
                      c.passed
                        ? "bg-emerald-500/5 border-emerald-500/20 text-emerald-700 dark:text-emerald-300"
                        : "bg-rose-500/10 border-rose-500/30 text-rose-700 dark:text-rose-300"
                    }`}
                  >
                    {c.passed ? (
                      <CheckCircle2 className="w-4 h-4 text-emerald-600 dark:text-emerald-400 shrink-0 mt-0.5" />
                    ) : (
                      <XCircle className="w-4 h-4 text-rose-600 dark:text-rose-400 shrink-0 mt-0.5" />
                    )}
                    <div>
                      <p className="font-semibold text-xs">{c.name}</p>
                      <p className="text-[11px] opacity-90 mt-0.5">
                        {c.detail}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Loading Skeleton */}
      {isComparing && (
        <div className="space-y-4 animate-pulse">
          <div className="h-10 bg-muted/40 rounded-xl" />
          <div className="h-40 bg-muted/40 rounded-2xl" />
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <div className="h-64 bg-muted/40 rounded-2xl" />
            <div className="h-64 bg-muted/40 rounded-2xl" />
          </div>
        </div>
      )}

      {/* Comparison Successful View */}
      {compareResult && compareResult.isComparable && !isComparing && (
        <div className="space-y-6">
          {/* 2. Metadata Row: Dates, Mode Switch, Export CSV */}
          <div className="space-y-2">
            <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 text-xs">
              <div className="flex flex-wrap items-center gap-2 text-xs">
                <span className="font-semibold text-foreground">
                  Baseline{" "}
                  <span className="font-mono text-muted-foreground">
                    {compareResult.fromSnapshotDate}
                  </span>
                </span>
                <span className="text-muted-foreground font-mono">→</span>
                <span className="font-semibold text-foreground">
                  Current{" "}
                  <span className="font-mono text-muted-foreground">
                    {compareResult.toSnapshotDate}
                  </span>
                </span>
                {compareResult.daysGap !== undefined && (
                  <span className="px-2.5 py-0.5 rounded-full bg-[#eef2ff] text-[#4338ca] dark:bg-[#312e81]/30 dark:text-[#a5b4fc] font-medium text-[11px] num">
                    {compareResult.daysGap} days apart
                  </span>
                )}
              </div>

              <div className="flex items-center gap-3">
                {/* Segmented Mode Toggle */}
                <div className="inline-flex rounded-lg border border-[#e3e5ef] dark:border-[#282c40] bg-[#fdfdff] dark:bg-[#181b2a] p-0.5 text-xs shadow-2xs">
                  <button
                    type="button"
                    onClick={() => setSameItems(false)}
                    className={`px-3 py-1 rounded-md font-medium text-xs transition-all cursor-pointer ${
                      !sameItems
                        ? "bg-[#4338ca] text-white shadow-xs font-semibold"
                        : "text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    Reported values
                  </button>
                  <button
                    type="button"
                    onClick={() => setSameItems(true)}
                    className={`px-3 py-1 rounded-md font-medium text-xs transition-all cursor-pointer ${
                      sameItems
                        ? "bg-[#4338ca] text-white shadow-xs font-semibold"
                        : "text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    Same items only
                  </button>
                </div>

                {/* Export CSV Button */}
                <button
                  type="button"
                  onClick={handleExportCsv}
                  className="inline-flex items-center gap-1.5 px-3 py-1 text-xs font-medium border border-[#e3e5ef] dark:border-[#282c40] rounded-lg bg-[#fdfdff] dark:bg-[#181b2a] text-[#14162b] dark:text-[#f1f3fa] hover:bg-muted/40 transition-colors cursor-pointer shadow-2xs"
                >
                  <Download className="w-3.5 h-3.5 text-muted-foreground" />
                  Export CSV
                </button>
              </div>
            </div>

            {/* Curriculum Notice */}
            {compareResult.sharedData?.metadata?.curriculumNotice && (
              <p className="text-[11px] text-muted-foreground italic">
                {compareResult.sharedData.metadata.curriculumNotice}
              </p>
            )}
          </div>

          {/* 3. KPI Area: Single Surface with Hairline Dividers */}
          {compareResult.sharedData && (
            <div className="bg-[#fdfdff] dark:bg-[#181b2a] border border-[#e3e5ef] dark:border-[#282c40] rounded-2xl p-6 shadow-xs">
              <div className="grid grid-cols-1 md:grid-cols-12 divide-y md:divide-y-0 md:divide-x divide-[#e3e5ef] dark:divide-[#282c40]">
                {/* Metric 1: Assignment Submission (Primary - most space) */}
                <div className="md:col-span-5 pr-0 md:pr-6 pb-6 md:pb-0 space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-semibold text-muted-foreground">
                      Assignment submission
                    </span>
                    <DeltaPill
                      delta={
                        compareResult.sharedData.metrics.assignmentSubmission
                          .deltaDisplay
                      }
                    />
                  </div>

                  <div className="flex items-baseline gap-2">
                    <span className="text-4xl font-black text-[#14162b] dark:text-[#f1f3fa] num tracking-tight">
                      {
                        compareResult.sharedData.metrics.assignmentSubmission
                          .currentDisplay
                      }
                      %
                    </span>
                    <span className="text-xs text-muted-foreground font-medium num">
                      from{" "}
                      {
                        compareResult.sharedData.metrics.assignmentSubmission
                          .baselineDisplay
                      }
                      %
                    </span>
                  </div>

                  {/* Progress track */}
                  <div className="w-full bg-[#f4f5fa] dark:bg-muted/30 h-1.5 rounded-full overflow-hidden">
                    <div
                      className="bg-[#4338ca] h-full rounded-full transition-all duration-300"
                      style={{
                        width: `${Math.min(100, Math.max(0, compareResult.sharedData.metrics.assignmentSubmission.currentDisplay))}%`,
                      }}
                    />
                  </div>

                  <div className="pt-2 text-xs text-muted-foreground flex flex-col gap-1">
                    <div className="flex items-center justify-between text-[11px]">
                      <span>Median</span>
                      <span className="num font-semibold text-foreground">
                        {
                          compareResult.sharedData.metrics.assignmentSubmission
                            .baselineMedian
                        }
                        % →{" "}
                        {
                          compareResult.sharedData.metrics.assignmentSubmission
                            .currentMedian
                        }
                        %
                      </span>
                    </div>
                    <p className="text-[11px] text-muted-foreground">
                      Cohort-wide completion across assigned tasks
                    </p>
                  </div>
                </div>

                {/* Metric 2: Content Consumption */}
                <div className="md:col-span-3 px-0 md:px-6 py-6 md:py-0 space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-semibold text-muted-foreground">
                      Content consumption
                    </span>
                    <DeltaPill
                      delta={
                        compareResult.sharedData.metrics.contentConsumption
                          .deltaDisplay
                      }
                    />
                  </div>

                  <div className="flex items-baseline gap-2">
                    <span className="text-3xl font-extrabold text-[#14162b] dark:text-[#f1f3fa] num tracking-tight">
                      {
                        compareResult.sharedData.metrics.contentConsumption
                          .currentDisplay
                      }
                      %
                    </span>
                    <span className="text-xs text-muted-foreground font-medium num">
                      from{" "}
                      {
                        compareResult.sharedData.metrics.contentConsumption
                          .baselineDisplay
                      }
                      %
                    </span>
                  </div>

                  {/* Progress track */}
                  <div className="w-full bg-[#f4f5fa] dark:bg-muted/30 h-1.5 rounded-full overflow-hidden">
                    <div
                      className="bg-[#4338ca] h-full rounded-full transition-all duration-300"
                      style={{
                        width: `${Math.min(100, Math.max(0, compareResult.sharedData.metrics.contentConsumption.currentDisplay))}%`,
                      }}
                    />
                  </div>

                  <div className="pt-2 text-xs text-muted-foreground flex flex-col gap-1">
                    <div className="flex items-center justify-between text-[11px]">
                      <span>Median</span>
                      <span className="num font-semibold text-foreground">
                        {
                          compareResult.sharedData.metrics.contentConsumption
                            .baselineMedian
                        }
                        % →{" "}
                        {
                          compareResult.sharedData.metrics.contentConsumption
                            .currentMedian
                        }
                        %
                      </span>
                    </div>
                    <p className="text-[11px] text-muted-foreground">
                      Video, reading and module progress
                    </p>
                  </div>
                </div>

                {/* Metric 3: Session Attendance */}
                <div className="md:col-span-4 pl-0 md:pl-6 pt-6 md:pt-0 space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-semibold text-muted-foreground">
                      Session attendance
                    </span>
                    <DeltaPill
                      delta={
                        compareResult.sharedData.metrics.liveAttendance
                          .deltaDisplay
                      }
                    />
                  </div>

                  <div className="flex items-baseline gap-2">
                    <span className="text-3xl font-extrabold text-[#14162b] dark:text-[#f1f3fa] num tracking-tight">
                      {
                        compareResult.sharedData.metrics.liveAttendance
                          .currentDisplay
                      }
                      %
                    </span>
                    <span className="text-xs text-muted-foreground font-medium num">
                      from{" "}
                      {
                        compareResult.sharedData.metrics.liveAttendance
                          .baselineDisplay
                      }
                      %
                    </span>
                  </div>

                  {/* Progress track */}
                  <div className="w-full bg-[#f4f5fa] dark:bg-muted/30 h-1.5 rounded-full overflow-hidden">
                    <div
                      className="bg-[#4338ca] h-full rounded-full transition-all duration-300"
                      style={{
                        width: `${Math.min(100, Math.max(0, compareResult.sharedData.metrics.liveAttendance.currentDisplay))}%`,
                      }}
                    />
                  </div>

                  <div className="pt-2 text-xs text-muted-foreground flex flex-col gap-1">
                    <div className="flex items-center justify-between text-[11px]">
                      <span>Live + recording</span>
                      <span className="num font-semibold text-foreground">
                        {
                          compareResult.sharedData.metrics.attendance
                            .baselineDisplay
                        }
                        % →{" "}
                        {
                          compareResult.sharedData.metrics.attendance
                            .currentDisplay
                        }
                        %
                      </span>
                    </div>
                    <div className="flex items-center justify-between text-[11px]">
                      <span>Median</span>
                      <span className="num font-semibold text-foreground">
                        {
                          compareResult.sharedData.metrics.attendance
                            .baselineMedian
                        }
                        % →{" "}
                        {
                          compareResult.sharedData.metrics.attendance
                            .currentMedian
                        }
                        %
                      </span>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* 4. Key Takeaways: Plain List with Small Dot Markers */}
          {compareResult.sharedData?.takeaways && (
            <div className="space-y-2">
              <h4 className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">
                Key takeaways
              </h4>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                {compareResult.sharedData.takeaways.map((item, idx) => (
                  <div
                    key={idx}
                    className="flex items-start gap-2.5 text-xs text-foreground/90 leading-relaxed"
                  >
                    <span
                      className="w-2 h-2 rounded-full shrink-0 mt-1.5"
                      style={{ backgroundColor: item.color }}
                    />
                    <span>{item.text}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* 5. Sub-Tabs */}
          <div className="space-y-4">
            <div className="flex items-center gap-1 border-b border-[#e3e5ef] dark:border-[#282c40] pb-1 text-xs overflow-x-auto">
              {[
                { key: "summary", label: "Summary & distributions" },
                {
                  key: "learners",
                  label: `Learners ${compareResult.sharedData?.counts?.learnersCount || 31}`,
                },
                {
                  key: "assignments",
                  label: `Assignments ${compareResult.sharedData?.counts?.assignmentsCount || 5}`,
                },
                {
                  key: "content",
                  label: `Content weeks ${compareResult.sharedData?.counts?.contentWeeksCount || 12}`,
                },
                {
                  key: "attendance",
                  label: `Attendance ${compareResult.sharedData?.counts?.attendanceSessionsCount || 34}`,
                },
              ].map((tab) => (
                <button
                  key={tab.key}
                  onClick={() => setActiveSubTab(tab.key as any)}
                  className={`px-3 py-1.5 rounded-lg font-medium transition-colors cursor-pointer whitespace-nowrap ${
                    activeSubTab === tab.key
                      ? "bg-[#4338ca]/10 text-[#4338ca] font-semibold"
                      : "text-muted-foreground hover:text-foreground hover:bg-muted/30"
                  }`}
                >
                  {tab.label}
                </button>
              ))}
            </div>

            {/* TAB 1: SUMMARY & DISTRIBUTIONS */}
            {activeSubTab === "summary" && (
              <div className="space-y-4">
                {/* Row 1: Charts (Cohort Trajectory + Learner Composite Scatter) */}
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                  {/* Cohort Trajectory */}
                  <div className="bg-[#fdfdff] dark:bg-[#181b2a] border border-[#e3e5ef] dark:border-[#282c40] rounded-2xl p-5 space-y-3 shadow-xs">
                    <div className="flex items-center justify-between">
                      <h4 className="text-xs font-bold text-[#14162b] dark:text-[#f1f3fa]">
                        Cohort trajectory
                      </h4>
                      <span className="text-[11px] text-muted-foreground">
                        Percentage points
                      </span>
                    </div>

                    <div className="h-64">
                      <ResponsiveContainer width="100%" height="100%">
                        <BarChart
                          data={[
                            {
                              name: "Assignments",
                              Baseline:
                                compareResult.metrics?.assignmentSubmission
                                  ?.leftAvg || 0,
                              Current:
                                compareResult.metrics?.assignmentSubmission
                                  ?.rightAvg || 0,
                            },
                            {
                              name: "Content",
                              Baseline:
                                compareResult.metrics?.contentConsumption
                                  ?.leftAvg || 0,
                              Current:
                                compareResult.metrics?.contentConsumption
                                  ?.rightAvg || 0,
                            },
                            {
                              name: "Live class",
                              Baseline:
                                compareResult.metrics?.liveAttendance
                                  ?.leftAvg || 0,
                              Current:
                                compareResult.metrics?.liveAttendance
                                  ?.rightAvg || 0,
                            },
                            {
                              name: "Live + rec",
                              Baseline:
                                compareResult.metrics?.attendance?.leftAvg || 0,
                              Current:
                                compareResult.metrics?.attendance?.rightAvg ||
                                0,
                            },
                          ]}
                          margin={{ top: 10, right: 10, left: -20, bottom: 0 }}
                        >
                          <CartesianGrid
                            strokeDasharray="3 3"
                            opacity={0.2}
                            vertical={false}
                          />
                          <XAxis dataKey="name" tick={{ fontSize: 11 }} />
                          <YAxis domain={[0, 100]} tick={{ fontSize: 11 }} />
                          <Tooltip />
                          <Legend
                            wrapperStyle={{ fontSize: 11, paddingTop: 10 }}
                          />
                          <Bar
                            dataKey="Baseline"
                            fill="#94a3b8"
                            radius={[4, 4, 0, 0]}
                          />
                          <Bar
                            dataKey="Current"
                            fill="#4338ca"
                            radius={[4, 4, 0, 0]}
                          />
                        </BarChart>
                      </ResponsiveContainer>
                    </div>
                  </div>

                  {/* Learner Composite Scatter Plot */}
                  <div className="bg-[#fdfdff] dark:bg-[#181b2a] border border-[#e3e5ef] dark:border-[#282c40] rounded-2xl p-5 space-y-3 shadow-xs">
                    <div className="flex items-center justify-between">
                      <h4 className="text-xs font-bold text-[#14162b] dark:text-[#f1f3fa]">
                        Learner composite
                      </h4>
                      <span className="text-[11px] text-muted-foreground">
                        Dashed line = no change
                      </span>
                    </div>

                    <div className="h-64">
                      <ResponsiveContainer width="100%" height="100%">
                        <ScatterChart
                          margin={{ top: 10, right: 20, bottom: 25, left: -20 }}
                        >
                          <CartesianGrid strokeDasharray="3 3" opacity={0.2} />
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
                            cursor={{ strokeDasharray: "3 3" }}
                            formatter={(val: any) => [`${val}%`, ""]}
                            labelFormatter={(_label, payload) => {
                              const d = payload?.[0]?.payload;
                              return d
                                ? `${d.name} (${d.status}: ${d.compositeChange >= 0 ? "+" : ""}${d.compositeChange} pp)`
                                : "";
                            }}
                          />
                          <ReferenceLine
                            segment={[
                              { x: 0, y: 0 },
                              { x: 100, y: 100 },
                            ]}
                            stroke="#94a3b8"
                            strokeWidth={1.5}
                            strokeDasharray="4 4"
                          />
                          <Scatter
                            data={compareResult.learnerComparisons || []}
                          >
                            {(compareResult.learnerComparisons || []).map(
                              (entry, index) => {
                                const color =
                                  entry.status === "Improved"
                                    ? "#10b981"
                                    : entry.status === "Declined"
                                      ? "#ef4444"
                                      : "#94a3b8";
                                return (
                                  <Cell key={`cell-${index}`} fill={color} />
                                );
                              },
                            )}
                          </Scatter>
                        </ScatterChart>
                      </ResponsiveContainer>
                    </div>

                    {/* Custom Legend */}
                    <div className="flex items-center justify-center gap-4 text-[11px] text-muted-foreground pt-1">
                      <span className="flex items-center gap-1.5">
                        <span className="w-2 h-2 rounded-full bg-[#ef4444]" />
                        Declined
                      </span>
                      <span className="flex items-center gap-1.5">
                        <span className="w-2 h-2 rounded-full bg-[#94a3b8]" />
                        Flat
                      </span>
                      <span className="flex items-center gap-1.5">
                        <span className="w-2 h-2 rounded-full bg-[#10b981]" />
                        Improved
                      </span>
                    </div>
                  </div>
                </div>

                {/* Row 2: Segment Migration + At-Risk Transitions */}
                <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
                  {/* Segment Migration Table */}
                  <div className="lg:col-span-8 bg-[#fdfdff] dark:bg-[#181b2a] border border-[#e3e5ef] dark:border-[#282c40] rounded-2xl p-5 space-y-3 shadow-xs">
                    <div className="flex items-center justify-between">
                      <h4 className="text-xs font-bold text-[#14162b] dark:text-[#f1f3fa]">
                        Segment migration
                      </h4>
                      <span className="text-[11px] text-muted-foreground font-medium">
                        {compareResult.segmentMatrix?.movedUp || 0} up ·{" "}
                        {compareResult.segmentMatrix?.unchanged || 0} held ·{" "}
                        {compareResult.segmentMatrix?.movedDown || 0} down
                      </span>
                    </div>

                    <div className="overflow-x-auto">
                      <table className="w-full text-center text-xs border-collapse">
                        <thead>
                          <tr>
                            <th className="p-2.5 border border-[#e3e5ef] dark:border-[#282c40] bg-[#f4f5fa] dark:bg-muted/10 text-muted-foreground font-medium text-[11px] text-left">
                              Baseline \ Current
                            </th>
                            <th className="p-2.5 border border-[#e3e5ef] dark:border-[#282c40] bg-[#f4f5fa] dark:bg-muted/10 font-semibold text-foreground">
                              High ≥80%
                            </th>
                            <th className="p-2.5 border border-[#e3e5ef] dark:border-[#282c40] bg-[#f4f5fa] dark:bg-muted/10 font-semibold text-foreground">
                              Medium 50-79%
                            </th>
                            <th className="p-2.5 border border-[#e3e5ef] dark:border-[#282c40] bg-[#f4f5fa] dark:bg-muted/10 font-semibold text-foreground">
                              Low &lt;50%
                            </th>
                          </tr>
                        </thead>
                        <tbody>
                          {(["High", "Medium", "Low"] as const).map(
                            (fromSeg) => (
                              <tr key={fromSeg}>
                                <td className="p-2.5 border border-[#e3e5ef] dark:border-[#282c40] font-semibold text-left bg-[#f4f5fa]/50 dark:bg-muted/5">
                                  {fromSeg}
                                </td>
                                {(["High", "Medium", "Low"] as const).map(
                                  (toSeg) => {
                                    const count =
                                      compareResult.segmentMatrix?.matrix?.[
                                        fromSeg
                                      ]?.[toSeg] || 0;
                                    const isUpgrade =
                                      (fromSeg === "Low" &&
                                        (toSeg === "Medium" ||
                                          toSeg === "High")) ||
                                      (fromSeg === "Medium" &&
                                        toSeg === "High");
                                    const isDowngrade =
                                      (fromSeg === "High" &&
                                        (toSeg === "Medium" ||
                                          toSeg === "Low")) ||
                                      (fromSeg === "Medium" && toSeg === "Low");

                                    const cellBg = isUpgrade
                                      ? "bg-[#ecfdf5] dark:bg-[#064e3b]/30 text-[#065f46] dark:text-[#6ee7b7] font-bold"
                                      : isDowngrade
                                        ? "bg-[#fef2f2] dark:bg-[#7f1d1d]/30 text-[#991b1b] dark:text-[#fca5a5] font-bold"
                                        : "text-foreground font-medium";

                                    return (
                                      <td
                                        key={toSeg}
                                        className={`p-2.5 border border-[#e3e5ef] dark:border-[#282c40] num ${cellBg}`}
                                      >
                                        {count}
                                      </td>
                                    );
                                  },
                                )}
                              </tr>
                            ),
                          )}
                        </tbody>
                      </table>
                    </div>

                    <div className="flex items-center gap-3 text-[11px] text-muted-foreground pt-1">
                      <span className="flex items-center gap-1.5">
                        <span className="w-2.5 h-2.5 rounded-sm bg-[#ecfdf5] dark:bg-[#064e3b] border border-emerald-300 dark:border-emerald-700" />
                        Moved up
                      </span>
                      <span className="flex items-center gap-1.5">
                        <span className="w-2.5 h-2.5 rounded-sm bg-[#fef2f2] dark:bg-[#7f1d1d] border border-rose-300 dark:border-rose-700" />
                        Moved down
                      </span>
                    </div>
                  </div>

                  {/* At-Risk Transitions Summary */}
                  <div className="lg:col-span-4 bg-[#fdfdff] dark:bg-[#181b2a] border border-[#e3e5ef] dark:border-[#282c40] rounded-2xl p-5 space-y-4 shadow-xs">
                    <h4 className="text-xs font-bold text-[#14162b] dark:text-[#f1f3fa]">
                      At-risk transitions
                    </h4>

                    <div className="space-y-3 text-xs">
                      <div className="flex items-start justify-between pb-2 border-b border-[#e3e5ef] dark:border-[#282c40]">
                        <div>
                          <p className="font-semibold text-foreground">
                            Newly at-risk
                          </p>
                          <p className="text-[10px] text-muted-foreground mt-0.5">
                            Fell below 50% assignment or critical composite
                          </p>
                        </div>
                        <span className="text-xl font-black text-rose-600 dark:text-rose-400 num">
                          {compareResult.atRiskMovement?.newlyAtRisk?.length ||
                            0}
                        </span>
                      </div>

                      <div className="flex items-start justify-between pb-2 border-b border-[#e3e5ef] dark:border-[#282c40]">
                        <div>
                          <p className="font-semibold text-foreground">
                            Recovered
                          </p>
                          <p className="text-[10px] text-muted-foreground mt-0.5">
                            Moved out of the critical zone
                          </p>
                        </div>
                        <span className="text-xl font-black text-emerald-600 dark:text-emerald-400 num">
                          {compareResult.atRiskMovement?.recovered?.length || 0}
                        </span>
                      </div>

                      <div className="flex items-start justify-between">
                        <div>
                          <p className="font-semibold text-foreground">
                            Persistent
                          </p>
                          <p className="text-[10px] text-muted-foreground mt-0.5">
                            Critical in both snapshots
                          </p>
                        </div>
                        <span className="text-xl font-black text-amber-600 dark:text-amber-400 num">
                          {compareResult.atRiskMovement?.stillAtRisk?.length ||
                            0}
                        </span>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Row 3: Top Improvers & Top Decliners */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {/* Top Improvers */}
                  <div className="bg-[#fdfdff] dark:bg-[#181b2a] border border-[#e3e5ef] dark:border-[#282c40] rounded-2xl p-5 space-y-3 shadow-xs">
                    <h4 className="text-xs font-bold text-foreground">
                      Top improvers
                    </h4>

                    {!compareResult.topImprovers ||
                    compareResult.topImprovers.length === 0 ? (
                      <p className="text-xs text-muted-foreground italic py-3">
                        No students improved beyond the tolerance threshold
                        during this period.
                      </p>
                    ) : (
                      <div className="space-y-2">
                        {compareResult.topImprovers.map((imp) => (
                          <div
                            key={imp.studentId}
                            onClick={() => {
                              setSelectedStudentId(imp.studentId);
                              setActiveTab("students");
                            }}
                            className="flex items-center justify-between p-2 rounded-xl hover:bg-muted/30 transition-colors cursor-pointer"
                          >
                            <div className="flex items-center gap-2.5">
                              <div className="w-8 h-8 rounded-lg bg-muted flex items-center justify-center text-xs font-bold text-muted-foreground">
                                {imp.name.slice(0, 2).toUpperCase()}
                              </div>
                              <div>
                                <p className="text-xs font-semibold text-foreground">
                                  {imp.name}
                                </p>
                                <p className="text-[11px] text-muted-foreground font-mono">
                                  {imp.phoneE164}
                                </p>
                              </div>
                            </div>
                            <span className="text-xs font-bold text-emerald-600 dark:text-emerald-400 num">
                              +{imp.deltaPts} pp
                            </span>
                          </div>
                        ))}
                        <p className="text-[11px] text-muted-foreground pt-1">
                          {compareResult.topImprovers.length === 1
                            ? "Only one learner improved this period."
                            : compareResult.topImprovers.length === 2
                              ? "Only two learners improved this period."
                              : `${compareResult.topImprovers.length} learners improved this period.`}
                        </p>
                      </div>
                    )}
                  </div>

                  {/* Top Decliners */}
                  <div className="bg-[#fdfdff] dark:bg-[#181b2a] border border-[#e3e5ef] dark:border-[#282c40] rounded-2xl p-5 space-y-3 shadow-xs">
                    <h4 className="text-xs font-bold text-foreground">
                      Top decliners
                    </h4>

                    {!compareResult.topDecliners ||
                    compareResult.topDecliners.length === 0 ? (
                      <p className="text-xs text-muted-foreground italic py-3">
                        No students declined beyond the tolerance threshold
                        during this period.
                      </p>
                    ) : (
                      <div className="space-y-2">
                        {compareResult.topDecliners.map((dec) => (
                          <div
                            key={dec.studentId}
                            onClick={() => {
                              setSelectedStudentId(dec.studentId);
                              setActiveTab("students");
                            }}
                            className="flex items-center justify-between p-2 rounded-xl hover:bg-muted/30 transition-colors cursor-pointer"
                          >
                            <div className="flex items-center gap-2.5">
                              <div className="w-8 h-8 rounded-lg bg-muted flex items-center justify-center text-xs font-bold text-muted-foreground">
                                {dec.name.slice(0, 2).toUpperCase()}
                              </div>
                              <div>
                                <p className="text-xs font-semibold text-foreground">
                                  {dec.name}
                                </p>
                                <p className="text-[11px] text-muted-foreground font-mono">
                                  {dec.phoneE164}
                                </p>
                              </div>
                            </div>
                            <span className="text-xs font-bold text-rose-600 dark:text-rose-400 num">
                              {dec.deltaPts} pp
                            </span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            )}

            {/* TAB 2: LEARNERS */}
            {activeSubTab === "learners" && (
              <LearnersComparisonTab
                learners={compareResult.learnerComparisons || []}
                onSelectStudent={(id) => {
                  setSelectedStudentId(id);
                  setActiveTab("students");
                }}
              />
            )}

            {/* TAB 3: ASSIGNMENTS */}
            {activeSubTab === "assignments" && (
              <AssignmentsComparisonTab
                items={compareResult.assignmentComparison || []}
              />
            )}

            {/* TAB 4: CONTENT */}
            {activeSubTab === "content" && (
              <ContentComparisonTab
                items={compareResult.contentComparison || []}
              />
            )}

            {/* TAB 5: ATTENDANCE */}
            {activeSubTab === "attendance" && (
              <AttendanceComparisonTab
                sessions={compareResult.sessionComparison || []}
              />
            )}
          </div>
        </div>
      )}

      {/* Footer */}
      <footer className="pt-8 pb-4 text-center text-xs text-muted-foreground flex flex-wrap items-center justify-center gap-4 border-t border-[#e3e5ef] dark:border-[#282c40]">
        <span>Student Progress Platform · Cohort analytics</span>
        <span>·</span>
        <a href="#privacy" className="hover:underline">
          Privacy
        </a>
        <span>·</span>
        <a href="#terms" className="hover:underline">
          Terms
        </a>
        <span>·</span>
        <button
          onClick={() => setShowHelpModal(true)}
          className="hover:underline cursor-pointer"
        >
          How to read this page
        </button>
      </footer>

      {/* "How to read this page" Modal */}
      {showHelpModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-background/80 backdrop-blur-sm animate-in fade-in duration-150">
          <Card className="max-w-lg w-full p-5 space-y-4 shadow-xl border border-border">
            <div className="flex items-center justify-between border-b border-border/60 pb-3">
              <h3 className="text-sm font-semibold text-foreground flex items-center gap-2">
                <Info className="w-4 h-4 text-[#4338ca]" />
                How to read cohort comparisons
              </h3>
              <button
                onClick={() => setShowHelpModal(false)}
                className="text-muted-foreground hover:text-foreground text-xs cursor-pointer"
              >
                ✕
              </button>
            </div>

            <div className="space-y-3 text-xs leading-relaxed text-muted-foreground">
              <p>
                <strong className="text-foreground">
                  Strict comparison rules:
                </strong>{" "}
                Reports are compared only if they belong to the exact same
                batch, have different report dates, share 100% of the same
                learners, and maintain continuous curriculum progression.
              </p>
              <p>
                <strong className="text-foreground">
                  Tolerance threshold (±{settings.deltaTolerance} pp):
                </strong>{" "}
                Learner changes within ±{settings.deltaTolerance} percentage
                points are categorized as{" "}
                <span className="font-semibold text-foreground">Same</span> to
                prevent overreacting to day-to-day noise.
              </p>
              <p>
                <strong className="text-foreground">Segment migration:</strong>{" "}
                High (≥80%), Medium (50-79%), and Low (&lt;50%). The 3x3 matrix
                tracks transitions between these brackets.
              </p>
              <p>
                <strong className="text-foreground">Fair comparison:</strong>{" "}
                "Reported values" shows current snapshot averages including
                newly added curriculum. "Same items only" isolates common
                assignments and sessions present in both snapshots.
              </p>
            </div>

            <div className="pt-2 flex justify-end">
              <Button
                size="sm"
                onClick={() => setShowHelpModal(false)}
                className="text-xs h-7 px-3 bg-[#4338ca] text-white"
              >
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
// Delta Pill Indicator
// --------------------------------------------------------------------------------------------------
const DeltaPill: React.FC<{ delta: number }> = ({ delta }) => {
  const isPositive = delta > 0;
  const isNegative = delta < 0;

  return (
    <span
      className={`px-2 py-0.5 rounded-full text-xs font-bold num inline-flex items-center gap-0.5 ${
        isPositive
          ? "text-emerald-600 dark:text-emerald-400"
          : isNegative
            ? "text-rose-600 dark:text-rose-400"
            : "text-muted-foreground"
      }`}
    >
      {isPositive ? (
        <ArrowUpRight className="w-3.5 h-3.5" />
      ) : isNegative ? (
        <ArrowDownRight className="w-3.5 h-3.5" />
      ) : (
        <Minus className="w-3.5 h-3.5" />
      )}
      {delta >= 0 ? `+${delta.toFixed(1)}` : delta.toFixed(1)} pp
    </span>
  );
};

// --------------------------------------------------------------------------------------------------
// Sub-Tab 2: Learners Detail Tab (Unmasked PII)
// --------------------------------------------------------------------------------------------------
interface LearnersComparisonTabProps {
  learners: NonNullable<StrictCompareResult["learnerComparisons"]>;
  onSelectStudent: (studentId: string) => void;
}

const LearnersComparisonTab: React.FC<LearnersComparisonTabProps> = ({
  learners,
  onSelectStudent,
}) => {
  const [filter, setFilter] = useState<
    "ALL" | "Improved" | "Same" | "Declined"
  >("ALL");
  const [query, setQuery] = useState("");

  const filtered = useMemo(() => {
    return learners.filter((l) => {
      if (filter !== "ALL" && l.status !== filter) return false;
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
    <div className="bg-[#fdfdff] dark:bg-[#181b2a] border border-[#e3e5ef] dark:border-[#282c40] rounded-2xl p-4 space-y-3 shadow-xs">
      {/* Search & Filter pills */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2.5">
        <div className="flex items-center gap-1.5 text-xs">
          {(["ALL", "Improved", "Same", "Declined"] as const).map((opt) => (
            <button
              key={opt}
              onClick={() => setFilter(opt)}
              className={`px-3 py-1 rounded-lg font-medium transition-colors cursor-pointer ${
                filter === opt
                  ? "bg-[#4338ca] text-white shadow-xs font-semibold"
                  : "text-muted-foreground hover:text-foreground bg-muted/40"
              }`}
            >
              {opt === "ALL" ? "All learners" : opt}
            </button>
          ))}
        </div>

        <div className="relative w-full sm:w-64">
          <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search learner name, ID, phone..."
            className="w-full text-xs pl-8 pr-3 py-1.5 rounded-lg border border-[#e3e5ef] dark:border-[#282c40] bg-background text-foreground focus:ring-2 focus:ring-[#4338ca] outline-none"
          />
        </div>
      </div>

      {/* Learners Table */}
      <div className="overflow-x-auto border border-[#e3e5ef] dark:border-[#282c40] rounded-xl">
        <table className="w-full text-xs text-left border-collapse">
          <thead>
            <tr className="bg-muted/20 border-b border-[#e3e5ef] dark:border-[#282c40] text-muted-foreground text-[11px] font-semibold">
              <th className="p-2.5">Learner</th>
              <th className="p-2.5">Segment migration</th>
              <th className="p-2.5 text-right">Composite change</th>
              <th className="p-2.5 text-right">Assignment Δ</th>
              <th className="p-2.5 text-right">Content Δ</th>
              <th className="p-2.5 text-right">Attendance Δ</th>
              <th className="p-2.5 text-center">Status</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[#e3e5ef] dark:divide-[#282c40]">
            {filtered.map((l) => (
              <tr
                key={l.studentId}
                onClick={() => onSelectStudent(l.studentId)}
                className="hover:bg-muted/30 cursor-pointer transition-colors"
              >
                <td className="p-2.5">
                  <p className="font-semibold text-foreground">{l.name}</p>
                  <p className="text-[10px] text-muted-foreground font-mono">
                    {l.phoneE164}
                  </p>
                </td>
                <td className="p-2.5">
                  <span className="font-medium text-[11px] text-muted-foreground">
                    {l.leftSegment} →{" "}
                    <strong className="text-foreground">
                      {l.rightSegment}
                    </strong>
                  </span>
                </td>
                <td className="p-2.5 text-right num font-semibold">
                  <span
                    className={
                      l.compositeChange > 0
                        ? "text-emerald-600 dark:text-emerald-400"
                        : l.compositeChange < 0
                          ? "text-rose-600 dark:text-rose-400"
                          : "text-muted-foreground"
                    }
                  >
                    {l.compositeChange >= 0
                      ? `+${l.compositeChange}`
                      : l.compositeChange}{" "}
                    pp
                  </span>
                </td>
                <td className="p-2.5 text-right num">
                  {l.assignmentDelta >= 0
                    ? `+${l.assignmentDelta}`
                    : l.assignmentDelta}{" "}
                  pp
                </td>
                <td className="p-2.5 text-right num">
                  {l.contentDelta >= 0 ? `+${l.contentDelta}` : l.contentDelta}{" "}
                  pp
                </td>
                <td className="p-2.5 text-right num">
                  {l.liveOrRecDelta >= 0
                    ? `+${l.liveOrRecDelta}`
                    : l.liveOrRecDelta}{" "}
                  pp
                </td>
                <td className="p-2.5 text-center">
                  <span
                    className={`inline-block px-2 py-0.5 rounded-md text-[10px] font-semibold ${
                      l.status === "Improved"
                        ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
                        : l.status === "Declined"
                          ? "bg-rose-500/10 text-rose-600 dark:text-rose-400"
                          : "bg-muted text-muted-foreground"
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
    </div>
  );
};

// --------------------------------------------------------------------------------------------------
// Sub-Tab 3: Assignments Comparison Tab
// --------------------------------------------------------------------------------------------------
const AssignmentsComparisonTab: React.FC<{
  items: NonNullable<StrictCompareResult["assignmentComparison"]>;
}> = ({ items }) => {
  const [showTableOnly, setShowTableOnly] = useState(false);

  return (
    <div className="bg-[#fdfdff] dark:bg-[#181b2a] border border-[#e3e5ef] dark:border-[#282c40] rounded-2xl p-5 space-y-3 shadow-xs">
      <div className="flex items-center justify-between">
        <h4 className="text-xs font-bold text-foreground">
          Assignment submission rates
        </h4>
        <Button
          variant="outline"
          size="sm"
          onClick={() => setShowTableOnly(!showTableOnly)}
          className="text-xs h-7 px-2.5 gap-1.5"
        >
          {showTableOnly ? (
            <BarChart3 className="w-3.5 h-3.5" />
          ) : (
            <TableIcon className="w-3.5 h-3.5" />
          )}
          {showTableOnly ? "Show chart" : "Show table"}
        </Button>
      </div>

      {!showTableOnly && (
        <div className="h-64">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart
              data={items.map((it) => ({
                name:
                  it.name.length > 20 ? it.name.slice(0, 18) + "..." : it.name,
                fullName: it.name,
                Baseline: it.leftSubmissionRate ?? 0,
                Current: it.rightSubmissionRate,
                isNew: it.isNew,
              }))}
              margin={{ top: 10, right: 10, left: -20, bottom: 40 }}
            >
              <CartesianGrid
                strokeDasharray="3 3"
                opacity={0.2}
                vertical={false}
              />
              <XAxis
                dataKey="name"
                angle={-30}
                textAnchor="end"
                interval={0}
                tick={{ fontSize: 10 }}
              />
              <YAxis domain={[0, 100]} tick={{ fontSize: 11 }} />
              <Tooltip />
              <Legend wrapperStyle={{ fontSize: 11 }} verticalAlign="top" />
              <Bar dataKey="Baseline" fill="#94a3b8" radius={[4, 4, 0, 0]} />
              <Bar dataKey="Current" fill="#4338ca" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}

      <div className="overflow-x-auto border border-[#e3e5ef] dark:border-[#282c40] rounded-xl">
        <table className="w-full text-xs text-left border-collapse">
          <thead>
            <tr className="bg-muted/20 border-b border-[#e3e5ef] dark:border-[#282c40] text-muted-foreground text-[11px] font-semibold">
              <th className="p-2.5">Assignment task</th>
              <th className="p-2.5 text-center">Status</th>
              <th className="p-2.5 text-right">Baseline rate</th>
              <th className="p-2.5 text-right">Current rate</th>
              <th className="p-2.5 text-right">Point change</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[#e3e5ef] dark:divide-[#282c40]">
            {items.map((it, i) => (
              <tr key={i} className="hover:bg-muted/20">
                <td className="p-2.5 font-medium text-foreground">{it.name}</td>
                <td className="p-2.5 text-center">
                  {it.isNew ? (
                    <span className="px-2 py-0.5 rounded-md bg-[#4338ca]/10 text-[#4338ca] font-bold text-[10px]">
                      New
                    </span>
                  ) : (
                    <span className="px-2 py-0.5 rounded-md bg-muted text-muted-foreground text-[10px]">
                      Existing
                    </span>
                  )}
                </td>
                <td className="p-2.5 text-right num text-muted-foreground">
                  {it.leftSubmissionRate !== null
                    ? `${it.leftSubmissionRate}%`
                    : "—"}
                </td>
                <td className="p-2.5 text-right num font-semibold text-foreground">
                  {it.rightSubmissionRate}%
                </td>
                <td className="p-2.5 text-right num font-semibold">
                  {it.deltaPts !== null ? (
                    <span
                      className={
                        it.deltaPts > 0
                          ? "text-emerald-600 dark:text-emerald-400"
                          : it.deltaPts < 0
                            ? "text-rose-600 dark:text-rose-400"
                            : "text-muted-foreground"
                      }
                    >
                      {it.deltaPts >= 0 ? `+${it.deltaPts}` : it.deltaPts} pp
                    </span>
                  ) : (
                    "—"
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
};

// --------------------------------------------------------------------------------------------------
// Sub-Tab 4: Content Comparison Tab
// --------------------------------------------------------------------------------------------------
const ContentComparisonTab: React.FC<{
  items: NonNullable<StrictCompareResult["contentComparison"]>;
}> = ({ items }) => {
  return (
    <div className="bg-[#fdfdff] dark:bg-[#181b2a] border border-[#e3e5ef] dark:border-[#282c40] rounded-2xl p-5 space-y-3 shadow-xs">
      <h4 className="text-xs font-bold text-foreground">
        Weekly content consumption progression
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
            <CartesianGrid
              strokeDasharray="3 3"
              opacity={0.2}
              vertical={false}
            />
            <XAxis dataKey="week" tick={{ fontSize: 11 }} />
            <YAxis domain={[0, 100]} tick={{ fontSize: 11 }} />
            <Tooltip />
            <Legend wrapperStyle={{ fontSize: 11 }} />
            <Bar dataKey="Baseline" fill="#94a3b8" radius={[4, 4, 0, 0]} />
            <Bar dataKey="Current" fill="#4338ca" radius={[4, 4, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>

      <div className="overflow-x-auto border border-[#e3e5ef] dark:border-[#282c40] rounded-xl">
        <table className="w-full text-xs text-left border-collapse">
          <thead>
            <tr className="bg-muted/20 border-b border-[#e3e5ef] dark:border-[#282c40] text-muted-foreground text-[11px] font-semibold">
              <th className="p-2.5">Week module</th>
              <th className="p-2.5 text-center">Status</th>
              <th className="p-2.5 text-right">Baseline consumption</th>
              <th className="p-2.5 text-right">Current consumption</th>
              <th className="p-2.5 text-right">Point change</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[#e3e5ef] dark:divide-[#282c40]">
            {items.map((w) => (
              <tr key={w.weekNo} className="hover:bg-muted/20">
                <td className="p-2.5 font-semibold text-foreground">
                  Week {w.weekNo}
                </td>
                <td className="p-2.5 text-center">
                  {w.isNew ? (
                    <span className="px-2 py-0.5 rounded-md bg-[#4338ca]/10 text-[#4338ca] font-bold text-[10px]">
                      New
                    </span>
                  ) : (
                    <span className="px-2 py-0.5 rounded-md bg-muted text-muted-foreground text-[10px]">
                      Existing
                    </span>
                  )}
                </td>
                <td className="p-2.5 text-right num text-muted-foreground">
                  {w.leftConsumedPct !== null ? `${w.leftConsumedPct}%` : "—"}
                </td>
                <td className="p-2.5 text-right num font-semibold text-foreground">
                  {w.rightConsumedPct}%
                </td>
                <td className="p-2.5 text-right num font-semibold">
                  {w.deltaPts !== null ? (
                    <span
                      className={
                        w.deltaPts > 0
                          ? "text-emerald-600 dark:text-emerald-400"
                          : w.deltaPts < 0
                            ? "text-rose-600 dark:text-rose-400"
                            : "text-muted-foreground"
                      }
                    >
                      {w.deltaPts >= 0 ? `+${w.deltaPts}` : w.deltaPts} pp
                    </span>
                  ) : (
                    "—"
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
};

// --------------------------------------------------------------------------------------------------
// Sub-Tab 5: Attendance Comparison Tab
// --------------------------------------------------------------------------------------------------
const AttendanceComparisonTab: React.FC<{
  sessions: NonNullable<StrictCompareResult["sessionComparison"]>;
}> = ({ sessions }) => {
  return (
    <div className="bg-[#fdfdff] dark:bg-[#181b2a] border border-[#e3e5ef] dark:border-[#282c40] rounded-2xl p-5 space-y-3 shadow-xs">
      <h4 className="text-xs font-bold text-foreground">
        Live and recorded attendance progression per session
      </h4>

      <div className="overflow-x-auto border border-[#e3e5ef] dark:border-[#282c40] rounded-xl">
        <table className="w-full text-xs text-left border-collapse">
          <thead>
            <tr className="bg-muted/20 border-b border-[#e3e5ef] dark:border-[#282c40] text-muted-foreground text-[11px] font-semibold">
              <th className="p-2.5">Session title</th>
              <th className="p-2.5">Date</th>
              <th className="p-2.5 text-center">Status</th>
              <th className="p-2.5 text-right">Live rate</th>
              <th className="p-2.5 text-right">Live + rec rate</th>
              <th className="p-2.5 text-right">Attendance Δ</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[#e3e5ef] dark:divide-[#282c40]">
            {sessions.map((s, i) => (
              <tr key={i} className="hover:bg-muted/20">
                <td className="p-2.5 font-medium text-foreground max-w-xs truncate">
                  {s.title}
                </td>
                <td className="p-2.5 text-muted-foreground num">
                  {s.date || "—"}
                </td>
                <td className="p-2.5 text-center">
                  {s.isNew ? (
                    <span className="px-2 py-0.5 rounded-md bg-[#4338ca]/10 text-[#4338ca] font-bold text-[10px]">
                      New
                    </span>
                  ) : (
                    <span className="px-2 py-0.5 rounded-md bg-muted text-muted-foreground text-[10px]">
                      Existing
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
                          ? "text-emerald-600 dark:text-emerald-400"
                          : s.liveRecDeltaPts < 0
                            ? "text-rose-600 dark:text-rose-400"
                            : "text-muted-foreground"
                      }
                    >
                      {s.liveRecDeltaPts >= 0
                        ? `+${s.liveRecDeltaPts}`
                        : s.liveRecDeltaPts}{" "}
                      pp
                    </span>
                  ) : (
                    "—"
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
};
