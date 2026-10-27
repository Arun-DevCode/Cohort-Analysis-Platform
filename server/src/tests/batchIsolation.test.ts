import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import path from 'path';
import { fileURLToPath } from 'url';
import ExcelJS from 'exceljs';
import { app } from '../app.js';
import { createTestDatabase } from './testDb.js';
import { users, batches, students, batchStudents } from '../db/schema/index.js';
import { AuthService } from '../services/auth.service.js';
import { and, eq } from 'drizzle-orm';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const fixturePath = path.join(__dirname, '../../tests/fixtures/Cumulative_Report_Batch_15748.xlsx');

/**
 * Helper to build custom test workbooks from the golden fixture
 */
async function buildTestWorkbook(options: {
  studentCount?: number;
  idPrefix?: string;
  sharedStudentId?: string;
  sharedStudentConsumption?: number;
}): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(fixturePath);

  const cumSheet = wb.getWorksheet('Cumulative Report')!;
  const assignSheet = wb.getWorksheet('Assignments')!;
  const contentSheet = wb.getWorksheet('Content Consumption')!;
  const liveSheet = wb.getWorksheet('Live Attendance')!;
  const liveRecSheet = wb.getWorksheet('Attendance (Live+Recording)')!;

  const maxRows = options.studentCount ?? 31;
  const totalFixtureRows = 31;

  // Trim rows if studentCount < 31 by nulling out unused rows across all sheets
  if (maxRows < totalFixtureRows) {
    wb.eachSheet((ws) => {
      for (let r = 2 + maxRows; r <= ws.rowCount; r++) {
        const row = ws.getRow(r);
        for (let c = 1; c <= ws.columnCount; c++) {
          row.getCell(c).value = null;
        }
        row.commit();
      }
    });
  }

  // Rewrite student IDs and phones to ensure uniqueness or shared student
  for (let r = 2; r <= 1 + maxRows; r++) {
    const idx = r - 1;
    let studentId = options.idPrefix ? `${options.idPrefix}_${idx}` : `STD_${idx}`;
    let phone = `+9198000${String(idx).padStart(5, '0')}`;

    if (idx === 1 && options.sharedStudentId) {
      studentId = options.sharedStudentId;
      phone = '+919999900001';
    }

    // Cumulative Report: col 1 = User ID, col 2 = Name, col 3 = Phone, col 4 = Total Consumption %
    const cumRow = cumSheet.getRow(r);
    cumRow.getCell(1).value = studentId;
    cumRow.getCell(2).value = `Learner ${studentId}`;
    cumRow.getCell(3).value = phone;
    if (idx === 1 && options.sharedStudentConsumption !== undefined) {
      cumRow.getCell(4).value = `${options.sharedStudentConsumption}%`;
    }
    cumRow.commit();

    // Assignments: col 1 = User ID, col 2 = Name, col 3 = Phone
    const assignRow = assignSheet.getRow(r);
    assignRow.getCell(1).value = studentId;
    assignRow.getCell(2).value = `Learner ${studentId}`;
    assignRow.getCell(3).value = phone;
    assignRow.commit();

    // Content Consumption: col 1 = User ID, col 2 = Name, col 3 = Phone
    const contentRow = contentSheet.getRow(r);
    contentRow.getCell(1).value = studentId;
    contentRow.getCell(2).value = `Learner ${studentId}`;
    contentRow.getCell(3).value = phone;
    contentRow.commit();

    // Live Attendance: col 1 = Name, col 2 = Phone number
    const liveRow = liveSheet.getRow(r);
    liveRow.getCell(1).value = `Learner ${studentId}`;
    liveRow.getCell(2).value = phone;
    liveRow.commit();

    // Attendance (Live+Recording): col 1 = Name, col 2 = Phone number
    const liveRecRow = liveRecSheet.getRow(r);
    liveRecRow.getCell(1).value = `Learner ${studentId}`;
    liveRecRow.getCell(2).value = phone;
    liveRecRow.commit();
  }

  const buf = await wb.xlsx.writeBuffer();
  return Buffer.from(buf);
}

