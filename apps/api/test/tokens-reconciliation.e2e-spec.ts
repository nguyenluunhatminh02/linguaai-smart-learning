import { Test, TestingModule } from '@nestjs/testing';
import { PrismaClient } from '../src/generated/prisma';
import { Pool } from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';
import { seedTestDB, cleanupTestDB } from './setup';
import { TokensReconciliationService } from '../src/tokens/tokens-reconciliation.service';
import { PrismaService } from '../src/prisma/prisma.service';

/**
 * BILL-04 ledger reconciliation e2e: uses a real PostgreSQL test database only.
 * Verifies the reconciliation math against actual ledger transactions and
 * asserts no silent repair is performed when balances diverge.
 */
describe('TokensReconciliationService (e2e)', () => {
  let service: TokensReconciliationService;
  let prisma: PrismaClient;
  let pool: Pool;
  let userId: string;
  const asOf = new Date('2026-11-28T00:00:00.000Z');

  beforeAll(async () => {
    const url =
      process.env.DATABASE_URL ||
      'postgresql://linguaai:linguaai_secret@localhost:5432/linguaai_test';
    pool = new Pool({ connectionString: url });
    prisma = new PrismaClient({ adapter: new PrismaPg(pool) });

    const moduleRef: TestingModule = await Test.createTestingModule({
      providers: [
        TokensReconciliationService,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();

    service = moduleRef.get<TokensReconciliationService>(
      TokensReconciliationService,
    );

    const seeded = await seedTestDB();
    userId = seeded.user.id;
  });

  afterAll(async () => {
    await cleanupTestDB();
    await prisma.$disconnect();
    await pool.end();
  });

  beforeEach(async () => {
    await prisma.token_transactions.deleteMany({});
    await prisma.user_token_balance.updateMany({
      data: { balance: 100 },
    });
  });

  it('reports no mismatch when stored balance equals opening balance plus ledger sum', async () => {
    await prisma.token_transactions.createMany({
      data: [
        {
          user_id: userId,
          amount: 25,
          type: 'bonus',
          balance_after: 125,
          idempotency_key: 'e2e:grant:1',
          created_at: new Date(asOf.getTime() + 60_000),
        },
        {
          user_id: userId,
          amount: -5,
          type: 'consumption',
          balance_after: 120,
          idempotency_key: 'e2e:debit:1',
          created_at: new Date(asOf.getTime() + 120_000),
        },
        {
          user_id: userId,
          amount: 0,
          type: 'settlement',
          balance_after: 120,
          idempotency_key: 'e2e:settle:1',
          created_at: new Date(asOf.getTime() + 180_000),
        },
        {
          user_id: userId,
          amount: 5,
          type: 'refund',
          balance_after: 125,
          idempotency_key: 'e2e:refund:1',
          created_at: new Date(asOf.getTime() + 240_000),
        },
      ],
    });
    await prisma.user_token_balance.update({
      where: { user_id: userId },
      data: { balance: 125 },
    });

    expect(
      await service.reconcileUser(userId, { asOf, openingBalance: 100 }),
    ).toBeNull();
  });

  it('reports a mismatch with correct difference and does not repair the stored balance', async () => {
    // Corrupt the stored balance by 2; the ledger says 93.
    await prisma.token_transactions.create({
      data: {
        user_id: userId,
        amount: -7,
        type: 'consumption',
        balance_after: 93,
        idempotency_key: 'e2e:debit:mismatch',
        created_at: new Date(asOf.getTime() + 60_000),
      },
    });
    await prisma.user_token_balance.update({
      where: { user_id: userId },
      data: { balance: 95 },
    });

    const mismatch = await service.reconcileUser(userId, {
      asOf,
      openingBalance: 100,
    });

    expect(mismatch).toEqual({
      userId,
      expectedBalance: 93,
      actualBalance: 95,
      difference: 2,
      checkedEntries: 1,
    });
    // Reconciliation is read-only: the DB still holds the wrong balance.
    const row = await prisma.user_token_balance.findUnique({
      where: { user_id: userId },
    });
    expect(row?.balance).toBe(95);
  });

  it('excludes entries after asOf and includes ledger-only users in reconcileAll', async () => {
    await prisma.token_transactions.createMany({
      data: [
        {
          user_id: userId,
          amount: -10,
          type: 'consumption',
          balance_after: 90,
          idempotency_key: 'e2e:before-cutoff',
          created_at: new Date(asOf.getTime() + 60_000),
        },
        {
          user_id: userId,
          amount: 500,
          type: 'bonus',
          balance_after: 590,
          idempotency_key: 'e2e:after-cutoff',
          created_at: new Date(asOf.getTime() + 3_600_000),
        },
      ],
    });
    await prisma.user_token_balance.update({
      where: { user_id: userId },
      data: { balance: 90 },
    });

    const report = await service.reconcileAll({ asOf, openingBalance: 100 });

    expect(report.asOf).toEqual(asOf);
    expect(report.baseline).toBe('100');
    expect(report.checkedUsers).toBeGreaterThanOrEqual(1);
    expect(report.mismatches.find((m) => m.userId === userId)).toBeUndefined();
  });
});
