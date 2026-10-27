import React, { useState, useMemo } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { Card } from '@/ui/Card';
import { Button } from '@/ui/Button';
import { DeltaBadge, SegmentBadge } from '@/ui/Badge';
import { usePlatformStore } from '@/store/usePlatformStore';
import { formatStudentName } from '@/core/identity/mask';
import {
  computeSnapshotAggregate,
  computeBatchScorecards,
  identifyAtRiskStudents,
} from '@/core/analytics';
import type {
  Snapshot,
  StudentSnapshot,
  Student,
} from '@/types';
import {
  TrendingUp,
  Table as TableIcon,
  LineChart as ChartIcon,
  ArrowRight,
  BookOpen,
  Award,
  Video,
  UploadCloud,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
} from 'recharts';

interface OverviewDashboardProps {
  snapshots: Snapshot[];
  currentSnapshot: Snapshot;
  previousSnapshot: Snapshot | null;
  currentStudentSnapshots: StudentSnapshot[];
  previousStudentSnapshots: StudentSnapshot[];
  allStudentSnapshots: StudentSnapshot[];
  students: Student[];
}

export const OverviewDashboard: React.FC<OverviewDashboardProps> = ({
  snapshots,
  currentSnapshot,
  previousSnapshot,
  currentStudentSnapshots,
  previousStudentSnapshots,
  allStudentSnapshots,
  students,
}) => {
  const { settings, setActiveTab, setSelectedStudentId, setUploadModalOpen } = usePlatformStore(
    useShallow((s) => ({
      settings: s.settings,
      setActiveTab: s.setActiveTab,
      setSelectedStudentId: s.setSelectedStudentId,
      setUploadModalOpen: s.setUploadModalOpen,
    }))
  );
  const [showTrendTable, setShowTrendTable] = useState(false);
  const [showSegmentTable, setShowSegmentTable] = useState(false);

  const studentMap = useMemo(
    () => new Map<string, Student>(students.map((s) => [s.id, s])),
    [students]
  );

  // Compute aggregates for all snapshots in chronological order
  const sortedSnapshots = useMemo(() => {
    return [...snapshots].sort((a, b) => a.snapshotDate.localeCompare(b.snapshotDate));
  }, [snapshots]);

  const snapshotAggregates = useMemo(() => {
    return sortedSnapshots.map((snap) => {
      const studentSnaps = allStudentSnapshots.filter((s) => s.snapshotId === snap.id);
      return computeSnapshotAggregate(snap.id, snap.snapshotDate, studentSnaps);
    });
  }, [sortedSnapshots, allStudentSnapshots]);

  const currentAgg = useMemo(() => {
    return computeSnapshotAggregate(
      currentSnapshot.id,
      currentSnapshot.snapshotDate,
      currentStudentSnapshots
    );
  }, [currentSnapshot, currentStudentSnapshots]);

  const previousAgg = useMemo(() => {
    return previousSnapshot
      ? computeSnapshotAggregate(
          previousSnapshot.id,
          previousSnapshot.snapshotDate,
          previousStudentSnapshots
        )
      : null;
  }, [previousSnapshot, previousStudentSnapshots]);

  const scorecards = useMemo(() => {
    return computeBatchScorecards(currentAgg, previousAgg);
  }, [currentAgg, previousAgg]);

  // At-risk students
  const atRiskList = useMemo(() => {
    return identifyAtRiskStudents(currentStudentSnapshots, studentMap);
  }, [currentStudentSnapshots, studentMap]);

  // Calculate student-level deltas for Top Improvers
  const prevStudentMap = useMemo(() => {
    return new Map<string, StudentSnapshot>(
      previousStudentSnapshots.map((s) => [s.studentId, s])
    );
  }, [previousStudentSnapshots]);

  const studentDeltas = useMemo(() => {
    return currentStudentSnapshots
      .map((curr) => {
        const prev = prevStudentMap.get(curr.studentId);
        const student = studentMap.get(curr.studentId);
        const name = student?.name || curr.studentId;
        if (!prev) {
          return { studentId: curr.studentId, name, avgDelta: 0, current: curr };
        }
        const asgnDelta = curr.metrics.assignmentSubmissionPct - prev.metrics.assignmentSubmissionPct;
        const consDelta = curr.metrics.totalConsumptionPct - prev.metrics.totalConsumptionPct;
        const attDelta = curr.metrics.liveClassPct - prev.metrics.liveClassPct;
        const avgDelta = Number(((asgnDelta + consDelta + attDelta) / 3).toFixed(1));
        return { studentId: curr.studentId, name, avgDelta, current: curr };
      })
      .sort((a, b) => b.avgDelta - a.avgDelta);
  }, [currentStudentSnapshots, prevStudentMap, studentMap]);

  const topImprovers = useMemo(() => {
    return studentDeltas.filter((s) => s.avgDelta > 0).slice(0, 5);
  }, [studentDeltas]);

  // Sort at-risk by severity (more reasons first, then lower consumption)
  const sortedAtRiskList = useMemo(() => {
    return [...atRiskList].sort((a, b) => {
      if (b.reasons.length !== a.reasons.length) {
        return b.reasons.length - a.reasons.length;
      }
      return a.totalConsumptionPct - b.totalConsumptionPct;
    });
  }, [atRiskList]);

  const needsAttention = useMemo(() => sortedAtRiskList.slice(0, 5), [sortedAtRiskList]);

  return (
    <div className="space-y-8">
      {/* Top Row: Scorecards */}
      <section aria-labelledby="kpi-heading">
        <h2 id="kpi-heading" className="sr-only">Key performance indicators</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {/* Assignment Card */}
          <Card className="relative overflow-hidden">
            <div className="flex items-center justify-between text-muted-foreground mb-3">
              <span className="text-xs font-medium text-muted-foreground">
                Assignment submission
              </span>
              <div className="p-2 rounded-[8px] bg-secondary text-muted-foreground">
                <Award className="w-4 h-4" />
              </div>
            </div>
            <div className="flex items-baseline justify-between">
              <span className="text-3xl font-semibold text-foreground tracking-tight num">
                {scorecards.assignment.currentValue}%
              </span>
              <DeltaBadge delta={previousSnapshot ? scorecards.assignment.deltaPts : null} />
            </div>
          </Card>

          {/* Content Consumption Card */}
          <Card className="relative overflow-hidden">
            <div className="flex items-center justify-between text-muted-foreground mb-3">
              <span className="text-xs font-medium text-muted-foreground">
                Content consumption
              </span>
              <div className="p-2 rounded-[8px] bg-secondary text-muted-foreground">
                <BookOpen className="w-4 h-4" />
              </div>
            </div>
            <div className="flex items-baseline justify-between">
              <span className="text-3xl font-semibold text-foreground tracking-tight num">
                {scorecards.consumption.currentValue}%
              </span>
              <DeltaBadge delta={previousSnapshot ? scorecards.consumption.deltaPts : null} />
            </div>
          </Card>

          {/* Live Attendance Card */}
          <Card className="relative overflow-hidden">
            <div className="flex items-center justify-between text-muted-foreground mb-3">
              <span className="text-xs font-medium text-muted-foreground">
                Live attendance
              </span>
              <div className="p-2 rounded-[8px] bg-secondary text-muted-foreground">
                <Video className="w-4 h-4" />
              </div>
            </div>
            <div className="flex items-baseline justify-between">
              <span className="text-3xl font-semibold text-foreground tracking-tight num">
                {scorecards.liveAttendance.currentValue}%
              </span>
              <DeltaBadge delta={previousSnapshot ? scorecards.liveAttendance.deltaPts : null} />
            </div>
          </Card>

          {/* Live or Recording Attendance Card */}
          <Card className="relative overflow-hidden">
            <div className="flex items-center justify-between text-muted-foreground mb-3">
              <span className="text-xs font-medium text-muted-foreground">
                Live + recording
              </span>
              <div className="p-2 rounded-[8px] bg-secondary text-muted-foreground">
                <TrendingUp className="w-4 h-4" />
              </div>
            </div>
            <div className="flex items-baseline justify-between">
              <span className="text-3xl font-semibold text-foreground tracking-tight num">
                {scorecards.liveOrRecAttendance.currentValue}%
              </span>
              <DeltaBadge delta={previousSnapshot ? scorecards.liveOrRecAttendance.deltaPts : null} />
            </div>
          </Card>
        </div>
      </section>

      {/* Middle Row: Asymmetric Grid (1.4fr / 1fr) for Trends & Segments */}
      <section aria-labelledby="charts-heading">
        <h2 id="charts-heading" className="sr-only">Cohort trends and segment distribution</h2>
        <div className="grid grid-cols-1 lg:grid-cols-[1.4fr_1fr] gap-6">
        {/* Trend Line Chart or Single Snapshot Bars */}
        <Card
          title="Batch Progress Trends Across Snapshots"
          subtitle={
            snapshotAggregates.length <= 1
              ? 'Current snapshot performance breakdown'
              : 'Assignments, Content Consumption, and Attendance over time'
          }
          action={
            <Button
              size="sm"
              variant="outline"
              onClick={() => setShowTrendTable(!showTrendTable)}
              className="gap-1.5"
            >
              {showTrendTable ? (
                <>
                  <ChartIcon className="w-3.5 h-3.5" /> View Chart
                </>
              ) : (
                <>
                  <TableIcon className="w-3.5 h-3.5" /> View Table
                </>
              )}
            </Button>
          }
        >
          {showTrendTable ? (
            <div className="overflow-x-auto max-h-[300px]">
              <table className="w-full text-xs text-left">
                <thead className="bg-slate-50 text-slate-600 uppercase tracking-wider font-semibold">
                  <tr>
                    <th className="px-3 py-2">Snapshot Date</th>
                    <th className="px-3 py-2 text-right">Assignment %</th>
                    <th className="px-3 py-2 text-right">Consumption %</th>
                    <th className="px-3 py-2 text-right">Live Attendance %</th>
                    <th className="px-3 py-2 text-right">Live+Rec %</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {snapshotAggregates.map((row) => (
                    <tr key={row.snapshotId} className="hover:bg-slate-50">
                      <td className="px-3 py-2 font-medium">{row.snapshotDate}</td>
                      <td className="px-3 py-2 text-right text-indigo-600 font-semibold num">{row.assignmentAvg}%</td>
                      <td className="px-3 py-2 text-right text-emerald-600 font-semibold num">{row.consumptionAvg}%</td>
                      <td className="px-3 py-2 text-right text-sky-600 font-semibold num">{row.liveAttendanceAvg}%</td>
                      <td className="px-3 py-2 text-right text-amber-600 font-semibold num">{row.liveOrRecAvg}%</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : snapshotAggregates.length <= 1 ? (
            <div className="h-[280px] w-full flex flex-col justify-between py-2">
              <div className="space-y-4">
                {[
                  { label: 'Assignment submission', value: currentAgg.assignmentAvg, barColor: 'bg-primary' },
                  { label: 'Content consumption', value: currentAgg.consumptionAvg, barColor: 'bg-primary' },
                  { label: 'Live attendance', value: currentAgg.liveAttendanceAvg, barColor: 'bg-primary' },
                  { label: 'Live + recording', value: currentAgg.liveOrRecAvg, barColor: 'bg-primary' },
                ].map((metric) => (
                  <div key={metric.label} className="space-y-1.5">
                    <div className="flex items-center justify-between text-xs">
                      <span className="font-medium text-foreground">{metric.label}</span>
                      <span className="font-semibold text-foreground num">{metric.value}%</span>
                    </div>
                    <div className="w-full h-2 bg-muted/40 rounded-full overflow-hidden">
                      <div
                        className={cn('h-full rounded-full transition-all duration-500', metric.barColor)}
                        style={{ width: `${Math.min(100, Math.max(0, metric.value))}%` }}
                      />
                    </div>
                  </div>
                ))}
              </div>
              <p className="text-xs text-muted-foreground text-center pt-3 border-t border-border/40">
                Upload a second report to see the trend.
              </p>
            </div>
          ) : (
            <div className="h-[280px] w-full">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={snapshotAggregates} margin={{ top: 10, right: 20, left: -10, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                  <XAxis dataKey="snapshotDate" tick={{ fontSize: 11 }} />
                  <YAxis domain={[0, 100]} tick={{ fontSize: 11 }} />
                  <Tooltip
                    contentStyle={{
                      backgroundColor: '#ffffff',
                      borderRadius: '8px',
                      border: '1px solid #e2e8f0',
                      boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)',
                      fontSize: '12px',
                    }}
                  />
                  <Legend wrapperStyle={{ fontSize: '11px', paddingTop: '8px' }} />
                  <Line
                    type="monotone"
                    name="Assignment %"
                    dataKey="assignmentAvg"
                    stroke="#6366f1"
                    strokeWidth={2.5}
                    dot={{ r: 4 }}
                  />
                  <Line
                    type="monotone"
                    name="Consumption %"
                    dataKey="consumptionAvg"
                    stroke="#10b981"
                    strokeWidth={2.5}
                    dot={{ r: 4 }}
                  />
                  <Line
                    type="monotone"
                    name="Live Attendance %"
                    dataKey="liveAttendanceAvg"
                    stroke="#0284c7"
                    strokeWidth={2.5}
                    dot={{ r: 4 }}
                  />
                  <Line
                    type="monotone"
                    name="Live + Rec %"
                    dataKey="liveOrRecAvg"
                    stroke="#f59e0b"
                    strokeWidth={2}
                    strokeDasharray="4 4"
                    dot={{ r: 3 }}
                  />
                </LineChart>
              </ResponsiveContainer>
            </div>
          )}
        </Card>

        {/* Segment Chart */}
        <Card
          title="Student Segment Distribution"
          subtitle="High (≥80%), Medium (50-79%), Low (<50%) cohort composition"
          action={
            <Button
              size="sm"
              variant="outline"
              onClick={() => setShowSegmentTable(!showSegmentTable)}
              className="gap-1.5"
            >
              {showSegmentTable ? (
                <>
                  <ChartIcon className="w-3.5 h-3.5" /> View Chart
                </>
              ) : (
                <>
                  <TableIcon className="w-3.5 h-3.5" /> View Table
                </>
              )}
            </Button>
          }
        >
          {showSegmentTable ? (
            <div className="overflow-x-auto max-h-[300px]">
              <table className="w-full text-xs text-left">
                <thead className="bg-muted/40 text-muted-foreground uppercase tracking-wider font-medium">
                  <tr>
                    <th className="px-3 py-2">Snapshot Date</th>
                    <th className="px-3 py-2 text-right">High (≥80%)</th>
                    <th className="px-3 py-2 text-right">Medium (50-79%)</th>
                    <th className="px-3 py-2 text-right">Low (&lt;50%)</th>
                    <th className="px-3 py-2 text-right">Total Students</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/60">
                  {snapshotAggregates.map((row) => (
                    <tr key={row.snapshotId} className="hover:bg-muted/30 transition-colors">
                      <td className="px-3 py-2 font-medium">{row.snapshotDate}</td>
                      <td className="px-3 py-2 text-right text-good font-semibold num">{row.highCount}</td>
                      <td className="px-3 py-2 text-right text-warn font-semibold num">{row.mediumCount}</td>
                      <td className="px-3 py-2 text-right text-bad font-semibold num">{row.lowCount}</td>
                      <td className="px-3 py-2 text-right font-semibold text-foreground num">{row.studentCount}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="h-[280px] w-full flex flex-col justify-center px-1 py-3 space-y-6">
              {/* Header summary of current snapshot */}
              <div className="flex items-baseline justify-between">
                <div>
                  <p className="text-xs font-medium text-muted-foreground">Total Cohort Students</p>
                  <p className="text-2xl font-semibold text-foreground num">{currentAgg.studentCount}</p>
                </div>
                <div className="text-right text-xs text-muted-foreground">
                  Snapshot: <span className="font-medium text-foreground num">{currentAgg.snapshotDate}</span>
                </div>
              </div>

              {/* Single Horizontal Stacked Bar */}
              <div className="w-full h-11 bg-muted/40 rounded-xl overflow-hidden flex shadow-xs p-0.5 gap-0.5">
                {currentAgg.highCount > 0 && (
                  <div
                    style={{ width: `${(currentAgg.highCount / (currentAgg.studentCount || 1)) * 100}%` }}
                    className="h-full bg-[var(--good)] flex items-center justify-center text-white font-semibold text-xs num transition-all duration-500 rounded-l-[10px]"
                    title={`High (≥80%): ${currentAgg.highCount} students`}
                  >
                    <span>{currentAgg.highCount}</span>
                  </div>
                )}
                {currentAgg.mediumCount > 0 && (
                  <div
                    style={{ width: `${(currentAgg.mediumCount / (currentAgg.studentCount || 1)) * 100}%` }}
                    className="h-full bg-[var(--warn)] flex items-center justify-center text-white font-semibold text-xs num transition-all duration-500"
                    title={`Medium (50-79%): ${currentAgg.mediumCount} students`}
                  >
                    <span>{currentAgg.mediumCount}</span>
                  </div>
                )}
                {currentAgg.lowCount > 0 && (
                  <div
                    style={{ width: `${(currentAgg.lowCount / (currentAgg.studentCount || 1)) * 100}%` }}
                    className="h-full bg-[var(--bad)] flex items-center justify-center text-white font-semibold text-xs num transition-all duration-500 rounded-r-[10px]"
                    title={`Low (<50%): ${currentAgg.lowCount} students`}
                  >
                    <span>{currentAgg.lowCount}</span>
                  </div>
                )}
              </div>

              {/* Legend order matching the bar: High, Medium, Low */}
              <div className="grid grid-cols-3 gap-3 pt-3 border-t border-border/40">
                <div className="flex items-center gap-2">
                  <span className="w-2.5 h-2.5 rounded-full bg-[var(--good)] shrink-0" />
                  <div className="min-w-0">
                    <p className="text-xs font-medium text-foreground truncate">High (≥80%)</p>
                    <p className="text-[11px] text-muted-foreground num">
                      {currentAgg.highCount} students ({((currentAgg.highCount / (currentAgg.studentCount || 1)) * 100).toFixed(0)}%)
                    </p>
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  <span className="w-2.5 h-2.5 rounded-full bg-[var(--warn)] shrink-0" />
                  <div className="min-w-0">
                    <p className="text-xs font-medium text-foreground truncate">Medium (50-79%)</p>
                    <p className="text-[11px] text-muted-foreground num">
                      {currentAgg.mediumCount} students ({((currentAgg.mediumCount / (currentAgg.studentCount || 1)) * 100).toFixed(0)}%)
                    </p>
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  <span className="w-2.5 h-2.5 rounded-full bg-[var(--bad)] shrink-0" />
                  <div className="min-w-0">
                    <p className="text-xs font-medium text-foreground truncate">Low (&lt;50%)</p>
                    <p className="text-[11px] text-muted-foreground num">
                      {currentAgg.lowCount} students ({((currentAgg.lowCount / (currentAgg.studentCount || 1)) * 100).toFixed(0)}%)
                    </p>
                  </div>
                </div>
              </div>
            </div>
          )}
        </Card>
        </div>
      </section>

      {/* Bottom Row: Top Improvers and Needs Attention */}
      <section aria-labelledby="cohort-dynamics-heading">
        <h2 id="cohort-dynamics-heading" className="sr-only">Cohort dynamics and student intervention</h2>
        {!previousSnapshot ? (
        <div className="space-y-4">
          {/* Slim Banner when no previous snapshot */}
          <div className="flex items-center justify-between p-3.5 bg-surface border border-border/80 rounded-xl shadow-xs">
            <div className="flex items-center gap-2.5 text-xs text-muted-foreground">
              <TrendingUp className="w-4 h-4 text-muted-foreground/80" />
              <span>Upload a second report to see the trend.</span>
            </div>
            <Button
              size="sm"
              variant="outline"
              onClick={() => setUploadModalOpen(true)}
              className="text-xs h-7 px-2.5 rounded-lg gap-1.5"
            >
              <UploadCloud className="w-3.5 h-3.5" />
              <span>Upload</span>
            </Button>
          </div>

          {/* At-Risk Card takes full width */}
          <Card
            title="Needs Attention (At-Risk)"
            subtitle={`Top flagged students requiring intervention (${atRiskList.length} total)`}
            action={
              <button
                type="button"
                onClick={() => setActiveTab('atrisk')}
                className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline cursor-pointer group"
              >
                <span>View full at-risk list</span>
                <ArrowRight className="w-3.5 h-3.5 transition-transform group-hover:translate-x-0.5" />
              </button>
            }
          >
            {needsAttention.length === 0 ? (
              <div className="p-8 text-center text-xs text-good font-medium">
                Great news! No students currently flagged as at-risk.
              </div>
            ) : (
              <div className="divide-y divide-border/60">
                {needsAttention.map((student) => (
                  <div
                    key={student.studentId}
                    onClick={() => {
                      setSelectedStudentId(student.studentId);
                      setActiveTab('students');
                    }}
                    className="py-2.5 flex items-center justify-between hover:bg-muted/40 px-2 rounded-lg cursor-pointer transition-colors duration-150"
                  >
                    <div className="min-w-0 max-w-[75%]">
                      <div className="flex items-center gap-2">
                        <span
                          className={cn(
                            'w-2 h-2 rounded-full shrink-0',
                            student.segment === 'Low'
                              ? 'bg-[var(--bad)]'
                              : student.segment === 'Medium'
                              ? 'bg-[var(--warn)]'
                              : 'bg-[var(--good)]'
                          )}
                          title={`Segment: ${student.segment}`}
                        />
                        <p className="text-xs font-medium text-foreground truncate">
                          {formatStudentName(student.studentName, settings.maskPii)}
                        </p>
                      </div>
                      <p className="text-[11px] truncate mt-1">
                        {student.reasons.map((reason, idx) => {
                          const isMostSevere = idx === 0;
                          return (
                            <React.Fragment key={idx}>
                              {idx > 0 && <span className="text-muted-foreground/60 mx-1.5">·</span>}
                              <span className={cn(isMostSevere ? 'text-[var(--bad)] font-medium' : 'text-muted-foreground')}>
                                {reason}
                              </span>
                            </React.Fragment>
                          );
                        })}
                      </p>
                    </div>
                    <div className="text-right shrink-0 pl-3">
                      <p className="text-xs font-semibold text-foreground num">
                        {student.totalConsumptionPct}%
                      </p>
                      <p className="text-[10px] text-muted-foreground">Consumption</p>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </Card>
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Top 5 Improvers */}
          <Card
            title="Top 5 Improvers"
            subtitle="Students with highest positive movement vs previous snapshot"
            action={
              <button
                type="button"
                onClick={() => setActiveTab('compare')}
                className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline cursor-pointer group"
              >
                <span>Compare all</span>
                <ArrowRight className="w-3.5 h-3.5 transition-transform group-hover:translate-x-0.5" />
              </button>
            }
          >
            {topImprovers.length === 0 ? (
              <div className="p-8 text-center text-xs text-muted-foreground">
                No previous snapshot to compare movement or no positive deltas yet.
              </div>
            ) : (
              <div className="divide-y divide-border/60">
                {topImprovers.map((item) => (
                  <div
                    key={item.studentId}
                    onClick={() => {
                      setSelectedStudentId(item.studentId);
                      setActiveTab('students');
                    }}
                    className="py-2.5 flex items-center justify-between hover:bg-muted/40 px-2 rounded-lg cursor-pointer transition-colors duration-150"
                  >
                    <div>
                      <p className="text-xs font-medium text-foreground">
                        {formatStudentName(item.name, settings.maskPii)}
                      </p>
                      <div className="flex items-center gap-2 mt-0.5">
                        <SegmentBadge segment={item.current.segment} />
                        <span className="text-[11px] text-muted-foreground">
                          Cons: <span className="num">{item.current.metrics.totalConsumptionPct}%</span> • Asgn: <span className="num">{item.current.metrics.assignmentSubmissionPct}%</span>
                        </span>
                      </div>
                    </div>
                    <div className="text-right">
                      <DeltaBadge delta={item.avgDelta} />
                      <p className="text-[10px] text-muted-foreground mt-0.5">Avg delta</p>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </Card>

          {/* Needs Attention (At-Risk) */}
          <Card
            title="Needs Attention (At-Risk)"
            subtitle={`Top flagged students requiring intervention (${atRiskList.length} total)`}
            action={
              <button
                type="button"
                onClick={() => setActiveTab('atrisk')}
                className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline cursor-pointer group"
              >
                <span>View full at-risk list</span>
                <ArrowRight className="w-3.5 h-3.5 transition-transform group-hover:translate-x-0.5" />
              </button>
            }
          >
            {needsAttention.length === 0 ? (
              <div className="p-8 text-center text-xs text-good font-medium">
                Great news! No students currently flagged as at-risk.
              </div>
            ) : (
              <div className="divide-y divide-border/60">
                {needsAttention.map((student) => (
                  <div
                    key={student.studentId}
                    onClick={() => {
                      setSelectedStudentId(student.studentId);
                      setActiveTab('students');
                    }}
                    className="py-2.5 flex items-center justify-between hover:bg-muted/40 px-2 rounded-lg cursor-pointer transition-colors duration-150"
                  >
                    <div className="min-w-0 max-w-[75%]">
                      <div className="flex items-center gap-2">
                        <span
                          className={cn(
                            'w-2 h-2 rounded-full shrink-0',
                            student.segment === 'Low'
                              ? 'bg-[var(--bad)]'
                              : student.segment === 'Medium'
                              ? 'bg-[var(--warn)]'
                              : 'bg-[var(--good)]'
                          )}
                          title={`Segment: ${student.segment}`}
                        />
                        <p className="text-xs font-medium text-foreground truncate">
                          {formatStudentName(student.studentName, settings.maskPii)}
                        </p>
                      </div>
                      <p className="text-[11px] truncate mt-1">
                        {student.reasons.map((reason, idx) => {
                          const isMostSevere = idx === 0;
                          return (
                            <React.Fragment key={idx}>
                              {idx > 0 && <span className="text-muted-foreground/60 mx-1.5">·</span>}
                              <span className={cn(isMostSevere ? 'text-[var(--bad)] font-medium' : 'text-muted-foreground')}>
                                {reason}
                              </span>
                            </React.Fragment>
                          );
                        })}
                      </p>
                    </div>
                    <div className="text-right shrink-0 pl-3">
                      <p className="text-xs font-semibold text-foreground num">
                        {student.totalConsumptionPct}%
                      </p>
                      <p className="text-[10px] text-muted-foreground">Consumption</p>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </Card>
        </div>
      )}
      </section>
    </div>
  );
};

export const OverviewDashboardSkeleton: React.FC = () => (
  <div className="space-y-8 animate-pulse" aria-label="Loading dashboard">
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
      {[1, 2, 3, 4].map((i) => (
        <div key={i} className="h-28 rounded-[14px] bg-muted/40 shadow-[var(--shadow-tint-md)] p-5 space-y-3">
          <div className="h-3 w-24 bg-muted-foreground/20 rounded-[8px]" />
          <div className="h-8 w-16 bg-muted-foreground/20 rounded-[8px]" />
        </div>
      ))}
    </div>
    <div className="grid grid-cols-1 lg:grid-cols-[1.4fr_1fr] gap-6">
      <div className="h-[360px] rounded-[14px] bg-muted/40 shadow-[var(--shadow-tint-md)]" />
      <div className="h-[360px] rounded-[14px] bg-muted/40 shadow-[var(--shadow-tint-md)]" />
    </div>
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
      <div className="h-[300px] rounded-[14px] bg-muted/40 shadow-[var(--shadow-tint-md)]" />
      <div className="h-[300px] rounded-[14px] bg-muted/40 shadow-[var(--shadow-tint-md)]" />
    </div>
  </div>
);
