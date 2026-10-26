import React, { useState } from 'react';
import { Card } from '@/ui/Card';
import { Button } from '@/ui/Button';
import { SegmentBadge } from '@/ui/Badge';
import { usePlatformStore } from '@/store/usePlatformStore';
import { formatStudentName, formatStudentPhone } from '@/core/identity/mask';
import type { Session, AttendanceRecord, StudentSnapshot, Student, Snapshot } from '@/types';
import { Radio, Search, PlayCircle } from 'lucide-react';
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid } from 'recharts';

interface AttendanceViewProps {
  currentSnapshot: Snapshot;
  sessions: Session[];
  attendance: AttendanceRecord[];
  studentSnapshots: StudentSnapshot[];
  students: Student[];
}

export const AttendanceView: React.FC<AttendanceViewProps> = ({
  currentSnapshot,
  sessions,
  attendance,
  studentSnapshots,
  students,
}) => {
  const { settings, setSelectedStudentId, setActiveTab } = usePlatformStore();
  const [search, setSearch] = useState('');
  const [filterRecordingOnly, setFilterRecordingOnly] = useState(false);

  const studentMap = new Map<string, Student>(students.map((s) => [s.id, s]));

  // Session-wise attendance rates
  const sortedSessions = [...sessions].sort((a, b) => a.orderIndex - b.orderIndex);
  const sessionStats = sortedSessions.map((sess) => {
    const sessionAtt = attendance.filter((a) => a.sessionId === sess.id);
    const total = sessionAtt.length;
    const presentLive = sessionAtt.filter((a) => a.liveStatus === 'PRESENT').length;
    const presentRec = sessionAtt.filter((a) => a.liveOrRecStatus === 'PRESENT').length;

    const liveRate = total > 0 ? Number(((presentLive / total) * 100).toFixed(1)) : 0;
    const recRate = total > 0 ? Number(((presentRec / total) * 100).toFixed(1)) : 0;

    return {
      sessionTitle: sess.title.slice(0, 18) + '...',
      fullTitle: sess.title,
      sessionDate: sess.sessionDate,
      liveRate,
      recRate,
      presentLive,
      presentRec,
      total,
    };
  });

  // Identify Recording-Only learners (Live < 30% and Live+Rec > 70%)
  const recordingOnlyLearners = studentSnapshots.filter(
    (s) => s.metrics.liveClassPct < 30 && s.metrics.liveOrRecordingPct > 70
  );

  const displayedSnapshots = studentSnapshots.filter((s) => {
    const student = studentMap.get(s.studentId);
    const matchesSearch =
      !search ||
      student?.name.toLowerCase().includes(search.toLowerCase()) ||
      student?.phoneE164.includes(search);
    const matchesRecordingOnly = !filterRecordingOnly || (s.metrics.liveClassPct < 30 && s.metrics.liveOrRecordingPct > 70);
    return matchesSearch && matchesRecordingOnly;
  });

  return (
    <div className="space-y-6">
      {/* Recording Only Notice Card */}
      {recordingOnlyLearners.length > 0 && (
        <div className="p-4 bg-amber-50 border border-amber-200 rounded-xl text-xs flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-amber-100 text-amber-800">
              <PlayCircle className="w-5 h-5" />
            </div>
            <div>
              <p className="font-bold text-amber-900 text-sm">
                {recordingOnlyLearners.length} Recording-Only Learner(s) Detected
              </p>
              <p className="text-amber-700 mt-0.5">
                Students attending &lt;30% of live classes, but maintaining &gt;70% attendance via recording playback.
              </p>
            </div>
          </div>
          <Button
            size="sm"
            variant="outline"
            className="border-amber-300 text-amber-900 hover:bg-amber-100 shrink-0"
            onClick={() => setFilterRecordingOnly(!filterRecordingOnly)}
          >
            {filterRecordingOnly ? 'Show All Students' : 'Filter Recording-Only'}
          </Button>
        </div>
      )}

      {/* Session-wise Attendance Trend */}
      <Card
        title="Session-by-Session Attendance Rate"
        subtitle={`Live vs Recording-adjusted attendance across ${sessions.length} sessions for ${currentSnapshot.snapshotDate}`}
      >
        <div className="h-[280px] w-full">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={sessionStats} margin={{ top: 10, right: 20, left: -10, bottom: 25 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
              <XAxis dataKey="sessionDate" tick={{ fontSize: 10 }} angle={-30} textAnchor="end" />
              <YAxis domain={[0, 100]} tick={{ fontSize: 11 }} />
              <Tooltip
                contentStyle={{
                  backgroundColor: '#ffffff',
                  borderRadius: '8px',
                  border: '1px solid #e2e8f0',
                  fontSize: '12px',
                }}
              />
              <Bar dataKey="liveRate" name="Live Class %" fill="#0284c7" radius={[4, 4, 0, 0]} />
              <Bar dataKey="recRate" name="Live + Recording %" fill="#f59e0b" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </Card>

      {/* Student Attendance List */}
      <Card
        title="Student Attendance Summary"
        subtitle="Comparing synchronous live attendance vs asynchronous recording consumption"
        action={
          <div className="relative w-64">
            <Search className="w-3.5 h-3.5 absolute left-3 top-2.5 text-slate-400" />
            <input
              type="text"
              placeholder="Filter by name or phone..."
              className="w-full text-xs border border-slate-300 rounded-lg pl-8 pr-3 py-1.5 focus:outline-none focus:ring-1 focus:ring-indigo-500"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
        }
      >
        <div className="overflow-x-auto">
          <table className="w-full text-xs text-left">
            <thead className="bg-slate-50 text-slate-600 font-semibold uppercase tracking-wider">
              <tr>
                <th className="px-3 py-2.5">Student</th>
                <th className="px-3 py-2.5">Segment</th>
                <th className="px-3 py-2.5 text-right">Live Class %</th>
                <th className="px-3 py-2.5 text-right">Live + Recording %</th>
                <th className="px-3 py-2.5 text-right">Attended / Total</th>
                <th className="px-3 py-2.5 text-right">Pattern</th>
                <th className="px-3 py-2.5 text-right">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {displayedSnapshots.map((item) => {
                const student = studentMap.get(item.studentId);
                const isRecOnly =
                  item.metrics.liveClassPct < 30 && item.metrics.liveOrRecordingPct > 70;

                return (
                  <tr key={item.studentId} className="hover:bg-slate-50/80 transition-colors">
                    <td className="px-3 py-2.5">
                      <p className="font-semibold text-slate-900">
                        {formatStudentName(student?.name || item.studentId, settings.maskPii)}
                      </p>
                      <p className="text-[10px] text-slate-400">
                        {formatStudentPhone(student?.phoneE164 || '', settings.maskPii)}
                      </p>
                    </td>
                    <td className="px-3 py-2.5">
                      <SegmentBadge segment={item.segment} />
                    </td>
                    <td className="px-3 py-2.5 text-right font-medium text-slate-800">
                      {item.metrics.liveClassPct}%
                    </td>
                    <td className="px-3 py-2.5 text-right font-bold text-amber-600">
                      {item.metrics.liveOrRecordingPct}%
                    </td>
                    <td className="px-3 py-2.5 text-right text-slate-500">
                      {item.metrics.liveClassAttended} / {item.metrics.liveClassTotal}
                    </td>
                    <td className="px-3 py-2.5 text-right">
                      {isRecOnly ? (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-semibold bg-amber-100 text-amber-800 border border-amber-200">
                          <PlayCircle className="w-3 h-3" /> Recording-Only
                        </span>
                      ) : item.metrics.liveClassPct >= 70 ? (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200">
                          <Radio className="w-3 h-3" /> Active Live
                        </span>
                      ) : (
                        <span className="text-[10px] text-slate-400">Regular</span>
                      )}
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
                        Profile
                      </Button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
};
