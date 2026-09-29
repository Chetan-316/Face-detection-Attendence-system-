import { PrismaClient } from '@prisma/client';
import { config } from '../../src/config';

// Always use test database URL for tests
export const testPrisma = new PrismaClient({
  datasources: {
    db: {
      url: config.testDatabaseUrl,
    },
  },
  log: ['error'],
});

export async function resetTestDatabase(): Promise<void> {
  // Truncate/delete all tables in test database in reverse dependency order
  await testPrisma.auditLog.deleteMany();
  await testPrisma.attendanceRecord.deleteMany();
  await testPrisma.attendanceSession.deleteMany();
  await testPrisma.movementCorrection.deleteMany();
  await testPrisma.residentPresence.deleteMany();
  await testPrisma.movementEvent.deleteMany();
  await testPrisma.faceProfile.deleteMany();
  await testPrisma.resident.deleteMany();
  await testPrisma.camera.deleteMany();
  await testPrisma.location.deleteMany();
  await testPrisma.user.deleteMany();
  await testPrisma.hostel.deleteMany();
  await testPrisma.organization.deleteMany();
}
