/**
 * READ-ONLY dry run: reports attendance_sessions whose attendanceDate is not the Asia/Kolkata
 * business day of startTime.
 *
 * Owner decision: such sessions must NOT be auto-recomputed. This script only reports them, with the
 * attendanceDate a recompute would propose (IST start-of-day of startTime). Nothing is written.
 *
 * Read-only guarantee: the only Prisma call is attendanceSession.findMany (SELECT, keyset-paged by id).
 * No create/update/upsert/delete/executeRaw/$transaction is used.
 *
 * Usage (DATABASE_URL must be provided in the environment, never stored in files):
 *   DATABASE_URL=postgresql://... npm run report:session-dates -- [--json] [--allow-production-read]
 *
 * Refuses to run when APP_ENV or NODE_ENV is 'production' unless --allow-production-read is passed.
 * Even then the script stays read-only.
 */
import { PrismaClient } from '@prisma/client';
import { IST_OFFSET_MS, istStartOfDay } from '../src/common/utils/business-day';

const BATCH_SIZE = 500;

interface SessionRow {
  id: string;
  hostelId: string;
  sessionType: string;
  status: string;
  startTime: Date;
  attendanceDate: Date;
}

interface MismatchRow {
  id: string;
  hostelId: string;
  sessionType: string;
  status: string;
  startTime: string;
  oldAttendanceDate: string;
  proposedAttendanceDate: string;
  startIstDay: string;
  oldIstDay: string;
}

/** Asia/Kolkata calendar day (YYYY-MM-DD) of a UTC instant, using the fixed +05:30 offset. */
export function istDayKey(instant: Date): string {
  return new Date(instant.getTime() + IST_OFFSET_MS).toISOString().slice(0, 10);
}

function describeDatabase(url: string): string {
  try {
    const parsed = new URL(url);
    const dbName = decodeURIComponent(parsed.pathname.replace(/^\//, ''));
    return `${parsed.hostname}:${parsed.port || '5432'}/${dbName}`;
  } catch {
    return '(unparseable DATABASE_URL)';
  }
}

/** Returns a mismatch row when attendanceDate's IST day differs from startTime's IST day; otherwise null. */
export function toMismatch(row: SessionRow): MismatchRow | null {
  const startIstDay = istDayKey(row.startTime);
  const oldIstDay = istDayKey(row.attendanceDate);
  if (startIstDay === oldIstDay) return null;

  return {
    id: row.id,
    hostelId: row.hostelId,
    sessionType: row.sessionType,
    status: row.status,
    startTime: row.startTime.toISOString(),
    oldAttendanceDate: row.attendanceDate.toISOString(),
    proposedAttendanceDate: istStartOfDay(startIstDay, 'startTime').toISOString(),
    startIstDay,
    oldIstDay,
  };
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const asJson = argv.includes('--json');
  const allowProductionRead = argv.includes('--allow-production-read');

  const appEnv = process.env.APP_ENV;
  const nodeEnv = process.env.NODE_ENV;
  const isProduction = appEnv === 'production' || nodeEnv === 'production';
  if (isProduction && !allowProductionRead) {
    throw new Error(
      `Refusing to run: APP_ENV=${appEnv ?? '(unset)'} NODE_ENV=${nodeEnv ?? '(unset)'}. ` +
        'Pass --allow-production-read to read production (this script never writes).'
    );
  }

  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error('DATABASE_URL is not set in the environment.');
  }

  const prisma = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
  const mismatches: MismatchRow[] = [];
  let scanned = 0;

  try {
    let cursorId: string | undefined;
    for (;;) {
      const batch: SessionRow[] = await prisma.attendanceSession.findMany({
        select: {
          id: true,
          hostelId: true,
          sessionType: true,
          status: true,
          startTime: true,
          attendanceDate: true,
        },
        orderBy: { id: 'asc' },
        take: BATCH_SIZE,
        ...(cursorId ? { cursor: { id: cursorId }, skip: 1 } : {}),
      });
      if (batch.length === 0) break;

      scanned += batch.length;
      for (const row of batch) {
        const mismatch = toMismatch(row);
        if (mismatch) mismatches.push(mismatch);
      }

      cursorId = batch[batch.length - 1].id;
      if (batch.length < BATCH_SIZE) break;
    }
  } finally {
    await prisma.$disconnect();
  }

  const report = {
    mode: 'DRY_RUN_READ_ONLY',
    database: describeDatabase(databaseUrl),
    rule: 'attendanceDate should equal the Asia/Kolkata day of startTime (IST start-of-day)',
    scanned,
    mismatchCount: mismatches.length,
    mismatches,
  };

  if (asJson) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    console.log(`Database: ${report.database}`);
    console.log(`Rule: ${report.rule}`);
    console.log(`Scanned sessions: ${scanned}`);
    console.log(`Mismatches: ${mismatches.length}`);
    if (mismatches.length > 0) {
      console.table(
        mismatches.map((m) => ({
          id: m.id,
          hostelId: m.hostelId,
          sessionType: m.sessionType,
          status: m.status,
          startTime: m.startTime,
          oldAttendanceDate: m.oldAttendanceDate,
          proposedAttendanceDate: m.proposedAttendanceDate,
        }))
      );
    }
  }

  console.log('DRY RUN: no rows were modified');
}

if (require.main === module) {
  main().catch((err) => {
    console.error('[session-dates dry run] failed:', err instanceof Error ? err.message : err);
    process.exitCode = 1;
  });
}
