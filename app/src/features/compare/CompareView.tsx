import React, { useState, useMemo } from 'react';
import { Card } from '@/ui/Card';
import { Button } from '@/ui/Button';
import { DeltaBadge, MovementBadge, SegmentBadge } from '@/ui/Badge';
import { usePlatformStore, type ActiveTab } from '@/store/usePlatformStore';
import { formatStudentName, formatStudentPhone } from '@/core/identity/mask';
import { compareSnapshots, computeSnapshotAggregate } from '@/core/analytics';
import type { Snapshot, StudentSnapshot, Student, AssignmentResult, Session, MovementType } from '@/types';
import {
  GitCompare,
  UploadCloud,
  Search,
  CheckCircle2,
  Calendar,
  FileCheck2,
  Video,
} from 'lucide-react';
import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  Legend,
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
  allStudentSnapshots,
  students,
  assignmentResults = [],
  sessions = [],
}) => {
  const { settings, setSelectedStudentId, setActiveTab, setUploadModalOpen } = usePlatformStore();

  const sortedSnapshots = useMemo(() => {
    return [...snapshots].sort((a, b) => a.snapshotDate.localeCompare(b.snapshotDate));
  }, [snapshots]);

  // If fewer than 2 snapshots in this batch, show required empty state
  if (sortedSnapshots.length < 2) {
    return (
      <Card>
        <div className="py-16 px-4 text-center space-y-4 max-w-md mx-auto">
          <div className="w-14 h-14 rounded-2xl bg-indigo-50 text-indigo-600 flex items-center justify-center mx-auto shadow-xs border border-indigo-100">
            <GitCompare className="w-7 h-7" />
          </div>
          <div className="space-y-1.5">
            <h3 className="text-base font-semibold text-slate-900 font-heading">
              Upload another report for this course to compare
            </h3>
            <p className="text-xs text-slate-500 leading-relaxed">
              Comparison requires at least two snapshots of different dates in the same batch to measure cohort progress over time.
            </p>
          </div>
          <Button
            onClick={() => setUploadModalOpen(true)}
            className="gap-2 mx-auto mt-2 bg-indigo-600 hover:bg-indigo-700 text-white"
          >
            <UploadCloud className="w-4 h-4" />
            Upload Report
          </Button>
        </div>
      </Card>
    );
  }

  return (
    <CompareViewContent
      sortedSnapshots={sortedSnapshots}
      allStudentSnapshots={allStudentSnapshots}
      students={students}
      assignmentResults={assignmentResults}
      sessions={sessions}
      settings={settings}
      setSelectedStudentId={setSelectedStudentId}
      setActiveTab={setActiveTab}
    />
  );
};

interface CompareViewContentProps {
  sortedSnapshots: Snapshot[];
  allStudentSnapshots: StudentSnapshot[];
  students: Student[];
  assignmentResults: AssignmentResult[];
  sessions: Session[];
  settings: { deltaTolerance: number; maskPii: boolean };
  setSelectedStudentId: (id: string | null) => void;
  setActiveTab: (tab: ActiveTab) => void;
}

