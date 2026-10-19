import { describe, it, expect, beforeAll } from 'vitest';
import { testPrisma, resetTestDatabase } from './helpers/test-db';

async function insertAuditRow(): Promise<string> {
  const org = await testPrisma.organization.create({
    data: { code: `ORG_AUDIT_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`, name: 'Audit Guard Org' },
  });
  const row = await testPrisma.auditLog.create({
    data: {
      organizationId: org.id,
      entityType: 'TEST',
      entityId: org.id,
      action: 'CREATE',
      reason: 'append-only guard test',
    },
  });
  return row.id;
}

describe('audit_logs append-only protection', () => {
  beforeAll(async () => {
    await resetTestDatabase();
  });

  it('rejects UPDATE of an audit row', async () => {
    const id = await insertAuditRow();
    await expect(
      testPrisma.auditLog.update({ where: { id }, data: { reason: 'tampered' } })
    ).rejects.toThrow(/audit_logs is append-only/);
  });

  it('rejects DELETE of an audit row', async () => {
    const id = await insertAuditRow();
    await expect(testPrisma.auditLog.delete({ where: { id } })).rejects.toThrow(
      /audit_logs is append-only/
    );
  });

  it('rejects TRUNCATE of audit_logs and keeps its rows', async () => {
    const id = await insertAuditRow();
    await expect(testPrisma.$executeRawUnsafe('TRUNCATE TABLE "audit_logs"')).rejects.toThrow(
      /TRUNCATE is not permitted/
    );
    const survivor = await testPrisma.auditLog.findUnique({ where: { id } });
    expect(survivor).not.toBeNull();
  });

  it('keeps the TRUNCATE guard enabled after the test reset runs', async () => {
    await insertAuditRow();
    await resetTestDatabase();

    const [trigger] = await testPrisma.$queryRaw<Array<{ tgenabled: string }>>`
      SELECT tgenabled FROM pg_trigger WHERE tgname = 'audit_logs_no_truncate'
    `;
    expect(trigger?.tgenabled).toBe('O');

    await expect(testPrisma.$executeRawUnsafe('TRUNCATE TABLE "audit_logs"')).rejects.toThrow(
      /TRUNCATE is not permitted/
    );
    expect(await testPrisma.auditLog.count()).toBe(0);
  });
});
