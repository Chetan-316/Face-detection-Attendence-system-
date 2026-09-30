import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import { testPrisma, resetTestDatabase } from './helpers/test-db';
import { createApp } from '../src/api/app';
import { tokenService } from '../src/api/auth/token.service';
import {
  StaffRole,
  ResidentStatus,
  PresenceState,
  MovementType,
  MovementSource,
  AttendanceSessionType,
  AttendanceSessionStatus,
  AttendanceRecordStatus,
  AttendanceMarkMethod,
} from '@prisma/client';

describe('Step 09: Operational Attendance & Movement Reporting Tests', () => {
  let app: any;

  let orgAId: string;
  let orgBId: string;
  let hostelA1Id: string;
  let hostelA2Id: string;
  let hostelBId: string;

  let adminAToken: string;
  let wardenA1Token: string;
  let wardenA2Token: string;
  let guardA1Token: string;
  let adminBToken: string;

  let userWardenA1Id: string;

  beforeEach(async () => {
    await resetTestDatabase();
    app = createApp(testPrisma);

    // 1. Organizations
    const orgA = await testPrisma.organization.create({
      data: { code: 'ORG_A_REPORT', name: 'Organization A' },
    });
    orgAId = orgA.id;

    const orgB = await testPrisma.organization.create({
      data: { code: 'ORG_B_REPORT', name: 'Organization B' },
    });
    orgBId = orgBId = orgB.id;

    // 2. Hostels
    const hostelA1 = await testPrisma.hostel.create({
      data: { organizationId: orgA.id, code: 'H_A1', name: 'Hostel A1' },
    });
    hostelA1Id = hostelA1.id;

    const hostelA2 = await testPrisma.hostel.create({
      data: { organizationId: orgA.id, code: 'H_A2', name: 'Hostel A2' },
    });
    hostelA2Id = hostelA2.id;

    const hostelB = await testPrisma.hostel.create({
      data: { organizationId: orgB.id, code: 'H_B1', name: 'Hostel B1' },
    });
    hostelBId = hostelB.id;

    // 3. Staff Users & Tokens
    const adminA = await testPrisma.user.create({
      data: {
        organizationId: orgA.id,
        username: 'admin_a',
        fullName: 'Admin Org A',
        passwordHash: 'hash',
        role: StaffRole.ADMIN,
      },
    });
    adminAToken = tokenService.generateToken({
      sub: adminA.id,
      organizationId: adminA.organizationId,
      hostelId: null,
      role: adminA.role,
    }).token;

    const wardenA1 = await testPrisma.user.create({
      data: {
        organizationId: orgA.id,
        hostelId: hostelA1.id,
        username: 'warden_a1',
        fullName: 'Warden Hostel A1',
        passwordHash: 'hash',
        role: StaffRole.WARDEN,
      },
    });
    userWardenA1Id = wardenA1.id;
    wardenA1Token = tokenService.generateToken({
      sub: wardenA1.id,
      organizationId: wardenA1.organizationId,
      hostelId: wardenA1.hostelId,
      role: wardenA1.role,
    }).token;

    const wardenA2 = await testPrisma.user.create({
      data: {
        organizationId: orgA.id,
        hostelId: hostelA2.id,
        username: 'warden_a2',
        fullName: 'Warden Hostel A2',
        passwordHash: 'hash',
        role: StaffRole.WARDEN,
      },
    });
    wardenA2Token = tokenService.generateToken({
      sub: wardenA2.id,
      organizationId: wardenA2.organizationId,
      hostelId: wardenA2.hostelId,
      role: wardenA2.role,
    }).token;

    const guardA1 = await testPrisma.user.create({
      data: {
        organizationId: orgA.id,
        hostelId: hostelA1.id,
        username: 'guard_a1',
        fullName: 'Guard Hostel A1',
        passwordHash: 'hash',
        role: StaffRole.GUARD,
      },
    });
    guardA1Token = tokenService.generateToken({
      sub: guardA1.id,
      organizationId: guardA1.organizationId,
      hostelId: guardA1.hostelId,
      role: guardA1.role,
    }).token;

    const adminB = await testPrisma.user.create({
      data: {
        organizationId: orgB.id,
        username: 'admin_b',
        fullName: 'Admin Org B',
        passwordHash: 'hash',
        role: StaffRole.ADMIN,
      },
    });
    adminBToken = tokenService.generateToken({
      sub: adminB.id,
      organizationId: adminB.organizationId,
      hostelId: null,
      role: adminB.role,
    }).token;
  });

  // ----------------------------------------------------
  // Requirement 59: TEST — ATTENDANCE DAILY SUMMARY
  // Fixture: 10 active expected residents, 8 PRESENT, 2 ABSENT
  // Expected: expected = 10, present = 8, absent = 2, rate = 80
  // ----------------------------------------------------
  it('59: calculates attendance daily summary with 8 PRESENT, 2 ABSENT -> 80%', async () => {
    // Create 10 residents
    const residents = [];
    for (let i = 1; i <= 10; i++) {
      const res = await testPrisma.resident.create({
        data: {
          organizationId: orgAId,
          hostelId: hostelA1Id,
          residentCode: `R${100 + i}`,
          fullName: `Resident ${i}`,
          roomGroup: `A-${100 + i}`,
          status: ResidentStatus.ACTIVE,
        },
      });
      residents.push(res);
    }

    // Create closed session
    const session = await testPrisma.attendanceSession.create({
      data: {
        organizationId: orgAId,
        hostelId: hostelA1Id,
        sessionType: AttendanceSessionType.NIGHT,
        title: 'Night Attendance 30 Sep',
        attendanceDate: new Date('2026-09-30T00:00:00.000Z'),
        status: AttendanceSessionStatus.CLOSED,
        startTime: new Date('2026-09-30T21:00:00.000Z'),
        endTime: new Date('2026-09-30T22:00:00.000Z'),
        createdByUserId: userWardenA1Id,
      },
    });

    // 8 PRESENT, 2 ABSENT
    for (let i = 0; i < 8; i++) {
      await testPrisma.attendanceRecord.create({
        data: {
          attendanceSessionId: session.id,
          residentId: residents[i].id,
          status: AttendanceRecordStatus.PRESENT,
          markMethod: AttendanceMarkMethod.FACE_RECOGNITION,
        },
      });
    }
    for (let i = 8; i < 10; i++) {
      await testPrisma.attendanceRecord.create({
        data: {
          attendanceSessionId: session.id,
          residentId: residents[i].id,
          status: AttendanceRecordStatus.ABSENT,
          markMethod: AttendanceMarkMethod.SYSTEM,
        },
      });
    }

    const res = await request(app)
      .get(`/api/v1/reports/attendance?hostelId=${hostelA1Id}`)
      .set('Authorization', `Bearer ${wardenA1Token}`);

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
    const item = res.body.data[0];
    expect(item.expectedResidents).toBe(10);
    expect(item.presentCount).toBe(8);
    expect(item.absentCount).toBe(2);
    expect(item.attendanceRate).toBe(80);
    expect(item.isFinalized).toBe(true);
  });

  // ----------------------------------------------------
  // Requirement 60: TEST — ATTENDANCE TREND
  // Create 3 closed sessions: Day 1: 8/10, Day 2: 9/10, Day 3: 10/10 -> 80%, 90%, 100%
  // ----------------------------------------------------
  it('60: aggregates chronological attendance trend (80%, 90%, 100%)', async () => {
    const residents = [];
    for (let i = 1; i <= 10; i++) {
      const res = await testPrisma.resident.create({
        data: {
          organizationId: orgAId,
          hostelId: hostelA1Id,
          residentCode: `R_TR_${i}`,
          fullName: `Trend Resident ${i}`,
          roomGroup: `B-${i}`,
          status: ResidentStatus.ACTIVE,
        },
      });
      residents.push(res);
    }

    const days = [
      { date: '2026-09-24', present: 8, expected: 10 },
      { date: '2026-09-25', present: 9, expected: 10 },
      { date: '2026-09-26', present: 10, expected: 10 },
    ];

    for (const d of days) {
      const session = await testPrisma.attendanceSession.create({
        data: {
          organizationId: orgAId,
          hostelId: hostelA1Id,
          sessionType: AttendanceSessionType.NIGHT,
          title: `Night Attendance ${d.date}`,
          attendanceDate: new Date(`${d.date}T00:00:00.000Z`),
          status: AttendanceSessionStatus.CLOSED,
          startTime: new Date(`${d.date}T21:00:00.000Z`),
          endTime: new Date(`${d.date}T22:00:00.000Z`),
          createdByUserId: userWardenA1Id,
        },
      });

      for (let i = 0; i < d.present; i++) {
        await testPrisma.attendanceRecord.create({
          data: {
            attendanceSessionId: session.id,
            residentId: residents[i].id,
            status: AttendanceRecordStatus.PRESENT,
            markMethod: AttendanceMarkMethod.FACE_RECOGNITION,
          },
        });
      }
      for (let i = d.present; i < d.expected; i++) {
        await testPrisma.attendanceRecord.create({
          data: {
            attendanceSessionId: session.id,
            residentId: residents[i].id,
            status: AttendanceRecordStatus.ABSENT,
            markMethod: AttendanceMarkMethod.SYSTEM,
          },
        });
      }
    }

    const res = await request(app)
      .get(`/api/v1/reports/attendance/trend?hostelId=${hostelA1Id}&dateFrom=2026-09-24&dateTo=2026-09-26`)
      .set('Authorization', `Bearer ${wardenA1Token}`);

    expect(res.status).toBe(200);
    const trend = res.body.data;
    expect(trend).toHaveLength(3);
    expect(trend[0].date).toBe('2026-09-24');
    expect(trend[0].attendanceRate).toBe(80);
    expect(trend[1].date).toBe('2026-09-25');
    expect(trend[1].attendanceRate).toBe(90);
    expect(trend[2].date).toBe('2026-09-26');
    expect(trend[2].attendanceRate).toBe(100);
  });

  // ----------------------------------------------------
  // Requirement 61: TEST — LOGICAL ATTENDANCE DATE
  // Session starts before midnight and closes next morning.
  // Must group by attendanceDate, not close timestamp.
  // ----------------------------------------------------
  it('61: groups midnight-crossing session by logical attendanceDate, not close timestamp', async () => {
    const res1 = await testPrisma.resident.create({
      data: {
        organizationId: orgAId,
        hostelId: hostelA1Id,
        residentCode: 'R_MID_1',
        fullName: 'Midnight Resident',
        roomGroup: 'M-1',
        status: ResidentStatus.ACTIVE,
      },
    });

    const midnightSession = await testPrisma.attendanceSession.create({
      data: {
        organizationId: orgAId,
        hostelId: hostelA1Id,
        sessionType: AttendanceSessionType.NIGHT,
        title: 'Cross Midnight Session',
        // Logical date is 29 Sep 2026
        attendanceDate: new Date('2026-09-29T00:00:00.000Z'),
        status: AttendanceSessionStatus.CLOSED,
        // Started 11:30 PM on 29 Sep, closed 1:30 AM on 30 Sep
        startTime: new Date('2026-09-29T23:30:00.000Z'),
        endTime: new Date('2026-09-30T01:30:00.000Z'),
        createdByUserId: userWardenA1Id,
      },
    });

    await testPrisma.attendanceRecord.create({
      data: {
        attendanceSessionId: midnightSession.id,
        residentId: res1.id,
        status: AttendanceRecordStatus.PRESENT,
        markMethod: AttendanceMarkMethod.FACE_RECOGNITION,
      },
    });

    // Query for 2026-09-29
    const res = await request(app)
      .get(`/api/v1/reports/attendance?hostelId=${hostelA1Id}&date=2026-09-29`)
      .set('Authorization', `Bearer ${wardenA1Token}`);

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0].id).toBe(midnightSession.id);
    expect(res.body.data[0].attendanceDate).toContain('2026-09-29');

    // Query for 2026-09-30 -> should NOT match
    const res30 = await request(app)
      .get(`/api/v1/reports/attendance?hostelId=${hostelA1Id}&date=2026-09-30`)
      .set('Authorization', `Bearer ${wardenA1Token}`);

    expect(res30.status).toBe(200);
    expect(res30.body.data).toHaveLength(0);
  });

  // ----------------------------------------------------
  // Requirement 62: TEST — ACTIVE SESSION
  // 10 expected, 7 present -> remaining = 3, does NOT falsely finalize absent
  // ----------------------------------------------------
  it('62: reports ACTIVE session as in-progress with remaining = 3 without false finalization', async () => {
    const residents = [];
    for (let i = 1; i <= 10; i++) {
      const res = await testPrisma.resident.create({
        data: {
          organizationId: orgAId,
          hostelId: hostelA1Id,
          residentCode: `R_ACT_${i}`,
          fullName: `Active Res ${i}`,
          roomGroup: `C-${i}`,
          status: ResidentStatus.ACTIVE,
        },
      });
      residents.push(res);
    }

    const activeSession = await testPrisma.attendanceSession.create({
      data: {
        organizationId: orgAId,
        hostelId: hostelA1Id,
        sessionType: AttendanceSessionType.NIGHT,
        title: 'Active Night Attendance',
        attendanceDate: new Date('2026-09-30T00:00:00.000Z'),
        status: AttendanceSessionStatus.ACTIVE,
        startTime: new Date('2026-09-30T21:00:00.000Z'),
        createdByUserId: userWardenA1Id,
      },
    });

    // Mark 7 present
    for (let i = 0; i < 7; i++) {
      await testPrisma.attendanceRecord.create({
        data: {
          attendanceSessionId: activeSession.id,
          residentId: residents[i].id,
          status: AttendanceRecordStatus.PRESENT,
          markMethod: AttendanceMarkMethod.FACE_RECOGNITION,
        },
      });
    }

    const res = await request(app)
      .get(`/api/v1/reports/attendance?hostelId=${hostelA1Id}&sessionId=${activeSession.id}`)
      .set('Authorization', `Bearer ${wardenA1Token}`);

    expect(res.status).toBe(200);
    const item = res.body.data[0];
    expect(item.status).toBe('ACTIVE');
    expect(item.isFinalized).toBe(false);
    expect(item.expectedResidents).toBe(10);
    expect(item.presentCount).toBe(7);
    expect(item.absentCount).toBe(0); // Not finalized as absent!
    expect(item.remainingCount).toBe(3);
    expect(item.attendanceRate).toBe(70);
  });

  // ----------------------------------------------------
  // Requirement 63: TEST — RESIDENT ATTENDANCE %
  // 20 finalized sessions, 18 present, 2 absent -> 90%
  // ----------------------------------------------------
  it('63: calculates individual resident attendance percentage (18/20 = 90%)', async () => {
    const resident = await testPrisma.resident.create({
      data: {
        organizationId: orgAId,
        hostelId: hostelA1Id,
        residentCode: 'R_SUM_90',
        fullName: 'Rahul Summary',
        roomGroup: 'A-101',
        status: ResidentStatus.ACTIVE,
      },
    });

    for (let i = 1; i <= 20; i++) {
      const session = await testPrisma.attendanceSession.create({
        data: {
          organizationId: orgAId,
          hostelId: hostelA1Id,
          sessionType: AttendanceSessionType.NIGHT,
          title: `Session ${i}`,
          attendanceDate: new Date(`2026-09-${String(i).padStart(2, '0')}T00:00:00.000Z`),
          status: AttendanceSessionStatus.CLOSED,
          startTime: new Date(`2026-09-${String(i).padStart(2, '0')}T21:00:00.000Z`),
          createdByUserId: userWardenA1Id,
        },
      });

      const isPresent = i <= 18;
      await testPrisma.attendanceRecord.create({
        data: {
          attendanceSessionId: session.id,
          residentId: resident.id,
          status: isPresent ? AttendanceRecordStatus.PRESENT : AttendanceRecordStatus.ABSENT,
          markMethod: isPresent ? AttendanceMarkMethod.FACE_RECOGNITION : AttendanceMarkMethod.SYSTEM,
        },
      });
    }

    const res = await request(app)
      .get(`/api/v1/reports/residents/${resident.id}/attendance`)
      .set('Authorization', `Bearer ${wardenA1Token}`);

    expect(res.status).toBe(200);
    expect(res.body.totalSessions).toBe(20);
    expect(res.body.presentSessions).toBe(18);
    expect(res.body.absentSessions).toBe(2);
    expect(res.body.attendanceRate).toBe(90);
    expect(res.body.records).toHaveLength(20);
  });

  // ----------------------------------------------------
  // Requirement 64: TEST — CURRENT PRESENCE
  // Fixture: 6 IN, 4 OUT from ResidentPresence
  // ----------------------------------------------------
  it('64: derives current presence directly from ResidentPresence (6 IN, 4 OUT)', async () => {
    for (let i = 1; i <= 10; i++) {
      const resident = await testPrisma.resident.create({
        data: {
          organizationId: orgAId,
          hostelId: hostelA1Id,
          residentCode: `R_PRES_${i}`,
          fullName: `Presence Res ${i}`,
          roomGroup: `P-${i}`,
          status: ResidentStatus.ACTIVE,
        },
      });

      const isInside = i <= 6;
      await testPrisma.residentPresence.create({
        data: {
          residentId: resident.id,
          hostelId: hostelA1Id,
          currentState: isInside ? PresenceState.IN : PresenceState.OUT,
          lastMovementType: isInside ? MovementType.IN : MovementType.OUT,
          lastMovementTime: new Date(),
        },
      });
    }

    const res = await request(app)
      .get(`/api/v1/reports/presence?hostelId=${hostelA1Id}`)
      .set('Authorization', `Bearer ${wardenA1Token}`);

    expect(res.status).toBe(200);
    expect(res.body.insideCount).toBe(6);
    expect(res.body.outsideCount).toBe(4);
    expect(res.body.totalResidents).toBe(10);
    expect(res.body.insideRate).toBe(60);
    expect(res.body.outsideRate).toBe(40);

    // Also check currently outside endpoint
    const outRes = await request(app)
      .get(`/api/v1/reports/presence/outside?hostelId=${hostelA1Id}`)
      .set('Authorization', `Bearer ${wardenA1Token}`);

    expect(outRes.status).toBe(200);
    expect(outRes.body.total).toBe(4);
    expect(outRes.body.data).toHaveLength(4);
    expect(outRes.body.data[0].direction).toBe('OUT');
  });

  // ----------------------------------------------------
  // Requirement 65 & 66: TEST — MOVEMENT FILTER & PAGINATION
  // Fixtures with IN/OUT across dates/cameras, pagination total/totalPages
  // ----------------------------------------------------
  it('65 & 66: verifies movement filters and server-side pagination', async () => {
    const resA = await testPrisma.resident.create({
      data: {
        organizationId: orgAId,
        hostelId: hostelA1Id,
        residentCode: 'R_MOV_A',
        fullName: 'Movement Filter Resident',
        roomGroup: 'M-101',
        status: ResidentStatus.ACTIVE,
      },
    });

    const cam1 = await testPrisma.camera.create({
      data: {
        organizationId: orgAId,
        hostelId: hostelA1Id,
        name: 'Main Ingress Gate',
        sourceType: 'WEBCAM',
      },
    });

    // Create 25 movement events
    for (let i = 1; i <= 25; i++) {
      await testPrisma.movementEvent.create({
        data: {
          residentId: resA.id,
          hostelId: hostelA1Id,
          cameraId: cam1.id,
          movementType: i % 2 === 0 ? MovementType.IN : MovementType.OUT,
          source: MovementSource.FACE_RECOGNITION,
          effectiveTimestamp: new Date(`2026-09-30T10:${String(i).padStart(2, '0')}:00.000Z`),
        },
      });
    }

    // 1. Pagination check (page 1, pageSize 10)
    const p1 = await request(app)
      .get(`/api/v1/reports/movements?hostelId=${hostelA1Id}&page=1&pageSize=10`)
      .set('Authorization', `Bearer ${wardenA1Token}`);

    expect(p1.status).toBe(200);
    expect(p1.body.data).toHaveLength(10);
    expect(p1.body.total).toBe(25);
    expect(p1.body.page).toBe(1);
    expect(p1.body.pageSize).toBe(10);
    expect(p1.body.totalPages).toBe(3);

    // 2. Filter by direction=IN (should have 12 IN events)
    const inFilter = await request(app)
      .get(`/api/v1/reports/movements?hostelId=${hostelA1Id}&direction=IN&pageSize=50`)
      .set('Authorization', `Bearer ${wardenA1Token}`);

    expect(inFilter.status).toBe(200);
    expect(inFilter.body.total).toBe(12);
    expect(inFilter.body.data.every((e: any) => e.direction === 'IN')).toBe(true);

    // 3. Filter by search
    const searchFilter = await request(app)
      .get(`/api/v1/reports/movements?hostelId=${hostelA1Id}&search=R_MOV_A`)
      .set('Authorization', `Bearer ${wardenA1Token}`);

    expect(searchFilter.status).toBe(200);
    expect(searchFilter.body.total).toBe(25);
  });

  // ----------------------------------------------------
  // Requirement 67: TEST — WARDEN SCOPE
  // Warden A1 queries Hostel A2 report -> 404 (non-leaking)
  // ----------------------------------------------------
  it('67: returns non-leaking 404 when Warden A1 queries Hostel A2 reports', async () => {
    const resAtt = await request(app)
      .get(`/api/v1/reports/attendance?hostelId=${hostelA2Id}`)
      .set('Authorization', `Bearer ${wardenA1Token}`);
    expect(resAtt.status).toBe(404);

    const resMov = await request(app)
      .get(`/api/v1/reports/movements?hostelId=${hostelA2Id}`)
      .set('Authorization', `Bearer ${wardenA1Token}`);
    expect(resMov.status).toBe(404);

    const resPres = await request(app)
      .get(`/api/v1/reports/presence?hostelId=${hostelA2Id}`)
      .set('Authorization', `Bearer ${wardenA1Token}`);
    expect(resPres.status).toBe(404);
  });

  // ----------------------------------------------------
  // Requirement 68: TEST — ORGANIZATION SCOPE
  // Admin of Org A queries Org B records -> 404
  // ----------------------------------------------------
  it('68: returns 404 when Admin Org A attempts to query Org B hostel', async () => {
    const res = await request(app)
      .get(`/api/v1/reports/attendance?hostelId=${hostelBId}`)
      .set('Authorization', `Bearer ${adminAToken}`);
    expect(res.status).toBe(404);

    const resMov = await request(app)
      .get(`/api/v1/reports/movements?hostelId=${hostelBId}`)
      .set('Authorization', `Bearer ${adminAToken}`);
    expect(resMov.status).toBe(404);
  });

  // ----------------------------------------------------
  // Requirement 69: TEST — GUARD PERMISSIONS
  // Guard can access presence and movements, but blocked (403) from trends, resident summaries, and exports
  // ----------------------------------------------------
  it('69: enforces Guard least privilege policy (presence/movements allowed, trends/resident/export forbidden 403)', async () => {
    // 1. Allowed: presence
    const presRes = await request(app)
      .get(`/api/v1/reports/presence`)
      .set('Authorization', `Bearer ${guardA1Token}`);
    expect(presRes.status).toBe(200);

    // 2. Allowed: movements
    const movRes = await request(app)
      .get(`/api/v1/reports/movements`)
      .set('Authorization', `Bearer ${guardA1Token}`);
    expect(movRes.status).toBe(200);

    // 3. Forbidden: attendance trends -> 403
    const trendRes = await request(app)
      .get(`/api/v1/reports/attendance/trend`)
      .set('Authorization', `Bearer ${guardA1Token}`);
    expect(trendRes.status).toBe(403);

    // 4. Forbidden: resident summary -> 403
    const resSummary = await request(app)
      .get(`/api/v1/reports/residents/dummy-id/attendance`)
      .set('Authorization', `Bearer ${guardA1Token}`);
    expect(resSummary.status).toBe(403);

    // 5. Forbidden: CSV export -> 403
    const exportRes = await request(app)
      .get(`/api/v1/reports/export/attendance`)
      .set('Authorization', `Bearer ${guardA1Token}`);
    expect(exportRes.status).toBe(403);
  });

  // ----------------------------------------------------
  // Requirement 70 & 71: TEST — CSV EXPORT & FORMULA INJECTION PROTECTION
  // Verify headers, rows, UTF-8 BOM, and formula escaping for = + - @
  // ----------------------------------------------------
  it('70 & 71: generates CSV export and sanitizes formula injection triggers (=, +, -, @)', async () => {
    const injectionResident = await testPrisma.resident.create({
      data: {
        organizationId: orgAId,
        hostelId: hostelA1Id,
        residentCode: '=CMD|calc',
        fullName: '@JohnDoe',
        roomGroup: '+101',
        status: ResidentStatus.ACTIVE,
      },
    });

    const session = await testPrisma.attendanceSession.create({
      data: {
        organizationId: orgAId,
        hostelId: hostelA1Id,
        sessionType: AttendanceSessionType.NIGHT,
        title: 'Formula Test Session',
        attendanceDate: new Date('2026-09-30T00:00:00.000Z'),
        status: AttendanceSessionStatus.CLOSED,
        startTime: new Date('2026-09-30T21:00:00.000Z'),
        createdByUserId: userWardenA1Id,
      },
    });

    await testPrisma.attendanceRecord.create({
      data: {
        attendanceSessionId: session.id,
        residentId: injectionResident.id,
        status: AttendanceRecordStatus.PRESENT,
        markMethod: AttendanceMarkMethod.FACE_RECOGNITION,
      },
    });

    const res = await request(app)
      .get(`/api/v1/reports/export/attendance?hostelId=${hostelA1Id}`)
      .set('Authorization', `Bearer ${wardenA1Token}`);

    expect(res.status).toBe(200);
    expect(res.header['content-type']).toContain('text/csv');
    const csv = res.text;

    // Must start with UTF-8 BOM \uFEFF
    expect(csv.charCodeAt(0)).toBe(0xfeff);

    // Verify headers
    expect(csv).toContain('Date,Session,Resident Code,Resident Name,Room,Status,Marked At,Method,Correction');

    // Verify formula characters were sanitized by prepending single quote '
    expect(csv).toContain("'=CMD|calc");
    expect(csv).toContain("'@JohnDoe");
    expect(csv).toContain("'+101");
  });

  // ----------------------------------------------------
  // Requirement 72: TEST — NO BIOMETRICS
  // Report API responses and CSV must never return embedding, template, similarity, faceCrop, vector
  // ----------------------------------------------------
  it('72: proves report API responses and CSV outputs NEVER leak biometric templates or similarity scores', async () => {
    const resAtt = await request(app)
      .get(`/api/v1/reports/attendance?hostelId=${hostelA1Id}`)
      .set('Authorization', `Bearer ${wardenA1Token}`);

    const resMov = await request(app)
      .get(`/api/v1/reports/movements?hostelId=${hostelA1Id}`)
      .set('Authorization', `Bearer ${wardenA1Token}`);

    const resExport = await request(app)
      .get(`/api/v1/reports/export/attendance?hostelId=${hostelA1Id}`)
      .set('Authorization', `Bearer ${wardenA1Token}`);

    const serializedPayloads = [
      JSON.stringify(resAtt.body),
      JSON.stringify(resMov.body),
      resExport.text,
    ];

    const forbiddenTerms = [
      'embedding',
      'template',
      'similarity',
      'faceCrop',
      'vector',
      'secondBestSimilarity',
      'passwordHash',
    ];

    for (const text of serializedPayloads) {
      for (const term of forbiddenTerms) {
        expect(text.toLowerCase()).not.toContain(term.toLowerCase());
      }
    }
  });

  // ----------------------------------------------------
  // Requirement 73: TEST — REPORT READ-ONLY
  // Proves generating reports does not mutate AttendanceRecord, MovementEvent, or ResidentPresence
  // ----------------------------------------------------
  it('73: ensures report generation is strictly read-only and causes zero mutations', async () => {
    const resident = await testPrisma.resident.create({
      data: {
        organizationId: orgAId,
        hostelId: hostelA1Id,
        residentCode: 'R_RO_1',
        fullName: 'Read Only Resident',
        roomGroup: 'R-1',
        status: ResidentStatus.ACTIVE,
      },
    });

    await testPrisma.residentPresence.create({
      data: {
        residentId: resident.id,
        hostelId: hostelA1Id,
        currentState: PresenceState.IN,
      },
    });

    // Capture counts before
    const attCountBefore = await testPrisma.attendanceRecord.count();
    const movCountBefore = await testPrisma.movementEvent.count();
    const presBefore = await testPrisma.residentPresence.findMany();

    // Run report endpoints
    await request(app)
      .get(`/api/v1/reports/attendance?hostelId=${hostelA1Id}`)
      .set('Authorization', `Bearer ${wardenA1Token}`);

    await request(app)
      .get(`/api/v1/reports/movements?hostelId=${hostelA1Id}`)
      .set('Authorization', `Bearer ${wardenA1Token}`);

    await request(app)
      .get(`/api/v1/reports/presence?hostelId=${hostelA1Id}`)
      .set('Authorization', `Bearer ${wardenA1Token}`);

    await request(app)
      .get(`/api/v1/reports/export/attendance?hostelId=${hostelA1Id}`)
      .set('Authorization', `Bearer ${wardenA1Token}`);

    // Verify counts and states unchanged
    const attCountAfter = await testPrisma.attendanceRecord.count();
    const movCountAfter = await testPrisma.movementEvent.count();
    const presAfter = await testPrisma.residentPresence.findMany();

    expect(attCountAfter).toBe(attCountBefore);
    expect(movCountAfter).toBe(movCountBefore);
    expect(presAfter).toEqual(presBefore);
  });

  // ----------------------------------------------------
  // Session Roster Filtering & Search
  // ----------------------------------------------------
  it('allows filtering session roster by status and searching by resident name', async () => {
    const resA = await testPrisma.resident.create({
      data: {
        organizationId: orgAId,
        hostelId: hostelA1Id,
        residentCode: 'R_ROST_A',
        fullName: 'Aarav Sharma',
        roomGroup: 'A-201',
        status: ResidentStatus.ACTIVE,
      },
    });

    const resB = await testPrisma.resident.create({
      data: {
        organizationId: orgAId,
        hostelId: hostelA1Id,
        residentCode: 'R_ROST_B',
        fullName: 'Bhavin Patel',
        roomGroup: 'A-202',
        status: ResidentStatus.ACTIVE,
      },
    });

    const session = await testPrisma.attendanceSession.create({
      data: {
        organizationId: orgAId,
        hostelId: hostelA1Id,
        sessionType: AttendanceSessionType.NIGHT,
        title: 'Roster Filter Test',
        attendanceDate: new Date('2026-09-30T00:00:00.000Z'),
        status: AttendanceSessionStatus.CLOSED,
        startTime: new Date('2026-09-30T21:00:00.000Z'),
        createdByUserId: userWardenA1Id,
      },
    });

    await testPrisma.attendanceRecord.create({
      data: {
        attendanceSessionId: session.id,
        residentId: resA.id,
        status: AttendanceRecordStatus.PRESENT,
        markMethod: AttendanceMarkMethod.FACE_RECOGNITION,
      },
    });

    await testPrisma.attendanceRecord.create({
      data: {
        attendanceSessionId: session.id,
        residentId: resB.id,
        status: AttendanceRecordStatus.ABSENT,
        markMethod: AttendanceMarkMethod.SYSTEM,
      },
    });

    // 1. Status filter: PRESENT
    const resPresent = await request(app)
      .get(`/api/v1/reports/attendance/sessions/${session.id}?status=PRESENT`)
      .set('Authorization', `Bearer ${wardenA1Token}`);

    expect(resPresent.status).toBe(200);
    expect(resPresent.body.roster).toHaveLength(1);
    expect(resPresent.body.roster[0].residentCode).toBe('R_ROST_A');

    // 2. Search filter: "Bhavin"
    const resSearch = await request(app)
      .get(`/api/v1/reports/attendance/sessions/${session.id}?search=Bhavin`)
      .set('Authorization', `Bearer ${wardenA1Token}`);

    expect(resSearch.status).toBe(200);
    expect(resSearch.body.roster).toHaveLength(1);
    expect(resSearch.body.roster[0].residentCode).toBe('R_ROST_B');
  });

  // ----------------------------------------------------
  // Historical Inactive Resident Preservation (Requirement 37)
  // ----------------------------------------------------
  it('37: preserves historical attendance and movement records for deactivated residents', async () => {
    const deactResident = await testPrisma.resident.create({
      data: {
        organizationId: orgAId,
        hostelId: hostelA1Id,
        residentCode: 'R_DEACT_HIST',
        fullName: 'Historical Deactivated Resident',
        roomGroup: 'D-404',
        status: ResidentStatus.INACTIVE,
      },
    });

    const session = await testPrisma.attendanceSession.create({
      data: {
        organizationId: orgAId,
        hostelId: hostelA1Id,
        sessionType: AttendanceSessionType.NIGHT,
        title: 'Past Closed Session',
        attendanceDate: new Date('2026-09-20T00:00:00.000Z'),
        status: AttendanceSessionStatus.CLOSED,
        startTime: new Date('2026-09-20T21:00:00.000Z'),
        createdByUserId: userWardenA1Id,
      },
    });

    await testPrisma.attendanceRecord.create({
      data: {
        attendanceSessionId: session.id,
        residentId: deactResident.id,
        status: AttendanceRecordStatus.PRESENT,
        markMethod: AttendanceMarkMethod.FACE_RECOGNITION,
      },
    });

    const res = await request(app)
      .get(`/api/v1/reports/attendance/sessions/${session.id}`)
      .set('Authorization', `Bearer ${wardenA1Token}`);

    expect(res.status).toBe(200);
    expect(res.body.roster.some((r: any) => r.residentCode === 'R_DEACT_HIST')).toBe(true);
  });

  // ----------------------------------------------------
  // Movement CSV Export
  // ----------------------------------------------------
  it('exports movement CSV with headers and formatted timestamps', async () => {
    const resident = await testPrisma.resident.create({
      data: {
        organizationId: orgAId,
        hostelId: hostelA1Id,
        residentCode: 'R_MOV_CSV',
        fullName: 'Movement Export Resident',
        roomGroup: 'E-505',
        status: ResidentStatus.ACTIVE,
      },
    });

    await testPrisma.movementEvent.create({
      data: {
        residentId: resident.id,
        hostelId: hostelA1Id,
        movementType: MovementType.IN,
        source: MovementSource.FACE_RECOGNITION,
        effectiveTimestamp: new Date('2026-09-30T10:30:00.000Z'),
      },
    });

    const res = await request(app)
      .get(`/api/v1/reports/export/movements?hostelId=${hostelA1Id}`)
      .set('Authorization', `Bearer ${wardenA1Token}`);

    expect(res.status).toBe(200);
    expect(res.header['content-type']).toContain('text/csv');
    expect(res.text).toContain('Timestamp,Resident Code,Resident Name,Room,Direction,Gate,Source,Is Correction');
    expect(res.text).toContain('R_MOV_CSV');
    expect(res.text).toContain('Movement Export Resident');
  });

  // ----------------------------------------------------
  // Full Resident Summary Endpoint
  // ----------------------------------------------------
  it('returns combined resident summary report with attendance and movement counts', async () => {
    const resident = await testPrisma.resident.create({
      data: {
        organizationId: orgAId,
        hostelId: hostelA1Id,
        residentCode: 'R_FULL_SUM',
        fullName: 'Consolidated Summary Resident',
        roomGroup: 'F-606',
        status: ResidentStatus.ACTIVE,
      },
    });

    await testPrisma.residentPresence.create({
      data: {
        residentId: resident.id,
        hostelId: hostelA1Id,
        currentState: PresenceState.IN,
        lastMovementType: MovementType.IN,
        lastMovementTime: new Date(),
      },
    });

    const res = await request(app)
      .get(`/api/v1/reports/residents/${resident.id}/summary`)
      .set('Authorization', `Bearer ${wardenA1Token}`);

    expect(res.status).toBe(200);
    expect(res.body.residentCode).toBe('R_FULL_SUM');
    expect(res.body.currentPresence).toBe('IN');
    expect(res.body.attendanceRate).toBe(0);
    expect(res.body.totalAttendanceSessions).toBe(0);
  });

  // ----------------------------------------------------
  // Step 09.1 Hardening Tests: Authoritative Server-side Summary
  // ----------------------------------------------------
  describe('Step 09.1: Authoritative Server-Side Attendance Summary & Pagination Independence', () => {
    it('computes summary across 25 sessions and returns identical summary on page 1 and page 2', async () => {
      // Create 2 test residents
      const r1 = await testPrisma.resident.create({
        data: {
          organizationId: orgAId,
          hostelId: hostelA1Id,
          residentCode: 'R_PAG_1',
          fullName: 'Pag Resident 1',
          roomGroup: 'P-1',
          status: ResidentStatus.ACTIVE,
        },
      });
      const r2 = await testPrisma.resident.create({
        data: {
          organizationId: orgAId,
          hostelId: hostelA1Id,
          residentCode: 'R_PAG_2',
          fullName: 'Pag Resident 2',
          roomGroup: 'P-2',
          status: ResidentStatus.ACTIVE,
        },
      });

      // Create 25 closed sessions, each with 1 PRESENT and 1 ABSENT
      for (let i = 1; i <= 25; i++) {
        const dayStr = i < 10 ? `0${i}` : `${i}`;
        const session = await testPrisma.attendanceSession.create({
          data: {
            organizationId: orgAId,
            hostelId: hostelA1Id,
            sessionType: AttendanceSessionType.NIGHT,
            title: `Night Attendance Session ${i}`,
            attendanceDate: new Date(`2026-08-${dayStr}T00:00:00.000Z`),
            status: AttendanceSessionStatus.CLOSED,
            startTime: new Date(`2026-08-${dayStr}T21:00:00.000Z`),
            endTime: new Date(`2026-08-${dayStr}T22:00:00.000Z`),
            createdByUserId: userWardenA1Id,
          },
        });

        await testPrisma.attendanceRecord.createMany({
          data: [
            {
              attendanceSessionId: session.id,
              residentId: r1.id,
              status: AttendanceRecordStatus.PRESENT,
              markMethod: AttendanceMarkMethod.FACE_RECOGNITION,
            },
            {
              attendanceSessionId: session.id,
              residentId: r2.id,
              status: AttendanceRecordStatus.ABSENT,
              markMethod: AttendanceMarkMethod.SYSTEM,
            },
          ],
        });
      }

      // Query Page 1 with pageSize = 10
      const page1Res = await request(app)
        .get(`/api/v1/reports/attendance?hostelId=${hostelA1Id}&dateFrom=2026-08-01T00:00:00.000Z&dateTo=2026-08-30T00:00:00.000Z&page=1&pageSize=10`)
        .set('Authorization', `Bearer ${wardenA1Token}`);

      expect(page1Res.status).toBe(200);
      expect(page1Res.body.data).toHaveLength(10);
      expect(page1Res.body.total).toBe(25);
      expect(page1Res.body.totalPages).toBe(3);
      expect(page1Res.body.summary).toEqual({
        sessions: 25,
        closedSessions: 25,
        present: 25,
        absent: 25,
        expected: 50,
        attendanceRate: 50,
      });

      // Query Page 2 with pageSize = 10
      const page2Res = await request(app)
        .get(`/api/v1/reports/attendance?hostelId=${hostelA1Id}&dateFrom=2026-08-01T00:00:00.000Z&dateTo=2026-08-30T00:00:00.000Z&page=2&pageSize=10`)
        .set('Authorization', `Bearer ${wardenA1Token}`);

      expect(page2Res.status).toBe(200);
      expect(page2Res.body.data).toHaveLength(10);
      expect(page2Res.body.total).toBe(25);
      // Different page data rows
      expect(page2Res.body.data[0].id).not.toBe(page1Res.body.data[0].id);
      // Summary MUST remain identical
      expect(page2Res.body.summary).toEqual(page1Res.body.summary);
    });

    it('closed sessions only for finalized rate: active sessions do NOT affect summary rate or present/absent', async () => {
      // Create residents for Closed Session 1 (100 residents: 90 present, 10 absent)
      const resSession1 = [];
      for (let i = 1; i <= 100; i++) {
        const res = await testPrisma.resident.create({
          data: {
            organizationId: orgAId,
            hostelId: hostelA1Id,
            residentCode: `R_C1_${i}`,
            fullName: `C1 Resident ${i}`,
            roomGroup: 'C1',
            status: ResidentStatus.ACTIVE,
          },
        });
        resSession1.push(res);
      }

      // Create residents for Closed Session 2 (10 residents: 5 present, 5 absent)
      const resSession2 = [];
      for (let i = 1; i <= 10; i++) {
        const res = await testPrisma.resident.create({
          data: {
            organizationId: orgAId,
            hostelId: hostelA1Id,
            residentCode: `R_C2_${i}`,
            fullName: `C2 Resident ${i}`,
            roomGroup: 'C2',
            status: ResidentStatus.ACTIVE,
          },
        });
        resSession2.push(res);
      }

      // Create residents for Active Session (10 residents: 10 present, 0 absent)
      const resSessionActive = [];
      for (let i = 1; i <= 10; i++) {
        const res = await testPrisma.resident.create({
          data: {
            organizationId: orgAId,
            hostelId: hostelA1Id,
            residentCode: `R_ACT_${i}`,
            fullName: `Active Resident ${i}`,
            roomGroup: 'ACT',
            status: ResidentStatus.ACTIVE,
          },
        });
        resSessionActive.push(res);
      }

      // Closed Session 1
      const closed1 = await testPrisma.attendanceSession.create({
        data: {
          organizationId: orgAId,
          hostelId: hostelA1Id,
          sessionType: AttendanceSessionType.NIGHT,
          title: 'Closed Session 1',
          attendanceDate: new Date('2026-07-01T00:00:00.000Z'),
          status: AttendanceSessionStatus.CLOSED,
          startTime: new Date('2026-07-01T21:00:00.000Z'),
          endTime: new Date('2026-07-01T22:00:00.000Z'),
          createdByUserId: userWardenA1Id,
        },
      });
      const records1 = [];
      for (let i = 0; i < 90; i++) {
        records1.push({
          attendanceSessionId: closed1.id,
          residentId: resSession1[i].id,
          status: AttendanceRecordStatus.PRESENT,
          markMethod: AttendanceMarkMethod.FACE_RECOGNITION,
        });
      }
      for (let i = 90; i < 100; i++) {
        records1.push({
          attendanceSessionId: closed1.id,
          residentId: resSession1[i].id,
          status: AttendanceRecordStatus.ABSENT,
          markMethod: AttendanceMarkMethod.SYSTEM,
        });
      }
      await testPrisma.attendanceRecord.createMany({ data: records1 });

      // Closed Session 2
      const closed2 = await testPrisma.attendanceSession.create({
        data: {
          organizationId: orgAId,
          hostelId: hostelA1Id,
          sessionType: AttendanceSessionType.NIGHT,
          title: 'Closed Session 2',
          attendanceDate: new Date('2026-07-02T00:00:00.000Z'),
          status: AttendanceSessionStatus.CLOSED,
          startTime: new Date('2026-07-02T21:00:00.000Z'),
          endTime: new Date('2026-07-02T22:00:00.000Z'),
          createdByUserId: userWardenA1Id,
        },
      });
      const records2 = [];
      for (let i = 0; i < 5; i++) {
        records2.push({
          attendanceSessionId: closed2.id,
          residentId: resSession2[i].id,
          status: AttendanceRecordStatus.PRESENT,
          markMethod: AttendanceMarkMethod.FACE_RECOGNITION,
        });
      }
      for (let i = 5; i < 10; i++) {
        records2.push({
          attendanceSessionId: closed2.id,
          residentId: resSession2[i].id,
          status: AttendanceRecordStatus.ABSENT,
          markMethod: AttendanceMarkMethod.SYSTEM,
        });
      }
      await testPrisma.attendanceRecord.createMany({ data: records2 });

      // Active Session
      const activeSession = await testPrisma.attendanceSession.create({
        data: {
          organizationId: orgAId,
          hostelId: hostelA1Id,
          sessionType: AttendanceSessionType.NIGHT,
          title: 'Active Session',
          attendanceDate: new Date('2026-07-03T00:00:00.000Z'),
          status: AttendanceSessionStatus.ACTIVE,
          startTime: new Date('2026-07-03T21:00:00.000Z'),
          createdByUserId: userWardenA1Id,
        },
      });
      const recordsActive = [];
      for (let i = 0; i < 10; i++) {
        recordsActive.push({
          attendanceSessionId: activeSession.id,
          residentId: resSessionActive[i].id,
          status: AttendanceRecordStatus.PRESENT,
          markMethod: AttendanceMarkMethod.FACE_RECOGNITION,
        });
      }
      await testPrisma.attendanceRecord.createMany({ data: recordsActive });

      const res = await request(app)
        .get(`/api/v1/reports/attendance?hostelId=${hostelA1Id}&dateFrom=2026-07-01T00:00:00.000Z&dateTo=2026-07-04T00:00:00.000Z`)
        .set('Authorization', `Bearer ${wardenA1Token}`);

      expect(res.status).toBe(200);
      expect(res.body.total).toBe(3); // 3 total sessions in filter
      expect(res.body.summary).toEqual({
        sessions: 3,
        closedSessions: 2,
        present: 95,
        absent: 15,
        expected: 110,
        attendanceRate: 86, // 95 / 110 = 86.36% -> 86%
      });
    });

    it('returns zeroed summary without dividing by zero when no closed sessions exist', async () => {
      // Create an active session with no closed sessions
      await testPrisma.attendanceSession.create({
        data: {
          organizationId: orgAId,
          hostelId: hostelA1Id,
          sessionType: AttendanceSessionType.NIGHT,
          title: 'Only Active Session',
          attendanceDate: new Date('2026-06-01T00:00:00.000Z'),
          status: AttendanceSessionStatus.ACTIVE,
          startTime: new Date('2026-06-01T21:00:00.000Z'),
          createdByUserId: userWardenA1Id,
        },
      });

      const res = await request(app)
        .get(`/api/v1/reports/attendance?hostelId=${hostelA1Id}&dateFrom=2026-06-01T00:00:00.000Z&dateTo=2026-06-02T00:00:00.000Z`)
        .set('Authorization', `Bearer ${wardenA1Token}`);

      expect(res.status).toBe(200);
      expect(res.body.total).toBe(1);
      expect(res.body.summary).toEqual({
        sessions: 1,
        closedSessions: 0,
        present: 0,
        absent: 0,
        expected: 0,
        attendanceRate: 0,
      });
    });

    it('ensures date filters apply consistently to both table rows and server summary', async () => {
      // Session outside date range
      await testPrisma.attendanceSession.create({
        data: {
          organizationId: orgAId,
          hostelId: hostelA1Id,
          sessionType: AttendanceSessionType.NIGHT,
          title: 'May Old Session',
          attendanceDate: new Date('2026-05-01T00:00:00.000Z'),
          status: AttendanceSessionStatus.CLOSED,
          startTime: new Date('2026-05-01T21:00:00.000Z'),
          endTime: new Date('2026-05-01T22:00:00.000Z'),
          createdByUserId: userWardenA1Id,
        },
      });

      // Session inside date range
      await testPrisma.attendanceSession.create({
        data: {
          organizationId: orgAId,
          hostelId: hostelA1Id,
          sessionType: AttendanceSessionType.NIGHT,
          title: 'May Filtered Session',
          attendanceDate: new Date('2026-05-15T00:00:00.000Z'),
          status: AttendanceSessionStatus.CLOSED,
          startTime: new Date('2026-05-15T21:00:00.000Z'),
          endTime: new Date('2026-05-15T22:00:00.000Z'),
          createdByUserId: userWardenA1Id,
        },
      });

      const res = await request(app)
        .get(`/api/v1/reports/attendance?hostelId=${hostelA1Id}&dateFrom=2026-05-10T00:00:00.000Z&dateTo=2026-05-20T00:00:00.000Z`)
        .set('Authorization', `Bearer ${wardenA1Token}`);

      expect(res.status).toBe(200);
      expect(res.body.total).toBe(1);
      expect(res.body.summary.sessions).toBe(1);
      expect(res.body.summary.closedSessions).toBe(1);
      expect(res.body.data).toHaveLength(1);
      expect(res.body.data[0].title).toBe('May Filtered Session');
    });
  });
});
