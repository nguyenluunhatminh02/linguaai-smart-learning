import { Test, TestingModule } from '@nestjs/testing';
import { TokenBlacklistService } from './token-blacklist.service';
import { RedisService } from '../../common/services/redis.service';

describe('TokenBlacklistService', () => {
  let service: TokenBlacklistService;

  // addToBlacklist / isBlacklisted / removeFromBlacklist operate on the JWT's
  // `jti` claim (see token.service.ts), never on the raw JWT string.
  const JTI = '3f7a1c9e-2b4d-4c81-9e6f-1a2b3c4d5e6f';
  const OTHER_JTI = '9c8b7a65-4d3c-2e1f-0a9b-8c7d6e5f4a3b';

  const mockRedis = {
    isAvailable: jest.fn(),
    set: jest.fn(),
    exists: jest.fn(),
    del: jest.fn(),
  };

  beforeEach(async () => {
    // Reset all mocks before each test, then set default behaviors
    jest.resetAllMocks();
    mockRedis.isAvailable.mockReturnValue(true);
    mockRedis.set.mockResolvedValue(undefined);
    mockRedis.del.mockResolvedValue(undefined);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TokenBlacklistService,
        { provide: RedisService, useValue: mockRedis },
      ],
    }).compile();

    service = module.get<TokenBlacklistService>(TokenBlacklistService);
  });

  describe('addToBlacklist', () => {
    it('stores a JTI in Redis with TTL', async () => {
      await service.addToBlacklist(JTI, 900);
      expect(mockRedis.set).toHaveBeenCalledWith(`blacklist:${JTI}`, '1', 900);
    });

    it('skips blacklisting when Redis is unavailable', async () => {
      mockRedis.isAvailable.mockReturnValue(false);
      await service.addToBlacklist(JTI, 900);
      expect(mockRedis.set).not.toHaveBeenCalled();
    });
  });

  describe('isBlacklisted', () => {
    it('returns true for a blacklisted JTI', async () => {
      mockRedis.exists.mockResolvedValue(true);
      expect(await service.isBlacklisted(JTI)).toBe(true);
      expect(mockRedis.exists).toHaveBeenCalledWith(`blacklist:${JTI}`);
    });

    it('returns false for a non-blacklisted JTI', async () => {
      mockRedis.exists.mockResolvedValue(false);
      expect(await service.isBlacklisted(OTHER_JTI)).toBe(false);
      expect(mockRedis.exists).toHaveBeenCalledWith(`blacklist:${OTHER_JTI}`);
    });

    // Known security gap: the service fails open when Redis is down. This test
    // documents that behaviour so a future fail-closed change is deliberate.
    it('currently fails open when Redis is unavailable (revocation gap)', async () => {
      mockRedis.isAvailable.mockReturnValue(false);
      expect(await service.isBlacklisted(JTI)).toBe(false);
      expect(mockRedis.exists).not.toHaveBeenCalled();
    });
  });

  describe('removeFromBlacklist', () => {
    it('deletes the JTI key from Redis', async () => {
      await service.removeFromBlacklist(JTI);
      expect(mockRedis.del).toHaveBeenCalledWith(`blacklist:${JTI}`);
    });

    it('skips when Redis is unavailable', async () => {
      mockRedis.isAvailable.mockReturnValue(false);
      await service.removeFromBlacklist(JTI);
      expect(mockRedis.del).not.toHaveBeenCalled();
    });
  });

  describe('blacklistAllUserTokens', () => {
    it('stores user-level blacklist marker in Redis for 29 days (28-day rememberMe tokens plus slack)', async () => {
      await service.blacklistAllUserTokens('user-123');
      expect(mockRedis.set).toHaveBeenCalledWith('blacklist:user:user-123', '1', 29 * 24 * 3600);
    });

    it('skips when Redis is unavailable', async () => {
      mockRedis.isAvailable.mockReturnValue(false);
      await service.blacklistAllUserTokens('user-123');
      expect(mockRedis.set).not.toHaveBeenCalled();
    });
  });

  describe('areAllUserTokensBlacklisted', () => {
    it('returns true when user-level blacklist marker exists', async () => {
      mockRedis.exists.mockResolvedValue(true);
      expect(await service.areAllUserTokensBlacklisted('user-123')).toBe(true);
      expect(mockRedis.exists).toHaveBeenCalledWith('blacklist:user:user-123');
    });

    it('returns false when no user-level marker exists', async () => {
      mockRedis.exists.mockResolvedValue(false);
      expect(await service.areAllUserTokensBlacklisted('user-123')).toBe(false);
    });
  });

  describe('clearUserBlacklist', () => {
    it('removes the user-level blacklist marker', async () => {
      await service.clearUserBlacklist('user-123');
      expect(mockRedis.del).toHaveBeenCalledWith('blacklist:user:user-123');
    });
  });
});
