import React, { useState } from 'react';
import { Card } from '@/ui/Card';
import { Button } from '@/ui/Button';
import { SegmentBadge } from '@/ui/Badge';
import { usePlatformStore } from '@/store/usePlatformStore';
import { formatStudentName, formatStudentPhone } from '@/core/identity/mask';
import { db } from '@/core/db';
import type {
  Student,
  StudentSnapshot,
  Snapshot,
  AssignmentResult,
  WeeklyConsumption,
  Session,
  AttendanceRecord,
  FollowUp,
} from '@/types';
import { useLiveQuery } from 'dexie-react-hooks';
import {
  User,
  Phone,
  Hash,
  Calendar,
  CheckCircle,
  Clock,
  XCircle,
  Search,
} from 'lucide-react';
import { ResponsiveContainer, LineChart, Line, XAxis, YAxis, Tooltip, CartesianGrid } from 'recharts';

interface StudentProfileViewProps {
  students: Student[];
  snapshots: Snapshot[];
  allStudentSnapshots: StudentSnapshot[];
  assignmentResults: AssignmentResult[];
  weeklyConsumption: WeeklyConsumption[];
  sessions: Session[];
  attendance: AttendanceRecord[];
}

export const StudentProfileView: React.FC<StudentProfileViewProps> = ({
  students,
  snapshots,
  allStudentSnapshots,
  assignmentResults,
  weeklyConsumption,
  sessions,
  attendance,
}) => {
  const { selectedStudentId, setSelectedStudentId, settings } = usePlatformStore();
  const [search, setSearch] = useState('');
  const [newNote, setNewNote] = useState('');
  const [newStatus, setNewStatus] = useState<'PENDING' | 'IN_PROGRESS' | 'RESOLVED'>('PENDING');

  // If no student is selected, select the first student by default
  const activeStudentId = selectedStudentId || students[0]?.id || '';
  const student = students.find((s) => s.id === activeStudentId);

  // Live query for follow-ups for this student
  const followups =
    useLiveQuery(
      () =>
        activeStudentId
          ? db.followups.where('studentId').equals(activeStudentId).reverse().sortBy('updatedAt')
          : [],
      [activeStudentId]
    ) || [];

  // Sort snapshots chronologically
  const sortedSnapshots = [...snapshots].sort((a, b) =>
    a.snapshotDate.localeCompare(b.snapshotDate)
  );

  // Student history across snapshots
  const studentHistory = sortedSnapshots
    .map((snap) => {
      const snapRecord = allStudentSnapshots.find(
        (s) => s.snapshotId === snap.id && s.studentId === activeStudentId
      );
      if (!snapRecord) return null;
      return {
        date: snap.snapshotDate,
        consumption: snapRecord.metrics.totalConsumptionPct,
        assignment: snapRecord.metrics.assignmentSubmissionPct,
        liveAttendance: snapRecord.metrics.liveClassPct,
        liveOrRec: snapRecord.metrics.liveOrRecordingPct,
      };
    })
    .filter(Boolean);

  // Latest snapshot metrics for this student
  const latestSnapshot = sortedSnapshots[sortedSnapshots.length - 1];
  const latestMetrics = allStudentSnapshots.find(
    (s) => s.snapshotId === latestSnapshot?.id && s.studentId === activeStudentId
  );

  // Assignments for this student
  const studentAssignments = assignmentResults.filter(
    (a) => a.studentId === activeStudentId && a.snapshotId === latestSnapshot?.id
  );

  // Weekly consumption
  const studentWeekly = weeklyConsumption
    .filter((w) => w.studentId === activeStudentId && w.snapshotId === latestSnapshot?.id)
    .sort((a, b) => a.weekNo - b.weekNo);

  // Attendance
  const studentAttendance = attendance.filter(
    (a) => a.studentId === activeStudentId
  );
  const sessionMap = new Map(sessions.map((s) => [s.id, s]));

  const handleAddFollowup = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newNote.trim() || !activeStudentId) return;

    const followupRecord: FollowUp = {
      id: `flw_${Date.now()}`,
      studentId: activeStudentId,
      snapshotId: latestSnapshot?.id || '',
      note: newNote.trim(),
      status: newStatus,
      updatedAt: Date.now(),
    };

    await db.followups.put(followupRecord);
    setNewNote('');
  };

  const filteredStudentList = students.filter(
    (s) =>
      !search ||
      s.name.toLowerCase().includes(search.toLowerCase()) ||
      s.phoneE164.includes(search) ||
      s.externalStudentId.includes(search)
  );

  return (
    <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
      {/* Left Sidebar: Student Directory */}
      <div className="lg:col-span-1 space-y-4">
        <Card className="p-3">
          <div className="relative mb-3">
            <Search className="w-3.5 h-3.5 absolute left-3 top-2.5 text-slate-400" />
            <input
              type="text"
              placeholder="Search students..."
              className="w-full text-xs border border-slate-300 rounded-lg pl-8 pr-3 py-1.5 focus:outline-none focus:ring-1 focus:ring-indigo-500"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>

          <div className="max-h-[600px] overflow-y-auto divide-y divide-slate-100">
            {filteredStudentList.map((s) => {
              const snapRecord = allStudentSnapshots.find(
                (rec) => rec.snapshotId === latestSnapshot?.id && rec.studentId === s.id
              );
              const isSelected = s.id === activeStudentId;

              return (
                <div
                  key={s.id}
                  onClick={() => setSelectedStudentId(s.id)}
                  className={`p-2.5 rounded-lg cursor-pointer transition-colors ${
                    isSelected
                      ? 'bg-indigo-50 border border-indigo-200'
                      : 'hover:bg-slate-50'
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <p className={`text-xs font-semibold ${isSelected ? 'text-indigo-900' : 'text-slate-900'}`}>
                      {formatStudentName(s.name, settings.maskPii)}
                    </p>
                    {snapRecord && <SegmentBadge segment={snapRecord.segment} />}
                  </div>
                  <p className="text-[10px] text-slate-400 mt-0.5">
                    ID: {s.externalStudentId} • {formatStudentPhone(s.phoneE164, settings.maskPii)}
                  </p>
                </div>
              );
            })}
          </div>
        </Card>
      </div>

      {/* Right Column: Student Profile Details */}
      <div className="lg:col-span-3 space-y-6">
        {student ? (
          <>
            {/* Header Card */}
            <Card className="bg-gradient-to-r from-slate-900 to-indigo-950 text-white border-0">
              <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                <div className="flex items-center gap-4">
                  <div className="w-14 h-14 rounded-2xl bg-indigo-500/20 border border-indigo-400/30 flex items-center justify-center text-indigo-300">
                    <User className="w-7 h-7" />
                  </div>
                  <div>
                    <div className="flex items-center gap-2.5">
                      <h2 className="text-xl font-extrabold text-white">
                        {formatStudentName(student.name, settings.maskPii)}
                      </h2>
                      {latestMetrics && <SegmentBadge segment={latestMetrics.segment} />}
                    </div>
                    <div className="flex items-center gap-4 text-xs text-slate-300 mt-1">
                      <span className="flex items-center gap-1">
                        <Hash className="w-3.5 h-3.5 text-indigo-400" />
                        ID: {student.externalStudentId}
                      </span>
                      <span className="flex items-center gap-1">
                        <Phone className="w-3.5 h-3.5 text-indigo-400" />
                        {formatStudentPhone(student.phoneE164, settings.maskPii)}
                      </span>
                    </div>
                  </div>
                </div>

                {latestMetrics && (
                  <div className="flex items-center gap-3 bg-white/10 backdrop-blur-xs p-3 rounded-xl border border-white/10">
                    <div className="text-center px-2">
                      <p className="text-base font-bold text-white">{latestMetrics.metrics.totalConsumptionPct}%</p>
                      <p className="text-[10px] text-indigo-200">Consumption</p>
                    </div>
                    <div className="w-px h-7 bg-white/20" />
                    <div className="text-center px-2">
                      <p className="text-base font-bold text-white">{latestMetrics.metrics.assignmentSubmissionPct}%</p>
                      <p className="text-[10px] text-indigo-200">Assignments</p>
                    </div>
                    <div className="w-px h-7 bg-white/20" />
                    <div className="text-center px-2">
                      <p className="text-base font-bold text-white">{latestMetrics.metrics.liveClassPct}%</p>
                      <p className="text-[10px] text-indigo-200">Live Attendance</p>
                    </div>
                  </div>
                )}
              </div>
            </Card>

            {/* Metric History Chart */}
            <Card
              title="Progress Trajectory Over Snapshots"
              subtitle="Assignments, consumption, and attendance tracked across dated snapshots"
            >
              {studentHistory.length > 0 ? (
                <div className="h-[220px] w-full">
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={studentHistory} margin={{ top: 10, right: 20, left: -10, bottom: 0 }}>
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
                      <Line
                        type="monotone"
                        dataKey="consumption"
                        name="Consumption %"
                        stroke="#10b981"
                        strokeWidth={2}
                      />
                      <Line
                        type="monotone"
                        dataKey="assignment"
                        name="Assignment %"
                        stroke="#6366f1"
                        strokeWidth={2}
                      />
                      <Line
                        type="monotone"
                        dataKey="liveAttendance"
                        name="Live %"
                        stroke="#0284c7"
                        strokeWidth={2}
                      />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              ) : (
                <div className="p-8 text-center text-xs text-slate-400">
                  No snapshot history available for this student.
                </div>
              )}
            </Card>

            {/* Assignments & Weekly Consumption Grid */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {/* Assignment Submissions */}
              <Card title="Assignment Submissions" subtitle="Status and scores on assignments">
                <div className="space-y-2 max-h-64 overflow-y-auto">
                  {studentAssignments.length === 0 ? (
                    <p className="text-xs text-slate-400 p-4 text-center">No assignments recorded.</p>
                  ) : (
                    studentAssignments.map((a, i) => (
                      <div
                        key={i}
                        className="flex items-center justify-between p-2.5 rounded-lg border border-slate-100 bg-slate-50/50"
                      >
                        <div className="max-w-[70%]">
                          <p className="text-xs font-semibold text-slate-900 truncate">
                            {a.assignmentName}
                          </p>
                          <p className="text-[10px] text-slate-500">
                            Score: {a.score !== null ? `${a.score}/${a.maxScore || 10}` : 'N/A'}
                          </p>
                        </div>
                        <div>
                          {a.status === 'PASSED' ? (
                            <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded border border-emerald-200">
                              <CheckCircle className="w-3 h-3" /> Passed
                            </span>
                          ) : a.status === 'DELAYED' ? (
                            <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-amber-700 bg-amber-50 px-2 py-0.5 rounded border border-amber-200">
                              <Clock className="w-3 h-3" /> Delayed
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-rose-700 bg-rose-50 px-2 py-0.5 rounded border border-rose-200">
                              <XCircle className="w-3 h-3" /> Pending
                            </span>
                          )}
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </Card>

              {/* Weekly Consumption */}
              <Card title="Weekly Content Consumption" subtitle="Items consumed vs total assigned">
                <div className="grid grid-cols-2 gap-2 max-h-64 overflow-y-auto">
                  {studentWeekly.map((w) => {
                    const pct = w.total > 0 ? Math.round((w.consumed / w.total) * 100) : 0;
                    return (
                      <div
                        key={w.weekNo}
                        className="p-2.5 rounded-lg border border-slate-100 bg-slate-50/50 flex items-center justify-between"
                      >
                        <div>
                          <p className="text-xs font-semibold text-slate-800">Week {w.weekNo}</p>
                          <p className="text-[10px] text-slate-500">
                            {w.consumed} / {w.total} items
                          </p>
                        </div>
                        <span
                          className={`text-xs font-bold px-2 py-0.5 rounded ${
                            pct >= 80
                              ? 'bg-emerald-100 text-emerald-800'
                              : pct >= 50
                              ? 'bg-amber-100 text-amber-800'
                              : 'bg-rose-100 text-rose-800'
                          }`}
                        >
                          {pct}%
                        </span>
                      </div>
                    );
                  })}
                </div>
              </Card>
            </div>

            {/* Attendance Timeline */}
            <Card
              title="Recent Live Attendance Timeline"
              subtitle="Attendance record for live class sessions"
            >
              <div className="flex gap-2 overflow-x-auto pb-2">
                {studentAttendance.slice(0, 15).map((att, i) => {
                  const sess = sessionMap.get(att.sessionId);
                  const isPresent = att.liveStatus === 'PRESENT';
                  return (
                    <div
                      key={i}
                      className={`min-w-[90px] p-2 rounded-lg border text-center ${
                        isPresent
                          ? 'bg-emerald-50 border-emerald-200 text-emerald-900'
                          : 'bg-rose-50 border-rose-200 text-rose-900'
                      }`}
                    >
                      <p className="text-[10px] font-semibold">
                        {sess?.sessionDate ? sess.sessionDate.slice(5) : `Sess ${i + 1}`}
                      </p>
                      <p className="text-xs font-bold mt-0.5">
                        {att.liveStatus}
                      </p>
                    </div>
                  );
                })}
              </div>
            </Card>

            {/* Follow-up Notes and Intervention Log */}
            <Card
              title="Follow-up Notes & Mentor Interventions"
              subtitle="Notes are securely persisted locally on this device"
            >
              <form onSubmit={handleAddFollowup} className="space-y-3 mb-4">
                <textarea
                  className="w-full text-xs border border-slate-300 rounded-lg p-2.5 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                  rows={2}
                  placeholder="Record an intervention, call note, or follow-up action for this student..."
                  value={newNote}
                  onChange={(e) => setNewNote(e.target.value)}
                />
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-slate-500 font-medium">Status:</span>
                    <select
                      className="text-xs border border-slate-300 rounded-lg px-2.5 py-1 bg-white focus:outline-none"
                      value={newStatus}
                      onChange={(e) =>
                        setNewStatus(e.target.value as 'PENDING' | 'IN_PROGRESS' | 'RESOLVED')
                      }
                    >
                      <option value="PENDING">Pending</option>
                      <option value="IN_PROGRESS">In Progress</option>
                      <option value="RESOLVED">Resolved</option>
                    </select>
                  </div>
                  <Button size="sm" type="submit" disabled={!newNote.trim()}>
                    Save Follow-up
                  </Button>
                </div>
              </form>

              {/* Followups List */}
              <div className="space-y-2 divide-y divide-slate-100">
                {followups.length === 0 ? (
                  <p className="text-xs text-slate-400 p-3 text-center">
                    No follow-up notes recorded yet for this student.
                  </p>
                ) : (
                  followups.map((f) => (
                    <div key={f.id} className="pt-2.5 flex items-start justify-between gap-3">
                      <div>
                        <p className="text-xs text-slate-800">{f.note}</p>
                        <p className="text-[10px] text-slate-400 flex items-center gap-1 mt-1">
                          <Calendar className="w-3 h-3" />
                          {new Date(f.updatedAt).toLocaleDateString()} at{' '}
                          {new Date(f.updatedAt).toLocaleTimeString([], {
                            hour: '2-digit',
                            minute: '2-digit',
                          })}
                        </p>
                      </div>
                      <span
                        className={`text-[10px] font-semibold px-2 py-0.5 rounded shrink-0 ${
                          f.status === 'RESOLVED'
                            ? 'bg-emerald-100 text-emerald-800'
                            : f.status === 'IN_PROGRESS'
                            ? 'bg-indigo-100 text-indigo-800'
                            : 'bg-amber-100 text-amber-800'
                        }`}
                      >
                        {f.status}
                      </span>
                    </div>
                  ))
                )}
              </div>
            </Card>
          </>
        ) : (
          <div className="p-12 text-center text-xs text-slate-400">
            Select a student to view their detailed performance profile.
          </div>
        )}
      </div>
    </div>
  );
};
