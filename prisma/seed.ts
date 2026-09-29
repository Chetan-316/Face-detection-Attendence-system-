import {
  PrismaClient,
  StaffRole,
  UserStatus,
  ResidentStatus,
  FaceEnrollmentStatus,
  CameraSourceType,
  CameraRole,
  LocationType,
  PresenceState,
  MovementType,
  MovementSource,
} from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

export async function runSeed() {
  const env = process.env.APP_ENV || 'development';

  // Seed safety guards against accidental production destruction
  if (env === 'production') {
    throw new Error('SAFETY ERROR: Destructive database seed is prohibited in production environment.');
  }

  if (env !== 'development' && env !== 'test' && process.env.ALLOW_DESTRUCTIVE_SEED !== 'true') {
    throw new Error(
      `SAFETY ERROR: Destructive seed in '${env}' requires explicit ALLOW_DESTRUCTIVE_SEED=true.`
    );
  }

  console.log(`[PRAVAHAx] Seeding database in '${env}' mode...`);

  // Clean existing data for deterministic seed
  await prisma.auditLog.deleteMany();
  await prisma.attendanceRecord.deleteMany();
  await prisma.attendanceSession.deleteMany();
  await prisma.movementCorrection.deleteMany();
  await prisma.residentPresence.deleteMany();
  await prisma.movementEvent.deleteMany();
  await prisma.faceProfile.deleteMany();
  await prisma.resident.deleteMany();
  await prisma.camera.deleteMany();
  await prisma.location.deleteMany();
  await prisma.user.deleteMany();
  await prisma.hostel.deleteMany();
  await prisma.organization.deleteMany();

  // 1. Organization
  const org = await prisma.organization.create({
    data: {
      code: 'PRAVAHAX_DEMO',
      name: 'PRAVAHAx Demo Institution',
      isActive: true,
    },
  });
  console.log(`Created Organization: ${org.name} (${org.code})`);

  // 2. Hostel
  const hostel = await prisma.hostel.create({
    data: {
      organizationId: org.id,
      code: 'HOSTEL_A',
      name: 'Demo Hostel A',
      isActive: true,
    },
  });
  console.log(`Created Hostel: ${hostel.name} (${hostel.code})`);

  // 3. Location / Gate
  const location = await prisma.location.create({
    data: {
      hostelId: hostel.id,
      code: 'MAIN_GATE',
      name: 'Main Gate',
      locationType: LocationType.GATE,
      isActive: true,
    },
  });
  console.log(`Created Location: ${location.name} (${location.code})`);

  // 4. Camera (Laptop Webcam abstraction)
  const camera = await prisma.camera.create({
    data: {
      organizationId: org.id,
      hostelId: hostel.id,
      locationId: location.id,
      name: 'Laptop Webcam',
      sourceType: CameraSourceType.WEBCAM,
      role: CameraRole.GENERAL,
      isEnabled: true,
      configMetadata: {
        deviceIndex: 0,
        resolution: '1280x720',
      },
    },
  });
  console.log(`Created Camera: ${camera.name} (${camera.sourceType})`);

  // 5. Staff Users (Admin, Warden, Guard)
  // [LOCAL DEVELOPMENT / DEMO ONLY] credentials
  const defaultPassword = process.env.SEED_DEFAULT_PASSWORD || 'Password123!';
  const hashedPassword = await bcrypt.hash(defaultPassword, 10);

  const admin = await prisma.user.create({
    data: {
      organizationId: org.id,
      hostelId: hostel.id,
      username: 'admin',
      email: 'admin@pravahax.demo',
      fullName: 'System Administrator',
      passwordHash: hashedPassword,
      role: StaffRole.ADMIN,
      status: UserStatus.ACTIVE,
    },
  });

  const warden = await prisma.user.create({
    data: {
      organizationId: org.id,
      hostelId: hostel.id,
      username: 'warden',
      email: 'warden@pravahax.demo',
      fullName: 'Hostel Warden',
      passwordHash: hashedPassword,
      role: StaffRole.WARDEN,
      status: UserStatus.ACTIVE,
    },
  });

  const guard = await prisma.user.create({
    data: {
      organizationId: org.id,
      hostelId: hostel.id,
      username: 'guard',
      email: 'guard@pravahax.demo',
      fullName: 'Gate Guard',
      passwordHash: hashedPassword,
      role: StaffRole.GUARD,
      status: UserStatus.ACTIVE,
    },
  });
  console.log('Created Staff Users: admin, warden, guard [LOCAL DEVELOPMENT / DEMO ONLY]');

  // 6. Residents (R001 to R005) with predefined presence
  const residentsConfig = [
    { code: 'R001', name: 'Alex Kumar', room: 'Room 101', presence: PresenceState.IN, moveType: MovementType.IN, moveTime: new Date('2026-09-29T08:30:00Z') },
    { code: 'R002', name: 'Jordan Sharma', room: 'Room 102', presence: PresenceState.OUT, moveType: MovementType.OUT, moveTime: new Date('2026-09-29T07:30:00Z') },
    { code: 'R003', name: 'Morgan Patel', room: 'Room 103', presence: PresenceState.IN, moveType: MovementType.IN, moveTime: new Date('2026-09-29T08:45:00Z') },
    { code: 'R004', name: 'Taylor Singh', room: 'Room 104', presence: PresenceState.OUT, moveType: MovementType.OUT, moveTime: new Date('2026-09-29T18:00:00Z') },
    { code: 'R005', name: 'Casey Verma', room: 'Room 105', presence: PresenceState.IN, moveType: MovementType.IN, moveTime: new Date('2026-09-29T09:15:00Z') },
  ];

  for (const r of residentsConfig) {
    const resident = await prisma.resident.create({
      data: {
        organizationId: org.id,
        hostelId: hostel.id,
        residentCode: r.code,
        fullName: r.name,
        roomGroup: r.room,
        status: ResidentStatus.ACTIVE,
        faceEnrollmentStatus: FaceEnrollmentStatus.NOT_ENROLLED,
      },
    });

    // Create initial Movement Event
    const movement = await prisma.movementEvent.create({
      data: {
        residentId: resident.id,
        hostelId: hostel.id,
        locationId: location.id,
        cameraId: camera.id,
        movementType: r.moveType,
        source: MovementSource.GUARD_CONFIRMATION,
        effectiveTimestamp: r.moveTime,
        recordedTimestamp: r.moveTime,
        confirmedByUserId: guard.id,
        notes: 'Initial seed movement',
        isCorrection: false,
      },
    });

    // Set Current Presence State
    await prisma.residentPresence.create({
      data: {
        residentId: resident.id,
        hostelId: hostel.id,
        currentState: r.presence,
        lastMovementEventId: movement.id,
        lastMovementType: r.moveType,
        lastMovementTime: r.moveTime,
        lastUpdatedByUserId: guard.id,
      },
    });

    console.log(`Created Resident: ${r.code} - ${r.name} (Current Presence: ${r.presence})`);
  }

  // Initial Audit Log
  await prisma.auditLog.create({
    data: {
      organizationId: org.id,
      hostelId: hostel.id,
      entityType: 'SYSTEM',
      entityId: org.id,
      action: 'CREATE',
      performedByUserId: admin.id,
      performedByRole: StaffRole.ADMIN,
      reason: 'Initial database seed completed',
      newValues: {
        residentsCount: residentsConfig.length,
        organization: org.code,
        hostel: hostel.code,
      },
    },
  });

  console.log('Seed completed successfully!');
}

if (require.main === module) {
  runSeed()
    .catch((e) => {
      console.error('Seed failed:', e);
      process.exit(1);
    })
    .finally(async () => {
      await prisma.$disconnect();
    });
}
