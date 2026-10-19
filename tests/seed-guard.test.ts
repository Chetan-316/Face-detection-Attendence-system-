import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type { PrismaClient } from '@prisma/client';
import { assertEmptyForSeed, assertSafeSeedTarget } from '../scripts/lib/safe-seed-guard';
import { runSeed } from '../prisma/seed';

const REMOTE_STAGING = 'postgresql://seed:x@staging-db.example.internal:5432/pravahax_staging?schema=public';

const SEED_ENV_KEYS = ['APP_ENV', 'ALLOW_DESTRUCTIVE_SEED', 'SEED_DEFAULT_PASSWORD', 'DATABASE_URL'] as const;
let savedEnv: Record<string, string | undefined>;

beforeEach(() => {
  savedEnv = Object.fromEntries(SEED_ENV_KEYS.map((k) => [k, process.env[k]]));
});

afterEach(() => {
  for (const k of SEED_ENV_KEYS) {
    if (savedEnv[k] === undefined) delete process.env[k];
    else process.env[k] = savedEnv[k];
  }
});

describe('deploy seed target guard', () => {
  it('refuses when APP_ENV is not exactly staging', () => {
    expect(() =>
      assertSafeSeedTarget({ APP_ENV: 'development', SAFE_SEED_DATABASE_URL: REMOTE_STAGING })
    ).toThrow(/APP_ENV must be exactly "staging"/);
  });

  it('fails closed when SAFE_SEED_DATABASE_URL is missing even if DATABASE_URL is set', () => {
    expect(() =>
      assertSafeSeedTarget({
        APP_ENV: 'staging',
        DATABASE_URL: 'postgresql://u:p@127.0.0.1:55432/pravahax_db',
      })
    ).toThrow(/SAFE_SEED_DATABASE_URL is required/);
  });

  it.each([
    'postgresql://u:p@staging-db.example.internal:5432/pravahax_db',
    'postgresql://u:p@staging-db.example.internal:5432/pravahax_test_db',
    'postgresql://u:p@staging-db.example.internal:5432/pravahax_production',
    'postgresql://u:p@staging-db.example.internal:5432/postgres',
  ])('refuses a database name that is not a staging database: %s', (url) => {
    expect(() => assertSafeSeedTarget({ APP_ENV: 'staging', SAFE_SEED_DATABASE_URL: url })).toThrow(
      /must match pravahax_staging|references production/
    );
  });

  it('refuses a staging-named database whose host references production', () => {
    expect(() =>
      assertSafeSeedTarget({
        APP_ENV: 'staging',
        SAFE_SEED_DATABASE_URL: 'postgresql://u:p@prod-db.example.internal:5432/pravahax_staging',
      })
    ).toThrow(/references production/);
  });

  it('refuses a target identical to DATABASE_URL', () => {
    expect(() =>
      assertSafeSeedTarget({
        APP_ENV: 'staging',
        SAFE_SEED_DATABASE_URL: REMOTE_STAGING,
        DATABASE_URL: REMOTE_STAGING,
      })
    ).toThrow(/must not equal DATABASE_URL/);
  });

  it('accepts an explicit pravahax_staging target and returns its database name', () => {
    const target = assertSafeSeedTarget({ APP_ENV: 'staging', SAFE_SEED_DATABASE_URL: REMOTE_STAGING });
    expect(target).toEqual({ databaseUrl: REMOTE_STAGING, dbName: 'pravahax_staging' });
  });
});

describe('deploy seed emptiness guard', () => {
  it('passes when every checked table is empty', () => {
    expect(() => assertEmptyForSeed({ organization: 0, hostel: 0, auditLog: 0 })).not.toThrow();
  });

  it('refuses and names the populated tables', () => {
    expect(() => assertEmptyForSeed({ organization: 1, hostel: 0, auditLog: 3 })).toThrow(
      /organization=1, auditLog=3/
    );
  });
});

describe('runSeed destructive guard', () => {
  const untouchableDb = new Proxy(
    {},
    {
      get() {
        throw new Error('database must not be touched before the guard refuses');
      },
    }
  ) as unknown as PrismaClient;

  it('refuses a non-local DATABASE_URL without the destructive flag, before touching the database', async () => {
    process.env.APP_ENV = 'development';
    delete process.env.ALLOW_DESTRUCTIVE_SEED;
    await expect(
      runSeed({ db: untouchableDb, databaseUrl: 'postgresql://u:p@203.0.113.10:5432/pravahax_db' })
    ).rejects.toThrow(/non-local DATABASE_URL/);
  });

  it('refuses in production regardless of the destructive flag', async () => {
    process.env.APP_ENV = 'production';
    await expect(
      runSeed({ db: untouchableDb, databaseUrl: REMOTE_STAGING, allowDestructive: true })
    ).rejects.toThrow(/prohibited in production/);
  });

  it('refuses a non-development environment without the destructive flag', async () => {
    process.env.APP_ENV = 'staging';
    await expect(
      runSeed({ db: untouchableDb, databaseUrl: REMOTE_STAGING, allowDestructive: false })
    ).rejects.toThrow(/requires explicit ALLOW_DESTRUCTIVE_SEED=true/);
  });
});
