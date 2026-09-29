import { PrismaClient } from '@prisma/client';
import { config } from '../config';

declare global {
  // eslint-disable-next-line no-var
  var prismaGlobal: PrismaClient | undefined;
}

export function createPrismaClient(databaseUrl?: string): PrismaClient {
  return new PrismaClient({
    datasources: {
      db: {
        url: databaseUrl || config.databaseUrl,
      },
    },
    log: config.appEnv === 'development' ? ['error', 'warn'] : ['error'],
  });
}

export const prisma = global.prismaGlobal || createPrismaClient();

if (config.appEnv !== 'production') {
  global.prismaGlobal = prisma;
}
