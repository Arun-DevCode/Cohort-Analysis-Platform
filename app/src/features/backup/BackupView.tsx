import React, { useState, useRef } from 'react';
import { Card } from '@/ui/Card';
import { Button } from '@/ui/Button';
import { db } from '@/core/db';
import { Download, Upload, Shield, CheckCircle2, AlertCircle, Key } from 'lucide-react';

export const BackupView: React.FC = () => {
  const [encrypt, setEncrypt] = useState(false);
  const [password, setPassword] = useState('');
  const [importPassword, setImportPassword] = useState('');
  const [isExporting, setIsExporting] = useState(false);
  const [isImporting, setIsImporting] = useState(false);
  const [statusMsg, setStatusMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  const importFileRef = useRef<HTMLInputElement>(null);

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
      // Collect all tables
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

      // Check if encrypted
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

      const backup = rawJson as {
        batches?: [];
        students?: [];
        snapshots?: [];
        studentSnapshots?: [];
        assignmentResults?: [];
        weeklyConsumption?: [];
        sessions?: [];
        attendance?: [];
        followups?: [];
        settings?: [];
      };

      if (!backup.batches || !backup.snapshots) {
        throw new Error('Invalid backup file structure: missing batches or snapshots.');
      }

      // Restore into Dexie
      await db.transaction(
        'rw',
        [
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
        ],
        async () => {
          if (backup.batches) await db.batches.bulkPut(backup.batches);
          if (backup.students) await db.students.bulkPut(backup.students);
          if (backup.snapshots) await db.snapshots.bulkPut(backup.snapshots);
          if (backup.studentSnapshots) await db.studentSnapshots.bulkPut(backup.studentSnapshots);
          if (backup.assignmentResults) await db.assignmentResults.bulkPut(backup.assignmentResults);
          if (backup.weeklyConsumption) await db.weeklyConsumption.bulkPut(backup.weeklyConsumption);
          if (backup.sessions) await db.sessions.bulkPut(backup.sessions);
          if (backup.attendance) await db.attendance.bulkPut(backup.attendance);
          if (backup.followups) await db.followups.bulkPut(backup.followups);
          if (backup.settings) await db.settings.bulkPut(backup.settings);
        }
      );

      setStatusMsg({
        type: 'success',
        text: 'Backup restored successfully! All batches, snapshots, and student histories are now active.',
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

  return (
    <div className="space-y-6 max-w-4xl mx-auto">
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

      {/* Export Card */}
      <Card
        title="Export Cohort Data (JSON Backup)"
        subtitle="All snapshots, student records, assignments, and follow-up notes are saved locally in your browser. Export to prevent data loss."
      >
        <div className="space-y-4">
          <div className="p-3.5 bg-slate-50 rounded-xl border border-slate-200 text-xs text-slate-600 flex items-start gap-2.5">
            <Shield className="w-4 h-4 text-indigo-600 shrink-0 mt-0.5" />
            <p>
              Because this platform has zero backend servers, your data is stored strictly in this browser's IndexedDB. Exporting a JSON backup allows transferring data across laptops or restoring after clearing browser cache.
            </p>
          </div>

          <div className="flex items-center gap-2">
            <input
              type="checkbox"
              id="encryptBackup"
              checked={encrypt}
              onChange={(e) => setEncrypt(e.target.checked)}
              className="rounded text-indigo-600 focus:ring-indigo-500"
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
                className="w-full text-xs border border-slate-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-1 focus:ring-indigo-500"
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
              className="gap-2"
            >
              <Download className="w-4 h-4" />
              {isExporting ? 'Packaging Backup...' : 'Download Full JSON Backup'}
            </Button>
          </div>
        </div>
      </Card>

      {/* Import Card */}
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
              className="w-full text-xs border border-slate-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-1 focus:ring-indigo-500"
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
              className="gap-2"
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
