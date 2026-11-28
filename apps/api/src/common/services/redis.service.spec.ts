import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { RedisService } from './redis.service';
import { RateLimiterService } from './rate-limiter.service';

// ioredis must be mocked before the service is imported: the service creates
// the client in onModuleInit and attaches event handlers to it.
jest.mock('ioredis', () => {
  // tsconfig has allowSyntheticDefaultImports without esModuleInterop, so the
  // compiled service reads `ioredis_1.default`; expose the ctor as default.
  const ctor = jest.fn().mockImplementation(() => ({
    on: jest.fn().mockReturnThis(),
    ping: jest.fn().mockResolvedValue('PONG'),
    set: jest.fn().mockResolvedValue('OK'),
    setnx: jest.fn().mockResolvedValue(1),
    get: jest.fn().mockResolvedValue(null),
    del: jest.fn().mockResolvedValue(1),
    exists: jest.fn().mockResolvedValue(0),
    mset: jest.fn().mockResolvedValue('OK'),
    mget: jest.fn().mockResolvedValue([]),
    incr: jest.fn().mockResolvedValue(1),
    expire: jest.fn().mockResolvedValue(1),
    ttl: jest.fn().mockResolvedValue(-2),
    eval: jest.fn().mockResolvedValue(1),
    keys: jest.fn().mockResolvedValue([]),
    disconnect: jest.fn().mockResolvedValue(undefined),
  }));
  return { __esModule: true, default: ctor };
});

const Redis = (require('ioredis') as { default: jest.Mock }).default;
const { HttpException, HttpStatus } = require('@nestjs/common');
const { DateUtil } = require('../utils/date.util');

describe('RedisService', () => {
  let service: RedisService;
  let client: any;
  let configGet: jest.Mock;

  async function createService(): Promise<RedisService> {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RedisService,
        {
          provide: ConfigService,
          useValue: {
            get: configGet,
          },
        },
      ],
    }).compile();

    const created = module.get<RedisService>(RedisService);
    await created.onModuleInit();
    return created;
  }

  function emit(event: string, ...args: any[]): void {
    for (const call of client.on.mock.calls) {
      if (call[0] === event) call[1](...args);
    }
  }

  beforeEach(async () => {
    jest.clearAllMocks();
    configGet = jest.fn((key: string) => {
      const map: Record<string, any> = {
        REDIS_HOST: 'localhost',
        REDIS_PORT: 6379,
        REDIS_PASSWORD: undefined,
      };
      return map[key];
    });
    service = await createService();
    // The most recently constructed ioredis instance belongs to this service.
    client = Redis.mock.results[Redis.mock.results.length - 1].value;
  });

  afterEach(async () => {
    await service.onModuleDestroy();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('creates the client with the real REDIS_* config keys', () => {
    expect(configGet).toHaveBeenCalledWith('REDIS_HOST');
    expect(configGet).toHaveBeenCalledWith('REDIS_PORT');
    expect(configGet).toHaveBeenCalledWith('REDIS_PASSWORD');
    expect(Redis).toHaveBeenCalledWith(
      expect.objectContaining({ host: 'localhost', port: 6379 }),
    );
  });

  it('should return false for isAvailable before connection', () => {
    expect(service.isAvailable()).toBe(false);
  });

  it('should return null for get when not connected', async () => {
    const result = await service.get('test-key');
    expect(result).toBeNull();
    expect(client.get).not.toHaveBeenCalled();
  });

  it('should return false for exists when not connected', async () => {
    const result = await service.exists('test-key');
    expect(result).toBe(false);
    expect(client.exists).not.toHaveBeenCalled();
  });

  it('tracks connectivity from ioredis ready/end/reconnecting events', async () => {
    expect(service.isAvailable()).toBe(false);
    emit('ready');
    expect(service.isAvailable()).toBe(true);
    expect(await service.healthCheck()).toBe(true);

    emit('reconnecting');
    expect(service.isAvailable()).toBe(false);
    emit('ready');
    emit('end');
    expect(service.isAvailable()).toBe(false);
  });

  it('sets values with a TTL only when one is supplied, and swallows errors', async () => {
    emit('ready');
    await service.set('k', 'v');
    expect(client.set).toHaveBeenCalledWith('k', 'v');
    await service.set('k', 'v', 60);
    expect(client.set).toHaveBeenCalledWith('k', 'v', 'EX', 60);

    client.set.mockRejectedValueOnce(new Error('down'));
    await expect(service.set('k', 'v')).resolves.toBeUndefined();
  });

  it('fails open for read/delete operations on Redis errors', async () => {
    emit('ready');
    client.get.mockRejectedValueOnce(new Error('down'));
    client.exists.mockRejectedValueOnce(new Error('down'));
    client.del.mockRejectedValueOnce(new Error('down'));
    client.mset.mockRejectedValueOnce(new Error('down'));
    client.mget.mockRejectedValueOnce(new Error('down'));
    client.keys.mockRejectedValueOnce(new Error('down'));

    expect(await service.get('k')).toBeNull();
    expect(await service.exists('k')).toBe(false);
    await expect(service.del('k')).resolves.toBeUndefined();
    await expect(service.mset({ k: 'v' })).resolves.toBeUndefined();
    expect(await service.mget(['a', 'b'])).toEqual([null, null]);
    expect(await service.keys('rate_limit:*')).toEqual([]);
  });

  it('returns nulls/sentinel values for all reads while disconnected', async () => {
    expect(await service.get('k')).toBeNull();
    expect(await service.exists('k')).toBe(false);
    expect(await service.mget(['a', 'b'])).toEqual([null, null]);
    expect(await service.ttl('k')).toBe(-1);
    expect(await service.incr('k')).toBe(0);
    // Fail-open counter: callers treat 1 as the first request in a window.
    expect(await service.incrWithExpiry('k', 60)).toBe(1);
    expect(await service.setNx('k', 'v')).toBe(false);
    expect(await service.keys('*')).toEqual([]);
    await expect(service.expire('k', 60)).resolves.toBeUndefined();
    await expect(service.delMany(['k'])).resolves.toBeUndefined();
  });

  it('uses one atomic EVAL with the window TTL for incrWithExpiry', async () => {
    emit('ready');
    client.eval.mockResolvedValueOnce(1);
    expect(await service.incrWithExpiry('rate_limit:login:a', 900)).toBe(1);

    const [script, numKeys, key, ttl] = client.eval.mock.calls[0];
    expect(numKeys).toBe(1);
    expect(key).toBe('rate_limit:login:a');
    expect(ttl).toBe('900');
    expect(script).toContain("redis.call('INCR', KEYS[1])");
    expect(script).toContain('if current == 1 then');
    expect(script).toContain("redis.call('EXPIRE', KEYS[1], ARGV[1])");
  });

  it('counts concurrent incrWithExpiry calls atomically', async () => {
    emit('ready');
    // Simulate Redis serializing the Lua script: each EVAL resolves to the
    // next value of a single counter, with EXPIRE applied only on the first.
    let count = 0;
    client.eval.mockImplementation(async () => {
      count += 1;
      return count;
    });

    const results = await Promise.all(
      Array.from({ length: 25 }, () => service.incrWithExpiry('counter', 60)),
    );

    expect(results).toEqual(Array.from({ length: 25 }, (_, i) => i + 1));
    expect(client.eval).toHaveBeenCalledTimes(25);
  });

  it('keeps the TTL on reused keys and fails open when EVAL errors', async () => {
    emit('ready');
    client.eval
      .mockResolvedValueOnce(1)
      .mockResolvedValueOnce(2)
      .mockRejectedValueOnce(new Error('lua failed'));

    expect(await service.incrWithExpiry('k', 30)).toBe(1);
    expect(await service.incrWithExpiry('k', 30)).toBe(2);
    expect(await service.incrWithExpiry('k', 30)).toBe(1);
    // Every EVAL carries the TTL script, but Redis only applies EXPIRE when
    // the counter is new (current == 1).
    expect(client.eval).toHaveBeenCalledTimes(3);
    expect(client.eval.mock.calls[2][3]).toBe('30');
  });
});

