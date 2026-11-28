import { Injectable, Logger, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { RedisService } from '../../common/services/redis.service';

/**
 * Token Blacklist Service
 *
 * Manages blacklisted JWT tokens using Redis for secure logout and token revocation.
 * Tokens are blacklisted with TTL matching their expiration time.
 */
@Injectable()
export class TokenBlacklistService {
  private readonly logger = new Logger(TokenBlacklistService.name);
  private readonly PREFIX = 'blacklist:';
  private readonly failClosedOnRedisOutage: boolean;

  constructor(
    private redis: RedisService,
    @Optional() config?: ConfigService,
  ) {
    this.failClosedOnRedisOutage =
      config?.get<string>('NODE_ENV') === 'production';
  }

  /**
   * Decide what a revocation check should return when Redis cannot answer it.
   * Production fails closed (reject the credential) because we cannot prove
   * the token was not revoked; other environments fail open to keep local
   * development usable without Redis. Shared by both check methods so their
   * outage behaviour cannot drift apart.
   */
  private failClosedResult(checkName: string, reason: string): boolean {
    if (this.failClosedOnRedisOutage) {
      this.logger.error(
        `Redis unavailable - failing closed on ${checkName}: ${reason}`,
      );
      return true;
    }
    this.logger.warn(
      `Redis unavailable - failing open on ${checkName} (non-production): ${reason}`,
    );
    return false;
  }

  /**
   * Add a token to the blacklist
   * @param token - JWT token to blacklist
   * @param ttlSeconds - Time to live in seconds (should match token expiration)
   */
  async addToBlacklist(jti: string, ttlSeconds: number): Promise<void> {
    if (!this.redis.isAvailable()) {
      this.logger.warn('Redis not available, skipping token blacklisting');
      return;
    }

    try {
      const key = `${this.PREFIX}${jti}`;
      await this.redis.set(key, '1', ttlSeconds);
      this.logger.log(`Token blacklisted by JTI: ${jti.substring(0, 8)}...`);
    } catch (err) {
      this.logger.error(`Failed to blacklist token: ${err.message}`);
    }
  }

  /**
   * Check if a token is blacklisted
   * @param token - JWT token to check
   * @returns true if token is blacklisted, false otherwise
   */
  async isBlacklisted(jti: string): Promise<boolean> {
    if (!this.redis.isAvailable()) {
      return this.failClosedResult(
        'token blacklist check',
        'connection unavailable',
      );
    }

    try {
      // JTIs are UUIDs; `blacklist:user:<id>` is a distinct namespace and
      // cannot collide with a JTI key. Keep this prefix in sync with
      // TokenService.blacklistToken / isTokenBlacklisted.
      const key = `${this.PREFIX}${jti}`;
      return await this.redis.exists(key);
    } catch (err) {
      return this.failClosedResult('token blacklist check', err.message);
    }
  }

  /**
   * Remove a token from the blacklist
   * @param token - JWT token to remove from blacklist
   */
  async removeFromBlacklist(jti: string): Promise<void> {
    if (!this.redis.isAvailable()) {
      this.logger.warn(
        'Redis not available, skipping token removal from blacklist',
      );
      return;
    }

    try {
      const key = `${this.PREFIX}${jti}`;
      await this.redis.del(key);
      this.logger.log(
        `Token removed from blacklist: ${jti.substring(0, 8)}...`,
      );
    } catch (err) {
      this.logger.error(
        `Failed to remove token from blacklist: ${err.message}`,
      );
    }
  }

  /**
   * Blacklist all tokens for a user (by pattern matching)
   * This is useful for logout from all devices
   * @param userId - User ID
   */
  async blacklistAllUserTokens(userId: string): Promise<void> {
    if (!this.redis.isAvailable()) {
      this.logger.warn('Redis not available, skipping user token blacklisting');
      return;
    }

    try {
      // Store a marker that indicates all tokens for this user should be blacklisted.
      // The TTL must outlive the longest-lived token (28-day rememberMe refresh
      // tokens) or revocation would silently lapse before the token expires.
      // Add a day of slack for clock skew / delayed validation.
      const userBlacklistKey = `${this.PREFIX}user:${userId}`;
      const ttlSeconds = 29 * 24 * 3600; // 29 days
      await this.redis.set(userBlacklistKey, '1', ttlSeconds);

      this.logger.log(`All tokens for user ${userId} marked for blacklisting`);
    } catch (err) {
      this.logger.error(`Failed to blacklist all user tokens: ${err.message}`);
    }
  }

  /**
   * Check if all tokens for a user are blacklisted
   * This is checked during token validation in JwtStrategy
   * @param userId - User ID
   * @returns true if all tokens for the user are blacklisted, false otherwise
   */
  async areAllUserTokensBlacklisted(userId: string): Promise<boolean> {
    if (!this.redis.isAvailable()) {
      return this.failClosedResult(
        'user token blacklist check',
        'connection unavailable',
      );
    }

    try {
      const userBlacklistKey = `${this.PREFIX}user:${userId}`;
      return await this.redis.exists(userBlacklistKey);
    } catch (err) {
      return this.failClosedResult('user token blacklist check', err.message);
    }
  }

  /**
   * Clear the user blacklist marker
   * This is called when a user logs in again after logout-all
   * @param userId - User ID
   */
  async clearUserBlacklist(userId: string): Promise<void> {
    if (!this.redis.isAvailable()) {
      this.logger.warn('Redis not available, skipping user blacklist clearing');
      return;
    }

    try {
      const userBlacklistKey = `${this.PREFIX}user:${userId}`;
      await this.redis.del(userBlacklistKey);
      this.logger.log(`Cleared blacklist for user ${userId}`);
    } catch (err) {
      this.logger.error(`Failed to clear user blacklist: ${err.message}`);
    }
  }

  /**
   * Get blacklist statistics
   * @returns Number of blacklisted tokens
   */
  async getBlacklistCount(): Promise<number> {
    if (!this.redis.isAvailable()) {
      return 0;
    }

    try {
      // This would require Redis KEYS command which is not available in current RedisService
      // For now, return 0 as placeholder
      return 0;
    } catch (err) {
      this.logger.error(`Failed to get blacklist count: ${err.message}`);
      return 0;
    }
  }
}
