import { describe, it, expect, beforeEach } from 'vitest';
import ExcelJS from 'exceljs';
import { createTestDatabase } from './testDb.js';
import { users, batches, snapshots, reportFiles } from '../db/schema/index.js';
import { AuthService } from '../services/auth.service.js';
import { ReportFileService, ValidationError, DuplicateFileError } from '../services/reportFile.service.js';
import { MemoryStorageAdapter, setStorageService, getStorageService } from '../services/storage/index.js';
import { reconcileStorage } from '../scripts/reconcileStorage.js';
import { eq, and } from 'drizzle-orm';

/**
 * Helper to build an in-memory valid Academic Workbook with ExcelJS
 */
async function buildMockAcademicWorkbook(options: {
  batchCode?: string;
  courseName?: string;
  extraContent?: string;
  omitSheets?: string[];
}): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  const sheetsToInclude = ['Core session | Tracker', 'Score Card | Core session', 'Course info'].filter(
    (s) => !options.omitSheets?.includes(s)
  );

  for (const sheetName of sheetsToInclude) {
    const ws = wb.addWorksheet(sheetName);
    if (sheetName === 'Course info') {
      ws.addRow(['Course Name', options.courseName || 'Agentic AI & Full Stack']);
      ws.addRow(['Course Code', options.batchCode || 'ANB49']);
      ws.addRow(['Coordinator', 'Coordinator Name']);
    } else if (sheetName === 'Score Card | Core session') {
      ws.addRow(['Learner Name', 'Email', 'Assignment 01', 'Total']);
      ws.addRow(['John Doe', 'john@example.test', 9, 9]);
    } else if (sheetName === 'Core session | Tracker') {
      ws.addRow(['Week', 'Day', 'Module', 'Topic', 'Date', 'Status']);
      ws.addRow([1, 1, 'Module 1', 'Intro to Web', '2026-10-01', 'Completed']);
    }

    if (options.extraContent) {
      ws.addRow(['Extra', options.extraContent]);
    }
  }

  const rawBuffer = await wb.xlsx.writeBuffer();
  return Buffer.from(rawBuffer);
}

