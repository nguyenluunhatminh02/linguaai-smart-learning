import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { RedisService } from "../common/services/redis.service";

export namespace TokensService {
  /** Statuses the BILL-03 layer may pass when asking for settle/refund. */
  export type OperationStatus = "RESERVED" | "RUNNING" | "SUCCEEDED" | "FAILED" | "UNKNOWN" | "CANCELLED";

  /**
   * Minimal operation view needed for token accounting. BILL-03 owns the real
   * ai_operations row and may pass a richer object; only these fields are read.
   */
  export interface BillingOperation {
    operationId: string;
    user?: string;
    userId?: string;
    feature?: string;
    charge?: number;
    status?: OperationStatus;
  }
}

@Injectable()
export class TokensService {
  private readonly logger = new Logger(TokensService.name);

  /** Explicit version: bump only with a deliberate pricing change. */
  static readonly PRICING_VERSION = "1";

  /**
   * Server-side pricing catalog (single source of truth). Frozen so callers
   * cannot mutate prices at runtime; the public read-only method returns a
   * snapshot rather than this live object.
   */
  private static readonly PRICING_CATALOG: {
    readonly version: string;
    readonly costs: Readonly<Record<string, number>>;
  } = Object.freeze({
    version: TokensService.PRICING_VERSION,
    costs: Object.freeze({
      ai_chat: 5,
      writing_feedback: 10,
      reading_generate: 8,
      grammar_explain: 5,
      listening_generate: 8,
      quiz_generate: 6,
      translation_ai: 3,
      speaking_feedback: 10,
      learning_path: 5,
      cards_generate: 10,
    }),
  });

  /** Daily free tokens granted to all users at midnight. */
  private static readonly FREE_DAILY_TOKENS = 30;
  private static readonly REDIS_BALANCE_TTL = 300; // 5 minutes cache
  private static readonly REDIS_TOPUP_TTL = 86400; // 24 hours cache
  private static readonly REDIS_CHECKIN_TTL = 86400; // 24 hours cache

  // BILL-05: the durable daily markers are the authority; Redis is only a
  // read-through cache. Letting a stale/generated-before-migration Prisma
  // client see the model through a narrow typed facade avoids a generator
  // dependency in this slice while keeping every query typed.
  private static readonly GRANT_TYPES = {
    DAILY_TOPUP: "DAILY_TOPUP",
    DAILY_CHECKIN: "DAILY_CHECKIN",
  } as const;
  private static readonly GRANT_IDEMPOTENCY_PREFIXES = {
    DAILY_TOPUP: "daily_topup",
    DAILY_CHECKIN: "daily_checkin",
  } as const;
  private static readonly MS_PER_UTC_DAY = 86_400_000;
  private static readonly CHECKIN_BONUSES = [5, 5, 8, 8, 10, 10, 15] as const;

  /** Bounded, jittered retries for serialization failures (P2034). */
  private static readonly BILLING_RETRY_ATTEMPTS = 3;
  private static readonly BILLING_RETRY_BASE_MS = 5;
  private static readonly BILLING_RETRY_MAX_MS = 50;
  private static readonly BILLING_TX_OPTIONS = { isolationLevel: "Serializable" as const };
  private static readonly BILLING_LEDGER_MAX_KEY_LENGTH = 128;

  /** Operation-scoped billing phases; all keys remain unique inside the ledger. */
  private static readonly BILLING_ENTRY_KINDS = ["debit", "settle", "refund"] as const;
  private static readonly SETTLE_FROM_STATUSES: readonly TokensService.OperationStatus[] = ["RESERVED", "RUNNING", "UNKNOWN"];
  private static readonly REFUND_FROM_STATUSES: readonly TokensService.OperationStatus[] = ["RESERVED", "RUNNING", "UNKNOWN", "FAILED", "CANCELLED"];

  constructor(
    private prisma: PrismaService,
    private redis: RedisService,
  ) {}

  /** Read-only catalog snapshot for UI/API consumers; serializable as JSON. */
  getPricingCatalog(): {
    readonly version: string;
    readonly costs: Readonly<Record<string, number>>;
  } {
    return TokensService.PRICING_CATALOG;
  }

  /** Resolve a feature's server-side price; the single pricing lookup path. */
  getFeatureCost(feature: string): number {
    const cost = TokensService.PRICING_CATALOG.costs[feature];
    if (cost === undefined) {
      throw new BadRequestException(`Unknown feature: ${feature}`);
    }
    return cost;
  }

