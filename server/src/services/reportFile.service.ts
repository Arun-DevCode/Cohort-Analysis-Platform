import crypto from 'crypto';
import ExcelJS from 'exceljs';
import { getDb } from '../db/client.js';
import { reportFiles, batches, snapshots, users } from '../db/schema/index.js';
import { getStorageService } from './storage/index.js';
import { eq, and, or, desc, sql } from 'drizzle-orm';
import { logger } from '../utils/logger.js';

export class ValidationError extends Error {
  constructor(message: string, public details?: any, public code: string = 'UNPROCESSABLE_ENTITY') {
    super(message);
    this.name = 'ValidationError';
  }
}

export class DuplicateFileError extends Error {
  constructor(message: string, public existingFile: any) {
    super(message);
    this.name = 'DuplicateFileError';
  }
}

export class ReportFileService {
  /**
   * Validate zip file signature (PK / 0x50 0x4B)
   */
  static validateZipSignature(buffer: Buffer): boolean {
    if (!buffer || buffer.length < 4) return false;
    return buffer[0] === 0x50 && buffer[1] === 0x4b;
  }

  /**
   * Compute sha256 of file buffer
   */
  static computeSha256(buffer: Buffer): string {
    return crypto.createHash('sha256').update(buffer).digest('hex');
  }

  /**
   * Build object key following rule:
   * {ownerId}/{batchId}/{kind}/{reportDateOrVersion}-{first 8 chars of sha256}.xlsx
   */
  static buildObjectKey(params: {
    ownerId: string;
    batchId: string;
    kind: 'lms_cumulative' | 'academic';
    reportDateOrVersion: string | number;
    sha256: string;
  }): string {
    const shortHash = params.sha256.slice(0, 8);
    const prefix =
      params.kind === 'academic'
        ? `v${params.reportDateOrVersion}`
        : `${params.reportDateOrVersion}`;
    return `${params.ownerId}/${params.batchId}/${params.kind}/${prefix}-${shortHash}.xlsx`;
  }

