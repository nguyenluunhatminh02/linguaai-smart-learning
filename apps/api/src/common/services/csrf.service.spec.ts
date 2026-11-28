import { ConfigService } from '@nestjs/config';
import { CsrfService } from './csrf.service';

type RedisStub = {
  store: Map<string, string>;
  set: jest.Mock;
  get: jest.Mock;
  del: jest.Mock;
};

function setup(options: { secret?: string } = {}) {
  const store = new Map<string, string>();
  const redis: RedisStub = {
    store,
    set: jest.fn(async (key: string, value: string, ttl?: number) => {
      store.set(key, value);
      if (ttl !== undefined) {
        (redis as any).lastTtl = ttl;
      }
    }),
    get: jest.fn(async (key: string) => store.get(key) ?? null),
    del: jest.fn(async (key: string) => {
      store.delete(key);
    }),
  };
  const config = {
    get: jest.fn((key: string) =>
      key === 'JWT_SECRET' ? options.secret : undefined,
    ),
  } as unknown as ConfigService;
  const service = new CsrfService(config, redis as any);
  return { service, redis, config };
}

describe('CsrfService', () => {
  describe('plain tokens', () => {
    it('stores only a SHA-256 hash and validates the original token', async () => {
      const { service, redis } = setup({ secret: 'test-secret' });
      const token = await service.generateToken('session-a');

      expect(token).toMatch(/^[0-9a-f]{64}$/);
      const stored = redis.store.get('csrf:session-a');
      expect(stored).toBe(service.hashToken(token));
      expect(stored).not.toBe(token);
      await expect(service.validateToken(token, 'session-a')).resolves.toBe(true);
    });

    it('rejects malformed, cross-session and missing tokens', async () => {
      const { service } = setup({ secret: 'test-secret' });
      const token = await service.generateToken('session-a');

      await expect(service.validateToken('', 'session-a')).resolves.toBe(false);
      await expect(service.validateToken('short', 'session-a')).resolves.toBe(false);
      await expect(service.validateToken(token, 'session-b')).resolves.toBe(false);
      await expect(service.validateToken(token, '')).resolves.toBe(false);
    });

    it('fails closed when Redis has no token (outage or expiry)', async () => {
      const { service, redis } = setup({ secret: 'test-secret' });
      const token = await service.generateToken('session-a');
      redis.get.mockResolvedValueOnce(null);

      await expect(service.validateToken(token, 'session-a')).resolves.toBe(false);
    });

    it('fails closed when Redis throws', async () => {
      const { service, redis } = setup({ secret: 'test-secret' });
      const token = await service.generateToken('session-a');
      redis.get.mockRejectedValueOnce(new Error('redis down'));

      await expect(service.validateToken(token, 'session-a')).resolves.toBe(false);
    });

    it('does not log the session identifier', async () => {
      const { service } = setup({ secret: 'test-secret' });
      const warn = jest.spyOn((service as any).logger, 'warn').mockImplementation(() => undefined);

      await service.validateToken('a'.repeat(64), 'sensitive-session-id');

      expect(warn).toHaveBeenCalled();
      expect(JSON.stringify(warn.mock.calls)).not.toContain('sensitive-session-id');
    });
  });

  describe('signed tokens', () => {
    it('issues a session-bound token and accepts it exactly once', async () => {
      const { service, redis } = setup({ secret: 'test-secret' });
      const signed = await service.generateSignedToken('session-a');
      const [token] = signed.split(':');

      expect(redis.store.get('csrf:signed:session-a')).toBe(service.hashToken(token));
      await expect(service.verifySignedToken(signed, 'session-a')).resolves.toBe(true);
      await expect(service.verifySignedToken(signed, 'session-a')).resolves.toBe(false);
    });

    it('rejects cross-session replay and tampering', async () => {
      const { service } = setup({ secret: 'test-secret' });
      const signed = await service.generateSignedToken('session-a');

      await expect(service.verifySignedToken(signed, 'session-b')).resolves.toBe(false);
      const [token, timestamp, signature] = signed.split(':');
      const tampered = `${'f'.repeat(64)}:${timestamp}:${signature}`;
      await expect(service.verifySignedToken(tampered, 'session-a')).resolves.toBe(false);
    });

    it('rejects expired and malformed tokens', async () => {
      jest.useFakeTimers().setSystemTime(new Date('2026-01-01T00:00:00Z'));
      const { service } = setup({ secret: 'test-secret' });
      const signed = await service.generateSignedToken('session-a');

      jest.setSystemTime(new Date('2026-01-01T02:00:00Z'));
      await expect(service.verifySignedToken(signed, 'session-a')).resolves.toBe(false);
      await expect(service.verifySignedToken('garbage', 'session-a')).resolves.toBe(false);
      await expect(service.verifySignedToken(signed + ':extra', 'session-a')).resolves.toBe(false);
      jest.useRealTimers();
    });

    it('aligns the Redis TTL with the token maxAge', async () => {
      const { service, redis } = setup({ secret: 'test-secret' });
      await service.generateSignedToken('session-a', 5 * 60 * 1000);

      expect((redis as any).lastTtl).toBe(300);
    });

    it('fails closed when the Redis entry is missing (outage or revocation)', async () => {
      const { service, redis } = setup({ secret: 'test-secret' });
      const signed = await service.generateSignedToken('session-a');
      redis.get.mockResolvedValueOnce(null);

      await expect(service.verifySignedToken(signed, 'session-a')).resolves.toBe(false);
    });

    it('refuses to issue or verify tokens without a configured secret', async () => {
      const { service } = setup();

      await expect(service.generateSignedToken('session-a')).rejects.toThrow(
        'JWT_SECRET is required',
      );
      await expect(
        service.verifySignedToken(`${'a'.repeat(64)}:1767225600000:${'b'.repeat(64)}`, 'session-a'),
      ).rejects.toThrow('JWT_SECRET is required');
    });
  });
});
