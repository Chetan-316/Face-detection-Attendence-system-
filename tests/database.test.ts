import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { testPrisma, resetTestDatabase } from './helpers/test-db';
import {
  AttendanceSessionType,
  AttendanceRecordStatus,
  AttendanceMarkMethod,
  StaffRole,
  ResidentStatus,
  FaceEnrollmentStatus,
} from '@prisma/client';

describe('PostgreSQL Database Level Constraints Tests', () => {
  let orgId: string;
  let hostelId: string;
  let userId: string;

  beforeEach(async () => {
    await resetTestDatabase();

    const org = await testPrisma.organization.create({
      data: { code: 'DB_ORG', name: 'Database Test Org' },
    });
    orgId = org.id;

    const hostel = await testPrisma.hostel.create({
      data: { organizationId: org.id, code: 'DB_HOSTEL', name: 'Database Test Hostel' },
    });
    hostelId = hostel.id;

    const user = await testPrisma.user.create({
      data: {
        organizationId: org.id,
        hostelId: hostel.id,
        username: 'db_admin',
        fullName: 'DB Admin',
        passwordHash: 'dummy',
        role: StaffRole.ADMIN,
      },
    });
    userId = user.id;
  });

  afterAll(async () => {
    await testPrisma.$disconnect();
  });

  it('enforces composite uniqueness on (attendanceSessionId, residentId) at database level', async () => {
    const resident = await testPrisma.resident.create({
      data: {
        organizationId: orgId,
        hostelId: hostelId,
        residentCode: 'R_DB_1',
        fullName: 'DB Test Resident',
        roomGroup: '101',
        status: ResidentStatus.ACTIVE,
        faceEnrollmentStatus: FaceEnrollmentStatus.NOT_ENROLLED,
      },
    });

    const session = await testPrisma.attendanceSession.create({
      data: {
        organizationId: orgId,
        hostelId: hostelId,
        sessionType: AttendanceSessionType.GENERAL,
        title: 'Constraint Test Session',
        startTime: new Date(),
        createdByUserId: userId,
      },
    });

    // Insert first attendance record
    await testPrisma.attendanceRecord.create({
      data: {
        attendanceSessionId: session.id,
        residentId: resident.id,
        status: AttendanceRecordStatus.PRESENT,
        markMethod: AttendanceMarkMethod.MANUAL_STAFF,
      },
    });

    // Attempt second insert directly bypassing service layer -> PostgreSQL constraint MUST throw!
    await expect(
      testPrisma.attendanceRecord.create({
        data: {
          attendanceSessionId: session.id,
          residentId: resident.id,
          status: AttendanceRecordStatus.PRESENT,
          markMethod: AttendanceMarkMethod.FACE_RECOGNITION,
        },
      })
    ).rejects.toThrow();
  });

  it('enforces foreign key constraints preventing orphaned records at database level', async () => {
    // Attempt inserting resident with nonexistent hostelId
    await expect(
      testPrisma.resident.create({
        data: {
          organizationId: orgId,
          hostelId: '99999999-9999-9999-9999-999999999999', // Invalid FK
          residentCode: 'R_FK_FAIL',
          fullName: 'FK Fail Resident',
          roomGroup: '999',
        },
      })
    ).rejects.toThrow();
  });

  it('enforces unique resident code per organization at database level', async () => {
    await testPrisma.resident.create({
      data: {
        organizationId: orgId,
        hostelId: hostelId,
        residentCode: 'R_UNIQUE_CODE',
        fullName: 'First Resident',
        roomGroup: '101',
      },
    });

    await expect(
      testPrisma.resident.create({
        data: {
          organizationId: orgId,
          hostelId: hostelId,
          residentCode: 'R_UNIQUE_CODE',
          fullName: 'Duplicate Resident',
          roomGroup: '102',
        },
      })
    ).rejects.toThrow();
  });
});
