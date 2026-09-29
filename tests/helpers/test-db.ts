import { PrismaClient } from '@prisma/client';
import { config } from '../../src/config';

export function verifyTestDatabaseSafety(testUrl: string, devUrl?: string): void {
  if (!testUrl) {
    throw new Error('SAFETY ERROR: TEST_DATABASE_URL is not set.');
  }

  const normalized = testUrl.toLowerCase();
  const isSafe = normalized.includes('test') || normalized.includes('pravahax_test_db');

  if (!isSafe) {
    throw new Error(
      `SAFETY ERROR: Refusing to connect tests to unsafe database URL '${testUrl}'. ` +
      `URL must explicitly contain 'test' or 'pravahax_test_db'.`
    );
  }

  if (devUrl && testUrl === devUrl) {
    throw new Error(
      'SAFETY ERROR: TEST_DATABASE_URL cannot be identical to DATABASE_URL. Tests would wipe application data.'
    );
  }
}

// Enforce safety immediately at import
verifyTestDatabaseSafety(config.testDatabaseUrl, config.databaseUrl);

// Always use verified test database URL for tests
export const testPrisma = new PrismaClient({
  datasources: {
    db: {
      url: config.testDatabaseUrl,
    },
  },
  log: ['error'],
});

export async function resetTestDatabase(): Promise<void> {
  // Second safety check before any deletion
  verifyTestDatabaseSafety(config.testDatabaseUrl, config.databaseUrl);

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
