import React, { useState, useRef, useEffect } from 'react';
import { usePlatformStore, type ActiveTab } from '@/store/usePlatformStore';
import { Button } from '@/components/ui/button';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { db } from '@/core/db';
import type { Batch, Snapshot } from '@/types';
import {
  GraduationCap,
  UploadCloud,
  LayoutDashboard,
  FileCheck2,
  BookOpen,
  CalendarCheck,
  Users,
  GitCompare,
  AlertOctagon,
  FileDown,
  Database,
  Settings as SettingsIcon,
  LogOut,
  Trash2,
  MoreHorizontal,
} from 'lucide-react';
import { cn, formatSnapshotDate } from '@/lib/utils';

interface NavbarProps {
  batches: Batch[];
  snapshots: Snapshot[];
}

export const Navbar: React.FC<NavbarProps> = ({ batches, snapshots }) => {
  const {
    selectedBatchId,
    setSelectedBatchId,
    selectedSnapshotId,
    setSelectedSnapshotId,
    activeTab,
    setActiveTab,
    setUploadModalOpen,
    backendConnected,
    backendUser,
    logoutFromBackend,
    checkBackendStatus,
    settings,
    togglePiiMask,
  } = usePlatformStore();

  const [moreMenuOpen, setMoreMenuOpen] = useState(false);
  const [showClearConfirm, setShowClearConfirm] = useState(false);
  const moreMenuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    checkBackendStatus();
  }, [checkBackendStatus]);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (moreMenuRef.current && !moreMenuRef.current.contains(event.target as Node)) {
        setMoreMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const currentBatch = batches.find((b) => b.id === selectedBatchId) || batches[0];
  const batchSnapshots = snapshots.filter((s) => s.batchId === currentBatch?.id);
  const sortedBatchSnapshots = [...batchSnapshots].sort((a, b) =>
    a.snapshotDate.localeCompare(b.snapshotDate)
  );

  const tabs: { id: ActiveTab; label: string; icon: React.ReactNode }[] = [
    { id: 'overview', label: 'Overview', icon: <LayoutDashboard className="w-3.5 h-3.5" /> },
    { id: 'assignments', label: 'Assignments', icon: <FileCheck2 className="w-3.5 h-3.5" /> },
    { id: 'content', label: 'Content', icon: <BookOpen className="w-3.5 h-3.5" /> },
    { id: 'attendance', label: 'Attendance', icon: <CalendarCheck className="w-3.5 h-3.5" /> },
    { id: 'students', label: 'Students', icon: <Users className="w-3.5 h-3.5" /> },
    { id: 'compare', label: 'Compare', icon: <GitCompare className="w-3.5 h-3.5" /> },
    { id: 'atrisk', label: 'At-Risk', icon: <AlertOctagon className="w-3.5 h-3.5" /> },
    { id: 'reports', label: 'Reports', icon: <FileDown className="w-3.5 h-3.5" /> },
    { id: 'backup', label: 'Backup', icon: <Database className="w-3.5 h-3.5" /> },
    { id: 'settings', label: 'Settings', icon: <SettingsIcon className="w-3.5 h-3.5" /> },
  ];

  const userInitials = backendUser?.name
    ? backendUser.name
        .split(' ')
        .map((p) => p[0])
        .join('')
        .slice(0, 2)
        .toUpperCase()
    : backendUser?.email?.slice(0, 2).toUpperCase() || 'U';

  return (
    <header className="bg-surface/95 backdrop-blur-md border-b border-border/80 sticky top-0 z-30 shadow-xs">
      {/* Top Brand Bar */}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between h-16 gap-4">
          {/* Logo & Brand: title never wraps; subtitle shortened to 'Cohort analytics' */}
          <div className="flex items-center gap-3 min-w-fit">
            <div className="w-8 h-8 rounded-lg bg-primary flex items-center justify-center text-primary-foreground shadow-xs">
              <GraduationCap className="w-4 h-4" />
            </div>
            <div>
              <h1 className="text-sm font-semibold text-foreground leading-tight font-heading whitespace-nowrap">
                Student Progress Platform
              </h1>
              <p className="text-[11px] text-muted-foreground whitespace-nowrap">
                Cohort analytics
              </p>
            </div>
          </div>

          {/* Batch & Report Date Selector with Batch Name & Batch Code */}
          {batches.length > 0 && (
            <div className="hidden md:flex items-center gap-3">
              <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <span className="font-medium text-foreground">Batch:</span>
                <select
                  value={currentBatch?.id || ''}
                  onChange={(e) => {
                    const newBatchId = e.target.value;
                    setSelectedBatchId(newBatchId);
                    const bSnaps = snapshots
                      .filter((s) => s.batchId === newBatchId)
                      .sort((a, b) => a.snapshotDate.localeCompare(b.snapshotDate));
                    if (bSnaps.length > 0) {
                      setSelectedSnapshotId(bSnaps[bSnaps.length - 1].id);
                    } else {
                      setSelectedSnapshotId(null);
                    }
                  }}
                  className="border border-border/80 rounded-lg px-2.5 py-1 text-xs font-medium text-foreground bg-surface hover:bg-muted/30 focus:outline-none focus:ring-1 focus:ring-ring cursor-pointer transition-colors"
                >
                  {batches.map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.name}
                    </option>
                  ))}
                </select>
              </div>

              {currentBatch?.externalBatchId && (
                <div className="flex items-center gap-1 text-xs text-muted-foreground bg-muted/40 border border-border/60 px-2 py-0.5 rounded-md">
                  <span className="text-[10px] uppercase font-semibold text-muted-foreground">Code:</span>
                  <span className="font-mono text-xs font-semibold text-foreground">
                    {currentBatch.externalBatchId}
                  </span>
                </div>
              )}

              {sortedBatchSnapshots.length > 0 && (
                <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <span className="font-medium text-foreground">Report Date:</span>
                  <select
                    value={
                      selectedSnapshotId && sortedBatchSnapshots.some((s) => s.id === selectedSnapshotId)
                        ? selectedSnapshotId
                        : sortedBatchSnapshots[sortedBatchSnapshots.length - 1].id
                    }
                    onChange={(e) => setSelectedSnapshotId(e.target.value)}
                    className="border border-border/80 rounded-lg px-2.5 py-1 text-xs font-medium text-foreground bg-surface hover:bg-muted/30 focus:outline-none focus:ring-1 focus:ring-ring cursor-pointer transition-colors num"
                  >
                    {[...sortedBatchSnapshots].reverse().map((s) => (
                      <option key={s.id} value={s.id}>
                        {formatSnapshotDate(s.snapshotDate)}
                      </option>
                    ))}
                  </select>
                </div>
              )}
            </div>
          )}

          {/* Action Controls & User Profile */}
          <div className="flex items-center gap-2.5">
            {/* Live API: small green dot with tooltip */}
            <div
              className="relative flex items-center justify-center p-1.5 rounded-full hover:bg-muted/50 cursor-help transition-colors"
              title={backendConnected ? 'Live API: Connected to backend server' : 'Local Mode: Offline database'}
              aria-label={backendConnected ? 'Live API: Connected' : 'Local Mode'}
            >
              <span
                className={cn(
                  'w-2 h-2 rounded-full transition-colors',
                  backendConnected ? 'bg-good shadow-[0_0_8px_var(--good)]' : 'bg-muted-foreground/50'
                )}
              />
              {backendConnected && (
                <span className="absolute w-2 h-2 rounded-full bg-good animate-ping opacity-75" />
              )}
            </div>

            {/* Mask PII: compact switch with a label */}
            <div className="flex items-center gap-2 text-xs font-medium text-muted-foreground select-none px-2 py-1">
              <span id="mask-pii-label">Mask PII</span>
              <button
                type="button"
                role="switch"
                aria-checked={settings.maskPii}
                aria-labelledby="mask-pii-label"
                onClick={() => togglePiiMask()}
                className={cn(
                  'relative inline-flex h-4 w-7 shrink-0 items-center rounded-full transition-colors duration-200 ease-in-out focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring cursor-pointer',
                  settings.maskPii ? 'bg-primary' : 'bg-muted-foreground/30'
                )}
                title="Toggle Personally Identifiable Information Masking"
              >
                <span
                  className={cn(
                    'pointer-events-none inline-block h-3 w-3 transform rounded-full bg-white shadow-xs transition duration-200 ease-in-out',
                    settings.maskPii ? 'translate-x-3.5' : 'translate-x-0.5'
                  )}
                />
              </button>
            </div>

            {/* Upload Report: The ONLY primary button */}
            <Button
              size="sm"
              variant="default"
              onClick={() => setUploadModalOpen(true)}
              className="gap-1.5 shadow-xs rounded-lg bg-primary hover:bg-primary/90 text-primary-foreground font-medium active:scale-[0.98] transition-all"
            >
              <UploadCloud className="w-4 h-4" />
              <span className="hidden sm:inline">Upload Report</span>
            </Button>

            {/* "..." More menu containing Clear Data */}
            {batches.length > 0 && (
              <div className="relative" ref={moreMenuRef}>
                <Button
                  size="icon-sm"
                  variant="ghost"
                  onClick={() => setMoreMenuOpen(!moreMenuOpen)}
                  className="rounded-lg text-muted-foreground hover:text-foreground active:scale-[0.98] transition-all"
                  aria-label="More options"
                  title="More actions"
                >
                  <MoreHorizontal className="w-4 h-4" />
                </Button>

                {moreMenuOpen && (
                  <div className="absolute right-0 mt-1 w-44 bg-surface border border-border/80 rounded-xl shadow-lg py-1 z-50 animate-in fade-in zoom-in-95">
                    <button
                      type="button"
                      onClick={() => {
                        setMoreMenuOpen(false);
                        setShowClearConfirm(true);
                      }}
                      className="w-full text-left px-3 py-2 text-xs font-medium text-destructive hover:bg-destructive/10 flex items-center gap-2 transition-colors cursor-pointer"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                      <span>Clear Data…</span>
                    </button>
                  </div>
                )}
              </div>
            )}

            {/* User Profile Chip */}
            {backendUser && (
              <div className="flex items-center gap-2 pl-2 sm:pl-3 border-l border-border/80">
                <Avatar size="sm" className="bg-primary/10 text-primary border border-primary/20">
                  <AvatarFallback>{userInitials}</AvatarFallback>
                </Avatar>
                <div className="hidden lg:flex flex-col text-left">
                  <span className="text-xs font-medium text-foreground leading-none">
                    {backendUser.name || backendUser.email.split('@')[0]}
                  </span>
                  <span className="text-[10px] text-muted-foreground leading-none mt-1">
                    {backendUser.email}
                  </span>
                </div>

                <Button
                  variant="ghost"
                  size="icon-sm"
                  onClick={() => logoutFromBackend()}
                  className="text-muted-foreground hover:text-destructive hover:bg-destructive/10 rounded-lg"
                  title="Sign Out"
                  aria-label="Sign out"
                >
                  <LogOut className="w-4 h-4" />
                </Button>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Confirmation Dialog for Clear Data */}
      {showClearConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-xs">
          <div className="bg-surface text-card-foreground border border-border/80 rounded-2xl shadow-xl max-w-sm w-full p-5 space-y-4 animate-in fade-in zoom-in-95">
            <div className="space-y-1.5">
              <h3 className="text-sm font-semibold text-foreground">Clear all data?</h3>
              <p className="text-xs text-muted-foreground leading-relaxed">
                This will permanently remove all local batch records, uploaded reports, and student snapshots. This action cannot be undone.
              </p>
            </div>
            <div className="flex items-center justify-end gap-2 pt-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setShowClearConfirm(false)}
                className="rounded-lg text-xs"
              >
                Cancel
              </Button>
              <Button
                variant="destructive"
                size="sm"
                onClick={async () => {
                  setShowClearConfirm(false);
                  await db.delete();
                  await db.open();
                  window.location.reload();
                }}
                className="rounded-lg text-xs"
              >
                Clear Data
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Navigation Tabs Bar */}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 overflow-x-auto no-scrollbar">
        <nav className="flex space-x-1 py-1.5" aria-label="Main Navigation">
          {tabs.map((tab) => {
            const isActive = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={cn(
                  'inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium whitespace-nowrap transition-colors duration-150 active:scale-[0.98] cursor-pointer',
                  isActive
                    ? 'bg-primary/10 text-primary font-semibold'
                    : 'text-muted-foreground hover:text-foreground hover:bg-muted/40'
                )}
              >
                {tab.icon}
                <span>{tab.label}</span>
              </button>
            );
          })}
        </nav>
      </div>
    </header>
  );
};
