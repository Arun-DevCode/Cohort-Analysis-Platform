import React, { useState, useRef, useEffect, useCallback } from 'react';
import { Card } from '@/ui/Card';
import { Button } from '@/ui/Button';
import { db } from '@/core/db';
import { usePlatformStore } from '@/store/usePlatformStore';
import { apiClient, resolveBackendBatchId } from '@/core/api/client';
import type { StoredReportFile } from '@/types';
import {
  Download,
  Upload,
  Shield,
  CheckCircle2,
  AlertCircle,
  Key,
  FileSpreadsheet,
  Trash2,
  Layers,
  ChevronDown,
  ChevronRight,
  RefreshCw,
  Calendar,
  User,
  Clock,
  Check,
} from 'lucide-react';
import { useLiveQuery } from 'dexie-react-hooks';

export const BackupView: React.FC = () => {
  const { selectedBatchId, backendConnected } = usePlatformStore();
  const liveBatches = useLiveQuery(() => db.batches.toArray());
  const selectedBatch = liveBatches?.find((b) => b.id === selectedBatchId);

  // Backup / Restore state
  const [encrypt, setEncrypt] = useState(false);
  const [password, setPassword] = useState('');
  const [importPassword, setImportPassword] = useState('');
  const [isExporting, setIsExporting] = useState(false);
  const [isImporting, setIsImporting] = useState(false);
  const [statusMsg, setStatusMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  const importFileRef = useRef<HTMLInputElement>(null);
  const academicFileInputRef = useRef<HTMLInputElement>(null);

  // Stored reports state
  const [storedFiles, setStoredFiles] = useState<StoredReportFile[]>([]);
  const [isLoadingFiles, setIsLoadingFiles] = useState(false);
  const [isUploadingAcademic, setIsUploadingAcademic] = useState(false);
  const [showOlderAcademic, setShowOlderAcademic] = useState(false);
  const [fileActionError, setFileActionError] = useState<string | null>(null);
  const [fileActionSuccess, setFileActionSuccess] = useState<string | null>(null);

  // Deletion modal state
  const [fileToDelete, setFileToDelete] = useState<StoredReportFile | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  // Load stored files from backend
  const loadStoredFiles = useCallback(async () => {
    if (!selectedBatchId || !backendConnected || !apiClient.isAuthenticated()) {
      setStoredFiles([]);
      return;
    }

    setIsLoadingFiles(true);
    setFileActionError(null);
    try {
      const targetBatchId = await resolveBackendBatchId(selectedBatchId);
      const files = await apiClient.listBatchFiles(targetBatchId);
      setStoredFiles(files);
    } catch (err: unknown) {
      console.warn('Failed to load stored files:', err);
      // Non-blocking warning if offline
    } finally {
      setIsLoadingFiles(false);
    }
  }, [selectedBatchId, backendConnected]);

  useEffect(() => {
    loadStoredFiles();
  }, [loadStoredFiles]);

  // Derive AES-GCM key from password using PBKDF2
  const deriveKey = async (pass: string, salt: Uint8Array) => {
    const enc = new TextEncoder();
    const keyMaterial = await crypto.subtle.importKey(
      'raw',
      enc.encode(pass),
      { name: 'PBKDF2' },
      false,
      ['deriveKey']
    );
    return crypto.subtle.deriveKey(
      {
        name: 'PBKDF2',
        salt: salt as BufferSource,
        iterations: 100000,
        hash: 'SHA-256',
      },
      keyMaterial,
      { name: 'AES-GCM', length: 256 },
      false,
      ['encrypt', 'decrypt']
    );
  };

  const handleExportBackup = async () => {
    setIsExporting(true);
    setStatusMsg(null);

    try {
      const backupData = {
        version: '1.0.0',
        exportedAt: new Date().toISOString(),
        batches: await db.batches.toArray(),
        students: await db.students.toArray(),
        snapshots: await db.snapshots.toArray(),
        studentSnapshots: await db.studentSnapshots.toArray(),
        assignmentResults: await db.assignmentResults.toArray(),
        weeklyConsumption: await db.weeklyConsumption.toArray(),
        sessions: await db.sessions.toArray(),
        attendance: await db.attendance.toArray(),
        followups: await db.followups.toArray(),
        settings: await db.settings.toArray(),
      };

      const jsonStr = JSON.stringify(backupData, null, 2);
      let downloadBlob: Blob;
      let filename = `Student_Progress_Backup_${new Date().toISOString().split('T')[0]}`;

      if (encrypt && password) {
        const salt = crypto.getRandomValues(new Uint8Array(16));
        const iv = crypto.getRandomValues(new Uint8Array(12));
        const key = await deriveKey(password, salt);

        const enc = new TextEncoder();
        const encrypted = await crypto.subtle.encrypt(
          { name: 'AES-GCM', iv },
          key,
          enc.encode(jsonStr)
        );

        const packageObj = {
          encrypted: true,
          salt: Array.from(salt),
          iv: Array.from(iv),
          data: Array.from(new Uint8Array(encrypted)),
        };

        downloadBlob = new Blob([JSON.stringify(packageObj)], { type: 'application/json' });
        filename += '.encrypted.json';
      } else {
        downloadBlob = new Blob([jsonStr], { type: 'application/json' });
        filename += '.json';
      }

      const url = URL.createObjectURL(downloadBlob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);

      setStatusMsg({
        type: 'success',
        text: `Backup exported successfully (${filename})! Store it safely to preserve cohort data.`,
      });
    } catch (err) {
      setStatusMsg({
        type: 'error',
        text: err instanceof Error ? err.message : 'Export failed.',
      });
    } finally {
      setIsExporting(false);
    }
  };

  const handleImportBackup = async (file: File) => {
    setIsImporting(true);
    setStatusMsg(null);

    try {
      const text = await file.text();
      let rawJson: unknown = JSON.parse(text);

      if (
        typeof rawJson === 'object' &&
        rawJson !== null &&
        (rawJson as { encrypted?: boolean }).encrypted === true
      ) {
        if (!importPassword) {
          throw new Error('This backup file is encrypted with a password. Please enter the decryption password below.');
        }

        const encPkg = rawJson as { salt: number[]; iv: number[]; data: number[] };
        const salt = new Uint8Array(encPkg.salt);
        const iv = new Uint8Array(encPkg.iv);
        const data = new Uint8Array(encPkg.data);

        const key = await deriveKey(importPassword, salt);
        const decrypted = await crypto.subtle.decrypt(
          { name: 'AES-GCM', iv },
          key,
          data
        );

        const dec = new TextDecoder();
        rawJson = JSON.parse(dec.decode(decrypted));
      }

      const data = rawJson as any;
      if (!data.batches || !data.students) {
        throw new Error('Invalid backup file structure: missing batches or students tables.');
      }

      await db.transaction('rw', [
        db.batches,
        db.students,
        db.snapshots,
        db.studentSnapshots,
        db.assignmentResults,
        db.weeklyConsumption,
        db.sessions,
        db.attendance,
        db.followups,
        db.settings,
      ], async () => {
        if (data.batches) await db.batches.bulkPut(data.batches);
        if (data.students) await db.students.bulkPut(data.students);
        if (data.snapshots) await db.snapshots.bulkPut(data.snapshots);
        if (data.studentSnapshots) await db.studentSnapshots.bulkPut(data.studentSnapshots);
        if (data.assignmentResults) await db.assignmentResults.bulkPut(data.assignmentResults);
        if (data.weeklyConsumption) await db.weeklyConsumption.bulkPut(data.weeklyConsumption);
        if (data.sessions) await db.sessions.bulkPut(data.sessions);
        if (data.attendance) await db.attendance.bulkPut(data.attendance);
        if (data.followups) await db.followups.bulkPut(data.followups);
        if (data.settings) await db.settings.bulkPut(data.settings);
      });

      setStatusMsg({
        type: 'success',
        text: 'Backup restored successfully! All batch snapshots and student records are refreshed.',
      });
    } catch (err) {
      setStatusMsg({
        type: 'error',
        text: err instanceof Error ? err.message : 'Import failed.',
      });
    } finally {
      setIsImporting(false);
      if (importFileRef.current) importFileRef.current.value = '';
    }
  };

  // Upload academic sheet handler
  const handleAcademicUpload = async (file: File) => {
    if (!selectedBatchId) return;
    setIsUploadingAcademic(true);
    setFileActionError(null);
    setFileActionSuccess(null);

    try {
      const targetBatchId = await resolveBackendBatchId(selectedBatchId);
      const res = await apiClient.uploadAcademicWorkbook(targetBatchId, file, file.name);
      setFileActionSuccess(`Academic workbook (${file.name}) uploaded successfully as Version ${res.file.version}.`);
      await loadStoredFiles();
    } catch (err: unknown) {
      setFileActionError(err instanceof Error ? err.message : 'Failed to upload academic workbook.');
    } finally {
      setIsUploadingAcademic(false);
      if (academicFileInputRef.current) academicFileInputRef.current.value = '';
    }
  };

  // Download handler
  const handleDownload = async (file: StoredReportFile) => {
    try {
      await apiClient.downloadReportFile(file.id, file.originalName);
    } catch (err: unknown) {
      setFileActionError(`Download failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  };

  // Mark as current version handler
  const handleSetCurrent = async (file: StoredReportFile) => {
    if (!selectedBatchId) return;
    try {
      const targetBatchId = await resolveBackendBatchId(selectedBatchId);
      await apiClient.setCurrentAcademicVersion(targetBatchId, file.id);
      setFileActionSuccess(`Version ${file.version} is now marked as the Current academic sheet.`);
      await loadStoredFiles();
    } catch (err: unknown) {
      setFileActionError(`Failed to update current version: ${err instanceof Error ? err.message : String(err)}`);
    }
  };

  // Deletion confirmed handler
  const confirmDeleteFile = async () => {
    if (!fileToDelete) return;
    setIsDeleting(true);
    try {
      await apiClient.deleteReportFile(fileToDelete.id);
      setFileActionSuccess(`File ${fileToDelete.originalName} deleted permanently.`);
      setFileToDelete(null);
      await loadStoredFiles();
    } catch (err: any) {
      setFileActionError(`Deletion failed: ${err.message}`);
    } finally {
      setIsDeleting(false);
    }
  };

  const formatFileSize = (bytes: number): string => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
  };

  // Filter LMS files vs Academic files
  const lmsFiles = storedFiles.filter((f) => f.kind === 'lms_cumulative');
  const academicFiles = storedFiles
    .filter((f) => f.kind === 'academic')
    .sort((a, b) => b.version - a.version);

  const currentAcademicFile = academicFiles.find((f) => f.isCurrent) || academicFiles[0];
  const olderAcademicFiles = academicFiles.filter((f) => f.id !== currentAcademicFile?.id);

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

      {/* ==================================================================== */}
      {/* SECTION: STORED REPORTS (Neon Object Storage)                       */}
      {/* ==================================================================== */}
      <Card
        title="Stored reports"
        subtitle="Original LMS snapshot workbooks and Academic roadmap versions preserved in private cloud object storage."
      >
        <div className="space-y-5">
          {/* Batch Selector & Upload Action Bar */}
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 p-3.5 bg-slate-50/80 rounded-xl border border-slate-200/80">
            <div className="flex items-center gap-2.5">
              <div className="w-8 h-8 rounded-lg bg-[#0f766e]/10 text-[#0f766e] flex items-center justify-center">
                <Layers className="w-4 h-4" />
              </div>
              <div>
                <div className="text-xs font-semibold text-slate-800">
                  {selectedBatch ? selectedBatch.name : 'No Cohort Selected'}
                </div>
                <div className="text-[11px] text-slate-500 font-mono tabular-nums">
                  Batch Code: {selectedBatch?.externalBatchId || 'None'}
                </div>
              </div>
            </div>

            {selectedBatchId && (
              <div className="flex items-center gap-2">
                <input
                  ref={academicFileInputRef}
                  type="file"
                  accept=".xlsx"
                  className="hidden"
                  onChange={(e) => {
                    if (e.target.files?.[0]) {
                      handleAcademicUpload(e.target.files[0]);
                    }
                  }}
                />
                <Button
                  variant="outline"
                  size="sm"
                  onClick={loadStoredFiles}
                  disabled={isLoadingFiles}
                  className="h-8 text-xs text-slate-600 border-slate-200 hover:bg-slate-100"
                  title="Refresh files"
                >
                  <RefreshCw className={`w-3.5 h-3.5 ${isLoadingFiles ? 'animate-spin' : ''}`} />
                </Button>
                <Button
                  variant="primary"
                  size="sm"
                  disabled={isUploadingAcademic}
                  onClick={() => academicFileInputRef.current?.click()}
                  className="h-8 text-xs bg-[#0f766e] hover:bg-[#0d655e] text-white border-none gap-1.5"
                >
                  <Upload className="w-3.5 h-3.5" />
                  {isUploadingAcademic ? 'Verifying & Storing...' : 'Upload Academic Sheet'}
                </Button>
              </div>
            )}
          </div>

          {/* Action Alerts */}
          {fileActionError && (
            <div className="p-3 bg-rose-50 text-rose-800 border border-rose-200 rounded-xl text-xs flex items-center gap-2">
              <AlertCircle className="w-4 h-4 text-rose-600 shrink-0" />
              <span>{fileActionError}</span>
            </div>
          )}

          {fileActionSuccess && (
            <div className="p-3 bg-emerald-50 text-emerald-800 border border-emerald-200 rounded-xl text-xs flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
              <span>{fileActionSuccess}</span>
            </div>
          )}

          {/* Skeletons while loading */}
          {isLoadingFiles && (
            <div className="space-y-3">
              <div className="h-16 bg-slate-100 rounded-xl animate-pulse" />
              <div className="h-16 bg-slate-100 rounded-xl animate-pulse" />
            </div>
          )}

          {/* Stored Content */}
          {!isLoadingFiles && (
            <div className="space-y-6">
              {/* Part 1: Academic Sheets */}
              <div>
                <div className="flex items-center justify-between mb-2.5">
                  <span className="text-xs font-semibold text-slate-800 uppercase tracking-wider flex items-center gap-1.5">
                    <FileSpreadsheet className="w-3.5 h-3.5 text-[#0f766e]" />
                    Academic Workbooks (Roadmap & Score Card)
                  </span>
                  <span className="text-[11px] text-slate-500 font-mono tabular-nums">
                    {academicFiles.length} {academicFiles.length === 1 ? 'version' : 'versions'}
                  </span>
                </div>

                {academicFiles.length === 0 ? (
                  <div className="p-4 bg-slate-50/50 rounded-xl border border-dashed border-slate-200 text-center text-xs text-slate-500">
                    No academic sheet uploaded for this batch yet. Click "Upload Academic Sheet" to attach the curriculum roadmap and scorecard.
                  </div>
                ) : (
                  <div className="space-y-2">
                    {/* Current Academic Version */}
                    {currentAcademicFile && (
                      <div className="p-3 bg-white rounded-xl border border-slate-200/90 shadow-xs flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                        <div className="space-y-1">
                          <div className="flex items-center gap-2">
                            <span className="text-xs font-bold text-slate-900">
                              Version {currentAcademicFile.version}
                            </span>
                            <span className="px-2 py-0.5 text-[10px] font-semibold bg-[#0f766e]/10 text-[#0f766e] rounded-full flex items-center gap-1">
                              <Check className="w-3 h-3" /> Current
                            </span>
                            <span className="text-xs font-medium text-slate-700 truncate max-w-xs">
                              {currentAcademicFile.originalName}
                            </span>
                          </div>
                          <div className="flex flex-wrap items-center gap-3 text-[11px] text-slate-500 font-mono tabular-nums">
                            <span>{formatFileSize(currentAcademicFile.sizeBytes)}</span>
                            <span>•</span>
                            <span className="flex items-center gap-1">
                              <User className="w-3 h-3" />
                              {currentAcademicFile.uploaderName || currentAcademicFile.uploaderEmail || 'Trainer'}
                            </span>
                            <span>•</span>
                            <span className="flex items-center gap-1">
                              <Clock className="w-3 h-3" />
                              {new Date(currentAcademicFile.uploadedAt).toLocaleDateString()}
                            </span>
                            <span>•</span>
                            <span className="bg-slate-100 text-slate-600 px-1.5 py-0.5 rounded text-[10px]" title="SHA-256 Hash">
                              {currentAcademicFile.sha256.slice(0, 8)}
                            </span>
                          </div>
                        </div>

                        <div className="flex items-center gap-2 shrink-0">
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => handleDownload(currentAcademicFile)}
                            className="h-7 text-xs text-slate-700 border-slate-200 hover:bg-slate-50 gap-1"
                          >
                            <Download className="w-3 h-3 text-[#0f766e]" /> Download
                          </Button>
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => setFileToDelete(currentAcademicFile)}
                            className="h-7 text-xs text-rose-600 border-rose-200 hover:bg-rose-50"
                            title="Delete file"
                          >
                            <Trash2 className="w-3 h-3" />
                          </Button>
                        </div>
                      </div>
                    )}

                    {/* Older Versions Collapsible */}
                    {olderAcademicFiles.length > 0 && (
                      <div className="pt-1">
                        <button
                          type="button"
                          onClick={() => setShowOlderAcademic(!showOlderAcademic)}
                          className="text-xs text-slate-600 font-medium flex items-center gap-1 hover:text-[#0f766e] transition-colors py-1 cursor-pointer"
                        >
                          {showOlderAcademic ? (
                            <ChevronDown className="w-3.5 h-3.5" />
                          ) : (
                            <ChevronRight className="w-3.5 h-3.5" />
                          )}
                          <span>
                            {showOlderAcademic ? 'Collapse older versions' : `View ${olderAcademicFiles.length} older version${olderAcademicFiles.length > 1 ? 's' : ''}`}
                          </span>
                        </button>

                        {showOlderAcademic && (
                          <div className="space-y-2 mt-2 pl-3 border-l-2 border-slate-200">
                            {olderAcademicFiles.map((file) => (
                              <div
                                key={file.id}
                                className="p-2.5 bg-slate-50/70 rounded-lg border border-slate-200/70 flex flex-col sm:flex-row sm:items-center justify-between gap-2"
                              >
                                <div className="space-y-0.5">
                                  <div className="flex items-center gap-2">
                                    <span className="text-xs font-semibold text-slate-700">
                                      Version {file.version}
                                    </span>
                                    <span className="text-xs text-slate-600 truncate max-w-xs">
                                      {file.originalName}
                                    </span>
                                  </div>
                                  <div className="flex flex-wrap items-center gap-2.5 text-[10px] text-slate-500 font-mono tabular-nums">
                                    <span>{formatFileSize(file.sizeBytes)}</span>
                                    <span>•</span>
                                    <span>{new Date(file.uploadedAt).toLocaleDateString()}</span>
                                    <span>•</span>
                                    <span className="bg-slate-100 text-slate-600 px-1 py-0.5 rounded">
                                      {file.sha256.slice(0, 8)}
                                    </span>
                                  </div>
                                </div>

                                <div className="flex items-center gap-1.5 shrink-0">
                                  <button
                                    type="button"
                                    onClick={() => handleSetCurrent(file)}
                                    className="text-[11px] text-[#0f766e] font-medium hover:underline px-2 py-1 cursor-pointer"
                                  >
                                    Set as current
                                  </button>
                                  <Button
                                    variant="outline"
                                    size="sm"
                                    onClick={() => handleDownload(file)}
                                    className="h-6 text-[11px] text-slate-700 border-slate-200 px-2"
                                  >
                                    <Download className="w-3 h-3" />
                                  </Button>
                                  <Button
                                    variant="outline"
                                    size="sm"
                                    onClick={() => setFileToDelete(file)}
                                    className="h-6 text-[11px] text-rose-600 border-rose-200 px-2"
                                  >
                                    <Trash2 className="w-3 h-3" />
                                  </Button>
                                </div>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                )}
              </div>

              {/* Part 2: LMS Cumulative Reports */}
              <div>
                <div className="flex items-center justify-between mb-2.5">
                  <span className="text-xs font-semibold text-slate-800 uppercase tracking-wider flex items-center gap-1.5">
                    <Calendar className="w-3.5 h-3.5 text-[#0f766e]" />
                    LMS Cumulative Reports (By Snapshot Date)
                  </span>
                  <span className="text-[11px] text-slate-500 font-mono tabular-nums">
                    {lmsFiles.length} {lmsFiles.length === 1 ? 'report' : 'reports'}
                  </span>
                </div>

                {lmsFiles.length === 0 ? (
                  <div className="p-4 bg-slate-50/50 rounded-xl border border-dashed border-slate-200 text-center text-xs text-slate-500">
                    No LMS snapshots stored for this batch yet. Upload an LMS report via the main Upload button to create snapshots and preserve original files.
                  </div>
                ) : (
                  <div className="space-y-2">
                    {lmsFiles.map((file) => (
                      <div
                        key={file.id}
                        className="p-3 bg-white rounded-xl border border-slate-200/90 shadow-xs flex flex-col sm:flex-row sm:items-center justify-between gap-3"
                      >
                        <div className="space-y-1">
                          <div className="flex items-center gap-2">
                            <span className="text-xs font-semibold text-slate-900 flex items-center gap-1">
                              <Calendar className="w-3.5 h-3.5 text-[#0f766e]" />
                              {file.snapshotDate || new Date(file.uploadedAt).toISOString().split('T')[0]}
                            </span>
                            <span className="text-xs text-slate-600 truncate max-w-sm">
                              {file.originalName}
                            </span>
                          </div>
                          <div className="flex flex-wrap items-center gap-3 text-[11px] text-slate-500 font-mono tabular-nums">
                            <span>{formatFileSize(file.sizeBytes)}</span>
                            <span>•</span>
                            <span className="flex items-center gap-1">
                              <User className="w-3 h-3" />
                              {file.uploaderName || file.uploaderEmail || 'Trainer'}
                            </span>
                            <span>•</span>
                            <span className="flex items-center gap-1">
                              <Clock className="w-3 h-3" />
                              {new Date(file.uploadedAt).toLocaleDateString()}
                            </span>
                            <span>•</span>
                            <span className="bg-slate-100 text-slate-600 px-1.5 py-0.5 rounded text-[10px]" title="SHA-256 Hash">
                              {file.sha256.slice(0, 8)}
                            </span>
                          </div>
                        </div>

                        <div className="flex items-center gap-2 shrink-0">
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => handleDownload(file)}
                            className="h-7 text-xs text-slate-700 border-slate-200 hover:bg-slate-50 gap-1"
                          >
                            <Download className="w-3 h-3 text-[#0f766e]" /> Download
                          </Button>
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => setFileToDelete(file)}
                            className="h-7 text-xs text-rose-600 border-rose-200 hover:bg-rose-50"
                            title="Delete file"
                          >
                            <Trash2 className="w-3 h-3" />
                          </Button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </Card>

      {/* Delete Confirmation Modal */}
      {fileToDelete && (
        <div className="fixed inset-0 z-50 bg-slate-900/40 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-md w-full p-5 shadow-xl border border-slate-200 space-y-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-full bg-rose-100 text-rose-600 flex items-center justify-center shrink-0">
                <Trash2 className="w-5 h-5" />
              </div>
              <div>
                <h3 className="text-sm font-semibold text-slate-900">Confirm Permanent Deletion</h3>
                <p className="text-xs text-slate-500">This file will be permanently removed from cloud storage.</p>
              </div>
            </div>

            <div className="p-3 bg-slate-50 rounded-lg border border-slate-200 text-xs text-slate-700 space-y-1 font-mono tabular-nums">
              <div><strong>File:</strong> {fileToDelete.originalName}</div>
              <div><strong>Type:</strong> {fileToDelete.kind === 'academic' ? `Academic (v${fileToDelete.version})` : 'LMS Snapshot'}</div>
              <div><strong>Hash:</strong> {fileToDelete.sha256.slice(0, 16)}...</div>
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setFileToDelete(null)}
                disabled={isDeleting}
                className="text-xs"
              >
                Cancel
              </Button>
              <Button
                variant="primary"
                size="sm"
                onClick={confirmDeleteFile}
                disabled={isDeleting}
                className="text-xs bg-rose-600 hover:bg-rose-700 text-white border-none"
              >
                {isDeleting ? 'Deleting...' : 'Delete Permanently'}
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* ==================================================================== */}
      {/* SECTION: CLIENT-SIDE JSON BACKUP & RESTORE                          */}
      {/* ==================================================================== */}
      <Card
        title="Export Cohort Data (JSON Backup)"
        subtitle="All snapshots, student records, assignments, and follow-up notes can also be saved locally as an encrypted or plain JSON backup."
      >
        <div className="space-y-4">
          <div className="p-3.5 bg-slate-50 rounded-xl border border-slate-200 text-xs text-slate-600 flex items-start gap-2.5">
            <Shield className="w-4 h-4 text-[#0f766e] shrink-0 mt-0.5" />
            <p>
              Exporting a local JSON backup provides an offline archive of all parsed tables and learner profiles, allowing transfer across workstations without network access.
            </p>
          </div>

          <div className="flex items-center gap-2">
            <input
              type="checkbox"
              id="encryptBackup"
              checked={encrypt}
              onChange={(e) => setEncrypt(e.target.checked)}
              className="rounded text-[#0f766e] focus:ring-[#0f766e]"
            />
            <label htmlFor="encryptBackup" className="text-xs font-semibold text-slate-800 cursor-pointer">
              Protect backup with Web Crypto AES-GCM password encryption
            </label>
          </div>

          {encrypt && (
            <div className="max-w-sm">
              <label className="block text-xs font-semibold text-slate-600 mb-1 flex items-center gap-1">
                <Key className="w-3.5 h-3.5" /> Encryption Password
              </label>
              <input
                type="password"
                placeholder="Enter strong password..."
                className="w-full text-xs border border-slate-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-1 focus:ring-[#0f766e]"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </div>
          )}

          <div>
            <Button
              variant="primary"
              disabled={isExporting || (encrypt && !password)}
              onClick={handleExportBackup}
              className="gap-2 bg-[#0f766e] hover:bg-[#0d655e] text-white border-none"
            >
              <Download className="w-4 h-4" />
              {isExporting ? 'Packaging Backup...' : 'Download Full JSON Backup'}
            </Button>
          </div>
        </div>
      </Card>

      {/* Restore Card */}
      <Card
        title="Restore Data from Backup"
        subtitle="Import a previously saved JSON backup into this browser"
      >
        <div className="space-y-4">
          <div className="max-w-sm">
            <label className="block text-xs font-semibold text-slate-600 mb-1 flex items-center gap-1">
              <Key className="w-3.5 h-3.5" /> Decryption Password (if file was encrypted)
            </label>
            <input
              type="password"
              placeholder="Enter password (if applicable)..."
              className="w-full text-xs border border-slate-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-1 focus:ring-[#0f766e]"
              value={importPassword}
              onChange={(e) => setImportPassword(e.target.value)}
            />
          </div>

          <div>
            <input
              ref={importFileRef}
              type="file"
              accept=".json"
              className="hidden"
              onChange={(e) => {
                if (e.target.files?.[0]) {
                  handleImportBackup(e.target.files[0]);
                }
              }}
            />
            <Button
              variant="outline"
              disabled={isImporting}
              onClick={() => importFileRef.current?.click()}
              className="gap-2 text-slate-700 border-slate-300 hover:bg-slate-50"
            >
              <Upload className="w-4 h-4 text-slate-500" />
              {isImporting ? 'Restoring Data...' : 'Select JSON Backup File to Restore'}
            </Button>
          </div>
        </div>
      </Card>
    </div>
  );
};
