/**
 * TEST-05 / BILL-04 — Token integration DB.
 *
 * PostgreSQL-only integration suite for the TokensService debit / settle /
 * refund / replay invariants. The suite probes the database in beforeAll and
 * uses describe.skip with a documented reason when the database is
 * unreachable, so CI on dev machines without PostgreSQL does not fail.
 *
 * Run with: pnpm --filter api test:e2e -- tokens-db
 *
 * Prerequisites:
 *   - PostgreSQL reachable at DATABASE_URL or localhost:5432/linguaai_test
 *     (e.g. `docker compose up db`).
 *   - Prisma client regenerated after 20261128001000_add_daily_credit_grants
 *     so the daily_credit_grants delegate is present.
 */

import { Test, TestingModule } from '@nestjs/testing';
import { PrismaClient } from '../src/generated/prisma';
import { Pool } from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';
import { TokensService } from '../src/tokens/tokens.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { RedisService } from '../src/common/services/redis.service';
import { FakeRedis } from './fixtures/chat-billing.fixture';

const DB_URL =
  process.env.DATABASE_URL ||
  'postgresql://linguaai:linguaai_secret@localhost:5432/linguaai_test';

/** Fixed UUIDs so assertions can reference rows by stable id. */
const USERS = {
  alice: {
    id: '11111111-1111-4111-8111-111111111111',
    email: 'tokens-db-alice@example.com',
  },
  bob: {
    id: '22222222-2222-4222-8222-222222222222',
    email: 'tokens-db-bob@example.com',
  },
  carol: {
    id: '33333333-3333-4333-8333-333333333333',
    email: 'tokens-db-carol@example.com',
  },
} as const;

/**
 * Probe the database synchronously before the suite runs. When the probe
 * fails the suite is skipped with a documented reason rather than failing
 * CI on dev machines that do not run PostgreSQL.
 *
 * We use a synchronous probe result stored in a module-level variable so
 * the describe block can decide whether to register tests. The probe runs
 * once when the file is loaded; Jest's worker will surface any error.
 */
let probeResult: { ok: true } | { ok: false; reason: string } = {
  ok: false,
  reason: 'probe not yet run',
};

async function probeDatabase(): Promise<
  { ok: true } | { ok: false; reason: string }
> {
  let pool: Pool | undefined;
  try {
    pool = new Pool({
      connectionString: DB_URL,
      connectionTimeoutMillis: 2000,
    });
    await pool.query('SELECT 1');
    return { ok: true };
  } catch (err: any) {
    return {
      ok: false,
      reason: `PostgreSQL unreachable at ${DB_URL}: ${err?.message ?? err}`,
    };
  } finally {
    if (pool) {
      await pool.end().catch(() => undefined);
    }
  }
}

/**
 * Seed three synthetic users with fixed balances via Prisma directly. No HTTP
 * login, no bcrypt mock — keeps the suite fast and focused on billing
 * primitives. Uses a deterministic password hash so the users row is valid
 * even though the suite never authenticates through the auth flow.
 */
async function seedUsers(prisma: PrismaClient): Promise<void> {
  await prisma.$executeRaw`TRUNCATE TABLE users CASCADE`;

  const placeholderHash =
    '$2b$10$tokensDbSuitePlaceholderHashNotForAuthUse000000000000';

  for (const u of Object.values(USERS)) {
    await prisma.users.create({
      data: {
        id: u.id,
        email: u.email,
        password: placeholderHash,
        first_name: 'TokensDb',
        last_name: u.email.split('@')[0].split('-').pop() ?? 'User',
        email_verified: true,
      },
    });
  }

  // Alice: plenty of balance for happy-path and concurrent races.
  await prisma.user_token_balance.create({
    data: { user_id: USERS.alice.id, balance: 1000 },
  });
  // Bob: just enough for one ai_chat (5) but not two.
  await prisma.user_token_balance.create({
    data: { user_id: USERS.bob.id, balance: 7 },
  });
  // Carol: zero balance, used for insufficient-balance and refund-without-debit.
  await prisma.user_token_balance.create({
    data: { user_id: USERS.carol.id, balance: 0 },
  });
}

/**
 * The describe block is registered unconditionally; the probe runs inside
 * beforeAll and each test checks the probe result before asserting. When
 * the database is unreachable every test returns early and the suite
 * surfaces a single skip message.
 */
