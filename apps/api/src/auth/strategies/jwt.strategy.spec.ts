// @ts-nocheck
/**
 * JwtStrategy contract: token type/JTI/blacklist, user state, role source,
 * and device-session validation. Request objects carry a Bearer header so the
 * strategy can hand the raw token to TokenService for blacklist lookups.
 */
import { UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';

import { JwtStrategy } from './jwt.strategy';
import { PrismaService } from '../../prisma/prisma.service';
import { RedisService } from '../../common/services/redis.service';
import { TokenService } from '../services/token.service';

const reqWithToken = (token = 'access.jwt') => ({
  headers: { authorization: `Bearer ${token}` },
});

const makeDbUser = (overrides: any = {}) => ({
  id: 'user-123',
  email: 'john@example.com',
  password: null,
  first_name: 'John',
  last_name: 'Doe',
  is_active: true,
  is_deleted: false,
  is_locked: false,
  lock_time: null,
  two_factor_enabled: false,
  email_verified: true,
  user_roles: [{ roles: { name: 'USER' } }],
  ...overrides,
});

const makePayload = (overrides: any = {}) => ({
  sub: 'user-123',
  type: 'ACCESS',
  jti: 'jti-1',
  deviceId: 'dev-1',
  roles: ['USER'],
  ...overrides,
});

describe('JwtStrategy', () => {
  let strategy: JwtStrategy;
  const mockPrisma = {
    users: { findFirst: jest.fn() },
    user_devices: { findFirst: jest.fn() },
  };
  const mockRedis = {
    get: jest.fn(),
    set: jest.fn(),
    del: jest.fn(),
  };
  const mockTokenService = {
    isTokenBlacklisted: jest.fn(),
  };
  const mockConfig = {
    get: jest.fn((key: string) =>
      key === 'JWT_SECRET' ? 'test-jwt-secret' : undefined,
    ),
  };

  beforeEach(async () => {
    mockRedis.get.mockResolvedValue(null);
    mockRedis.set.mockResolvedValue(undefined);
    mockRedis.del.mockResolvedValue(undefined);
    mockTokenService.isTokenBlacklisted.mockResolvedValue(false);
    mockPrisma.users.findFirst.mockResolvedValue(makeDbUser());
    mockPrisma.user_devices.findFirst.mockResolvedValue({ device_id: 'dev-1' });

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        JwtStrategy,
        { provide: ConfigService, useValue: mockConfig },
        { provide: PrismaService, useValue: mockPrisma },
        { provide: TokenService, useValue: mockTokenService },
        { provide: RedisService, useValue: mockRedis },
      ],
    }).compile();
    strategy = module.get(JwtStrategy);
  });

  afterEach(() => jest.clearAllMocks());

  describe('constructor', () => {
    it('refuses to start without JWT_SECRET', () => {
      const configWithoutSecret = {
        get: jest.fn(() => undefined),
      };
      expect(
        () =>
          new JwtStrategy(
            configWithoutSecret as any,
            mockPrisma as any,
            mockTokenService as any,
            mockRedis as any,
          ),
      ).toThrow('JWT_SECRET must be defined');
    });
  });

  describe('validate', () => {
    it('returns an authenticated user with cached roles and device id', async () => {
      const result = await strategy.validate(reqWithToken(), makePayload());

      expect(result).toMatchObject({
        id: 'user-123',
        roles: ['USER'],
        deviceId: 'dev-1',
        accessToken: 'access.jwt',
      });
      expect(mockRedis.set).toHaveBeenCalledWith(
        'cache:user:user-123',
        expect.any(String),
        60,
      );
    });

    it('rejects REFRESH tokens even when correctly signed', async () => {
      await expect(
        strategy.validate(reqWithToken(), makePayload({ type: 'REFRESH' })),
      ).rejects.toThrow(new UnauthorizedException('Invalid token type'));
      expect(mockPrisma.users.findFirst).not.toHaveBeenCalled();
    });

    it('rejects MFA_PENDING tokens', async () => {
      await expect(
        strategy.validate(reqWithToken(), makePayload({ type: 'MFA_PENDING' })),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('rejects tokens without a type claim', async () => {
      const payload: any = makePayload();
      delete payload.type;
      await expect(strategy.validate(reqWithToken(), payload)).rejects.toThrow(
        UnauthorizedException,
      );
    });

    it('rejects tokens without a jti so revocation stays possible', async () => {
      const payload: any = makePayload();
      delete payload.jti;
      await expect(strategy.validate(reqWithToken(), payload)).rejects.toThrow(
        new UnauthorizedException('Invalid token'),
      );
    });

    it('rejects a blacklisted access token before any DB lookup', async () => {
      mockTokenService.isTokenBlacklisted.mockResolvedValue(true);

      await expect(
        strategy.validate(reqWithToken(), makePayload()),
      ).rejects.toThrow(new UnauthorizedException('Token has been revoked'));
      expect(mockTokenService.isTokenBlacklisted).toHaveBeenCalledWith(
        'access.jwt',
      );
      expect(mockPrisma.users.findFirst).not.toHaveBeenCalled();
    });

    it('rejects a deleted user', async () => {
      mockPrisma.users.findFirst.mockResolvedValue(null);
      await expect(
        strategy.validate(reqWithToken(), makePayload()),
      ).rejects.toThrow(new UnauthorizedException('User not found'));
    });

    it('rejects a disabled user', async () => {
      mockPrisma.users.findFirst.mockResolvedValue(
        makeDbUser({ is_active: false }),
      );
      await expect(
        strategy.validate(reqWithToken(), makePayload()),
      ).rejects.toThrow(new UnauthorizedException('Account is disabled'));
    });

    it('rejects a locked user while lock_time is in the future', async () => {
      mockPrisma.users.findFirst.mockResolvedValue(
        makeDbUser({
          is_locked: true,
          lock_time: new Date(Date.now() + 60_000).toISOString(),
        }),
      );
      await expect(
        strategy.validate(reqWithToken(), makePayload()),
      ).rejects.toThrow(new UnauthorizedException('Account is locked'));
    });

    it('allows a locked user once lock_time has passed', async () => {
      mockPrisma.users.findFirst.mockResolvedValue(
        makeDbUser({
          is_locked: true,
          lock_time: new Date(Date.now() - 60_000).toISOString(),
        }),
      );
      await expect(
        strategy.validate(reqWithToken(), makePayload()),
      ).resolves.toMatchObject({ id: 'user-123' });
    });

    it('evicts a cached snapshot that is stale and locked, then re-reads the DB', async () => {
      mockRedis.get.mockResolvedValue(
        JSON.stringify({
          user: makeDbUser({
            is_locked: true,
            lock_time: new Date(Date.now() + 60_000).toISOString(),
          }),
          roles: ['USER'],
        }),
      );
      mockPrisma.users.findFirst.mockResolvedValue(makeDbUser());

      await expect(
        strategy.validate(reqWithToken(), makePayload()),
      ).resolves.toMatchObject({ id: 'user-123' });
      expect(mockRedis.del).toHaveBeenCalledWith('cache:user:user-123');
      // Cached user supplied the record, so only the authoritative re-read hits DB.
      expect(mockPrisma.users.findFirst).toHaveBeenCalledTimes(1);
    });

    it('uses cached roles for up to 60s instead of the JWT role claim', async () => {
      mockRedis.get.mockResolvedValue(
        JSON.stringify({
          user: makeDbUser(),
          roles: ['ADMIN'],
        }),
      );

      const result = await strategy.validate(
        reqWithToken(),
        makePayload({ roles: ['USER'] }),
      );

      expect(result.roles).toEqual(['ADMIN']);
      expect(mockPrisma.users.findFirst).not.toHaveBeenCalled();
    });

    it('falls back to DB roles when the cached entry is corrupt', async () => {
      mockRedis.get.mockResolvedValue('{not-json');
      const result = await strategy.validate(reqWithToken(), makePayload());
      expect(result.roles).toEqual(['USER']);
      // Corrupt cache is treated as a miss: one DB read, no eviction (cached
      // is truthy, but the fallback user is clean).
      expect(mockPrisma.users.findFirst).toHaveBeenCalledTimes(1);
      expect(mockRedis.del).not.toHaveBeenCalled();
    });

    it('rejects a stale or forged deviceId claim', async () => {
      mockPrisma.user_devices.findFirst.mockResolvedValue(null);
      await expect(
        strategy.validate(
          reqWithToken(),
          makePayload({ deviceId: 'dev-stale' }),
        ),
      ).rejects.toThrow(
        new UnauthorizedException('Device session is no longer active'),
      );
    });

    it('does not consult the device table for tokens without deviceId', async () => {
      const payload: any = makePayload();
      delete payload.deviceId;
      const result = await strategy.validate(reqWithToken(), payload);
      expect(result.deviceId).toBeNull();
      expect(mockPrisma.user_devices.findFirst).not.toHaveBeenCalled();
    });
  });
});
