import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { Card } from '@/ui/Card';
import { Button } from '@/ui/Button';
import { usePlatformStore } from '@/store/usePlatformStore';
import { apiClient, resolveBackendBatchId } from '@/core/api/client';
import type { AssignmentScheduleItem, RoadmapReferenceItem } from '@/types';
import {
  Calendar,
  AlertTriangle,
  CheckCircle2,
  AlertCircle,
  Save,
  Clock,
  Sparkles,
  BookOpen,
  Award,
} from 'lucide-react';

function addDaysToDate(dateStr: string, days: number): string {
  try {
    const [y, m, d] = dateStr.split('-').map(Number);
    const dt = new Date(Date.UTC(y, m - 1, d));
    dt.setUTCDate(dt.getUTCDate() + days);
    return dt.toISOString().slice(0, 10);
  } catch {
    return dateStr;
  }
}

export const AssignmentScheduleView: React.FC = () => {
  const { selectedBatchId, backendConnected } = usePlatformStore();

  const [isLoading, setIsLoading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [hasAcademicFile, setHasAcademicFile] = useState(false);
  const [batchStartDate, setBatchStartDate] = useState<string | null>(null);
  const [roadmapRange, setRoadmapRange] = useState<{ minDate: string | null; maxDate: string | null }>({
    minDate: null,
    maxDate: null,
  });
  const [roadmapItems, setRoadmapItems] = useState<RoadmapReferenceItem[]>([]);
  const [schedule, setSchedule] = useState<AssignmentScheduleItem[]>([]);
  const [statusMsg, setStatusMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [sectionFilter, setSectionFilter] = useState<'all' | 'formative' | 'comprehensive'>('all');

  const loadSchedule = useCallback(async () => {
    if (!selectedBatchId || !backendConnected || !apiClient.isAuthenticated()) {
      setSchedule([]);
      return;
    }

    setIsLoading(true);
    setStatusMsg(null);
    try {
      const targetBatchId = await resolveBackendBatchId(selectedBatchId);
      const res = await apiClient.getAssignmentSchedule(targetBatchId);
      setSchedule(res.schedule);
      setRoadmapItems(res.roadmapItems);
      setRoadmapRange(res.roadmapRange);
      setHasAcademicFile(res.hasAcademicFile);
      setBatchStartDate(res.batchStartDate || null);

      try {
        localStorage.setItem(`spp_assignment_schedule_${targetBatchId}`, JSON.stringify(res.schedule));
        if (selectedBatchId) {
          localStorage.setItem(`spp_assignment_schedule_${selectedBatchId}`, JSON.stringify(res.schedule));
        }
      } catch {
        // ignore
      }
    } catch (err: unknown) {
      // Check local cache if network/backend failed
      try {
        const cached = localStorage.getItem(`spp_assignment_schedule_${selectedBatchId}`);
        if (cached) {
          setSchedule(JSON.parse(cached));
        }
      } catch {
        // ignore
      }
      setStatusMsg({
        type: 'error',
        text: err instanceof Error ? err.message : 'Failed to load assignment schedule',
      });
    } finally {
      setIsLoading(false);
    }
  }, [selectedBatchId, backendConnected]);

  useEffect(() => {
    loadSchedule();
  }, [loadSchedule]);

  // Find start date of assignment from matched roadmap session or batch
  const getItemStartDate = useCallback(
    (item: AssignmentScheduleItem): string | null => {
      if (item.startDate) return item.startDate;
      if (item.roadmapKey) {
        const match = roadmapItems.find((r) => r.id === item.roadmapKey);
        if (match?.date) return match.date;
      }
      return batchStartDate || roadmapRange.minDate || null;
    },
    [roadmapItems, batchStartDate, roadmapRange.minDate]
  );

  // Calculate default deadline: Start date + 7 days for Formative, Start date + 10 days for Comprehensive
  const calculateDefaultDeadline = useCallback(
    (item: AssignmentScheduleItem): string | null => {
      const start = getItemStartDate(item);
      if (!start) return null;
      const days = item.type === 'module_end' ? 10 : 7;
      return addDaysToDate(start, days);
    },
    [getItemStartDate]
  );

  const handleDueDateChange = (originalIndex: number, val: string) => {
    const updated = [...schedule];
    updated[originalIndex] = {
      ...updated[originalIndex],
      dueDate: val || null,
    };
    setSchedule(updated);
  };

  const handleTypeChange = (originalIndex: number, val: 'regular' | 'module_end') => {
    const updated = [...schedule];
    const item = updated[originalIndex];
    const newType = val;

    // Recompute default due date with new type duration (+7d or +10d)
    const start = getItemStartDate(item);
    const newDefault = start ? addDaysToDate(start, newType === 'module_end' ? 10 : 7) : null;

    updated[originalIndex] = {
      ...item,
      type: newType,
      defaultDueDate: newDefault,
      suggestedDueDate: newDefault || item.suggestedDueDate,
    };
    setSchedule(updated);
  };

  const handleRoadmapMatchChange = (originalIndex: number, roadmapKey: string) => {
    const updated = [...schedule];
    const match = roadmapItems.find((r) => r.id === roadmapKey);
    const item = updated[originalIndex];
    const start = match?.date || batchStartDate || null;
    const defaultDate = start ? addDaysToDate(start, item.type === 'module_end' ? 10 : 7) : null;

    updated[originalIndex] = {
      ...item,
      roadmapKey: roadmapKey || null,
      matchedRoadmapTitle: match?.topic || null,
      confidence: match ? 'high' : 'none',
      startDate: start,
      defaultDueDate: defaultDate,
      suggestedDueDate: defaultDate || match?.date || null,
    };
    setSchedule(updated);
  };

  // Set default date for a single item
  const applyDefaultDateSingle = (originalIndex: number) => {
    const item = schedule[originalIndex];
    const defaultDate = calculateDefaultDeadline(item) || item.defaultDueDate || item.suggestedDueDate;
    if (defaultDate) {
      handleDueDateChange(originalIndex, defaultDate);
    }
  };

  // Set default dates for Formative assignments (Start Date + 7 Days)
  const handleSetDefaultForFormative = () => {
    let appliedCount = 0;
    const updated = schedule.map((item) => {
      if (item.type === 'regular') {
        const defaultDate = calculateDefaultDeadline(item) || item.defaultDueDate || item.suggestedDueDate;
        if (defaultDate) {
          appliedCount++;
          return { ...item, dueDate: defaultDate };
        }
      }
      return item;
    });
    setSchedule(updated);
    setStatusMsg({
      type: 'success',
      text: `Set default due dates (+7 days from start) for ${appliedCount} formative assignment(s). Click "Save Schedule" to apply.`,
    });
  };

  // Set default dates for Comprehensive assignments (Start Date + 10 Days)
  const handleSetDefaultForComprehensive = () => {
    let appliedCount = 0;
    const updated = schedule.map((item) => {
      if (item.type === 'module_end') {
        const defaultDate = calculateDefaultDeadline(item) || item.defaultDueDate || item.suggestedDueDate;
        if (defaultDate) {
          appliedCount++;
          return { ...item, dueDate: defaultDate };
        }
      }
      return item;
    });
    setSchedule(updated);
    setStatusMsg({
      type: 'success',
      text: `Set default due dates (+10 days from start) for ${appliedCount} comprehensive assignment(s). Click "Save Schedule" to apply.`,
    });
  };

  // Set default dates for all assignments (+7 days for Formative, +10 days for Comprehensive)
  const handleSetAllDefaults = () => {
    let appliedCount = 0;
    const updated = schedule.map((item) => {
      const defaultDate = calculateDefaultDeadline(item) || item.defaultDueDate || item.suggestedDueDate;
      if (defaultDate) {
        appliedCount++;
        return { ...item, dueDate: defaultDate };
      }
      return item;
    });
    setSchedule(updated);
    setStatusMsg({
      type: 'success',
      text: `Auto-populated default due dates for ${appliedCount} assignment(s) (Formative: +7 days, Comprehensive: +10 days). Click "Save Schedule" to persist.`,
    });
  };

  const isDateOutOfRange = (dateStr: string | null): boolean => {
    if (!dateStr || !roadmapRange.minDate || !roadmapRange.maxDate) return false;
    return dateStr < roadmapRange.minDate || dateStr > roadmapRange.maxDate;
  };

  const handleSave = async () => {
    if (!selectedBatchId) return;
    setIsSaving(true);
    setStatusMsg(null);
    try {
      const targetBatchId = await resolveBackendBatchId(selectedBatchId);
      await apiClient.updateAssignmentSchedule(targetBatchId, schedule);
      try {
        localStorage.setItem(`spp_assignment_schedule_${targetBatchId}`, JSON.stringify(schedule));
        localStorage.setItem(`spp_assignment_schedule_${selectedBatchId}`, JSON.stringify(schedule));
      } catch {
        // ignore
      }
      setStatusMsg({
        type: 'success',
        text: 'Assignment schedule and due dates saved successfully. Late submission calculations updated.',
      });
      await loadSchedule();
    } catch (err: unknown) {
      // Still persist locally so due dates are not lost in the UI
      try {
        localStorage.setItem(`spp_assignment_schedule_${selectedBatchId}`, JSON.stringify(schedule));
      } catch {
        // ignore
      }
      setStatusMsg({
        type: 'error',
        text: err instanceof Error ? err.message : 'Failed to save assignment schedule.',
      });
    } finally {
      setIsSaving(false);
    }
  };

  const confidenceBadge = (confidence?: 'high' | 'medium' | 'low' | 'none') => {
    switch (confidence) {
      case 'high':
        return (
          <span className="px-2 py-0.5 text-[10px] font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200 rounded-full">
            High match
          </span>
        );
      case 'medium':
        return (
          <span className="px-2 py-0.5 text-[10px] font-semibold bg-amber-50 text-amber-700 border border-amber-200 rounded-full">
            Medium match
          </span>
        );
      case 'low':
        return (
          <span className="px-2 py-0.5 text-[10px] font-semibold bg-slate-100 text-slate-600 border border-slate-200 rounded-full">
            Low match
          </span>
        );
      default:
        return (
          <span className="px-2 py-0.5 text-[10px] font-semibold bg-slate-100 text-slate-400 border border-slate-200 rounded-full">
            Unlinked
          </span>
        );
    }
  };

  // Split into Formative and Comprehensive groups with original array indices preserved
  const formativeItems = useMemo(
    () =>
      schedule
        .map((item, originalIndex) => ({ item, originalIndex }))
        .filter(({ item }) => item.type === 'regular'),
    [schedule]
  );

  const comprehensiveItems = useMemo(
    () =>
      schedule
        .map((item, originalIndex) => ({ item, originalIndex }))
        .filter(({ item }) => item.type === 'module_end'),
    [schedule]
  );

  const missingDatesCount = schedule.filter((s) => !s.dueDate).length;

  // Render an individual assignment row card
  const renderAssignmentCard = (item: AssignmentScheduleItem, originalIndex: number) => {
    const outOfRange = isDateOutOfRange(item.dueDate);
    const startDate = getItemStartDate(item);
    const defaultDeadline = calculateDefaultDeadline(item) || item.defaultDueDate;
    const isFormative = item.type === 'regular';

    return (
      <div
        key={item.lmsAssignmentName}
        className="p-3.5 bg-white rounded-xl border border-slate-200 shadow-xs hover:border-slate-300 transition-all space-y-3"
      >
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
          {/* Assignment Title & Roadmap Link */}
          <div className="space-y-1">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs font-bold text-slate-900">{item.lmsAssignmentName}</span>
              {confidenceBadge(item.confidence)}
              <span
                className={`px-2 py-0.5 text-[10px] font-semibold rounded-md border ${
                  isFormative
                    ? 'bg-blue-50 text-blue-700 border-blue-200'
                    : 'bg-purple-50 text-purple-700 border-purple-200'
                }`}
              >
                {isFormative ? 'Formative (+7d)' : 'Comprehensive (+10d)'}
              </span>
            </div>

            {item.matchedRoadmapTitle && (
              <div className="text-[11px] text-slate-500 flex items-center gap-1 font-mono">
                <span>Matched session:</span>
                <span className="text-[#0f766e] font-medium truncate max-w-md">
                  {item.matchedRoadmapTitle}
                </span>
              </div>
            )}

            {startDate && (
              <p className="text-[10px] text-slate-500 font-mono">
                📅 Start Date: <strong className="text-slate-700">{startDate}</strong>
                {defaultDeadline && (
                  <span>
                    {' '}
                    → Default Deadline ({isFormative ? '+7 days' : '+10 days'}):{' '}
                    <strong className="text-teal-700">{defaultDeadline}</strong>
                  </span>
                )}
              </p>
            )}
          </div>

          {/* Controls */}
          <div className="flex flex-wrap items-center gap-2.5">
            {/* Type Selector (Formative vs Comprehensive) */}
            <div>
              <label className="block text-[10px] font-semibold uppercase tracking-wider text-slate-500 mb-0.5">
                Classification
              </label>
              <select
                value={item.type}
                onChange={(e) =>
                  handleTypeChange(originalIndex, e.target.value as 'regular' | 'module_end')
                }
                className={`text-xs border rounded-lg px-2.5 py-1.5 font-medium focus:outline-none focus:ring-1 focus:ring-[#0f766e] ${
                  isFormative
                    ? 'bg-blue-50/50 text-blue-900 border-blue-200'
                    : 'bg-purple-50/50 text-purple-900 border-purple-200'
                }`}
              >
                <option value="regular">Formative Assignment</option>
                <option value="module_end">Comprehensive Assignment</option>
              </select>
            </div>

            {/* Roadmap Link Picker */}
            {roadmapItems.length > 0 && (
              <div>
                <label className="block text-[10px] font-semibold uppercase tracking-wider text-slate-500 mb-0.5">
                  Roadmap Item
                </label>
                <select
                  value={item.roadmapKey || ''}
                  onChange={(e) => handleRoadmapMatchChange(originalIndex, e.target.value)}
                  className="text-xs border border-slate-300 rounded-lg px-2 py-1.5 bg-white text-slate-800 max-w-[170px] truncate focus:outline-none focus:ring-1 focus:ring-[#0f766e]"
                >
                  <option value="">-- Manual Link --</option>
                  {roadmapItems.map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.topic} {r.date ? `(${r.date})` : ''}
                    </option>
                  ))}
                </select>
              </div>
            )}

            {/* Due Date Picker */}
            <div>
              <label className="block text-[10px] font-semibold uppercase tracking-wider text-slate-500 mb-0.5">
                Due Date
              </label>
              <div className="flex items-center gap-1.5">
                <input
                  type="date"
                  value={item.dueDate || ''}
                  onChange={(e) => handleDueDateChange(originalIndex, e.target.value)}
                  className={`text-xs border rounded-lg px-2 py-1.5 bg-white text-slate-800 font-mono tabular-nums focus:outline-none focus:ring-1 focus:ring-[#0f766e] ${
                    !item.dueDate
                      ? 'border-amber-300 bg-amber-50/30'
                      : outOfRange
                      ? 'border-rose-400 bg-rose-50/30'
                      : 'border-slate-300'
                  }`}
                />

                {/* Option to set default date for this item */}
                {defaultDeadline && item.dueDate !== defaultDeadline && (
                  <button
                    type="button"
                    onClick={() => applyDefaultDateSingle(originalIndex)}
                    title={`Click to set default deadline: ${defaultDeadline} (${isFormative ? '+7 days' : '+10 days'})`}
                    className="text-[10px] text-[#0f766e] hover:bg-teal-50 font-medium px-2 py-1 border border-teal-200 rounded-md cursor-pointer shrink-0 transition-colors flex items-center gap-1"
                  >
                    <Clock className="w-3 h-3" />
                    Set Default ({defaultDeadline})
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>

        {outOfRange && (
          <div className="flex items-center gap-1.5 text-[11px] text-rose-700 bg-rose-50/80 p-2 rounded-lg border border-rose-200">
            <AlertCircle className="w-3.5 h-3.5 shrink-0" />
            <span>
              Specified date ({item.dueDate}) falls outside the academic roadmap date range (
              {roadmapRange.minDate} to {roadmapRange.maxDate}).
            </span>
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="space-y-6 max-w-4xl mx-auto font-sans">
      {statusMsg && (
        <div
          className={`p-4 rounded-xl text-xs flex items-center gap-2 border ${
            statusMsg.type === 'success'
              ? 'bg-emerald-50 text-emerald-800 border-emerald-200'
              : 'bg-rose-50 text-rose-800 border-rose-200'
          }`}
        >
          {statusMsg.type === 'success' ? (
            <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
          ) : (
            <AlertCircle className="w-4 h-4 text-rose-600 shrink-0" />
          )}
          <span>{statusMsg.text}</span>
        </div>
      )}

      <Card
        title="Assignment Schedule & Due Dates"
        subtitle="Manage deadlines separately for Formative and Comprehensive curriculum assignments"
      >
        <div className="space-y-6">
          {/* Rules Explanation & Action Bar */}
          <div className="p-4 bg-slate-50/90 rounded-xl border border-slate-200 space-y-3">
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
              <div>
                <h4 className="text-xs font-bold text-slate-900 flex items-center gap-1.5">
                  <Calendar className="w-4 h-4 text-[#0f766e]" />
                  Curriculum Deadline Rules
                </h4>
                <div className="text-[11px] text-slate-600 mt-1 space-y-0.5">
                  <p>
                    • <strong className="text-blue-800">Formative assignments:</strong> Start Date +{' '}
                    <strong>7 days</strong> to deadline.
                  </p>
                  <p>
                    • <strong className="text-purple-800">Comprehensive assignments:</strong> Start Date +{' '}
                    <strong>10 days</strong> to deadline.
                  </p>
                  <p className="text-slate-400">
                    Use &ldquo;Set Default Date&rdquo; to auto-calculate deadlines, or customize any due date manually.
                  </p>
                </div>
              </div>

              {schedule.length > 0 && (
                <div className="flex flex-wrap items-center gap-2 shrink-0">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handleSetAllDefaults}
                    className="text-xs gap-1.5 text-slate-700 hover:text-slate-900 bg-white border-slate-300"
                  >
                    <Sparkles className="w-3.5 h-3.5 text-teal-600" />
                    Set All Default Dates
                  </Button>

                  <Button
                    variant="primary"
                    size="sm"
                    onClick={handleSave}
                    disabled={isSaving}
                    className="bg-[#0f766e] hover:bg-[#0d655e] text-white border-none text-xs gap-1.5"
                  >
                    <Save className="w-3.5 h-3.5" />
                    {isSaving ? 'Saving...' : 'Save Schedule'}
                  </Button>
                </div>
              )}
            </div>
          </div>

          {/* Academic File Notice */}
          {!hasAcademicFile && (
            <div className="p-3 bg-slate-50 text-slate-700 border border-slate-200 rounded-xl text-xs flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 text-slate-500 shrink-0" />
              <span>
                No academic workbook uploaded for this batch yet. Upload an academic sheet in the Backup tab to auto-match roadmap sessions and start dates.
              </span>
            </div>
          )}

          {/* Missing Due Dates Warning Banner */}
          {missingDatesCount > 0 && (
            <div className="p-3 bg-amber-50 text-amber-900 border border-amber-200 rounded-xl text-xs flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0" />
                <span>
                  <strong>
                    {missingDatesCount}{' '}
                    {missingDatesCount === 1 ? 'assignment has' : 'assignments have'} no due date:
                  </strong>{' '}
                  Lateness cannot be estimated until a due date is specified.
                </span>
              </div>
              <button
                type="button"
                onClick={handleSetAllDefaults}
                className="text-[11px] font-semibold text-amber-900 underline hover:text-amber-800 shrink-0"
              >
                Auto-fill defaults
              </button>
            </div>
          )}

          {/* Section Filter Pills */}
          {schedule.length > 0 && (
            <div className="flex items-center gap-2 border-b border-slate-100 pb-2">
              <button
                type="button"
                onClick={() => setSectionFilter('all')}
                className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                  sectionFilter === 'all'
                    ? 'bg-slate-900 text-white'
                    : 'text-slate-600 hover:bg-slate-100 border border-slate-200'
                }`}
              >
                All Assignments ({schedule.length})
              </button>
              <button
                type="button"
                onClick={() => setSectionFilter('formative')}
                className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors flex items-center gap-1.5 ${
                  sectionFilter === 'formative'
                    ? 'bg-blue-600 text-white'
                    : 'text-blue-800 bg-blue-50/50 hover:bg-blue-100/60 border border-blue-200'
                }`}
              >
                <BookOpen className="w-3.5 h-3.5" />
                Formative ({formativeItems.length})
              </button>
              <button
                type="button"
                onClick={() => setSectionFilter('comprehensive')}
                className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors flex items-center gap-1.5 ${
                  sectionFilter === 'comprehensive'
                    ? 'bg-purple-600 text-white'
                    : 'text-purple-800 bg-purple-50/50 hover:bg-purple-100/60 border border-purple-200'
                }`}
              >
                <Award className="w-3.5 h-3.5" />
                Comprehensive ({comprehensiveItems.length})
              </button>
            </div>
          )}

          {/* Skeletons while loading */}
          {isLoading && (
            <div className="space-y-3">
              <div className="h-16 bg-slate-100 rounded-xl animate-pulse" />
              <div className="h-16 bg-slate-100 rounded-xl animate-pulse" />
              <div className="h-16 bg-slate-100 rounded-xl animate-pulse" />
            </div>
          )}

          {/* Empty state */}
          {!isLoading && schedule.length === 0 && (
            <div className="p-8 bg-slate-50/50 rounded-xl border border-dashed border-slate-200 text-center text-xs text-slate-500">
              No LMS assignments found for this cohort batch. Upload an LMS cumulative report first to detect assignments.
            </div>
          )}

          {/* SECTION 1: FORMATIVE ASSIGNMENTS */}
          {!isLoading && (sectionFilter === 'all' || sectionFilter === 'formative') && (
            <div className="space-y-3">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pt-2">
                <div className="flex items-center gap-2">
                  <div className="p-1.5 bg-blue-100 text-blue-700 rounded-lg">
                    <BookOpen className="w-4 h-4" />
                  </div>
                  <div>
                    <h3 className="text-sm font-bold text-slate-900 flex items-center gap-2">
                      Formative Assignments
                      <span className="text-[11px] font-semibold px-2 py-0.5 rounded-full bg-blue-50 text-blue-700 border border-blue-200">
                        {formativeItems.length} items
                      </span>
                    </h3>
                    <p className="text-[11px] text-slate-500">
                      Regular curriculum assignments & weekly practice tasks (Default deadline: Start date + 7 days)
                    </p>
                  </div>
                </div>

                {formativeItems.length > 0 && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handleSetDefaultForFormative}
                    className="text-xs text-blue-800 border-blue-200 hover:bg-blue-50 bg-white gap-1 self-start sm:self-auto shrink-0"
                  >
                    <Clock className="w-3.5 h-3.5 text-blue-600" />
                    Set Default Dates (+7 Days)
                  </Button>
                )}
              </div>

              {formativeItems.length === 0 ? (
                <div className="p-4 bg-slate-50 rounded-lg border border-slate-200 text-xs text-slate-500 text-center">
                  No formative assignments classified. Change an assignment&apos;s classification to &ldquo;Formative Assignment&rdquo; above.
                </div>
              ) : (
                <div className="space-y-2.5">
                  {formativeItems.map(({ item, originalIndex }) =>
                    renderAssignmentCard(item, originalIndex)
                  )}
                </div>
              )}
            </div>
          )}

          {/* SECTION 2: COMPREHENSIVE ASSIGNMENTS */}
          {!isLoading && (sectionFilter === 'all' || sectionFilter === 'comprehensive') && (
            <div className="space-y-3 pt-4 border-t border-slate-100">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pt-2">
                <div className="flex items-center gap-2">
                  <div className="p-1.5 bg-purple-100 text-purple-700 rounded-lg">
                    <Award className="w-4 h-4" />
                  </div>
                  <div>
                    <h3 className="text-sm font-bold text-slate-900 flex items-center gap-2">
                      Comprehensive Assignments
                      <span className="text-[11px] font-semibold px-2 py-0.5 rounded-full bg-purple-50 text-purple-700 border border-purple-200">
                        {comprehensiveItems.length} items
                      </span>
                    </h3>
                    <p className="text-[11px] text-slate-500">
                      Module-End assessments, projects & capstones (Default deadline: Start date + 10 days)
                    </p>
                  </div>
                </div>

                {comprehensiveItems.length > 0 && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handleSetDefaultForComprehensive}
                    className="text-xs text-purple-800 border-purple-200 hover:bg-purple-50 bg-white gap-1 self-start sm:self-auto shrink-0"
                  >
                    <Clock className="w-3.5 h-3.5 text-purple-600" />
                    Set Default Dates (+10 Days)
                  </Button>
                )}
              </div>

              {comprehensiveItems.length === 0 ? (
                <div className="p-4 bg-slate-50 rounded-lg border border-slate-200 text-xs text-slate-500 text-center">
                  No comprehensive assignments classified. Change an assignment&apos;s classification to &ldquo;Comprehensive Assignment&rdquo; above.
                </div>
              ) : (
                <div className="space-y-2.5">
                  {comprehensiveItems.map(({ item, originalIndex }) =>
                    renderAssignmentCard(item, originalIndex)
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      </Card>
    </div>
  );
};
