import React, { useState, useEffect, useMemo, useDeferredValue } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { usePlatformStore } from '@/store/usePlatformStore';
import { apiClient, resolveBackendBatchId } from '@/core/api/client';
import { formatStudentName, formatStudentPhone } from '@/core/identity/mask';
import type {
  Batch,
  Snapshot,
  BatchDropoutReport,
  DropoutTier,
  DropoutSettings,
} from '@/types';
import { Button } from '@/components/ui/button';
import {
  AlertTriangle,
  ArrowDownRight,
  ArrowUpRight,
  Calendar,
  CalendarCheck,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Download,
  Filter,
  Info,
  Search,
  Settings as SettingsIcon,
  Table as TableIcon,
  BarChart2,
  TrendingDown,
  Minus,
  Sparkles,
  ShieldCheck,
  X,
} from 'lucide-react';
import { cn } from '@/lib/utils';

interface DropoutViewProps {
  currentBatch: Batch | undefined;
  currentSnapshot: Snapshot | undefined;
}

const TIER_ORDER: Record<DropoutTier, number> = {
  likely_dropped_out: 0,
  at_risk: 1,
  slipping: 2,
  active: 3,
  too_early: 4,
};

export const DropoutView: React.FC<DropoutViewProps> = ({
  currentBatch,
  currentSnapshot,
}) => {
  const { settings, setActiveTab, setSettingsSubTab, backendUser } = usePlatformStore(
    useShallow((s) => ({
      settings: s.settings,
      setActiveTab: s.setActiveTab,
      setSettingsSubTab: s.setSettingsSubTab,
      backendUser: s.backendUser,
    }))
  );

  const [report, setReport] = useState<BatchDropoutReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Filters & display state
  const [search, setSearch] = useState('');
  const deferredSearch = useDeferredValue(search);
  const [selectedTierFilter, setSelectedTierFilter] = useState<DropoutTier | 'ALL'>('ALL');
  const [funnelViewMode, setFunnelViewMode] = useState<'chart' | 'table'>('chart');
  const [showHowItWorks, setShowHowItWorks] = useState(false);

  // Threshold Settings Drawer/Modal
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [savingSettings, setSavingSettings] = useState(false);
  const [settingsError, setSettingsError] = useState<string | null>(null);
  const [formSettings, setFormSettings] = useState<DropoutSettings>({
    slippingAt: 1,
    atRiskAt: 2,
    dropoutAt: 3,
    minDue: 3,
  });

  // Fetch Drop-out analytics for the single selected snapshot
  const fetchReport = async () => {
    if (!currentBatch || !currentSnapshot) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);

    try {
      const resolvedId = await resolveBackendBatchId(currentBatch.id);
      const snapshotQuery = currentSnapshot.snapshotDate || currentSnapshot.id;
      const data = await apiClient.getBatchDropout(resolvedId, snapshotQuery);
      setReport(data);
      if (data.thresholds) {
        setFormSettings(data.thresholds);
      }
    } catch (err: any) {
      console.error('Failed to load drop-out analytics:', err);
      setError(err?.message || 'Failed to calculate drop-out analytics.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchReport();
  }, [currentBatch?.id, currentSnapshot?.id]);

  // Handle Threshold Settings Save
  const handleSaveSettings = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!currentBatch) return;

    if (formSettings.slippingAt < 1) {
      setSettingsError('Slipping threshold must be at least 1.');
      return;
    }
    if (formSettings.slippingAt >= formSettings.atRiskAt) {
      setSettingsError('Slipping threshold must be strictly less than At-risk threshold.');
      return;
    }
    if (formSettings.atRiskAt >= formSettings.dropoutAt) {
      setSettingsError('At-risk threshold must be strictly less than Likely dropped out threshold.');
      return;
    }
    if (formSettings.minDue < 1) {
      setSettingsError('Minimum due assignments must be at least 1.');
      return;
    }

    setSavingSettings(true);
    setSettingsError(null);
    try {
      const resolvedId = await resolveBackendBatchId(currentBatch.id);
      await apiClient.updateDropoutSettings(resolvedId, formSettings);
      setIsSettingsOpen(false);
      await fetchReport();
    } catch (err: any) {
      console.error('Failed to update drop-out settings:', err);
      setSettingsError(err?.message || 'Failed to update settings');
    } finally {
      setSavingSettings(false);
    }
  };

  // Filter and sort learners by severity
  const filteredLearners = useMemo(() => {
    if (!report?.learners) return [];
    const query = deferredSearch.toLowerCase().trim();

    return report.learners
      .filter((l) => {
        const matchesTier =
          selectedTierFilter === 'ALL' || l.tier === selectedTierFilter;
        const matchesQuery =
          !query ||
          l.studentName.toLowerCase().includes(query) ||
          l.phoneE164.includes(query);
        return matchesTier && matchesQuery;
      })
      .sort((a, b) => {
        const orderA = TIER_ORDER[a.tier] ?? 99;
        const orderB = TIER_ORDER[b.tier] ?? 99;
        if (orderA !== orderB) return orderA - orderB;
        if (b.currentStreak !== a.currentStreak) return b.currentStreak - a.currentStreak;
        return a.submissionRate - b.submissionRate;
      });
  }, [report?.learners, selectedTierFilter, deferredSearch]);

  // CSV Export
  const handleExportCsv = () => {
    if (!report?.learners || report.learners.length === 0) return;

    const headers = [
      'Student ID',
      'Student Name',
      'Phone Number',
      'Drop-out Risk Tier',
      'Regular Due Count',
      'Regular Submitted Count',
      'Submission Rate (%)',
      'Current Streak (Missed)',
      'Longest Streak (Missed)',
      'Never Started',
      'Last Submitted Assignment',
      'Last Submitted Window',
      'Trend',
      'Module-End Due',
      'Module-End Submitted',
      'Missed Module-End',
    ];

    const rows = filteredLearners.map((l) => [
      `"${l.studentId}"`,
      `"${formatStudentName(l.studentName, settings.maskPii).replace(/"/g, '""')}"`,
      `"${formatStudentPhone(l.phoneE164, settings.maskPii)}"`,
      `"${l.tierLabel}"`,
      l.dueCount,
      l.submittedCount,
      `${l.submissionRate}%`,
      l.currentStreak,
      l.longestStreak,
      l.neverStarted ? 'YES' : 'NO',
      `"${(l.lastSubmittedAssignment?.name || 'None').replace(/"/g, '""')}"`,
      `"${(l.lastSubmittedAssignment?.windowText || 'N/A').replace(/"/g, '""')}"`,
      `"${l.trend.text}"`,
      l.moduleEndDue,
      l.moduleEndSubmitted,
      l.missedModuleEnd ? 'YES' : 'NO',
    ]);

    const csvContent = [headers.join(','), ...rows.map((r) => r.join(','))].join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `dropout_risk_${(currentBatch?.name || 'batch').replace(/\s+/g, '_')}_${report.reportDate}.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  if (loading) {
    return (
      <div className="space-y-4 animate-pulse py-6">
        <div className="h-6 bg-muted/60 rounded-md w-1/4" />
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="h-28 bg-muted/50 rounded-xl" />
          ))}
        </div>
        <div className="h-64 bg-muted/40 rounded-xl" />
      </div>
    );
  }

  if (error || !report) {
    return (
      <div className="rounded-2xl border border-destructive/20 bg-destructive/5 p-8 text-center max-w-lg mx-auto my-12 space-y-4">
        <AlertTriangle className="w-10 h-10 text-destructive mx-auto" />
        <div className="space-y-1">
          <h3 className="text-base font-semibold text-foreground">Drop-out Analytics Unavailable</h3>
          <p className="text-xs text-muted-foreground leading-relaxed">
            {error || 'Unable to compute drop-out analytics for this snapshot.'}
          </p>
        </div>
        <Button size="sm" variant="outline" onClick={fetchReport} className="rounded-lg text-xs">
          Try Again
        </Button>
      </div>
    );
  }

  // Missing due dates banner
  if (!report.hasDueDates) {
    return (
      <div className="space-y-6">
        <div className="rounded-2xl border border-amber-500/30 bg-amber-500/5 p-6 sm:p-8 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
          <div className="flex items-start gap-4">
            <div className="w-10 h-10 rounded-xl bg-amber-500/10 text-amber-600 flex items-center justify-center shrink-0">
              <Calendar className="w-5 h-5" />
            </div>
            <div className="space-y-1">
              <h3 className="text-sm font-semibold text-foreground">Set due dates to enable drop-out risk tracking</h3>
              <p className="text-xs text-muted-foreground max-w-2xl leading-relaxed">
                Drop-out risk analysis tracks consecutive missed deadlines on curriculum assignments. This batch currently has no due dates scheduled.
              </p>
            </div>
          </div>
          <Button
            size="sm"
            onClick={() => {
              setSettingsSubTab('schedule');
              setActiveTab('settings');
            }}
            className="rounded-lg gap-2 text-xs shrink-0 font-medium bg-amber-600 hover:bg-amber-700 text-white"
          >
            <CalendarCheck className="w-4 h-4" />
            Set Due Dates
          </Button>
        </div>

        <div className="rounded-2xl bg-surface border border-border/80 p-8 text-center max-w-md mx-auto space-y-2">
          <p className="text-xs text-muted-foreground">
            No risk tiers are evaluated until assignments have configured due dates.
          </p>
        </div>
      </div>
    );
  }

  const { tierCounts, thresholds } = report;
  const canEditSettings = backendUser?.role === 'admin' || backendUser?.role === 'trainer';

  return (
    <div className="space-y-6 pb-12">
      {/* Header bar: Title, snapshot date badge, how it is calculated toggle, settings */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2.5">
            <h2 className="text-lg font-bold text-foreground tracking-tight">Drop-out Risk Analytics</h2>
            <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-medium bg-muted text-muted-foreground">
              Report date: {report.reportDate}
            </span>
            {report.isTooEarly && (
              <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-semibold bg-blue-500/10 text-blue-700 border border-blue-500/20">
                Too early ({report.funnel.filter((f) => f.type === 'regular').length}/{report.minDue} regular due)
              </span>
            )}
          </div>
          <p className="text-xs text-muted-foreground mt-0.5">
            Consecutive missed regular assignments and engagement trends as of snapshot date. Module-end assignments are tracked separately.
          </p>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setShowHowItWorks(!showHowItWorks)}
            className="rounded-lg gap-1.5 text-xs font-medium"
          >
            <Info className="w-3.5 h-3.5 text-primary" />
            <span>How this is calculated</span>
            {showHowItWorks ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
          </Button>

          {canEditSettings && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => setIsSettingsOpen(true)}
              className="rounded-lg gap-1.5 text-xs font-medium"
              title="Configure risk thresholds"
            >
              <SettingsIcon className="w-3.5 h-3.5 text-muted-foreground" />
              <span>Thresholds</span>
            </Button>
          )}
        </div>
      </div>

      {/* Expandable "How this is calculated" explanation */}
      {showHowItWorks && (
        <div className="rounded-2xl border border-primary/20 bg-primary/5 p-5 space-y-3 animate-in fade-in zoom-in-95">
          <div className="flex items-center gap-2 text-primary font-semibold text-xs">
            <Sparkles className="w-4 h-4" />
            <span>Calculation Rules & Definitions</span>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs text-foreground/80 leading-relaxed">
            <div className="space-y-1.5">
              <p className="font-medium text-foreground">Top-down Tier Boundaries:</p>
              <ul className="list-disc list-inside space-y-1 text-muted-foreground">
                <li>
                  <strong className="text-rose-600 font-medium">Likely dropped out</strong>: Missed{' '}
                  <strong>&ge; {thresholds.dropoutAt}</strong> consecutive regular assignments, OR has 0 submissions with{' '}
                  <strong>&ge; {Math.max(thresholds.dropoutAt, thresholds.minDue)}</strong> regular assignments due.
                </li>
                <li>
                  <strong className="text-orange-600 font-medium">At risk</strong>: Missed{' '}
                  <strong>&ge; {thresholds.atRiskAt}</strong> consecutive regular assignments.
                </li>
                <li>
                  <strong className="text-amber-600 font-medium">Slipping</strong>: Missed{' '}
                  <strong>&ge; {thresholds.slippingAt}</strong> consecutive regular assignments.
                </li>
                <li>
                  <strong className="text-emerald-600 font-medium">Active</strong>: Missed 0 consecutive regular assignments (last due was submitted).
                </li>
              </ul>
            </div>
            <div className="space-y-1.5">
              <p className="font-medium text-foreground">Trend & Guardrails:</p>
              <ul className="list-disc list-inside space-y-1 text-muted-foreground">
                <li>
                  <strong>Trend</strong> requires at least 4 regular assignments due to compare the last 3 due assignments against earlier assignments.
                </li>
                <li>
                  Changes within a named <strong>&plusmn;5% band</strong> (<code className="text-[10px] bg-muted px-1 py-0.5 rounded">TREND_STABLE_BAND_PCT = 5.0</code>) are classified as Stable.
                </li>
                <li>
                  <strong>Module-end assignments</strong> are displayed in the funnel (outlined) and table, but <em>never</em> affect the drop-out risk tier.
                </li>
                <li>
                  <strong>Too Early Guardrail</strong>: If fewer than <strong>{thresholds.minDue}</strong> regular assignments are due as of the report date, risk tiers are suspended to avoid false early classifications.
                </li>
              </ul>
            </div>
          </div>
        </div>
      )}

      {/* Four Tier Metric Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* Active Card */}
        <div
          onClick={() => setSelectedTierFilter((prev) => (prev === 'active' ? 'ALL' : 'active'))}
          className={cn(
            'group rounded-2xl bg-surface border p-4 sm:p-5 transition-all cursor-pointer relative shadow-xs',
            selectedTierFilter === 'active'
              ? 'ring-2 ring-emerald-500 border-emerald-500/50 bg-emerald-500/5'
              : 'border-border/80 hover:border-emerald-500/40 hover:shadow-sm'
          )}
        >
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-muted-foreground">Active Learners</span>
            <div className="w-7 h-7 rounded-lg bg-emerald-500/10 text-emerald-600 flex items-center justify-center">
              <CheckCircle2 className="w-4 h-4" />
            </div>
          </div>
          <div className="mt-3 flex items-baseline gap-2">
            <span className="text-2xl font-bold text-foreground tracking-tight">{tierCounts.active}</span>
            <span className="text-[11px] text-muted-foreground font-medium">streak 0</span>
          </div>
          <p className="text-[11px] text-muted-foreground mt-1">
            Submitted the most recent regular due assignment
          </p>
        </div>

        {/* Slipping Card */}
        <div
          onClick={() => setSelectedTierFilter((prev) => (prev === 'slipping' ? 'ALL' : 'slipping'))}
          className={cn(
            'group rounded-2xl bg-surface border p-4 sm:p-5 transition-all cursor-pointer relative shadow-xs',
            selectedTierFilter === 'slipping'
              ? 'ring-2 ring-amber-500 border-amber-500/50 bg-amber-500/5'
              : 'border-border/80 hover:border-amber-500/40 hover:shadow-sm'
          )}
        >
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-muted-foreground">Slipping</span>
            <div className="w-7 h-7 rounded-lg bg-amber-500/10 text-amber-600 flex items-center justify-center">
              <Minus className="w-4 h-4" />
            </div>
          </div>
          <div className="mt-3 flex items-baseline gap-2">
            <span className="text-2xl font-bold text-foreground tracking-tight">{tierCounts.slipping}</span>
            <span className="text-[11px] text-amber-600 font-medium">missed &ge; {thresholds.slippingAt}</span>
          </div>
          <p className="text-[11px] text-muted-foreground mt-1">
            Missed latest deadline, requires prompt check-in
          </p>
        </div>

        {/* At-Risk Card */}
        <div
          onClick={() => setSelectedTierFilter((prev) => (prev === 'at_risk' ? 'ALL' : 'at_risk'))}
          className={cn(
            'group rounded-2xl bg-surface border p-4 sm:p-5 transition-all cursor-pointer relative shadow-xs',
            selectedTierFilter === 'at_risk'
              ? 'ring-2 ring-orange-500 border-orange-500/50 bg-orange-500/5'
              : 'border-border/80 hover:border-orange-500/40 hover:shadow-sm'
          )}
        >
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-muted-foreground">At Risk</span>
            <div className="w-7 h-7 rounded-lg bg-orange-500/10 text-orange-600 flex items-center justify-center">
              <AlertTriangle className="w-4 h-4" />
            </div>
          </div>
          <div className="mt-3 flex items-baseline gap-2">
            <span className="text-2xl font-bold text-foreground tracking-tight">{tierCounts.atRisk}</span>
            <span className="text-[11px] text-orange-600 font-medium">missed &ge; {thresholds.atRiskAt}</span>
          </div>
          <p className="text-[11px] text-muted-foreground mt-1">
            Multiple consecutive deadlines missed
          </p>
        </div>

        {/* Likely Dropped Out Card */}
        <div
          onClick={() => setSelectedTierFilter((prev) => (prev === 'likely_dropped_out' ? 'ALL' : 'likely_dropped_out'))}
          className={cn(
            'group rounded-2xl bg-surface border p-4 sm:p-5 transition-all cursor-pointer relative shadow-xs',
            selectedTierFilter === 'likely_dropped_out'
              ? 'ring-2 ring-rose-500 border-rose-500/50 bg-rose-500/5'
              : 'border-border/80 hover:border-rose-500/40 hover:shadow-sm'
          )}
        >
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-muted-foreground">Likely Dropped Out</span>
            <div className="w-7 h-7 rounded-lg bg-rose-500/10 text-rose-600 flex items-center justify-center">
              <TrendingDown className="w-4 h-4" />
            </div>
          </div>
          <div className="mt-3 flex items-baseline gap-2">
            <span className="text-2xl font-bold text-foreground tracking-tight">{tierCounts.likelyDroppedOut}</span>
            <span className="text-[11px] text-rose-600 font-medium">missed &ge; {thresholds.dropoutAt}</span>
          </div>
          <p className="text-[11px] text-muted-foreground mt-1">
            Severely disengaged or unstarted
          </p>
        </div>
      </div>

      {/* Too Early Neutral Chip if applicable */}
      {report.isTooEarly && (
        <div className="rounded-xl border border-blue-500/20 bg-blue-500/5 px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Info className="w-4 h-4 text-blue-600 shrink-0" />
            <span className="text-xs text-foreground font-medium">
              Too early for drop-out risk categorization: Only {report.funnel.filter((f) => f.type === 'regular').length} regular curriculum assignments are due (minimum required is {thresholds.minDue}).
            </span>
          </div>
          <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-blue-500/10 text-blue-700">
            {tierCounts.tooEarly} Learners
          </span>
        </div>
      )}

      {/* Funnel Chart Card: Due Date Order, Solid Regular Bars, Outlined Module-End Bars */}
      <div className="rounded-2xl bg-surface border border-border/80 shadow-xs overflow-hidden">
        <div className="p-4 sm:p-5 border-b border-border/80 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <div className="flex items-center gap-2">
              <h3 className="text-sm font-bold text-foreground">Curriculum Submission Funnel</h3>
              <span className="text-[11px] text-muted-foreground font-medium">
                (Chronological Due-Date Order)
              </span>
            </div>
            <p className="text-xs text-muted-foreground mt-0.5">
              Solid bars represent regular assignments; outlined bars represent module-end projects.
            </p>
          </div>

          <div className="flex items-center gap-2">
            <Button
              variant={funnelViewMode === 'chart' ? 'default' : 'outline'}
              size="sm"
              onClick={() => setFunnelViewMode('chart')}
              className="rounded-lg text-xs gap-1.5 h-8"
            >
              <BarChart2 className="w-3.5 h-3.5" />
              <span>Chart</span>
            </Button>
            <Button
              variant={funnelViewMode === 'table' ? 'default' : 'outline'}
              size="sm"
              onClick={() => setFunnelViewMode('table')}
              className="rounded-lg text-xs gap-1.5 h-8"
            >
              <TableIcon className="w-3.5 h-3.5" />
              <span>View Table</span>
            </Button>
          </div>
        </div>

        {funnelViewMode === 'chart' ? (
          <div className="p-5 sm:p-6 space-y-4">
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-3">
              {report.funnel.map((item, idx) => {
                const isRegular = item.type === 'regular';
                const pct = item.submissionRate;

                return (
                  <div
                    key={idx}
                    className="flex flex-col justify-between p-3.5 rounded-xl border border-border/80 bg-background/50 hover:bg-background transition-colors"
                  >
                    <div className="space-y-1">
                      <div className="flex items-center justify-between gap-1">
                        <span className="text-[10px] font-semibold text-muted-foreground">
                          Step #{idx + 1}
                        </span>
                        <span
                          className={cn(
                            'text-[9px] font-semibold px-1.5 py-0.5 rounded',
                            isRegular
                              ? 'bg-primary/10 text-primary'
                              : 'bg-purple-500/10 text-purple-700 border border-purple-500/20'
                          )}
                        >
                          {isRegular ? 'Regular' : 'Module End'}
                        </span>
                      </div>
                      <h4
                        className="text-xs font-semibold text-foreground line-clamp-2"
                        title={item.assignmentName}
                      >
                        {item.assignmentName}
                      </h4>
                    </div>

                    <div className="mt-4 space-y-2">
                      {/* Bar Container */}
                      <div className="h-14 w-full bg-muted/40 rounded-lg flex items-end p-1 relative overflow-hidden">
                        <div
                          style={{ height: `${Math.max(8, pct)}%` }}
                          className={cn(
                            'w-full rounded transition-all duration-300',
                            isRegular
                              ? 'bg-primary hover:bg-primary/90'
                              : 'bg-indigo-50 border-2 border-indigo-600 dark:bg-indigo-950/30'
                          )}
                        />
                      </div>

                      <div className="flex items-baseline justify-between text-xs">
                        <span className="font-bold text-foreground">{pct}%</span>
                        <span className="text-[11px] text-muted-foreground">
                          {item.submittedCount}/{item.learnerCount}
                        </span>
                      </div>

                      <div className="pt-1 border-t border-border/60 text-center">
                        <span className="text-[10px] text-muted-foreground font-mono">
                          Due: {item.dueDate}
                        </span>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-muted/40 border-b border-border/80 text-muted-foreground font-semibold">
                <tr>
                  <th className="py-2.5 px-4">#</th>
                  <th className="py-2.5 px-4">Assignment Name</th>
                  <th className="py-2.5 px-4">Type</th>
                  <th className="py-2.5 px-4">Due Date</th>
                  <th className="py-2.5 px-4">Submitted</th>
                  <th className="py-2.5 px-4">Total Learners</th>
                  <th className="py-2.5 px-4 text-right">Submission Rate</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/60">
                {report.funnel.map((item, idx) => (
                  <tr key={idx} className="hover:bg-muted/20">
                    <td className="py-2.5 px-4 font-mono text-muted-foreground">{idx + 1}</td>
                    <td className="py-2.5 px-4 font-medium text-foreground">{item.assignmentName}</td>
                    <td className="py-2.5 px-4">
                      <span
                        className={cn(
                          'text-[10px] font-semibold px-2 py-0.5 rounded',
                          item.type === 'regular'
                            ? 'bg-primary/10 text-primary'
                            : 'bg-purple-500/10 text-purple-700 border border-purple-500/20'
                        )}
                      >
                        {item.type === 'regular' ? 'Regular' : 'Module End'}
                      </span>
                    </td>
                    <td className="py-2.5 px-4 font-mono text-muted-foreground">{item.dueDate}</td>
                    <td className="py-2.5 px-4 font-semibold text-foreground">{item.submittedCount}</td>
                    <td className="py-2.5 px-4 text-muted-foreground">{item.learnerCount}</td>
                    <td className="py-2.5 px-4 text-right font-bold text-foreground">
                      {item.submissionRate}%
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Learners Table Section: Severity Sorted */}
      <div className="rounded-2xl bg-surface border border-border/80 shadow-xs overflow-hidden space-y-4 p-4 sm:p-5">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <div className="flex items-center gap-2">
              <h3 className="text-sm font-bold text-foreground">Learner Risk Registry</h3>
              <span className="text-[11px] text-muted-foreground font-medium">
                ({filteredLearners.length} of {report.learners.length} learners)
              </span>
            </div>
            <p className="text-xs text-muted-foreground mt-0.5">
              Ranked top-down by severity (Likely dropped out &gt; At risk &gt; Slipping &gt; Active &gt; Too early).
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {/* Search Input */}
            <div className="relative min-w-[200px]">
              <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <input
                type="text"
                placeholder="Search learner..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="w-full pl-8 pr-3 py-1.5 rounded-lg border border-border bg-background text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary"
              />
              {search && (
                <button
                  onClick={() => setSearch('')}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                >
                  <X className="w-3 h-3" />
                </button>
              )}
            </div>

            {/* Tier Filter Dropdown */}
            <div className="flex items-center gap-1.5">
              <Filter className="w-3.5 h-3.5 text-muted-foreground" />
              <select
                value={selectedTierFilter}
                onChange={(e) => setSelectedTierFilter(e.target.value as any)}
                className="rounded-lg border border-border bg-background px-2.5 py-1.5 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
              >
                <option value="ALL">All Tiers ({report.learners.length})</option>
                <option value="likely_dropped_out">Likely dropped out ({tierCounts.likelyDroppedOut})</option>
                <option value="at_risk">At risk ({tierCounts.atRisk})</option>
                <option value="slipping">Slipping ({tierCounts.slipping})</option>
                <option value="active">Active ({tierCounts.active})</option>
                {tierCounts.tooEarly > 0 && <option value="too_early">Too early ({tierCounts.tooEarly})</option>}
              </select>
            </div>

            {/* CSV Export Button */}
            <Button
              variant="outline"
              size="sm"
              onClick={handleExportCsv}
              className="rounded-lg gap-1.5 text-xs font-medium h-8"
              title="Export filtered learner risk data to CSV"
            >
              <Download className="w-3.5 h-3.5" />
              <span>Export CSV</span>
            </Button>
          </div>
        </div>

        {/* PII Masking Note if active */}
        {settings.maskPii && (
          <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground bg-muted/30 px-3 py-1.5 rounded-lg w-fit">
            <ShieldCheck className="w-3.5 h-3.5 text-primary" />
            <span>PII Masking is enabled. Learner names and phone numbers are anonymized.</span>
          </div>
        )}

        {/* Table */}
        <div className="overflow-x-auto border border-border/80 rounded-xl">
          <table className="w-full text-left text-xs">
            <thead className="bg-muted/40 border-b border-border/80 text-muted-foreground font-semibold">
              <tr>
                <th className="py-3 px-4">Learner</th>
                <th className="py-3 px-3">Risk Tier</th>
                <th className="py-3 px-3 text-center">Due</th>
                <th className="py-3 px-3 text-center">Submitted</th>
                <th className="py-3 px-3 text-right">Rate %</th>
                <th className="py-3 px-3 text-center">Current Streak</th>
                <th className="py-3 px-4">Last Submitted</th>
                <th className="py-3 px-3">Trend</th>
                <th className="py-3 px-3 text-center">Module-End</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/60">
              {filteredLearners.length === 0 ? (
                <tr>
                  <td colSpan={9} className="py-12 text-center text-muted-foreground">
                    No learners match the selected filter or search query.
                  </td>
                </tr>
              ) : (
                filteredLearners.map((learner) => {
                  const maskedName = formatStudentName(learner.studentName, settings.maskPii);
                  const maskedPhone = formatStudentPhone(learner.phoneE164, settings.maskPii);

                  return (
                    <tr key={learner.studentId} className="hover:bg-muted/20 transition-colors">
                      {/* Name & phone */}
                      <td className="py-3 px-4">
                        <div className="space-y-0.5">
                          <span className="font-semibold text-foreground">{maskedName}</span>
                          <span className="block text-[11px] text-muted-foreground font-mono">
                            {maskedPhone}
                          </span>
                        </div>
                      </td>

                      {/* Tier Chip */}
                      <td className="py-3 px-3">
                        <div className="flex flex-col gap-1 items-start">
                          <span
                            className={cn(
                              'inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold whitespace-nowrap',
                              learner.tier === 'likely_dropped_out' &&
                                'bg-rose-500/10 text-rose-700 border border-rose-500/20',
                              learner.tier === 'at_risk' &&
                                'bg-orange-500/10 text-orange-700 border border-orange-500/20',
                              learner.tier === 'slipping' &&
                                'bg-amber-500/10 text-amber-700 border border-amber-500/20',
                              learner.tier === 'active' &&
                                'bg-emerald-500/10 text-emerald-700 border border-emerald-500/20',
                              learner.tier === 'too_early' &&
                                'bg-muted text-muted-foreground border border-border'
                            )}
                          >
                            {learner.tierLabel}
                          </span>

                          {learner.neverStarted && (
                            <span className="inline-flex items-center px-1.5 py-0.2 rounded text-[9px] font-semibold bg-red-100 text-red-800 dark:bg-red-950/40 dark:text-red-400">
                              Never Started
                            </span>
                          )}
                        </div>
                      </td>

                      {/* Due */}
                      <td className="py-3 px-3 text-center font-semibold text-foreground">
                        {learner.dueCount}
                      </td>

                      {/* Submitted */}
                      <td className="py-3 px-3 text-center font-semibold text-foreground">
                        {learner.submittedCount}
                      </td>

                      {/* Rate */}
                      <td className="py-3 px-3 text-right">
                        <span
                          className={cn(
                            'font-bold',
                            learner.submissionRate >= 80 && 'text-emerald-600',
                            learner.submissionRate >= 50 && learner.submissionRate < 80 && 'text-amber-600',
                            learner.submissionRate < 50 && 'text-rose-600'
                          )}
                        >
                          {learner.submissionRate}%
                        </span>
                      </td>

                      {/* Current Streak (missed) & longest */}
                      <td className="py-3 px-3 text-center">
                        <div className="space-y-0.5">
                          <span
                            className={cn(
                              'font-bold px-1.5 py-0.5 rounded text-[11px]',
                              learner.currentStreak >= 3 && 'bg-rose-500/10 text-rose-700',
                              learner.currentStreak === 2 && 'bg-orange-500/10 text-orange-700',
                              learner.currentStreak === 1 && 'bg-amber-500/10 text-amber-700',
                              learner.currentStreak === 0 && 'bg-emerald-500/10 text-emerald-700'
                            )}
                          >
                            {learner.currentStreak} missed
                          </span>
                          <span className="block text-[10px] text-muted-foreground">
                            max {learner.longestStreak}
                          </span>
                        </div>
                      </td>

                      {/* Last Submitted Assignment */}
                      <td className="py-3 px-4 max-w-xs">
                        {learner.lastSubmittedAssignment ? (
                          <div className="space-y-0.5">
                            <span
                              className="font-medium text-foreground truncate block"
                              title={learner.lastSubmittedAssignment.name}
                            >
                              {learner.lastSubmittedAssignment.name}
                            </span>
                            {learner.lastSubmittedAssignment.windowText && (
                              <span className="text-[10px] text-muted-foreground block">
                                {learner.lastSubmittedAssignment.windowText}
                              </span>
                            )}
                          </div>
                        ) : (
                          <span className="text-muted-foreground italic text-[11px]">No submissions</span>
                        )}
                      </td>

                      {/* Trend */}
                      <td className="py-3 px-3">
                        <div className="flex items-center gap-1">
                          {learner.trend.direction === 'improving' && (
                            <ArrowUpRight className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
                          )}
                          {learner.trend.direction === 'declining' && (
                            <ArrowDownRight className="w-3.5 h-3.5 text-rose-600 shrink-0" />
                          )}
                          {learner.trend.direction === 'stable' && (
                            <Minus className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                          )}
                          <span
                            className={cn(
                              'text-[11px] font-medium',
                              learner.trend.direction === 'improving' && 'text-emerald-600',
                              learner.trend.direction === 'declining' && 'text-rose-600',
                              learner.trend.direction === 'stable' && 'text-muted-foreground'
                            )}
                          >
                            {learner.trend.text}
                          </span>
                        </div>
                      </td>

                      {/* Module-End Status */}
                      <td className="py-3 px-3 text-center">
                        <div className="space-y-1">
                          <span className="text-[11px] font-medium text-foreground">
                            {learner.moduleEndSubmitted}/{learner.moduleEndDue}
                          </span>
                          {learner.missedModuleEnd && (
                            <span className="block px-1.5 py-0.2 rounded text-[9px] font-semibold bg-purple-500/10 text-purple-700 border border-purple-500/20">
                              Missed module-end
                            </span>
                          )}
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

      {/* Threshold Settings Modal/Drawer */}
      {isSettingsOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-xs">
          <div className="bg-surface text-card-foreground border border-border/80 rounded-2xl shadow-xl max-w-md w-full p-6 space-y-4 animate-in fade-in zoom-in-95">
            <div className="flex items-center justify-between pb-2 border-b border-border/60">
              <div className="flex items-center gap-2">
                <SettingsIcon className="w-4 h-4 text-primary" />
                <h3 className="text-sm font-semibold text-foreground">
                  Drop-out Threshold Settings
                </h3>
              </div>
              <button
                onClick={() => setIsSettingsOpen(false)}
                className="text-muted-foreground hover:text-foreground"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleSaveSettings} className="space-y-4">
              <p className="text-xs text-muted-foreground leading-relaxed">
                Configure the consecutive missed deadline thresholds for each drop-out risk tier.
                Thresholds must strictly increase (<code className="text-[10px] bg-muted px-1 py-0.5 rounded">slipping &lt; at_risk &lt; dropout</code>).
              </p>

              {settingsError && (
                <div className="rounded-lg bg-destructive/10 border border-destructive/20 p-2.5 text-xs text-destructive">
                  {settingsError}
                </div>
              )}

              <div className="grid grid-cols-2 gap-3 text-xs">
                <div>
                  <label className="font-medium text-foreground block mb-1">
                    Slipping at (missed):
                  </label>
                  <input
                    type="number"
                    min="1"
                    value={formSettings.slippingAt}
                    onChange={(e) =>
                      setFormSettings({ ...formSettings, slippingAt: parseInt(e.target.value) || 1 })
                    }
                    className="w-full rounded-lg border border-border bg-background px-3 py-1.5 text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
                    required
                  />
                  <span className="text-[10px] text-muted-foreground mt-0.5 block">Default: 1</span>
                </div>

                <div>
                  <label className="font-medium text-foreground block mb-1">
                    At risk at (missed):
                  </label>
                  <input
                    type="number"
                    min="2"
                    value={formSettings.atRiskAt}
                    onChange={(e) =>
                      setFormSettings({ ...formSettings, atRiskAt: parseInt(e.target.value) || 2 })
                    }
                    className="w-full rounded-lg border border-border bg-background px-3 py-1.5 text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
                    required
                  />
                  <span className="text-[10px] text-muted-foreground mt-0.5 block">Default: 2</span>
                </div>

                <div>
                  <label className="font-medium text-foreground block mb-1">
                    Likely dropped out at:
                  </label>
                  <input
                    type="number"
                    min="3"
                    value={formSettings.dropoutAt}
                    onChange={(e) =>
                      setFormSettings({ ...formSettings, dropoutAt: parseInt(e.target.value) || 3 })
                    }
                    className="w-full rounded-lg border border-border bg-background px-3 py-1.5 text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
                    required
                  />
                  <span className="text-[10px] text-muted-foreground mt-0.5 block">Default: 3</span>
                </div>

                <div>
                  <label className="font-medium text-foreground block mb-1">
                    Minimum due (guardrail):
                  </label>
                  <input
                    type="number"
                    min="1"
                    value={formSettings.minDue}
                    onChange={(e) =>
                      setFormSettings({ ...formSettings, minDue: parseInt(e.target.value) || 3 })
                    }
                    className="w-full rounded-lg border border-border bg-background px-3 py-1.5 text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
                    required
                  />
                  <span className="text-[10px] text-muted-foreground mt-0.5 block">Default: 3</span>
                </div>
              </div>

              <div className="flex items-center justify-end gap-2 pt-3 border-t border-border/60">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setIsSettingsOpen(false)}
                  className="rounded-lg text-xs"
                >
                  Cancel
                </Button>
                <Button
                  type="submit"
                  size="sm"
                  disabled={savingSettings}
                  className="rounded-lg text-xs font-medium"
                >
                  {savingSettings ? 'Saving...' : 'Save Thresholds'}
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
