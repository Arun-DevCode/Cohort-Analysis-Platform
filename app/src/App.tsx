import React, { useEffect, lazy, Suspense } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { usePlatformStore } from '@/store/usePlatformStore';
import { db } from '@/core/db';
import { useLiveQuery } from 'dexie-react-hooks';
import { Navbar } from '@/app/Navbar';
import { AuthPage } from '@/features/auth/AuthPage';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { UploadCloud, Sparkles, BookOpen, CheckCircle2 } from 'lucide-react';

// Lazy-loaded feature views and modals to keep the initial JS bundle minimal
const OverviewDashboard = lazy(() => import('@/features/dashboard/OverviewDashboard').then((m) => ({ default: m.OverviewDashboard })));
const AssignmentsView = lazy(() => import('@/features/assignments/AssignmentsView').then((m) => ({ default: m.AssignmentsView })));
const ContentView = lazy(() => import('@/features/content/ContentView').then((m) => ({ default: m.ContentView })));
const AttendanceView = lazy(() => import('@/features/attendance/AttendanceView').then((m) => ({ default: m.AttendanceView })));
const StudentProfileView = lazy(() => import('@/features/students/StudentProfileView').then((m) => ({ default: m.StudentProfileView })));
const CompareView = lazy(() => import('@/features/compare/CompareView').then((m) => ({ default: m.CompareView })));
const AtRiskView = lazy(() => import('@/features/atrisk/AtRiskView').then((m) => ({ default: m.AtRiskView })));
const ReportsView = lazy(() => import('@/features/reports/ReportsView').then((m) => ({ default: m.ReportsView })));
const BackupView = lazy(() => import('@/features/backup/BackupView').then((m) => ({ default: m.BackupView })));
const SettingsView = lazy(() => import('@/features/settings/SettingsView').then((m) => ({ default: m.SettingsView })));
const UploadModal = lazy(() => import('@/features/upload/UploadModal').then((m) => ({ default: m.UploadModal })));
const LoginModal = lazy(() => import('@/features/auth/LoginModal').then((m) => ({ default: m.LoginModal })));

const ViewLoadingFallback: React.FC = () => (
  <div className="space-y-4 animate-pulse py-4">
    <div className="h-6 bg-muted/60 rounded-md w-1/4" />
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
      {Array.from({ length: 4 }).map((_, i) => (
        <div key={i} className="h-28 bg-muted/50 rounded-[12px]" />
      ))}
    </div>
    <div className="h-64 bg-muted/40 rounded-[14px]" />
  </div>
);

