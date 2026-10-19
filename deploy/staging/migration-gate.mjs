// Refuses to migrate a database whose schema state is unknown, then runs each pending
// migration's read-only preflight.sql. Executed inside the API image from /app.
import { readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import pkg from '@prisma/client';

const { PrismaClient } = pkg;
const root = process.cwd();
const migrationsDir = join(root, 'prisma', 'migrations');
const prismaBin = join(root, 'node_modules', '.bin', 'prisma');
const schemaPath = join(root, 'prisma', 'schema.prisma');

const localMigrations = readdirSync(migrationsDir, { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name)
  .sort();

const prisma = new PrismaClient();

try {
  const tables = await prisma.$queryRaw`SELECT tablename FROM pg_tables WHERE schemaname = 'public'`;
  const tableNames = tables.map((row) => row.tablename);
  const userTables = tableNames.filter((name) => name !== '_prisma_migrations');

  if (userTables.length === 0) {
    console.log('[migration-gate] Empty database: baseline deploy is allowed.');
  } else {
    if (!tableNames.includes('_prisma_migrations')) {
      throw new Error('Non-empty database without _prisma_migrations history. Refusing unknown schema state.');
    }
    const appliedRows = await prisma.$queryRaw`
      SELECT migration_name FROM _prisma_migrations
      WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL`;
    const applied = new Set(appliedRows.map((row) => row.migration_name));

    const unknown = [...applied].filter((name) => !localMigrations.includes(name));
    if (unknown.length > 0) {
      throw new Error(`Database has migrations unknown to this release: ${unknown.join(', ')}`);
    }

    const pending = localMigrations.filter((name) => !applied.has(name));
    for (const name of pending) {
      const preflight = join(migrationsDir, name, 'preflight.sql');
      if (!existsSync(preflight)) {
        throw new Error(`Pending migration ${name} has no preflight.sql. Add one before deploying.`);
      }
      console.log(`[migration-gate] preflight: ${name}`);
      execFileSync(prismaBin, ['db', 'execute', '--file', preflight, '--schema', schemaPath], {
        stdio: 'inherit',
      });
    }
    console.log(`[migration-gate] ${pending.length} pending migration(s) passed preflight.`);
  }
} catch (err) {
  console.error(`[migration-gate] REFUSED: ${err.message}`);
  process.exitCode = 1;
} finally {
  await prisma.$disconnect();
}
