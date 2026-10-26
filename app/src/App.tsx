import React, { useEffect } from 'react';
import { usePlatformStore } from '@/store/usePlatformStore';
import { db } from '@/core/db';
import { useLiveQuery } from 'dexie-react-hooks';
import { Navbar } from '@/app/Navbar';
import { AuthPage } from '@/features/auth/AuthPage';
import { UploadModal } from '@/features/upload/UploadModal';
import { LoginModal } from '@/features/auth/LoginModal';
import { OverviewDashboard } from '@/features/dashboard/OverviewDashboard';
import { AssignmentsView } from '@/features/assignments/AssignmentsView';
import { ContentView } from '@/features/content/ContentView';
import { AttendanceView } from '@/features/attendance/AttendanceView';
import { StudentProfileView } from '@/features/students/StudentProfileView';
import { CompareView } from '@/features/compare/CompareView';
import { AtRiskView } from '@/features/atrisk/AtRiskView';
import { ReportsView } from '@/features/reports/ReportsView';
import { BackupView } from '@/features/backup/BackupView';
import { SettingsView } from '@/features/settings/SettingsView';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { UploadCloud, Sparkles, BookOpen, CheckCircle2 } from 'lucide-react';

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
  } = usePlatformStore();

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

  // Live queries from IndexedDB
  const batches = useLiveQuery(() => db.batches.toArray()) || [];
  const snapshots = useLiveQuery(() => db.snapshots.toArray()) || [];
  const students = useLiveQuery(() => db.students.toArray()) || [];
  const studentSnapshots = useLiveQuery(() => db.studentSnapshots.toArray()) || [];
  const assignmentResults = useLiveQuery(() => db.assignmentResults.toArray()) || [];
  const weeklyConsumption = useLiveQuery(() => db.weeklyConsumption.toArray()) || [];
  const sessions = useLiveQuery(() => db.sessions.toArray()) || [];
  const attendance = useLiveQuery(() => db.attendance.toArray()) || [];

  // Determine current active batch
  const currentBatch =
    batches.find((b) => b.id === selectedBatchId) || batches[0] || null;

  // Sync selectedBatchId if needed
  const firstBatchId = batches[0]?.id;
  useEffect(() => {
    if (firstBatchId && !selectedBatchId) {
      setSelectedBatchId(firstBatchId);
    }
  }, [firstBatchId, selectedBatchId, setSelectedBatchId]);

  // Filter snapshots for current batch
  const batchSnapshots = snapshots.filter((s) => s.batchId === currentBatch?.id);
  const sortedBatchSnapshots = [...batchSnapshots].sort((a, b) =>
    a.snapshotDate.localeCompare(b.snapshotDate)
  );

  // Determine current snapshot (default to latest)
  const currentSnapshot =
    batchSnapshots.find((s) => s.id === selectedSnapshotId) ||
    sortedBatchSnapshots[sortedBatchSnapshots.length - 1] ||
    null;

  // Determine previous snapshot for deltas
  const currentIndex = sortedBatchSnapshots.findIndex(
    (s) => s.id === currentSnapshot?.id
  );
  const previousSnapshot = currentIndex > 0 ? sortedBatchSnapshots[currentIndex - 1] : null;

  const currentStudentSnapshots = studentSnapshots.filter(
    (s) => s.snapshotId === currentSnapshot?.id
  );
  const previousStudentSnapshots = previousSnapshot
    ? studentSnapshots.filter((s) => s.snapshotId === previousSnapshot.id)
    : [];

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
              <>
                {activeTab === 'overview' && (
                  <OverviewDashboard
                    snapshots={batchSnapshots}
                    currentSnapshot={currentSnapshot}
                    previousSnapshot={previousSnapshot}
                    currentStudentSnapshots={currentStudentSnapshots}
                    previousStudentSnapshots={previousStudentSnapshots}
                    allStudentSnapshots={studentSnapshots}
                    students={students}
                  />
                )}

                {activeTab === 'assignments' && (
                  <AssignmentsView
                    currentSnapshot={currentSnapshot}
                    assignmentResults={assignmentResults}
                    students={students}
                  />
                )}

                {activeTab === 'content' && (
                  <ContentView
                    currentSnapshot={currentSnapshot}
                    weeklyConsumption={weeklyConsumption}
                    studentSnapshots={currentStudentSnapshots}
                    students={students}
                  />
                )}

                {activeTab === 'attendance' && (
                  <AttendanceView
                    currentSnapshot={currentSnapshot}
                    sessions={sessions}
                    attendance={attendance}
                    studentSnapshots={currentStudentSnapshots}
                    students={students}
                  />
                )}

                {activeTab === 'students' && (
                  <StudentProfileView
                    students={students}
                    snapshots={batchSnapshots}
                    allStudentSnapshots={studentSnapshots}
                    assignmentResults={assignmentResults}
                    weeklyConsumption={weeklyConsumption}
                    sessions={sessions}
                    attendance={attendance}
                  />
                )}

                {activeTab === 'compare' && (
                  <CompareView
                    snapshots={batchSnapshots}
                    allStudentSnapshots={studentSnapshots}
                    students={students}
                  />
                )}

                {activeTab === 'atrisk' && (
                  <AtRiskView
                    currentSnapshot={currentSnapshot}
                    currentStudentSnapshots={currentStudentSnapshots}
                    students={students}
                  />
                )}

                {activeTab === 'reports' && (
                  <ReportsView
                    currentBatch={currentBatch}
                    currentSnapshot={currentSnapshot}
                    previousSnapshot={previousSnapshot}
                    currentStudentSnapshots={currentStudentSnapshots}
                    previousStudentSnapshots={previousStudentSnapshots}
                    students={students}
                  />
                )}

                {activeTab === 'backup' && <BackupView />}

                {activeTab === 'settings' && <SettingsView />}
              </>
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

      <UploadModal />
      <LoginModal />
    </div>
  );
};

export default App;
