import React, { useState, useEffect, useMemo, useDeferredValue, useCallback } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { Card } from '@/ui/Card';
import { Button } from '@/ui/Button';
import { usePlatformStore } from '@/store/usePlatformStore';
import { formatStudentName, formatStudentPhone } from '@/core/identity/mask';
import { apiClient, resolveBackendBatchId } from '@/core/api/client';
import type {
  AssignmentResult,
  Student,
  Snapshot,
  BatchLatenessReport,
  LearnerAssignmentStatus,
  SubmissionLatenessStatus,
} from '@/types';
import {
  Users,
  CheckCircle2,
  XCircle,
  Search,
  AlertTriangle,
  Info,
  Calendar,
  X,
  ChevronRight,
  Loader2,
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
} from 'recharts';

export function getAssignmentMaxScore(assignmentName: string, type?: 'regular' | 'module_end'): number {
  if (type === 'module_end' || /module[- ]?end/i.test(assignmentName)) {
    return 25;
  }
  if (/capstone/i.test(assignmentName)) {
    return 50;
  }
  if (/codeathon/i.test(assignmentName)) {
    return 60;
  }
  if (/mcq/i.test(assignmentName)) {
    return 40;
  }
  return 10;
}

interface AssignmentsViewProps {
  currentSnapshot: Snapshot;
  assignmentResults: AssignmentResult[];
  students: Student[];
}

