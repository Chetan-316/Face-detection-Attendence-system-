import { PrismaClient } from '@prisma/client';
import { runSeed } from '../prisma/seed';

const prisma = new PrismaClient();

async function main() {
  const env = process.env.APP_ENV || 'development';
  if (env === 'production') {
    throw new Error('[PRAVAHAx Deploy] Refusing to seed: APP_ENV is production.');
  }

  const userCount = await prisma.user.count();
  if (userCount > 0) {
    console.log(`[PRAVAHAx Deploy] Database already initialized (${userCount} users present). Skipping seed.`);
    return;
  }

  const [residentCount, movementCount, attendanceCount] = await Promise.all([
    prisma.resident.count(),
    prisma.movementEvent.count(),
    prisma.attendanceRecord.count(),
  ]);
  if (residentCount + movementCount + attendanceCount > 0) {
    throw new Error(
      '[PRAVAHAx Deploy] Refusing to seed: residents, movements or attendance rows exist without any users.'
    );
  }

  console.log('[PRAVAHAx Deploy] Empty database detected. Seeding initial institutions, users, and rooms...');
  process.env.ALLOW_DESTRUCTIVE_SEED = 'true';
  await runSeed();
  console.log('[PRAVAHAx Deploy] Initial seed completed successfully.');
}

main()
  .catch((err) => {
    console.error('[PRAVAHAx Deploy] Safe seed failed:', err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
