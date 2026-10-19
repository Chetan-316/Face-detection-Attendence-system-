import { PrismaClient } from '@prisma/client';
import { runSeed } from '../prisma/seed';
import { assertEmptyForSeed, assertSafeSeedTarget } from './lib/safe-seed-guard';

async function main() {
  const target = assertSafeSeedTarget(process.env);
  console.log(`[PRAVAHAx Deploy] Seed target database: ${target.dbName}`);

  const db = new PrismaClient({ datasources: { db: { url: target.databaseUrl } } });
  try {
    const userCount = await db.user.count();
    if (userCount > 0) {
      console.log(`[PRAVAHAx Deploy] Database already initialized (${userCount} users present). Skipping seed.`);
      return;
    }

    const [organization, hostel, resident, movementEvent, attendanceRecord, camera, auditLog] = await Promise.all([
      db.organization.count(),
      db.hostel.count(),
      db.resident.count(),
      db.movementEvent.count(),
      db.attendanceRecord.count(),
      db.camera.count(),
      db.auditLog.count(),
    ]);
    assertEmptyForSeed({ organization, hostel, resident, movementEvent, attendanceRecord, camera, auditLog });

    console.log('[PRAVAHAx Deploy] Empty database detected. Seeding initial institutions, users, and rooms...');
    await runSeed({ db, databaseUrl: target.databaseUrl, allowDestructive: true });
    console.log('[PRAVAHAx Deploy] Initial seed completed successfully.');
  } finally {
    await db.$disconnect();
  }
}

main().catch((err) => {
  console.error('[PRAVAHAx Deploy] Safe seed failed:', err);
  process.exitCode = 1;
});
