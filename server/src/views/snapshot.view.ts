export interface SnapshotDto {
  id: string;
  batchId: string;
  snapshotDate: string;
  parserVersion: number;
}

export class SnapshotView {
  static render(snapshot: any): SnapshotDto {
    return {
      id: snapshot.id,
      batchId: snapshot.batchId,
      snapshotDate: snapshot.snapshotDate,
      parserVersion: snapshot.parserVersion,
    };
  }

  static renderMany(snapshotsList: any[]): SnapshotDto[] {
    return snapshotsList.map((s) => SnapshotView.render(s));
  }
}