const CompareViewContent: React.FC<CompareViewContentProps> = ({
  sortedSnapshots,
  allStudentSnapshots,
  students,
  assignmentResults,
  sessions,
  settings,
  setSelectedStudentId,
  setActiveTab,
}) => {
  // Multi-date selection state (default to all dates or last 2)
  const [selectedSnapshotIds, setSelectedSnapshotIds] = useState<string[]>(() => {
    return [
      sortedSnapshots[sortedSnapshots.length - 2].id,
      sortedSnapshots[sortedSnapshots.length - 1].id,
    ];
  });

  const [activeListTab, setActiveListTab] = useState<'ALL' | MovementType | 'SINGLE_ONLY'>('ALL');
  const [searchQuery, setSearchQuery] = useState('');

  // Toggle snapshot selection
  const handleToggleSnapshot = (id: string) => {
    setSelectedSnapshotIds((prev) => {
      if (prev.includes(id)) {
        if (prev.length <= 2) return prev; // Minimum 2 must be selected
        return prev.filter((item) => item !== id);
      } else {
        return [...prev, id];
      }
    });
  };

  // Filter selected snapshots ordered chronologically
  const activeSnapshots = useMemo(() => {
    const idSet = new Set(selectedSnapshotIds);
    return sortedSnapshots.filter((s) => idSet.has(s.id));
  }, [sortedSnapshots, selectedSnapshotIds]);

  const snapA = activeSnapshots[0];
  const snapB = activeSnapshots[activeSnapshots.length - 1];

  const snapAStudents = useMemo(() => {
    return allStudentSnapshots.filter((s) => s.snapshotId === snapA?.id);
  }, [allStudentSnapshots, snapA?.id]);

  const snapBStudents = useMemo(() => {
    return allStudentSnapshots.filter((s) => s.snapshotId === snapB?.id);
  }, [allStudentSnapshots, snapB?.id]);

  const studentMap = useMemo(() => {
    return new Map<string, Student>(students.map((s) => [s.id, s]));
  }, [students]);

  // Compare students between baseline and latest
  const comparison = useMemo(() => {
    return compareSnapshots(
      snapAStudents,
      snapBStudents,
      studentMap,
      settings.deltaTolerance
    );
  }, [snapAStudents, snapBStudents, studentMap, settings.deltaTolerance]);

  // Students appearing in only one report
  const singleReportStudents = useMemo(() => {
    const mapA = new Set(snapAStudents.map((s) => s.studentId));
    const mapB = new Set(snapBStudents.map((s) => s.studentId));

    const onlyInA = snapAStudents
      .filter((s) => !mapB.has(s.studentId))
      .map((s) => ({
        studentId: s.studentId,
        student: studentMap.get(s.studentId),
        origin: `Present only in baseline (${snapA?.snapshotDate})`,
        type: 'MISSING_IN_LATEST' as const,
      }));

    const onlyInB = snapBStudents
      .filter((s) => !mapA.has(s.studentId))
      .map((s) => ({
        studentId: s.studentId,
        student: studentMap.get(s.studentId),
        origin: `New student added in (${snapB?.snapshotDate})`,
        type: 'NEW_IN_LATEST' as const,
      }));

    return [...onlyInA, ...onlyInB];
  }, [snapAStudents, snapBStudents, snapA?.snapshotDate, snapB?.snapshotDate, studentMap]);

  // Aggregates for delta calculation
  const aggA = useMemo(() => {
    return snapA ? computeSnapshotAggregate(snapA.id, snapA.snapshotDate, snapAStudents) : null;
  }, [snapA, snapAStudents]);

  const aggB = useMemo(() => {
    return snapB ? computeSnapshotAggregate(snapB.id, snapB.snapshotDate, snapBStudents) : null;
  }, [snapB, snapBStudents]);

  // Multi-date trend data when 3 or more dates selected
  const trendChartData = useMemo(() => {
    if (activeSnapshots.length < 3) return [];
    return activeSnapshots.map((snap) => {
      const snapStuds = allStudentSnapshots.filter((s) => s.snapshotId === snap.id);
      const agg = computeSnapshotAggregate(snap.id, snap.snapshotDate, snapStuds);
      return {
        date: snap.snapshotDate,
        assignmentAvg: agg.assignmentAvg,
        consumptionAvg: agg.consumptionAvg,
        liveAttendanceAvg: agg.liveAttendanceAvg,
        liveOrRecAvg: agg.liveOrRecAvg,
      };
    });
  }, [activeSnapshots, allStudentSnapshots]);

  // Assignment items comparison between snapA and snapB
  const assignmentComparison = useMemo(() => {
    if (!snapA || !snapB) return [];
    const itemsA = new Set(
      assignmentResults
        .filter((a) => a.snapshotId === snapA.id)
        .map((a) => a.assignmentName)
    );
    const itemsB = new Set(
      assignmentResults
        .filter((a) => a.snapshotId === snapB.id)
        .map((a) => a.assignmentName)
    );

    const allNames = Array.from(new Set([...itemsA, ...itemsB]));
    return allNames.map((name) => {
      let status: 'SAME' | 'NEW' | 'REMOVED' = 'SAME';
      if (itemsA.has(name) && !itemsB.has(name)) status = 'REMOVED';
      else if (!itemsA.has(name) && itemsB.has(name)) status = 'NEW';
      return { name, status };
    });
  }, [assignmentResults, snapA, snapB]);

  // Sessions comparison between snapA and snapB
  const sessionComparison = useMemo(() => {
    if (!snapA || !snapB) return [];
    const sessA = sessions.filter((s) => s.snapshotId === snapA.id);
    const sessB = sessions.filter((s) => s.snapshotId === snapB.id);

    const mapA = new Map(sessA.map((s) => [s.title, s]));
    const mapB = new Map(sessB.map((s) => [s.title, s]));

    const allTitles = Array.from(new Set([...mapA.keys(), ...mapB.keys()]));
    return allTitles.map((title) => {
      let status: 'SAME' | 'NEW' | 'REMOVED' = 'SAME';
      if (mapA.has(title) && !mapB.has(title)) status = 'REMOVED';
      else if (!mapA.has(title) && mapB.has(title)) status = 'NEW';

      const s = mapB.get(title) || mapA.get(title);
      return { title, date: s?.sessionDate || 'N/A', status };
    });
  }, [sessions, snapA, snapB]);

  // Filter student movements
  const filteredComparisons = useMemo(() => {
    return comparison.comparisons.filter((c) => {
      const matchesTab = activeListTab === 'ALL' || activeListTab === 'SINGLE_ONLY' ? true : c.movement === activeListTab;
      const matchesSearch =
        !searchQuery ||
        c.studentName.toLowerCase().includes(searchQuery.toLowerCase()) ||
        c.phoneE164.includes(searchQuery);
      return matchesTab && matchesSearch;
    });
  }, [comparison.comparisons, activeListTab, searchQuery]);

  const filteredSingleReport = useMemo(() => {
    return singleReportStudents.filter((item) => {
      if (!searchQuery) return true;
      const name = item.student?.name || '';
      const phone = item.student?.phoneE164 || '';
      return name.toLowerCase().includes(searchQuery.toLowerCase()) || phone.includes(searchQuery);
    });
  }, [singleReportStudents, searchQuery]);

  const formatDeltaArrow = (delta: number) => {
    if (delta > 0) return { text: `+${delta.toFixed(1)}% ↑`, color: 'text-emerald-600 bg-emerald-50 border-emerald-200' };
    if (delta < 0) return { text: `${delta.toFixed(1)}% ↓`, color: 'text-rose-600 bg-rose-50 border-rose-200' };
    return { text: '0.0% →', color: 'text-slate-600 bg-slate-50 border-slate-200' };
  };

  const assignDelta = aggA && aggB ? Number((aggB.assignmentAvg - aggA.assignmentAvg).toFixed(1)) : 0;
  const contentDelta = aggA && aggB ? Number((aggB.consumptionAvg - aggA.consumptionAvg).toFixed(1)) : 0;
  const liveDelta = aggA && aggB ? Number((aggB.liveAttendanceAvg - aggA.liveAttendanceAvg).toFixed(1)) : 0;
  const liveRecDelta = aggA && aggB ? Number((aggB.liveOrRecAvg - aggA.liveOrRecAvg).toFixed(1)) : 0;

  return (
    <div className="space-y-6">
      {/* Multi-Date Snapshot Selector */}
      <Card
        title="Compare Batch Snapshots"
        subtitle={`Select 2 or more report dates from this batch to analyze cohort trends (${selectedSnapshotIds.length} of ${sortedSnapshots.length} dates selected)`}
      >
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            {sortedSnapshots.map((snap) => {
              const isSelected = selectedSnapshotIds.includes(snap.id);
              return (
                <button
                  key={snap.id}
                  type="button"
                  onClick={() => handleToggleSnapshot(snap.id)}
                  className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors cursor-pointer ${
                    isSelected
                      ? 'bg-indigo-600 text-white border-indigo-600 shadow-xs'
                      : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-50'
                  }`}
                >
                  <Calendar className="w-3.5 h-3.5" />
                  <span>{snap.snapshotDate}</span>
                  {isSelected && <CheckCircle2 className="w-3.5 h-3.5 ml-0.5 text-indigo-100" />}
                </button>
              );
            })}
          </div>
          <p className="text-[11px] text-slate-400">
            Comparing Baseline: <span className="font-semibold text-slate-700">{snapA?.snapshotDate}</span> → Latest: <span className="font-semibold text-slate-700">{snapB?.snapshotDate}</span>
          </p>
        </div>
      </Card>

      {/* Metric Delta Cards with Text + Color Arrows */}
      {aggA && aggB && (
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <Card>
            <div className="space-y-2">
              <p className="text-xs font-medium text-slate-500 uppercase tracking-wider">Assignment Submission</p>
              <div className="flex items-baseline justify-between">
                <span className="text-xl font-bold text-slate-900">{aggB.assignmentAvg}%</span>
                <span className={`px-2 py-0.5 rounded text-xs font-semibold border ${formatDeltaArrow(assignDelta).color}`}>
                  {formatDeltaArrow(assignDelta).text}
                </span>
              </div>
              <p className="text-[11px] text-slate-400">Baseline was {aggA.assignmentAvg}%</p>
            </div>
          </Card>

          <Card>
            <div className="space-y-2">
              <p className="text-xs font-medium text-slate-500 uppercase tracking-wider">Content Consumption</p>
              <div className="flex items-baseline justify-between">
                <span className="text-xl font-bold text-slate-900">{aggB.consumptionAvg}%</span>
                <span className={`px-2 py-0.5 rounded text-xs font-semibold border ${formatDeltaArrow(contentDelta).color}`}>
                  {formatDeltaArrow(contentDelta).text}
                </span>
              </div>
              <p className="text-[11px] text-slate-400">Baseline was {aggA.consumptionAvg}%</p>
            </div>
          </Card>

          <Card>
            <div className="space-y-2">
              <p className="text-xs font-medium text-slate-500 uppercase tracking-wider">Live Attendance</p>
              <div className="flex items-baseline justify-between">
                <span className="text-xl font-bold text-slate-900">{aggB.liveAttendanceAvg}%</span>
                <span className={`px-2 py-0.5 rounded text-xs font-semibold border ${formatDeltaArrow(liveDelta).color}`}>
                  {formatDeltaArrow(liveDelta).text}
                </span>
              </div>
              <p className="text-[11px] text-slate-400">Baseline was {aggA.liveAttendanceAvg}%</p>
            </div>
          </Card>

          <Card>
            <div className="space-y-2">
              <p className="text-xs font-medium text-slate-500 uppercase tracking-wider">Live + Recording</p>
              <div className="flex items-baseline justify-between">
                <span className="text-xl font-bold text-slate-900">{aggB.liveOrRecAvg}%</span>
                <span className={`px-2 py-0.5 rounded text-xs font-semibold border ${formatDeltaArrow(liveRecDelta).color}`}>
                  {formatDeltaArrow(liveRecDelta).text}
                </span>
              </div>
              <p className="text-[11px] text-slate-400">Baseline was {aggA.liveOrRecAvg}%</p>
            </div>
          </Card>
        </div>
      )}

      {/* Multi-Date Trend Chart when 3 or more dates are chosen */}
      {trendChartData.length >= 3 && (
        <Card
          title="Multi-Snapshot Progression Trend"
          subtitle={`Metrics trajectory across ${trendChartData.length} selected snapshot dates`}
        >
          <div className="h-[280px] w-full mt-2">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={trendChartData} margin={{ top: 10, right: 30, left: 0, bottom: 10 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                <XAxis dataKey="date" tick={{ fontSize: 11 }} />
                <YAxis domain={[0, 100]} tick={{ fontSize: 11 }} />
                <Tooltip
                  contentStyle={{
                    backgroundColor: '#ffffff',
                    borderRadius: '8px',
                    border: '1px solid #e2e8f0',
                    fontSize: '12px',
                  }}
                />
                <Legend wrapperStyle={{ fontSize: '11px', paddingTop: '10px' }} />
                <Line type="monotone" dataKey="assignmentAvg" name="Assignment %" stroke="#6366f1" strokeWidth={2} dot={{ r: 4 }} />
                <Line type="monotone" dataKey="consumptionAvg" name="Content %" stroke="#10b981" strokeWidth={2} dot={{ r: 4 }} />
                <Line type="monotone" dataKey="liveAttendanceAvg" name="Live Class %" stroke="#0284c7" strokeWidth={2} dot={{ r: 4 }} />
                <Line type="monotone" dataKey="liveOrRecAvg" name="Live+Rec %" stroke="#f59e0b" strokeWidth={2} dot={{ r: 4 }} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </Card>
      )}

      {/* Student Movement Section */}
      <Card
        title="Student Cohort Movement"
        subtitle={`Tracking ${comparison.comparisons.length} matched learners across snapshots`}
        action={
          <div className="flex items-center gap-2">
            <div className="relative w-64">
              <Search className="w-3.5 h-3.5 absolute left-3 top-2.5 text-slate-400" />
              <input
                type="text"
                placeholder="Search students..."
                className="w-full text-xs border border-slate-300 rounded-lg pl-8 pr-3 py-1.5 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
              />
            </div>
          </div>
        }
      >
        <div className="space-y-4">
          {/* Movement Tabs */}
          <div className="flex flex-wrap items-center gap-1.5 border-b border-slate-100 pb-3">
            <button
              onClick={() => setActiveListTab('ALL')}
              className={`px-3 py-1 rounded-md text-xs font-semibold cursor-pointer transition-colors ${
                activeListTab === 'ALL'
                  ? 'bg-indigo-600 text-white'
                  : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
              }`}
            >
              All Matched ({comparison.comparisons.length})
            </button>
            <button
              onClick={() => setActiveListTab('IMPROVED')}
              className={`px-3 py-1 rounded-md text-xs font-semibold cursor-pointer transition-colors ${
                activeListTab === 'IMPROVED'
                  ? 'bg-emerald-600 text-white'
                  : 'bg-emerald-50 text-emerald-700 hover:bg-emerald-100'
              }`}
            >
              Improved ({comparison.improved.length})
            </button>
            <button
              onClick={() => setActiveListTab('SAME')}
              className={`px-3 py-1 rounded-md text-xs font-semibold cursor-pointer transition-colors ${
                activeListTab === 'SAME'
                  ? 'bg-slate-600 text-white'
                  : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
              }`}
            >
              Same ({comparison.same.length})
            </button>
            <button
              onClick={() => setActiveListTab('DECLINED')}
              className={`px-3 py-1 rounded-md text-xs font-semibold cursor-pointer transition-colors ${
                activeListTab === 'DECLINED'
                  ? 'bg-rose-600 text-white'
                  : 'bg-rose-50 text-rose-700 hover:bg-rose-100'
              }`}
            >
              Declined ({comparison.declined.length})
            </button>
            {singleReportStudents.length > 0 && (
              <button
                onClick={() => setActiveListTab('SINGLE_ONLY')}
                className={`px-3 py-1 rounded-md text-xs font-semibold cursor-pointer transition-colors ${
                  activeListTab === 'SINGLE_ONLY'
                    ? 'bg-amber-600 text-white'
                    : 'bg-amber-50 text-amber-700 hover:bg-amber-100'
                }`}
              >
                Single-Report Students ({singleReportStudents.length})
              </button>
            )}
          </div>

          {activeListTab === 'SINGLE_ONLY' ? (
            <div className="overflow-x-auto">
              <table className="w-full text-xs text-left">
                <thead className="bg-slate-50 text-slate-600 font-semibold uppercase tracking-wider">
                  <tr>
                    <th className="px-3 py-2.5">Student</th>
                    <th className="px-3 py-2.5">Phone</th>
                    <th className="px-3 py-2.5">Status Flag</th>
                    <th className="px-3 py-2.5">Report Origin</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {filteredSingleReport.map((item) => (
                    <tr key={item.studentId} className="hover:bg-slate-50/80">
                      <td className="px-3 py-2.5 font-semibold text-slate-900">
                        {formatStudentName(item.student?.name || item.studentId, settings.maskPii)}
                      </td>
                      <td className="px-3 py-2.5 text-slate-500 font-mono">
                        {formatStudentPhone(item.student?.phoneE164 || '', settings.maskPii)}
                      </td>
                      <td className="px-3 py-2.5">
                        {item.type === 'NEW_IN_LATEST' ? (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-semibold bg-emerald-100 text-emerald-800">
                            New in Snapshot
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-semibold bg-rose-100 text-rose-800">
                            Missing in Latest
                          </span>
                        )}
                      </td>
                      <td className="px-3 py-2.5 text-slate-600">{item.origin}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-xs text-left">
                <thead className="bg-slate-50 text-slate-600 font-semibold uppercase tracking-wider">
                  <tr>
                    <th className="px-3 py-2.5">Student</th>
                    <th className="px-3 py-2.5">Movement</th>
                    <th className="px-3 py-2.5 text-right">Assignment Δ</th>
                    <th className="px-3 py-2.5 text-right">Content Δ</th>
                    <th className="px-3 py-2.5 text-right">Attendance Δ</th>
                    <th className="px-3 py-2.5 text-right">Segment Transition</th>
                    <th className="px-3 py-2.5 text-right">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {filteredComparisons.map((item) => (
                    <tr key={item.studentId} className="hover:bg-slate-50/80 transition-colors">
                      <td className="px-3 py-2.5">
                        <p className="font-semibold text-slate-900">
                          {formatStudentName(item.studentName, settings.maskPii)}
                        </p>
                        <p className="text-[10px] text-slate-400">
                          {formatStudentPhone(item.phoneE164, settings.maskPii)}
                        </p>
                      </td>
                      <td className="px-3 py-2.5">
                        <MovementBadge movement={item.movement} />
                      </td>
                      <td className="px-3 py-2.5 text-right">
                        <DeltaBadge delta={item.assignmentDelta} />
                      </td>
                      <td className="px-3 py-2.5 text-right">
                        <DeltaBadge delta={item.consumptionDelta} />
                      </td>
                      <td className="px-3 py-2.5 text-right">
                        <DeltaBadge delta={item.attendanceDelta} />
                      </td>
                      <td className="px-3 py-2.5 text-right">
                        <div className="flex items-center justify-end gap-1">
                          <SegmentBadge segment={item.segmentA} />
                          <span className="text-slate-400">→</span>
                          <SegmentBadge segment={item.segmentB} />
                        </div>
                      </td>
                      <td className="px-3 py-2.5 text-right">
                        <Button
                          size="sm"
                          variant="ghost"
                          className="text-xs text-indigo-600"
                          onClick={() => {
                            setSelectedStudentId(item.studentId);
                            setActiveTab('students');
                          }}
                        >
                          View Profile
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </Card>

      {/* Curriculum & Session Differences (New / Removed) */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Assignment Items Diff */}
        <Card
          title="Curriculum Assignments Diff"
          subtitle={`Changes in assignment items between ${snapA?.snapshotDate} and ${snapB?.snapshotDate}`}
        >
          {assignmentComparison.length === 0 ? (
            <p className="text-xs text-slate-400 py-4 text-center">No assignment items found</p>
          ) : (
            <div className="divide-y divide-slate-100 max-h-60 overflow-y-auto">
              {assignmentComparison.map((item) => (
                <div key={item.name} className="py-2 flex items-center justify-between text-xs">
                  <div className="flex items-center gap-2 pr-2">
                    <FileCheck2 className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                    <span className="font-medium text-slate-800 line-clamp-1">{item.name}</span>
                  </div>
                  {item.status === 'NEW' && (
                    <span className="px-2 py-0.5 rounded text-[10px] font-semibold bg-emerald-100 text-emerald-800 border border-emerald-200 shrink-0">
                      NEW
                    </span>
                  )}
                  {item.status === 'REMOVED' && (
                    <span className="px-2 py-0.5 rounded text-[10px] font-semibold bg-rose-100 text-rose-800 border border-rose-200 shrink-0">
                      REMOVED
                    </span>
                  )}
                  {item.status === 'SAME' && (
                    <span className="text-[10px] text-slate-400 font-medium shrink-0">In Both</span>
                  )}
                </div>
              ))}
            </div>
          )}
        </Card>

        {/* Sessions Diff */}
        <Card
          title="Class Sessions Diff"
          subtitle={`Changes in class sessions between ${snapA?.snapshotDate} and ${snapB?.snapshotDate}`}
        >
          {sessionComparison.length === 0 ? (
            <p className="text-xs text-slate-400 py-4 text-center">No sessions found</p>
          ) : (
            <div className="divide-y divide-slate-100 max-h-60 overflow-y-auto">
              {sessionComparison.map((sess) => (
                <div key={sess.title} className="py-2 flex items-center justify-between text-xs">
                  <div className="flex items-center gap-2 pr-2">
                    <Video className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                    <div>
                      <p className="font-medium text-slate-800 line-clamp-1">{sess.title}</p>
                      <p className="text-[10px] text-slate-400">{sess.date}</p>
                    </div>
                  </div>
                  {sess.status === 'NEW' && (
                    <span className="px-2 py-0.5 rounded text-[10px] font-semibold bg-emerald-100 text-emerald-800 border border-emerald-200 shrink-0">
                      NEW
                    </span>
                  )}
                  {sess.status === 'REMOVED' && (
                    <span className="px-2 py-0.5 rounded text-[10px] font-semibold bg-rose-100 text-rose-800 border border-rose-200 shrink-0">
                      REMOVED
                    </span>
                  )}
                  {sess.status === 'SAME' && (
                    <span className="text-[10px] text-slate-400 font-medium shrink-0">In Both</span>
                  )}
                </div>
              ))}
            </div>
          )}
        </Card>
      </div>
    </div>
  );
};
