export interface BatchDto {
  id: string;
  name: string;
  externalBatchId: string;
  startDate: string | null;
  createdAt: string;
  trainers?: { id: string; email: string }[];
}

export class BatchView {
  static render(batch: any): BatchDto {
    let trainers: { id: string; email: string }[] | undefined = undefined;
    if (batch.trainers && Array.isArray(batch.trainers)) {
      trainers = batch.trainers.map((t: any) => ({
        id: t.user ? t.user.id : t.id,
        email: t.user ? t.user.email : t.email,
      }));
    }

    return {
      id: batch.id,
      name: batch.name,
      externalBatchId: batch.externalBatchId,
      startDate: batch.startDate || null,
      createdAt: batch.createdAt instanceof Date ? batch.createdAt.toISOString() : batch.createdAt,
      ...(trainers ? { trainers } : {}),
    };
  }

  static renderMany(batches: any[]): BatchDto[] {
    return batches.map((b) => BatchView.render(b));
  }
}