describe('TokensService — DB integration (TEST-05 / BILL-04)', () => {
  let prisma: PrismaClient | undefined;
  let pool: Pool | undefined;
  let service: TokensService | undefined;
  let redis: FakeRedis | undefined;

  beforeAll(async () => {
    probeResult = await probeDatabase();
    if (!probeResult.ok) return;

    pool = new Pool({ connectionString: DB_URL });
    prisma = new PrismaClient({ adapter: new PrismaPg(pool) });

    redis = new FakeRedis();

    const moduleRef: TestingModule = await Test.createTestingModule({
      providers: [
        TokensService,
        { provide: PrismaService, useValue: prisma },
        { provide: RedisService, useValue: redis },
      ],
    }).compile();

    service = moduleRef.get<TokensService>(TokensService);

    await seedUsers(prisma);
  });

  afterAll(async () => {
    if (!probeResult.ok) return;
    await prisma?.$disconnect();
    await pool?.end();
  });

  beforeEach(async () => {
    if (!probeResult.ok || !prisma || !redis) return;
    // Reset ledger and balances between tests so each case starts from a
    // known state. The daily_credit_grants table is truncated together with
    // users by the CASCADE in seedUsers; we only need to re-seed balances.
    await prisma.token_transactions.deleteMany({});
    await prisma.daily_credit_grants.deleteMany({});
    await prisma.user_token_balance.updateMany({
      where: { user_id: { in: Object.values(USERS).map((u) => u.id) } },
      data: { balance: 0 },
    });
    await prisma.user_token_balance.update({
      where: { user_id: USERS.alice.id },
      data: { balance: 1000 },
    });
    await prisma.user_token_balance.update({
      where: { user_id: USERS.bob.id },
      data: { balance: 7 },
    });
    // Carol stays at 0.
    redis.store.clear();
    redis.delCalls.length = 0;
  });

  function skipGuard(): void {
    if (!probeResult.ok) {
      // eslint-disable-next-line no-console
      console.warn(
        `[tokens-db.e2e-spec] Skipped — ${probeResult.reason}. ` +
          `Start PostgreSQL (e.g. docker compose up db) or set DATABASE_URL to run.`,
      );
    }
  }

  function requireService(): TokensService {
    if (!service) throw new Error('TokensService not initialised');
    return service;
  }

  function requirePrisma(): PrismaClient {
    if (!prisma) throw new Error('PrismaClient not initialised');
    return prisma;
  }

  // ---------------------------------------------------------------------------
  // T-db-01 — reserve + settle happy path
  // ---------------------------------------------------------------------------
  it('T-db-01: reserve debits once and settle records a zero-amount marker without a second debit', async () => {
    if (!probeResult.ok) return skipGuard();
    const svc = requireService();
    const db = requirePrisma();

    const opId = 'op-db01-happy';
    const feature = 'ai_chat';
    const cost = svc.getFeatureCost(feature); // 5

    const reserve = await svc.reserveTokens(USERS.alice.id, opId, feature);
    expect(reserve.duplicate).toBe(false);
    expect(reserve.cost).toBe(cost);
    expect(reserve.balance).toBe(1000 - cost);

    const settle = await svc.settleTokens(USERS.alice.id, opId, feature);
    expect(settle.duplicate).toBe(false);
    expect(settle.cost).toBe(cost);
    // Settle does not move the balance; it records a zero-amount marker.
    expect(settle.balance).toBe(1000 - cost);

    const txs = await db.token_transactions.findMany({
      where: { user_id: USERS.alice.id },
      orderBy: { created_at: 'asc' },
    });
    // Exactly two ledger rows: one debit (-5) and one settle marker (0).
    expect(txs).toHaveLength(2);
    expect(txs[0].amount).toBe(-cost);
    expect(txs[0].type).toBe('consumption');
    expect(txs[1].amount).toBe(0);
    expect(txs[1].idempotency_key).toContain('settle');

    const balance = await db.user_token_balance.findUnique({
      where: { user_id: USERS.alice.id },
    });
    expect(balance?.balance).toBe(1000 - cost);
  });

  // ---------------------------------------------------------------------------
  // T-db-02 — reserve insufficient balance
  // ---------------------------------------------------------------------------
  it('T-db-02: reserve with insufficient balance throws and leaves the ledger untouched', async () => {
    if (!probeResult.ok) return skipGuard();
    const svc = requireService();
    const db = requirePrisma();

    const opId = 'op-db02-nobalance';
    const feature = 'writing_feedback'; // cost = 10, Bob has 7

    await expect(
      svc.reserveTokens(USERS.bob.id, opId, feature),
    ).rejects.toThrow(/Insufficient token balance/i);

    const txs = await db.token_transactions.findMany({
      where: { user_id: USERS.bob.id },
    });
    expect(txs).toHaveLength(0);

    const balance = await db.user_token_balance.findUnique({
      where: { user_id: USERS.bob.id },
    });
    expect(balance?.balance).toBe(7);
  });

  // ---------------------------------------------------------------------------
  // T-db-03 — reserve idempotent replay
  // ---------------------------------------------------------------------------
  it('T-db-03: replaying the same operation id returns the original result without a second debit', async () => {
    if (!probeResult.ok) return skipGuard();
    const svc = requireService();
    const db = requirePrisma();

    const opId = 'op-db03-replay';
    const feature = 'ai_chat';
    const cost = svc.getFeatureCost(feature);

    const first = await svc.reserveTokens(USERS.alice.id, opId, feature);
    expect(first.duplicate).toBe(false);
    expect(first.balance).toBe(1000 - cost);

    const second = await svc.reserveTokens(USERS.alice.id, opId, feature);
    expect(second.duplicate).toBe(true);
    expect(second.balance).toBe(first.balance);
    expect(second.cost).toBe(cost);

    const txs = await db.token_transactions.findMany({
      where: { user_id: USERS.alice.id },
    });
    // Only one debit row, even after two reserve calls.
    const debits = txs.filter((t) => t.amount < 0);
    expect(debits).toHaveLength(1);
    expect(debits[0].amount).toBe(-cost);
  });

  // ---------------------------------------------------------------------------
  // T-db-04 — reserve concurrent race (10-way)
  // ---------------------------------------------------------------------------
  it('T-db-04: 10-way concurrent reserve on the same operation id produces exactly one debit', async () => {
    if (!probeResult.ok) return skipGuard();
    const svc = requireService();
    const db = requirePrisma();

    const opId = 'op-db04-race';
    const feature = 'ai_chat';
    const cost = svc.getFeatureCost(feature);

    const results = await Promise.all(
      Array.from({ length: 10 }, () =>
        svc.reserveTokens(USERS.alice.id, opId, feature).catch((e) => e),
      ),
    );

    const successes = results.filter(
      (r) => r && typeof r === 'object' && 'balance' in r,
    ) as Array<{ balance: number; cost: number; duplicate: boolean }>;
    expect(successes.length).toBeGreaterThanOrEqual(1);

    // Every successful replay reports the same balance.
    const balances = new Set(successes.map((s) => s.balance));
    expect(balances.size).toBe(1);
    expect(balances.has(1000 - cost)).toBe(true);

    // Exactly one debit row in the ledger.
    const txs = await db.token_transactions.findMany({
      where: { user_id: USERS.alice.id, type: 'consumption' },
    });
    const debits = txs.filter((t) => t.amount < 0);
    expect(debits).toHaveLength(1);

    const balance = await db.user_token_balance.findUnique({
      where: { user_id: USERS.alice.id },
    });
    expect(balance?.balance).toBe(1000 - cost);
  });

  // ---------------------------------------------------------------------------
  // T-db-05 — refund after reserve (at-most-once)
  // ---------------------------------------------------------------------------
  it('T-db-05: refund after reserve restores the balance exactly once; replaying refund is a no-op', async () => {
    if (!probeResult.ok) return skipGuard();
    const svc = requireService();
    const db = requirePrisma();

    const opId = 'op-db05-refund';
    const feature = 'ai_chat';
    const cost = svc.getFeatureCost(feature);

    await svc.reserveTokens(USERS.alice.id, opId, feature);

    const first = await svc.refundTokens(USERS.alice.id, opId, feature);
    expect(first.duplicate).toBe(false);
    expect(first.refunded).toBe(cost);
    // Balance is restored to the pre-debit value.
    expect(first.balance).toBe(1000);

    const second = await svc.refundTokens(USERS.alice.id, opId, feature);
    expect(second.duplicate).toBe(true);
    expect(second.balance).toBe(first.balance);
    expect(second.refunded).toBe(cost);

    const txs = await db.token_transactions.findMany({
      where: { user_id: USERS.alice.id },
    });
    const refunds = txs.filter((t) => t.type === 'refund');
    expect(refunds).toHaveLength(1);
    expect(refunds[0].amount).toBe(cost);
  });

  // ---------------------------------------------------------------------------
  // T-db-06 — refund without debit (NotFoundException)
  // ---------------------------------------------------------------------------
  it('T-db-06: refund without a prior debit throws NotFoundException', async () => {
    if (!probeResult.ok) return skipGuard();
    const svc = requireService();

    const opId = 'op-db06-norefund';
    const feature = 'ai_chat';

    await expect(
      svc.refundTokens(USERS.alice.id, opId, feature),
    ).rejects.toThrow(/no debit to refund/i);
  });

  // ---------------------------------------------------------------------------
  // T-db-07 — settle without debit (NotFoundException)
  // ---------------------------------------------------------------------------
  it('T-db-07: settle without a prior debit throws NotFoundException', async () => {
    if (!probeResult.ok) return skipGuard();
    const svc = requireService();

    const opId = 'op-db07-nosettle';
    const feature = 'ai_chat';

    await expect(
      svc.settleTokens(USERS.alice.id, opId, feature),
    ).rejects.toThrow(/no debit to settle/i);
  });

  // ---------------------------------------------------------------------------
  // T-db-08 — settle after refund (ConflictException)
  // ---------------------------------------------------------------------------
  it('T-db-08: settle after refund throws ConflictException', async () => {
    if (!probeResult.ok) return skipGuard();
    const svc = requireService();

    const opId = 'op-db08-settle-after-refund';
    const feature = 'ai_chat';

    await svc.reserveTokens(USERS.alice.id, opId, feature);
    await svc.refundTokens(USERS.alice.id, opId, feature);

    await expect(
      svc.settleTokens(USERS.alice.id, opId, feature),
    ).rejects.toThrow(/Refunded operations cannot be settled/i);
  });

  // ---------------------------------------------------------------------------
  // T-db-09 — unknown feature (BadRequestException)
  // ---------------------------------------------------------------------------
  it('T-db-09: reserve with an unknown feature throws BadRequestException', async () => {
    if (!probeResult.ok) return skipGuard();
    const svc = requireService();
    const db = requirePrisma();

    const opId = 'op-db09-unknown';

    await expect(
      svc.reserveTokens(USERS.alice.id, opId, 'nonexistent_feature'),
    ).rejects.toThrow(/valid operationId and known feature/i);

    const txs = await db.token_transactions.findMany({
      where: { user_id: USERS.alice.id },
    });
    expect(txs).toHaveLength(0);
  });

  // ---------------------------------------------------------------------------
  // T-db-10 — daily top-up no double grant same UTC day
  // ---------------------------------------------------------------------------
  it('T-db-10: daily top-up is granted at most once per UTC day, even across concurrent calls', async () => {
    if (!probeResult.ok) return skipGuard();
    const svc = requireService();
    const db = requirePrisma();

    // Carol starts at 0. The first reserve triggers the daily top-up inside
    // the same Serializable transaction as the debit. We use a cheap feature
    // (ai_chat = 5) so the top-up (30) covers it.
    const opId = 'op-db10-daily';
    const feature = 'ai_chat';

    // Fire several concurrent reserves; the daily grant must commit exactly
    // once. We assert on the daily_credit_grants marker row directly to
    // avoid UTC-midnight flakiness.
    await Promise.all(
      Array.from({ length: 5 }, () =>
        svc.reserveTokens(USERS.carol.id, opId, feature).catch(() => null),
      ),
    );

    const grants = await db.daily_credit_grants.findMany({
      where: { user_id: USERS.carol.id },
    });
    expect(grants).toHaveLength(1);
    expect(grants[0].grant_type).toBe('DAILY_TOPUP');
    expect(grants[0].amount).toBe(30); // FREE_DAILY_TOKENS

    // The ledger contains exactly one top-up transaction for this user today.
    const txs = await db.token_transactions.findMany({
      where: { user_id: USERS.carol.id, feature: 'daily_topup' },
    });
    expect(txs).toHaveLength(1);
    expect(txs[0].amount).toBe(30);
  });

  // ---------------------------------------------------------------------------
  // T-db-11 — ledger key length bound for long operation ids
  // ---------------------------------------------------------------------------
  it('T-db-11: ledger keys for long operation ids stay within the VARCHAR(128) bound', async () => {
    if (!probeResult.ok) return skipGuard();
    const svc = requireService();
    const db = requirePrisma();

    // 200-character operation id; the service must hash-truncate the key so
    // it still fits the idempotency_key column.
    const longId = 'op-'.padEnd(200, 'x');
    const feature = 'ai_chat';

    const result = await svc.reserveTokens(USERS.alice.id, longId, feature);
    expect(result.duplicate).toBe(false);

    const txs = await db.token_transactions.findMany({
      where: { user_id: USERS.alice.id },
    });
    expect(txs).toHaveLength(1);
    const key = txs[0].idempotency_key;
    expect(key).not.toBeNull();
    expect(key!.length).toBeLessThanOrEqual(128);

    // Replay with the same long id must hit the same truncated key.
    const replay = await svc.reserveTokens(USERS.alice.id, longId, feature);
    expect(replay.duplicate).toBe(true);
    expect(replay.balance).toBe(result.balance);

    const txsAfter = await db.token_transactions.findMany({
      where: { user_id: USERS.alice.id },
    });
    // Still only one debit row.
    expect(txsAfter.filter((t) => t.amount < 0)).toHaveLength(1);
  });
});