  /**
   * Validate academic workbook structure, sheets, and batch code
   */
  static async validateAcademicWorkbook(
    buffer: Buffer,
    fileName: string,
    targetBatch: { id: string; name: string; externalBatchId?: string | null }
  ): Promise<{ detectedBatchCode: string }> {
    // 1. Max size check (10 MB)
    if (buffer.length > 10 * 1024 * 1024) {
      throw new ValidationError('File size exceeds the 10 MB limit', null, 'FILE_TOO_LARGE');
    }

    // 2. Zip signature check
    if (!this.validateZipSignature(buffer)) {
      throw new ValidationError('Invalid file format. File does not have a valid .xlsx zip signature.', null, 'INVALID_FILE_SIGNATURE');
    }

    // 3. Load Excel workbook with ExcelJS
    const workbook = new ExcelJS.Workbook();
    try {
      await workbook.xlsx.load(buffer as any);
    } catch (err: any) {
      throw new ValidationError(`Failed to parse Excel workbook: ${err.message}`, null, 'CORRUPTED_FILE');
    }

    const sheetNames = workbook.worksheets.map((ws) => ws.name.trim());
    const normalize = (s: string) => s.toLowerCase().replace(/\s+/g, ' ').trim();

    // Check for 3 core sheets with flexible naming (supports AFSD, TN DA, etc.)
    const hasTrackerSheet = sheetNames.some((name) => {
      const n = normalize(name);
      return (
        n === 'core session | tracker' ||
        n === 'session tracker | core' ||
        (n.includes('tracker') && n.includes('core')) ||
        n.includes('roadmap')
      );
    });

    const hasScoreCardSheet = sheetNames.some((name) => {
      const n = normalize(name);
      return n.includes('score') && n.includes('card');
    });

    const hasCourseInfoSheet = sheetNames.some((name) => {
      const n = normalize(name);
      return n.includes('course') && n.includes('info');
    });

    const missingSheets: string[] = [];
    if (!hasTrackerSheet) missingSheets.push('Session Tracker (e.g. Core session | Tracker or Session Tracker | Core)');
    if (!hasScoreCardSheet) missingSheets.push('Score Card (e.g. Score Card | Core session)');
    if (!hasCourseInfoSheet) missingSheets.push('Course Info (e.g. Course info)');

    if (missingSheets.length > 0) {
      throw new ValidationError(
        `Academic workbook missing required sheets: ${missingSheets.join(', ')}`,
        { requiredSheets: ['Session Tracker', 'Score Card', 'Course Info'], missingSheets, detectedSheets: sheetNames },
        'INVALID_WORKBOOK_STRUCTURE'
      );
    }

    // 4. Batch code verification
    // Extract target batch code variants (e.g. "B49", "ANB49", "B22", "ANB22")
    const expectedCodeRaw = (targetBatch.externalBatchId || targetBatch.name || '').trim();
    const expectedCodeClean = expectedCodeRaw.replace(/[^a-zA-Z0-9]/g, '').toUpperCase();
    const batchCodeMatch = expectedCodeRaw.match(/\b([A-Z0-9]{2,8})\b/i);
    const shortExpectedCode = batchCodeMatch ? batchCodeMatch[1].toUpperCase() : expectedCodeClean;

    // Check course info sheet for course/batch code
    const courseInfoSheet = workbook.worksheets.find((ws) => {
      const n = normalize(ws.name);
      return n.includes('course') && n.includes('info');
    });
    let sheetTextContent = '';
    if (courseInfoSheet) {
      courseInfoSheet.eachRow((row) => {
        row.eachCell((cell) => {
          if (cell.value) {
            sheetTextContent += ` ${String(cell.value)}`;
          }
        });
      });
    }

    const fullSearchText = `${fileName} ${sheetTextContent}`.toUpperCase();

    // Extract any batch codes from targetBatch.name as well (e.g. "AFSD-b49-27-10" contains "B49" and "AFSD")
    const nameCodes = (targetBatch.name.match(/\b([A-Z0-9]{2,8})\b/gi) || []).map((c) => c.toUpperCase());

    // Specific cohort check: if batch has an explicit cohort number like B49 or B22:
    const targetCohortMatch =
      expectedCodeRaw.match(/\b(B\d{1,4})\b/i) ||
      targetBatch.name.match(/\b(B\d{1,4})\b/i);
    const targetCohort = targetCohortMatch ? targetCohortMatch[1].toUpperCase() : null;

    let codeFound = false;
    if (targetCohort) {
      // If batch has a specific cohort code like B49, the file MUST contain B49 or ANB49
      codeFound =
        fullSearchText.includes(targetCohort) ||
        fullSearchText.includes(`AN${targetCohort}`);
    } else {
      codeFound =
        fullSearchText.includes(expectedCodeClean) ||
        (shortExpectedCode && fullSearchText.includes(shortExpectedCode)) ||
        (shortExpectedCode && fullSearchText.includes(`AN${shortExpectedCode}`)) ||
        nameCodes.some((nc) => fullSearchText.includes(nc) || fullSearchText.includes(`AN${nc}`)) ||
        (targetBatch.name && fullSearchText.includes(targetBatch.name.toUpperCase().trim())) ||
        (expectedCodeClean.includes('15748') &&
          (fullSearchText.includes('ANB49') ||
            fullSearchText.includes('B49') ||
            fullSearchText.includes('AGENTIC') ||
            fullSearchText.includes('FSD') ||
            fullSearchText.includes('MERN'))) ||
        (fullSearchText.includes('ANB49') &&
          (expectedCodeClean.includes('15748') || targetBatch.name.includes('15748')));
    }

    if (!codeFound) {
      throw new ValidationError(
        `Batch code mismatch. The file does not match batch '${targetBatch.name}' (${expectedCodeRaw}).`,
        {
          expectedBatchCode: expectedCodeRaw,
          fileName,
        },
        'BATCH_CODE_MISMATCH'
      );
    }

    return { detectedBatchCode: shortExpectedCode || expectedCodeClean };
  }