describe('RateLimiterService', () => {
  let limiter: RateLimiterService;
  let redis: any;

  const config = { limit: 3, window: 900, keyPrefix: 'login' };

  beforeEach(() => {
    jest.clearAllMocks();
    redis = {
      incrWithExpiry: jest.fn(),
      ttl: jest.fn().mockResolvedValue(900),
      get: jest.fn().mockResolvedValue(null),
      del: jest.fn().mockResolvedValue(undefined),
    };
    limiter = new RateLimiterService(redis);
  });

  it('builds prefixed keys and reports remaining requests + reset time', async () => {
    redis.incrWithExpiry.mockResolvedValue(1);
    const nowSpy = jest.spyOn(Date, 'now').mockReturnValue(1_700_000_000_000);

    const result = await limiter.checkRateLimit('user@example.com', config);

    expect(redis.incrWithExpiry).toHaveBeenCalledWith(
      'rate_limit:login:user@example.com',
      900,
    );
    expect(result.success).toBe(true);
    expect(result.remaining).toBe(2);
    expect(result.resetTime).toEqual(
      DateUtil.addSeconds(900, new Date(1_700_000_000_000)),
    );
    nowSpy.mockRestore();
  });

  it('allows the last request and rejects limit+1 with a 429 and TTL-based reset', async () => {
    const nowSpy = jest.spyOn(Date, 'now').mockReturnValue(1_700_000_000_000);
    redis.incrWithExpiry.mockResolvedValueOnce(3).mockResolvedValueOnce(4);
    redis.ttl.mockResolvedValue(240);

    await expect(limiter.checkRateLimit('ip:1', config)).resolves.toMatchObject(
      {
        remaining: 0,
        success: true,
      },
    );

    let error: any;
    try {
      await limiter.checkRateLimit('ip:1', config);
    } catch (e) {
      error = e;
    }
    expect(error).toBeInstanceOf(HttpException);
    expect(error.getStatus()).toBe(HttpStatus.TOO_MANY_REQUESTS);
    expect(error.getResponse()).toMatchObject({
      remaining: 0,
      resetTime: DateUtil.addSeconds(
        240,
        new Date(1_700_000_000_000),
      ).toISOString(),
    });
    nowSpy.mockRestore();
  });

  it('fails closed when the limiter backend errors', async () => {
    redis.incrWithExpiry.mockRejectedValue(new Error('Redis down'));
    await expect(limiter.checkRateLimit('ip:2', config)).rejects.toMatchObject({
      status: HttpStatus.SERVICE_UNAVAILABLE,
    });
  });

  it('reports status without incrementing and resets the exact key', async () => {
    redis.get.mockResolvedValue('2');
    redis.ttl.mockResolvedValue(-2);

    expect(await limiter.getRateLimitStatus('k', config)).toEqual({
      current: 2,
      remaining: 1,
      resetTime: null,
    });
    expect(redis.incrWithExpiry).not.toHaveBeenCalled();

    await limiter.resetRateLimit('k', config.keyPrefix);
    expect(redis.del).toHaveBeenCalledWith('rate_limit:login:k');
  });
});
