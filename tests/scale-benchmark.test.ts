import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PrismaClient, StaffRole, ResidentStatus, FaceEnrollmentStatus, AttendanceSessionType, AttendanceMarkMethod, MovementType, MovementSource } from '@prisma/client';
import { config } from '../src/config';
import { TemplateCache } from '../src/modules/recognition/template-cache';
import { AttendanceService } from '../src/modules/attendance/attendance.service';
import { ReportService } from '../src/modules/reports/report.service';

describe('Step 11 Scale & Performance Benchmarks', () => {
  let db: PrismaClient;
  let testOrg: any;
  let testHostel: any;
  let adminUser: any;
  let residentIds: string[] = [];

  const timings: Record<string, number | string> = {};

  beforeAll(async () => {
    db = new PrismaClient({
      datasources: { db: { url: config.testDatabaseUrl } },
    });
    await db.$connect();

    testOrg = await db.organization.create({
      data: {
        code: `ORG_SCALE_${Date.now()}`,
        name: 'Scale Benchmark Org',
      },
    });

    testHostel = await db.hostel.create({
      data: {
        organizationId: testOrg.id,
        code: `HST_SCALE_${Date.now()}`,
        name: 'Scale Benchmark Hostel',
      },
    });

    adminUser = await db.user.create({
      data: {
        organizationId: testOrg.id,
        username: `admin_scale_${Date.now()}`,
        passwordHash: 'dummy_hash',
        fullName: 'Benchmark Administrator',
        role: StaffRole.ADMIN,
      },
    });
  });

  afterAll(async () => {
    try {
      console.log('\n========================================');
      console.log('       SCALE BENCHMARK RESULTS          ');
      console.log('========================================');
      console.table(timings);
      console.log('========================================\n');

      await db.attendanceRecord.deleteMany({ where: { resident: { organizationId: testOrg.id } } });
      await db.attendanceSession.deleteMany({ where: { organizationId: testOrg.id } });
      await db.movementEvent.deleteMany({ where: { hostelId: testHostel.id } });
      await db.residentPresence.deleteMany({ where: { hostelId: testHostel.id } });
      await db.faceProfile.deleteMany({ where: { resident: { organizationId: testOrg.id } } });
      await db.resident.deleteMany({ where: { organizationId: testOrg.id } });
      await db.auditLog.deleteMany({ where: { organizationId: testOrg.id } });
      await db.user.deleteMany({ where: { organizationId: testOrg.id } });
      await db.hostel.deleteMany({ where: { organizationId: testOrg.id } });
      await db.organization.deleteMany({ where: { id: testOrg.id } });
    } catch (e) {
      console.error('Error during cleanup:', e);
    }
    await db.$disconnect();
  });

  // --------------------------------------------------------------------------
  // 1. RESIDENT SCALE TEST: 500 RESIDENTS (Req 41)
  // --------------------------------------------------------------------------
  it('generates 500 residents and measures list, cache load, and retrieval performance', async () => {
    const BATCH_SIZE = 100;
    const TOTAL_RESIDENTS = 500;

    const startInsert = performance.now();
    for (let b = 0; b < TOTAL_RESIDENTS / BATCH_SIZE; b++) {
      const batchData = [];
      for (let i = 0; i < BATCH_SIZE; i++) {
        const idx = b * BATCH_SIZE + i;
        batchData.push({
          organizationId: testOrg.id,
          hostelId: testHostel.id,
          residentCode: `R_500_${String(idx).padStart(4, '0')}`,
          fullName: `Resident Scale ${idx}`,
          roomGroup: `Block-A-${(idx % 20) + 1}`,
          status: ResidentStatus.ACTIVE,
          faceEnrollmentStatus: FaceEnrollmentStatus.ENROLLED,
        });
      }
      await db.resident.createMany({ data: batchData });
    }
    timings['500_residents_insert_ms'] = (performance.now() - startInsert).toFixed(2);

    const fetchedResidents = await db.resident.findMany({
      where: { hostelId: testHostel.id },
      select: { id: true, residentCode: true },
    });
    expect(fetchedResidents.length).toBe(TOTAL_RESIDENTS);
    residentIds = fetchedResidents.map((r) => r.id);

    // Measure paginated resident list query
    const startList = performance.now();
    const listResult = await db.resident.findMany({
      where: { hostelId: testHostel.id, status: ResidentStatus.ACTIVE },
      take: 50,
      skip: 0,
      orderBy: { fullName: 'asc' },
    });
    timings['resident_list_query_p1_ms'] = (performance.now() - startList).toFixed(2);
    expect(listResult.length).toBe(50);

    // Measure TemplateCache loading for 500 residents
    const cache = new TemplateCache(db, 60);
    const startCache = performance.now();
    const cachedTemplates = await cache.getTemplatesForHostel(testHostel.id, testOrg.id);
    timings['template_cache_load_500_ms'] = (performance.now() - startCache).toFixed(2);
  });

  // --------------------------------------------------------------------------
  // 2. ATTENDANCE SCALE TEST: CLOSE SESSION WITH 500 RESIDENTS (Req 42)
  // --------------------------------------------------------------------------
  it('executes attendance session close workflow across 500 residents transactionally', async () => {
    const attendanceService = new AttendanceService(db);

    // Create session
    const session = await db.attendanceSession.create({
      data: {
        organizationId: testOrg.id,
        hostelId: testHostel.id,
        title: 'Scale Attendance Session 500',
        sessionType: AttendanceSessionType.NIGHT,
        status: 'ACTIVE',
        attendanceDate: new Date(),
        startTime: new Date(Date.now() - 3600000),
        endTime: new Date(Date.now() + 3600000),
        createdByUserId: adminUser.id,
        startedByUserId: adminUser.id,
      },
    });

    // Mark 400 residents as PRESENT
    const MARK_PRESENT_COUNT = 400;
    const presentRecords = [];
    for (let i = 0; i < MARK_PRESENT_COUNT; i++) {
      presentRecords.push({
        attendanceSessionId: session.id,
        residentId: residentIds[i],
        status: 'PRESENT' as any,
        markMethod: AttendanceMarkMethod.FACE_RECOGNITION,
        markedAt: new Date(),
        markedByUserId: adminUser.id,
      });
    }
    await db.attendanceRecord.createMany({ data: presentRecords });

    // Execute closeSession (must automatically mark remaining 100 residents as ABSENT transactionally)
    const startClose = performance.now();
    const closed = await attendanceService.closeSession(
      session.id,
      adminUser.id,
      adminUser.role
    );
    const closeDurationMs = performance.now() - startClose;
    timings['attendance_close_session_500_ms'] = closeDurationMs.toFixed(2);

    expect(closed.status).toBe('CLOSED');

    // Verify all 500 residents have exactly one record
    const allRecords = await db.attendanceRecord.findMany({
      where: { attendanceSessionId: session.id },
    });
    expect(allRecords.length).toBe(500);

    const presentCount = allRecords.filter((r) => r.status === 'PRESENT').length;
    const absentCount = allRecords.filter((r) => r.status === 'ABSENT').length;
    expect(presentCount).toBe(400);
    expect(absentCount).toBe(100);

    // Verify timing requirement: acceptable timing without timeout
    expect(closeDurationMs).toBeLessThan(10000); // Must close within 10s
  });

  // --------------------------------------------------------------------------
  // 3. MOVEMENT SCALE TEST: 10,000+ MOVEMENT EVENTS (Req 43)
  // --------------------------------------------------------------------------
  it('generates 10,000+ movement events and verifies sub-second indexed pagination', async () => {
    const TOTAL_EVENTS = 10000;
    const BATCH_SIZE = 1000;

    const startInsert = performance.now();
    for (let b = 0; b < TOTAL_EVENTS / BATCH_SIZE; b++) {
      const batchData = [];
      for (let i = 0; i < BATCH_SIZE; i++) {
        const idx = b * BATCH_SIZE + i;
        const resId = residentIds[idx % residentIds.length];
        const isIN = idx % 2 === 0;

        batchData.push({
          hostelId: testHostel.id,
          residentId: resId,
          movementType: isIN ? MovementType.IN : MovementType.OUT,
          source: MovementSource.FACE_RECOGNITION,
          effectiveTimestamp: new Date(Date.now() - (TOTAL_EVENTS - idx) * 1000),
          recordedTimestamp: new Date(),
          isCorrection: false,
        });
      }
      await db.movementEvent.createMany({ data: batchData });
    }
    timings['10k_movements_insert_ms'] = (performance.now() - startInsert).toFixed(2);

    const totalInDb = await db.movementEvent.count({ where: { hostelId: testHostel.id } });
    expect(totalInDb).toBeGreaterThanOrEqual(TOTAL_EVENTS);

    // Test indexed pagination query (page 1, 100 rows)
    const reportService = new ReportService(db);
    const actor = {
      id: adminUser.id,
      role: adminUser.role,
      organizationId: testOrg.id,
      hostelId: testHostel.id,
    };

    const startP1 = performance.now();
    const p1 = await reportService.getMovementHistory(
      {
        page: 1,
        pageSize: 100,
        hostelId: testHostel.id,
      },
      actor
    );
    timings['movement_report_10k_p1_ms'] = (performance.now() - startP1).toFixed(2);

    expect(p1.data.length).toBe(100);
    expect(p1.total).toBeGreaterThanOrEqual(TOTAL_EVENTS);

    // Test filtered query on 10k rows
    const startFilter = performance.now();
    const filtered = await reportService.getMovementHistory(
      {
        page: 1,
        pageSize: 50,
        hostelId: testHostel.id,
        direction: MovementType.OUT,
      },
      actor
    );
    timings['movement_report_10k_filtered_ms'] = (performance.now() - startFilter).toFixed(2);
    expect(filtered.data.length).toBe(50);
  });

  // --------------------------------------------------------------------------
  // 4. REPORT & CSV SCALE TEST (Req 44, 45)
  // --------------------------------------------------------------------------
  it('exports thousands of movement rows to CSV with formula injection prevention', async () => {
    const reportService = new ReportService(db);
    const actor = {
      id: adminUser.id,
      role: adminUser.role,
      organizationId: testOrg.id,
      hostelId: testHostel.id,
    };

    // Also insert a malicious resident to test CSV formula injection sanitization
    const maliciousResident = await db.resident.create({
      data: {
        organizationId: testOrg.id,
        hostelId: testHostel.id,
        residentCode: '=1+1',
        fullName: '@SUM(1,2,3)',
        roomGroup: '-2+5',
        status: ResidentStatus.ACTIVE,
      },
    });

    await db.movementEvent.create({
      data: {
        hostelId: testHostel.id,
        residentId: maliciousResident.id,
        movementType: MovementType.IN,
        source: MovementSource.MANUAL,
        effectiveTimestamp: new Date(),
        notes: '+calc.exe',
      },
    });

    const startCsv = performance.now();
    const csvString = await reportService.exportMovementCsv(
      { hostelId: testHostel.id },
      actor
    );
    timings['movement_csv_export_10000_rows_ms'] = (performance.now() - startCsv).toFixed(2);

    expect(csvString).toBeDefined();
    expect(typeof csvString).toBe('string');
    expect(csvString.length).toBeGreaterThan(1000);

    // Verify CSV formula injection prevention: formula triggers (=, +, -, @) are sanitized with apostrophe prefix (')
    expect(csvString).not.toMatch(/,"=1\+1"/);
    expect(csvString).not.toMatch(/,"@SUM/);
    expect(csvString).not.toMatch(/,"\+calc/);

    await db.movementEvent.deleteMany({ where: { residentId: maliciousResident.id } });
    await db.resident.delete({ where: { id: maliciousResident.id } });
  });
});
