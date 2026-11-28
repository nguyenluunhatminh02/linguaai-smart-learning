import { Test, TestingModule } from '@nestjs/testing';
import { TokensService } from './tokens.service';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../common/services/redis.service';
import { ConflictException, ForbiddenException } from '@nestjs/common';

describe('TokensService', () => {
  let service: TokensService;

  const utcDay = () => new Date().toISOString().slice(0, 10);
  const dayDate = (day = utcDay()) => new Date(`${day}T00:00:00.000Z`);

  /** In-memory daily_credit_grants delegate enforcing the unique (user,type,day) index. */
  const makeGrantStore = () => {
    const rows = new Map<
      string,
      { user_id: string; grant_type: string; day: Date; amount: number }
    >();
    const key = (userId: string, grantType: string, day: Date) =>
      `${userId}|${grantType}|${day.toISOString()}`;
    return {
      rows,
      delegate: {
        findUnique: jest.fn(async ({ where }: any) => {
          const marker = where.user_id_grant_type_day;
          const row = rows.get(
            key(marker.user_id, marker.grant_type, marker.day),
          );
          return row ? { amount: row.amount } : null;
        }),
        findMany: jest.fn(async ({ where }: any) =>
          [...rows.values()]
            .filter(
              (row) =>
                row.user_id === where.user_id &&
                (!where.grant_type || row.grant_type === where.grant_type),
            )
            .filter(
              (row) =>
                !where.day ||
                (row.day >= where.day.gte && row.day <= where.day.lte),
            )
            .sort((a, b) => b.day.getTime() - a.day.getTime()),
        ),
        create: jest.fn(async ({ data }: any) => {
          const rowKey = key(data.user_id, data.grant_type, data.day);
          if (rows.has(rowKey)) {
            throw {
              code: 'P2002',
              meta: { target: ['user_id', 'grant_type', 'day'] },
            };
          }
          rows.set(rowKey, data);
          return data;
        }),
      },
    };
  };

  let grants: ReturnType<typeof makeGrantStore>;

  const mockPrismaService = {
    user_token_balance: {
      findUnique: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      upsert: jest.fn(),
      updateMany: jest.fn(),
    },
    token_transactions: {
      findUnique: jest.fn(),
      findMany: jest.fn().mockResolvedValue([]),
      create: jest.fn(),
      aggregate: jest.fn(),
    },
    daily_credit_grants: undefined as any,
    $transaction: jest.fn(),
  };

  const mockRedisService = {
    get: jest.fn(),
    set: jest.fn(),
    del: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TokensService,
        { provide: PrismaService, useValue: mockPrismaService },
        { provide: RedisService, useValue: mockRedisService },
      ],
    }).compile();

    service = module.get<TokensService>(TokensService);

    grants = makeGrantStore();
    mockPrismaService.daily_credit_grants = grants.delegate;
    mockPrismaService.user_token_balance.updateMany.mockResolvedValue({
      count: 1,
    });

    // Default: no Redis markers, no balance cache (durable DB state decides).
    mockRedisService.get.mockResolvedValue(null);
    mockPrismaService.user_token_balance.findUnique.mockResolvedValue({
      user_id: 'user-123',
      balance: 100,
    });
    mockPrismaService.user_token_balance.create.mockImplementation(
      async (args) => ({
        user_id: args.data.user_id,
        balance: args.data.balance,
      }),
    );
    mockPrismaService.user_token_balance.upsert.mockImplementation(
      async (args) => {
        const balanceVal = args.update?.balance;
        let newBal = 100;
        if (balanceVal?.decrement !== undefined) {
          newBal = 100 - balanceVal.decrement;
        } else if (balanceVal?.increment !== undefined) {
          newBal = 100 + balanceVal.increment;
        } else if (typeof balanceVal === 'number') {
          newBal = balanceVal;
        }
        return { user_id: args.where.user_id, balance: newBal };
      },
    );

    mockPrismaService.token_transactions.findUnique.mockResolvedValue(null);
    mockPrismaService.token_transactions.create.mockImplementation(
      async (args) => ({
        id: 'tx-uuid',
        ...args.data,
      }),
    );
    mockPrismaService.token_transactions.aggregate.mockResolvedValue({
      _sum: { amount: 0 },
    });
    mockPrismaService.$transaction.mockImplementation(async (cb) =>
      cb(mockPrismaService),
    );
  });

  afterEach(() => {
    jest.clearAllMocks();
    mockPrismaService.daily_credit_grants = undefined as any;
  });

  describe('getBalance', () => {
    const userId = 'user-123';

    it('returns balance from Redis cache and UTC-scoped usage', async () => {
      mockRedisService.get.mockImplementation(async (key: string) => {
        if (key === `token:balance:${userId}`) return '45';
        return null;
      });
      mockPrismaService.token_transactions.aggregate.mockResolvedValueOnce({
        _sum: { amount: -15 },
      });
      grants.rows.set(`${userId}|DAILY_TOPUP|${dayDate().toISOString()}`, {
        user_id: userId,
        grant_type: 'DAILY_TOPUP',
        day: dayDate(),
        amount: 0,
      });

      const result = await service.getBalance(userId);

      expect(result.balance).toBe(45);
      expect(result.todayUsed).toBe(15);
      expect(mockRedisService.get).toHaveBeenCalledWith(
        `token:balance:${userId}`,
      );
      expect(
        mockPrismaService.token_transactions.aggregate,
      ).toHaveBeenCalledWith({
        where: {
          user_id: userId,
          type: 'consumption',
          created_at: {
            gte: dayDate(),
            lt: new Date(dayDate().getTime() + 86_400_000),
          },
        },
        _sum: { amount: true },
      });
    });

    it('falls back to DB and populates the cache on a cache miss', async () => {
      mockPrismaService.user_token_balance.findUnique.mockResolvedValueOnce({
        user_id: userId,
        balance: 60,
      });
      grants.rows.set(`${userId}|DAILY_TOPUP|${dayDate().toISOString()}`, {
        user_id: userId,
        grant_type: 'DAILY_TOPUP',
        day: dayDate(),
        amount: 0,
      });

      const result = await service.getBalance(userId);

      expect(result.balance).toBe(60);
      expect(result.todayUsed).toBe(0);
      expect(mockRedisService.set).toHaveBeenCalledWith(
        `token:balance:${userId}`,
        '60',
        300,
      );
    });

    it('does not re-grant after a Redis cache desync when the DB marker exists', async () => {
      grants.rows.set(`${userId}|DAILY_TOPUP|${dayDate().toISOString()}`, {
        user_id: userId,
        grant_type: 'DAILY_TOPUP',
        day: dayDate(),
        amount: 30,
      });
      mockRedisService.get.mockResolvedValue(null);

      await service.getBalance(userId);

      expect(grants.delegate.create).not.toHaveBeenCalled();
      expect(
        mockPrismaService.token_transactions.create,
      ).not.toHaveBeenCalled();
      expect(
        mockPrismaService.user_token_balance.upsert,
      ).not.toHaveBeenCalled();
    });

    it("grants once even when Redis claims today's top-up but the DB marker is missing", async () => {
      mockRedisService.get.mockImplementation(async (key: string) =>
        key === `token:last_topup:${userId}` ? utcDay() : null,
      );
      mockPrismaService.user_token_balance.findUnique.mockResolvedValue({
        user_id: userId,
        balance: 5,
      });
      mockPrismaService.user_token_balance.upsert.mockResolvedValueOnce({
        balance: 30,
      });

      const result = await service.checkAndApplyDailyTopup(userId);

      expect(result).toBe(true);
      expect(grants.delegate.create).toHaveBeenCalledTimes(1);
      expect(mockPrismaService.token_transactions.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            type: 'daily_topup',
            amount: 25,
            idempotency_key: `daily_topup:${userId}:${utcDay()}`,
          }),
        }),
      );
    });

    it('treats a P2002 marker conflict as a replay instead of a 500', async () => {
      grants.rows.set(`${userId}|DAILY_TOPUP|${dayDate().toISOString()}`, {
        user_id: userId,
        grant_type: 'DAILY_TOPUP',
        day: dayDate(),
        amount: 12,
      });
      grants.delegate.create.mockRejectedValueOnce({ code: 'P2002' });

      await expect(
        service.checkAndApplyDailyTopup(userId),
      ).resolves.not.toThrow();
      expect(grants.delegate.findUnique).toHaveBeenCalled();
    });

    it('uses the UTC day boundary even when the local day differs', async () => {
      jest.useFakeTimers().setSystemTime(new Date('2026-11-28T23:30:00.000Z'));
      try {
        grants.rows.set(`${userId}|DAILY_TOPUP|${dayDate().toISOString()}`, {
          user_id: userId,
          grant_type: 'DAILY_TOPUP',
          day: dayDate(),
          amount: 0,
        });

        await service.getBalance(userId);

        expect(
          mockPrismaService.token_transactions.aggregate,
        ).toHaveBeenCalledWith(
          expect.objectContaining({
            where: expect.objectContaining({
              created_at: {
                gte: new Date('2026-11-28T00:00:00.000Z'),
                lt: new Date('2026-11-29T00:00:00.000Z'),
              },
            }),
          }),
        );
      } finally {
        jest.useRealTimers();
      }
    });
  });

  describe('consumeTokens', () => {
    const userId = 'user-123';
    const idempotencyKey = 'key-abc';

    it('returns cached result if idempotency key exists', async () => {
      mockPrismaService.token_transactions.findUnique.mockResolvedValueOnce({
        id: 'tx-789',
        amount: -5,
        balance_after: 25,
      });

      const result = await service.consumeTokens(
        userId,
        'ai_chat',
        5,
        idempotencyKey,
      );

      expect(result.balance).toBe(25);
      expect(result.cost).toBe(5);
      expect(
        mockPrismaService.token_transactions.findUnique,
      ).toHaveBeenCalledWith({
        where: { idempotency_key: idempotencyKey },
      });
      expect(mockPrismaService.$transaction).not.toHaveBeenCalled();
    });

    it('consumes tokens and invalidates cache on success', async () => {
      grants.rows.set(`${userId}|DAILY_TOPUP|${dayDate().toISOString()}`, {
        user_id: userId,
        grant_type: 'DAILY_TOPUP',
        day: dayDate(),
        amount: 0,
      });
      mockPrismaService.user_token_balance.findUnique.mockResolvedValueOnce({
        balance: 35,
      });
      mockPrismaService.user_token_balance.upsert.mockResolvedValueOnce({
        balance: 30,
      });

      const result = await service.consumeTokens(userId, 'ai_chat', 5);

      expect(result.balance).toBe(30);
      expect(result.cost).toBe(5);
      expect(mockRedisService.del).toHaveBeenCalledWith(
        `token:balance:${userId}`,
      );
    });

    it('throws ForbiddenException if balance is insufficient', async () => {
      grants.rows.set(`${userId}|DAILY_TOPUP|${dayDate().toISOString()}`, {
        user_id: userId,
        grant_type: 'DAILY_TOPUP',
        day: dayDate(),
        amount: 0,
      });
      mockPrismaService.user_token_balance.findUnique.mockResolvedValueOnce({
        balance: 2,
      });

      await expect(service.consumeTokens(userId, 'ai_chat', 5)).rejects.toThrow(
        ForbiddenException,
      );
    });
  });

  describe('addTokens', () => {
    const userId = 'user-123';

    it('increments balance and creates a transaction', async () => {
      mockPrismaService.user_token_balance.upsert.mockResolvedValueOnce({
        balance: 110,
      });

      const result = await service.addTokens(userId, 100, 'purchase');

      expect(result.balance).toBe(110);
      expect(result.added).toBe(100);
      expect(mockRedisService.del).toHaveBeenCalledWith(
        `token:balance:${userId}`,
      );
    });
  });

  describe('dailyCheckIn', () => {
    const userId = 'user-123';

    it('grants the first bonus when the DB marker is absent', async () => {
      mockRedisService.get.mockResolvedValue(null);
      // The upsert credits 5 and the balance read-back sees the committed 105.
      mockPrismaService.user_token_balance.findUnique
        .mockResolvedValueOnce({ balance: 100 })
        .mockResolvedValue({ balance: 105 });
      mockPrismaService.user_token_balance.upsert.mockResolvedValueOnce({
        balance: 105,
      });

      const result = await service.dailyCheckIn(userId);

      expect(result.alreadyCheckedIn).toBe(false);
      expect(result.tokensEarned).toBe(5);
      expect(result.balance).toBe(105);
      expect(grants.delegate.create).toHaveBeenCalledWith({
        data: {
          user_id: userId,
          grant_type: 'DAILY_CHECKIN',
          day: dayDate(),
          amount: 5,
        },
      });
      expect(mockRedisService.set).toHaveBeenCalledWith(
        expect.stringContaining(`checkin:${userId}:`),
        '1',
        86400,
      );
    });

    it('does not grant again when Redis is cleared but the DB marker exists', async () => {
      grants.rows.set(`${userId}|DAILY_CHECKIN|${dayDate().toISOString()}`, {
        user_id: userId,
        grant_type: 'DAILY_CHECKIN',
        day: dayDate(),
        amount: 5,
      });
      mockRedisService.get.mockResolvedValue(null);

      const result = await service.dailyCheckIn(userId);

      expect(result.alreadyCheckedIn).toBe(true);
      expect(result.tokensEarned).toBe(0);
      expect(
        mockPrismaService.token_transactions.create,
      ).not.toHaveBeenCalled();
    });

    it('does not create a second grant when Redis is stale and the DB marker is missing', async () => {
      mockRedisService.get.mockImplementation(async (key: string) =>
        key.includes('checkin') ? '1' : null,
      );
      mockPrismaService.user_token_balance.upsert.mockResolvedValueOnce({
        balance: 105,
      });

      const result = await service.dailyCheckIn(userId);

      expect(result.alreadyCheckedIn).toBe(false);
      expect(result.tokensEarned).toBe(5);
      expect(grants.delegate.create).toHaveBeenCalledTimes(1);
    });

    it('returns alreadyCheckedIn when both cache and DB marker agree', async () => {
      grants.rows.set(`${userId}|DAILY_CHECKIN|${dayDate().toISOString()}`, {
        user_id: userId,
        grant_type: 'DAILY_CHECKIN',
        day: dayDate(),
        amount: 5,
      });
      mockRedisService.get.mockImplementation(async (key: string) =>
        key.includes('checkin') ? '1' : null,
      );

      const result = await service.dailyCheckIn(userId);

      expect(result.alreadyCheckedIn).toBe(true);
      expect(result.tokensEarned).toBe(0);
      expect(result.balance).toBe(100);
    });
  });

  describe('operation-scoped billing', () => {
    const userId = 'user-123';
    const operation = {
      operationId: '22222222-2222-4222-8222-222222222222',
      user: userId,
      feature: 'ai_chat',
      charge: 5,
      status: 'RESERVED' as const,
    };

    it('uses the shared refund:aiop ledger key and treats a replay as a no-op', async () => {
      const refundKey = `refund:aiop:${operation.operationId}`;
      const debitKey = `op:${userId}:${operation.operationId}:debit`;
      mockPrismaService.token_transactions.findUnique.mockImplementation(
        async ({ where }: any) => {
          if (where.idempotency_key === debitKey) {
            return {
              user_id: userId,
              feature: 'ai_chat',
              amount: -5,
              balance_after: 25,
            };
          }
          if (where.idempotency_key === refundKey) {
            return {
              user_id: userId,
              feature: 'ai_chat',
              amount: 5,
              balance_after: 30,
            };
          }
          return null;
        },
      );

      const result = await service.refundTokens(userId, operation);

      expect(result).toEqual({ balance: 30, refunded: 5, duplicate: true });
      expect(mockRedisService.del).toHaveBeenCalledWith(
        `token:balance:${userId}`,
      );
      expect(
        mockPrismaService.user_token_balance.upsert,
      ).not.toHaveBeenCalled();
      expect(
        mockPrismaService.token_transactions.create,
      ).not.toHaveBeenCalled();
    });

    it('applies the daily top-up inside the reserve transaction, before the debit', async () => {
      mockPrismaService.user_token_balance.upsert.mockResolvedValueOnce({
        balance: 20,
      });
      mockPrismaService.user_token_balance.updateMany.mockImplementation(
        async () => {
          // The conditional debit sees the topped-up balance, not the original 5.
          expect(grants.delegate.create).toHaveBeenCalledTimes(1);
          return { count: 1 };
        },
      );
      mockPrismaService.user_token_balance.findUnique.mockResolvedValue({
        balance: 15,
      });
      mockPrismaService.token_transactions.findUnique.mockResolvedValue(null);

      const result = await service.reserveTokens(userId, operation);

      expect(result).toEqual({ balance: 15, cost: 5, duplicate: false });
      expect(mockPrismaService.$transaction).toHaveBeenCalledTimes(1);
      expect(grants.delegate.create).toHaveBeenCalledWith({
        data: {
          user_id: userId,
          grant_type: 'DAILY_TOPUP',
          day: dayDate(),
          amount: 15,
        },
      });
      const debitEntry =
        mockPrismaService.token_transactions.create.mock.calls.find(
          ([args]: any[]) => args.data.amount === -5,
        );
      expect(debitEntry?.[0].data.idempotency_key).toBe(
        `op:${userId}:${operation.operationId}:debit`,
      );
    });

    it('does not top up outside the reserve transaction', async () => {
      mockPrismaService.user_token_balance.findUnique.mockResolvedValue({
        balance: 100,
      });
      grants.rows.set(`${userId}|DAILY_TOPUP|${dayDate().toISOString()}`, {
        user_id: userId,
        grant_type: 'DAILY_TOPUP',
        day: dayDate(),
        amount: 0,
      });

      await service.reserveTokens(userId, operation);

      expect(mockPrismaService.$transaction).toHaveBeenCalledTimes(1);
      expect(grants.delegate.create).not.toHaveBeenCalled();
    });

    it('handles a P2002 replay on the debit key without failing the request', async () => {
      const key = `op:${userId}:${operation.operationId}:debit`;
      mockPrismaService.token_transactions.create.mockRejectedValueOnce({
        code: 'P2002',
      });
      mockPrismaService.token_transactions.findUnique.mockImplementation(
        async ({ where }: any) =>
          where.idempotency_key === key
            ? {
                user_id: userId,
                feature: 'ai_chat',
                amount: -5,
                balance_after: 20,
              }
            : null,
      );

      const result = await service.reserveTokens(userId, operation);

      expect(result).toEqual({ balance: 20, cost: 5, duplicate: true });
    });

    it('rejects a reserve whose top-up marker conflicts without a confirmed debit', async () => {
      grants.delegate.create.mockRejectedValueOnce({ code: 'P2002' });
      mockPrismaService.token_transactions.findUnique.mockResolvedValue(null);

      await expect(service.reserveTokens(userId, operation)).rejects.toThrow(
        ConflictException,
      );
    });
  });
});