export const App: React.FC = () => {
  const {
    selectedBatchId,
    setSelectedBatchId,
    selectedSnapshotId,
    setSelectedSnapshotId,
    activeTab,
    setUploadModalOpen,
    loadSettings,
    hydrateAuth,
    checkBackendStatus,
    backendUser,
  } = usePlatformStore(
    useShallow((s) => ({
      selectedBatchId: s.selectedBatchId,
      setSelectedBatchId: s.setSelectedBatchId,
      selectedSnapshotId: s.selectedSnapshotId,
      setSelectedSnapshotId: s.setSelectedSnapshotId,
      activeTab: s.activeTab,
      setUploadModalOpen: s.setUploadModalOpen,
      loadSettings: s.loadSettings,
      hydrateAuth: s.hydrateAuth,
      checkBackendStatus: s.checkBackendStatus,
      backendUser: s.backendUser,
    }))
  );

  useEffect(() => {
    loadSettings();
    hydrateAuth();
    checkBackendStatus();

    // Automatically purge all legacy demo / sample learner data from IndexedDB
    const purgeAllLearnerData = async () => {
      try {
        const hasPurgedFlag = localStorage.getItem('has_purged_learner_data_clean_slate_v6');
        const legacyBatches = await db.batches
          .filter((b) => b.id.includes('15748') || b.name.toLowerCase().includes('15748') || b.id.startsWith('batch_demo'))
          .toArray();

        if (!hasPurgedFlag || legacyBatches.length > 0) {
          await Promise.all([
            db.batches.clear(),
            db.students.clear(),
            db.snapshots.clear(),
            db.studentSnapshots.clear(),
            db.assignmentResults.clear(),
            db.weeklyConsumption.clear(),
            db.sessions.clear(),
            db.attendance.clear(),
            db.followups.clear(),
          ]);
          localStorage.setItem('has_purged_learner_data_clean_slate_v6', 'true');
          setSelectedBatchId(null);
          setSelectedSnapshotId(null);
        }
      } catch (err) {
        console.error('Failed to purge learner data', err);
      }
    };

    purgeAllLearnerData();
  }, [loadSettings, hydrateAuth, checkBackendStatus, setSelectedBatchId, setSelectedSnapshotId]);

  // Live queries from IndexedDB - scoped so inactive tab tables are not held in memory
  const liveBatches = useLiveQuery(() => db.batches.toArray());
  const batches = React.useMemo(() => liveBatches || [], [liveBatches]);

  const liveSnapshots = useLiveQuery(() => db.snapshots.toArray());
  const snapshots = React.useMemo(() => liveSnapshots || [], [liveSnapshots]);

  const liveStudents = useLiveQuery(() => db.students.toArray());
  const students = React.useMemo(() => liveStudents || [], [liveStudents]);

  const liveStudentSnapshots = useLiveQuery(() => db.studentSnapshots.toArray());
  const studentSnapshots = React.useMemo(() => liveStudentSnapshots || [], [liveStudentSnapshots]);

  const liveAssignmentResults = useLiveQuery(
    () => (activeTab === 'assignments' || activeTab === 'students' ? db.assignmentResults.toArray() : []),
    [activeTab]
  );
  const assignmentResults = React.useMemo(() => liveAssignmentResults || [], [liveAssignmentResults]);

  const liveWeeklyConsumption = useLiveQuery(
    () => (activeTab === 'content' || activeTab === 'students' ? db.weeklyConsumption.toArray() : []),
    [activeTab]
  );
  const weeklyConsumption = React.useMemo(() => liveWeeklyConsumption || [], [liveWeeklyConsumption]);

  const liveSessions = useLiveQuery(
    () => (activeTab === 'attendance' || activeTab === 'students' ? db.sessions.toArray() : []),
    [activeTab]
  );
  const sessions = React.useMemo(() => liveSessions || [], [liveSessions]);

  const liveAttendance = useLiveQuery(
    () => (activeTab === 'attendance' || activeTab === 'students' ? db.attendance.toArray() : []),
    [activeTab]
  );
  const attendance = React.useMemo(() => liveAttendance || [], [liveAttendance]);

  // Determine current active batch
  const currentBatch =
    batches.find((b) => b.id === selectedBatchId) || batches[0] || null;

  // Sync selectedBatchId if needed
  const firstBatchId = batches[0]?.id;
  useEffect(() => {
    if (firstBatchId && (!selectedBatchId || !batches.some((b) => b.id === selectedBatchId))) {
      setSelectedBatchId(firstBatchId);
    }
  }, [firstBatchId, selectedBatchId, batches, setSelectedBatchId]);

  // Filter snapshots for current batch
  const batchSnapshots = React.useMemo(() => {
    return snapshots.filter((s) => s.batchId === currentBatch?.id);
  }, [snapshots, currentBatch?.id]);

  const sortedBatchSnapshots = React.useMemo(() => {
    return [...batchSnapshots].sort((a, b) => a.snapshotDate.localeCompare(b.snapshotDate));
  }, [batchSnapshots]);

  // Determine current snapshot (default to latest)
  const currentSnapshot =
    batchSnapshots.find((s) => s.id === selectedSnapshotId) ||
    sortedBatchSnapshots[sortedBatchSnapshots.length - 1] ||
    null;

  // Sync selectedSnapshotId when batch changes or snapshot is removed
  useEffect(() => {
    if (currentBatch && sortedBatchSnapshots.length > 0) {
      const snapExists = sortedBatchSnapshots.some((s) => s.id === selectedSnapshotId);
      if (!selectedSnapshotId || !snapExists) {
        setSelectedSnapshotId(sortedBatchSnapshots[sortedBatchSnapshots.length - 1].id);
      }
    } else if (sortedBatchSnapshots.length === 0 && selectedSnapshotId) {
      setSelectedSnapshotId(null);
    }
  }, [currentBatch, sortedBatchSnapshots, selectedSnapshotId, setSelectedSnapshotId]);

  // Determine previous snapshot for deltas
  const currentIndex = sortedBatchSnapshots.findIndex(
    (s) => s.id === currentSnapshot?.id
  );
  const previousSnapshot = currentIndex > 0 ? sortedBatchSnapshots[currentIndex - 1] : null;

  const currentStudentSnapshots = React.useMemo(() => {
    return studentSnapshots.filter((s) => s.snapshotId === currentSnapshot?.id);
  }, [studentSnapshots, currentSnapshot?.id]);

  const previousStudentSnapshots = React.useMemo(() => {
    return previousSnapshot
      ? studentSnapshots.filter((s) => s.snapshotId === previousSnapshot.id)
      : [];
  }, [studentSnapshots, previousSnapshot]);

  // Student snapshots belonging to this batch (for trends & compare)
  const batchSnapshotIdSet = React.useMemo(() => {
    return new Set(batchSnapshots.map((s) => s.id));
  }, [batchSnapshots]);

  const batchStudentSnapshots = React.useMemo(() => {
    return studentSnapshots.filter((s) => batchSnapshotIdSet.has(s.snapshotId));
  }, [studentSnapshots, batchSnapshotIdSet]);

  // Students belonging to current snapshot of this batch
  const currentStudentIdSet = React.useMemo(() => {
    return new Set(currentStudentSnapshots.map((s) => s.studentId));
  }, [currentStudentSnapshots]);

  const currentBatchStudents = React.useMemo(() => {
    return students.filter((st) => currentStudentIdSet.has(st.id));
  }, [students, currentStudentIdSet]);

  // Students belonging to any snapshot of this batch (for student profile view)
  const allBatchStudentIdSet = React.useMemo(() => {
    return new Set(batchStudentSnapshots.map((s) => s.studentId));
  }, [batchStudentSnapshots]);

  const allBatchStudents = React.useMemo(() => {
    return students.filter((st) => allBatchStudentIdSet.has(st.id));
  }, [students, allBatchStudentIdSet]);

  // Scoped weekly consumption (for current snapshot)
  const currentWeeklyConsumption = React.useMemo(() => {
    return weeklyConsumption.filter((w) => w.snapshotId === currentSnapshot?.id);
  }, [weeklyConsumption, currentSnapshot?.id]);

  // Scoped assignment results (for current snapshot)
  const currentAssignmentResults = React.useMemo(() => {
    return assignmentResults.filter((a) => a.snapshotId === currentSnapshot?.id);
  }, [assignmentResults, currentSnapshot?.id]);

  // Scoped sessions and attendance (for current snapshot)
  const currentSessions = React.useMemo(() => {
    return sessions.filter((s) => s.snapshotId === currentSnapshot?.id);
  }, [sessions, currentSnapshot?.id]);

  const currentSessionIdSet = React.useMemo(() => {
    return new Set(currentSessions.map((s) => s.id));
  }, [currentSessions]);

  const currentAttendance = React.useMemo(() => {
    return attendance.filter((a) => currentSessionIdSet.has(a.sessionId));
  }, [attendance, currentSessionIdSet]);

  // If user is not authenticated, show proper Auth (Register / Login) page
  if (!backendUser) {
    return <AuthPage />;
  }

  return (
    <div className="min-h-screen bg-background text-foreground flex flex-col selection:bg-primary selection:text-primary-foreground font-sans">
      {/* Accessible skip-to-content link */}
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:fixed focus:top-4 focus:left-4 focus:z-50 focus:px-4 focus:py-2 focus:bg-surface focus:text-foreground focus:rounded-[8px] focus:shadow-md focus:ring-2 focus:ring-ring font-medium text-xs"
      >
        Skip to main content
      </a>

      <Navbar batches={batches} snapshots={snapshots} />

      <main id="main-content" className="flex-1 max-w-[1280px] w-full mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-8">
        {batches.length === 0 ? (
          /* Composed Empty State / Onboarding */
          <div className="max-w-xl mx-auto my-12 text-center space-y-6">
            <div className="w-14 h-14 rounded-[12px] bg-primary/10 text-primary flex items-center justify-center mx-auto shadow-xs">
              <BookOpen className="w-7 h-7" />
            </div>
            <div className="space-y-1.5">
              <span className="text-xs font-medium text-primary">Welcome, {backendUser.name || backendUser.email}</span>
              <h2 className="text-2xl font-bold text-foreground font-heading">
                Cohort Analytics & Trajectory Tracker
              </h2>
              <p className="text-xs text-muted-foreground max-w-md mx-auto leading-relaxed">
                Ingest LMS cumulative reports, track longitudinal batch progress, compare dated snapshots, and flag at-risk learners automatically.
              </p>
            </div>

            <Card className="text-left bg-surface shadow-[var(--shadow-tint-md)] rounded-[14px]">
              <CardHeader className="pb-3">
                <CardTitle className="text-sm font-semibold flex items-center gap-2">
                  <Sparkles className="w-4 h-4 text-primary" />
                  Getting started
                </CardTitle>
                <CardDescription className="text-xs text-muted-foreground">
                  Upload your cohort's LMS report to generate your dashboard
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 text-xs text-muted-foreground">
                  <div className="flex items-start gap-2">
                    <CheckCircle2 className="w-3.5 h-3.5 text-good shrink-0 mt-0.5" />
                    <span>LMS multi-sheet Excel ingestion</span>
                  </div>
                  <div className="flex items-start gap-2">
                    <CheckCircle2 className="w-3.5 h-3.5 text-good shrink-0 mt-0.5" />
                    <span>3x3 segment movement matrix</span>
                  </div>
                  <div className="flex items-start gap-2">
                    <CheckCircle2 className="w-3.5 h-3.5 text-good shrink-0 mt-0.5" />
                    <span>Automated at-risk detection</span>
                  </div>
                  <div className="flex items-start gap-2">
                    <CheckCircle2 className="w-3.5 h-3.5 text-good shrink-0 mt-0.5" />
                    <span>Longitudinal student trajectories</span>
                  </div>
                </div>

                <div className="pt-4 border-t border-border/40 flex justify-center">
                  <Button
                    size="lg"
                    variant="default"
                    onClick={() => setUploadModalOpen(true)}
                    className="w-full sm:w-auto gap-2 rounded-[8px] font-medium bg-primary hover:bg-primary/90 text-primary-foreground shadow-xs"
                  >
                    <UploadCloud className="w-4 h-4" />
                    Upload LMS Excel Report
                  </Button>
                </div>
              </CardContent>
            </Card>
          </div>
        ) : (
          /* Active Content Tabs */
          <div>
            {currentBatch && currentSnapshot ? (
              <Suspense fallback={<ViewLoadingFallback />}>
                {activeTab === 'overview' && (
                  <OverviewDashboard
                    snapshots={batchSnapshots}
                    currentSnapshot={currentSnapshot}
                    previousSnapshot={previousSnapshot}
                    currentStudentSnapshots={currentStudentSnapshots}
                    previousStudentSnapshots={previousStudentSnapshots}
                    allStudentSnapshots={batchStudentSnapshots}
                    students={currentBatchStudents}
                  />
                )}

                {activeTab === 'assignments' && (
                  <AssignmentsView
                    currentSnapshot={currentSnapshot}
                    assignmentResults={currentAssignmentResults}
                    students={currentBatchStudents}
                  />
                )}

                {activeTab === 'content' && (
                  <ContentView
                    currentSnapshot={currentSnapshot}
                    weeklyConsumption={currentWeeklyConsumption}
                    studentSnapshots={currentStudentSnapshots}
                    students={currentBatchStudents}
                  />
                )}

                {activeTab === 'attendance' && (
                  <AttendanceView
                    currentSnapshot={currentSnapshot}
                    sessions={currentSessions}
                    attendance={currentAttendance}
                    studentSnapshots={currentStudentSnapshots}
                    students={currentBatchStudents}
                  />
                )}

                {activeTab === 'students' && (
                  <StudentProfileView
                    students={allBatchStudents}
                    snapshots={batchSnapshots}
                    allStudentSnapshots={batchStudentSnapshots}
                    assignmentResults={currentAssignmentResults}
                    weeklyConsumption={currentWeeklyConsumption}
                    sessions={currentSessions}
                    attendance={currentAttendance}
                  />
                )}

                {activeTab === 'compare' && (
                  <CompareView
                    snapshots={batchSnapshots}
                    allStudentSnapshots={batchStudentSnapshots}
                    students={allBatchStudents}
                    assignmentResults={assignmentResults}
                    sessions={sessions}
                  />
                )}

                {activeTab === 'atrisk' && (
                  <AtRiskView
                    currentSnapshot={currentSnapshot}
                    currentStudentSnapshots={currentStudentSnapshots}
                    students={currentBatchStudents}
                  />
                )}

                {activeTab === 'reports' && (
                  <ReportsView
                    currentBatch={currentBatch}
                    currentSnapshot={currentSnapshot}
                    previousSnapshot={previousSnapshot}
                    currentStudentSnapshots={currentStudentSnapshots}
                    previousStudentSnapshots={previousStudentSnapshots}
                    students={currentBatchStudents}
                  />
                )}

                {activeTab === 'backup' && <BackupView />}

                {activeTab === 'settings' && <SettingsView />}
              </Suspense>
            ) : (
              <div className="rounded-[14px] bg-surface p-12 text-center shadow-[var(--shadow-tint-md)] max-w-md mx-auto my-12 space-y-4">
                <div className="w-12 h-12 rounded-[10px] bg-primary/10 text-primary flex items-center justify-center mx-auto">
                  <UploadCloud className="w-6 h-6" />
                </div>
                <div className="space-y-1">
                  <h3 className="text-sm font-semibold text-foreground">No snapshot available</h3>
                  <p className="text-xs text-muted-foreground">
                    Upload your first cumulative report for {currentBatch?.name || 'this batch'} to view analytics.
                  </p>
                </div>
                <Button
                  size="sm"
                  onClick={() => setUploadModalOpen(true)}
                  className="rounded-[8px] bg-primary text-primary-foreground hover:bg-primary/90"
                >
                  <UploadCloud className="w-3.5 h-3.5 mr-1.5" />
                  Upload Report
                </Button>
              </div>
            )}
          </div>
        )}
      </main>

      <Suspense fallback={null}>
        <UploadModal />
        <LoginModal />
      </Suspense>
    </div>
  );
};

export default App;
