import { HttpStatus } from '@nestjs/common';
import { RateLimiterService, RateLimitConfig } from './rate-limiter.service';

/**
 * Fake shared atomic Redis counter. Mirrors the Lua primitive used by
 * RedisService.incrWithExpiry: INCR + EXPIRE (only on count == 1) in one
 * operation, with TTL read back separately. Two limiter instances pointed at
 * this store therefore share the same budget exactly as they would in Redis.
 */
class SharedAtomicStore {
  readonly buckets = new Map<string, { count: number; expiresAt: number }>();
  readonly noTtlKeys = new Set<string>();
  failures = 0;
  ttlFailures = 0;
  now = 0;
  readonly ttlSets: number[] = [];

  incrWithExpiry = async (
    key: string,
    windowSeconds: number,
  ): Promise<number> => {
    if (this.failures > 0) {
      this.failures -= 1;
      throw new Error('Redis connection lost');
    }
    const bucket = this.buckets.get(key);
    if (bucket && bucket.expiresAt <= this.now) this.buckets.delete(key);
    const existing = this.buckets.get(key);
    if (existing) {
      existing.count += 1;
      return existing.count;
    }
    this.ttlSets.push(windowSeconds);
    this.buckets.set(key, {
      count: 1,
      expiresAt: this.now + windowSeconds * 1000,
    });
    return 1;
  };

  ttl = async (key: string): Promise<number> => {
    if (this.ttlFailures > 0) {
      this.ttlFailures -= 1;
      throw new Error('Redis TTL read failed');
    }
    if (this.noTtlKeys.has(key)) return -1;
    const bucket = this.buckets.get(key);
    if (!bucket) return -2;
    if (bucket.expiresAt <= this.now) {
      this.buckets.delete(key);
      return -2;
    }
    return Math.ceil((bucket.expiresAt - this.now) / 1000);
  };

  get = async (key: string): Promise<string | null> => {
    const bucket = this.buckets.get(key);
    return bucket ? String(bucket.count) : null;
  };

  del = async (key: string): Promise<void> => {
    this.buckets.delete(key);
  };
}

const aiWriteConfig: RateLimitConfig = {
  limit: 3,
  window: 60,
  keyPrefix: 'chat:user',
  failurePolicy: 'closed',
};

