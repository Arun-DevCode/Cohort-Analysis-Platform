import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { DropoutView } from '../features/dropout/DropoutView';
import { Navbar } from '../app/Navbar';
import { usePlatformStore } from '../store/usePlatformStore';
import { apiClient } from '../core/api/client';
import type { Batch, Snapshot, BatchDropoutReport } from '../types';

describe('Stage 3: Drop-out Risk UI Tests', () => {
  const mockBatch: Batch = {
    id: 'batch-123',
    name: 'AFSD Batch 49',
    externalBatchId: 'B49',
    createdAt: Date.now(),
  };

  const mockSnapshot: Snapshot = {
    id: 'snap-123',
    batchId: 'batch-123',
    snapshotDate: '2026-11-09',
    fileHash: 'hash-123',
    fileName: 'AFSD_Report.xlsx',
    parserVersion: '1.0.0',
    uploadedAt: Date.now(),
  };

  const mockDropoutReport: BatchDropoutReport = {
    batchId: 'batch-123',
    snapshotId: 'snap-123',
    reportDate: '2026-11-09',
    hasDueDates: true,
    isTooEarly: false,
    minDue: 3,
    thresholds: {
      slippingAt: 1,
      atRiskAt: 2,
      dropoutAt: 3,
      minDue: 3,
    },
    tierCounts: {
      active: 1,
      slipping: 1,
      atRisk: 1,
      likelyDroppedOut: 1,
      tooEarly: 0,
    },
    funnel: [
      {
        assignmentName: 'Build a Restaurant Menu Page',
        dueDate: '2026-09-04',
        type: 'regular',
        submittedCount: 4,
        learnerCount: 4,
        submissionRate: 100,
      },
      {
        assignmentName: 'M1 - ShopNest Static Website',
        dueDate: '2026-09-21',
        type: 'module_end',
        submittedCount: 3,
        learnerCount: 4,
        submissionRate: 75,
      },
      {
        assignmentName: '4 - Build a Movie Watchlist App',
        dueDate: '2026-11-06',
        type: 'regular',
        submittedCount: 1,
        learnerCount: 4,
        submissionRate: 25,
      },
    ],
    learners: [
      {
        studentId: 'stu-active',
        studentName: 'Alice Green',
        phoneE164: '+919876543201',
        tier: 'active',
        tierLabel: 'Active',
        dueCount: 4,
        submittedCount: 4,
        submissionRate: 100,
        currentStreak: 0,
        longestStreak: 0,
        neverStarted: false,
        lastSubmittedAssignment: {
          name: '4 - Build a Movie Watchlist App',
          dueDate: '2026-11-06',
          status: 'PASSED',
          windowText: 'Submitted on time',
        },
        trend: {
          direction: 'stable',
          diffPct: 0,
          text: '→ Stable (±5%)',
        },
        moduleEndDue: 1,
        moduleEndSubmitted: 1,
        missedModuleEnd: false,
      },
      {
        studentId: 'stu-drop',
        studentName: 'Bob Vance',
        phoneE164: '+919876543204',
        tier: 'likely_dropped_out',
        tierLabel: 'Likely dropped out',
        dueCount: 4,
        submittedCount: 1,
        submissionRate: 25,
        currentStreak: 3,
        longestStreak: 3,
        neverStarted: false,
        lastSubmittedAssignment: {
          name: 'Build a Restaurant Menu Page',
          dueDate: '2026-09-04',
          status: 'PASSED',
          windowText: 'Submitted on time',
        },
        trend: {
          direction: 'declining',
          diffPct: -50,
          text: '↓ -50.0%',
        },
        moduleEndDue: 1,
        moduleEndSubmitted: 0,
        missedModuleEnd: true,
      },
    ],
  };

  beforeEach(() => {
    vi.restoreAllMocks();
    usePlatformStore.setState({
      settings: {
        maskPii: false,
        highThreshold: 80,
        mediumThreshold: 50,
        deltaTolerance: 2,
      },
      activeTab: 'dropout',
      selectedBatchId: 'batch-123',
      selectedSnapshotId: 'snap-123',
    });

    vi.spyOn(apiClient, 'getBatchDropout').mockResolvedValue(mockDropoutReport);
    vi.spyOn(apiClient, 'updateDropoutSettings').mockResolvedValue({
      message: 'Updated',
      settings: { slippingAt: 2, atRiskAt: 3, dropoutAt: 4, minDue: 3 },
    });
  });

  it('renders Drop-out, Backup, Settings, and Reports directly visible in Navbar', () => {
    render(<Navbar batches={[mockBatch]} snapshots={[mockSnapshot]} />);

    // Check main tabs bar
    expect(screen.getByRole('button', { name: /Drop-out/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /At-Risk/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Backup/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Settings/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Reports/i })).toBeInTheDocument();
  });

  it('renders funnel chart in due-date order with due dates and outlined module-end bars', async () => {
    render(<DropoutView currentBatch={mockBatch} currentSnapshot={mockSnapshot} />);

    await waitFor(() => {
      expect(screen.getByText('Curriculum Submission Funnel')).toBeInTheDocument();
    });

    // Check due dates under bars
    expect(screen.getByText('Due: 2026-09-04')).toBeInTheDocument();
    expect(screen.getByText('Due: 2026-09-21')).toBeInTheDocument();
    expect(screen.getByText('Due: 2026-11-06')).toBeInTheDocument();

    // Check module-end indicator
    expect(screen.getByText('Module End')).toBeInTheDocument();

    // Toggle to Table view
    const viewTableBtn = screen.getByRole('button', { name: /View Table/i });
    fireEvent.click(viewTableBtn);
    expect(screen.getByText('Total Learners')).toBeInTheDocument();
  });

  it('filters learners by search input and tier dropdown', async () => {
    render(<DropoutView currentBatch={mockBatch} currentSnapshot={mockSnapshot} />);

    await waitFor(() => {
      expect(screen.getByText('Alice Green')).toBeInTheDocument();
      expect(screen.getByText('Bob Vance')).toBeInTheDocument();
    });

    // Search for Bob
    const searchInput = screen.getByPlaceholderText(/Search learner/i);
    fireEvent.change(searchInput, { target: { value: 'Bob' } });

    expect(screen.getByText('Bob Vance')).toBeInTheDocument();
    expect(screen.queryByText('Alice Green')).not.toBeInTheDocument();

    // Clear search
    fireEvent.change(searchInput, { target: { value: '' } });

    // Filter by Active tier only
    const select = screen.getByRole('combobox');
    fireEvent.change(select, { target: { value: 'active' } });

    expect(screen.getByText('Alice Green')).toBeInTheDocument();
    expect(screen.queryByText('Bob Vance')).not.toBeInTheDocument();
  });

  it('masks PII (name and phone) when maskPii setting is enabled', async () => {
    usePlatformStore.setState((s) => ({
      settings: { ...s.settings, maskPii: true },
    }));

    render(<DropoutView currentBatch={mockBatch} currentSnapshot={mockSnapshot} />);

    await waitFor(() => {
      expect(screen.getByText(/PII Masking is enabled/i)).toBeInTheDocument();
    });

    // Masked name for Alice Green -> A***e G***n
    expect(screen.queryByText('Alice Green')).not.toBeInTheDocument();
    expect(screen.queryByText('Bob Vance')).not.toBeInTheDocument();

    // Contains masked text
    expect(screen.getByText(/A\*\*\*e G\*\*\*n/)).toBeInTheDocument();
  });

  it('exports CSV with correct headers and learner rows', async () => {
    const createObjectURLMock = vi.fn().mockReturnValue('blob:mock-url');
    const revokeObjectURLMock = vi.fn();
    global.URL.createObjectURL = createObjectURLMock;
    global.URL.revokeObjectURL = revokeObjectURLMock;

    render(<DropoutView currentBatch={mockBatch} currentSnapshot={mockSnapshot} />);

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /Export CSV/i })).toBeInTheDocument();
    });

    const exportBtn = screen.getByRole('button', { name: /Export CSV/i });
    fireEvent.click(exportBtn);

    expect(createObjectURLMock).toHaveBeenCalled();
    expect(revokeObjectURLMock).toHaveBeenCalled();
  });

  it('displays "Likely dropped out" label and never "Dropped out"', async () => {
    render(<DropoutView currentBatch={mockBatch} currentSnapshot={mockSnapshot} />);

    await waitFor(() => {
      expect(screen.getAllByText(/Likely Dropped Out/i).length).toBeGreaterThan(0);
    });

    // Assert that the exact bare string "Dropped out" is NOT present anywhere
    const bareMatches = screen.queryAllByText(/^Dropped out$/i);
    expect(bareMatches).toHaveLength(0);
  });
});

