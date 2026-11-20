import React, { useState, useEffect, useMemo, useDeferredValue } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { usePlatformStore } from '@/store/usePlatformStore';
import { apiClient, resolveBackendBatchId } from '@/core/api/client';
import { formatStudentName, formatStudentPhone } from '@/core/identity/mask';
import type {
  Batch,
  Snapshot,
  BatchCompletionReport,
  BatchCompletionSettings,
  CompletionOutlook,
} from '@/types';
import { Button } from '@/components/ui/button';
import {
  AlertTriangle,
  CheckCircle2,
  Download,
  Info,
  Search,
  Settings as SettingsIcon,
  Sparkles,
  Clock,
  TrendingUp,
  AlertCircle,
  X,
  RefreshCw,
} from 'lucide-react';
import { cn } from '@/lib/utils';

interface CompletionViewProps {
  currentBatch: Batch | undefined;
  currentSnapshot: Snapshot | undefined;
}

export const CompletionView: React.FC<CompletionViewProps> = ({
  currentBatch,
  currentSnapshot,
}) => {
  const { settings } = usePlatformStore(
    useShallow((s) => ({
      settings: s.settings,
    }))
  );

  const [report, setReport] = useState<BatchCompletionReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Filters & Search
  const [search, setSearch] = useState('');
  const deferredSearch = useDeferredValue(search);
  const [outlookFilter, setOutlookFilter] = useState<'all' | CompletionOutlook>('all');

  // Settings Drawer state
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [editSettings, setEditSettings] = useState<BatchCompletionSettings | null>(null);
  const [savingSettings, setSavingSettings] = useState(false);
  const [settingsError, setSettingsError] = useState<string | null>(null);

  // Fetch report
  const fetchReport = async () => {
    if (!currentBatch || !currentSnapshot) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const realBatchId = await resolveBackendBatchId(currentBatch.id);
      const res = await apiClient.getBatchCompletion(
        realBatchId || currentBatch.id,
        currentSnapshot.snapshotDate || currentSnapshot.id
      );
      setReport(res);
      setEditSettings(res.settings);
    } catch (err: any) {
      setError(err?.message || 'Failed to load completion analytics');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchReport();
  }, [currentBatch?.id, currentSnapshot?.id]);

  // Filtered learners
  const filteredLearners = useMemo(() => {
    if (!report) return [];
    return report.learners.filter((l) => {
      if (outlookFilter !== 'all' && l.outlook !== outlookFilter) {
        return false;
      }
      if (deferredSearch.trim()) {
        const query = deferredSearch.toLowerCase();
        const displayName = formatStudentName(l.name, settings.maskPii).toLowerCase();
        const displayPhone = formatStudentPhone(l.phoneE164, settings.maskPii).toLowerCase();
        return displayName.includes(query) || displayPhone.includes(query);
      }
      return true;
    });
  }, [report, outlookFilter, deferredSearch, settings.maskPii]);

  // CSV Export
  const handleExportCsv = () => {
    if (!report) return;
    const headers = [
      'Learner Name',
      'Phone',
      'Outlook',
      'Readiness Score',
      'Assignments Current %',
      'Assignments Status',
      'Assignments Needs',
      'Content Current %',
      'Content Status',
      'Content Needs',
      'Attendance Current %',
      'Attendance Status',
      'Attendance Needs',
    ];

    const rows = report.learners.map((l) => [
      `"${formatStudentName(l.name, settings.maskPii)}"`,
      `"${formatStudentPhone(l.phoneE164, settings.maskPii)}"`,
      `"${l.outlook}"`,
      l.readinessScore,
      `${l.assignments.currentPct}%`,
      `"${l.assignments.status}"`,
      `"${l.assignments.needsText.replace(/"/g, '""')}"`,
      `${l.content.currentPct}%`,
      `"${l.content.status}"`,
      `"${l.content.needsText.replace(/"/g, '""')}"`,
      `${l.attendance.currentPct}%`,
      `"${l.attendance.status}"`,
      `"${l.attendance.needsText.replace(/"/g, '""')}"`,
    ]);

    const csvContent = [headers.join(','), ...rows.map((r) => r.join(','))].join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `completion_forecast_${currentBatch?.name || 'batch'}_${report.roadmap?.reportDate || 'report'}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  // Save Settings
  const handleSaveSettings = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editSettings || !currentBatch) return;

    const weightsSum = editSettings.wAssignments + editSettings.wContent + editSettings.wAttendance;
    if (weightsSum !== 100) {
      setSettingsError(`Weights must sum to exactly 100% (currently ${weightsSum}%)`);
      return;
    }
    if (editSettings.catchupLimit <= 0) {
      setSettingsError('Catch-up limit multiple must be greater than 0');
      return;
    }

    setSavingSettings(true);
    setSettingsError(null);
    try {
      const realBatchId = await resolveBackendBatchId(currentBatch.id);
      await apiClient.updateCompletionSettings(realBatchId || currentBatch.id, editSettings);
      setIsSettingsOpen(false);
      await fetchReport();
    } catch (err: any) {
      setSettingsError(err?.message || 'Failed to update settings');
    } finally {
      setSavingSettings(false);
    }
  };

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[400px] space-y-4">
        <RefreshCw className="w-8 h-8 animate-spin text-indigo-600" />
        <p className="text-sm font-medium text-slate-500">Calculating completion forecast...</p>
      </div>
    );
  }

  if (error || !report) {
    return (
      <div className="p-8 max-w-2xl mx-auto">
        <div className="bg-red-50 border border-red-200 rounded-xl p-6 text-center space-y-3">
          <AlertCircle className="w-10 h-10 text-red-500 mx-auto" />
          <h3 className="text-base font-semibold text-red-900">Completion Forecast Unavailable</h3>
          <p className="text-sm text-red-600">{error || 'Unable to compute completion forecast'}</p>
          <Button onClick={fetchReport} variant="outline" size="sm" className="mt-2">
            Try Again
          </Button>
        </div>
      </div>
    );
  }

  const { summary, roadmap, histogram } = report;
  const weightsTotal =
    (editSettings?.wAssignments || 0) +
    (editSettings?.wContent || 0) +
    (editSettings?.wAttendance || 0);

  return (
    <div className="space-y-6 pb-12">
      {/* Header bar with Disclaimer Note Banner */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 pb-2 border-b border-slate-200">
        <div>
          <div className="flex items-center space-x-2">
            <h1 className="text-xl font-bold tracking-tight text-slate-900">Completion Forecast</h1>
            <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-indigo-50 text-indigo-700 border border-indigo-200">
              Stage 4
            </span>
          </div>
          <p className="text-xs text-slate-500 mt-1">
            Readiness score & completion outlook per learner based on separate minimums
          </p>
        </div>

        <div className="flex items-center space-x-2.5">
          <Button
            variant="outline"
            size="sm"
            onClick={handleExportCsv}
            className="text-xs flex items-center space-x-1.5 h-8"
          >
            <Download className="w-3.5 h-3.5" />
            <span>Export CSV</span>
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              setEditSettings(report.settings);
              setIsSettingsOpen(true);
            }}
            className="text-xs flex items-center space-x-1.5 h-8 text-slate-700 hover:text-slate-900"
          >
            <SettingsIcon className="w-3.5 h-3.5" />
            <span>Settings</span>
          </Button>
        </div>
      </div>

      {/* Mandatory Disclaimer Note Banner */}
      <div className="bg-amber-50/80 border border-amber-200/90 rounded-lg p-3 text-xs text-amber-900 flex items-center justify-between">
        <div className="flex items-center space-x-2">
          <Info className="w-4 h-4 text-amber-600 shrink-0" />
          <span>
            <strong>Note:</strong> Not cross-checked with Score Card. Missed regular assignments and live sessions may be made up via late submissions and video recordings until the roadmap end date.
          </span>
        </div>
      </div>

      {/* Roadmap Strip */}
      {roadmap ? (
        <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-sm space-y-3">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-xs">
            <div className="flex items-center space-x-2">
              <span className="font-semibold text-slate-800">
                Roadmap {roadmap.version ? `(${roadmap.version})` : ''}
              </span>
              <span className="text-slate-400">&bull;</span>
              <span className="text-slate-600">
                {roadmap.startDate} to {roadmap.endDate}
              </span>
            </div>
            <div className="flex items-center space-x-3 text-slate-500 font-medium">
              <span>{roadmap.daysToEnd >= 0 ? `${roadmap.daysToEnd} days left` : 'Roadmap ended'}</span>
              <span>&bull;</span>
              <span>{roadmap.weeksLeft >= 0 ? `${roadmap.weeksLeft} wks left` : '0 wks left'}</span>
              <span>&bull;</span>
              <span>Report Date: {roadmap.reportDate}</span>
            </div>
          </div>

          {/* Progress bar */}
          <div className="space-y-1.5">
            <div className="w-full bg-slate-100 rounded-full h-2.5 overflow-hidden">
              <div
                className="bg-indigo-600 h-2.5 rounded-full transition-all duration-500"
                style={{ width: `${Math.min(100, Math.max(0, roadmap.elapsedPct))}%` }}
              />
            </div>
            <div className="flex justify-between text-[11px] text-slate-500">
              <span>{roadmap.elapsedDays} of {roadmap.totalDays} calendar days elapsed ({roadmap.elapsedPct}%)</span>
              <span>
                Normal Paces: { (roadmap.totalRegularAssignments / (roadmap.roadmapWeeks || 1)).toFixed(2) } assign/wk &bull; { (roadmap.totalLiveSessions / (roadmap.roadmapWeeks || 1)).toFixed(1) } live/wk
              </span>
            </div>
          </div>

          {roadmap.note && (
            <div className="text-[11px] text-indigo-700 bg-indigo-50/70 p-2 rounded border border-indigo-100">
              {roadmap.note}
            </div>
          )}
        </div>
      ) : (
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 text-xs text-amber-800 flex items-center space-x-2">
          <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0" />
          <span>
            No academic roadmap workbook uploaded for this batch. Showing Met and Behind statuses based on default baselines.
          </span>
        </div>
      )}

      {/* 4 Outlook Tier Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3.5">
        {/* On track */}
        <div
          onClick={() => setOutlookFilter(outlookFilter === 'On track' ? 'all' : 'On track')}
          className={cn(
            'bg-white border rounded-xl p-4 cursor-pointer transition-all hover:shadow-md',
            outlookFilter === 'On track' ? 'border-emerald-500 ring-2 ring-emerald-100' : 'border-slate-200'
          )}
        >
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-emerald-700 uppercase tracking-wider">On track</span>
            <CheckCircle2 className="w-4 h-4 text-emerald-500" />
          </div>
          <div className="mt-2 flex items-baseline space-x-2">
            <span className="text-2xl font-bold text-slate-900">{summary.onTrack}</span>
            <span className="text-xs text-slate-500">
              ({summary.totalLearners > 0 ? ((summary.onTrack / summary.totalLearners) * 100).toFixed(0) : 0}%)
            </span>
          </div>
          <p className="mt-1 text-[11px] text-slate-500">Met all 3 area minimums</p>
        </div>

        {/* Recoverable */}
        <div
          onClick={() => setOutlookFilter(outlookFilter === 'Recoverable' ? 'all' : 'Recoverable')}
          className={cn(
            'bg-white border rounded-xl p-4 cursor-pointer transition-all hover:shadow-md',
            outlookFilter === 'Recoverable' ? 'border-blue-500 ring-2 ring-blue-100' : 'border-slate-200'
          )}
        >
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-blue-700 uppercase tracking-wider">Recoverable</span>
            <TrendingUp className="w-4 h-4 text-blue-500" />
          </div>
          <div className="mt-2 flex items-baseline space-x-2">
            <span className="text-2xl font-bold text-slate-900">{summary.recoverable}</span>
            <span className="text-xs text-slate-500">
              ({summary.totalLearners > 0 ? ((summary.recoverable / summary.totalLearners) * 100).toFixed(0) : 0}%)
            </span>
          </div>
          <p className="mt-1 text-[11px] text-slate-500">Can catch up &le; {report.settings.catchupLimit}x pace</p>
        </div>

        {/* Unlikely */}
        <div
          onClick={() => setOutlookFilter(outlookFilter === 'Unlikely' ? 'all' : 'Unlikely')}
          className={cn(
            'bg-white border rounded-xl p-4 cursor-pointer transition-all hover:shadow-md',
            outlookFilter === 'Unlikely' ? 'border-rose-500 ring-2 ring-rose-100' : 'border-slate-200'
          )}
        >
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-rose-700 uppercase tracking-wider">Unlikely</span>
            <AlertCircle className="w-4 h-4 text-rose-500" />
          </div>
          <div className="mt-2 flex items-baseline space-x-2">
            <span className="text-2xl font-bold text-slate-900">{summary.unlikely}</span>
            <span className="text-xs text-slate-500">
              ({summary.totalLearners > 0 ? ((summary.unlikely / summary.totalLearners) * 100).toFixed(0) : 0}%)
            </span>
          </div>
          <p className="mt-1 text-[11px] text-slate-500">&gt; {report.settings.catchupLimit}x pace or ended</p>
        </div>

        {/* Too early */}
        <div
          onClick={() => setOutlookFilter(outlookFilter === 'Too early' ? 'all' : 'Too early')}
          className={cn(
            'bg-white border rounded-xl p-4 cursor-pointer transition-all hover:shadow-md',
            outlookFilter === 'Too early' ? 'border-zinc-500 ring-2 ring-zinc-100' : 'border-slate-200'
          )}
        >
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-zinc-600 uppercase tracking-wider">Too early</span>
            <Clock className="w-4 h-4 text-zinc-400" />
          </div>
          <div className="mt-2 flex items-baseline space-x-2">
            <span className="text-2xl font-bold text-slate-900">{summary.tooEarly}</span>
            <span className="text-xs text-slate-500">
              ({summary.totalLearners > 0 ? ((summary.tooEarly / summary.totalLearners) * 100).toFixed(0) : 0}%)
            </span>
          </div>
          <p className="mt-1 text-[11px] text-slate-500">&lt; 3 due or &lt; 25% duration</p>
        </div>
      </div>

      {/* Range Sentence Banner */}
      {summary.rangeSentence && (
        <div className="bg-indigo-50/70 border border-indigo-200/80 rounded-xl px-4 py-3 flex items-center justify-between">
          <div className="flex items-center space-x-2 text-xs font-medium text-indigo-900">
            <Sparkles className="w-4 h-4 text-indigo-600 shrink-0" />
            <span>{summary.rangeSentence}</span>
          </div>
          <span className="text-[11px] text-indigo-600 font-semibold bg-white px-2.5 py-1 rounded-md border border-indigo-100">
            Floor: {summary.forecastFloor} &bull; Ceiling: {summary.forecastCeiling}
          </span>
        </div>
      )}

      {/* Histogram: Readiness Distribution */}
      <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-sm space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-2">
            <h3 className="text-xs font-bold text-slate-900 uppercase tracking-wider">
              Readiness Score Distribution
            </h3>
            <span className="text-[11px] text-slate-500">
              (Weighted: {report.settings.wAssignments}% Assign + {report.settings.wContent}% Content + {report.settings.wAttendance}% Att)
            </span>
          </div>
          <span className="text-[11px] text-slate-400">Total: {summary.totalLearners} learners</span>
        </div>

        <div className="grid grid-cols-10 gap-1.5 pt-2 items-end h-28 border-b border-slate-100 pb-2">
          {histogram.map((bin) => {
            const maxCount = Math.max(1, ...histogram.map((b) => b.count));
            const heightPct = (bin.count / maxCount) * 100;
            return (
              <div key={bin.bin} className="flex flex-col items-center h-full justify-end group">
                <span className="text-[10px] font-semibold text-slate-600 opacity-0 group-hover:opacity-100 transition-opacity mb-1">
                  {bin.count}
                </span>
                <div
                  className={cn(
                    'w-full rounded-t transition-all duration-300',
                    bin.count > 0 ? 'bg-indigo-500 group-hover:bg-indigo-600' : 'bg-slate-100'
                  )}
                  style={{ height: `${Math.max(4, heightPct)}%` }}
                />
                <span className="text-[9px] text-slate-500 mt-1 truncate w-full text-center">
                  {bin.bin}
                </span>
              </div>
            );
          })}
        </div>
      </div>

      {/* Learner Table Section */}
      <div className="bg-white border border-slate-200 rounded-xl shadow-sm overflow-hidden space-y-4 p-4">
        {/* Controls */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="relative flex-1 max-w-sm">
            <Search className="absolute left-3 top-2.5 w-4 h-4 text-slate-400" />
            <input
              type="text"
              placeholder="Search learner by name or phone..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full pl-9 pr-3 py-1.5 text-xs bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500"
            />
          </div>

          <div className="flex items-center space-x-2 text-xs">
            <span className="text-slate-500">Filter Outlook:</span>
            {(['all', 'On track', 'Recoverable', 'Unlikely', 'Too early'] as const).map((filterOpt) => (
              <button
                key={filterOpt}
                onClick={() => setOutlookFilter(filterOpt)}
                className={cn(
                  'px-2.5 py-1 rounded-md transition-colors text-xs font-medium',
                  outlookFilter === filterOpt
                    ? 'bg-indigo-600 text-white'
                    : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                )}
              >
                {filterOpt === 'all' ? 'All' : filterOpt}
              </button>
            ))}
          </div>
        </div>

        {/* Table */}
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="bg-slate-50 text-slate-500 border-y border-slate-200">
              <tr>
                <th className="py-2.5 px-3 font-semibold">Learner</th>
                <th className="py-2.5 px-3 font-semibold">Outlook</th>
                <th className="py-2.5 px-3 font-semibold">Readiness</th>
                <th className="py-2.5 px-3 font-semibold">
                  Assignments (Min {report.settings.minAssignments}%)
                </th>
                <th className="py-2.5 px-3 font-semibold">
                  Content (Min {report.settings.minContent}%)
                </th>
                <th className="py-2.5 px-3 font-semibold">
                  Attendance (Min {report.settings.minAttendance}%)
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filteredLearners.length === 0 ? (
                <tr>
                  <td colSpan={6} className="py-8 text-center text-slate-400">
                    No learners match the selected filter.
                  </td>
                </tr>
              ) : (
                filteredLearners.map((learner) => {
                  return (
                    <tr key={learner.studentId} className="hover:bg-slate-50/70 transition-colors">
                      {/* Learner Info */}
                      <td className="py-3 px-3">
                        <div className="font-semibold text-slate-900">
                          {formatStudentName(learner.name, settings.maskPii)}
                        </div>
                        <div className="text-[11px] text-slate-400">
                          {formatStudentPhone(learner.phoneE164, settings.maskPii)}
                        </div>
                      </td>

                      {/* Outlook Badge */}
                      <td className="py-3 px-3">
                        <span
                          className={cn(
                            'inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-semibold',
                            learner.outlook === 'On track' && 'bg-emerald-50 text-emerald-700 border border-emerald-200',
                            learner.outlook === 'Recoverable' && 'bg-blue-50 text-blue-700 border border-blue-200',
                            learner.outlook === 'Unlikely' && 'bg-rose-50 text-rose-700 border border-rose-200',
                            learner.outlook === 'Too early' && 'bg-zinc-100 text-zinc-600 border border-zinc-200'
                          )}
                        >
                          {learner.outlook}
                        </span>
                      </td>

                      {/* Readiness Score */}
                      <td className="py-3 px-3">
                        <div className="flex items-center space-x-1.5">
                          <span className="font-bold text-slate-800">{learner.readinessScore}</span>
                          <span className="text-[10px] text-slate-400">/ 100</span>
                        </div>
                      </td>

                      {/* Assignments Metric */}
                      <td className="py-3 px-3">
                        <div className="space-y-1">
                          <div className="flex items-center space-x-2">
                            <span
                              className={cn(
                                'px-1.5 py-0.5 rounded text-[10px] font-bold uppercase',
                                learner.assignments.status === 'Met'
                                  ? 'bg-emerald-100 text-emerald-800'
                                  : 'bg-rose-100 text-rose-800'
                              )}
                            >
                              {learner.assignments.status}
                            </span>
                            <span className="text-slate-600 font-medium">
                              {learner.assignments.currentItems} / {learner.assignments.totalItems} ({learner.assignments.currentPct}%)
                            </span>
                          </div>
                          <div className="text-[11px] text-slate-500 font-mono">
                            {learner.assignments.needsText}
                          </div>
                        </div>
                      </td>

                      {/* Content Metric */}
                      <td className="py-3 px-3">
                        <div className="space-y-1">
                          <div className="flex items-center space-x-2">
                            <span
                              className={cn(
                                'px-1.5 py-0.5 rounded text-[10px] font-bold uppercase',
                                learner.content.status === 'Met'
                                  ? 'bg-emerald-100 text-emerald-800'
                                  : 'bg-rose-100 text-rose-800'
                              )}
                            >
                              {learner.content.status}
                            </span>
                            <span className="text-slate-600 font-medium">
                              {learner.content.currentItems} / {learner.content.totalItems} ({learner.content.currentPct}%)
                            </span>
                          </div>
                          <div className="text-[11px] text-slate-500 font-mono">
                            {learner.content.needsText}
                          </div>
                        </div>
                      </td>

                      {/* Attendance Metric */}
                      <td className="py-3 px-3">
                        <div className="space-y-1">
                          <div className="flex items-center space-x-2">
                            <span
                              className={cn(
                                'px-1.5 py-0.5 rounded text-[10px] font-bold uppercase',
                                learner.attendance.status === 'Met'
                                  ? 'bg-emerald-100 text-emerald-800'
                                  : 'bg-rose-100 text-rose-800'
                              )}
                            >
                              {learner.attendance.status}
                            </span>
                            <span className="text-slate-600 font-medium">
                              {learner.attendance.currentItems} / {learner.attendance.totalItems} ({learner.attendance.currentPct}%)
                            </span>
                          </div>
                          <div className="text-[11px] text-slate-500 font-mono">
                            {learner.attendance.needsText}
                          </div>
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Settings Modal Drawer */}
      {isSettingsOpen && editSettings && (
        <div className="fixed inset-0 z-50 bg-slate-900/40 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-2xl max-w-lg w-full overflow-hidden border border-slate-200 animate-in fade-in zoom-in-95 duration-150">
            <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between">
              <div>
                <h3 className="text-base font-bold text-slate-900">Completion Forecast Settings</h3>
                <p className="text-xs text-slate-500">Configure minimum completion thresholds & weights</p>
              </div>
              <button
                onClick={() => setIsSettingsOpen(false)}
                className="text-slate-400 hover:text-slate-600 p-1 rounded-lg"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleSaveSettings} className="p-6 space-y-5 text-xs">
              {settingsError && (
                <div className="bg-red-50 text-red-700 p-3 rounded-lg border border-red-200 font-medium">
                  {settingsError}
                </div>
              )}

              {/* Minimum Thresholds */}
              <div className="space-y-3">
                <h4 className="font-bold text-slate-900 uppercase tracking-wider text-[11px]">
                  Area Completion Minimums (%)
                </h4>
                <div className="grid grid-cols-3 gap-3">
                  <div>
                    <label className="block text-slate-600 mb-1 font-medium">Assignments (%)</label>
                    <input
                      type="number"
                      min={0}
                      max={100}
                      value={editSettings.minAssignments}
                      onChange={(e) =>
                        setEditSettings({ ...editSettings, minAssignments: Number(e.target.value) })
                      }
                      className="w-full px-3 py-1.5 border border-slate-300 rounded-lg text-slate-900 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                    />
                  </div>
                  <div>
                    <label className="block text-slate-600 mb-1 font-medium">Content (%)</label>
                    <input
                      type="number"
                      min={0}
                      max={100}
                      value={editSettings.minContent}
                      onChange={(e) =>
                        setEditSettings({ ...editSettings, minContent: Number(e.target.value) })
                      }
                      className="w-full px-3 py-1.5 border border-slate-300 rounded-lg text-slate-900 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                    />
                  </div>
                  <div>
                    <label className="block text-slate-600 mb-1 font-medium">Attendance (%)</label>
                    <input
                      type="number"
                      min={0}
                      max={100}
                      value={editSettings.minAttendance}
                      onChange={(e) =>
                        setEditSettings({ ...editSettings, minAttendance: Number(e.target.value) })
                      }
                      className="w-full px-3 py-1.5 border border-slate-300 rounded-lg text-slate-900 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                    />
                  </div>
                </div>
              </div>

              {/* Readiness Weights */}
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <h4 className="font-bold text-slate-900 uppercase tracking-wider text-[11px]">
                    Readiness Score Weights (Must sum to 100%)
                  </h4>
                  <span
                    className={cn(
                      'font-bold px-2 py-0.5 rounded text-[10px]',
                      weightsTotal === 100 ? 'bg-emerald-100 text-emerald-800' : 'bg-rose-100 text-rose-800'
                    )}
                  >
                    Sum: {weightsTotal}%
                  </span>
                </div>
                <div className="grid grid-cols-3 gap-3">
                  <div>
                    <label className="block text-slate-600 mb-1 font-medium">Assign Wt (%)</label>
                    <input
                      type="number"
                      min={0}
                      max={100}
                      value={editSettings.wAssignments}
                      onChange={(e) =>
                        setEditSettings({ ...editSettings, wAssignments: Number(e.target.value) })
                      }
                      className="w-full px-3 py-1.5 border border-slate-300 rounded-lg text-slate-900 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                    />
                  </div>
                  <div>
                    <label className="block text-slate-600 mb-1 font-medium">Content Wt (%)</label>
                    <input
                      type="number"
                      min={0}
                      max={100}
                      value={editSettings.wContent}
                      onChange={(e) =>
                        setEditSettings({ ...editSettings, wContent: Number(e.target.value) })
                      }
                      className="w-full px-3 py-1.5 border border-slate-300 rounded-lg text-slate-900 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                    />
                  </div>
                  <div>
                    <label className="block text-slate-600 mb-1 font-medium">Att Wt (%)</label>
                    <input
                      type="number"
                      min={0}
                      max={100}
                      value={editSettings.wAttendance}
                      onChange={(e) =>
                        setEditSettings({ ...editSettings, wAttendance: Number(e.target.value) })
                      }
                      className="w-full px-3 py-1.5 border border-slate-300 rounded-lg text-slate-900 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                    />
                  </div>
                </div>
              </div>

              {/* Catch-up limit multiplier */}
              <div className="space-y-2">
                <h4 className="font-bold text-slate-900 uppercase tracking-wider text-[11px]">
                  Catch-up Pace Multiplier Limit
                </h4>
                <div className="flex items-center space-x-3">
                  <input
                    type="number"
                    step="0.1"
                    min={0.1}
                    max={10}
                    value={editSettings.catchupLimit}
                    onChange={(e) =>
                      setEditSettings({ ...editSettings, catchupLimit: Number(e.target.value) })
                    }
                    className="w-24 px-3 py-1.5 border border-slate-300 rounded-lg text-slate-900 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  />
                  <span className="text-slate-500 text-[11px]">
                    Maximum allowable multiple of normal pacing before a Behind learner is marked <strong>Unlikely</strong>.
                  </span>
                </div>
              </div>

              {/* Action Buttons */}
              <div className="flex items-center justify-end space-x-3 pt-4 border-t border-slate-200">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setIsSettingsOpen(false)}
                  disabled={savingSettings}
                >
                  Cancel
                </Button>
                <Button
                  type="submit"
                  disabled={savingSettings || weightsTotal !== 100}
                  className="bg-indigo-600 hover:bg-indigo-700 text-white"
                >
                  {savingSettings ? 'Saving...' : 'Save Settings'}
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
