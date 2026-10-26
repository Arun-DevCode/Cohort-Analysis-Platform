export interface UploadDto {
  id: string;
  batchId: string;
  status: string;
  errorReport: any;
  createdAt: string;
}

export class UploadView {
  static render(upload: any): UploadDto {
    return {
      id: upload.id,
      batchId: upload.batchId,
      status: upload.status,
      errorReport: upload.errorReport,
      createdAt: upload.createdAt instanceof Date ? upload.createdAt.toISOString() : upload.createdAt,
    };
  }
}
