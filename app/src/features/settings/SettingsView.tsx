import React, { useState } from 'react';
import { Card } from '@/ui/Card';
import { Button } from '@/ui/Button';
import { Modal } from '@/ui/Modal';
import { usePlatformStore } from '@/store/usePlatformStore';
import { db } from '@/core/db';
import { Sliders, EyeOff, Trash2, CheckCircle2 } from 'lucide-react';

export const SettingsView: React.FC = () => {
  const { settings, updateSettings, setSelectedBatchId, setSelectedSnapshotId } =
    usePlatformStore();

  const [high, setHigh] = useState(settings.highThreshold);
  const [medium, setMedium] = useState(settings.mediumThreshold);
  const [deltaTolerance, setDeltaTolerance] = useState(settings.deltaTolerance);
  const [isSaved, setIsSaved] = useState(false);

  const [isConfirmClearOpen, setIsConfirmClearOpen] = useState(false);
  const [isClearing, setIsClearing] = useState(false);

  const handleSaveThresholds = async (e: React.FormEvent) => {
    e.preventDefault();
    await updateSettings({
      highThreshold: Number(high),
      mediumThreshold: Number(medium),
      deltaTolerance: Number(deltaTolerance),
    });
    setIsSaved(true);
    setTimeout(() => setIsSaved(false), 3000);
  };

  const handleClearAllData = async () => {
    setIsClearing(true);
    try {
      await db.delete();
      await db.open();
      setSelectedBatchId(null);
      setSelectedSnapshotId(null);
      window.location.reload();
    } finally {
      setIsClearing(false);
    }
  };

  return (
    <div className="space-y-6 max-w-3xl mx-auto">
      {/* Thresholds Form */}
      <Card
        title="Segmentation & Movement Thresholds"
        subtitle="Batch metrics and student segments recompute dynamically based on these settings"
      >
        <form onSubmit={handleSaveThresholds} className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                High Segment Cutoff (≥ %)
              </label>
              <input
                type="number"
                min="1"
                max="100"
                className="w-full text-xs border border-slate-300 rounded-lg px-3 py-2 focus:ring-1 focus:ring-indigo-500 focus:outline-none"
                value={high}
                onChange={(e) => setHigh(Number(e.target.value))}
              />
              <span className="text-[10px] text-slate-400 mt-1 block">Default: 80%</span>
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                Medium Segment Cutoff (≥ %)
              </label>
              <input
                type="number"
                min="1"
                max="99"
                className="w-full text-xs border border-slate-300 rounded-lg px-3 py-2 focus:ring-1 focus:ring-indigo-500 focus:outline-none"
                value={medium}
                onChange={(e) => setMedium(Number(e.target.value))}
              />
              <span className="text-[10px] text-slate-400 mt-1 block">Default: 50%</span>
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                Delta Movement Tolerance (pts)
              </label>
              <input
                type="number"
                step="0.5"
                min="0.1"
                max="20"
                className="w-full text-xs border border-slate-300 rounded-lg px-3 py-2 focus:ring-1 focus:ring-indigo-500 focus:outline-none"
                value={deltaTolerance}
                onChange={(e) => setDeltaTolerance(Number(e.target.value))}
              />
              <span className="text-[10px] text-slate-400 mt-1 block">Default: 2 percentage points</span>
            </div>
          </div>

          <div className="flex items-center justify-between pt-3 border-t border-slate-100">
            <span className="text-xs text-slate-500 flex items-center gap-1">
              <Sliders className="w-3.5 h-3.5" /> Changes apply immediately to all dashboard views
            </span>
            <Button size="sm" type="submit" variant="primary">
              Save Thresholds
            </Button>
          </div>

          {isSaved && (
            <div className="p-3 bg-emerald-50 text-emerald-800 rounded-lg text-xs flex items-center gap-1.5 border border-emerald-200">
              <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
              Settings updated successfully!
            </div>
          )}
        </form>
      </Card>

      {/* Privacy and PII Masking */}
      <Card
        title="Privacy & Presentation Mode"
        subtitle="Protect student personally identifiable information (PII) during screen shares"
      >
        <div className="flex items-center justify-between p-3.5 bg-slate-50 rounded-xl border border-slate-200">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-indigo-100 text-indigo-700 rounded-lg">
              <EyeOff className="w-4 h-4" />
            </div>
            <div>
              <p className="text-xs font-semibold text-slate-900">Mask Student Names & Phone Numbers</p>
              <p className="text-[11px] text-slate-500">
                Anonymizes all student names (e.g. "G***** R**") and phone numbers across charts, tables, and lists.
              </p>
            </div>
          </div>

          <label className="relative inline-flex items-center cursor-pointer">
            <input
              type="checkbox"
              checked={settings.maskPii}
              onChange={(e) => updateSettings({ maskPii: e.target.checked })}
              className="sr-only peer"
            />
            <div className="w-9 h-5 bg-slate-300 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-indigo-600"></div>
          </label>
        </div>
      </Card>

      {/* Danger Zone */}
      <Card
        title="Data Management (Danger Zone)"
        subtitle="Permanently erase all local cohorts, snapshots, and student logs from this browser"
        className="border-rose-200"
      >
        <div className="flex items-center justify-between">
          <div>
            <p className="text-xs font-semibold text-rose-900">Wipe All Local Storage</p>
            <p className="text-[11px] text-slate-500">
              Deletes the entire IndexedDB database including all batches, snapshots, and notes. This action cannot be undone.
            </p>
          </div>
          <Button
            size="sm"
            variant="danger"
            onClick={() => setIsConfirmClearOpen(true)}
            className="gap-1.5 shrink-0"
          >
            <Trash2 className="w-4 h-4" /> Clear All Data
          </Button>
        </div>
      </Card>

      {/* Confirmation Modal */}
      <Modal
        isOpen={isConfirmClearOpen}
        onClose={() => setIsConfirmClearOpen(false)}
        title="Are you absolutely sure?"
        description="This will wipe all student snapshots, batches, and notes stored in this browser."
        maxWidth="sm"
      >
        <div className="space-y-4">
          <p className="text-xs text-rose-700 bg-rose-50 p-3 rounded-lg border border-rose-200">
            Warning: All data lives strictly in your browser. Unless you exported a JSON backup, this data cannot be recovered.
          </p>

          <div className="flex items-center justify-end gap-2 pt-2">
            <Button size="sm" variant="outline" onClick={() => setIsConfirmClearOpen(false)}>
              Cancel
            </Button>
            <Button
              size="sm"
              variant="danger"
              disabled={isClearing}
              onClick={handleClearAllData}
            >
              {isClearing ? 'Clearing...' : 'Yes, Delete All Data'}
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
};