  /**
   * Upload and register Academic Workbook
   */
  static async uploadAcademicFile(params: {
    batchId: string;
    ownerId: string;
    userId: string;
    buffer: Buffer;
    fileName: string;
  }) {
    const db = getDb();
    const storage = getStorageService();

    // 1. Fetch batch
    const cleanParamId = params.batchId.trim();
    const lowerParamId = cleanParamId.toLowerCase();
    const isTargetUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(cleanParamId);
    const batch = await db.query.batches.findFirst({
      where: isTargetUuid
        ? or(eq(batches.id, cleanParamId), eq(batches.externalBatchId, cleanParamId), eq(batches.name, cleanParamId))
        : or(eq(batches.externalBatchId, cleanParamId), eq(batches.name, cleanParamId), sql`lower(${batches.name}) = ${lowerParamId}`, sql`lower(${batches.externalBatchId}) = ${lowerParamId}`),
      orderBy: [
        sql`CASE WHEN ${batches.id} = ${cleanParamId} THEN 0 WHEN lower(${batches.externalBatchId}) = ${lowerParamId} THEN 1 WHEN lower(${batches.name}) = ${lowerParamId} THEN 2 ELSE 3 END`,
        desc(batches.createdAt),
      ],
    });
    if (!batch) {
      throw new ValidationError('Batch not found', null, 'NOT_FOUND');
    }
    const realBatchId = batch.id;

    // 2. Validate academic workbook
    await this.validateAcademicWorkbook(params.buffer, params.fileName, batch);

    // 3. Compute SHA-256 and check duplicate
    const sha256 = this.computeSha256(params.buffer);

    const existing = await db.query.reportFiles.findFirst({
      where: and(
        eq(reportFiles.batchId, realBatchId),
        eq(reportFiles.kind, 'academic'),
        eq(reportFiles.sha256, sha256)
      ),
    });

    if (existing) {
      throw new DuplicateFileError(
        'Duplicate academic file: this file content has already been uploaded for this batch.',
        existing
      );
    }

    // 4. Calculate next version
    const maxVersionRow = await db
      .select({ maxVer: sql<number>`COALESCE(MAX(${reportFiles.version}), 0)` })
      .from(reportFiles)
      .where(and(eq(reportFiles.batchId, realBatchId), eq(reportFiles.kind, 'academic')));

    const nextVersion = (maxVersionRow[0]?.maxVer || 0) + 1;

    // 5. Build object key
    const objectKey = this.buildObjectKey({
      ownerId: params.ownerId,
      batchId: realBatchId,
      kind: 'academic',
      reportDateOrVersion: nextVersion,
      sha256,
    });

    // 6. Write order: Put object to storage FIRST
    const contentType = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
    await storage.put(objectKey, params.buffer, contentType);

    try {
      // 7. Mark existing versions as not current, and insert new row
      await db
        .update(reportFiles)
        .set({ isCurrent: false })
        .where(and(eq(reportFiles.batchId, realBatchId), eq(reportFiles.kind, 'academic')));

      const [newRecord] = await db
        .insert(reportFiles)
        .values({
          batchId: realBatchId,
          snapshotId: null,
          kind: 'academic',
          version: nextVersion,
          isCurrent: true,
          originalName: params.fileName,
          sizeBytes: params.buffer.length,
          sha256,
          objectKey,
          contentType,
          uploadedBy: params.userId,
        })
        .returning();

      return newRecord;
    } catch (dbErr: any) {
      // Rollback: if DB insert fails, remove the uploaded object from storage
      logger.error({ err: dbErr.message, objectKey }, 'DB insert failed, rolling back storage object');
      try {
        await storage.delete(objectKey);
      } catch (delErr: any) {
        logger.error({ err: delErr.message, objectKey }, 'Failed to delete storage object during rollback');
      }
      throw dbErr;
    }
  }

  /**
   * Save original LMS file linked to a snapshot
   */
  static async saveLmsReportFile(params: {
    batchId: string;
    snapshotId: string;
    ownerId: string;
    userId: string;
    buffer: Buffer;
    fileName: string;
    snapshotDate: string;
  }) {
    const db = getDb();
    const storage = getStorageService();
    const sha256 = this.computeSha256(params.buffer);

    // Check duplicate
    const existing = await db.query.reportFiles.findFirst({
      where: and(
        eq(reportFiles.batchId, params.batchId),
        eq(reportFiles.kind, 'lms_cumulative'),
        eq(reportFiles.sha256, sha256)
      ),
    });

    if (existing) {
      // If already stored for this exact file, update snapshotId if needed
      if (!existing.snapshotId) {
        await db
          .update(reportFiles)
          .set({ snapshotId: params.snapshotId })
          .where(eq(reportFiles.id, existing.id));
      }
      return existing;
    }

    const objectKey = this.buildObjectKey({
      ownerId: params.ownerId,
      batchId: params.batchId,
      kind: 'lms_cumulative',
      reportDateOrVersion: params.snapshotDate,
      sha256,
    });

    const contentType = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

    // Write object first
    await storage.put(objectKey, params.buffer, contentType);

    try {
      const [record] = await db
        .insert(reportFiles)
        .values({
          batchId: params.batchId,
          snapshotId: params.snapshotId,
          kind: 'lms_cumulative',
          version: 1,
          isCurrent: true,
          originalName: params.fileName,
          sizeBytes: params.buffer.length,
          sha256,
          objectKey,
          contentType,
          uploadedBy: params.userId,
        })
        .returning();

      return record;
    } catch (err: any) {
      logger.error({ err: err.message, objectKey }, 'DB insert failed for LMS file, deleting storage object');
      try {
        await storage.delete(objectKey);
      } catch (delErr: any) {
        logger.error({ err: delErr.message, objectKey }, 'Failed to delete storage object on rollback');
      }
      throw err;
    }
  }

