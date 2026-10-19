import { PrismaClient } from '@prisma/client';
import { config } from '../../src/config';

const ALLOWED_TEST_DB_NAMES = ['pravahax_test_db'];
const LOCAL_HOSTS = ['localhost', '127.0.0.1', '[::1]'];

export function verifyTestDatabaseSafety(testUrl: string | undefined, devUrl?: string): void {
  if (process.env.APP_ENV === 'production' || process.env.NODE_ENV === 'production') {
    throw new Error('SAFETY ERROR: Test database helpers cannot run in a production environment.');
  }

  if (!testUrl) {
    throw new Error('SAFETY ERROR: TEST_DATABASE_URL is not set.');
  }

  let parsed: URL;
  try {
    parsed = new URL(testUrl);
  } catch {
    throw new Error('SAFETY ERROR: TEST_DATABASE_URL is not a valid URL.');
  }

  // Credentials are never echoed into error messages
  const dbName = decodeURIComponent(parsed.pathname.replace(/^\//, ''));
  const isSafe = ALLOWED_TEST_DB_NAMES.includes(dbName) && LOCAL_HOSTS.includes(parsed.hostname);

  if (!isSafe) {
    throw new Error(
      'SAFETY ERROR: Refusing to connect tests to unsafe database. ' +
      `Database must be one of [${ALLOWED_TEST_DB_NAMES.join(', ')}] on a localhost host.`
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

// Tests that open their own client must go through the same safety check
export function createTestPrismaClient(): PrismaClient {
  verifyTestDatabaseSafety(config.testDatabaseUrl, config.databaseUrl);
  return new PrismaClient({
    datasources: {
      db: {
        url: config.testDatabaseUrl,
      },
    },
  });
}

/**
 * Empties every application table of the dedicated test database in one statement.
 * TRUNCATE is used instead of row deletes because audit_logs is append-only (row-level
 * BEFORE UPDATE OR DELETE trigger) and RESTRICTs deletes of the users/hostels it references.
 * TRUNCATE does not fire that row trigger, and this only ever runs against the allowlisted
 * local test database (verified above).
 */
export async function resetTestDatabase(): Promise<void> {
  verifyTestDatabaseSafety(config.testDatabaseUrl, config.databaseUrl);

  const tables = await testPrisma.$queryRaw<Array<{ tablename: string }>>`
    SELECT tablename FROM pg_tables
    WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'
  `;
  if (tables.length === 0) {
    throw new Error('SAFETY ERROR: test database has no application tables; run migrations first.');
  }
  const tableList = tables.map((t) => `"public"."${t.tablename.replace(/"/g, '""')}"`).join(', ');
  // The no-TRUNCATE guard on audit_logs is lifted only inside this transaction; a failure rolls it back.
  await testPrisma.$transaction(
    async (tx) => {
      await tx.$executeRawUnsafe('ALTER TABLE "public"."audit_logs" DISABLE TRIGGER audit_logs_no_truncate');
      await tx.$executeRawUnsafe(`TRUNCATE TABLE ${tableList} RESTART IDENTITY CASCADE`);
      await tx.$executeRawUnsafe('ALTER TABLE "public"."audit_logs" ENABLE TRIGGER audit_logs_no_truncate');
    },
    { timeout: 60000 }
  );
}