  /**
   * Get current balance + today's usage. The daily top-up is decided only by
   * the durable DB marker, so a stale or fixture-populated Redis cache cannot
   * authorize a second top-up. Only the balance display itself is cached.
   */
  async getBalance(userId: string) {
    await this.checkAndApplyDailyTopup(userId);

    let balance: number | null = null;
    try {
      const cached = await this.redis.get(`token:balance:${userId}`);
      if (cached !== null && Number.isSafeInteger(Number(cached))) {
        balance = Number(cached);
      }
    } catch (err: any) {
      this.logger.warn(`Failed to read balance cache: ${err.message}`);
    }

    if (balance === null) {
      // Fallback to DB. A missing row is initialized with the published
      // daily allowance; grants and debits reconcile this cache on commit.
      const record = await this.prisma.user_token_balance.findUnique({
        where: { user_id: userId },
        select: { balance: true },
      });

      if (!record) {
        const newRecord = await this.prisma.user_token_balance.create({
          data: { user_id: userId, balance: TokensService.FREE_DAILY_TOKENS },
        });
        balance = newRecord.balance;
      } else {
        balance = record.balance;
      }

      try {
        await this.redis.set(`token:balance:${userId}`, balance.toString(), TokensService.REDIS_BALANCE_TTL);
      } catch (err: any) {
        this.logger.warn(`Failed to update balance cache: ${err.message}`);
      }
    }

    return {
      balance,
      todayUsed: await this.todayUsed(userId),
      freeDailyTokens: TokensService.FREE_DAILY_TOKENS,
      freeDailyLimit: TokensService.FREE_DAILY_TOKENS, // support both keys just in case
    };
  }

  /**
   * Atomically deduct tokens for a feature usage.
   * Uses a transaction with Serializable isolation level to guarantee balance never goes negative.
   * Implements request idempotency.
   */
  async consumeTokens(userId: string, feature: string, _cost?: number, idempotencyKey?: string) {
    // Pricing is server-authoritative. The optional client-supplied cost is
    // deliberately ignored: callers must never be able to choose what they pay.
    // Unknown features are rejected before any database access.
    const actualCost = this.getFeatureCost(feature);

    // Check idempotency first. A key is only valid for the caller, feature and
    // amount that created it; never return another user's balance or bypass
    // the debit just because a key collided or was replayed by someone else.
    if (idempotencyKey) {
      const existing = await this.prisma.token_transactions.findUnique({
        where: { idempotency_key: idempotencyKey },
      });
      const conflicting =
        existing &&
        ((existing.user_id !== undefined && existing.user_id !== userId) ||
         (existing.feature !== undefined && existing.feature !== feature) ||
         existing.amount !== -actualCost);
      if (existing && !conflicting) {
        this.logger.log(`Idempotency key hit: ${idempotencyKey}. Returning duplicate transaction output.`);
        return { balance: existing.balance_after, cost: Math.abs(existing.amount) };
      }
      if (conflicting) {
        throw new BadRequestException('Idempotency key already used for a different request');
      }
    }

    // Check and apply daily top-up first
    await this.checkAndApplyDailyTopup(userId);

    const result = await this.prisma.$transaction(async (tx) => {
      const row = await tx.user_token_balance.findUnique({
        where: { user_id: userId },
      });
      const currentBalance = row?.balance ?? 0;

      if (currentBalance < actualCost) {
        throw new ForbiddenException(
          `Insufficient token balance: need ${actualCost}, have ${currentBalance}`,
        );
      }

      const newBalance = currentBalance - actualCost;

      await tx.user_token_balance.upsert({
        where: { user_id: userId },
        create: { user_id: userId, balance: newBalance },
        update: { balance: newBalance },
      });

      await tx.token_transactions.create({
        data: {
          user_id: userId,
          amount: -actualCost,
          type: "consumption",
          feature,
          balance_after: newBalance,
          idempotency_key: idempotencyKey,
        },
      });

      return { balance: newBalance, cost: actualCost };
    }, {
      isolationLevel: "Serializable",
    });

    // Invalidate Redis cache
    await this.invalidateCache(userId);

    return result;
  }

