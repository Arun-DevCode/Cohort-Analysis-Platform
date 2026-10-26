import React, { useState } from 'react';
import { Card } from '@/ui/Card';
import { Button } from '@/ui/Button';
import { DeltaBadge, MovementBadge, SegmentBadge } from '@/ui/Badge';
import { usePlatformStore } from '@/store/usePlatformStore';
import { formatStudentName, formatStudentPhone } from '@/core/identity/mask';
import { compareSnapshots, computeSnapshotAggregate } from '@/core/analytics';
import type { Snapshot, StudentSnapshot, Student, MovementType } from '@/types';
import { ArrowRight, Search } from 'lucide-react';

interface CompareViewProps {
  snapshots: Snapshot[];
  allStudentSnapshots: StudentSnapshot[];
  students: Student[];
}

export const CompareView: React.FC<CompareViewProps> = ({
  snapshots,
  allStudentSnapshots,
  students,
}) => {
  const { settings, setSelectedStudentId, setActiveTab } = usePlatformStore();

  const sortedSnapshots = [...snapshots].sort((a, b) =>
    a.snapshotDate.localeCompare(b.snapshotDate)
  );

  const [snapAId, setSnapAId] = useState<string>(
    sortedSnapshots.length > 1 ? sortedSnapshots[sortedSnapshots.length - 2].id : sortedSnapshots[0]?.id || ''
  );
  const [snapBId, setSnapBId] = useState<string>(
    sortedSnapshots.length > 0 ? sortedSnapshots[sortedSnapshots.length - 1].id : ''
  );
  const [activeListTab, setActiveListTab] = useState<'ALL' | MovementType>('ALL');
  const [searchQuery, setSearchQuery] = useState('');

  const snapA = snapshots.find((s) => s.id === snapAId);
  const snapB = snapshots.find((s) => s.id === snapBId);

  const snapAStudents = allStudentSnapshots.filter((s) => s.snapshotId === snapAId);
  const snapBStudents = allStudentSnapshots.filter((s) => s.snapshotId === snapBId);

  const studentMap = new Map<string, Student>(students.map((s) => [s.id, s]));

  const comparison = compareSnapshots(
    snapAStudents,
    snapBStudents,
    studentMap,
    settings.deltaTolerance
  );

  const aggA = snapA ? computeSnapshotAggregate(snapA.id, snapA.snapshotDate, snapAStudents) : null;
  const aggB = snapB ? computeSnapshotAggregate(snapB.id, snapB.snapshotDate, snapBStudents) : null;

  const filteredComparisons = comparison.comparisons.filter((c) => {
    const matchesTab =
      activeListTab === 'ALL' ? true : c.movement === activeListTab;
    const matchesSearch =
      !searchQuery ||
      c.studentName.toLowerCase().includes(searchQuery.toLowerCase()) ||
      c.phoneE164.includes(searchQuery);
    return matchesTab && matchesSearch;
  });

  return (
    <div className="space-y-6">
      {/* Snapshot Pickers */}
      <Card>
        <div className="flex flex-col md:flex-row items-center justify-between gap-4">
          <div className="w-full md:w-1/2">
            <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1.5">
              Baseline Snapshot (Snapshot A)
            </label>
            <select
              className="w-full text-sm border border-slate-300 rounded-lg px-3 py-2 bg-white focus:ring-2 focus:ring-indigo-500 focus:outline-none"
              value={snapAId}
              onChange={(e) => setSnapAId(e.target.value)}
            >
              {sortedSnapshots.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.snapshotDate} ({s.fileName})
                </option>
              ))}
            </select>
          </div>

          <div className="hidden md:flex items-center justify-center p-2 rounded-full bg-slate-100 text-slate-400 mt-6">
            <ArrowRight className="w-4 h-4" />
          </div>

          <div className="w-full md:w-1/2">
            <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1.5">
              Comparison Snapshot (Snapshot B)
            </label>
            <select
              className="w-full text-sm border border-slate-300 rounded-lg px-3 py-2 bg-white focus:ring-2 focus:ring-indigo-500 focus:outline-none"
              value={snapBId}
              onChange={(e) => setSnapBId(e.target.value)}
            >
              {sortedSnapshots.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.snapshotDate} ({s.fileName})
                </option>
              ))}
            </select>
          </div>
        </div>
      </Card>

      {/* High-level Batch Comparison Table */}
      {aggA && aggB && (
        <Card title="Batch-Level Movement Summary" subtitle={`Change from ${aggA.snapshotDate} to ${aggB.snapshotDate}`}>
          <div className="overflow-x-auto">
            <table className="w-full text-sm text-left">
              <thead className="bg-slate-50 text-slate-600 font-semibold uppercase text-xs tracking-wider">
                <tr>
                  <th className="px-4 py-3">Metric</th>
                  <th className="px-4 py-3 text-right">Snapshot A ({aggA.snapshotDate})</th>
                  <th className="px-4 py-3 text-right">Snapshot B ({aggB.snapshotDate})</th>
                  <th className="px-4 py-3 text-right">Batch Delta</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                <tr>
                  <td className="px-4 py-3 font-medium text-slate-800">Assignment Submission Avg</td>
                  <td className="px-4 py-3 text-right text-slate-600">{aggA.assignmentAvg}%</td>
                  <td className="px-4 py-3 text-right font-semibold text-indigo-600">{aggB.assignmentAvg}%</td>
                  <td className="px-4 py-3 text-right">
                    <DeltaBadge delta={Number((aggB.assignmentAvg - aggA.assignmentAvg).toFixed(1))} />
                  </td>
                </tr>
                <tr>
                  <td className="px-4 py-3 font-medium text-slate-800">Total Content Consumption Avg</td>
                  <td className="px-4 py-3 text-right text-slate-600">{aggA.consumptionAvg}%</td>
                  <td className="px-4 py-3 text-right font-semibold text-emerald-600">{aggB.consumptionAvg}%</td>
                  <td className="px-4 py-3 text-right">
                    <DeltaBadge delta={Number((aggB.consumptionAvg - aggA.consumptionAvg).toFixed(1))} />
                  </td>
                </tr>
                <tr>
                  <td className="px-4 py-3 font-medium text-slate-800">Live Attendance Avg</td>
                  <td className="px-4 py-3 text-right text-slate-600">{aggA.liveAttendanceAvg}%</td>
                  <td className="px-4 py-3 text-right font-semibold text-sky-600">{aggB.liveAttendanceAvg}%</td>
                  <td className="px-4 py-3 text-right">
                    <DeltaBadge delta={Number((aggB.liveAttendanceAvg - aggA.liveAttendanceAvg).toFixed(1))} />
                  </td>
                </tr>
                <tr>
                  <td className="px-4 py-3 font-medium text-slate-800">Live + Recording Avg</td>
                  <td className="px-4 py-3 text-right text-slate-600">{aggA.liveOrRecAvg}%</td>
                  <td className="px-4 py-3 text-right font-semibold text-amber-600">{aggB.liveOrRecAvg}%</td>
                  <td className="px-4 py-3 text-right">
                    <DeltaBadge delta={Number((aggB.liveOrRecAvg - aggA.liveOrRecAvg).toFixed(1))} />
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {/* Segment Movement Matrix */}
      <Card
        title="Segment Movement Transition Matrix"
        subtitle="Tracking student transitions between High, Medium, and Low segments"
      >
        <div className="overflow-x-auto">
          <table className="w-full text-center border-collapse">
            <thead>
              <tr>
                <th className="p-3 text-xs font-semibold text-slate-500 uppercase border border-slate-200 bg-slate-50">
                  Snapshot A \ Snapshot B
                </th>
                <th className="p-3 text-xs font-bold text-emerald-700 bg-emerald-50 border border-slate-200">
                  High (≥80%)
                </th>
                <th className="p-3 text-xs font-bold text-amber-700 bg-amber-50 border border-slate-200">
                  Medium (50-79%)
                </th>
                <th className="p-3 text-xs font-bold text-rose-700 bg-rose-50 border border-slate-200">
                  Low (&lt;50%)
                </th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td className="p-3 text-xs font-bold text-emerald-700 bg-emerald-50/50 border border-slate-200 text-left">
                  High (≥80%)
                </td>
                <td className="p-4 text-base font-extrabold text-slate-800 border border-slate-200">
                  {comparison.matrix.High.High}
                </td>
                <td className="p-4 text-base font-extrabold text-amber-600 border border-slate-200 bg-amber-50/20">
                  {comparison.matrix.High.Medium}
                </td>
                <td className="p-4 text-base font-extrabold text-rose-600 border border-slate-200 bg-rose-50/30">
                  {comparison.matrix.High.Low}
                </td>
              </tr>
              <tr>
                <td className="p-3 text-xs font-bold text-amber-700 bg-amber-50/50 border border-slate-200 text-left">
                  Medium (50-79%)
                </td>
                <td className="p-4 text-base font-extrabold text-emerald-600 border border-slate-200 bg-emerald-50/20">
                  {comparison.matrix.Medium.High}
                </td>
                <td className="p-4 text-base font-extrabold text-slate-800 border border-slate-200">
                  {comparison.matrix.Medium.Medium}
                </td>
                <td className="p-4 text-base font-extrabold text-rose-600 border border-slate-200 bg-rose-50/30">
                  {comparison.matrix.Medium.Low}
                </td>
              </tr>
              <tr>
                <td className="p-3 text-xs font-bold text-rose-700 bg-rose-50/50 border border-slate-200 text-left">
                  Low (&lt;50%)
                </td>
                <td className="p-4 text-base font-extrabold text-emerald-600 border border-slate-200 bg-emerald-50/20">
                  {comparison.matrix.Low.High}
                </td>
                <td className="p-4 text-base font-extrabold text-amber-600 border border-slate-200 bg-amber-50/20">
                  {comparison.matrix.Low.Medium}
                </td>
                <td className="p-4 text-base font-extrabold text-slate-800 border border-slate-200">
                  {comparison.matrix.Low.Low}
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </Card>

      {/* Movement List by Tabs */}
      <Card
        title="Student-Level Movement"
        subtitle={`Threshold: ±${settings.deltaTolerance} pts for Improved / Declined classification`}
        action={
          <div className="relative w-64">
            <Search className="w-3.5 h-3.5 absolute left-3 top-2.5 text-slate-400" />
            <input
              type="text"
              placeholder="Search student or phone..."
              className="w-full text-xs border border-slate-300 rounded-lg pl-8 pr-3 py-1.5 focus:outline-none focus:ring-1 focus:ring-indigo-500"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
          </div>
        }
      >
        {/* Movement Tabs */}
        <div className="flex items-center gap-2 border-b border-slate-100 pb-3 mb-4">
          <Button
            size="sm"
            variant={activeListTab === 'ALL' ? 'primary' : 'ghost'}
            onClick={() => setActiveListTab('ALL')}
          >
            All Students ({comparison.comparisons.length})
          </Button>
          <Button
            size="sm"
            variant={activeListTab === 'IMPROVED' ? 'primary' : 'ghost'}
            onClick={() => setActiveListTab('IMPROVED')}
            className={activeListTab !== 'IMPROVED' ? 'text-emerald-700' : ''}
          >
            Improved ({comparison.improved.length})
          </Button>
          <Button
            size="sm"
            variant={activeListTab === 'SAME' ? 'primary' : 'ghost'}
            onClick={() => setActiveListTab('SAME')}
          >
            Same ({comparison.same.length})
          </Button>
          <Button
            size="sm"
            variant={activeListTab === 'DECLINED' ? 'danger' : 'ghost'}
            onClick={() => setActiveListTab('DECLINED')}
            className={activeListTab !== 'DECLINED' ? 'text-rose-700' : ''}
          >
            Declined ({comparison.declined.length})
          </Button>
        </div>

        {/* Comparison List Table */}
        <div className="overflow-x-auto">
          <table className="w-full text-xs text-left">
            <thead className="bg-slate-50 text-slate-600 font-semibold uppercase tracking-wider">
              <tr>
                <th className="px-3 py-2.5">Student</th>
                <th className="px-3 py-2.5">Segment (A → B)</th>
                <th className="px-3 py-2.5 text-right">Assignment (A → B)</th>
                <th className="px-3 py-2.5 text-right">Consumption (A → B)</th>
                <th className="px-3 py-2.5 text-right">Attendance (A → B)</th>
                <th className="px-3 py-2.5 text-right">Movement</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filteredComparisons.map((item) => (
                <tr
                  key={item.studentId}
                  onClick={() => {
                    setSelectedStudentId(item.studentId);
                    setActiveTab('students');
                  }}
                  className="hover:bg-slate-50/80 cursor-pointer transition-colors"
                >
                  <td className="px-3 py-2.5">
                    <p className="font-semibold text-slate-900">
                      {formatStudentName(item.studentName, settings.maskPii)}
                    </p>
                    <p className="text-[10px] text-slate-400">
                      {formatStudentPhone(item.phoneE164, settings.maskPii)}
                    </p>
                  </td>
                  <td className="px-3 py-2.5">
                    <div className="flex items-center gap-1.5">
                      <SegmentBadge segment={item.segmentA} />
                      <ArrowRight className="w-3 h-3 text-slate-400" />
                      <SegmentBadge segment={item.segmentB} />
                    </div>
                  </td>
                  <td className="px-3 py-2.5 text-right font-medium">
                    {item.assignmentA}% → {item.assignmentB}%{' '}
                    <DeltaBadge delta={item.assignmentDelta} />
                  </td>
                  <td className="px-3 py-2.5 text-right font-medium">
                    {item.consumptionA}% → {item.consumptionB}%{' '}
                    <DeltaBadge delta={item.consumptionDelta} />
                  </td>
                  <td className="px-3 py-2.5 text-right font-medium">
                    {item.attendanceA}% → {item.attendanceB}%{' '}
                    <DeltaBadge delta={item.attendanceDelta} />
                  </td>
                  <td className="px-3 py-2.5 text-right">
                    <MovementBadge movement={item.movement} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
};
