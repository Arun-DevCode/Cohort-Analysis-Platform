import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { CompletionView } from '../features/completion/CompletionView';
import { Navbar } from '../app/Navbar';
import { usePlatformStore } from '../store/usePlatformStore';
import { apiClient } from '../core/api/client';
import * as clientModule from '../core/api/client';
import type { Batch, Snapshot, BatchCompletionReport } from '../types';

describe('Stage 4: Completion Forecast UI Tests', () => {
  const mockBatch: Batch = {
    id: 'batch-comp-1',
    name: 'AFSD Batch 49',
    externalBatchId: 'B49',
    createdAt: Date.now(),
  };

  const mockSnapshot: Snapshot = {
    id: 'snap-comp-1',
    batchId: 'batch-comp-1',
    snapshotDate: '2026-11-06',
    fileHash: 'hash-comp',
    fileName: 'Cumulative_Report.xlsx',
    parserVersion: '1.0.0',
    uploadedAt: Date.now(),
  };

  const mockReport: BatchCompletionReport = {
    summary: {
      totalLearners: 2,
      onTrack: 1,
      recoverable: 1,
      unlikely: 0,
      tooEarly: 0,
      forecastFloor: 1,
      forecastCeiling: 2,
      forecastTotal: 2,
      rangeSentence: 'Completion forecast: between 1 and 2 of 2 learners are on track to complete.',
    },
    roadmap: {
      version: 'V9',
      startDate: '2026-08-17',
      endDate: '2027-02-15',
      reportDate: '2026-11-06',
      totalDays: 182,
      elapsedDays: 81,
      daysToEnd: 101,
      elapsedPct: 44.5,
      weeksLeft: 14.43,
      roadmapWeeks: 26.0,
      totalRegularAssignments: 7,
      regularAssignmentsDue: 4,
      totalLiveSessions: 73,
      remainingLiveSessions: 40,
      totalHeldLiveSessions: 36,
      totalContentReleased: 97,
      note: null,
    },
    settings: {
      minAssignments: 70,
      minContent: 60,
      minAttendance: 50,
      wAssignments: 50,
      wContent: 30,
      wAttendance: 20,
      tooEarlyMinDue: 3,
      tooEarlyMinElapsedPct: 25,
      catchupLimit: 2.0,
    },
    histogram: [
      { bin: '0-9', count: 0 },
      { bin: '50-59', count: 1 },
      { bin: '80-89', count: 1 },
    ],
    learners: [
      {
        studentId: 's1',
        name: 'Naveen Kumar',
        phoneE164: '+919952087613',
        readinessScore: 85.2,
        outlook: 'On track',
        assignments: {
          currentPct: 75.0,
          minimumPct: 70,
          status: 'Met',
          currentItems: 3,
          totalItems: 7,
          neededItems: 0,
          requiredPacePerWeek: 0,
          normalPacePerWeek: 0.269,
          catchupMultiple: 0,
          needsText: 'Met',
        },
        content: {
          currentPct: 94.2,
          minimumPct: 60,
          status: 'Met',
          currentItems: 91,
          totalItems: 97,
          neededItems: 0,
          requiredPacePerWeek: 0,
          normalPacePerWeek: 8.383,
          catchupMultiple: 0,
          needsText: 'Met',
        },
        attendance: {
          currentPct: 97.2,
          minimumPct: 50,
          status: 'Met',
          currentItems: 35,
          totalItems: 76,
          neededItems: 0,
          requiredPacePerWeek: 0,
          normalPacePerWeek: 2.808,
          catchupMultiple: 0,
          needsText: 'Met',
        },
      },
      {
        studentId: 's2',
        name: 'Manoj Kumar',
        phoneE164: '+919789270690',
        readinessScore: 56.7,
        outlook: 'Recoverable',
        assignments: {
          currentPct: 25.0,
          minimumPct: 70,
          status: 'Behind',
          currentItems: 1,
          totalItems: 7,
          neededItems: 4,
          requiredPacePerWeek: 0.28,
          normalPacePerWeek: 0.269,
          catchupMultiple: 1.03,
          needsText: 'needs 4 of 7 assignments by 15 Feb: 0.3 per week (1.0x the normal pace)',
        },
        content: {
          currentPct: 86.3,
          minimumPct: 60,
          status: 'Met',
          currentItems: 84,
          totalItems: 97,
          neededItems: 0,
          requiredPacePerWeek: 0,
          normalPacePerWeek: 8.383,
          catchupMultiple: 0,
          needsText: 'Met',
        },
        attendance: {
          currentPct: 91.7,
          minimumPct: 50,
          status: 'Met',
          currentItems: 33,
          totalItems: 76,
          neededItems: 0,
          requiredPacePerWeek: 0,
          normalPacePerWeek: 2.808,
          catchupMultiple: 0,
          needsText: 'Met',
        },
      },
    ],
  };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(clientModule, 'resolveBackendBatchId').mockResolvedValue('batch-comp-1');
    vi.spyOn(apiClient, 'getBatchCompletion').mockResolvedValue(mockReport);
  });

  it('renders Completion tab in Navbar', () => {
    render(<Navbar batches={[mockBatch]} snapshots={[mockSnapshot]} />);
    expect(screen.getByRole('button', { name: /Completion/i })).toBeInTheDocument();
  });

  it('renders Four Outlook Cards and Range Sentence', async () => {
    render(<CompletionView currentBatch={mockBatch} currentSnapshot={mockSnapshot} />);

    await waitFor(() => {
      expect(screen.getByText('Completion Forecast')).toBeInTheDocument();
    });

    // 4 Outlook Cards
    expect(screen.getAllByText('On track').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Recoverable').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Unlikely').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Too early').length).toBeGreaterThan(0);

    // Range sentence
    expect(screen.getByText(/between 1 and 2 of 2 learners are on track to complete/i)).toBeInTheDocument();
  });

  it('renders mandatory "Not cross-checked with Score Card" note banner', async () => {
    render(<CompletionView currentBatch={mockBatch} currentSnapshot={mockSnapshot} />);

    await waitFor(() => {
      expect(screen.getByText(/Not cross-checked with Score Card/i)).toBeInTheDocument();
    });
  });

  it('renders Roadmap Strip with version, elapsed days, and end date', async () => {
    render(<CompletionView currentBatch={mockBatch} currentSnapshot={mockSnapshot} />);

    await waitFor(() => {
      expect(screen.getByText(/Roadmap \(V9\)/i)).toBeInTheDocument();
      expect(screen.getByText(/81 of 182 calendar days elapsed \(44.5%\)/i)).toBeInTheDocument();
      expect(screen.getByText(/101 days left/i)).toBeInTheDocument();
    });
  });

  it('renders Learner Table with area status chips and pace text', async () => {
    render(<CompletionView currentBatch={mockBatch} currentSnapshot={mockSnapshot} />);

    await waitFor(() => {
      expect(screen.getByText('Naveen Kumar')).toBeInTheDocument();
      expect(screen.getByText('Manoj Kumar')).toBeInTheDocument();
    });

    // Needs text with pace and multiple
    expect(
      screen.getByText(/needs 4 of 7 assignments by 15 Feb: 0.3 per week \(1.0x the normal pace\)/i)
    ).toBeInTheDocument();
  });

  it('filters learners by search input', async () => {
    render(<CompletionView currentBatch={mockBatch} currentSnapshot={mockSnapshot} />);

    await waitFor(() => {
      expect(screen.getByText('Naveen Kumar')).toBeInTheDocument();
    });

    const searchInput = screen.getByPlaceholderText(/Search learner by name or phone/i);
    fireEvent.change(searchInput, { target: { value: 'Manoj' } });

    await waitFor(() => {
      expect(screen.queryByText('Naveen Kumar')).not.toBeInTheDocument();
      expect(screen.getByText('Manoj Kumar')).toBeInTheDocument();
    });
  });

  it('masks PII according to platform settings', async () => {
    usePlatformStore.setState({
      settings: { ...usePlatformStore.getState().settings, maskPii: true },
    });

    render(<CompletionView currentBatch={mockBatch} currentSnapshot={mockSnapshot} />);

    await waitFor(() => {
      // Unmasked phone should not be in the document
      expect(screen.queryByText('+919952087613')).not.toBeInTheDocument();
      // Masked phone should appear: '+91 ****** 7613'
      expect(screen.getByText('+91 ****** 7613')).toBeInTheDocument();
    });
  });
});
