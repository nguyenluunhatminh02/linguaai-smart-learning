import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';

/**
 * Redis Service
 *
 * Provides Redis connection with retry logic, health checking, and fallback handling.
 * When Redis is unavailable, operations are gracefully skipped with warnings logged.
 */
@Injectable()
export class RedisService implements OnModuleInit, OnModuleDestroy {
  private client: Redis;
  private isConnected = false;
  private readonly logger = new Logger(RedisService.name);

  constructor(private config: ConfigService) {}

  /**
   * Create the client in the background. ioredis owns reconnection from here on,
   * so a Redis server that starts (or recovers) after app boot is picked up
   * without restarting this process.
   */
  async onModuleInit() {
    this.client = new Redis({
      host: this.config.get<string>('REDIS_HOST') || 'localhost',
      port: this.config.get<number>('REDIS_PORT') || 6379,
      password: this.config.get<string>('REDIS_PASSWORD') || undefined,
      // Bounded exponential backoff: retry indefinitely, starting quickly for
      // a transient blip and capping the delay at 5 s.
      retryStrategy: (times) => Math.min(100 * 2 ** times, 5000),
      maxRetriesPerRequest: 1,
      enableReadyCheck: true,
    });

    this.client.on('error', (err) => {
      this.logger.warn(`Redis error: ${err.message}`);
    });

    this.client.on('end', () => {
      this.isConnected = false;
      this.logger.warn('Redis connection ended');
    });

    this.client.on('reconnecting', () => {
      this.isConnected = false;
      this.logger.log('Redis reconnecting...');
    });

    // 'ready' fires on first connect and on every reconnect (after any
    // authentication/database selection), so wrappers resume automatically.
    this.client.on('ready', () => {
      this.isConnected = true;
      this.logger.log('Redis connected successfully');
    });
  }

  /**
   * Check if Redis is available
   */
  isAvailable(): boolean {
    return this.isConnected;
  }

  /**
   * Health check for Redis connection
   */
  async healthCheck(): Promise<boolean> {
    try {
      if (!this.client || !this.isConnected) return false;
      const result = await this.client.ping();
      return result === 'PONG';
    } catch (err) {
      this.logger.error(`Redis health check failed: ${err.message}`);
      // Leave reconnection to ioredis; do not latch the service into a
      // disconnected state after a transient ping failure.
      return false;
    }
  }

  /**
   * Set a key-value pair with optional TTL
   */
  async set(key: string, value: string, ttlSeconds?: number): Promise<void> {
    if (!this.isConnected) {
      this.logger.warn(
        `Redis not available, skipping set operation for key: ${key}`,
      );
      return;
    }

    try {
      if (ttlSeconds) {
        await this.client.set(key, value, 'EX', ttlSeconds);
      } else {
        await this.client.set(key, value);
      }
    } catch (err) {
      this.logger.error(`Redis set error for key ${key}: ${err.message}`);
    }
  }

  /**
   * Get a value by key
   */
  async get(key: string): Promise<string | null> {
    if (!this.isConnected) {
      this.logger.warn(`Redis not available, returning null for key: ${key}`);
      return null;
    }

    try {
      return await this.client.get(key);
    } catch (err) {
      this.logger.error(`Redis get error for key ${key}: ${err.message}`);
      return null;
    }
  }

  /**
   * Delete a key
   */
  async del(key: string): Promise<void> {
    if (!this.isConnected) {
      this.logger.warn(
        `Redis not available, skipping delete operation for key: ${key}`,
      );
      return;
    }

    try {
      await this.client.del(key);
    } catch (err) {
      this.logger.error(`Redis del error for key ${key}: ${err.message}`);
    }
  }

  /**
   * Check if a key exists
   */
  async exists(key: string): Promise<boolean> {
    if (!this.isConnected) {
      this.logger.warn(
        `Redis not available, returning false for key existence check: ${key}`,
      );
      return false;
    }

    try {
      const result = await this.client.exists(key);
      return result === 1;
    } catch (err) {
      this.logger.error(`Redis exists error for key ${key}: ${err.message}`);
      return false;
    }
  }

  /**
   * Set multiple key-value pairs
   */
  async mset(keyValuePairs: Record<string, string>): Promise<void> {
    if (!this.isConnected) {
      this.logger.warn('Redis not available, skipping mset operation');
      return;
    }

    try {
      await this.client.mset(keyValuePairs);
    } catch (err) {
      this.logger.error(`Redis mset error: ${err.message}`);
    }
  }

