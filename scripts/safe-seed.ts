import { PrismaClient } from '@prisma/client';
import { runSeed } from '../prisma/seed';

const prisma = new PrismaClient();

async function main() {
  try {
    const userCount = await prisma.user.count();
    if (userCount > 0) {
      console.log(`[PRAVAHAx Deploy] Database already initialized (${userCount} users present). Skipping seed.`);
      return;
    }

    console.log('[PRAVAHAx Deploy] Empty database detected. Seeding initial institutions, users, and rooms...');
    process.env.ALLOW_DESTRUCTIVE_SEED = 'true';
    await runSeed();
    console.log('[PRAVAHAx Deploy] Initial seed completed successfully.');
  } catch (err) {
    console.error('[PRAVAHAx Deploy] Safe seed encountered an error:', err);
    // Don't fail the build if seed fails; application can still run
  } finally {
    await prisma.$disconnect();
  }
}

main();
