import { Test, TestingModule } from '@nestjs/testing';
import { Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import {
  TokensReconciliationService,
  ReconciliationOptions,
  Mismatch,
} from './tokens-reconciliation.service';

/**
 * Ledger reconciliation is strictly read-only: these tests mirror the narrow
 * Prisma delegates from tokens.service.spec.ts (plus aggregate/findMany for
 * batch iteration) and assert that no write or cache operation is ever issued,
 * even when a mismatch is found.
 */
describe('TokensReconciliationService', () => {
  let service: TokensReconciliationService;

  const userId = 'user-123';
  const otherUserId = 'user-other';
  const asOf = new Date('2026-11-28T00:00:00.000Z');

  const mockPrismaService = {
    user_token_balance: {
      findUnique: jest.fn(),
      findMany: jest.fn().mockResolvedValue([]),
      // Every mutating delegate is present so an accidental repair is visible.
      create: jest.fn(),
      update: jest.fn(),
      upsert: jest.fn(),
      updateMany: jest.fn(),
      delete: jest.fn(),
      deleteMany: jest.fn(),
    },
    token_transactions: {
      findUnique: jest.fn(),
      findMany: jest.fn().mockResolvedValue([]),
      aggregate: jest.fn(),
      groupBy: jest.fn(),
      create: jest.fn(),
      createMany: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
      upsert: jest.fn(),
      delete: jest.fn(),
      deleteMany: jest.fn(),
    },
    $transaction: jest.fn(),
    $executeRaw: jest.fn(),
    $executeRawUnsafe: jest.fn(),
  };

  const writeMocks = () => [
    mockPrismaService.user_token_balance.create,
    mockPrismaService.user_token_balance.update,
    mockPrismaService.user_token_balance.upsert,
    mockPrismaService.user_token_balance.updateMany,
    mockPrismaService.user_token_balance.delete,
    mockPrismaService.user_token_balance.deleteMany,
    mockPrismaService.token_transactions.create,
    mockPrismaService.token_transactions.createMany,
    mockPrismaService.token_transactions.update,
    mockPrismaService.token_transactions.updateMany,
    mockPrismaService.token_transactions.upsert,
    mockPrismaService.token_transactions.delete,
    mockPrismaService.token_transactions.deleteMany,
    mockPrismaService.$transaction,
    mockPrismaService.$executeRaw,
    mockPrismaService.$executeRawUnsafe,
  ];

  const expectReadOnly = () => {
    for (const mock of writeMocks()) expect(mock).not.toHaveBeenCalled();
  };

  const stubLedger = (amount: number, count: number) =>
    mockPrismaService.token_transactions.aggregate.mockResolvedValue({
      _sum: { amount },
      _count: { _all: count },
    });

  const stubBalance = (balance: number | null) =>
    mockPrismaService.user_token_balance.findUnique.mockResolvedValue(
      balance === null ? null : { user_id: userId, balance },
    );

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TokensReconciliationService,
        { provide: PrismaService, useValue: mockPrismaService },
      ],
    }).compile();

    service = module.get<TokensReconciliationService>(
      TokensReconciliationService,
    );

    stubBalance(100);
    stubLedger(0, 0);
    mockPrismaService.user_token_balance.findMany.mockResolvedValue([]);
    mockPrismaService.token_transactions.findMany.mockResolvedValue([]);
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
  });

  afterEach(() => {
    jest.restoreAllMocks();
    jest.clearAllMocks();
  });

  it('returns null when opening balance plus ledger sum equals stored balance', async () => {
    stubLedger(25, 4); // +25 -5 +0 +5 = 25
    stubBalance(125);

    const result = await service.reconcileUser(userId, {
      asOf,
      openingBalance: 100,
    });

    expect(result).toBeNull();
    expect(mockPrismaService.token_transactions.aggregate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          user_id: userId,
          created_at: { lte: asOf },
        },
        _sum: { amount: true },
        _count: { _all: true },
      }),
    );
    expect(Logger.prototype.warn).not.toHaveBeenCalled();
    expectReadOnly();
  });

  it('reports a mismatch with expected/actual/difference and logs only on mismatch', async () => {
    stubLedger(-7, 1);
    stubBalance(95);

    const result = await service.reconcileUser(userId, {
      asOf,
      openingBalance: 100,
    });

    expect(result).toEqual({
      userId,
      expectedBalance: 93,
      actualBalance: 95,
      difference: 2,
      checkedEntries: 1,
    });
    expect(Logger.prototype.warn).toHaveBeenCalledTimes(1);
    expect(Logger.prototype.warn).toHaveBeenCalledWith(
      expect.stringContaining(`user ${userId}`),
    );
    expectReadOnly();
  });

  it('treats a missing balance row as zero actual balance', async () => {
    stubBalance(null);
    stubLedger(10, 2);

    const result = await service.reconcileUser(userId, {
      asOf,
      openingBalance: 0,
    });

    expect(result).toEqual({
      userId,
      expectedBalance: 10,
      actualBalance: 0,
      difference: -10,
      checkedEntries: 2,
    });
    expectReadOnly();
  });

  it('defaults to a zero opening balance and asOf = now', async () => {
    stubLedger(-5, 1);
    stubBalance(-5);

    const result = await service.reconcileUser(userId);

    expect(result).toBeNull();
    const args = (mockPrismaService.token_transactions.aggregate as jest.Mock)
      .mock.calls[0][0];
    expect(args.where.created_at.lte).toBeInstanceOf(Date);
    expectReadOnly();
  });

  it('supports a per-user opening balance function', async () => {
    const openingBalance = jest.fn(async (uid: string) =>
      uid === userId ? 50 : 5,
    );
    stubLedger(10, 1);
    stubBalance(60);

    const result = await service.reconcileUser(userId, {
      asOf,
      openingBalance,
    });

    expect(openingBalance).toHaveBeenCalledWith(userId);
    expect(result).toBeNull();
    expectReadOnly();
  });

  it('does not silently repair and invokes the onMismatch callback', async () => {
    stubLedger(-7, 1);
    stubBalance(95);
    const onMismatch = jest.fn<void, [Mismatch]>();

    const result = await service.reconcileUser(userId, {
      asOf,
      openingBalance: 100,
      onMismatch,
    });

    expect(result).not.toBeNull();
    expect(onMismatch).toHaveBeenCalledTimes(1);
    expect(onMismatch).toHaveBeenCalledWith(result);
    // Still wrong in the database: no repair was attempted.
    expect(mockPrismaService.user_token_balance.update).not.toHaveBeenCalled();
    expectReadOnly();
  });

  it('rejects an invalid asOf value', async () => {
    await expect(
      service.reconcileUser(userId, { asOf: new Date('invalid') }),
    ).rejects.toThrow('asOf must be a valid Date');
    expectReadOnly();
  });

  it('reconcileAll includes balance rows, ledger-only users and the baseline', async () => {
    mockPrismaService.user_token_balance.findMany
      .mockResolvedValueOnce([{ user_id: userId }])
      .mockResolvedValueOnce([]);
    mockPrismaService.token_transactions.groupBy
      .mockResolvedValueOnce([
        { user_id: userId, _count: { _all: 1 } },
        { user_id: otherUserId, _count: { _all: 2 } },
      ])
      .mockResolvedValueOnce([]);

    mockPrismaService.user_token_balance.findUnique.mockImplementation(
      async ({ where }: { where: { user_id: string } }) => {
        const balances: Record<string, number> = {
          [userId]: 95,
          [otherUserId]: 5,
        };
        return {
          user_id: where.user_id,
          balance: balances[where.user_id] ?? 0,
        };
      },
    );
    mockPrismaService.token_transactions.aggregate.mockImplementation(
      async ({ where }: { where: { user_id: string } }) => ({
        _sum: { amount: where.user_id === userId ? -7 : 3 },
        _count: { _all: where.user_id === userId ? 1 : 2 },
      }),
    );

    const options: ReconciliationOptions = { asOf, openingBalance: 100 };
    const report = await service.reconcileAll(options);

    expect(report.asOf).toBe(asOf);
    expect(report.checkedUsers).toBe(2);
    expect(report.checkedEntries).toBe(3);
    expect(report.baseline).toBe('100');
    expect(report.mismatches).toHaveLength(2);
    expect(report.mismatches.map((m) => m.userId)).toEqual([
      userId,
      otherUserId,
    ]);
    expect(report.mismatches[0]).toEqual({
      userId,
      expectedBalance: 93,
      actualBalance: 95,
      difference: 2,
      checkedEntries: 1,
    });
    expect(report.mismatches[1]).toEqual({
      userId: otherUserId,
      expectedBalance: 103,
      actualBalance: 5,
      difference: -98,
      checkedEntries: 2,
    });
    expectReadOnly();
  });

  it('reconcileAll restricts to the requested userId', async () => {
    mockPrismaService.user_token_balance.findMany.mockResolvedValue([
      { user_id: userId },
      { user_id: otherUserId },
    ]);
    stubLedger(0, 0);
    stubBalance(100);

    const report = await service.reconcileAll({
      asOf,
      userId,
      openingBalance: 100,
    });

    expect(report.checkedUsers).toBe(1);
    expect(report.mismatches).toEqual([]);
    expectReadOnly();
  });

  it('bounds the page size passed to findMany', async () => {
    mockPrismaService.user_token_balance.findMany.mockResolvedValue([
      { user_id: userId },
    ]);
    stubLedger(0, 0);
    stubBalance(100);

    await service.reconcileAll({ asOf, pageSize: 100_000 });

    const calls = (mockPrismaService.user_token_balance.findMany as jest.Mock)
      .mock.calls;
    expect(calls.every(([args]) => args.take === 1000)).toBe(true);
    expectReadOnly();
  });
});
