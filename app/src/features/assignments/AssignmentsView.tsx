import React, { useState, useMemo, useDeferredValue } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { Card } from '@/ui/Card';
import { Button } from '@/ui/Button';
import { Modal } from '@/ui/Modal';
import { usePlatformStore } from '@/store/usePlatformStore';
import { formatStudentName, formatStudentPhone } from '@/core/identity/mask';
import type { AssignmentResult, Student, Snapshot } from '@/types';
import { Users, CheckCircle2, Clock, XCircle, Search } from 'lucide-react';
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid, Legend } from 'recharts';

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
  const { settings, setSelectedStudentId, setActiveTab } = usePlatformStore(
    useShallow((s) => ({
      settings: s.settings,
      setSelectedStudentId: s.setSelectedStudentId,
      setActiveTab: s.setActiveTab,
    }))
  );
  const [selectedAssignmentForModal, setSelectedAssignmentForModal] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const deferredSearch = useDeferredValue(search);

  // Memoize student lookup map by students array reference
  const studentMap = useMemo(
    () => new Map<string, Student>(students.map((s) => [s.id, s])),
    [students]
  );

  // Group assignments by assignmentName with memoization
  const assignmentMap = useMemo(() => {
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

  // Aggregate stats only when assignmentMap changes
  const assignmentStats = useMemo(() => {
    return Array.from(assignmentMap.entries()).map(([name, records]) => {
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

      return {
        name,
        total,
        submitted,
        passed,
        delayed,
        pending,
        submissionRate,
        avgScore,
        records,
      };
    });
  }, [assignmentMap]);

  const activeRecords = useMemo(() => {
    return selectedAssignmentForModal ? assignmentMap.get(selectedAssignmentForModal) || [] : [];
  }, [selectedAssignmentForModal, assignmentMap]);

  const pendingStudents = useMemo(() => {
    return activeRecords
      .filter((r) => r.status === 'SUBMISSION_PENDING' || r.status === 'NOT_SUBMITTED')
      .map((r) => ({
        record: r,
        student: studentMap.get(r.studentId),
      }));
  }, [activeRecords, studentMap]);

  const filteredPendingStudents = useMemo(() => {
    const query = deferredSearch.toLowerCase().trim();
    if (!query) return pendingStudents;

    return pendingStudents.filter(
      (item) =>
        item.student?.name.toLowerCase().includes(query) ||
        item.student?.phoneE164.includes(query) ||
        item.record.studentId.toLowerCase().includes(query)
    );
  }, [pendingStudents, deferredSearch]);

  return (
    <div className="space-y-6">
      {/* Chart */}
      <Card
        title="Assignment Performance Breakdown"
        subtitle={`Submission status breakdown across ${assignmentStats.length} curriculum assignments for ${currentSnapshot.snapshotDate}`}
      >
        <div className="h-[280px] w-full">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={assignmentStats} margin={{ top: 10, right: 20, left: -10, bottom: 20 }}>
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
              <Bar dataKey="passed" name="Passed" fill="#10b981" stackId="a" />
              <Bar dataKey="delayed" name="Delayed" fill="#f59e0b" stackId="a" />
              <Bar dataKey="pending" name="Pending / Not Submitted" fill="#ef4444" stackId="a" />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </Card>

      {/* Grid of Assignment Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {assignmentStats.map((asgn) => (
          <Card key={asgn.name} className="relative">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h4 className="text-sm font-bold text-slate-900">{asgn.name}</h4>
                <p className="text-xs text-slate-500 mt-0.5">
                  Submission Rate: <span className="font-semibold text-indigo-600">{asgn.submissionRate}%</span>
                  {asgn.avgScore !== null && (
                    <span> • Avg Score: <span className="font-semibold text-slate-700">{asgn.avgScore}/10</span></span>
                  )}
                </p>
              </div>
              <Button
                size="sm"
                variant="outline"
                onClick={() => setSelectedAssignmentForModal(asgn.name)}
                className="text-xs shrink-0"
              >
                <Users className="w-3.5 h-3.5 text-slate-500" /> Non-Submitters ({asgn.pending})
              </Button>
            </div>

            <div className="grid grid-cols-3 gap-2 mt-4 text-center">
              <div className="bg-emerald-50 p-2.5 rounded-lg border border-emerald-100">
                <div className="flex items-center justify-center gap-1 text-emerald-700 text-xs font-semibold">
                  <CheckCircle2 className="w-3.5 h-3.5" /> Passed
                </div>
                <p className="text-lg font-bold text-emerald-800 mt-1">{asgn.passed}</p>
              </div>

              <div className="bg-amber-50 p-2.5 rounded-lg border border-amber-100">
                <div className="flex items-center justify-center gap-1 text-amber-700 text-xs font-semibold">
                  <Clock className="w-3.5 h-3.5" /> Delayed
                </div>
                <p className="text-lg font-bold text-amber-800 mt-1">{asgn.delayed}</p>
              </div>

              <div className="bg-rose-50 p-2.5 rounded-lg border border-rose-100">
                <div className="flex items-center justify-center gap-1 text-rose-700 text-xs font-semibold">
                  <XCircle className="w-3.5 h-3.5" /> Pending
                </div>
                <p className="text-lg font-bold text-rose-800 mt-1">{asgn.pending}</p>
              </div>
            </div>
          </Card>
        ))}
      </div>

      {/* Non-Submitters Modal */}
      <Modal
        isOpen={!!selectedAssignmentForModal}
        onClose={() => setSelectedAssignmentForModal(null)}
        title={`Pending Submissions: ${selectedAssignmentForModal || ''}`}
        description={`${pendingStudents.length} students have not yet submitted this assignment`}
        maxWidth="lg"
      >
        <div className="space-y-4">
          <div className="relative">
            <Search className="w-3.5 h-3.5 absolute left-3 top-2.5 text-slate-400" />
            <input
              type="text"
              placeholder="Search students..."
              className="w-full text-xs border border-slate-300 rounded-lg pl-8 pr-3 py-1.5 focus:outline-none focus:ring-1 focus:ring-indigo-500"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>

          <div className="max-h-80 overflow-y-auto divide-y divide-slate-100">
            {filteredPendingStudents.map(({ record, student }) => (
                <div
                  key={record.studentId}
                  className="py-2.5 flex items-center justify-between"
                >
                  <div>
                    <p className="text-xs font-semibold text-slate-900">
                      {formatStudentName(student?.name || record.studentId, settings.maskPii)}
                    </p>
                    <p className="text-[11px] text-slate-500">
                      {formatStudentPhone(student?.phoneE164 || '', settings.maskPii)}
                    </p>
                  </div>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="text-xs text-indigo-600"
                    onClick={() => {
                      setSelectedAssignmentForModal(null);
                      setSelectedStudentId(record.studentId);
                      setActiveTab('students');
                    }}
                  >
                    View Profile
                  </Button>
                </div>
              ))}
          </div>
        </div>
      </Modal>
    </div>
  );
};