describe('RateLimiterService — distributed SEC-06', () => {
  let store: SharedAtomicStore;
  let service: RateLimiterService;

  beforeEach(() => {
    store = new SharedAtomicStore();
    service = new RateLimiterService(store as any);
    jest.spyOn(Date, 'now').mockImplementation(() => store.now);
  });

  afterEach(() => jest.restoreAllMocks());

  it('uses a single atomic incrWithExpiry call with the configured window (no local counter)', async () => {
    const spy = jest.spyOn(store, 'incrWithExpiry');

    const first = await service.checkRateLimit('user-1', aiWriteConfig);
    const second = await service.checkRateLimit('user-1', aiWriteConfig);

    expect(spy).toHaveBeenCalledTimes(2);
    expect(spy).toHaveBeenCalledWith('rate_limit:chat:user:user-1', 60);
    expect(store.buckets.get('rate_limit:chat:user:user-1')?.count).toBe(2);
    expect(store.ttlSets).toEqual([60]); // TTL set only on the first increment
    expect(first.success).toBe(true);
    expect(second.success).toBe(true);
  });

  it('allows the last request, then returns 429 with TTL-based retry-after at limit + 1', async () => {
    let last: any;
    for (let i = 0; i < aiWriteConfig.limit; i++) {
      last = await service.checkRateLimit('user-1', aiWriteConfig);
    }
    expect(last.remaining).toBe(0);
    expect(last.retryAfterSeconds).toBe(60);
    expect(last.resetTime.getTime()).toBe(store.now + 60_000);

    store.now += 10_000; // 10 seconds into the window: 50 seconds remain
    let error: any;
    try {
      await service.checkRateLimit('user-1', aiWriteConfig);
    } catch (e) {
      error = e;
    }
    expect(error?.getStatus()).toBe(HttpStatus.TOO_MANY_REQUESTS);
    expect(error?.getResponse()).toMatchObject({
      remaining: 0,
      limit: 3,
      retryAfterSeconds: 50,
      resetAt: Math.floor((store.now + 50_000) / 1000),
      resetTime: new Date(store.now + 50_000).toISOString(),
    });
  });

  it('resets the counter when the Redis TTL expires', async () => {
    await service.checkRateLimit('user-1', aiWriteConfig);
    await service.checkRateLimit('user-1', aiWriteConfig);
    expect(store.buckets.get('rate_limit:chat:user:user-1')?.count).toBe(2);

    store.now += 60_000;
    const result = await service.checkRateLimit('user-1', aiWriteConfig);
    expect(result.remaining).toBe(2);
    expect(store.buckets.get('rate_limit:chat:user:user-1')?.count).toBe(1);
    expect(store.ttlSets).toEqual([60, 60]);
  });

  it('shares one quota across two limiter instances (two API processes)', async () => {
    const other = new RateLimiterService(store as any);
    const config = { ...aiWriteConfig, limit: 2 };

    await service.checkRateLimit('user-2', config);
    await other.checkRateLimit('user-2', config);
    expect(store.buckets.get('rate_limit:chat:user:user-2')?.count).toBe(2);

    await expect(other.checkRateLimit('user-2', config)).rejects.toMatchObject({
      status: HttpStatus.TOO_MANY_REQUESTS,
    });
    await expect(
      service.checkRateLimit('user-2', config),
    ).rejects.toMatchObject({
      status: HttpStatus.TOO_MANY_REQUESTS,
    });
  });

  it('fails closed (503) when the Redis increment fails for an AI write config', async () => {
    store.failures = 1;

    let error: any;
    try {
      await service.checkRateLimit('user-3', aiWriteConfig);
    } catch (e) {
      error = e;
    }
    expect(error?.getStatus()).toBe(HttpStatus.SERVICE_UNAVAILABLE);
    expect(error?.getResponse()).toMatchObject({
      limit: 3,
      retryAfterSeconds: 60,
    });
    expect(store.buckets.size).toBe(0);
  });

  it('fails closed when the TTL read fails or the atomic script left no TTL', async () => {
    store.ttlFailures = 1;
    await expect(
      service.checkRateLimit('user-4', aiWriteConfig),
    ).rejects.toMatchObject({
      status: HttpStatus.SERVICE_UNAVAILABLE,
    });

    store.noTtlKeys.add('rate_limit:chat:user:no-ttl');
    store.buckets.set('rate_limit:chat:user:no-ttl', {
      count: 1,
      expiresAt: store.now + 86_400_000,
    });
    const noTtl = { ...aiWriteConfig, keyPrefix: 'chat:user' };
    await expect(service.checkRateLimit('no-ttl', noTtl)).rejects.toMatchObject(
      {
        status: HttpStatus.SERVICE_UNAVAILABLE,
      },
    );
  });

  it('honours an explicitly configured fail-open policy for non-sensitive paths', async () => {
    store.failures = 1;
    const result = await service.checkRateLimit('reader-1', {
      ...aiWriteConfig,
      keyPrefix: 'read',
      failurePolicy: 'open',
    });
    expect(result.success).toBe(true);
    expect(result.remaining).toBe(3);
  });

  it('rejects invalid configuration instead of silently disabling the limiter', async () => {
    await expect(
      service.checkRateLimit('u', { ...aiWriteConfig, limit: 0 }),
    ).rejects.toThrow(/limit/);
    await expect(
      service.checkRateLimit('u', { ...aiWriteConfig, window: 0 }),
    ).rejects.toThrow(/window/);
    await expect(
      service.checkRateLimit('u', {
        ...aiWriteConfig,
        failurePolicy: 'bogus' as any,
      }),
    ).rejects.toThrow(/failurePolicy/);
    expect(store.buckets.size).toBe(0);
  });
});
