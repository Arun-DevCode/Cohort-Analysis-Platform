import React, { useState } from 'react';
import { Card } from '@/ui/Card';
import { usePlatformStore } from '@/store/usePlatformStore';
import { formatStudentName } from '@/core/identity/mask';
import type { WeeklyConsumption, Student, StudentSnapshot, Snapshot } from '@/types';
import { Video, FileText, HelpCircle, Layers, Cpu, Search } from 'lucide-react';

interface ContentViewProps {
  currentSnapshot: Snapshot;
  weeklyConsumption: WeeklyConsumption[];
  studentSnapshots: StudentSnapshot[];
  students: Student[];
}

export const ContentView: React.FC<ContentViewProps> = ({
  currentSnapshot,
  weeklyConsumption,
  studentSnapshots,
  students,
}) => {
  const { settings, setSelectedStudentId, setActiveTab } = usePlatformStore();
  const [search, setSearch] = useState('');

  // Find all distinct weeks (e.g. Weeks 1 to 10)
  const allWeeks = Array.from(new Set(weeklyConsumption.map((w) => w.weekNo))).sort(
    (a, b) => a - b
  );

  // Map studentId -> weekNo -> { consumed, total }
  const studentWeeklyMap = new Map<string, Map<number, { consumed: number; total: number }>>();
  for (const w of weeklyConsumption) {
    let wMap = studentWeeklyMap.get(w.studentId);
    if (!wMap) {
      wMap = new Map();
      studentWeeklyMap.set(w.studentId, wMap);
    }
    wMap.set(w.weekNo, { consumed: w.consumed, total: w.total });
  }

  // Modality metrics averages
  const count = studentSnapshots.length || 1;
  const avgVideo = (
    studentSnapshots.reduce((acc, s) => acc + s.metrics.videoPct, 0) / count
  ).toFixed(1);
  const avgPdf = (
    studentSnapshots.reduce((acc, s) => acc + s.metrics.pdfPct, 0) / count
  ).toFixed(1);
  const avgQuiz = (
    studentSnapshots.reduce((acc, s) => acc + s.metrics.quizSubmissionPct, 0) / count
  ).toFixed(1);
  const avgAi = (
    studentSnapshots.reduce((acc, s) => acc + s.metrics.aiContentPct, 0) / count
  ).toFixed(1);
  const avgFlash = (
    studentSnapshots.reduce((acc, s) => acc + s.metrics.flashCardsPct, 0) / count
  ).toFixed(1);

  const getHeatmapColor = (consumed: number, total: number) => {
    if (total === 0) return 'bg-slate-100 text-slate-400';
    const ratio = consumed / total;
    if (ratio >= 0.8) return 'bg-emerald-500 text-white font-semibold';
    if (ratio >= 0.5) return 'bg-emerald-200 text-emerald-900 font-medium';
    if (ratio > 0) return 'bg-amber-200 text-amber-900 font-medium';
    return 'bg-rose-100 text-rose-800';
  };

  const filteredStudents = students.filter(
    (s) =>
      !search ||
      s.name.toLowerCase().includes(search.toLowerCase()) ||
      s.phoneE164.includes(search)
  );

  return (
    <div className="space-y-6">
      {/* Modality Breakdown Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
        <Card className="text-center p-3">
          <div className="w-8 h-8 rounded-lg bg-indigo-50 text-indigo-600 flex items-center justify-center mx-auto mb-1.5">
            <Video className="w-4 h-4" />
          </div>
          <p className="text-xl font-bold text-slate-900">{avgVideo}%</p>
          <p className="text-xs text-slate-500">Video Lessons</p>
        </Card>

        <Card className="text-center p-3">
          <div className="w-8 h-8 rounded-lg bg-emerald-50 text-emerald-600 flex items-center justify-center mx-auto mb-1.5">
            <FileText className="w-4 h-4" />
          </div>
          <p className="text-xl font-bold text-slate-900">{avgPdf}%</p>
          <p className="text-xs text-slate-500">Reading / PDFs</p>
        </Card>

        <Card className="text-center p-3">
          <div className="w-8 h-8 rounded-lg bg-sky-50 text-sky-600 flex items-center justify-center mx-auto mb-1.5">
            <HelpCircle className="w-4 h-4" />
          </div>
          <p className="text-xl font-bold text-slate-900">{avgQuiz}%</p>
          <p className="text-xs text-slate-500">Quizzes</p>
        </Card>

        <Card className="text-center p-3">
          <div className="w-8 h-8 rounded-lg bg-purple-50 text-purple-600 flex items-center justify-center mx-auto mb-1.5">
            <Cpu className="w-4 h-4" />
          </div>
          <p className="text-xl font-bold text-slate-900">{avgAi}%</p>
          <p className="text-xs text-slate-500">AI Content</p>
        </Card>

        <Card className="text-center p-3">
          <div className="w-8 h-8 rounded-lg bg-amber-50 text-amber-600 flex items-center justify-center mx-auto mb-1.5">
            <Layers className="w-4 h-4" />
          </div>
          <p className="text-xl font-bold text-slate-900">{avgFlash}%</p>
          <p className="text-xs text-slate-500">Flash Cards</p>
        </Card>
      </div>

      {/* Week-wise Heatmap */}
      <Card
        title="Weekly Content Consumption Heatmap"
        subtitle={`Tracking completion intensity per week across all ${students.length} students to pinpoint drop-off weeks (${currentSnapshot.snapshotDate})`}
        action={
          <div className="relative w-64">
            <Search className="w-3.5 h-3.5 absolute left-3 top-2.5 text-slate-400" />
            <input
              type="text"
              placeholder="Filter students..."
              className="w-full text-xs border border-slate-300 rounded-lg pl-8 pr-3 py-1.5 focus:outline-none focus:ring-1 focus:ring-indigo-500"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
        }
      >
        {/* Heatmap Legend */}
        <div className="flex items-center gap-4 text-[11px] text-slate-600 mb-4 pb-3 border-b border-slate-100 flex-wrap">
          <span className="font-semibold text-slate-700">Intensity Legend:</span>
          <span className="flex items-center gap-1.5">
            <span className="w-3 h-3 rounded bg-emerald-500" /> ≥80% Consumed
          </span>
          <span className="flex items-center gap-1.5">
            <span className="w-3 h-3 rounded bg-emerald-200" /> 50-79% Consumed
          </span>
          <span className="flex items-center gap-1.5">
            <span className="w-3 h-3 rounded bg-amber-200" /> 1-49% Consumed
          </span>
          <span className="flex items-center gap-1.5">
            <span className="w-3 h-3 rounded bg-rose-100" /> 0% Consumed
          </span>
        </div>

        {/* Heatmap Grid */}
        <div className="overflow-x-auto">
          <table className="w-full text-xs text-left border-collapse">
            <thead className="bg-slate-50 text-slate-600 font-semibold uppercase tracking-wider">
              <tr>
                <th className="px-3 py-2 border-b border-slate-200 sticky left-0 bg-slate-50 z-10 w-44">
                  Student Name
                </th>
                {allWeeks.map((wk) => (
                  <th key={wk} className="px-2 py-2 text-center border-b border-slate-200 min-w-[50px]">
                    Wk {wk}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filteredStudents.map((student) => {
                const wMap = studentWeeklyMap.get(student.id);
                return (
                  <tr key={student.id} className="hover:bg-slate-50/60">
                    <td
                      onClick={() => {
                        setSelectedStudentId(student.id);
                        setActiveTab('students');
                      }}
                      className="px-3 py-2 font-medium text-slate-900 sticky left-0 bg-white hover:text-indigo-600 cursor-pointer z-10 border-r border-slate-100"
                    >
                      {formatStudentName(student.name, settings.maskPii)}
                    </td>
                    {allWeeks.map((wk) => {
                      const item = wMap?.get(wk);
                      const consumed = item?.consumed ?? 0;
                      const total = item?.total ?? 0;
                      const colorClass = getHeatmapColor(consumed, total);
                      return (
                        <td key={wk} className="p-1 text-center">
                          <div
                            className={`py-1.5 rounded text-[11px] transition-transform hover:scale-105 cursor-default ${colorClass}`}
                            title={`Week ${wk}: ${consumed}/${total} consumed`}
                          >
                            {consumed}/{total}
                          </div>
                        </td>
                      );
                    })}
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
