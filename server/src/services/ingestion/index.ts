import ExcelJS from 'exceljs';
import { getDb } from '../../db/client.js';
import { uploads } from '../../db/schema/index.js';
import { computeFileHash } from '../../utils/normalizers.js';
import { processWorkbook, IngestionResult } from './identityResolver.js';
import { SnapshotLoader, LoadSnapshotResult } from './loader.js';
import { and, eq } from 'drizzle-orm';
import { logger } from '../../utils/logger.js';

export interface IngestFileInput {
  fileBuffer: Buffer;
  fileName: string;
  batchId: string;
  snapshotDate: string; // YYYY-MM-DD
  userId: string;
  replace?: boolean;
}

export interface IngestFileResponse {
  uploadId: string;
  status: 'done' | 'failed';
  snapshot?: LoadSnapshotResult;
  errorReport: {
    errors: IngestionResult['errors'];
    warnings: IngestionResult['warnings'];
    unmatchedRows: IngestionResult['unmatchedRows'];
  };
}

export class IngestionService {
  static async ingest(input: IngestFileInput): Promise<IngestFileResponse> {
    const db = getDb();
    const fileHash = computeFileHash(input.fileBuffer);

    // 1. Check duplicate file hash in this batch
    const existingUpload = await db.query.uploads.findFirst({
      where: and(
        eq(uploads.batchId, input.batchId),
        eq(uploads.fileHash, fileHash),
        eq(uploads.status, 'done')
      ),
    });

    if (existingUpload && !input.replace) {
      logger.info(
        { batchId: input.batchId, uploadId: existingUpload.id },
        'Duplicate file uploaded for batch'
      );
    }

    // 2. Create Uploads record
    const [uploadRecord] = await db
      .insert(uploads)
      .values({
        batchId: input.batchId,
        uploadedBy: input.userId,
        fileHash,
        status: 'processing',
      })
      .returning();

    const uploadId = uploadRecord.id;

    try {
      // 3. Load Excel workbook with ExcelJS (values only)
      const workbook = new ExcelJS.Workbook();
      await workbook.xlsx.load(input.fileBuffer as any);

      // 4. Process workbook through sheet detection, validation, & identity resolution
      const ingestion = await processWorkbook(workbook);

      const blockingErrors = ingestion.errors.filter((e) => e.blocking);

      // 5. If blocking validation errors, mark upload as failed
      if (blockingErrors.length > 0) {
        await db
          .update(uploads)
          .set({
            status: 'failed',
            errorReport: {
              errors: ingestion.errors,
              warnings: ingestion.warnings,
              unmatchedRows: ingestion.unmatchedRows,
            },
          })
          .where(eq(uploads.id, uploadId));

        return {
          uploadId,
          status: 'failed',
          errorReport: {
            errors: ingestion.errors,
            warnings: ingestion.warnings,
            unmatchedRows: ingestion.unmatchedRows,
          },
        };
      }

      // 6. Load snapshot in atomic Drizzle transaction
      const snapshot = await SnapshotLoader.load(ingestion, {
        batchId: input.batchId,
        uploadId,
        snapshotDate: input.snapshotDate,
        userId: input.userId,
        replace: input.replace,
      });

      return {
        uploadId,
        status: 'done',
        snapshot,
        errorReport: {
          errors: ingestion.errors,
          warnings: ingestion.warnings,
          unmatchedRows: ingestion.unmatchedRows,
        },
      };
    } catch (err: any) {
      logger.error({ err, uploadId }, 'Ingestion failed with exception');
      await db
        .update(uploads)
        .set({
          status: 'failed',
          errorReport: {
            errors: [{ sheet: 'General', message: err.message, blocking: true }],
            warnings: [],
            unmatchedRows: [],
          },
        })
        .where(eq(uploads.id, uploadId));

      throw err;
    }
  }
}
