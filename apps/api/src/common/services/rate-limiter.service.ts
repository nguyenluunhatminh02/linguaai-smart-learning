import { HttpException, HttpStatus, Injectable, Logger } from '@nestjs/common';
import { createHash } from 'crypto';
import { RedisService } from './redis.service';
import { DateUtil } from '../utils/date.util';

/** How the limiter behaves when Redis (or the atomic script) is unavailable. */
export type RateLimitFailurePolicy = 'closed' | 'open';

/** Rate Limit Configuration */
export interface RateLimitConfig {
  /** Maximum number of requests allowed */
  limit: number;
  /** Time window in seconds */
  window: number;
  /** Custom key prefix (optional) */
  keyPrefix?: string;
  /**
   * Backend-outage policy. Defaults to 'closed': no request is allowed through
   * when the shared counter cannot be updated. AI write routes must never use
   * 'open'. Quota exhaustion (limit + 1) is always a 429 regardless of policy.
   */
  failurePolicy?: RateLimitFailurePolicy;
}

/** Successful result, including TTL-derived metadata for HTTP headers. */
export interface RateLimitResult {
  remaining: number;
  resetTime: Date;
  success: true;
  limit: number;
  /** Epoch seconds (the X-RateLimit-Reset HTTP convention). */
  resetAt: number;
  retryAfterSeconds: number;
}

/** Payload carried by the 429 thrown on quota exhaustion. */
export interface RateLimitExceededPayload {
  message: string;
  remaining: number;
  resetTime: string;
  limit: number;
  resetAt: number;
  retryAfterSeconds: number;
}

/** Payload carried by the 503 thrown on a closed-policy backend outage. */
export interface RateLimitUnavailablePayload {
  message: string;
  resetTime: string;
  limit: number;
  resetAt: number;
  retryAfterSeconds: number;
}

/**
 * Rate Limiter Service
 *
 * Counters live only in Redis. Each request executes one atomic Lua script
 * (INCR, plus EXPIRE on the first increment of a window) through
 * RedisService.incrWithExpiry, so all API instances/workers share a budget.
 * The TTL read back from Redis defines both X-RateLimit-Reset and Retry-After.
 *
 * @example
 * // Limit login attempts to 5 per 15 minutes
 * await this.rateLimiterService.checkRateLimit('login:user@example.com', {
 *   limit: 5,
 *   window: 900, // 15 minutes
 * });
 */
@Injectable()
export class RateLimiterService {
  private readonly logger = new Logger(RateLimiterService.name);
  private readonly DEFAULT_PREFIX = 'rate_limit:';

  constructor(
    private redis: RedisService,
  ) {}