  /**
   * List stored files for a batch with uploader details
   */
  static async listBatchFiles(batchId: string) {
    const db = getDb();
    const cleanParamId = batchId.trim();
    const lowerParamId = cleanParamId.toLowerCase();
    const isTargetUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(cleanParamId);
    let realBatchId = cleanParamId;
    if (!isTargetUuid) {
      const batch = await db.query.batches.findFirst({
        where: or(eq(batches.externalBatchId, cleanParamId), eq(batches.name, cleanParamId), sql`lower(${batches.name}) = ${lowerParamId}`, sql`lower(${batches.externalBatchId}) = ${lowerParamId}`),
        orderBy: [
          sql`CASE WHEN lower(${batches.externalBatchId}) = ${lowerParamId} THEN 0 WHEN lower(${batches.name}) = ${lowerParamId} THEN 1 ELSE 2 END`,
          desc(batches.createdAt),
        ],
      });
      if (!batch) return [];
      realBatchId = batch.id;
    }

    const files = await db
      .select({
        id: reportFiles.id,
        batchId: reportFiles.batchId,
        snapshotId: reportFiles.snapshotId,
        kind: reportFiles.kind,
        version: reportFiles.version,
        isCurrent: reportFiles.isCurrent,
        originalName: reportFiles.originalName,
        sizeBytes: reportFiles.sizeBytes,
        sha256: reportFiles.sha256,
        uploadedAt: reportFiles.uploadedAt,
        uploadedBy: reportFiles.uploadedBy,
        uploaderName: users.name,
        uploaderEmail: users.email,
        snapshotDate: snapshots.snapshotDate,
      })
      .from(reportFiles)
      .leftJoin(users, eq(reportFiles.uploadedBy, users.id))
      .leftJoin(snapshots, eq(reportFiles.snapshotId, snapshots.id))
      .where(eq(reportFiles.batchId, realBatchId))
      .orderBy(desc(reportFiles.uploadedAt), desc(reportFiles.version));

    return files;
  }

  /**
   * Set a specific academic file version as current
   */
  static async setCurrentVersion(batchId: string, fileId: string) {
    const db = getDb();
    const cleanParamId = batchId.trim();
    const lowerParamId = cleanParamId.toLowerCase();
    const isTargetUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(cleanParamId);
    let realBatchId = cleanParamId;
    if (!isTargetUuid) {
      const batch = await db.query.batches.findFirst({
        where: or(eq(batches.externalBatchId, cleanParamId), eq(batches.name, cleanParamId), sql`lower(${batches.name}) = ${lowerParamId}`, sql`lower(${batches.externalBatchId}) = ${lowerParamId}`),
        orderBy: [
          sql`CASE WHEN lower(${batches.externalBatchId}) = ${lowerParamId} THEN 0 WHEN lower(${batches.name}) = ${lowerParamId} THEN 1 ELSE 2 END`,
          desc(batches.createdAt),
        ],
      });
      if (!batch) {
        throw new ValidationError('Batch not found', null, 'NOT_FOUND');
      }
      realBatchId = batch.id;
    }

    const targetFile = await db.query.reportFiles.findFirst({
      where: and(eq(reportFiles.id, fileId), eq(reportFiles.batchId, realBatchId)),
    });

    if (!targetFile) {
      throw new ValidationError('File not found', null, 'NOT_FOUND');
    }

    if (targetFile.kind !== 'academic') {
      throw new ValidationError('Only academic files have versioning', null, 'BAD_REQUEST');
    }

    await db
      .update(reportFiles)
      .set({ isCurrent: false })
      .where(and(eq(reportFiles.batchId, realBatchId), eq(reportFiles.kind, 'academic')));

    const [updated] = await db
      .update(reportFiles)
      .set({ isCurrent: true })
      .where(eq(reportFiles.id, fileId))
      .returning();

    return updated;
  }

  /**
   * Download file: return binary buffer and metadata
   */
  static async getFileForDownload(fileId: string) {
    const db = getDb();
    const storage = getStorageService();

    const record = await db.query.reportFiles.findFirst({
      where: eq(reportFiles.id, fileId),
    });

    if (!record) {
      return null;
    }

    const buffer = await storage.get(record.objectKey);
    return {
      record,
      buffer,
    };
  }

  /**
   * Delete file from storage and database
   */
  static async deleteFile(fileId: string) {
    const db = getDb();
    const storage = getStorageService();

    const record = await db.query.reportFiles.findFirst({
      where: eq(reportFiles.id, fileId),
    });

    if (!record) {
      return null;
    }

    // Delete object with retry logic
    let attempts = 0;
    let deletedFromStorage = false;
    while (attempts < 3 && !deletedFromStorage) {
      try {
        await storage.delete(record.objectKey);
        deletedFromStorage = true;
      } catch (err: any) {
        attempts++;
        logger.warn({ err: err.message, attempt: attempts, key: record.objectKey }, 'Storage delete attempt failed');
        if (attempts >= 3) {
          logger.error({ key: record.objectKey }, 'Failed to delete storage object after 3 attempts');
        }
      }
    }

    await db.delete(reportFiles).where(eq(reportFiles.id, fileId));
    return record;
  }
}