  /**
   * Get multiple values by keys
   */
  async mget(keys: string[]): Promise<(string | null)[]> {
    if (!this.isConnected) {
      this.logger.warn(
        'Redis not available, returning nulls for mget operation',
      );
      return keys.map(() => null);
    }

    try {
      return await this.client.mget(keys);
    } catch (err) {
      this.logger.error(`Redis mget error: ${err.message}`);
      return keys.map(() => null);
    }
  }

  /**
   * Atomically increment a counter and set its expiry on the first increment.
   *
   * Uses a Lua script so that INCR and (conditional) EXPIRE execute as a single
   * atomic unit — no race between the two operations.
   *
   * @param key     - Redis key
   * @param windowSeconds - TTL applied only when the key is brand-new (count == 1)
   * @returns the new counter value after increment
   */
  async incrWithExpiry(key: string, windowSeconds: number): Promise<number> {
    if (!this.isConnected) {
      this.logger.warn(
        `Redis not available, returning 1 for incrWithExpiry: ${key}`,
      );
      return 1;
    }

    // Lua script: INCR atomically, then EXPIRE only on the very first increment
    const luaScript = `
      local current = redis.call('INCR', KEYS[1])
      if current == 1 then
        redis.call('EXPIRE', KEYS[1], ARGV[1])
      end
      return current
    `;

    try {
      const result = await (this.client as any).eval(
        luaScript,
        1,
        key,
        windowSeconds.toString(),
      );
      return result as number;
    } catch (err) {
      this.logger.error(
        `Redis incrWithExpiry error for key ${key}: ${err.message}`,
      );
      return 1;
    }
  }

  /**
   * Increment a key's value
   */
  async incr(key: string): Promise<number> {
    if (!this.isConnected) {
      this.logger.warn(
        `Redis not available, returning 0 for increment operation: ${key}`,
      );
      return 0;
    }

    try {
      return await this.client.incr(key);
    } catch (err) {
      this.logger.error(`Redis incr error for key ${key}: ${err.message}`);
      return 0;
    }
  }

  /**
   * Set a key's expiration time
   */
  async expire(key: string, seconds: number): Promise<void> {
    if (!this.isConnected) {
      this.logger.warn(
        `Redis not available, skipping expire operation for key: ${key}`,
      );
      return;
    }

    try {
      await this.client.expire(key, seconds);
    } catch (err) {
      this.logger.error(`Redis expire error for key ${key}: ${err.message}`);
    }
  }

  /**
   * Get TTL of a key
   */
  async ttl(key: string): Promise<number> {
    if (!this.isConnected) {
      this.logger.warn(
        `Redis not available, returning -1 for TTL operation: ${key}`,
      );
      return -1;
    }

    try {
      return await this.client.ttl(key);
    } catch (err) {
      this.logger.error(`Redis ttl error for key ${key}: ${err.message}`);
      return -1;
    }
  }

  /**
   * Disconnect from Redis
   */
  async onModuleDestroy() {
    try {
      await this.client.disconnect();
      this.isConnected = false;
      this.logger.log('Redis disconnected');
    } catch (err) {
      this.logger.error(`Redis disconnect error: ${err.message}`);
    }
  }

  // ─── New methods for token.service ─────────────────────────────────────────

  /** Set NX (only if not exists). Returns true if set, false if already existed. */
  async setNx(
    key: string,
    value: string,
    ttlSeconds?: number,
  ): Promise<boolean> {
    if (!this.isConnected) return false;
    try {
      let result: any;
      if (ttlSeconds) {
        result = await this.client.set(key, value, 'EX', ttlSeconds, 'NX');
      } else {
        result = await this.client.setnx(key, value);
      }
      return result === 'OK' || result === 1;
    } catch (err) {
      this.logger.error(`Redis setNx error for key ${key}: ${err.message}`);
      return false;
    }
  }

  /** Scan + return all keys matching pattern */
  async keys(pattern: string): Promise<string[]> {
    if (!this.isConnected) return [];
    try {
      return await this.client.keys(pattern);
    } catch (err) {
      this.logger.error(
        `Redis keys error for pattern ${pattern}: ${err.message}`,
      );
      return [];
    }
  }

  /** Delete multiple keys at once */
  async delMany(keys: string[]): Promise<void> {
    if (!this.isConnected || keys.length === 0) return;
    try {
      await this.client.del(...keys);
    } catch (err) {
      this.logger.error(`Redis delMany error: ${err.message}`);
    }
  }
}