describe('Stage 1: Report Files Storage & Versioning Tests', () => {
  let memoryStorage: MemoryStorageAdapter;
  let activeDb: any;

  let userAId: string;
  let userBId: string;
  let batchAId: string;
  let batchBId: string;

  beforeEach(async () => {
    // 1. In-memory storage for CI and isolated tests
    memoryStorage = new MemoryStorageAdapter();
    setStorageService(memoryStorage);

    // 2. Fresh isolated PGlite DB with all migrations applied
    activeDb = await createTestDatabase();
    const db = activeDb;
    const passwordHash = await AuthService.hashPassword('Pass@123456');

    // User A (Owner of Batch A)
    const [uA] = await db
      .insert(users)
      .values({ email: 'userA@platform.test', passwordHash, role: 'trainer', name: 'User A' })
      .returning();
    userAId = uA.id;

    // User B (Owner of Batch B)
    const [uB] = await db
      .insert(users)
      .values({ email: 'userB@platform.test', passwordHash, role: 'trainer', name: 'User B' })
      .returning();
    userBId = uB.id;

    // Batch A (code B49)
    const [bA] = await db
      .insert(batches)
      .values({
        name: 'Agentic FSD Batch 49',
        externalBatchId: 'B49',
        startDate: '2026-10-01',
        createdBy: userAId,
      })
      .returning();
    batchAId = bA.id;

    // Batch B (code B22)
    const [bB] = await db
      .insert(batches)
      .values({
        name: 'Data Analytics Batch 22',
        externalBatchId: 'B22',
        startDate: '2026-10-01',
        createdBy: userBId,
      })
      .returning();
    batchBId = bB.id;
  });

  describe('Storage Adapter & File Download Fidelity', () => {
    it('stores and downloads files byte-identically', async () => {
      const originalBuffer = Buffer.from('TEST_EXCEL_STREAM_BINARY_CONTENT_1234567890');
      const key = `${userAId}/${batchAId}/academic/v1-abcdef12.xlsx`;

      await memoryStorage.put(key, originalBuffer, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');

      const exists = await memoryStorage.exists(key);
      expect(exists).toBe(true);

      const downloaded = await memoryStorage.get(key);
      expect(downloaded.equals(originalBuffer)).toBe(true);
      expect(downloaded.toString('utf-8')).toBe('TEST_EXCEL_STREAM_BINARY_CONTENT_1234567890');
    });

    it('object key follows pattern: {ownerId}/{batchId}/{kind}/{reportDateOrVersion}-{sha256[:8]}.xlsx', () => {
      const sha256 = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';
      const key = ReportFileService.buildObjectKey({
        ownerId: userAId,
        batchId: batchAId,
        kind: 'academic',
        reportDateOrVersion: 2,
        sha256,
      });

      expect(key).toBe(`${userAId}/${batchAId}/academic/v2-e3b0c442.xlsx`);
    });
  });

  describe('Academic File Validation & Sheet Verification', () => {
    it('rejects files without valid zip (PK) signature', async () => {
      const invalidBuffer = Buffer.from('NOT_A_VALID_ZIP_FILE_AT_ALL');
      expect(ReportFileService.validateZipSignature(invalidBuffer)).toBe(false);

      await expect(
        ReportFileService.uploadAcademicFile({
          batchId: batchAId,
          ownerId: userAId,
          userId: userAId,
          buffer: invalidBuffer,
          fileName: 'Invalid.xlsx',
        })
      ).rejects.toThrow(/zip signature/i);
    });

    it('rejects files exceeding 10 MB', async () => {
      // 10 MB + 1 byte
      const largeBuffer = Buffer.alloc(10 * 1024 * 1024 + 1);
      largeBuffer[0] = 0x50;
      largeBuffer[1] = 0x4b;

      await expect(
        ReportFileService.uploadAcademicFile({
          batchId: batchAId,
          ownerId: userAId,
          userId: userAId,
          buffer: largeBuffer,
          fileName: 'LargeFile.xlsx',
        })
      ).rejects.toThrow(/10 MB/i);
    });

    it('rejects academic workbook when required sheets are missing', async () => {
      // Omit 'Score Card | Core session'
      const invalidWb = await buildMockAcademicWorkbook({
        batchCode: 'ANB49',
        omitSheets: ['Score Card | Core session'],
      });

      await expect(
        ReportFileService.uploadAcademicFile({
          batchId: batchAId,
          ownerId: userAId,
          userId: userAId,
          buffer: invalidWb,
          fileName: 'Agentic_FSD-ANB49___V1.xlsx',
        })
      ).rejects.toThrow(/missing required sheets/i);
    });

    it('rejects academic workbook when batch code does not match selected batch', async () => {
      // Workbook has code B99, but batch is B49
      const wrongBatchWb = await buildMockAcademicWorkbook({
        batchCode: 'ANB99',
      });

      await expect(
        ReportFileService.uploadAcademicFile({
          batchId: batchAId,
          ownerId: userAId,
          userId: userAId,
          buffer: wrongBatchWb,
          fileName: 'Agentic_FSD-ANB99___V1.xlsx',
        })
      ).rejects.toThrow(/batch code mismatch/i);
    });

    it('accepts valid academic sheet when batch code matches (e.g. ANB49 matches B49)', async () => {
      const validWb = await buildMockAcademicWorkbook({
        batchCode: 'ANB49',
        courseName: 'Agentic FSD',
      });

      const file = await ReportFileService.uploadAcademicFile({
        batchId: batchAId,
        ownerId: userAId,
        userId: userAId,
        buffer: validWb,
        fileName: 'Agentic_FSD-ANB49___V1.xlsx',
      });

      expect(file).toBeDefined();
      expect(file.version).toBe(1);
      expect(file.isCurrent).toBe(true);
      expect(file.kind).toBe('academic');

      // Verify file is stored in memoryStorage
      const stored = await memoryStorage.exists(file.objectKey);
      expect(stored).toBe(true);
    });
  });

  describe('Duplicate Detection & Versioning Flow', () => {
    it('rejects duplicate SHA-256 and returns existing file', async () => {
      const validWb = await buildMockAcademicWorkbook({ batchCode: 'ANB49' });

      // First upload
      const first = await ReportFileService.uploadAcademicFile({
        batchId: batchAId,
        ownerId: userAId,
        userId: userAId,
        buffer: validWb,
        fileName: 'Agentic_FSD-ANB49___V1.xlsx',
      });

      // Second upload with identical buffer
      try {
        await ReportFileService.uploadAcademicFile({
          batchId: batchAId,
          ownerId: userAId,
          userId: userAId,
          buffer: validWb,
          fileName: 'Agentic_FSD-ANB49___V1_Copy.xlsx',
        });
        expect.fail('Should have thrown DuplicateFileError');
      } catch (err: any) {
        expect(err).toBeInstanceOf(DuplicateFileError);
        expect(err.existingFile.id).toBe(first.id);
        expect(err.existingFile.sha256).toBe(first.sha256);
      }
    });

    it('increments version on new file upload and sets is_current correctly', async () => {
      const v1Buffer = await buildMockAcademicWorkbook({ batchCode: 'ANB49', extraContent: 'V1 Content' });
      const v2Buffer = await buildMockAcademicWorkbook({ batchCode: 'ANB49', extraContent: 'V2 Updated Content' });

      const file1 = await ReportFileService.uploadAcademicFile({
        batchId: batchAId,
        ownerId: userAId,
        userId: userAId,
        buffer: v1Buffer,
        fileName: 'Agentic_FSD-ANB49___V1.xlsx',
      });

      expect(file1.version).toBe(1);
      expect(file1.isCurrent).toBe(true);

      const file2 = await ReportFileService.uploadAcademicFile({
        batchId: batchAId,
        ownerId: userAId,
        userId: userAId,
        buffer: v2Buffer,
        fileName: 'Agentic_FSD-ANB49___V2.xlsx',
      });

      expect(file2.version).toBe(2);
      expect(file2.isCurrent).toBe(true);

      // Verify file1 is now is_current = false
      const db = activeDb;
      const refetchedFile1 = await db.query.reportFiles.findFirst({
        where: eq(reportFiles.id, file1.id),
      });
      expect(refetchedFile1.isCurrent).toBe(false);

      // Set version 1 back as current
      const reverted = await ReportFileService.setCurrentVersion(batchAId, file1.id);
      expect(reverted.isCurrent).toBe(true);

      const refetchedFile2 = await db.query.reportFiles.findFirst({
        where: eq(reportFiles.id, file2.id),
      });
      expect(refetchedFile2.isCurrent).toBe(false);
    });
  });

  describe('Failure Injection & Transaction Rollback', () => {
    it('storage put failure prevents row from being inserted in DB', async () => {
      const mockWb = await buildMockAcademicWorkbook({ batchCode: 'ANB49' });

      // Mock storage.put to fail
      const failingStorage = new MemoryStorageAdapter();
      failingStorage.put = async () => {
        throw new Error('Neon S3 Connection Timeout');
      };
      setStorageService(failingStorage);

      await expect(
        ReportFileService.uploadAcademicFile({
          batchId: batchAId,
          ownerId: userAId,
          userId: userAId,
          buffer: mockWb,
          fileName: 'FailingPut.xlsx',
        })
      ).rejects.toThrow(/Connection Timeout/i);

      // Verify no row was inserted
      const db = activeDb;
      const rows = await db.select().from(reportFiles);
      expect(rows.length).toBe(0);
    });

    it('row insert failure removes object from storage', async () => {
      const mockWb = await buildMockAcademicWorkbook({ batchCode: 'ANB49' });
      const storage = new MemoryStorageAdapter();
      setStorageService(storage);

      // Pass a non-existent batchId to cause foreign key insert failure
      await expect(
        ReportFileService.uploadAcademicFile({
          batchId: '00000000-0000-0000-0000-000000000000',
          ownerId: userAId,
          userId: userAId,
          buffer: mockWb,
          fileName: 'NonExistentBatch.xlsx',
        })
      ).rejects.toThrow();

      // Verify storage was cleaned up
      expect(storage.size()).toBe(0);
    });
  });

  describe('LMS Snapshot File Integration & Deletion Cascade', () => {
    it('saves LMS report file linked to snapshot and cleans up on snapshot delete', async () => {
      const db = activeDb;
      const lmsBuffer = Buffer.from('LMS_MOCK_EXCEL_CONTENT_SNAPSHOT_1');

      // Create snapshot
      const [snap] = await db
        .insert(snapshots)
        .values({
          batchId: batchAId,
          snapshotDate: '2026-10-30',
        })
        .returning();

      // Save LMS file
      const reportFile = await ReportFileService.saveLmsReportFile({
        batchId: batchAId,
        snapshotId: snap.id,
        ownerId: userAId,
        userId: userAId,
        buffer: lmsBuffer,
        fileName: 'AFSD_2026-10-30.xlsx',
        snapshotDate: '2026-10-30',
      });

      expect(reportFile.kind).toBe('lms_cumulative');
      expect(reportFile.snapshotId).toBe(snap.id);
      expect(await memoryStorage.exists(reportFile.objectKey)).toBe(true);

      // Delete snapshot: removes associated file and storage object
      const linkedFiles = await db.query.reportFiles.findMany({
        where: eq(reportFiles.snapshotId, snap.id),
      });
      for (const f of linkedFiles) {
        await ReportFileService.deleteFile(f.id);
      }
      await db.delete(snapshots).where(eq(snapshots.id, snap.id));

      expect(await memoryStorage.exists(reportFile.objectKey)).toBe(false);
      const remainingRow = await db.query.reportFiles.findFirst({
        where: eq(reportFiles.id, reportFile.id),
      });
      expect(remainingRow).toBeUndefined();
    });

    it('batch with stored files cannot be deleted due to RESTRICT constraint', async () => {
      const validWb = await buildMockAcademicWorkbook({ batchCode: 'ANB49' });
      await ReportFileService.uploadAcademicFile({
        batchId: batchAId,
        ownerId: userAId,
        userId: userAId,
        buffer: validWb,
        fileName: 'BatchRestricted.xlsx',
      });

      const db = activeDb;
      // Attempting to delete batchA directly must throw foreign key violation
      await expect(db.delete(batches).where(eq(batches.id, batchAId))).rejects.toThrow();
    });
  });

  describe('Storage Reconciliation Script', () => {
    it('finds missing storage objects and orphaned storage files accurately', async () => {
      const validWb = await buildMockAcademicWorkbook({ batchCode: 'ANB49' });
      const record = await ReportFileService.uploadAcademicFile({
        batchId: batchAId,
        ownerId: userAId,
        userId: userAId,
        buffer: validWb,
        fileName: 'ReconcileTest.xlsx',
      });

      // Perfect match state
      let report = await reconcileStorage();
      expect(report.rowsWithoutObjects.length).toBe(0);
      expect(report.objectsWithoutRows.length).toBe(0);

      // Case 1: Orphaned storage object (object exists without DB row)
      const orphanKey = 'orphan/test/file.xlsx';
      await memoryStorage.put(orphanKey, Buffer.from('ORPHAN'));

      report = await reconcileStorage();
      expect(report.objectsWithoutRows).toContain(orphanKey);

      // Case 2: Missing storage object (DB row exists without storage object)
      await memoryStorage.delete(record.objectKey);

      report = await reconcileStorage();
      expect(report.rowsWithoutObjects.some((r) => r.id === record.id)).toBe(true);
    });
  });
});

