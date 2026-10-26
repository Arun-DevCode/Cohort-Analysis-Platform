import React, { useState, useRef, useEffect } from 'react';
import { Modal } from '@/ui/Modal';
import { Button } from '@/components/ui/button';
import { parseWorkbook } from '@/core/parsers/workbookParser';
import { saveSnapshotTransaction, checkExistingSnapshot } from '@/core/db/snapshotRepository';
import { db } from '@/core/db';
import { usePlatformStore } from '@/store/usePlatformStore';
import type { ParseResult } from '@/types';
import {
  UploadCloud,
  FileSpreadsheet,
  AlertCircle,
  AlertTriangle,
  CheckCircle2,
  Calendar,
  Layers,
  Users,
  Hash,
  Sparkles,
  ArrowRight,
  RotateCcw,
} from 'lucide-react';
import { useLiveQuery } from 'dexie-react-hooks';
import { apiClient } from '@/core/api/client';

export const UploadModal: React.FC = () => {
  const {
    isUploadModalOpen,
    setUploadModalOpen,
    setSelectedBatchId,
    setSelectedSnapshotId,
    backendConnected,
    settings,
  } = usePlatformStore();

  const liveBatches = useLiveQuery(() => db.batches.toArray());
  const batches = React.useMemo(() => liveBatches || [], [liveBatches]);

  const [file, setFile] = useState<File | null>(null);
  const [isParsing, setIsParsing] = useState(false);
  const [parseResult, setParseResult] = useState<ParseResult | null>(null);
  const [batchId, setBatchId] = useState<string>('');
  const [batchName, setBatchName] = useState<string>('');
  const [batchCode, setBatchCode] = useState<string>('');
  const [snapshotDate, setSnapshotDate] = useState<string>(
    new Date().toISOString().split('T')[0]
  );
  const [isOverwriting, setIsOverwriting] = useState(false);
  const [existingFound, setExistingFound] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);

  // Initialize or reset defaults when modal opens
  useEffect(() => {
    if (isUploadModalOpen && !batchId) {
      if (batches.length > 0) {
        const first = batches[0];
        setBatchId(first.id);
        setBatchName(first.name);
        setBatchCode(first.externalBatchId || '');
      } else {
        const newId = `batch_${Date.now()}`;
        setBatchId(newId);
        setBatchName('');
        setBatchCode('');
      }
    }
  }, [isUploadModalOpen, batches, batchId]);

  const resetState = () => {
    setFile(null);
    setIsParsing(false);
    setParseResult(null);
    setBatchId('');
    setBatchName('');
    setBatchCode('');
    setIsOverwriting(false);
    setExistingFound(false);
    setIsSaving(false);
    setErrorMsg(null);
  };

  const handleClose = () => {
    resetState();
    setUploadModalOpen(false);
  };

  const handleFileProcess = async (selectedFile: File) => {
    if (!selectedFile.name.endsWith('.xlsx')) {
      setErrorMsg('Please select a valid .xlsx Excel workbook.');
      return;
    }
    if (selectedFile.size > 25 * 1024 * 1024) {
      setErrorMsg('File size exceeds maximum allowed 25 MB.');
      return;
    }

    setFile(selectedFile);
    setErrorMsg(null);
    setIsParsing(true);

    try {
      const buffer = await selectedFile.arrayBuffer();

      // Check if Web Worker is available, fallback to direct execution
      let result: ParseResult;
      try {
        const worker = new Worker(new URL('../../workers/parse.worker.ts', import.meta.url), {
          type: 'module',
        });
        result = await new Promise<ParseResult>((resolve, reject) => {
          worker.onmessage = (e) => {
            if (e.data.type === 'SUCCESS') resolve(e.data.result);
            else reject(new Error(e.data.error));
            worker.terminate();
          };
          worker.onerror = (e) => {
            reject(new Error(e.message || 'Worker error'));
            worker.terminate();
          };
          worker.postMessage({
            buffer,
            fileName: selectedFile.name,
            thresholds: { high: settings.highThreshold, medium: settings.mediumThreshold },
          });
        });
      } catch {
        // Fallback for test or single-thread environments
        result = await parseWorkbook(buffer, selectedFile.name, {
          high: settings.highThreshold,
          medium: settings.mediumThreshold,
        });
      }

      setParseResult(result);

      // Smart inference for batch name and batch code if not already set by user
      const detectedName = result.detectedBatchName || 'Cohort Batch';
      const inferredBatchName = batchName.trim() ? batchName.trim() : detectedName;

      // Extract batch code from filename or detected batch name if blank
      let inferredCode = batchCode.trim();
      if (!inferredCode) {
        const match = selectedFile.name.match(/batch[_\s-]*(\w+)/i) || detectedName.match(/batch[_\s-]*(\w+)/i);
        if (match) {
          inferredCode = `BATCH-${match[1]}`;
        } else {
          inferredCode = `BATCH-${new Date().getFullYear()}`;
        }
      }

      const existingBatch = batches.find(
        (b) =>
          b.name.toLowerCase() === inferredBatchName.toLowerCase() ||
          (inferredCode && b.externalBatchId?.toLowerCase() === inferredCode.toLowerCase())
      );

      const targetBatchId = existingBatch ? existingBatch.id : batchId || `batch_${Date.now()}`;

      setBatchId(targetBatchId);
      setBatchName(existingBatch ? existingBatch.name : inferredBatchName);
      setBatchCode(existingBatch?.externalBatchId || inferredCode);

      // Check if duplicate report exists for this batch on selected date
      const existing = await checkExistingSnapshot(targetBatchId, snapshotDate);
      setExistingFound(!!existing);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Failed to parse workbook');
    } finally {
      setIsParsing(false);
    }
  };

  const handleDateChange = async (date: string) => {
    setSnapshotDate(date);
    if (batchId) {
      const existing = await checkExistingSnapshot(batchId, date);
      setExistingFound(!!existing);
    }
  };

  const handleBatchSelect = async (selectedId: string) => {
    if (selectedId === 'NEW') {
      const newId = `batch_${Date.now()}`;
      setBatchId(newId);
      setBatchName('');
      setBatchCode('');
      setExistingFound(false);
    } else {
      setBatchId(selectedId);
      const b = batches.find((item) => item.id === selectedId);
      if (b) {
        setBatchName(b.name);
        setBatchCode(b.externalBatchId || '');
      }
      const existing = await checkExistingSnapshot(selectedId, snapshotDate);
      setExistingFound(!!existing);
    }
  };

  const handleConfirmSave = async () => {
    if (!parseResult || !batchId || !batchName.trim() || !snapshotDate) return;
    setIsSaving(true);
    setErrorMsg(null);

    const finalBatchName = batchName.trim();
    const finalBatchCode = batchCode.trim() || undefined;

    try {
      const { snapshotId } = await saveSnapshotTransaction({
        batchId,
        batchName: finalBatchName,
        batchCode: finalBatchCode,
        snapshotDate,
        parseResult,
        allowOverwrite: isOverwriting,
      });

      // Also sync to backend API if connected and authenticated
      if (backendConnected && apiClient.isAuthenticated() && file) {
        try {
          const backendBatches = await apiClient.listBatches();
          let backendBatch = backendBatches.find(
            (b) =>
              b.name.toLowerCase() === finalBatchName.toLowerCase() ||
              (finalBatchCode && b.externalBatchId === finalBatchCode) ||
              b.id === batchId
          );
          if (!backendBatch) {
            backendBatch = await apiClient.createBatch(
              finalBatchName,
              finalBatchCode || batchId,
              snapshotDate
            );
          }
          await apiClient.uploadReport(
            backendBatch.id,
            file,
            file.name,
            snapshotDate,
            isOverwriting
          );
        } catch (syncErr) {
          console.warn('Backend server sync note:', syncErr);
        }
      }

      setSelectedBatchId(batchId);
      setSelectedSnapshotId(snapshotId);
      handleClose();
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Failed to save batch report');
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <Modal
      isOpen={isUploadModalOpen}
      onClose={handleClose}
      title="Upload LMS Cumulative Report"
      description="Import multi-sheet Excel data and link to your cohort batch"
      maxWidth="lg"
    >
      <div className="space-y-4">
        {/* Batch Configuration Card */}
        <div className="bg-muted/20 border border-border/60 rounded-[14px] p-3.5 space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-foreground flex items-center gap-1.5">
              <Layers className="w-3.5 h-3.5 text-primary" />
              Cohort Batch Details
            </span>
            {batches.length > 0 && (
              <select
                className="text-[11px] font-medium border border-border/80 rounded-md px-2 py-0.5 bg-surface text-foreground focus:ring-1 focus:ring-ring focus:outline-none cursor-pointer"
                value={batches.some((b) => b.id === batchId) ? batchId : 'NEW'}
                onChange={(e) => handleBatchSelect(e.target.value)}
              >
                {batches.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name} {b.externalBatchId ? `(${b.externalBatchId})` : ''}
                  </option>
                ))}
                <option value="NEW">+ Create New Batch</option>
              </select>
            )}
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
            {/* Batch Name */}
            <div>
              <label className="block text-[11px] font-medium text-muted-foreground mb-1">
                Batch Name <span className="text-primary">*</span>
              </label>
              <div className="relative">
                <input
                  type="text"
                  className="w-full text-xs border border-border/80 rounded-[8px] px-2.5 py-1.5 bg-surface text-foreground placeholder:text-muted-foreground/60 focus:ring-1 focus:ring-primary focus:border-primary focus:outline-none transition-colors"
                  placeholder="e.g. Full Stack Web Development"
                  value={batchName}
                  onChange={(e) => setBatchName(e.target.value)}
                />
              </div>
            </div>

            {/* Batch Code */}
            <div>
              <label className="block text-[11px] font-medium text-muted-foreground mb-1 flex items-center gap-1">
                <Hash className="w-3 h-3 text-muted-foreground" />
                Batch Code <span className="text-primary">*</span>
              </label>
              <div className="relative">
                <input
                  type="text"
                  className="w-full text-xs font-mono border border-border/80 rounded-[8px] px-2.5 py-1.5 bg-surface text-foreground placeholder:text-muted-foreground/60 focus:ring-1 focus:ring-primary focus:border-primary focus:outline-none transition-colors"
                  placeholder="e.g. BATCH-15748"
                  value={batchCode}
                  onChange={(e) => setBatchCode(e.target.value)}
                />
              </div>
            </div>
          </div>

          {/* Report Date */}
          <div>
            <label className="block text-[11px] font-medium text-muted-foreground mb-1 flex items-center gap-1">
              <Calendar className="w-3 h-3 text-muted-foreground" />
              Report Date
            </label>
            <input
              type="date"
              className="w-full text-xs border border-border/80 rounded-[8px] px-2.5 py-1.5 bg-surface text-foreground focus:ring-1 focus:ring-primary focus:border-primary focus:outline-none transition-colors num"
              value={snapshotDate}
              onChange={(e) => handleDateChange(e.target.value)}
            />
          </div>
        </div>

        {/* Dropzone */}
        {!parseResult && !isParsing && (
          <div
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => {
              e.preventDefault();
              if (e.dataTransfer.files?.[0]) {
                handleFileProcess(e.dataTransfer.files[0]);
              }
            }}
            onClick={() => fileInputRef.current?.click()}
            className="group border border-dashed border-border/80 hover:border-primary/80 bg-muted/10 hover:bg-primary/5 rounded-[16px] p-6 text-center cursor-pointer transition-all duration-200 flex flex-col items-center justify-center gap-2.5 shadow-xs"
          >
            <div className="w-11 h-11 rounded-[12px] bg-primary/10 text-primary group-hover:bg-primary group-hover:text-primary-foreground group-hover:scale-105 transition-all duration-200 flex items-center justify-center shadow-xs">
              <UploadCloud className="w-5 h-5" />
            </div>
            <div>
              <p className="text-xs font-semibold text-foreground font-heading">
                Click or drag & drop LMS Cumulative Report (.xlsx)
              </p>
              <p className="text-[11px] text-muted-foreground mt-0.5">
                Standard 5-sheet LMS export · Up to 25 MB
              </p>
            </div>
            <span className="inline-flex items-center gap-1 text-[11px] text-primary font-medium group-hover:translate-x-0.5 transition-transform">
              Browse file <ArrowRight className="w-3 h-3" />
            </span>
            <input
              ref={fileInputRef}
              type="file"
              accept=".xlsx"
              className="hidden"
              onChange={(e) => {
                if (e.target.files?.[0]) {
                  handleFileProcess(e.target.files[0]);
                }
              }}
            />
          </div>
        )}

        {/* Parsing State */}
        {isParsing && (
          <div className="p-8 text-center space-y-3 bg-muted/10 rounded-[16px] border border-border/60">
            <div className="w-7 h-7 border-2 border-primary border-t-transparent rounded-full animate-spin mx-auto" />
            <div className="space-y-0.5">
              <p className="text-xs font-semibold text-foreground">
                Analyzing LMS Cumulative Report...
              </p>
              <p className="text-[11px] text-muted-foreground">
                Parsing 5 sheets, calculating trajectory & segment distributions
              </p>
            </div>
          </div>
        )}

        {/* Validation and Preview */}
        {parseResult && !isParsing && (
          <div className="space-y-3 animate-in fade-in duration-200">
            {/* File Info Card */}
            <div className="flex items-center justify-between p-3 bg-muted/20 rounded-[12px] border border-border/60 text-xs">
              <div className="flex items-center gap-2.5 min-w-0">
                <div className="w-8 h-8 rounded-[8px] bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 flex items-center justify-center shrink-0">
                  <FileSpreadsheet className="w-4 h-4" />
                </div>
                <div className="min-w-0">
                  <p className="font-medium text-foreground truncate text-xs">{file?.name}</p>
                  <p className="text-muted-foreground font-mono text-[10px]">
                    SHA-256: {parseResult.fileHash.slice(0, 14)}...
                  </p>
                </div>
              </div>
              <Button
                size="sm"
                variant="ghost"
                onClick={resetState}
                className="text-xs text-muted-foreground hover:text-foreground h-7 px-2 shrink-0 rounded-[6px]"
              >
                <RotateCcw className="w-3 h-3 mr-1" />
                Replace
              </Button>
            </div>

            {/* Ingestion Verification Metrics */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-semibold text-foreground uppercase tracking-wider">
                  Verification Summary
                </span>
                <span className="inline-flex items-center gap-1 text-[11px] text-emerald-600 dark:text-emerald-400 font-medium">
                  <CheckCircle2 className="w-3.5 h-3.5" /> 5 Sheets Ingested
                </span>
              </div>

              <div className="grid grid-cols-4 gap-2 text-center">
                <div className="bg-surface p-2 rounded-[10px] border border-border/60">
                  <p className="text-base font-bold text-foreground num">{parseResult.totalStudents}</p>
                  <p className="text-[10px] text-muted-foreground flex items-center justify-center gap-0.5 mt-0.5">
                    <Users className="w-3 h-3" /> Students
                  </p>
                </div>
                <div className="bg-surface p-2 rounded-[10px] border border-border/60">
                  <p className="text-base font-bold text-primary num">{parseResult.averages.assignmentSubmissionAvg}%</p>
                  <p className="text-[10px] text-muted-foreground mt-0.5">Assignments</p>
                </div>
                <div className="bg-surface p-2 rounded-[10px] border border-border/60">
                  <p className="text-base font-bold text-emerald-600 dark:text-emerald-400 num">
                    {parseResult.averages.totalConsumptionAvg}%
                  </p>
                  <p className="text-[10px] text-muted-foreground mt-0.5">Consumption</p>
                </div>
                <div className="bg-surface p-2 rounded-[10px] border border-border/60">
                  <p className="text-base font-bold text-sky-600 dark:text-sky-400 num">
                    {parseResult.averages.liveAttendanceAvg}%
                  </p>
                  <p className="text-[10px] text-muted-foreground mt-0.5">Attendance</p>
                </div>
              </div>

              {parseResult.warnings.length > 0 && (
                <div className="p-2.5 bg-amber-500/10 text-amber-800 dark:text-amber-300 rounded-[10px] border border-amber-500/20 text-xs flex items-start gap-2">
                  <AlertTriangle className="w-3.5 h-3.5 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
                  <div>
                    <p className="font-semibold text-[11px]">{parseResult.warnings.length} Ingestion Notice(s)</p>
                    <ul className="list-disc list-inside mt-0.5 text-[10px] text-amber-700 dark:text-amber-300/90 space-y-0.5">
                      {parseResult.warnings.slice(0, 2).map((w, i) => (
                        <li key={i}>{w.message}</li>
                      ))}
                    </ul>
                  </div>
                </div>
              )}

              {/* Overwrite Confirmation */}
              {existingFound && (
                <div className="p-2.5 bg-destructive/10 text-destructive rounded-[10px] border border-destructive/20 text-xs space-y-1.5">
                  <div className="flex items-center gap-1.5 font-semibold text-[11px]">
                    <AlertCircle className="w-3.5 h-3.5 shrink-0" />
                    <span>A report already exists for this batch on {snapshotDate}</span>
                  </div>
                  <label className="flex items-center gap-2 cursor-pointer font-normal text-[11px]">
                    <input
                      type="checkbox"
                      checked={isOverwriting}
                      onChange={(e) => setIsOverwriting(e.target.checked)}
                      className="rounded border-border text-primary focus:ring-ring"
                    />
                    Overwrite and update the report for this date
                  </label>
                </div>
              )}
            </div>
          </div>
        )}

        {errorMsg && (
          <div className="p-2.5 bg-destructive/10 text-destructive rounded-[10px] border border-destructive/20 text-xs flex items-center gap-2">
            <AlertCircle className="w-3.5 h-3.5 shrink-0" />
            <span className="text-[11px]">{errorMsg}</span>
          </div>
        )}

        {/* Footer Actions */}
        <div className="flex items-center justify-end gap-2 pt-3 border-t border-border/50">
          <Button
            variant="outline"
            size="sm"
            onClick={handleClose}
            className="rounded-[8px] text-xs h-8 px-3"
          >
            Cancel
          </Button>
          {parseResult && (
            <Button
              size="sm"
              disabled={
                !parseResult.success ||
                !batchName.trim() ||
                !batchCode.trim() ||
                !snapshotDate ||
                (existingFound && !isOverwriting) ||
                isSaving
              }
              onClick={handleConfirmSave}
              className="rounded-[8px] text-xs h-8 px-4 bg-primary hover:bg-primary/90 text-primary-foreground shadow-xs font-medium"
            >
              {isSaving ? (
                'Saving Batch Report...'
              ) : existingFound ? (
                'Replace Batch Report'
              ) : (
                <span className="flex items-center gap-1.5">
                  <Sparkles className="w-3.5 h-3.5" />
                  Save Batch Report
                </span>
              )}
            </Button>
          )}
        </div>
      </div>
    </Modal>
  );
};
