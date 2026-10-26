import React, { useState } from 'react';
import { Card } from '@/ui/Card';
import { Button } from '@/ui/Button';
import { SegmentBadge } from '@/ui/Badge';
import { usePlatformStore } from '@/store/usePlatformStore';
import { formatStudentName, formatStudentPhone } from '@/core/identity/mask';
import { identifyAtRiskStudents } from '@/core/analytics';
import type { StudentSnapshot, Student, Snapshot } from '@/types';
import { Download, Search, AlertOctagon, Filter } from 'lucide-react';

interface AtRiskViewProps {
  currentSnapshot: Snapshot;
  currentStudentSnapshots: StudentSnapshot[];
  students: Student[];
}

export const AtRiskView: React.FC<AtRiskViewProps> = ({
  currentSnapshot,
  currentStudentSnapshots,
  students,
}) => {
  const { settings, setSelectedStudentId, setActiveTab } = usePlatformStore();
  const [search, setSearch] = useState('');
  const [selectedReasonFilter, setSelectedReasonFilter] = useState<string>('ALL');

  const studentMap = new Map<string, Student>(students.map((s) => [s.id, s]));
  const atRiskList = identifyAtRiskStudents(currentStudentSnapshots, studentMap);

  // Extract all unique reason tags
  const allReasons = Array.from(
    new Set(atRiskList.flatMap((s) => s.reasons))
  );

  const filteredList = atRiskList.filter((item) => {
    const matchesSearch =
      !search ||
      item.studentName.toLowerCase().includes(search.toLowerCase()) ||
      item.phoneE164.includes(search);
    const matchesFilter =
      selectedReasonFilter === 'ALL' || item.reasons.includes(selectedReasonFilter);
    return matchesSearch && matchesFilter;
  });

  const exportCSV = () => {
    const headers = [
      'Student ID',
      'Name',
      'Phone',
      'Segment',
      'Assignment Submission %',
      'Total Consumption %',
      'Live Class %',
      'Live or Recording %',
      'Risk Reasons',
    ];

    const rows = filteredList.map((s) => [
      `"${s.studentId}"`,
      `"${formatStudentName(s.studentName, settings.maskPii)}"`,
      `"${formatStudentPhone(s.phoneE164, settings.maskPii)}"`,
      `"${s.segment}"`,
      s.assignmentSubmissionPct,
      s.totalConsumptionPct,
      s.liveClassPct,
      s.liveOrRecordingPct,
      `"${s.reasons.join('; ')}"`,
    ]);

    const csvContent =
      'data:text/csv;charset=utf-8,' +
      [headers.join(','), ...rows.map((e) => e.join(','))].join('\n');

    const encodedUri = encodeURI(csvContent);
    const link = document.createElement('a');
    link.setAttribute('href', encodedUri);
    link.setAttribute(
      'download',
      `At_Risk_Students_${currentSnapshot.snapshotDate}.csv`
    );
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  return (
    <div className="space-y-6">
      <Card
        title={`At-Risk Students List (${filteredList.length} of ${atRiskList.length} Flagged)`}
        subtitle={`Flagged based on 0 submissions, low consumption, low attendance, or cross-metric behaviors for snapshot ${currentSnapshot.snapshotDate}`}
        action={
          <Button size="sm" variant="outline" onClick={exportCSV} className="gap-1.5">
            <Download className="w-4 h-4 text-slate-500" /> Export CSV
          </Button>
        }
      >
        {/* Search & Filter Bar */}
        <div className="flex flex-col sm:flex-row items-center justify-between gap-3 mb-4">
          <div className="relative w-full sm:w-72">
            <Search className="w-3.5 h-3.5 absolute left-3 top-2.5 text-slate-400" />
            <input
              type="text"
              placeholder="Search by student name or phone..."
              className="w-full text-xs border border-slate-300 rounded-lg pl-8 pr-3 py-1.5 focus:outline-none focus:ring-1 focus:ring-indigo-500"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>

          <div className="flex items-center gap-2 w-full sm:w-auto">
            <Filter className="w-3.5 h-3.5 text-slate-400 shrink-0" />
            <select
              className="text-xs border border-slate-300 rounded-lg px-2.5 py-1.5 bg-white focus:outline-none focus:ring-1 focus:ring-indigo-500 w-full sm:w-auto"
              value={selectedReasonFilter}
              onChange={(e) => setSelectedReasonFilter(e.target.value)}
            >
              <option value="ALL">All Risk Factors</option>
              {allReasons.map((r) => (
                <option key={r} value={r}>
                  {r}
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* Table */}
        {filteredList.length === 0 ? (
          <div className="p-12 text-center text-xs text-slate-400">
            No students found matching your criteria.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs text-left">
              <thead className="bg-slate-50 text-slate-600 font-semibold uppercase tracking-wider">
                <tr>
                  <th className="px-3 py-2.5">Student</th>
                  <th className="px-3 py-2.5">Segment</th>
                  <th className="px-3 py-2.5">Risk Reasons</th>
                  <th className="px-3 py-2.5 text-right">Assignments</th>
                  <th className="px-3 py-2.5 text-right">Consumption</th>
                  <th className="px-3 py-2.5 text-right">Live Attendance</th>
                  <th className="px-3 py-2.5 text-right">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filteredList.map((item) => (
                  <tr
                    key={item.studentId}
                    className="hover:bg-slate-50/80 transition-colors"
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
                      <SegmentBadge segment={item.segment} />
                    </td>
                    <td className="px-3 py-2.5 max-w-xs">
                      <div className="flex flex-wrap gap-1">
                        {item.reasons.map((r, i) => (
                          <span
                            key={i}
                            className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[10px] font-medium bg-rose-50 text-rose-700 border border-rose-200"
                          >
                            <AlertOctagon className="w-2.5 h-2.5" /> {r}
                          </span>
                        ))}
                      </div>
                    </td>
                    <td className="px-3 py-2.5 text-right font-medium text-slate-700">
                      {item.assignmentSubmissionPct}%
                    </td>
                    <td className="px-3 py-2.5 text-right font-medium text-slate-700">
                      {item.totalConsumptionPct}%
                    </td>
                    <td className="px-3 py-2.5 text-right font-medium text-slate-700">
                      {item.liveClassPct}%
                    </td>
                    <td className="px-3 py-2.5 text-right">
                      <Button
                        size="sm"
                        variant="ghost"
                        className="text-xs text-indigo-600 hover:text-indigo-800"
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
      </Card>
    </div>
  );
};