describe('Step 3: Batch Isolation & Single Batch Invariant Tests', () => {
  let adminToken: string;
  let adminId: string;
  let activeDb: any;

  let daBatchId: string;
  let afsdBatchId: string;

  let reportABuffer: Buffer; // DA: 20 students, dated yesterday (2026-10-26)
  let reportBBuffer: Buffer; // AFSD: 15 students, dated today (2026-10-27)

  beforeEach(async () => {
    activeDb = await createTestDatabase();
    const db = activeDb;
    const passwordHash = await AuthService.hashPassword('AdminPass123!');

    const [admin] = await db
      .insert(users)
      .values({ email: 'admin@isolation.test', passwordHash, role: 'admin', name: 'Admin User' })
      .returning();
    adminId = admin.id;
    adminToken = AuthService.generateTokens({
      userId: admin.id,
      email: admin.email,
      role: 'admin',
      name: admin.name,
    }).accessToken;

    // Create batch DA
    const [da] = await db
      .insert(batches)
      .values({ name: 'DA', externalBatchId: 'COURSE-DA', createdBy: adminId })
      .returning();
    daBatchId = da.id;

    // Create batch AFSD
    const [afsd] = await db
      .insert(batches)
      .values({ name: 'AFSD', externalBatchId: 'COURSE-AFSD', createdBy: adminId })
      .returning();
    afsdBatchId = afsd.id;

    // Report A: 20 students (prefix: DA), shared student SHARED_01 has 90% consumption
    reportABuffer = await buildTestWorkbook({
      studentCount: 20,
      idPrefix: 'DA_STUDENT',
      sharedStudentId: 'SHARED_STUDENT_01',
      sharedStudentConsumption: 90,
    });

    // Report B: 15 students (prefix: AFSD), shared student SHARED_01 has 45% consumption
    reportBBuffer = await buildTestWorkbook({
      studentCount: 15,
      idPrefix: 'AFSD_STUDENT',
      sharedStudentId: 'SHARED_STUDENT_01',
      sharedStudentConsumption: 45,
    });
  });

  it('1. Upload report A (DA, yesterday) and report B (AFSD, today): do NOT combine, counts equal file rows', async () => {
    // Upload report A to DA (yesterday: 2026-10-26)
    const uploadA = await request(app)
      .post(`/api/v1/batches/${daBatchId}/uploads`)
      .set('Authorization', `Bearer ${adminToken}`)
      .attach('file', reportABuffer, 'DA_yesterday.xlsx')
      .field('snapshotDate', '2026-10-26');
    expect(uploadA.status).toBe(201);
    const snapAId = uploadA.body.snapshot.snapshotId;

    // Upload report B to AFSD (today: 2026-10-27)
    const uploadB = await request(app)
      .post(`/api/v1/batches/${afsdBatchId}/uploads`)
      .set('Authorization', `Bearer ${adminToken}`)
      .attach('file', reportBBuffer, 'AFSD_today.xlsx')
      .field('snapshotDate', '2026-10-27');
    expect(uploadB.status).toBe(201);
    const snapBId = uploadB.body.snapshot.snapshotId;

    // GET /batches/DA/snapshots returns only yesterday
    const daSnaps = await request(app)
      .get(`/api/v1/batches/${daBatchId}/snapshots`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(daSnaps.status).toBe(200);
    expect(daSnaps.body.snapshots).toHaveLength(1);
    expect(daSnaps.body.snapshots[0].snapshotDate).toBe('2026-10-26');
    expect(daSnaps.body.snapshots[0].id).toBe(snapAId);

    // GET /batches/AFSD/snapshots returns only today
    const afsdSnaps = await request(app)
      .get(`/api/v1/batches/${afsdBatchId}/snapshots`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(afsdSnaps.status).toBe(200);
    expect(afsdSnaps.body.snapshots).toHaveLength(1);
    expect(afsdSnaps.body.snapshots[0].snapshotDate).toBe('2026-10-27');
    expect(afsdSnaps.body.snapshots[0].id).toBe(snapBId);

    // DA Overview shows exactly 20 students
    const daOverview = await request(app)
      .get(`/api/v1/batches/${daBatchId}/overview`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(daOverview.status).toBe(200);
    expect(daOverview.body.totalStudents).toBe(20);

    // AFSD Overview shows exactly 15 students
    const afsdOverview = await request(app)
      .get(`/api/v1/batches/${afsdBatchId}/overview`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(afsdOverview.status).toBe(200);
    expect(afsdOverview.body.totalStudents).toBe(15);

    // DA Students endpoint returns exactly 20 students
    const daStudents = await request(app)
      .get(`/api/v1/batches/${daBatchId}/students`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(daStudents.status).toBe(200);
    expect(daStudents.body.totalStudents).toBe(20);
    expect(daStudents.body.students).toHaveLength(20);

    // AFSD Students endpoint returns exactly 15 students
    const afsdStudents = await request(app)
      .get(`/api/v1/batches/${afsdBatchId}/students`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(afsdStudents.status).toBe(200);
    expect(afsdStudents.body.totalStudents).toBe(15);
    expect(afsdStudents.body.students).toHaveLength(15);

    // DA Content stats: studentWeeklyProgress has 20 students * 10 weeks = 200 rows
    const daContent = await request(app)
      .get(`/api/v1/batches/${daBatchId}/content`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(daContent.status).toBe(200);
    expect(daContent.body.studentWeeklyProgress).toHaveLength(200);

    // AFSD Content stats: studentWeeklyProgress has 15 students * 10 weeks = 150 rows
    const afsdContent = await request(app)
      .get(`/api/v1/batches/${afsdBatchId}/content`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(afsdContent.status).toBe(200);
    expect(afsdContent.body.studentWeeklyProgress).toHaveLength(150);

    // DA Assignments: item total equals 20
    const daAssignments = await request(app)
      .get(`/api/v1/batches/${daBatchId}/assignments`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(daAssignments.status).toBe(200);
    expect(daAssignments.body.assignments[0].total).toBe(20);

    // AFSD Assignments: item total equals 15
    const afsdAssignments = await request(app)
      .get(`/api/v1/batches/${afsdBatchId}/assignments`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(afsdAssignments.status).toBe(200);
    expect(afsdAssignments.body.assignments[0].total).toBe(15);

    // DA Attendance: sessions total equals 20
    const daAttendance = await request(app)
      .get(`/api/v1/batches/${daBatchId}/attendance`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(daAttendance.status).toBe(200);
    expect(daAttendance.body.sessions[0].total).toBe(20);

    // AFSD Attendance: sessions total equals 15
    const afsdAttendance = await request(app)
      .get(`/api/v1/batches/${afsdBatchId}/attendance`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(afsdAttendance.status).toBe(200);
    expect(afsdAttendance.body.sessions[0].total).toBe(15);
  });

  it('2. Two reports with the SAME date in different batches stay separate', async () => {
    const sameDate = '2026-10-25';

    // Upload to DA
    const resA = await request(app)
      .post(`/api/v1/batches/${daBatchId}/uploads`)
      .set('Authorization', `Bearer ${adminToken}`)
      .attach('file', reportABuffer, 'DA_same_date.xlsx')
      .field('snapshotDate', sameDate);
    expect(resA.status).toBe(201);

    // Upload to AFSD on the exact same date
    const resB = await request(app)
      .post(`/api/v1/batches/${afsdBatchId}/uploads`)
      .set('Authorization', `Bearer ${adminToken}`)
      .attach('file', reportBBuffer, 'AFSD_same_date.xlsx')
      .field('snapshotDate', sameDate);
    expect(resB.status).toBe(201);

    // Verify DA has only its snapshot and 20 students
    const daOverview = await request(app)
      .get(`/api/v1/batches/${daBatchId}/overview?snapshotId=${resA.body.snapshot.snapshotId}`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(daOverview.status).toBe(200);
    expect(daOverview.body.totalStudents).toBe(20);

    // Verify AFSD has only its snapshot and 15 students
    const afsdOverview = await request(app)
      .get(`/api/v1/batches/${afsdBatchId}/overview?snapshotId=${resB.body.snapshot.snapshotId}`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(afsdOverview.status).toBe(200);
    expect(afsdOverview.body.totalStudents).toBe(15);
  });

  it('3. A second report for DA on another date adds a second snapshot to DA only; AFSD is unchanged', async () => {
    // 1st snapshot for DA
    await request(app)
      .post(`/api/v1/batches/${daBatchId}/uploads`)
      .set('Authorization', `Bearer ${adminToken}`)
      .attach('file', reportABuffer, 'DA_day1.xlsx')
      .field('snapshotDate', '2026-10-21');

    // 1st snapshot for AFSD
    await request(app)
      .post(`/api/v1/batches/${afsdBatchId}/uploads`)
      .set('Authorization', `Bearer ${adminToken}`)
      .attach('file', reportBBuffer, 'AFSD_day1.xlsx')
      .field('snapshotDate', '2026-10-21');

    // 2nd snapshot for DA only
    await request(app)
      .post(`/api/v1/batches/${daBatchId}/uploads`)
      .set('Authorization', `Bearer ${adminToken}`)
      .attach('file', reportABuffer, 'DA_day2.xlsx')
      .field('snapshotDate', '2026-10-28');

    // Check DA has 2 snapshots
    const daSnaps = await request(app)
      .get(`/api/v1/batches/${daBatchId}/snapshots`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(daSnaps.body.snapshots).toHaveLength(2);

    // Check AFSD still has only 1 snapshot
    const afsdSnaps = await request(app)
      .get(`/api/v1/batches/${afsdBatchId}/snapshots`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(afsdSnaps.body.snapshots).toHaveLength(1);
  });

  it('4. A snapshot_id from AFSD requested under DA returns 404', async () => {
    // Upload DA snapshot
    const resA = await request(app)
      .post(`/api/v1/batches/${daBatchId}/uploads`)
      .set('Authorization', `Bearer ${adminToken}`)
      .attach('file', reportABuffer, 'DA.xlsx')
      .field('snapshotDate', '2026-10-21');
    const daSnapId = resA.body.snapshot.snapshotId;

    // Upload AFSD snapshot
    const resB = await request(app)
      .post(`/api/v1/batches/${afsdBatchId}/uploads`)
      .set('Authorization', `Bearer ${adminToken}`)
      .attach('file', reportBBuffer, 'AFSD.xlsx')
      .field('snapshotDate', '2026-10-22');
    const afsdSnapId = resB.body.snapshot.snapshotId;

    // Query AFSD snapshot under DA batch - all must return 404
    const endpoints = [
      `/api/v1/batches/${daBatchId}/overview?snapshotId=${afsdSnapId}`,
      `/api/v1/batches/${daBatchId}/at-risk?snapshotId=${afsdSnapId}`,
      `/api/v1/batches/${daBatchId}/assignments?snapshotId=${afsdSnapId}`,
      `/api/v1/batches/${daBatchId}/content?snapshotId=${afsdSnapId}`,
      `/api/v1/batches/${daBatchId}/attendance?snapshotId=${afsdSnapId}`,
      `/api/v1/batches/${daBatchId}/students?snapshotId=${afsdSnapId}`,
      `/api/v1/batches/${daBatchId}/report?snapshotId=${afsdSnapId}`,
      `/api/v1/batches/${daBatchId}/compare?from=${daSnapId}&to=${afsdSnapId}`,
      `/api/v1/batches/${daBatchId}/compare?from=${afsdSnapId}&to=${daSnapId}`,
    ];

    for (const ep of endpoints) {
      const res = await request(app).get(ep).set('Authorization', `Bearer ${adminToken}`);
      expect(res.status).toBe(404);
    }
  });

  it('5. The same student ID in both files appears in both batches with each batch\'s own numbers', async () => {
    // Upload DA: SHARED_STUDENT_01 has 90% consumption
    await request(app)
      .post(`/api/v1/batches/${daBatchId}/uploads`)
      .set('Authorization', `Bearer ${adminToken}`)
      .attach('file', reportABuffer, 'DA.xlsx')
      .field('snapshotDate', '2026-10-21');

    // Upload AFSD: SHARED_STUDENT_01 has 45% consumption
    await request(app)
      .post(`/api/v1/batches/${afsdBatchId}/uploads`)
      .set('Authorization', `Bearer ${adminToken}`)
      .attach('file', reportBBuffer, 'AFSD.xlsx')
      .field('snapshotDate', '2026-10-22');

    // Verify only ONE student row exists in students table for this owner
    const studentRows = await activeDb
      .select()
      .from(students)
      .where(
        and(
          eq(students.createdBy, adminId),
          eq(students.externalStudentId, 'SHARED_STUDENT_01')
        )
      );
    expect(studentRows).toHaveLength(1);
    const sharedStudentUuid = studentRows[0].id;

    // Verify student is linked to BOTH batches in batch_students
    const links = await activeDb
      .select()
      .from(batchStudents)
      .where(eq(batchStudents.studentId, sharedStudentUuid));
    expect(links).toHaveLength(2);

    // Query DA students: shared student has 90% consumption
    const daStudentsRes = await request(app)
      .get(`/api/v1/batches/${daBatchId}/students`)
      .set('Authorization', `Bearer ${adminToken}`);
    const sharedInDA = daStudentsRes.body.students.find(
      (s: any) => s.studentId === 'SHARED_STUDENT_01'
    );
    expect(sharedInDA).toBeDefined();
    expect(sharedInDA.totalConsumptionPct).toBe(90);

    // Query AFSD students: shared student has 45% consumption
    const afsdStudentsRes = await request(app)
      .get(`/api/v1/batches/${afsdBatchId}/students`)
      .set('Authorization', `Bearer ${adminToken}`);
    const sharedInAFSD = afsdStudentsRes.body.students.find(
      (s: any) => s.studentId === 'SHARED_STUDENT_01'
    );
    expect(sharedInAFSD).toBeDefined();
    expect(sharedInAFSD.totalConsumptionPct).toBe(45);

    // Student profile scoped to DA shows DA history
    const daProfileRes = await request(app)
      .get(`/api/v1/students/${sharedStudentUuid}?batchId=${daBatchId}`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(daProfileRes.status).toBe(200);
    expect(daProfileRes.body.history).toHaveLength(1);
    expect(daProfileRes.body.history[0].totalConsumptionPct).toBe(90);

    // Student profile scoped to AFSD shows AFSD history
    const afsdProfileRes = await request(app)
      .get(`/api/v1/students/${sharedStudentUuid}?batchId=${afsdBatchId}`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(afsdProfileRes.status).toBe(200);
    expect(afsdProfileRes.body.history).toHaveLength(1);
    expect(afsdProfileRes.body.history[0].totalConsumptionPct).toBe(45);
  });

  it('6. Duplicate date without replace=true is rejected (409); with replace=true only that batch\'s snapshot is replaced', async () => {
    const testDate = '2026-10-21';

    // 1st upload
    const res1 = await request(app)
      .post(`/api/v1/batches/${daBatchId}/uploads`)
      .set('Authorization', `Bearer ${adminToken}`)
      .attach('file', reportABuffer, 'DA_1.xlsx')
      .field('snapshotDate', testDate);
    expect(res1.status).toBe(201);
    const snap1Id = res1.body.snapshot.snapshotId;

    // 2nd upload without replace returns 409
    const res2 = await request(app)
      .post(`/api/v1/batches/${daBatchId}/uploads`)
      .set('Authorization', `Bearer ${adminToken}`)
      .attach('file', reportABuffer, 'DA_2.xlsx')
      .field('snapshotDate', testDate);
    expect(res2.status).toBe(409);

    // 3rd upload with replace=true replaces the snapshot
    const res3 = await request(app)
      .post(`/api/v1/batches/${daBatchId}/uploads`)
      .set('Authorization', `Bearer ${adminToken}`)
      .attach('file', reportABuffer, 'DA_3.xlsx')
      .field('snapshotDate', testDate)
      .field('replace', 'true');
    expect(res3.status).toBe(201);
    const snap3Id = res3.body.snapshot.snapshotId;
    expect(snap3Id).not.toBe(snap1Id);

    // Total snapshots in DA is still 1
    const daSnaps = await request(app)
      .get(`/api/v1/batches/${daBatchId}/snapshots`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(daSnaps.body.snapshots).toHaveLength(1);
    expect(daSnaps.body.snapshots[0].id).toBe(snap3Id);
  });
});
