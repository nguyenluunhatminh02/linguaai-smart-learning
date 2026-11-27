import { Injectable, Logger, HttpException, HttpStatus } from '@nestjs/common';
import { RedisService } from './redis.service';
import { DateUtil } from '../utils/date.util';

/**
 * Rate Limit Configuration
 */
export interface RateLimitConfig {
  /** Maximum number of requests allowed */
  limit: number;
  /** Time window in seconds */
  window: number;
  /** Custom key prefix (optional) */
  keyPrefix?: string;
}

/**
 * Rate Limiter Service
 * 
 * Provides rate limiting functionality using Redis to prevent brute force attacks,
 * credential stuffing, and DoS attacks on authentication endpoints.
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
   * Check if a request should be rate limited
   * 
   * @param key - Unique identifier for the rate limit (e.g., email, IP, userId)
   * @param config - Rate limit configuration
   * @returns Object with remaining requests and reset time
   * @throws HttpException(429) if rate limit exceeded
   */
  async checkRateLimit(key: string, config: RateLimitConfig): Promise<{
    remaining: number;
    resetTime: Date;
    success: boolean;
  }> {
    const redisKey = this.buildKey(key, config.keyPrefix);
    const limit = config.limit;
    const window = config.window;

    try {
      // Atomically increment the counter and set TTL only on the first request.
      // Previously this used a non-atomic GET → SET/INCR pattern that allowed
      // burst traffic to slip through at exactly 2× the configured limit.
      const newCount = await this.redis.incrWithExpiry(redisKey, window);

      // Check if limit exceeded AFTER increment so the count is always accurate
      if (newCount > limit) {
        const ttl = await this.redis.ttl(redisKey);
        const resetTime = DateUtil.addSeconds(ttl);

        this.logger.warn(`Rate limit exceeded for key: ${redisKey}`);

        throw new HttpException({
          message: 'Too many requests. Please try again later.',
          remaining: 0,
          resetTime: resetTime.toISOString(),
        }, HttpStatus.TOO_MANY_REQUESTS);
      }

      const ttl = await this.redis.ttl(redisKey);
      const resetTime = DateUtil.addSeconds(ttl);

      return {
        remaining: limit - newCount,
        resetTime,
        success: true,
      };
    } catch (error) {
      if (error instanceof HttpException && error.getStatus() === HttpStatus.TOO_MANY_REQUESTS) {
        throw error;
      }

      // Fail closed: a limiter error (Lua failure, timeout, Redis bug) must not
      // silently disable brute-force protection on login/register/MFA routes.
      // Use the 429 shape because RateLimitGuard only propagates 429s and
      // otherwise lets requests through, which would undo fail-closed here.
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(`Rate limiter error for key ${redisKey}: ${message}`);
      throw new HttpException(
        {
          message: 'Rate limiting is temporarily unavailable. Please try again shortly.',
          remaining: 0,
          resetTime: DateUtil.addSeconds(window).toISOString(),
        },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
  }

  /**
   * Reset rate limit for a specific key
   * 
   * @param key - The key to reset
   * @param keyPrefix - Optional custom key prefix
   */
  async resetRateLimit(key: string, keyPrefix?: string): Promise<void> {
    const redisKey = this.buildKey(key, keyPrefix);
    await this.redis.del(redisKey);
  }

  /**
   * Get current rate limit status without incrementing
   * 
   * @param key - The key to check
   * @param config - Rate limit configuration
   * @returns Current rate limit status
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
