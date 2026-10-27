import React, { useRef, useState } from 'react';
import { Card } from '@/ui/Card';
import { Button } from '@/ui/Button';
import { DeltaBadge, SegmentBadge } from '@/ui/Badge';
import { usePlatformStore } from '@/store/usePlatformStore';
import { formatStudentName, formatStudentPhone } from '@/core/identity/mask';
import { computeSnapshotAggregate, computeBatchScorecards, identifyAtRiskStudents } from '@/core/analytics';
import type { Snapshot, StudentSnapshot, Student, Batch } from '@/types';
// Dynamic imports for xlsx, jsPDF, and html2canvas are used below to keep them out of the critical bundle
import { FileDown, FileSpreadsheet, CheckCircle2 } from 'lucide-react';

interface ReportsViewProps {
  currentBatch: Batch;
  currentSnapshot: Snapshot;
  previousSnapshot: Snapshot | null;
  currentStudentSnapshots: StudentSnapshot[];
  previousStudentSnapshots: StudentSnapshot[];
  students: Student[];
}

export const ReportsView: React.FC<ReportsViewProps> = ({
  currentBatch,
  currentSnapshot,
  previousSnapshot,
  currentStudentSnapshots,
  previousStudentSnapshots,
  students,
}) => {
  const settings = usePlatformStore((s) => s.settings);
  const [isExportingPdf, setIsExportingPdf] = useState(false);
  const [isExportingExcel, setIsExportingExcel] = useState(false);
  const [exportSuccessMsg, setExportSuccessMsg] = useState<string | null>(null);

  const reportCardRef = useRef<HTMLDivElement>(null);
  const studentMap = new Map<string, Student>(students.map((s) => [s.id, s]));

  const currentAgg = computeSnapshotAggregate(
    currentSnapshot.id,
    currentSnapshot.snapshotDate,
    currentStudentSnapshots
  );

  const previousAgg = previousSnapshot
    ? computeSnapshotAggregate(
        previousSnapshot.id,
        previousSnapshot.snapshotDate,
        previousStudentSnapshots
      )
    : null;

  const scorecards = computeBatchScorecards(currentAgg, previousAgg);
  const atRiskList = identifyAtRiskStudents(currentStudentSnapshots, studentMap);

  const handleExportPdf = async () => {
    if (!reportCardRef.current) return;
    setIsExportingPdf(true);
    setExportSuccessMsg(null);

    try {
      const [{ default: html2canvas }, { default: jsPDF }] = await Promise.all([
        import('html2canvas'),
        import('jspdf'),
      ]);

      const element = reportCardRef.current;
      const canvas = await html2canvas(element, {
        scale: 2,
        useCORS: true,
        logging: false,
      });

      const imgData = canvas.toDataURL('image/png');
      const pdf = new jsPDF({
        orientation: 'portrait',
        unit: 'mm',
        format: 'a4',
      });

      const imgWidth = 210; // A4 width mm
      const pageHeight = 295; // A4 height mm
      const imgHeight = (canvas.height * imgWidth) / canvas.width;
      let heightLeft = imgHeight;
      let position = 0;

      pdf.addImage(imgData, 'PNG', 0, position, imgWidth, imgHeight);
      heightLeft -= pageHeight;

      while (heightLeft >= 0) {
        position = heightLeft - imgHeight;
        pdf.addPage();
        pdf.addImage(imgData, 'PNG', 0, position, imgWidth, imgHeight);
        heightLeft -= pageHeight;
      }

      pdf.save(`Manager_Report_${currentBatch.name.replace(/\s+/g, '_')}_${currentSnapshot.snapshotDate}.pdf`);
      setExportSuccessMsg('Manager PDF report exported successfully!');
    } catch (err) {
      console.error('PDF export error:', err);
    } finally {
      setIsExportingPdf(false);
    }
  };

  const handleExportExcel = async () => {
    setIsExportingExcel(true);
    setExportSuccessMsg(null);

    try {
      const XLSX = await import('xlsx');
      const wb = XLSX.utils.book_new();

      // 1. Summary Sheet
      const summaryData = [
        ['Batch Name', currentBatch.name],
        ['Snapshot Date', currentSnapshot.snapshotDate],
        ['Total Students', currentAgg.studentCount],
        ['Assignment Submission Average (%)', currentAgg.assignmentAvg],
        ['Content Consumption Average (%)', currentAgg.consumptionAvg],
        ['Live Attendance Average (%)', currentAgg.liveAttendanceAvg],
        ['Live or Recording Average (%)', currentAgg.liveOrRecAvg],
        ['High Segment Count (>=80%)', currentAgg.highCount],
        ['Medium Segment Count (50-79%)', currentAgg.mediumCount],
        ['Low Segment Count (<50%)', currentAgg.lowCount],
        ['Total At-Risk Students Flagged', atRiskList.length],
      ];
      const summaryWs = XLSX.utils.aoa_to_sheet(summaryData);
      XLSX.utils.book_append_sheet(wb, summaryWs, 'Batch Summary');

      // 2. Student Roster Sheet
      const studentData = currentStudentSnapshots.map((s) => {
        const std = studentMap.get(s.studentId);
        return {
          'Student ID': std?.externalStudentId || s.studentId,
          Name: formatStudentName(std?.name || '', settings.maskPii),
          Phone: formatStudentPhone(std?.phoneE164 || '', settings.maskPii),
          Segment: s.segment,
          'Total Consumption %': s.metrics.totalConsumptionPct,
          'Assignment Submission %': s.metrics.assignmentSubmissionPct,
          'Live Class %': s.metrics.liveClassPct,
          'Live or Rec %': s.metrics.liveOrRecordingPct,
          'Assignments Submitted': s.metrics.assignmentsSubmitted,
          'Assignments Total': s.metrics.assignmentsTotal,
        };
      });
      const studentWs = XLSX.utils.json_to_sheet(studentData);
      XLSX.utils.book_append_sheet(wb, studentWs, 'Students Roster');

      // 3. At-Risk Sheet
      const atRiskData = atRiskList.map((s) => ({
        'Student ID': s.studentId,
        Name: formatStudentName(s.studentName, settings.maskPii),
        Phone: formatStudentPhone(s.phoneE164, settings.maskPii),
        Segment: s.segment,
        'Risk Factors': s.reasons.join('; '),
        'Consumption %': s.totalConsumptionPct,
        'Assignment %': s.assignmentSubmissionPct,
        'Live Class %': s.liveClassPct,
      }));
      const atRiskWs = XLSX.utils.json_to_sheet(atRiskData);
      XLSX.utils.book_append_sheet(wb, atRiskWs, 'At-Risk Action List');

      XLSX.writeFile(
        wb,
        `Student_Progress_Export_${currentBatch.name.replace(/\s+/g, '_')}_${currentSnapshot.snapshotDate}.xlsx`
      );
      setExportSuccessMsg('Comprehensive Excel report exported successfully!');
    } catch (err) {
      console.error('Excel export error:', err);
    } finally {
      setIsExportingExcel(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Export Action Bar */}
      <Card>
        <div className="flex flex-col sm:flex-row items-center justify-between gap-4">
          <div>
            <h3 className="text-base font-bold text-slate-900">
              Export Program Reports
            </h3>
            <p className="text-xs text-slate-500 mt-0.5">
              Generate manager-ready 1-page PDF or detailed multi-sheet Excel spreadsheet in the browser.
            </p>
          </div>
          <div className="flex items-center gap-3">
            <Button
              size="sm"
              variant="outline"
              disabled={isExportingExcel}
              onClick={handleExportExcel}
              className="gap-1.5"
            >
              <FileSpreadsheet className="w-4 h-4 text-emerald-600" />
              {isExportingExcel ? 'Generating Excel...' : 'Export Excel (.xlsx)'}
            </Button>
            <Button
              size="sm"
              variant="primary"
              disabled={isExportingPdf}
              onClick={handleExportPdf}
              className="gap-1.5"
            >
              <FileDown className="w-4 h-4" />
              {isExportingPdf ? 'Rendering PDF...' : 'Download One-Page PDF'}
            </Button>
          </div>
        </div>

        {exportSuccessMsg && (
          <div className="mt-4 p-3 bg-emerald-50 text-emerald-800 rounded-lg text-xs flex items-center gap-2 border border-emerald-200">
            <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
            <span>{exportSuccessMsg}</span>
          </div>
        )}
      </Card>

      {/* Printable / Captureable One-Page Manager Report Preview */}
      <div className="flex justify-center">
        <div
          ref={reportCardRef}
          className="w-full max-w-3xl bg-white p-8 rounded-2xl border border-slate-200 shadow-md space-y-6"
        >
          {/* Header */}
          <div className="flex items-start justify-between border-b border-slate-200 pb-5">
            <div>
              <span className="text-[10px] font-bold uppercase tracking-wider text-indigo-600 bg-indigo-50 px-2 py-0.5 rounded">
                Executive Progress Briefing
              </span>
              <h1 className="text-2xl font-black text-slate-900 mt-1">
                {currentBatch.name}
              </h1>
              <p className="text-xs text-slate-500 mt-0.5">
                Snapshot Date: <span className="font-semibold text-slate-700">{currentSnapshot.snapshotDate}</span> •
                Students: <span className="font-semibold text-slate-700">{currentAgg.studentCount}</span>
              </p>
            </div>
            <div className="text-right">
              <p className="text-xs font-semibold text-slate-700">Student Progress Platform</p>
              <p className="text-[10px] text-slate-400">Client-Side Analytics</p>
            </div>
          </div>

          {/* Key Scorecards */}
          <div>
            <h4 className="text-xs font-bold uppercase tracking-wider text-slate-500 mb-3">
              1. Core Metrics Scorecard
            </h4>
            <div className="grid grid-cols-3 gap-3 text-center">
              <div className="p-4 rounded-xl bg-slate-50 border border-slate-200">
                <p className="text-xs font-semibold text-slate-600">Assignment Submission</p>
                <p className="text-2xl font-black text-indigo-600 mt-1">{scorecards.assignment.currentValue}%</p>
                <div className="mt-1">
                  <DeltaBadge delta={scorecards.assignment.deltaPts} />
                </div>
              </div>

              <div className="p-4 rounded-xl bg-slate-50 border border-slate-200">
                <p className="text-xs font-semibold text-slate-600">Content Consumption</p>
                <p className="text-2xl font-black text-emerald-600 mt-1">{scorecards.consumption.currentValue}%</p>
                <div className="mt-1">
                  <DeltaBadge delta={scorecards.consumption.deltaPts} />
                </div>
              </div>

              <div className="p-4 rounded-xl bg-slate-50 border border-slate-200">
                <p className="text-xs font-semibold text-slate-600">Live Attendance</p>
                <p className="text-2xl font-black text-sky-600 mt-1">{scorecards.liveAttendance.currentValue}%</p>
                <div className="mt-1">
                  <DeltaBadge delta={scorecards.liveAttendance.deltaPts} />
                </div>
              </div>
            </div>
          </div>

          {/* Student Segmentation Breakdown */}
          <div>
            <h4 className="text-xs font-bold uppercase tracking-wider text-slate-500 mb-3">
              2. Student Cohort Health & Segmentation
            </h4>
            <div className="grid grid-cols-3 gap-3 text-center">
              <div className="p-3 rounded-xl bg-emerald-50 border border-emerald-200">
                <p className="text-lg font-black text-emerald-800">{currentAgg.highCount}</p>
                <p className="text-xs font-medium text-emerald-700">High (≥80%)</p>
              </div>
              <div className="p-3 rounded-xl bg-amber-50 border border-amber-200">
                <p className="text-lg font-black text-amber-800">{currentAgg.mediumCount}</p>
                <p className="text-xs font-medium text-amber-700">Medium (50-79%)</p>
              </div>
              <div className="p-3 rounded-xl bg-rose-50 border border-rose-200">
                <p className="text-lg font-black text-rose-800">{currentAgg.lowCount}</p>
                <p className="text-xs font-medium text-rose-700">Low (&lt;50%)</p>
              </div>
            </div>
          </div>

          {/* Top At-Risk Intervention List */}
          <div>
            <div className="flex items-center justify-between mb-3">
              <h4 className="text-xs font-bold uppercase tracking-wider text-slate-500">
                3. Priority Follow-up & Intervention ({atRiskList.length} Flagged)
              </h4>
              <span className="text-[10px] text-slate-400">Top 5 shown</span>
            </div>

            <div className="overflow-x-auto border border-slate-200 rounded-xl">
              <table className="w-full text-xs text-left">
                <thead className="bg-slate-50 text-slate-600 uppercase font-semibold">
                  <tr>
                    <th className="px-3 py-2">Student</th>
                    <th className="px-3 py-2">Segment</th>
                    <th className="px-3 py-2">Flags</th>
                    <th className="px-3 py-2 text-right">Consumption</th>
                    <th className="px-3 py-2 text-right">Assignment</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {atRiskList.slice(0, 5).map((s) => (
                    <tr key={s.studentId}>
                      <td className="px-3 py-2 font-medium text-slate-900">
                        {formatStudentName(s.studentName, settings.maskPii)}
                      </td>
                      <td className="px-3 py-2">
                        <SegmentBadge segment={s.segment} />
                      </td>
                      <td className="px-3 py-2">
                        <span className="text-[10px] text-rose-600 font-medium">
                          {s.reasons.join(', ')}
                        </span>
                      </td>
                      <td className="px-3 py-2 text-right font-semibold text-slate-800">
                        {s.totalConsumptionPct}%
                      </td>
                      <td className="px-3 py-2 text-right font-semibold text-slate-800">
                        {s.assignmentSubmissionPct}%
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Footer */}
          <div className="pt-4 border-t border-slate-200 flex items-center justify-between text-[10px] text-slate-400">
            <span>Generated on {new Date().toLocaleDateString()}</span>
            <span>Confidential • Student Progress Platform</span>
          </div>
        </div>
      </div>
    </div>
  );
};