  /**
   * Add tokens to a user's balance (purchase, bonus, refund, daily_topup).
   */
  async addTokens(userId: string, amount: number, type = "purchase", feature = "", idempotencyKey?: string) {
    // Grants must never debit an account. Refunds are represented as positive
    // amounts too; consumption is handled exclusively by consumeTokens.
    if (!Number.isSafeInteger(amount) || amount <= 0) {
      throw new BadRequestException('Token grant amount must be a positive integer');
    }

    if (idempotencyKey) {
      const existing = await this.prisma.token_transactions.findUnique({
        where: { idempotency_key: idempotencyKey },
      });
      if (existing) {
        return { balance: existing.balance_after, added: existing.amount, duplicate: true };
      }
    }

    const result = await this.prisma.$transaction(async (tx) => {
      // Atomic increment prevents lost updates when grants/consumes overlap.
      const updated = await tx.user_token_balance.upsert({
        where: { user_id: userId },
        create: { user_id: userId, balance: amount },
        update: { balance: { increment: amount } },
      });
      const newBalance =
        typeof updated?.balance === "number" ? updated.balance : amount;

      await tx.token_transactions.create({
        data: {
          user_id: userId,
          amount,
          type,
          feature: feature || type,
          balance_after: newBalance,
          idempotency_key: idempotencyKey,
        },
      });

      return { balance: newBalance, added: amount };
    }, {
      isolationLevel: "Serializable",
    });

    // Invalidate Redis cache
    await this.invalidateCache(userId);

    this.logger.log(`Added ${amount} tokens (${type}) for user ${userId}; new balance: ${result.balance}`);
    return result;
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // BILL-05: daily grants. The daily_credit_grants row is the authority; Redis
  // is a read-through cache only. Every boundary is the same UTC midnight.
  // ─────────────────────────────────────────────────────────────────────────────

  /** One shared UTC day identity for grants, usage and streak arithmetic. */
  private static utcDay(now = new Date()): { day: string; start: Date; endExclusive: Date } {
    const day = now.toISOString().slice(0, 10); // YYYY-MM-DD UTC
    const startMs = Date.parse(`${day}T00:00:00.000Z`);
    return {
      day,
      start: new Date(startMs),
      endExclusive: new Date(startMs + TokensService.MS_PER_UTC_DAY),
    };
  }

  /** Shift a UTC day string by whole days without local-time rounding. */
  private static shiftUtcDay(day: string, deltaDays: number): string {
    return new Date(Date.parse(`${day}T00:00:00.000Z`) + deltaDays * TokensService.MS_PER_UTC_DAY)
      .toISOString()
      .slice(0, 10);
  }

  /**
   * Narrow typed access to daily_credit_grants. The migration is present but
   * the generated Prisma client in this checkout predates the model, so the
   * delegate is described here instead of relying on a generator run.
   */
  private static grantDelegate(client: any): {
    findUnique(args: {
      where: { user_id_grant_type_day: { user_id: string; grant_type: string; day: Date } };
      select?: { amount?: true };
    }): Promise<{ amount: number } | null>;
    findMany(args: {
      where: { user_id: string; grant_type?: string; day?: { gte?: Date; lte?: Date } };
      select: { day: true; amount?: true };
      orderBy: { day: "asc" | "desc" };
    }): Promise<Array<{ day: Date; amount?: number }>>;
    create(args: {
      data: { user_id: string; grant_type: string; day: Date; amount: number };
    }): Promise<{ amount: number }>;
  } {
    const delegate = client?.daily_credit_grants;
    if (
      !delegate ||
      typeof delegate.findUnique !== "function" ||
      typeof delegate.findMany !== "function" ||
      typeof delegate.create !== "function"
    ) {
      throw new Error("daily_credit_grants is unavailable: apply the BILL-05 migration and regenerate Prisma");
    }
    return delegate;
  }

  private static grantWhere(user_id: string, grant_type: string, day: string) {
    return {
      user_id_grant_type_day: { user_id, grant_type, day: new Date(`${day}T00:00:00.000Z`) },
    };
  }

  /** Deterministic ledger key shared by every phase of a daily grant. */
  private static dailyGrantKey(userId: string, grantType: string, day: string): string {
    const prefix = TokensService.GRANT_IDEMPOTENCY_PREFIXES[grantType as keyof typeof TokensService.GRANT_IDEMPOTENCY_PREFIXES] ?? grantType.toLowerCase();
    return `${prefix}:${userId}:${day}`;
  }

  /** True for a unique-constraint conflict on the marker or ledger key. */
  private static isDailyReplay(error: unknown): boolean {
    return TokensService.isDuplicateKeyError(error);
  }

  /** Read back the marker after a P2002: a replay is a successful no-op. */
  private async readDailyGrant(
    user_id: string,
    grant_type: string,
    day: string,
  ): Promise<{ amount: number } | null> {
    return TokensService.grantDelegate(this.prisma).findUnique({
      where: TokensService.grantWhere(user_id, grant_type, day),
      select: { amount: true },
    });
  }

  /**
   * Apply one daily grant inside the caller's Serializable transaction. The
   * amount comes from the balance read in that same transaction, and a zero
   * amount still writes the marker so a processed UTC day is durable.
   * Returns the already-granted amount for a replay, including a legacy
   * ledger-only grant from before the daily_credit_grants migration.
   */
  private async applyDailyGrantInTx(
    tx: any,
    userId: string,
    day: string,
    grantType: string,
    computeAmount: (balance: number) => number,
  ): Promise<{ amount: number; replay: boolean }> {
    const delegate = TokensService.grantDelegate(tx);
    const where = TokensService.grantWhere(userId, grantType, day);
    const existing = await delegate.findUnique({ where, select: { amount: true } });
    if (existing) return { amount: existing.amount, replay: true };

    const key = TokensService.dailyGrantKey(userId, grantType, day);
    const ledger = await tx.token_transactions.findUnique({
      where: { idempotency_key: key },
    });
    if (ledger && ledger.user_id === userId && ledger.amount > 0) {
      return { amount: ledger.amount, replay: true };
    }

    const row = await tx.user_token_balance.findUnique({
      where: { user_id: userId },
      select: { balance: true },
    });
    const currentBalance = row?.balance ?? 0;
    const amount = computeAmount(currentBalance);
    const newBalance = currentBalance + amount;

    if (amount > 0) {
      await tx.user_token_balance.upsert({
        where: { user_id: userId },
        create: { user_id: userId, balance: newBalance },
        update: { balance: { increment: amount } },
      });
      await tx.token_transactions.create({
        data: {
          user_id: userId,
          amount,
          type: grantType === TokensService.GRANT_TYPES.DAILY_CHECKIN ? "bonus" : "daily_topup",
          feature: grantType === TokensService.GRANT_TYPES.DAILY_CHECKIN ? "daily_checkin" : "daily_topup",
          balance_after: newBalance,
          idempotency_key: key,
        },
      });
    }

    await delegate.create({
      data: { user_id: userId, grant_type: grantType, day: new Date(`${day}T00:00:00.000Z`), amount },
    });
    return { amount, replay: false };
  }

  /** Run one daily grant with bounded serialization retries and P2002 read-back. */
  private async runDailyGrant(
    userId: string,
    grantType: string,
    day: string,
    computeAmount: (balance: number) => number,
  ): Promise<{ amount: number; replay: boolean }> {
    return this.withBillingRetry(async () => {
      try {
        return await this.prisma.$transaction(async (tx) => {
          return this.applyDailyGrantInTx(tx, userId, day, grantType, computeAmount);
        }, TokensService.BILLING_TX_OPTIONS);
      } catch (error: unknown) {
        if (TokensService.isDailyReplay(error)) {
          const marker = await this.readDailyGrant(userId, grantType, day);
          if (marker) return { amount: marker.amount, replay: true };
          // A concurrent transaction may have committed the ledger row first;
          // use it to reconstruct the original grant instead of failing.
          const ledger = await this.readBillingEntry(TokensService.dailyGrantKey(userId, grantType, day));
          if (ledger && ledger.user_id === userId && ledger.amount > 0) {
            return { amount: ledger.amount, replay: true };
          }
          throw new ConflictException("Daily grant could not be confirmed");
        }
        throw error;
      }
    });
  }

  /** Cache a processed day; a cache failure must never change the outcome. */
  private async cacheDailyGrant(key: string, value: string, ttl: number): Promise<void> {
    try {
      await this.redis.set(key, value, ttl);
    } catch (err: any) {
      this.logger.warn(`Failed to update daily grant cache: ${err.message}`);
    }
  }

  /** Read today's consumption using the same UTC boundary as the grants. */
  private async todayUsed(userId: string): Promise<number> {
    const { start, endExclusive } = TokensService.utcDay();
    const agg = await this.prisma.token_transactions.aggregate({
      where: {
        user_id: userId,
        type: "consumption",
        created_at: { gte: start, lt: endExclusive },
      },
      _sum: { amount: true },
    });
    return Math.abs(agg._sum.amount ?? 0);
  }

  /**
   * Daily check-in: grants a bonus once per UTC day. The streak is derived
   * from persisted DAILY_CHECKIN grant days, never from Redis or ledger rows
   * whose timestamp may straddle a day boundary.
   */
  async dailyCheckIn(userId: string) {
    const { day } = TokensService.utcDay();
    const checkinKey = `checkin:${userId}:${day}`;

    // Redis is only an advisory hint; it can be stale or fixture-populated.
    // The DB marker must be consulted before treating a check-in as done.
    try {
      if (await this.redis.get(checkinKey)) {
        const marked = await this.readDailyGrant(userId, TokensService.GRANT_TYPES.DAILY_CHECKIN, day);
        if (marked) {
          const balance = await this.getBalance(userId);
          return {
            balance: balance.balance,
            todayUsed: balance.todayUsed,
            tokensEarned: 0,
            alreadyCheckedIn: true,
            streak: await this.checkInStreak(userId, day, true),
          };
        }
      }
    } catch (err: any) {
      // The cache is advisory; fall through to the durable marker instead of
      // refusing a legitimate check-in when Redis is unavailable.
      this.logger.warn(`Failed to read check-in cache: ${err.message}`);
    }

    const marked = await this.readDailyGrant(userId, TokensService.GRANT_TYPES.DAILY_CHECKIN, day);
    if (marked) {
      await this.cacheDailyGrant(checkinKey, "1", TokensService.REDIS_CHECKIN_TTL);
      const balance = await this.getBalance(userId);
      return {
        balance: balance.balance,
        todayUsed: balance.todayUsed,
        tokensEarned: 0,
        alreadyCheckedIn: true,
        streak: await this.checkInStreak(userId, day, true),
      };
    }

    const bonuses = TokensService.CHECKIN_BONUSES;
    const streak = await this.checkInStreak(userId, day);
    const dailyBonus = bonuses[Math.min(streak, bonuses.length - 1)];

    const grant = await this.runDailyGrant(userId, TokensService.GRANT_TYPES.DAILY_CHECKIN, day, () => dailyBonus);
    await this.cacheDailyGrant(checkinKey, "1", TokensService.REDIS_CHECKIN_TTL);
    if (!grant.replay && grant.amount > 0) await this.invalidateCache(userId);

    const balanceRow = await this.prisma.user_token_balance.findUnique({
      where: { user_id: userId },
      select: { balance: true },
    });
    return {
      balance: balanceRow?.balance ?? (grant.replay ? 0 : dailyBonus),
      todayUsed: await this.todayUsed(userId),
      tokensEarned: grant.replay ? 0 : grant.amount,
      alreadyCheckedIn: grant.replay,
      streak: grant.replay ? await this.checkInStreak(userId, day, true) : streak + 1,
    };
  }

  /** Consecutive granted UTC days ending yesterday, or today when replayed. */
  private async checkInStreak(userId: string, day: string, includeToday = false): Promise<number> {
    const days = await TokensService.grantDelegate(this.prisma).findMany({
      where: {
        user_id: userId,
        grant_type: TokensService.GRANT_TYPES.DAILY_CHECKIN,
        day: {
          gte: new Date(TokensService.shiftUtcDay(day, -TokensService.CHECKIN_BONUSES.length)),
          lte: new Date(`${day}T00:00:00.000Z`),
        },
      },
      select: { day: true },
      orderBy: { day: "desc" },
    });
    const granted = new Set(days.map((row) => row.day.toISOString().slice(0, 10)));
    let cursor = includeToday ? day : TokensService.shiftUtcDay(day, -1);
    let streak = 0;
    while (streak < TokensService.CHECKIN_BONUSES.length && granted.has(cursor)) {
      streak += 1;
      cursor = TokensService.shiftUtcDay(cursor, -1);
    }
    return streak;
  }

  /**
   * Top up to FREE_DAILY_TOKENS at most once per UTC day. When the balance is
   * already sufficient a zero-amount marker is still written, so spending
   * later the same day cannot trigger a second grant.
   */
  async checkAndApplyDailyTopup(userId: string): Promise<boolean> {
    const { day } = TokensService.utcDay();
    const topupKey = `token:last_topup:${userId}`;

    try {
      if (await this.redis.get(topupKey) === day) {
        // Cheap fast path, but confirm the cached day has a durable marker:
        // a Redis-only fixture must not suppress the first real grant.
        const marked = await this.readDailyGrant(userId, TokensService.GRANT_TYPES.DAILY_TOPUP, day);
        if (marked) return false;
      }
    } catch (err: any) {
      // Redis is only a cache; the durable marker decides whether to grant.
      this.logger.warn(`Failed to check daily top-up cache: ${err.message}`);
    }

    const grant = await this.runDailyGrant(
      userId,
      TokensService.GRANT_TYPES.DAILY_TOPUP,
      day,
      (balance) => Math.max(0, TokensService.FREE_DAILY_TOKENS - balance),
    );
    await this.cacheDailyGrant(topupKey, day, TokensService.REDIS_TOPUP_TTL);
    if (!grant.replay && grant.amount > 0) await this.invalidateCache(userId);
    return !grant.replay;
  }

  /**
   * Get token transaction history for a user.
   */
  async getHistory(userId: string) {
    return this.prisma.token_transactions.findMany({
      where: { user_id: userId },
      orderBy: { created_at: 'desc' },
    });
  }

  /**
   * Invalidate Redis balance cache.
   */
  private async invalidateCache(userId: string): Promise<void> {
    try {
      await this.redis.del(`token:balance:${userId}`);
    } catch (err: any) {
      this.logger.warn(`Failed to invalidate balance cache: ${err.message}`);
    }
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // BILL-04: operation-scoped reserve / settle / refund.
  //
  // These helpers deliberately use only user_token_balance and
  // token_transactions so they compile before the ai_operations tables land.
  // BILL-03/CHAT own operation creation, hash validation and state transitions;
  // this service owns exactly one debit and at most one refund per operation.
  // ─────────────────────────────────────────────────────────────────────────────

  /**
   * Shape of an operation passed in by the BILL-03 orchestration layer.
   * `operationId` must be the canonical server-generated identifier (never a
   * raw client key), and `charge` must be the server-side price for `feature`.
   * The optional `status` lets settle/refund reject operations that are not
   * in a debitable/refundable state before touching the balance.
   */
  private static resolveBillingOperation(
    operation: string | TokensService.BillingOperation,
    feature: string,
    charge: number | undefined,
  ): TokensService.BillingOperation {
    const parsed: TokensService.BillingOperation =
      typeof operation === "string"
        ? { operationId: operation, feature, charge: charge as number }
        : { ...operation, feature: operation.feature ?? feature, charge: operation.charge ?? charge as number };

    if (
      !parsed.operationId ||
      typeof parsed.operationId !== "string" ||
      !parsed.feature ||
      !Object.prototype.hasOwnProperty.call(TokensService.PRICING_CATALOG.costs, parsed.feature)
    ) {
      throw new BadRequestException("A valid operationId and known feature are required for billing");
    }

    if (
      !Number.isSafeInteger(parsed.charge) ||
      parsed.charge !== TokensService.PRICING_CATALOG.costs[parsed.feature]
    ) {
      throw new BadRequestException("Server-side charge for the feature is required");
    }

    if (parsed.userId && (!parsed.user || parsed.user !== parsed.userId)) {
      throw new BadRequestException("Billing operation user mismatch");
    }

    return { ...parsed, user: parsed.user ?? parsed.userId };
  }

  /**
   * Deterministic ledger keys keep the unique constraint authoritative. The
   * refund key matches the `refund:aiop:<operationId>` namespace written by
   * the ai_operations refund policy, so the same operation cannot be refunded
   * twice through two different layers.
   */
  private static billingKey(
    operation: TokensService.BillingOperation,
    kind: (typeof TokensService.BILLING_ENTRY_KINDS)[number],
  ): string {
    const user = operation.user ?? operation.userId ?? "unknown";
    const prefix = kind === "refund"
      ? "refund:aiop:"
      : `op:${user}:${operation.operationId}:`;
    const raw = kind === "refund"
      ? `${prefix}${operation.operationId}`
      : `${prefix}${kind}`;
    if (raw.length <= TokensService.BILLING_LEDGER_MAX_KEY_LENGTH) return raw;

    // Long operation IDs must still produce a stable, collision-resistant key
    // that fits the VARCHAR(128) column.
    const crypto = require("crypto") as typeof import("crypto");
    const hash = crypto.createHash("sha256").update(raw).digest("hex");
    const room = TokensService.BILLING_LEDGER_MAX_KEY_LENGTH - prefix.length - hash.length - 1;
    return room > 0 ? `${prefix}${operation.operationId.slice(0, room)}..${hash}` : hash.slice(0, TokensService.BILLING_LEDGER_MAX_KEY_LENGTH);
  }

  private static isDuplicateKeyError(error: unknown): boolean {
    return (
      typeof error === "object" &&
      error !== null &&
      (error as { code?: string }).code === "P2002"
    );
  }

  private static isSerializationConflict(error: unknown): boolean {
    return (
      typeof error === "object" &&
      error !== null &&
      (error as { code?: string }).code === "P2034"
    );
  }

  /** Read back the ledger row so a replay returns the original result. */
  private async readBillingEntry(
    key: string,
  ): Promise<{ user_id?: string; feature?: string; amount: number; balance_after: number } | null> {
    const entry = await this.prisma.token_transactions.findUnique({
      where: { idempotency_key: key },
    });
    return entry as { user_id?: string; feature?: string; amount: number; balance_after: number } | null;
  }

  private static assertReplayMatches(
    entry: { user_id?: string; feature?: string; amount: number; balance_after: number },
    operation: TokensService.BillingOperation,
    expectedAmount: number,
  ): void {
    if (
      (entry.user_id !== undefined && entry.user_id !== (operation.user ?? operation.userId)) ||
      (entry.feature !== undefined && entry.feature !== operation.feature) ||
      entry.amount !== expectedAmount
    ) {
      throw new ConflictException("Billing operation key already used for a different request");
    }
  }

  /** Bounded retries with jitter for serialization conflicts only. */
  private async withBillingRetry<T>(work: () => Promise<T>): Promise<T> {
    let lastError: unknown;
    for (let attempt = 0; attempt < TokensService.BILLING_RETRY_ATTEMPTS; attempt += 1) {
      try {
        return await work();
      } catch (error: unknown) {
        lastError = error;
        if (!TokensService.isSerializationConflict(error) || attempt === TokensService.BILLING_RETRY_ATTEMPTS - 1) {
          throw error;
        }
        const ceiling = Math.min(
          TokensService.BILLING_RETRY_BASE_MS * 2 ** attempt,
          TokensService.BILLING_RETRY_MAX_MS,
        );
        await new Promise((resolve) => setTimeout(resolve, Math.random() * ceiling));
      }
    }
    throw lastError;
  }

  /**
   * Conditional debit: only one of several concurrent operations against the
   * same balance can claim the last credits. The ledger key enforces one debit
   * per operation even when transactions replay. The daily top-up is applied
   * in this same Serializable transaction so the debit always sees today's
   * granted credits and the marker is durable before the debit commits.
   */
  private async debitForOperation(
    operation: TokensService.BillingOperation,
    day: string,
    markerRetries = 0,
  ): Promise<{ balance: number; cost: number; duplicate: boolean }> {
    const key = TokensService.billingKey(operation, "debit");
    const user = operation.user ?? operation.userId as string;
    const cost = operation.charge as number;

    /** Distinguish a debit-key replay from a racing daily marker insert. */
    const conflictSource = async (): Promise<"debit" | "marker" | "unknown"> => {
      const existing = await this.readBillingEntry(key);
      if (existing) return "debit";
      const grant = await this.readDailyGrant(user, TokensService.GRANT_TYPES.DAILY_TOPUP, day);
      if (grant) return "marker";
      return "unknown";
    };

    const replay = async (): Promise<{ balance: number; cost: number; duplicate: boolean }> => {
      const existing = await this.readBillingEntry(key);
      if (!existing) throw new ConflictException("Billing debit could not be confirmed");
      TokensService.assertReplayMatches(existing, operation, -cost);
      return { balance: existing.balance_after, cost, duplicate: true };
    };

    return this.withBillingRetry(async () => {
      try {
        return await this.prisma.$transaction(async (tx) => {
          const existing = await tx.token_transactions.findUnique({
            where: { idempotency_key: key },
          });
          if (existing) {
            TokensService.assertReplayMatches(
              existing as { user_id?: string; feature?: string; amount: number; balance_after: number },
              operation,
              -cost,
            );
            return { balance: existing.balance_after, cost, duplicate: true };
          }

          await this.applyDailyGrantInTx(
            tx,
            user,
            day,
            TokensService.GRANT_TYPES.DAILY_TOPUP,
            (balance) => Math.max(0, TokensService.FREE_DAILY_TOKENS - balance),
          );

          const claimed = await tx.user_token_balance.updateMany({
            where: { user_id: user, balance: { gte: cost } },
            data: { balance: { decrement: cost } },
          });
          if (claimed.count < 1) {
            const row = await tx.user_token_balance.findUnique({
              where: { user_id: user },
              select: { balance: true },
            });
            throw new ForbiddenException(
              `Insufficient token balance: need ${cost}, have ${row?.balance ?? 0}`,
            );
          }

          const row = await tx.user_token_balance.findUnique({
            where: { user_id: user },
            select: { balance: true },
          });
          const balance = row?.balance ?? 0;

          await tx.token_transactions.create({
            data: {
              user_id: user,
              amount: -cost,
              type: "consumption",
              feature: operation.feature,
              balance_after: balance,
              idempotency_key: key,
            },
          });

          return { balance, cost, duplicate: false };
        }, TokensService.BILLING_TX_OPTIONS);
      } catch (error: unknown) {
        if (TokensService.isDuplicateKeyError(error)) {
          const source = await conflictSource();
          if (source === "debit") return replay();
          if (source === "marker" && markerRetries === 0) {
            // A concurrent request committed the daily marker; re-read the
            // committed balance and retry the debit exactly once.
            return this.debitForOperation(operation, day, 1);
          }
          throw new ConflictException("Billing debit could not be confirmed");
        }
        throw error;
      }
    });
  }

  /**
   * Settle records the successful terminal event without a second debit.
   * A zero-amount ledger entry keyed by operation id makes replay safe.
   */
  private async settleOperation(
    operation: TokensService.BillingOperation,
  ): Promise<{ balance: number; cost: number; duplicate: boolean }> {
    const key = TokensService.billingKey(operation, "settle");
    const user = operation.user ?? operation.userId as string;
    const cost = operation.charge as number;
    if (operation.status && !TokensService.SETTLE_FROM_STATUSES.includes(operation.status as TokensService.OperationStatus)) {
      throw new ConflictException(`Operation cannot be settled from status ${operation.status}`);
    }

    const replay = async (): Promise<{ balance: number; cost: number; duplicate: boolean }> => {
      const existing = await this.readBillingEntry(key);
      if (!existing) throw new ConflictException("Billing settlement could not be confirmed");
      TokensService.assertReplayMatches(existing, operation, 0);
      return { balance: existing.balance_after, cost, duplicate: true };
    };

    return this.withBillingRetry(async () => {
      try {
        return await this.prisma.$transaction(async (tx) => {
          const existing = await tx.token_transactions.findUnique({
            where: { idempotency_key: key },
          });
          if (existing) {
            TokensService.assertReplayMatches(
              existing as { user_id?: string; feature?: string; amount: number; balance_after: number },
              operation,
              0,
            );
            return { balance: existing.balance_after, cost, duplicate: true };
          }

          const debit = await tx.token_transactions.findUnique({
            where: { idempotency_key: TokensService.billingKey(operation, "debit") },
          });
          if (!debit) throw new NotFoundException("Billing operation has no debit to settle");
          TokensService.assertReplayMatches(
            debit as { user_id?: string; feature?: string; amount: number; balance_after: number },
            operation,
            -cost,
          );

          const refund = await tx.token_transactions.findUnique({
            where: { idempotency_key: TokensService.billingKey(operation, "refund") },
          });
          if (refund) throw new ConflictException("Refunded operations cannot be settled");

          await tx.token_transactions.create({
            data: {
              user_id: user,
              amount: 0,
              type: "consumption",
              feature: operation.feature,
              balance_after: debit.balance_after,
              idempotency_key: key,
            },
          });

          return { balance: debit.balance_after, cost, duplicate: false };
        }, TokensService.BILLING_TX_OPTIONS);
      } catch (error: unknown) {
        if (TokensService.isDuplicateKeyError(error)) return replay();
        throw error;
      }
    });
  }

  /**
   * At-most-once refund: a positive ledger entry is only created when the
   * operation has a matching debit and no prior refund. Replaying a refund
   * returns the original balance instead of granting credits again.
   */
  private async refundOperation(
    operation: TokensService.BillingOperation,
  ): Promise<{ balance: number; refunded: number; duplicate: boolean }> {
    const key = TokensService.billingKey(operation, "refund");
    const user = operation.user ?? operation.userId as string;
    const cost = operation.charge as number;
    if (operation.status && !TokensService.REFUND_FROM_STATUSES.includes(operation.status as TokensService.OperationStatus)) {
      throw new ConflictException(`Operation cannot be refunded from status ${operation.status}`);
    }

    const replay = async (): Promise<{ balance: number; refunded: number; duplicate: boolean }> => {
      const existing = await this.readBillingEntry(key);
      if (!existing) throw new ConflictException("Billing refund could not be confirmed");
      TokensService.assertReplayMatches(existing, operation, cost);
      return { balance: existing.balance_after, refunded: cost, duplicate: true };
    };

    return this.withBillingRetry(async () => {
      try {
        return await this.prisma.$transaction(async (tx) => {
          const existing = await tx.token_transactions.findUnique({
            where: { idempotency_key: key },
          });
          if (existing) {
            TokensService.assertReplayMatches(
              existing as { user_id?: string; feature?: string; amount: number; balance_after: number },
              operation,
              cost,
            );
            return { balance: existing.balance_after, refunded: cost, duplicate: true };
          }

          const debit = await tx.token_transactions.findUnique({
            where: { idempotency_key: TokensService.billingKey(operation, "debit") },
          });
          if (!debit) throw new NotFoundException("Billing operation has no debit to refund");
          TokensService.assertReplayMatches(
            debit as { user_id?: string; feature?: string; amount: number; balance_after: number },
            operation,
            -cost,
          );

          const updated = await tx.user_token_balance.upsert({
            where: { user_id: user },
            create: { user_id: user, balance: cost },
            update: { balance: { increment: cost } },
          });
          const balance = typeof updated?.balance === "number" ? updated.balance : cost;

          await tx.token_transactions.create({
            data: {
              user_id: user,
              amount: cost,
              type: "refund",
              feature: operation.feature,
              balance_after: balance,
              idempotency_key: key,
            },
          });

          return { balance, refunded: cost, duplicate: false };
        }, TokensService.BILLING_TX_OPTIONS);
      } catch (error: unknown) {
        if (TokensService.isDuplicateKeyError(error)) return replay();
        throw error;
      }
    });
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Public BILL-04 entry points. The orchestration layer owns operation state;
  // callers must pass the same canonical operationId for all three phases.
  // ─────────────────────────────────────────────────────────────────────────────

  /** Debit the reserved price once for a validated operation. */
  async reserveTokens(
    userId: string,
    operation: string | TokensService.BillingOperation,
    feature = "ai_chat",
  ): Promise<{ balance: number; cost: number; duplicate: boolean }> {
    const parsed = TokensService.resolveBillingOperation(operation, feature, undefined);
    if (parsed.userId && parsed.userId !== userId) {
      throw new BadRequestException("Billing operation user mismatch");
    }
    parsed.user = userId;
    parsed.userId = userId;

    // Top-up and debit share one Serializable transaction; the top-up marker
    // is present in the DB before the debit is committed, never inferred from
    // a Redis cache that may belong to a different instance or fixture.
    const { day } = TokensService.utcDay();
    const result = await this.debitForOperation(parsed, day);
    await this.invalidateCache(userId);
    return result;
  }

  /** Confirm success without a second debit. */
  async settleTokens(
    userId: string,
    operation: string | TokensService.BillingOperation,
    feature = "ai_chat",
  ): Promise<{ balance: number; cost: number; duplicate: boolean }> {
    const parsed = TokensService.resolveBillingOperation(operation, feature, undefined);
    if (parsed.userId && parsed.userId !== userId) {
      throw new BadRequestException("Billing operation user mismatch");
    }
    parsed.user = userId;
    parsed.userId = userId;

    const result = await this.settleOperation(parsed);
    await this.invalidateCache(userId);
    return result;
  }

  /** Refund the reserved price at most once for a failed operation. */
  async refundTokens(
    userId: string,
    operation: string | TokensService.BillingOperation,
    feature = "ai_chat",
  ): Promise<{ balance: number; refunded: number; duplicate: boolean }> {
    const parsed = TokensService.resolveBillingOperation(operation, feature, undefined);
    if (parsed.userId && parsed.userId !== userId) {
      throw new BadRequestException("Billing operation user mismatch");
    }
    parsed.user = userId;
    parsed.userId = userId;

    const result = await this.refundOperation(parsed);
    await this.invalidateCache(userId);
    return result;
  }
}