export const AssignmentsView: React.FC<AssignmentsViewProps> = ({
  currentSnapshot,
  assignmentResults,
  students,
}) => {
  const {
    settings,
    selectedBatchId,
    backendConnected,
    setSelectedStudentId,
    setActiveTab,
    setSettingsSubTab,
  } = usePlatformStore(
    useShallow((s) => ({
      settings: s.settings,
      selectedBatchId: s.selectedBatchId,
      backendConnected: s.backendConnected,
      setSelectedStudentId: s.setSelectedStudentId,
      setActiveTab: s.setActiveTab,
      setSettingsSubTab: s.setSettingsSubTab,
    }))
  );

  const [latenessReport, setLatenessReport] = useState<BatchLatenessReport | null>(null);
  const [isLoadingLateness, setIsLoadingLateness] = useState(false);
  const [selectedAssignmentName, setSelectedAssignmentName] = useState<string | null>(null);
  const [drawerFilter, setDrawerFilter] = useState<'all' | SubmissionLatenessStatus>('all');
  const [search, setSearch] = useState('');
  const deferredSearch = useDeferredValue(search);

  // Student lookup map
  const studentMap = useMemo(
    () => new Map<string, Student>(students.map((s) => [s.id, s])),
    [students]
  );

  // Fetch lateness report from backend when batch/snapshot changes
  const fetchLateness = useCallback(async () => {
    if (!selectedBatchId || !currentSnapshot?.id || !backendConnected || !apiClient.isAuthenticated()) {
      setLatenessReport(null);
      return;
    }

    setIsLoadingLateness(true);
    try {
      const targetBatchId = await resolveBackendBatchId(selectedBatchId);
      const snapshotQuery = currentSnapshot.snapshotDate || currentSnapshot.id;
      const data = await apiClient.getAssignmentLateness(targetBatchId, snapshotQuery);
      setLatenessReport(data);
    } catch (err) {
      console.error('Failed to load assignment lateness data:', err);
      setLatenessReport(null);
    } finally {
      setIsLoadingLateness(false);
    }
  }, [selectedBatchId, currentSnapshot?.id, currentSnapshot?.snapshotDate, backendConnected]);

  useEffect(() => {
    fetchLateness();
  }, [fetchLateness]);

  // Fallback map from raw local assignment results
  const rawAssignmentMap = useMemo(() => {
    const map = new Map<string, AssignmentResult[]>();
    for (const res of assignmentResults) {
      const list = map.get(res.assignmentName);
      if (list) {
        list.push(res);
      } else {
        map.set(res.assignmentName, [res]);
      }
    }
    return map;
  }, [assignmentResults]);

  // Combined stats per assignment, merging backend lateness report when available
  const assignmentCards = useMemo(() => {
    if (latenessReport && latenessReport.assignments.length > 0) {
      return latenessReport.assignments.map((asgn) => {
        const total = asgn.totalLearners;
        const submitted = asgn.submittedCount;
        const submissionRate = total > 0 ? Number(((submitted / total) * 100).toFixed(1)) : 0;

        // Calculate average score from learners list
        const scores = asgn.learners
          .map((l) => l.score)
          .filter((sc): sc is number => sc !== null && !isNaN(sc));
        const avgScore =
          scores.length > 0
            ? Number((scores.reduce((a, b) => a + b, 0) / scores.length).toFixed(1))
            : null;

        return {
          name: asgn.lmsAssignmentName,
          dueDate: asgn.dueDate,
          hasDueDate: asgn.hasDueDate,
          type: asgn.type,
          total,
          submitted,
          onTime: asgn.onTimeCount,
          late: asgn.lateCount,
          possiblyLate: asgn.possiblyLateCount,
          unknown: asgn.unknownCount,
          pending: asgn.notSubmittedCount,
          submissionRate,
          avgScore,
          learners: asgn.learners,
        };
      });
    }

    // Fallback if backend lateness is not available: check local cached schedule
    let localScheduleMap = new Map<string, { dueDate: string | null; type: 'regular' | 'module_end' }>();
    try {
      const cached =
        (selectedBatchId && localStorage.getItem(`spp_assignment_schedule_${selectedBatchId}`)) ||
        localStorage.getItem('spp_assignment_schedule_latest');
      if (cached) {
        const parsed = JSON.parse(cached);
        if (Array.isArray(parsed)) {
          for (const item of parsed) {
            if (item.lmsAssignmentName) {
              localScheduleMap.set(item.lmsAssignmentName.toLowerCase().trim(), {
                dueDate: item.dueDate || null,
                type: item.type || 'regular',
              });
            }
          }
        }
      }
    } catch {
      // ignore
    }

    return Array.from(rawAssignmentMap.entries()).map(([name, records]) => {
      let passed = 0;
      let delayed = 0;
      let pending = 0;
      let scoreSum = 0;
      let scoreCount = 0;

      for (const r of records) {
        if (r.status === 'PASSED') passed++;
        else if (r.status === 'DELAYED') delayed++;
        else if (r.status === 'SUBMISSION_PENDING' || r.status === 'NOT_SUBMITTED') pending++;

        if (r.score !== null) {
          scoreSum += r.score;
          scoreCount++;
        }
      }

      const total = records.length;
      const submitted = passed + delayed;
      const submissionRate = total > 0 ? Number(((submitted / total) * 100).toFixed(1)) : 0;
      const avgScore = scoreCount > 0 ? Number((scoreSum / scoreCount).toFixed(1)) : null;

      const sched = localScheduleMap.get(name.toLowerCase().trim());
      const dueDate = sched?.dueDate || null;
      const type = sched?.type || ('regular' as const);

      const snapDate = currentSnapshot?.snapshotDate || '';
      let fallbackOnTime = 0;
      let fallbackLate = 0;
      let fallbackUnknown = 0;
      let fallbackPending = 0;

      // Synthesize fallback learners with proper temporal lateness logic
      const fallbackLearners: LearnerAssignmentStatus[] = records.map((r) => {
        const student = studentMap.get(r.studentId);
        let status: SubmissionLatenessStatus = 'not_submitted';
        let windowText: string | null = null;

        const isPassed = r.status === 'PASSED' || r.status === 'SUBMITTED';
        const isDelayed = r.status === 'DELAYED' || r.status?.includes('DELAYED');

        if (isDelayed) {
          status = 'late';
          fallbackLate++;
          windowText = 'Marked delayed by LMS';
        } else if (isPassed) {
          if (!dueDate) {
            status = 'no_due_date';
          } else if (snapDate && snapDate <= dueDate) {
            status = 'on_time';
            fallbackOnTime++;
            windowText = `Submitted on or before ${dueDate}`;
          } else {
            status = 'unknown';
            fallbackUnknown++;
            windowText = `Timing unknown (submitted by ${snapDate || 'current report'})`;
          }
        } else {
          status = 'not_submitted';
          fallbackPending++;
        }

        return {
          studentId: r.studentId,
          studentName: student?.name || r.studentId,
          phoneE164: student?.phoneE164 || '',
          lmsAssignmentName: name,
          status,
          submissionDateEstimate: windowText,
          windowStart: null,
          windowEnd: snapDate || null,
          windowText,
          firstSubmittedSnapshotDate: isPassed || isDelayed ? snapDate : null,
          lastPendingSnapshotDate: null,
          rawStatus: r.status,
          score: r.score,
          dueDate,
        };
      });

      return {
        name,
        dueDate,
        hasDueDate: Boolean(dueDate),
        type,
        total,
        submitted,
        onTime: fallbackOnTime,
        late: fallbackLate,
        possiblyLate: 0,
        unknown: fallbackUnknown,
        pending: fallbackPending,
        submissionRate,
        avgScore,
        learners: fallbackLearners,
      };
    });
  }, [latenessReport, rawAssignmentMap, studentMap, selectedBatchId, currentSnapshot?.snapshotDate]);

  // Selected assignment for the learner drawer
  const activeAssignment = useMemo(() => {
    if (!selectedAssignmentName) return null;
    return assignmentCards.find((a) => a.name === selectedAssignmentName) || null;
  }, [selectedAssignmentName, assignmentCards]);

  // Filtered learners in the drawer
  const drawerLearners = useMemo(() => {
    if (!activeAssignment) return [];
    let list = activeAssignment.learners;

    if (drawerFilter !== 'all') {
      list = list.filter((l) => l.status === drawerFilter);
    }

    const query = deferredSearch.toLowerCase().trim();
    if (query) {
      list = list.filter((l) => {
        const student = studentMap.get(l.studentId);
        const name = (student?.name || l.studentName || '').toLowerCase();
        const phone = (student?.phoneE164 || l.phoneE164 || '').toLowerCase();
        return name.includes(query) || phone.includes(query) || l.studentId.toLowerCase().includes(query);
      });
    }

    return list;
  }, [activeAssignment, drawerFilter, deferredSearch, studentMap]);

  const openDrawer = (assignmentName: string, initialFilter: 'all' | SubmissionLatenessStatus = 'all') => {
    setSelectedAssignmentName(assignmentName);
    setDrawerFilter(initialFilter);
    setSearch('');
  };

  const closeDrawer = () => {
    setSelectedAssignmentName(null);
    setSearch('');
    setDrawerFilter('all');
  };

  const navigateToScheduleSettings = () => {
    setSettingsSubTab('schedule');
    setActiveTab('settings');
  };

  return (
    <div className="space-y-6">
      {/* Warning Banners */}
      {latenessReport && latenessReport.missingDueDatesCount > 0 && (
        <div className="p-3.5 bg-amber-50/90 border border-amber-200/80 rounded-xl flex items-center justify-between gap-3 text-xs text-amber-900 shadow-sm">
          <div className="flex items-center gap-2.5">
            <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0" />
            <span>
              <strong>{latenessReport.missingDueDatesCount}</strong> assignment
              {latenessReport.missingDueDatesCount > 1 ? 's have' : ' has'} no due date set. Lateness
              cannot be calculated for {latenessReport.missingDueDatesCount > 1 ? 'them' : 'it'}.
            </span>
          </div>
          <Button
            size="sm"
            variant="outline"
            onClick={navigateToScheduleSettings}
            className="shrink-0 text-amber-900 border-amber-300 hover:bg-amber-100/60 bg-white/80 text-xs font-semibold"
          >
            <Calendar className="w-3.5 h-3.5 mr-1" />
            Set due dates
          </Button>
        </div>
      )}

      {latenessReport && latenessReport.staleUploadWarning && (
        <div className="p-3 bg-blue-50/80 border border-blue-200 rounded-xl flex items-center gap-2.5 text-xs text-blue-900 shadow-sm">
          <Info className="w-4 h-4 text-blue-600 shrink-0" />
          <span>
            Last upload was <strong>{latenessReport.daysSinceLastUpload} days ago</strong> (expected ~7).
            Lateness windows may be wider than usual.
          </span>
        </div>
      )}

      {/* Breakdown Chart */}
      <Card
        title={
          <div className="flex items-center gap-2">
            <span>Assignment Performance Breakdown</span>
            {isLoadingLateness && <Loader2 className="w-3.5 h-3.5 animate-spin text-teal-600" />}
          </div>
        }
        subtitle={`Submission status breakdown across ${assignmentCards.length} curriculum assignments for report date ${currentSnapshot.snapshotDate}`}
      >
        <div className="h-[280px] w-full">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={assignmentCards} margin={{ top: 10, right: 20, left: -10, bottom: 20 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
              <XAxis dataKey="name" tick={{ fontSize: 10 }} interval={0} angle={-15} textAnchor="end" />
              <YAxis tick={{ fontSize: 11 }} />
              <Tooltip
                contentStyle={{
                  backgroundColor: '#ffffff',
                  borderRadius: '8px',
                  border: '1px solid #e2e8f0',
                  fontSize: '12px',
                }}
              />
              <Legend wrapperStyle={{ fontSize: '11px', paddingTop: '16px' }} />
              <Bar dataKey="onTime" name="On Time" fill="#10b981" stackId="a" />
              <Bar dataKey="late" name="Late (Certain)" fill="#f43f5e" stackId="a" />
              <Bar dataKey="possiblyLate" name="Possibly Late" fill="#f59e0b" stackId="a" />
              <Bar dataKey="unknown" name="Timing Unknown" fill="#8b5cf6" stackId="a" />
              <Bar dataKey="pending" name="Pending / Not Submitted" fill="#94a3b8" stackId="a" />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </Card>

      {/* Grid of Assignment Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {assignmentCards.map((asgn) => (
          <Card key={asgn.name} className="relative transition-all hover:border-slate-300">
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="flex items-center gap-2 flex-wrap">
                  <h4 className="text-sm font-bold text-slate-900">{asgn.name}</h4>
                  {asgn.type === 'module_end' && (
                    <span className="px-2 py-0.5 rounded text-[10px] font-semibold bg-indigo-50 text-indigo-700 border border-indigo-200">
                      Module-End
                    </span>
                  )}
                </div>

                <div className="flex items-center gap-2 mt-1 text-xs text-slate-500 flex-wrap">
                  {asgn.hasDueDate && asgn.dueDate ? (
                    <span className="flex items-center gap-1 font-mono text-slate-700">
                      <Calendar className="w-3 h-3 text-slate-400" />
                      Due: <strong>{asgn.dueDate}</strong>
                    </span>
                  ) : (
                    <button
                      type="button"
                      onClick={navigateToScheduleSettings}
                      className="flex items-center gap-1 text-amber-600 hover:text-amber-700 font-medium hover:underline"
                    >
                      <AlertTriangle className="w-3 h-3" />
                      No due date set
                    </button>
                  )}
                  <span>•</span>
                  <span>
                    Submission Rate: <strong className="text-teal-700">{asgn.submissionRate}%</strong>
                  </span>
                  {asgn.avgScore !== null && (
                    <>
                      <span>•</span>
                      <span>
                        Avg: <strong className="text-slate-700">{asgn.avgScore}/{getAssignmentMaxScore(asgn.name, asgn.type)}</strong>
                      </span>
                    </>
                  )}
                </div>
              </div>

              <Button
                size="sm"
                variant="outline"
                onClick={() => openDrawer(asgn.name, 'all')}
                className="text-xs shrink-0"
              >
                <Users className="w-3.5 h-3.5 text-slate-500 mr-1" />
                Learners ({asgn.total})
              </Button>
            </div>

            {/* Metrics Status Grid */}
            <div className="grid grid-cols-3 gap-2 mt-4 text-center">
              {/* On Time Box */}
              <div
                className="bg-emerald-50/70 p-2.5 rounded-lg border border-emerald-100 cursor-pointer hover:bg-emerald-100/70 transition-colors"
                onClick={() => openDrawer(asgn.name, 'on_time')}
                title="Click to view learners who submitted on or before the due date"
              >
                <div className="flex items-center justify-center gap-1 text-emerald-700 text-xs font-semibold">
                  <CheckCircle2 className="w-3.5 h-3.5" /> On Time
                </div>
                <p className="text-lg font-bold font-mono text-emerald-800 mt-1">{asgn.onTime}</p>
                <p className="text-[10px] text-emerald-600 mt-0.5">Submitted ≤ due date</p>
              </div>

              {/* Late Box (Replaces single Delayed count) */}
              <div
                className="bg-rose-50/80 p-2.5 rounded-lg border border-rose-200 cursor-pointer hover:bg-rose-100/80 transition-colors"
                onClick={() => openDrawer(asgn.name, 'late')}
                title="Click to view late submissions and timing windows"
              >
                <div className="flex items-center justify-center gap-1 text-rose-700 text-xs font-semibold">
                  <AlertTriangle className="w-3.5 h-3.5 text-rose-600" /> Late
                </div>
                <p className="text-lg font-bold font-mono text-rose-800 mt-1">{asgn.late}</p>

                {/* Sub-chips: Possibly late: X and Timing unknown: Y */}
                <div className="flex flex-col gap-1 mt-1 text-[10px]">
                  <span
                    className="px-1.5 py-0.5 rounded bg-amber-100 text-amber-800 font-medium hover:bg-amber-200 cursor-pointer text-center"
                    onClick={(e) => {
                      e.stopPropagation();
                      openDrawer(asgn.name, 'possibly_late');
                    }}
                  >
                    Possibly late: {asgn.possiblyLate}
                  </span>
                  <span
                    className="px-1.5 py-0.5 rounded bg-slate-200 text-slate-700 font-medium hover:bg-slate-300 cursor-pointer text-center"
                    onClick={(e) => {
                      e.stopPropagation();
                      openDrawer(asgn.name, 'unknown');
                    }}
                  >
                    Timing unknown: {asgn.unknown}
                  </span>
                </div>
              </div>

              {/* Pending / Not Submitted Box */}
              <div
                className="bg-slate-50 p-2.5 rounded-lg border border-slate-200 cursor-pointer hover:bg-slate-100 transition-colors"
                onClick={() => openDrawer(asgn.name, 'not_submitted')}
                title="Click to view pending non-submitters"
              >
                <div className="flex items-center justify-center gap-1 text-slate-700 text-xs font-semibold">
                  <XCircle className="w-3.5 h-3.5 text-slate-500" /> Pending
                </div>
                <p className="text-lg font-bold font-mono text-slate-800 mt-1">{asgn.pending}</p>
                <p className="text-[10px] text-slate-500 mt-0.5">Not yet submitted</p>
              </div>
            </div>

            {/* Note / Tooltip explaining estimation logic */}
            <div className="flex items-start gap-1.5 mt-3 p-2 bg-slate-50 rounded-md border border-slate-100 text-[10px] text-slate-500">
              <Info className="w-3 h-3 text-slate-400 shrink-0 mt-0.5" />
              <span>
                <strong>Late</strong> = submitted after due date based on snapshot dates. Window:{' '}
                <code className="text-slate-600 font-mono">(earlier upload date, submission upload date]</code>.
              </span>
            </div>
          </Card>
        ))}
      </div>

      {/* Learner Drawer (Slide-over) */}
      {activeAssignment && (
        <div className="fixed inset-0 z-50 overflow-hidden">
          {/* Backdrop */}
          <div
            className="absolute inset-0 bg-slate-900/40 backdrop-blur-sm transition-opacity"
            onClick={closeDrawer}
          />

          <div className="fixed inset-y-0 right-0 max-w-full flex pl-10">
            <div className="w-screen max-w-xl bg-white shadow-2xl flex flex-col">
              {/* Drawer Header */}
              <div className="p-5 border-b border-slate-200 bg-slate-50/50">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="flex items-center gap-2">
                      <h3 className="text-base font-bold text-slate-900">
                        {activeAssignment.name}
                      </h3>
                      {activeAssignment.type === 'module_end' && (
                        <span className="px-2 py-0.5 rounded text-[10px] font-semibold bg-indigo-50 text-indigo-700 border border-indigo-200">
                          Module-End
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-slate-500 mt-1 flex items-center gap-2">
                      {activeAssignment.hasDueDate && activeAssignment.dueDate ? (
                        <span>
                          Due date: <strong className="text-slate-700 font-mono">{activeAssignment.dueDate}</strong>
                        </span>
                      ) : (
                        <span className="text-amber-600 font-medium flex items-center gap-1">
                          <AlertTriangle className="w-3 h-3" /> No due date configured
                        </span>
                      )}
                      <span>•</span>
                      <span>Total: {activeAssignment.total} learners</span>
                    </p>
                  </div>

                  <button
                    type="button"
                    onClick={closeDrawer}
                    className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-200/60 transition-colors"
                  >
                    <X className="w-5 h-5" />
                  </button>
                </div>

                {/* Status Filter Tabs */}
                <div className="flex items-center gap-1.5 mt-4 overflow-x-auto pb-1 text-xs">
                  <button
                    type="button"
                    onClick={() => setDrawerFilter('all')}
                    className={`px-2.5 py-1 rounded-md font-medium whitespace-nowrap transition-colors ${
                      drawerFilter === 'all'
                        ? 'bg-slate-900 text-white'
                        : 'bg-white text-slate-600 hover:bg-slate-100 border border-slate-200'
                    }`}
                  >
                    All ({activeAssignment.total})
                  </button>
                  <button
                    type="button"
                    onClick={() => setDrawerFilter('late')}
                    className={`px-2.5 py-1 rounded-md font-medium whitespace-nowrap transition-colors ${
                      drawerFilter === 'late'
                        ? 'bg-rose-600 text-white'
                        : 'bg-rose-50 text-rose-700 hover:bg-rose-100 border border-rose-200'
                    }`}
                  >
                    Late ({activeAssignment.late})
                  </button>
                  <button
                    type="button"
                    onClick={() => setDrawerFilter('possibly_late')}
                    className={`px-2.5 py-1 rounded-md font-medium whitespace-nowrap transition-colors ${
                      drawerFilter === 'possibly_late'
                        ? 'bg-amber-600 text-white'
                        : 'bg-amber-50 text-amber-800 hover:bg-amber-100 border border-amber-200'
                    }`}
                  >
                    Possibly late ({activeAssignment.possiblyLate})
                  </button>
                  <button
                    type="button"
                    onClick={() => setDrawerFilter('unknown')}
                    className={`px-2.5 py-1 rounded-md font-medium whitespace-nowrap transition-colors ${
                      drawerFilter === 'unknown'
                        ? 'bg-purple-600 text-white'
                        : 'bg-purple-50 text-purple-800 hover:bg-purple-100 border border-purple-200'
                    }`}
                  >
                    Timing unknown ({activeAssignment.unknown})
                  </button>
                  <button
                    type="button"
                    onClick={() => setDrawerFilter('on_time')}
                    className={`px-2.5 py-1 rounded-md font-medium whitespace-nowrap transition-colors ${
                      drawerFilter === 'on_time'
                        ? 'bg-emerald-600 text-white'
                        : 'bg-emerald-50 text-emerald-800 hover:bg-emerald-100 border border-emerald-200'
                    }`}
                  >
                    On time ({activeAssignment.onTime})
                  </button>
                  <button
                    type="button"
                    onClick={() => setDrawerFilter('not_submitted')}
                    className={`px-2.5 py-1 rounded-md font-medium whitespace-nowrap transition-colors ${
                      drawerFilter === 'not_submitted'
                        ? 'bg-slate-600 text-white'
                        : 'bg-slate-100 text-slate-700 hover:bg-slate-200 border border-slate-200'
                    }`}
                  >
                    Pending ({activeAssignment.pending})
                  </button>
                </div>

                {/* Search Bar */}
                <div className="relative mt-3">
                  <Search className="w-3.5 h-3.5 absolute left-3 top-2.5 text-slate-400" />
                  <input
                    type="text"
                    placeholder="Search by learner name or phone..."
                    className="w-full text-xs border border-slate-300 rounded-lg pl-8 pr-3 py-1.5 focus:outline-none focus:ring-1 focus:ring-teal-500 bg-white"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                  />
                </div>
              </div>

              {/* Drawer Learners List */}
              <div className="flex-1 overflow-y-auto p-5 divide-y divide-slate-100">
                {drawerLearners.length === 0 ? (
                  <div className="py-12 text-center text-slate-400 text-xs">
                    No learners found matching this criteria.
                  </div>
                ) : (
                  drawerLearners.map((learner) => {
                    const student = studentMap.get(learner.studentId);
                    const displayName = formatStudentName(
                      student?.name || learner.studentName || learner.studentId,
                      settings.maskPii
                    );
                    const displayPhone = formatStudentPhone(
                      student?.phoneE164 || learner.phoneE164 || '',
                      settings.maskPii
                    );

                    return (
                      <div
                        key={learner.studentId}
                        className="py-3 flex items-start justify-between gap-3 hover:bg-slate-50/50 rounded-lg px-2 -mx-2 transition-colors"
                      >
                        <div className="space-y-1">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="text-xs font-bold text-slate-900">{displayName}</span>
                            <span className="text-[11px] font-mono text-slate-400">{displayPhone}</span>
                          </div>

                          {/* Submission Window / Description */}
                          {learner.windowText && (
                            <p className="text-[11px] text-slate-600 font-medium">
                              📅 {learner.windowText}
                            </p>
                          )}

                          {learner.firstSubmittedSnapshotDate && (
                            <p className="text-[10px] text-slate-400 font-mono">
                              First detected in report: {learner.firstSubmittedSnapshotDate}
                            </p>
                          )}

                          {learner.score !== null && (
                            <p className="text-[10px] text-slate-500">
                              LMS Status: <span className="font-semibold">{learner.rawStatus}</span> • Score:{' '}
                              <span className="font-semibold text-slate-800">
                                {learner.score}/{getAssignmentMaxScore(activeAssignment?.name || learner.lmsAssignmentName, activeAssignment?.type)}
                              </span>
                            </p>
                          )}
                        </div>

                        {/* Status Badge & Actions */}
                        <div className="flex flex-col items-end gap-1.5 shrink-0">
                          {learner.status === 'on_time' && (
                            <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-emerald-50 text-emerald-700 border border-emerald-200">
                              On Time
                            </span>
                          )}
                          {learner.status === 'late' && (
                            <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-rose-50 text-rose-700 border border-rose-200">
                              Late (Certain)
                            </span>
                          )}
                          {learner.status === 'possibly_late' && (
                            <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-amber-50 text-amber-800 border border-amber-200">
                              Possibly Late
                            </span>
                          )}
                          {learner.status === 'unknown' && (
                            <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-purple-50 text-purple-800 border border-purple-200">
                              Timing Unknown
                            </span>
                          )}
                          {learner.status === 'not_submitted' && (
                            <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-slate-100 text-slate-600 border border-slate-200">
                              Not Submitted
                            </span>
                          )}
                          {learner.status === 'no_due_date' && (
                            <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-slate-100 text-slate-500 border border-slate-200">
                              No Due Date
                            </span>
                          )}

                          <button
                            type="button"
                            onClick={() => {
                              closeDrawer();
                              setSelectedStudentId(learner.studentId);
                              setActiveTab('students');
                            }}
                            className="text-[11px] text-teal-700 hover:text-teal-900 font-medium flex items-center gap-0.5 mt-1"
                          >
                            View Profile
                            <ChevronRight className="w-3 h-3" />
                          </button>
                        </div>
                      </div>
                    );
                  })
                )}
              </div>

              {/* Drawer Footer */}
              <div className="p-4 border-t border-slate-200 bg-slate-50 flex items-center justify-between text-xs text-slate-500">
                <span>Showing {drawerLearners.length} learners</span>
                <Button size="sm" variant="outline" onClick={closeDrawer}>
                  Close
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