  /**
   * Check if a request should be rate limited.
   *
   * @returns remaining quota and TTL-derived window metadata
   * @throws HttpException(429) when the shared quota is exhausted
   * @throws HttpException(503) when the backend fails under a closed policy
   */
  async checkRateLimit(key: string, config: RateLimitConfig): Promise<RateLimitResult> {
    const limit = this.validateConfig(config);
    const redisKey = this.buildKey(key, config.keyPrefix);
    const now = Date.now();

    let newCount: number;
    try {
      newCount = await this.redis.incrWithExpiry(redisKey, config.window);
      if (!Number.isFinite(newCount) || newCount < 1) {
        throw new Error(`invalid counter value: ${String(newCount)}`);
      }
    } catch (error) {
      return this.handleBackendFailure(error, key, redisKey, config, now, limit);
    }

    // Only quota exhaustion is a 429; the TTL comes from the same Redis key.
    if (newCount > limit) {
      let ttl: number;
      try {
        ttl = await this.readTtl(redisKey, key);
      } catch (error) {
        // The counter is already over quota: a TTL failure must not fall back
        // to the failure policy, which could let the request through when open.
        const message = error instanceof Error ? error.message : String(error);
        this.logger.error(
          `Rate limit TTL read failed for exceeded key ${redisKey} (identity=${this.safeKey(key)}): ${message}; using configured window`,
        );
        ttl = config.window;
      }
      this.logger.warn(`Rate limit exceeded for key: ${redisKey}`);
      throw new HttpException(
        {
          message: 'Too many requests. Please try again later.',
          remaining: 0,
          ...this.windowFields(limit, ttl, now),
        } satisfies RateLimitExceededPayload,
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    let ttl: number;
    try {
      ttl = await this.readTtl(redisKey, key);
    } catch (error) {
      return this.handleBackendFailure(error, key, redisKey, config, now, limit);
    }

    return this.result(limit, limit - newCount, ttl, now);
  }

  /**
   * Reset rate limit for a specific key.
   */
  async resetRateLimit(key: string, keyPrefix?: string): Promise<void> {
    const redisKey = this.buildKey(key, keyPrefix);
    await this.redis.del(redisKey);
  }

  /**
   * Get current rate limit status without incrementing.
   */
  async getRateLimitStatus(key: string, config: RateLimitConfig): Promise<{
    current: number;
    remaining: number;
    resetTime: Date | null;
  }> {
    const redisKey = this.buildKey(key, config.keyPrefix);
    const current = await this.redis.get(redisKey);
    const count = current ? parseInt(current, 10) : 0;

    const ttl = await this.redis.ttl(redisKey);
    const resetTime = ttl > 0 ? DateUtil.addSeconds(ttl) : null;

    return {
      current: count,
      remaining: Math.max(0, config.limit - count),
      resetTime,
    };
  }

  /**
   * Apply the configured failure policy. Closed is the default and blocks
   * the request; open is opt-in for non-sensitive read paths only.
   */
  private handleBackendFailure(
    error: unknown,
    key: string,
    redisKey: string,
    config: RateLimitConfig,
    now: number,
    limit: number,
  ): RateLimitResult {
    const message = error instanceof Error ? error.message : String(error);
    if (this.failurePolicy(config) === 'open') {
      this.logger.error(
        `Rate limiter backend error for key ${redisKey} (fail-open configured): ${message}`,
      );
      return this.result(limit, limit, config.window, now);
    }

    this.logger.error(
      `Rate limiter backend error for key ${redisKey} (fail-closed, identity=${this.safeKey(key)}): ${message}`,
    );
    throw new HttpException(
      {
        message: 'Rate limiting is temporarily unavailable. Please try again shortly.',
        ...this.windowFields(limit, config.window, now),
      } satisfies RateLimitUnavailablePayload,
      HttpStatus.SERVICE_UNAVAILABLE,
    );
  }

  /**
   * Redis TTL is authoritative for both X-RateLimit-Reset and Retry-After.
   * A missing/expired bucket right after an increment means the atomic script
   * did not set an expiry — that is a backend failure, not a fresh window.
   */
  private async readTtl(redisKey: string, key: string): Promise<number> {
    let ttl: number;
    try {
      ttl = await this.redis.ttl(redisKey);
    } catch (error) {
      throw error instanceof Error ? error : new Error(String(error));
    }
    if (!Number.isFinite(ttl) || ttl < 0) {
      throw new Error(
        `missing or expired rate limit bucket for key ${redisKey} (identity=${this.safeKey(key)}, TTL ${ttl})`,
      );
    }
    return ttl;
  }

  /** Never echo a raw identity (email especially) into logs. */
  private safeKey(key: string): string {
    return createHash('sha256').update(key).digest('hex').substring(0, 16);
  }

  private failurePolicy(config: RateLimitConfig): RateLimitFailurePolicy {
    return config.failurePolicy ?? 'closed';
  }

  private validateConfig(config: RateLimitConfig): number {
    const { limit, window } = config;
    if (!Number.isInteger(limit) || limit < 1) {
      throw new Error(`Invalid rate limit: limit must be a positive integer (got ${String(limit)})`);
    }
    if (!Number.isInteger(window) || window < 1) {
      throw new Error(`Invalid rate limit: window must be a positive integer number of seconds (got ${String(window)})`);
    }
    const policy = this.failurePolicy(config);
    if (policy !== 'closed' && policy !== 'open') {
      throw new Error(`Invalid rate limit failurePolicy: ${String(policy)}`);
    }
    return limit;
  }

  private windowFields(limit: number, ttlSeconds: number, now: number) {
    const retryAfterSeconds = Math.max(1, Math.ceil(ttlSeconds));
    return {
      resetTime: DateUtil.addSeconds(ttlSeconds, new Date(now)).toISOString(),
      limit,
      // Epoch seconds, as required by HTTP's X-RateLimit-Reset convention.
      resetAt: Math.floor(now / 1000) + retryAfterSeconds,
      retryAfterSeconds,
    };
  }

  private result(limit: number, remaining: number, ttlSeconds: number, now: number): RateLimitResult {
    const fields = this.windowFields(limit, ttlSeconds, now);
    return {
      remaining,
      resetTime: new Date(fields.resetTime),
      success: true,
      limit,
      resetAt: fields.resetAt,
      retryAfterSeconds: fields.retryAfterSeconds,
    };
  }

  /**
   * Build Redis key for rate limiting
   */
  private buildKey(key: string, customPrefix?: string): string {
    const prefix = customPrefix ? `${this.DEFAULT_PREFIX}${customPrefix}:` : this.DEFAULT_PREFIX;
    return `${prefix}${key}`;
  }

  /**
   * Predefined rate limit configurations
   */
  static readonly LIMITS = {
    // Login attempts: 5 per 15 minutes
    LOGIN: { limit: 5, window: 900, keyPrefix: 'login' },

    // Registration: 3 per hour
    REGISTER: { limit: 3, window: 3600, keyPrefix: 'register' },

    // Password reset: 3 per hour
    PASSWORD_RESET: { limit: 3, window: 3600, keyPrefix: 'password_reset' },

    // Email verification: 5 per hour
    EMAIL_VERIFICATION: { limit: 5, window: 3600, keyPrefix: 'email_verify' },

    // MFA attempts: 3 per 5 minutes
    MFA: { limit: 3, window: 300, keyPrefix: 'mfa' },

    // General API: 100 per minute
    GENERAL: { limit: 100, window: 60, keyPrefix: 'general' },

    // IP-based: 1000 per hour
    IP: { limit: 1000, window: 3600, keyPrefix: 'ip' },
  } as const;
}
