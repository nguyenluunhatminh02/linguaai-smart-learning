import { Injectable, BadRequestException, ForbiddenException, Logger } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { RedisService } from "../common/services/redis.service";

@Injectable()
export class TokensService {
  private readonly logger = new Logger(TokensService.name);

  /** Token costs per feature (server-side mirror of frontend TOKEN_COSTS). */
  private static readonly COSTS: Record<string, number> = {
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
  };

  /** Daily free tokens granted to all users at midnight. */
  private static readonly FREE_DAILY_TOKENS = 30;
  private static readonly REDIS_BALANCE_TTL = 300; // 5 minutes cache
  private static readonly REDIS_TOPUP_TTL = 86400; // 24 hours cache
  private static readonly REDIS_CHECKIN_TTL = 86400; // 24 hours cache

  constructor(
    private prisma: PrismaService,
    private redis: RedisService,
  ) {}

  /**
   * Get current balance + today's usage. Auto-top-up daily free tokens
   * if the user hasn't received them yet today.
   */
  async getBalance(userId: string) {
    // Check and apply daily top-up first to ensure balance is up-to-date
    await this.checkAndApplyDailyTopup(userId);

    // Try cache first
    let balance: number | null = null;
    try {
      const cached = await this.redis.get(`token:balance:${userId}`);
      if (cached !== null) {
        balance = parseInt(cached, 10);
      }
    } catch (err: any) {
      this.logger.warn(`Failed to read balance cache: ${err.message}`);
    }

    if (balance === null) {
      // Fallback to DB
      const record = await this.prisma.user_token_balance.findUnique({
        where: { user_id: userId },
        select: { balance: true },
      });
      
      // Initialize if not exists
      if (!record) {
        const newRecord = await this.prisma.user_token_balance.create({
          data: { user_id: userId, balance: TokensService.FREE_DAILY_TOKENS },
        });
        balance = newRecord.balance;
      } else {
        balance = record.balance;
      }

      // Populate cache
      try {
        await this.redis.set(`token:balance:${userId}`, balance.toString(), TokensService.REDIS_BALANCE_TTL);
      } catch (err: any) {
        this.logger.warn(`Failed to update balance cache: ${err.message}`);
      }
    }

    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);

    const todayUsedAgg = await this.prisma.token_transactions.aggregate({
      where: {
        user_id: userId,
        type: "consumption",
        created_at: { gte: todayStart },
      },
      _sum: { amount: true },
    });

    return {
      balance,
      todayUsed: Math.abs(todayUsedAgg._sum.amount ?? 0),
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
    const configuredCost = TokensService.COSTS[feature];

    // Validate the feature is known
    if (configuredCost === undefined) {
      throw new BadRequestException(`Unknown feature: ${feature}`);
    }
    const actualCost = configuredCost;

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

  /**
   * Daily check-in: grants bonus tokens once per UTC day.
   */
  async dailyCheckIn(userId: string) {
    const today = new Date().toISOString().slice(0, 10); // YYYY-MM-DD UTC
    const checkinKey = `checkin:${userId}:${today}`;

    try {
      const existing = await this.redis.get(checkinKey);
      if (existing) {
        const bal = await this.getBalance(userId);
        return {
          balance: bal.balance,
          todayUsed: bal.todayUsed,
          tokensEarned: 0,
          alreadyCheckedIn: true,
        };
      }
    } catch (err: any) {
      // Cannot verify the guard: fail closed rather than risk a duplicate grant.
      this.logger.warn(`Failed to read check-in cache: ${err.message}`);
      throw new ForbiddenException('Daily check-in is temporarily unavailable');
    }

    // The reward follows the published streak table. The deterministic key
    // makes the database constraint the authoritative once-per-day guard.
    const bonuses = [5, 5, 8, 8, 10, 10, 15];
    const grantedDays = await this.prisma.token_transactions.findMany({
      where: {
        user_id: userId,
        type: "bonus",
        feature: "daily_checkin",
        created_at: { gte: new Date(Date.now() - 8 * 86_400_000) },
      },
      select: { created_at: true },
      orderBy: { created_at: "desc" },
    });
    const granted = new Set(grantedDays.map((item) => item.created_at.toISOString().slice(0, 10)));
    const cursor = new Date(`${today}T00:00:00.000Z`);
    if (!granted.has(today)) cursor.setUTCDate(cursor.getUTCDate() - 1);
    let streak = 0;
    while (streak < bonuses.length && granted.has(cursor.toISOString().slice(0, 10))) {
      streak += 1;
      cursor.setUTCDate(cursor.getUTCDate() - 1);
    }
    const dailyBonus = bonuses[Math.min(streak, bonuses.length - 1)];
    const result = await this.addTokens(
      userId,
      dailyBonus,
      "bonus",
      "daily_checkin",
      `daily_checkin:${userId}:${today}`,
    );

    // Mark as done for today
    try {
      await this.redis.set(checkinKey, "1", TokensService.REDIS_CHECKIN_TTL);
    } catch (err: any) {
      this.logger.warn(`Failed to set check-in cache: ${err.message}`);
    }

    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    const todayUsedAgg = await this.prisma.token_transactions.aggregate({
      where: {
        user_id: userId,
        type: "consumption",
        created_at: { gte: todayStart },
      },
      _sum: { amount: true },
    });

    const alreadyEarned = (result as { duplicate?: boolean }).duplicate === true;
    return {
      balance: result.balance,
      todayUsed: Math.abs(todayUsedAgg._sum.amount ?? 0),
      tokensEarned: alreadyEarned ? 0 : dailyBonus,
      alreadyCheckedIn: alreadyEarned,
      streak: alreadyEarned ? streak : streak + 1,
    };
  }

  /**
   * Check if user has received daily topup today.
   * If not, reset/top-up their balance to FREE_DAILY_TOKENS if it is below that,
   * or add the topup.
   */
  async checkAndApplyDailyTopup(userId: string): Promise<boolean> {
    const today = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
    const topupKey = `token:last_topup:${userId}`;

    try {
      const lastTopup = await this.redis.get(topupKey);
      if (lastTopup === today) return false;
    } catch (err: any) {
      // Without the guard we cannot prove the top-up is a once-per-day event;
      // the DB idempotency key below still enforces it, so log and continue.
      this.logger.warn(`Failed to check daily top-up cache: ${err.message}`);
    }

    // Check balance first
    const row = await this.prisma.user_token_balance.findUnique({
      where: { user_id: userId },
    });
    const currentBalance = row?.balance ?? 0;

    // Top up to FREE_DAILY_TOKENS if current balance is less
    if (currentBalance < TokensService.FREE_DAILY_TOKENS) {
      const topupAmount = TokensService.FREE_DAILY_TOKENS - currentBalance;
      // Deterministic key: the unique DB constraint permits exactly one
      // top-up per user per UTC day, even if Redis is down or requests race.
      await this.addTokens(
        userId,
        topupAmount,
        "daily_topup",
        "daily_topup",
        `daily_topup:${userId}:${today}`,
      );
    }

    // Set cache for today
    try {
      await this.redis.set(topupKey, today, TokensService.REDIS_TOPUP_TTL);
    } catch (err: any) {
      this.logger.warn(`Failed to update daily top-up cache: ${err.message}`);
    }

    return true;
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
}
