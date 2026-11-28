import { Test, TestingModule } from '@nestjs/testing';
import { TokensService } from './tokens.service';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../common/services/redis.service';

/**
 * TEST-04: daily-grant policy tests. Pins the four invariants the BILL-05
 * daily grant must preserve across refactors:
 *
 *   1. UTC boundary  -- grants, usage and streaks all share one UTC midnight,
 *                       regardless of the process local timezone.
 *   2. Replay        -- a P2002 conflict on the (user, grant_type, day) marker
 *                       is a successful no-op, never a 500 and never a
 *                       double-credit.
 *   3. Cache loss    -- Redis is advisory only; wiping the cache must not
 *                       re-authorize a grant whose DB marker already exists.
 *   4. Balance >= 30 -- the top-up is "top up to 30", not "give 30". When the
 *                       balance is already >= 30 a zero-amount marker is still
 *                       written so a later spend the same day cannot trigger
 *                       a second grant.
 *
 * The spec deliberately does NOT touch tokens.service.ts; it exercises the
 * existing public surface (getBalance, checkAndApplyDailyTopup, dailyCheckIn)
 * against an in-memory unique-constraint marker store and a controllable
 * clock.
 */
describe('Daily grant policy (BILL-05)', () => {
  const USER = 'user-dg-1';

  /**
   * In-memory daily_credit_grants delegate that enforces the
   * (user_id, grant_type, day) unique index. A duplicate create throws a
   * P2002-shaped error, matching what Prisma returns against the real table.
   */
  const makeGrantStore = () => {
    const rows = new Map<
      string,
      { user_id: string; grant_type: string; day: Date; amount: number }
    >();
    const keyOf = (userId: string, grantType: string, day: Date) =>
      `${userId}|${grantType}|${day.toISOString()}`;

    const delegate = {
      findUnique: jest.fn(async ({ where }: any) => {
        const m = where.user_id_grant_type_day;
        const row = rows.get(keyOf(m.user_id, m.grant_type, m.day));
        return row ? { amount: row.amount } : null;
      }),
      findMany: jest.fn(async ({ where }: any) =>
        [...rows.values()]
          .filter(
            (r) =>
              r.user_id === where.user_id &&
              (!where.grant_type || r.grant_type === where.grant_type),
          )
          .filter(
            (r) =>
              !where.day ||
              (r.day >= where.day.gte && r.day <= where.day.lte),
          )
          .sort((a, b) => b.day.getTime() - a.day.getTime()),
      ),
      create: jest.fn(async ({ data }: any) => {
        const k = keyOf(data.user_id, data.grant_type, data.day);
        if (rows.has(k)) {
          const err: any = new Error('Unique constraint failed');
          err.code = 'P2002';
          err.meta = { target: ['user_id', 'grant_type', 'day'] };
          throw err;
        }
        rows.set(k, data);
        return data;
      }),
    };

    return { rows, delegate };
  };

  type GrantStore = ReturnType<typeof makeGrantStore>;

  const mockPrisma = () => ({
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
  });

  const mockRedis = () => ({
    get: jest.fn(),
    set: jest.fn(),
    del: jest.fn(),
  });

  let grants: GrantStore;
  let prisma: ReturnType<typeof mockPrisma>;
  let redis: ReturnType<typeof mockRedis>;
  let service: TokensService;

  /** YYYY-MM-DD UTC for a given Date (mirrors TokensService.utcDay). */
  const utcDayOf = (d: Date) => d.toISOString().slice(0, 10);
  /** Midnight-UTC Date for a YYYY-MM-DD string. */
  const dayDate = (day: string) => new Date(`${day}T00:00:00.000Z`);

  /** Seed the in-memory marker store with a grant for (user, type, day). */
  const seedMarker = (
    grantType: 'DAILY_TOPUP' | 'DAILY_CHECKIN',
    day: string,
    amount: number,
  ) => {
    grants.rows.set(`${USER}|${grantType}|${dayDate(day).toISOString()}`, {
      user_id: USER,
      grant_type: grantType,
      day: dayDate(day),
      amount,
    });
  };

  /**
   * Configure the balance mock so that a balance read returns `balance` and
   * an upsert with `increment: n` returns `balance + n` (the common case for
   * grants). Tests that need different behaviour can override afterwards.
   */
  const setBalance = (balance: number) => {
    prisma.user_token_balance.findUnique.mockImplementation(async () => ({
      user_id: USER,
      balance,
    }));
    prisma.user_token_balance.upsert.mockImplementation(async (args: any) => {
      const inc = args.update?.balance?.increment;
      const dec = args.update?.balance?.decrement;
      const setTo = args.update?.balance;
      let next = balance;
      if (typeof inc === 'number') next = balance + inc;
      else if (typeof dec === 'number') next = balance - dec;
      else if (typeof setTo === 'number') next = setTo;
      else if (args.create?.balance !== undefined && !args.update) {
        next = args.create.balance;
      }
      // Track the latest balance so subsequent reads see the committed value.
      balance = next;
      return { user_id: USER, balance: next };
    });
    prisma.user_token_balance.create.mockImplementation(async (args: any) => {
      balance = args.data.balance;
      return { user_id: args.data.user_id, balance };
    });
  };

  beforeEach(async () => {
    grants = makeGrantStore();
    prisma = mockPrisma();
    redis = mockRedis();
    prisma.daily_credit_grants = grants.delegate;

    // Default: Serializable transaction just runs the callback against the
    // same mock prisma. No real DB, no retry backoff in unit tests.
    prisma.$transaction.mockImplementation(async (cb: any) => cb(prisma));

    // Default: no Redis markers, no cache (the DB marker decides).
    redis.get.mockResolvedValue(null);

    // Default: zero usage today so todayUsed() is deterministic.
    prisma.token_transactions.aggregate.mockResolvedValue({
      _sum: { amount: 0 },
    });
    prisma.token_transactions.findUnique.mockResolvedValue(null);
    prisma.token_transactions.create.mockImplementation(async (args: any) => ({
      id: 'tx-uuid',
      ...args.data,
    }));

    setBalance(0);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TokensService,
        { provide: PrismaService, useValue: prisma },
        { provide: RedisService, useValue: redis },
      ],
    }).compile();

    service = module.get<TokensService>(TokensService);
  });

  afterEach(() => {
    jest.restoreAllMocks();
    jest.useRealTimers();
  });

  // ---------------------------------------------------------------------------
  // 1. UTC boundary
  // ---------------------------------------------------------------------------
  describe('UTC boundary', () => {
    it('uses the same UTC day for grants and usage even when local TZ is ahead of UTC', async () => {
      // Local wall clock: 2026-11-29 06:30 in Asia/Ho_Chi_Minh (+07:00).
      // UTC: 2026-11-28 23:30 -- the grant must belong to 2026-11-28, not 29.
      const originalTz = process.env.TZ;
      process.env.TZ = 'Asia/Ho_Chi_Minh';
      jest.useFakeTimers().setSystemTime(new Date('2026-11-28T23:30:00.000Z'));
      try {
        setBalance(5);

        const applied = await service.checkAndApplyDailyTopup(USER);

        expect(applied).toBe(true);
        const createdDay = grants.delegate.create.mock.calls[0][0].data.day;
        expect(utcDayOf(createdDay)).toBe('2026-11-28');

        // todayUsed must aggregate the same UTC window [2026-11-28 00:00Z,
        // 2026-11-29 00:00Z), not the local day.
        await service.getBalance(USER);
        expect(prisma.token_transactions.aggregate).toHaveBeenCalledWith(
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
        process.env.TZ = originalTz;
      }
    });

    it('uses the same UTC day for grants and usage even when local TZ is behind UTC', async () => {
      // Local wall clock: 2026-11-28 16:00 in America/Los_Angeles (-08:00).
      // UTC: 2026-11-29 00:00 -- the grant must belong to 2026-11-29, not 28.
      const originalTz = process.env.TZ;
      process.env.TZ = 'America/Los_Angeles';
      jest.useFakeTimers().setSystemTime(new Date('2026-11-29T00:00:00.000Z'));
      try {
        setBalance(0);

        const applied = await service.checkAndApplyDailyTopup(USER);

        expect(applied).toBe(true);
        const createdDay = grants.delegate.create.mock.calls[0][0].data.day;
        expect(utcDayOf(createdDay)).toBe('2026-11-29');
      } finally {
        process.env.TZ = originalTz;
      }
    });

    it('treats 23:59:59 UTC and 00:00:00 UTC as different grant days', async () => {
      // First grant at 2026-11-28 23:59:59 UTC.
      jest.useFakeTimers().setSystemTime(new Date('2026-11-28T23:59:59.000Z'));
      setBalance(0);
      await service.checkAndApplyDailyTopup(USER);
      expect(utcDayOf(grants.delegate.create.mock.calls[0][0].data.day)).toBe(
        '2026-11-28',
      );

      // One second later the day has rolled; a second grant is allowed and
      // belongs to 2026-11-29.
      jest.setSystemTime(new Date('2026-11-29T00:00:00.000Z'));
      setBalance(0);
      await service.checkAndApplyDailyTopup(USER);
      expect(utcDayOf(grants.delegate.create.mock.calls[1][0].data.day)).toBe(
        '2026-11-29',
      );
    });
  });

  // ---------------------------------------------------------------------------
  // 2. Replay
  // ---------------------------------------------------------------------------
  describe('replay', () => {
    it('treats a P2002 conflict on the top-up marker as a replay without re-crediting', async () => {
      setBalance(10);
      // Pre-seed the marker so the create call hits the unique constraint.
      seedMarker('DAILY_TOPUP', utcDayOf(new Date()), 20);

      const applied = await service.checkAndApplyDailyTopup(USER);

      expect(applied).toBe(false);
      // No new ledger entry, no additional balance increment.
      expect(prisma.token_transactions.create).not.toHaveBeenCalled();
      // The upsert path (which would increment balance) must not run.
      const upsertCalls = prisma.user_token_balance.upsert.mock.calls;
      const creditCalls = upsertCalls.filter(
        (c: any) =>
          typeof c[0]?.update?.balance?.increment === 'number' &&
          c[0].update.balance.increment > 0,
      );
      expect(creditCalls).toHaveLength(0);
    });

    it('treats a P2002 conflict on the check-in marker as a replay with alreadyCheckedIn=true', async () => {
      setBalance(100);
      seedMarker('DAILY_CHECKIN', utcDayOf(new Date()), 5);

      const result = await service.dailyCheckIn(USER);

      expect(result.alreadyCheckedIn).toBe(true);
      expect(result.tokensEarned).toBe(0);
      expect(prisma.token_transactions.create).not.toHaveBeenCalled();
    });

    it('preserves the original grant when a P2002 conflict races the marker read-back', async () => {
      const today = utcDayOf(new Date());
      const key = `daily_topup:${USER}:${today}`;
      setBalance(0);

      // A concurrent transaction has already inserted the ledger row, but the
      // marker row is not yet visible to this caller. Simulate the P2002 from
      // the marker insert; the ledger lookup must reconstruct the original
      // amount instead of failing or crediting again.
      const err: any = new Error('Unique constraint failed');
      err.code = 'P2002';
      grants.delegate.create.mockRejectedValueOnce(err);
      prisma.token_transactions.findUnique.mockImplementation(
        async ({ where }: any) =>
          where.idempotency_key === key
            ? {
                user_id: USER,
                amount: 30,
                balance_after: 30,
                idempotency_key: key,
              }
            : null,
      );

      const applied = await service.checkAndApplyDailyTopup(USER);

      expect(applied).toBe(false); // replay, not a fresh grant
      // The committed ledger row is untouched: no new credit is written.
      const creditCalls = (
        prisma.token_transactions.create as jest.Mock
      ).mock.calls.filter(
        (c: any) =>
          c[0].data.type === 'daily_topup' && c[0].data.amount > 0,
      );
      expect(creditCalls).toHaveLength(0);
      expect(prisma.token_transactions.findUnique).toHaveBeenCalledWith({
        where: { idempotency_key: key },
      });
    });
  });

  // ---------------------------------------------------------------------------
  // 3. Cache loss
  // ---------------------------------------------------------------------------
  describe('cache loss', () => {
    it('does not re-grant a top-up when the Redis marker is wiped but the DB marker exists', async () => {
      const today = utcDayOf(new Date());
      seedMarker('DAILY_TOPUP', today, 30);
      // Redis has been flushed: get() returns null for every key.
      redis.get.mockResolvedValue(null);
      setBalance(30);

      const applied = await service.checkAndApplyDailyTopup(USER);

      expect(applied).toBe(false);
      expect(prisma.token_transactions.create).not.toHaveBeenCalled();
      const creditCalls = (
        prisma.user_token_balance.upsert as jest.Mock
      ).mock.calls.filter(
        (c: any) =>
          typeof c[0]?.update?.balance?.increment === 'number' &&
          c[0].update.balance.increment > 0,
      );
      expect(creditCalls).toHaveLength(0);
    });

    it('does not re-grant a check-in when the Redis cache is wiped but the DB marker exists', async () => {
      const today = utcDayOf(new Date());
      seedMarker('DAILY_CHECKIN', today, 5);
      redis.get.mockResolvedValue(null);
      setBalance(100);

      const result = await service.dailyCheckIn(USER);

      expect(result.alreadyCheckedIn).toBe(true);
      expect(result.tokensEarned).toBe(0);
      expect(prisma.token_transactions.create).not.toHaveBeenCalled();
    });

    it('does not re-grant when the Redis marker claims today but the DB marker is missing', async () => {
      // Redis says "already topped up today" but the DB has no marker. The
      // service must still perform the real grant instead of trusting the
      // cache -- a Redis-only fixture must never suppress a real grant.
      const today = utcDayOf(new Date());
      redis.get.mockImplementation(async (key: string) =>
        key === `token:last_topup:${USER}` ? today : null,
      );
      setBalance(5);

      const applied = await service.checkAndApplyDailyTopup(USER);

      expect(applied).toBe(true);
      expect(grants.delegate.create).toHaveBeenCalledTimes(1);
      expect(prisma.token_transactions.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            type: 'daily_topup',
            amount: 25, // top up to 30 from 5
            idempotency_key: `daily_topup:${USER}:${today}`,
          }),
        }),
      );
    });

    it('still grants when Redis is completely unavailable', async () => {
      redis.get.mockRejectedValue(new Error('ECONNREFUSED'));
      setBalance(0);

      const applied = await service.checkAndApplyDailyTopup(USER);

      expect(applied).toBe(true);
      expect(grants.delegate.create).toHaveBeenCalledTimes(1);
    });
  });

  // ---------------------------------------------------------------------------
  // 4. Balance >= 30 (top-up-to-30 policy, not flat 30)
  // ---------------------------------------------------------------------------
  describe('balance >= 30', () => {
    it('credits only the difference when balance is below 30', async () => {
      setBalance(12);

      const applied = await service.checkAndApplyDailyTopup(USER);

      expect(applied).toBe(true);
      expect(prisma.token_transactions.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            type: 'daily_topup',
            amount: 18, // 30 - 12
          }),
        }),
      );
      const created = grants.delegate.create.mock.calls[0][0].data;
      expect(created.amount).toBe(18);
    });

    it('writes a zero-amount marker and does not credit when balance is exactly 30', async () => {
      setBalance(30);

      const applied = await service.checkAndApplyDailyTopup(USER);

      expect(applied).toBe(true); // first grant of the day, still processed
      const created = grants.delegate.create.mock.calls[0][0].data;
      expect(created.amount).toBe(0);
      // No ledger row for a zero-amount grant (service skips the tx write).
      expect(prisma.token_transactions.create).not.toHaveBeenCalled();
    });

    it('writes a zero-amount marker and does not credit when balance exceeds 30', async () => {
      setBalance(120);

      const applied = await service.checkAndApplyDailyTopup(USER);

      expect(applied).toBe(true);
      const created = grants.delegate.create.mock.calls[0][0].data;
      expect(created.amount).toBe(0);
      expect(prisma.token_transactions.create).not.toHaveBeenCalled();
    });

    it('prevents a second top-up the same day after a large purchase leaves the balance below 30', async () => {
      // Morning: balance is 120. Top-up writes a zero-amount marker.
      setBalance(120);
      const first = await service.checkAndApplyDailyTopup(USER);
      expect(first).toBe(true);
      expect(grants.delegate.create.mock.calls[0][0].data.amount).toBe(0);

      // Mid-day: user spends 100, balance drops to 20.
      setBalance(20);

      // Second call the same day must NOT top up -- the marker already exists.
      const second = await service.checkAndApplyDailyTopup(USER);
      expect(second).toBe(false);
      expect(grants.delegate.create).toHaveBeenCalledTimes(1); // no new marker
      expect(prisma.token_transactions.create).not.toHaveBeenCalled();
    });

    it('allows a fresh top-up on the next UTC day even when the previous day ended with a zero-amount marker', async () => {
      // Day 1: balance 50, zero-amount marker written.
      jest.useFakeTimers().setSystemTime(new Date('2026-11-28T12:00:00.000Z'));
      setBalance(50);
      await service.checkAndApplyDailyTopup(USER);
      expect(utcDayOf(grants.delegate.create.mock.calls[0][0].data.day)).toBe(
        '2026-11-28',
      );
      expect(grants.delegate.create.mock.calls[0][0].data.amount).toBe(0);

      // Day 2: balance is now 5 (user spent down). A new grant is allowed.
      jest.setSystemTime(new Date('2026-11-29T00:00:00.000Z'));
      setBalance(5);
      const applied = await service.checkAndApplyDailyTopup(USER);
      expect(applied).toBe(true);
      expect(grants.delegate.create).toHaveBeenCalledTimes(2);
      const second = grants.delegate.create.mock.calls[1][0].data;
      expect(utcDayOf(second.day)).toBe('2026-11-29');
      expect(second.amount).toBe(25); // 30 - 5
    });
  });
});
