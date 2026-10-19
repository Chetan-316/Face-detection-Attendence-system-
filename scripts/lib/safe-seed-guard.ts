const STAGING_DB_NAME = /^pravahax_staging[a-z0-9_]*$/;

export interface SafeSeedTarget {
  databaseUrl: string;
  dbName: string;
}

export function assertSafeSeedTarget(env: NodeJS.ProcessEnv): SafeSeedTarget {
  if (env.APP_ENV !== 'staging') {
    throw new Error('[PRAVAHAx Deploy] Refusing to seed: APP_ENV must be exactly "staging".');
  }

  const databaseUrl = env.SAFE_SEED_DATABASE_URL;
  if (!databaseUrl) {
    throw new Error(
      '[PRAVAHAx Deploy] Refusing to seed: SAFE_SEED_DATABASE_URL is required. The default DATABASE_URL is never used for deployment seeding.'
    );
  }

  let parsed: URL;
  try {
    parsed = new URL(databaseUrl);
  } catch {
    throw new Error('[PRAVAHAx Deploy] Refusing to seed: SAFE_SEED_DATABASE_URL is not a valid URL.');
  }
  if (parsed.protocol !== 'postgresql:' && parsed.protocol !== 'postgres:') {
    throw new Error('[PRAVAHAx Deploy] Refusing to seed: SAFE_SEED_DATABASE_URL must be a PostgreSQL URL.');
  }

  const dbName = decodeURIComponent(parsed.pathname.replace(/^\//, ''));
  if (!STAGING_DB_NAME.test(dbName)) {
    throw new Error(
      '[PRAVAHAx Deploy] Refusing to seed: database name must match pravahax_staging*.'
    );
  }
  if (/prod/i.test(dbName) || /prod/i.test(parsed.hostname)) {
    throw new Error('[PRAVAHAx Deploy] Refusing to seed: target references production.');
  }

  if (databaseUrl === env.DATABASE_URL || databaseUrl === env.TEST_DATABASE_URL) {
    throw new Error(
      '[PRAVAHAx Deploy] Refusing to seed: SAFE_SEED_DATABASE_URL must not equal DATABASE_URL or TEST_DATABASE_URL.'
    );
  }

  return { databaseUrl, dbName };
}

export function assertEmptyForSeed(counts: Record<string, number>): void {
  const populated = Object.entries(counts)
    .filter(([, count]) => count > 0)
    .map(([table, count]) => `${table}=${count}`);
  if (populated.length > 0) {
    throw new Error(
      `[PRAVAHAx Deploy] Refusing to seed: target is not empty (${populated.join(', ')}). The seed only runs on an empty database.`
    );
  }
}
