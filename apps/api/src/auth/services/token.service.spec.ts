// @ts-nocheck
/**
 * TokenService contract: JWT type claims, JTI keying, Redis outage policy,
 * blacklist checks, and device/user session revocation.
 */
import { ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Test, TestingModule } from '@nestjs/testing';

import { TokenService } from './token.service';
import { RedisService } from '../../common/services/redis.service';
import { PrismaService } from '../../prisma/prisma.service';

const USER = { id: 'user-123', email: 'john@example.com', roles: ['USER'] };

describe('TokenService', () => {
  let service: TokenService;
  const mockJwt = {
    sign: jest.fn(),
    verify: jest.fn(),
  };
  const mockRedis = {
    isAvailable: jest.fn(),
    set: jest.fn(),
    get: jest.fn(),
    exists: jest.fn(),
    del: jest.fn(),
    keys: jest.fn(),
    delMany: jest.fn(),
  };
  const mockPrisma = {
    user_devices: { updateMany: jest.fn() },
  };
  let configValues: Record<string, string>;

  const buildService = async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TokenService,
        { provide: JwtService, useValue: mockJwt },
        {
          provide: ConfigService,
          useValue: { get: jest.fn((key: string, fallback?: string) => configValues[key] ?? fallback) },
        },
        { provide: RedisService, useValue: mockRedis },
        { provide: PrismaService, useValue: mockPrisma },
      ],
    }).compile();
    return module.get<TokenService>(TokenService);
  };

  beforeEach(async () => {
    configValues = {};
    mockJwt.sign.mockReturnValue('signed.jwt');
    mockJwt.verify.mockReturnValue({});
    mockRedis.isAvailable.mockReturnValue(true);
    mockRedis.set.mockResolvedValue(undefined);
    mockRedis.get.mockResolvedValue(null);
    mockRedis.exists.mockResolvedValue(false);
    mockRedis.del.mockResolvedValue(undefined);
    mockRedis.keys.mockResolvedValue([]);
    mockRedis.delMany.mockResolvedValue(undefined);
    mockPrisma.user_devices.updateMany.mockResolvedValue({ count: 1 });
    service = await buildService();
  });

  afterEach(() => jest.clearAllMocks());

  describe('token generation', () => {
    it('signs access tokens with ACCESS type, roles, deviceId and a jti', () => {
      expect(service.generateAccessToken(USER, 'dev-1')).toBe('signed.jwt');
      const [payload, options] = mockJwt.sign.mock.calls[0];
      expect(payload).toMatchObject({
        sub: 'user-123',
        email: 'john@example.com',
        roles: ['USER'],
        deviceId: 'dev-1',
        type: 'ACCESS',
      });
      expect(payload.jti).toEqual(expect.any(String));
      expect(payload.iatMs).toEqual(expect.any(Number));
      expect(options).toEqual({ expiresIn: 900 });
    });

    it('signs refresh tokens with REFRESH type and returns the jti/ttl', () => {
      const result = service.generateRefreshToken(USER, 'dev-1');
      const [payload, options] = mockJwt.sign.mock.calls[0];
      expect(payload.type).toBe('REFRESH');
      expect(result.jti).toBe(payload.jti);
      expect(result.ttlSec).toBe(604800);
      expect(options).toEqual({ expiresIn: 604800 });
    });

    it('extends rememberMe refresh tokens to 28 days', () => {
      const result = service.generateRefreshToken(USER, 'dev-1', true);
      expect(mockJwt.sign.mock.calls[0][1]).toEqual({ expiresIn: 28 * 24 * 3600 });
      expect(result.ttlSec).toBe(28 * 24 * 3600);
    });

    it('signs short-lived MFA pending tokens', () => {
      service.generateMfaToken('user-123');
      expect(mockJwt.sign.mock.calls[0][0]).toMatchObject({
        sub: 'user-123',
        type: 'MFA_PENDING',
      });
      expect(mockJwt.sign.mock.calls[0][1]).toEqual({ expiresIn: 300 });
    });

    it('decodes only MFA_PENDING tokens', () => {
      mockJwt.verify.mockReturnValue({ sub: 'user-123', type: 'MFA_PENDING' });
      expect(service.decodeMfaToken('mfa')).toEqual({ userId: 'user-123' });
      mockJwt.verify.mockReturnValue({ sub: 'user-123', type: 'ACCESS' });
      expect(service.decodeMfaToken('access')).toBeNull();
      mockJwt.verify.mockImplementation(() => {
        throw new Error('bad signature');
      });
      expect(service.decodeMfaToken('forged')).toBeNull();
    });
  });

  describe('validateRefreshToken', () => {
    it('accepts a refresh token whose JTI matches the Redis session key', async () => {
      mockJwt.verify.mockReturnValue({
        sub: 'user-123',
        deviceId: 'dev-1',
        jti: 'jti-1',
        roles: ['USER'],
        type: 'REFRESH',
      });
      mockRedis.get.mockResolvedValue('jti-1');

      expect(await service.validateRefreshToken('rt')).toEqual({
        userId: 'user-123',
        deviceId: 'dev-1',
        roles: ['USER'],
      });
      expect(mockRedis.get).toHaveBeenCalledWith('refresh:user-123:dev-1');
    });

    it('uses an empty roles array when the claim is absent', async () => {
      mockJwt.verify.mockReturnValue({
        sub: 'user-123',
        deviceId: 'dev-1',
        jti: 'jti-1',
        type: 'REFRESH',
      });
      mockRedis.get.mockResolvedValue('jti-1');
      expect(await service.validateRefreshToken('rt')).toMatchObject({ roles: [] });
    });

    it.each(['ACCESS', 'MFA_PENDING', undefined])(
      'rejects a token with type=%s even with a valid JTI',
      async (type) => {
        const payload: any = {
          sub: 'user-123',
          deviceId: 'dev-1',
          jti: 'jti-1',
        };
        if (type !== undefined) payload.type = type;
        mockJwt.verify.mockReturnValue(payload);
        mockRedis.get.mockResolvedValue('jti-1');

        expect(await service.validateRefreshToken('access-as-refresh')).toBeNull();
        expect(mockRedis.get).not.toHaveBeenCalled();
      },
    );

    it('rejects a rotated/old JTI while Redis holds a newer one', async () => {
      mockJwt.verify.mockReturnValue({
        sub: 'user-123',
        deviceId: 'dev-1',
        jti: 'old-jti',
        type: 'REFRESH',
      });
      mockRedis.get.mockResolvedValue('new-jti');
      expect(await service.validateRefreshToken('old-rt')).toBeNull();
    });

    it('rejects when the session key was deleted by logout or device revocation', async () => {
      mockJwt.verify.mockReturnValue({
        sub: 'user-123',
        deviceId: 'dev-1',
        jti: 'jti-1',
        type: 'REFRESH',
      });
      mockRedis.get.mockResolvedValue(null);
      expect(await service.validateRefreshToken('rt')).toBeNull();
    });

    it('fails closed in every environment when Redis is unavailable', async () => {
      mockJwt.verify.mockReturnValue({ sub: 'user-123', type: 'REFRESH' });
      mockRedis.isAvailable.mockReturnValue(false);
      configValues.NODE_ENV = 'development';
      const devService = await buildService();

      expect(await devService.validateRefreshToken('rt')).toBeNull();
      expect(mockRedis.get).not.toHaveBeenCalled();
    });

    it('rejects an unverifiable (expired or forged) token', async () => {
      mockJwt.verify.mockImplementation(() => {
        throw new Error('jwt expired');
      });
      expect(await service.validateRefreshToken('bad')).toBeNull();
    });

    it('stores refresh JTI under the per-user per-device key', async () => {
      await service.storeRefreshToken('user-123', 'dev-1', 'jti-1', 3600);
      expect(mockRedis.set).toHaveBeenCalledWith('refresh:user-123:dev-1', 'jti-1', 3600);
    });
  });

  describe('blacklistToken', () => {
    const futureExp = () => Math.floor(Date.now() / 1000) + 600;

    it('verifies the token before writing a JTI blacklist marker', async () => {
      mockJwt.verify.mockReturnValue({ jti: 'jti-1', exp: futureExp() });
      await service.blacklistToken('access');
      expect(mockJwt.verify).toHaveBeenCalledWith('access');
      expect(mockRedis.set).toHaveBeenCalledWith('blacklist:jti-1', '1', expect.any(Number));
    });

    it.each([
      ['missing jti', { exp: futureExp() }],
      ['missing exp', { jti: 'jti-1' }],
    ])('rejects a payload with %s', async (_case, payload) => {
      mockJwt.verify.mockReturnValue(payload);
      await expect(service.blacklistToken('access')).rejects.toThrow(
        ServiceUnavailableException,
      );
      expect(mockRedis.set).not.toHaveBeenCalled();
    });

    it('does not revoke an already-expired token', async () => {
      mockJwt.verify.mockReturnValue({
        jti: 'jti-1',
        exp: Math.floor(Date.now() / 1000) - 10,
      });
      await expect(service.blacklistToken('expired')).resolves.toBeUndefined();
      expect(mockRedis.set).not.toHaveBeenCalled();
    });

    it('throws for a malformed token that cannot be verified', async () => {
      mockJwt.verify.mockImplementation(() => {
        const error: any = new Error('invalid signature');
        error.name = 'JsonWebTokenError';
        throw error;
      });
      await expect(service.blacklistToken('forged')).rejects.toThrow(
        ServiceUnavailableException,
      );
    });

    it('fails closed in production when Redis is unavailable', async () => {
      configValues.NODE_ENV = 'production';
      const prodService = await buildService();
      mockRedis.isAvailable.mockReturnValue(false);
      mockJwt.verify.mockReturnValue({ jti: 'jti-1', exp: futureExp() });

      await expect(prodService.blacklistToken('access')).rejects.toThrow(
        ServiceUnavailableException,
      );
      expect(mockRedis.set).not.toHaveBeenCalled();
    });

    it('fails open for this JTI in non-production when Redis is unavailable', async () => {
      configValues.NODE_ENV = 'test';
      const testService = await buildService();
      mockRedis.isAvailable.mockReturnValue(false);
      mockJwt.verify.mockReturnValue({ jti: 'jti-1', exp: futureExp() });

      await expect(testService.blacklistToken('access')).resolves.toBeUndefined();
      expect(mockRedis.set).not.toHaveBeenCalled();
    });
  });

  describe('isTokenBlacklisted', () => {
    it('returns true for a JTI present in Redis', async () => {
      mockJwt.verify.mockReturnValue({ jti: 'jti-1', sub: 'user-123', exp: 1 });
      mockRedis.exists.mockResolvedValue(true);
      expect(await service.isTokenBlacklisted('access')).toBe(true);
      expect(mockRedis.exists).toHaveBeenCalledWith('blacklist:jti-1');
    });

    it('returns false for a clean token with no revocation markers', async () => {
      mockJwt.verify.mockReturnValue({
        jti: 'jti-1',
        sub: 'user-123',
        iatMs: Date.now(),
        deviceId: 'dev-1',
      });
      expect(await service.isTokenBlacklisted('access')).toBe(false);
    });

    it('rejects tokens issued at or before a user-level revocation marker', async () => {
      const revokedAt = Date.now();
      mockJwt.verify.mockReturnValue({
        jti: 'jti-1',
        sub: 'user-123',
        iatMs: revokedAt,
      });
      mockRedis.get.mockImplementation((key: string) =>
        Promise.resolve(key === 'revoked-user:user-123' ? `${revokedAt}` : null),
      );
      expect(await service.isTokenBlacklisted('old-access')).toBe(true);
    });

    it('rejects tokens issued at or before a device-level revocation marker', async () => {
      const revokedAt = Date.now();
      mockJwt.verify.mockReturnValue({
        jti: 'jti-1',
        sub: 'user-123',
        iatMs: revokedAt,
        deviceId: 'dev-1',
      });
      mockRedis.get.mockImplementation((key: string) =>
        Promise.resolve(
          key === 'revoked-device:user-123:dev-1' ? `${revokedAt}` : null,
        ),
      );
      expect(await service.isTokenBlacklisted('old-access')).toBe(true);
    });

    it('keeps tokens issued after logout-all valid', async () => {
      const revokedAt = Date.now();
      mockJwt.verify.mockReturnValue({
        jti: 'jti-1',
        sub: 'user-123',
        iatMs: revokedAt + 1000,
      });
      mockRedis.get.mockResolvedValue(`${revokedAt}`);
      expect(await service.isTokenBlacklisted('new-access')).toBe(false);
    });

    it('uses legacy iat when iatMs is absent', async () => {
      const nowSec = Math.floor(Date.now() / 1000);
      mockJwt.verify.mockReturnValue({
        jti: 'jti-1',
        sub: 'user-123',
        iat: nowSec,
      });
      mockRedis.get.mockResolvedValue(`${nowSec * 1000}`);
      expect(await service.isTokenBlacklisted('legacy-access')).toBe(true);
    });

    it('fails closed in production on Redis outage and fails open in test', async () => {
      mockJwt.verify.mockReturnValue({ jti: 'jti-1', sub: 'user-123' });
      mockRedis.isAvailable.mockReturnValue(false);
      expect(await service.isTokenBlacklisted('access')).toBe(false);

      configValues.NODE_ENV = 'production';
      const prodService = await buildService();
      expect(await prodService.isTokenBlacklisted('access')).toBe(true);
    });

    it('fails closed in production on an unverifiable token', async () => {
      configValues.NODE_ENV = 'production';
      const prodService = await buildService();
      mockJwt.verify.mockImplementation(() => {
        throw new Error('jwt malformed');
      });
      expect(await prodService.isTokenBlacklisted('bad')).toBe(true);
    });

    it('fails closed in production when the blacklist read throws', async () => {
      configValues.NODE_ENV = 'production';
      const prodService = await buildService();
      mockJwt.verify.mockReturnValue({ jti: 'jti-1', sub: 'user-123' });
      mockRedis.exists.mockRejectedValue(new Error('redis down'));
      await expect(prodService.isTokenBlacklisted('access')).resolves.toBe(true);
    });
  });

  describe('session revocation', () => {
    it('deletes the device refresh key and marks the device inactive', async () => {
      await service.revokeDeviceSession('user-123', 'dev-1');
      expect(mockRedis.del).toHaveBeenCalledWith('refresh:user-123:dev-1');
      expect(mockRedis.set).toHaveBeenCalledWith(
        'revoked-device:user-123:dev-1',
        expect.any(String),
        expect.any(Number),
      );
      expect(mockPrisma.user_devices.updateMany).toHaveBeenCalledWith({
        where: { user_id: 'user-123', device_id: 'dev-1' },
        data: { active: false },
      });
    });

    it('revokes all sessions with a user-level marker', async () => {
      mockRedis.keys.mockResolvedValue(['refresh:user-123:dev-1']);
      await service.revokeAllSessions('user-123');
      expect(mockRedis.delMany).toHaveBeenCalledWith(['refresh:user-123:dev-1']);
      expect(mockRedis.set).toHaveBeenCalledWith(
        'revoked-user:user-123',
        expect.any(String),
        expect.any(Number),
      );
    });

    it('revokes other devices without revoking the current one', async () => {
      mockRedis.keys.mockResolvedValue([
        'refresh:user-123:dev-1',
        'refresh:user-123:dev-2',
      ]);
      await service.revokeOtherSessions('user-123', 'dev-1');
      expect(mockRedis.delMany).toHaveBeenCalledWith(['refresh:user-123:dev-2']);
      expect(mockRedis.set).toHaveBeenCalledWith(
        'revoked-device:user-123:dev-2',
        expect.any(String),
        expect.any(Number),
      );
      expect(mockPrisma.user_devices.updateMany).toHaveBeenCalledWith({
        where: { user_id: 'user-123', device_id: { not: 'dev-1' } },
        data: { active: false },
      });
    });

    it('counts active sessions from refresh keys', async () => {
      mockRedis.keys.mockResolvedValue(['a', 'b']);
      expect(await service.getActiveSessionCount('user-123')).toBe(2);
    });

    it('throws in production when a device session cannot be revoked without Redis', async () => {
      configValues.NODE_ENV = 'production';
      const prodService = await buildService();
      mockRedis.isAvailable.mockReturnValue(false);
      await expect(
        prodService.revokeDeviceSession('user-123', 'dev-1'),
      ).rejects.toThrow(ServiceUnavailableException);
    });
  });
});
