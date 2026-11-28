// @ts-nocheck
/**
 * MfaService Unit Tests
 *
 * Covers the public surface used by AuthService and the MFA controller:
 *   - setupMfa: creates/upserts an mfa_secrets row + returns secret/QR/backups
 *   - verifyAndEnableMfa: flips two_factor_enabled when TOTP code is valid
 *   - verifyCodeOrBackup: TOTP first, backup-code fallback (consumed once)
 *   - disableMfa: gated by code, deletes secret + clears flag
 *   - getMfaStatus / regenerateBackupCodes / getBackupCodesCount: thin queries
 *
 * otplib + qrcode are ESM modules that Jest cannot import natively, so they
 * are fully mocked at module level.
 */

jest.mock('otplib', () => ({
  generateSecret: jest.fn(),
  generateURI: jest.fn(),
  verify: jest.fn(),
}));

jest.mock('qrcode', () => ({
  toDataURL: jest.fn(),
}));

import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { BadRequestException } from '@nestjs/common';
import * as crypto from 'crypto';
import * as QRCode from 'qrcode';

import { MfaService } from './mfa.service';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditLogService } from '../../common/services/audit-log.service';
import { RedisService } from '../../common/services/redis.service';
import { generateSecret, generateURI, verify as otpVerify } from 'otplib';

const mockOtpVerify = otpVerify as unknown as jest.Mock;
const mockGenerateURI = generateURI as unknown as jest.Mock;
const mockGenerateSecret = generateSecret as unknown as jest.Mock;
const mockToDataURL = QRCode.toDataURL as unknown as jest.Mock;

const TEST_JWT_SECRET = 'test-jwt-secret-for-mfa-encryption-only';

// MfaService only accepts fully enrolled secrets; fixtures must carry both flags.
const ACTIVE_SECRET = { enabled: true, verified: true };
const HALF_CONFIGURED_SECRET = { enabled: false, verified: false };

const makeUser = (over: any = {}) => ({
  id: 'user-123',
  email: 'john@example.com',
  firstName: 'John',
  lastName: 'Doe',
  twoFactorEnabled: false,
  ...over,
});

const mockReq = (over: any = {}) =>
  ({
    headers: {},
    socket: { remoteAddress: '127.0.0.1' },
    get: jest.fn(),
    ...over,
  }) as any;

describe('MfaService', () => {
  let service: MfaService;

  const mockConfig = {
    get: jest.fn().mockImplementation((key: string, def?: any) => {
      if (key === 'JWT_SECRET') return TEST_JWT_SECRET;
      if (key === 'MFA_ISSUER') return 'TestApp';
      if (key === 'MFA_ENCRYPTION_KEY') return null; // fall back to JWT_SECRET
      return def;
    }),
  };

  const mockPrisma = {
    users: {
      findUnique: jest.fn(),
      update: jest.fn().mockResolvedValue({}),
    },
    mfa_secrets: {
      upsert: jest.fn().mockResolvedValue({}),
      findUnique: jest.fn(),
      update: jest.fn().mockResolvedValue({}),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      delete: jest.fn().mockResolvedValue({}),
    },
  };

  const mockAuditLog = {
    recordLoginHistory: jest.fn().mockResolvedValue(undefined),
  };

  const mockRedis = {
    del: jest.fn().mockResolvedValue(undefined),
    get: jest.fn().mockResolvedValue(null),
    set: jest.fn().mockResolvedValue(undefined),
    incr: jest.fn().mockResolvedValue(1),
    incrWithExpiry: jest.fn().mockResolvedValue(1),
    expire: jest.fn().mockResolvedValue(undefined),
  };

  beforeEach(async () => {
    jest.resetAllMocks();
    // Restore implementations wiped by resetAllMocks. Every test sees a
    // clean Redis (no lockout keys) and default "success" behaviour.
    mockGenerateSecret.mockReturnValue('GENERATED_SECRET');
    mockGenerateURI.mockReturnValue('otpauth://totp/test');
    mockToDataURL.mockResolvedValue('data:image/png;base64,mock-qr');
    mockOtpVerify.mockResolvedValue({ valid: true });
    mockConfig.get.mockImplementation((key: string, def?: any) => {
      if (key === 'JWT_SECRET') return TEST_JWT_SECRET;
      if (key === 'MFA_ISSUER') return 'TestApp';
      if (key === 'MFA_ENCRYPTION_KEY') return null;
      return def;
    });
    mockPrisma.users.update.mockResolvedValue({});
    mockPrisma.mfa_secrets.upsert.mockResolvedValue({});
    mockPrisma.mfa_secrets.update.mockResolvedValue({});
    mockPrisma.mfa_secrets.updateMany.mockResolvedValue({ count: 1 });
    mockPrisma.mfa_secrets.delete.mockResolvedValue({});
    mockAuditLog.recordLoginHistory.mockResolvedValue(undefined);
    mockRedis.del.mockResolvedValue(undefined);
    mockRedis.get.mockResolvedValue(null);
    mockRedis.set.mockResolvedValue(undefined);
    mockRedis.incr.mockResolvedValue(1);
    mockRedis.incrWithExpiry.mockResolvedValue(1);
    mockRedis.expire.mockResolvedValue(undefined);
    mockOtpVerify.mockResolvedValue({ valid: true });
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        MfaService,
        { provide: ConfigService, useValue: mockConfig },
        { provide: PrismaService, useValue: mockPrisma },
        { provide: AuditLogService, useValue: mockAuditLog },
        { provide: RedisService, useValue: mockRedis },
      ],
    }).compile();
    service = module.get<MfaService>(MfaService);
  });

  // ─── setupMfa ─────────────────────────────────────────────────────────────

  describe('setupMfa', () => {
    it('upserts an mfa_secrets row and returns secret + QR + 10 backup codes', async () => {
      const result = await service.setupMfa(makeUser() as any);

      expect(mockPrisma.mfa_secrets.upsert).toHaveBeenCalled();
      expect(result.secret).toBe('GENERATED_SECRET');
      expect(result.qrCodeUrl).toBe('data:image/png;base64,mock-qr');
      expect(result.backupCodes).toHaveLength(10);
      expect(result.backupCodes[0]).toMatch(/^[a-f0-9]+$/);
    });

    it('uses MFA_ISSUER from config in the otpauth URI', async () => {
      await service.setupMfa(makeUser() as any);
      expect(mockGenerateURI).toHaveBeenCalledWith(
        expect.objectContaining({
          issuer: 'TestApp',
          label: 'john@example.com',
        }),
      );
    });

    it('throws BadRequestException if MFA already enabled', async () => {
      await expect(
        service.setupMfa(makeUser({ twoFactorEnabled: true }) as any),
      ).rejects.toThrow(BadRequestException);
    });
  });

  // ─── verifyAndEnableMfa ───────────────────────────────────────────────────

  describe('verifyAndEnableMfa', () => {
    // Build a real encrypted secret so the service's decrypt() path works in test.
    const encKey = crypto.createHash('sha256').update(TEST_JWT_SECRET).digest();
    const encryptForTest = (plain: string) => {
      const iv = crypto.randomBytes(12);
      const cipher = crypto.createCipheriv('aes-256-gcm', encKey, iv);
      const enc = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
      const tag = cipher.getAuthTag();
      return `${iv.toString('hex')}:${tag.toString('hex')}:${enc.toString('hex')}`;
    };

    it('flips two_factor_enabled when TOTP is valid', async () => {
      mockPrisma.mfa_secrets.findUnique.mockResolvedValue({
        secret_encrypted: encryptForTest('SECRET'),
      });
      mockOtpVerify.mockResolvedValue({ valid: true });

      const result = await service.verifyAndEnableMfa(
        { code: '123456' },
        makeUser() as any,
        mockReq(),
      );

      expect(result).toEqual({ message: 'Two-factor authentication enabled' });
      expect(mockPrisma.users.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'user-123' },
          data: expect.objectContaining({ two_factor_enabled: true }),
        }),
      );
    });

    it('throws BadRequestException when no setup row exists', async () => {
      mockPrisma.mfa_secrets.findUnique.mockResolvedValue(null);
      await expect(
        service.verifyAndEnableMfa(
          { code: '123456' },
          makeUser() as any,
          mockReq(),
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('throws BadRequestException when TOTP is invalid', async () => {
      mockPrisma.mfa_secrets.findUnique.mockResolvedValue({
        secret_encrypted: encryptForTest('SECRET'),
      });
      mockOtpVerify.mockResolvedValue({ valid: false });
      await expect(
        service.verifyAndEnableMfa(
          { code: '000000' },
          makeUser() as any,
          mockReq(),
        ),
      ).rejects.toThrow(BadRequestException);
    });
  });

  // ─── verifyCodeOrBackup ───────────────────────────────────────────────────

  describe('verifyCodeOrBackup', () => {
    const encKey = crypto.createHash('sha256').update(TEST_JWT_SECRET).digest();
    const encryptForTest = (plain: string) => {
      const iv = crypto.randomBytes(12);
      const cipher = crypto.createCipheriv('aes-256-gcm', encKey, iv);
      const enc = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
      const tag = cipher.getAuthTag();
      return `${iv.toString('hex')}:${tag.toString('hex')}:${enc.toString('hex')}`;
    };

    it('returns false when no MFA secret is configured', async () => {
      mockPrisma.mfa_secrets.findUnique.mockResolvedValue(null);
      expect(
        await service.verifyCodeOrBackup(makeUser() as any, '000000'),
      ).toBe(false);
    });

    it('returns true on a valid TOTP code', async () => {
      mockPrisma.mfa_secrets.findUnique.mockResolvedValue({
        ...ACTIVE_SECRET,
        secret_encrypted: encryptForTest('SECRET'),
        backup_codes: null,
      });
      mockOtpVerify.mockResolvedValue({ valid: true });
      expect(
        await service.verifyCodeOrBackup(makeUser() as any, '123456'),
      ).toBe(true);
    });

    it('falls back to backup code and consumes it when TOTP fails', async () => {
      const code = 'abcd1234';
      const hashed = crypto.createHash('sha256').update(code).digest('hex');
      mockPrisma.mfa_secrets.findUnique.mockResolvedValue({
        ...ACTIVE_SECRET,
        secret_encrypted: encryptForTest('SECRET'),
        backup_codes: JSON.stringify([hashed]),
      });
      mockOtpVerify.mockResolvedValue({ valid: false });

      const result = await service.verifyCodeOrBackup(makeUser() as any, code);

      expect(result).toBe(true);
      // A conditional updateMany removes the used code atomically to prevent replay.
      expect(mockPrisma.mfa_secrets.updateMany).toHaveBeenCalledWith({
        where: { user_id: 'user-123', backup_codes: JSON.stringify([hashed]) },
        data: { backup_codes: JSON.stringify([]) },
      });
    });

    it('returns false when both TOTP and backup-code lookup fail', async () => {
      mockPrisma.mfa_secrets.findUnique.mockResolvedValue({
        ...ACTIVE_SECRET,
        secret_encrypted: encryptForTest('SECRET'),
        backup_codes: JSON.stringify(['some-other-hash']),
      });
      mockOtpVerify.mockResolvedValue({ valid: false });
      expect(
        await service.verifyCodeOrBackup(makeUser() as any, 'wrong-code'),
      ).toBe(false);
    });
  });

  // ─── disableMfa ───────────────────────────────────────────────────────────

  describe('disableMfa', () => {
    it('throws BadRequestException when MFA is not enabled', async () => {
      await expect(
        service.disableMfa({ code: '123456' }, makeUser() as any, mockReq()),
      ).rejects.toThrow(BadRequestException);
    });

    it('throws BadRequestException for invalid code', async () => {
      // user has 2FA enabled, but verifyCodeOrBackup will return false because
      // no secret row is found.
      mockPrisma.mfa_secrets.findUnique.mockResolvedValue(null);
      await expect(
        service.disableMfa(
          { code: '000000' },
          makeUser({ twoFactorEnabled: true }) as any,
          mockReq(),
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('clears two_factor_enabled and deletes the mfa_secrets row on success', async () => {
      const encKey = crypto
        .createHash('sha256')
        .update(TEST_JWT_SECRET)
        .digest();
      const iv = crypto.randomBytes(12);
      const cipher = crypto.createCipheriv('aes-256-gcm', encKey, iv);
      const enc = Buffer.concat([
        cipher.update('SECRET', 'utf8'),
        cipher.final(),
      ]);
      const tag = cipher.getAuthTag();
      const secret_encrypted = `${iv.toString('hex')}:${tag.toString('hex')}:${enc.toString('hex')}`;

      mockPrisma.mfa_secrets.findUnique.mockResolvedValue({
        ...ACTIVE_SECRET,
        secret_encrypted,
        backup_codes: null,
      });
      mockOtpVerify.mockResolvedValue({ valid: true });

      const result = await service.disableMfa(
        { code: '123456' },
        makeUser({ twoFactorEnabled: true }) as any,
        mockReq(),
      );

      expect(result).toEqual({ message: 'Two-factor authentication disabled' });
      expect(mockPrisma.mfa_secrets.delete).toHaveBeenCalledWith({
        where: { user_id: 'user-123' },
      });
      expect(mockPrisma.users.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ two_factor_enabled: false }),
        }),
      );
    });
  });

  // ─── getMfaStatus ─────────────────────────────────────────────────────────

  describe('getMfaStatus', () => {
    it('returns enabled=false when user not found', async () => {
      mockPrisma.users.findUnique.mockResolvedValue(null);
      expect(await service.getMfaStatus('user-123')).toEqual({
        enabled: false,
      });
    });

    it('returns the user.two_factor_enabled flag', async () => {
      mockPrisma.users.findUnique.mockResolvedValue({
        two_factor_enabled: true,
      });
      expect(await service.getMfaStatus('user-123')).toEqual({ enabled: true });
    });
  });

  // ─── getBackupCodesCount ──────────────────────────────────────────────────

  describe('getBackupCodesCount', () => {
    it('returns 0 when no backup codes stored', async () => {
      mockPrisma.mfa_secrets.findUnique.mockResolvedValue({
        backup_codes: null,
      });
      expect(await service.getBackupCodesCount('user-123')).toEqual({
        remaining: 0,
      });
    });

    it('returns the remaining count from JSON column', async () => {
      mockPrisma.mfa_secrets.findUnique.mockResolvedValue({
        backup_codes: JSON.stringify(['a', 'b', 'c']),
      });
      expect(await service.getBackupCodesCount('user-123')).toEqual({
        remaining: 3,
      });
    });
  });

  // ─── SEC-04 regression: enrollment integrity ─────────────────────────────

  describe('enrollment integrity (SEC-04)', () => {
    it('setupMfa stores unconfirmed secrets with enabled=false and verified=false', async () => {
      await service.setupMfa(makeUser() as any);

      expect(mockPrisma.mfa_secrets.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          create: expect.objectContaining({ enabled: false, verified: false }),
          update: expect.objectContaining({ enabled: false, verified: false }),
        }),
      );
    });

    it('verifyAndEnableMfa refuses a row already enabled and verified', async () => {
      mockPrisma.mfa_secrets.findUnique.mockResolvedValue({
        enabled: true,
        verified: true,
        secret_encrypted: 'unused',
      });

      await expect(
        service.verifyAndEnableMfa(
          { code: '123456' },
          makeUser() as any,
          mockReq(),
        ),
      ).rejects.toThrow(BadRequestException);
      expect(mockOtpVerify).not.toHaveBeenCalled();
    });

    it('verifyAndEnableMfa refuses when the user already has twoFactorEnabled', async () => {
      mockPrisma.mfa_secrets.findUnique.mockResolvedValue({
        ...HALF_CONFIGURED_SECRET,
        secret_encrypted: 'unused',
      });

      await expect(
        service.verifyAndEnableMfa(
          { code: '123456' },
          makeUser({ twoFactorEnabled: true }) as any,
          mockReq(),
        ),
      ).rejects.toThrow(BadRequestException);
    });
  });

  // ─── SEC-04 regression: half-configured secrets cannot authenticate ──────

  describe('half-configured secret rejection (SEC-04)', () => {
    const encKey = crypto.createHash('sha256').update(TEST_JWT_SECRET).digest();
    const encryptForTest = (plain: string) => {
      const iv = crypto.randomBytes(12);
      const cipher = crypto.createCipheriv('aes-256-gcm', encKey, iv);
      const enc = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
      const tag = cipher.getAuthTag();
      return `${iv.toString('hex')}:${tag.toString('hex')}:${enc.toString('hex')}`;
    };

    it.each([
      ['not enabled', { enabled: false, verified: true }],
      ['not verified', { enabled: true, verified: false }],
      ['neither', HALF_CONFIGURED_SECRET],
    ])('rejects a TOTP code when the secret is %s', async (_label, flags) => {
      mockPrisma.mfa_secrets.findUnique.mockResolvedValue({
        ...flags,
        secret_encrypted: encryptForTest('SECRET'),
        backup_codes: null,
      });
      mockOtpVerify.mockResolvedValue({ valid: true });
      // validateMfaLogin does not check the user's twoFactorEnabled flag;
      // the service must fail closed based on the secret row alone.
      expect(
        await service.verifyCodeOrBackup(
          makeUser({ twoFactorEnabled: true }) as any,
          '123456',
        ),
      ).toBe(false);
    });

    it('rejects a backup code when the secret is half-configured', async () => {
      const code = 'abcd1234';
      const hashed = crypto.createHash('sha256').update(code).digest('hex');
      mockPrisma.mfa_secrets.findUnique.mockResolvedValue({
        ...HALF_CONFIGURED_SECRET,
        secret_encrypted: encryptForTest('SECRET'),
        backup_codes: JSON.stringify([hashed]),
      });
      mockOtpVerify.mockResolvedValue({ valid: false });

      expect(
        await service.verifyCodeOrBackup(
          makeUser({ twoFactorEnabled: true }) as any,
          code,
        ),
      ).toBe(false);
      expect(mockPrisma.mfa_secrets.update).not.toHaveBeenCalled();
    });

    it('returns false when ciphertext is corrupt or the encryption key changed', async () => {
      mockPrisma.mfa_secrets.findUnique.mockResolvedValue({
        ...ACTIVE_SECRET,
        secret_encrypted: 'not-a-valid-ciphertext',
        backup_codes: null,
      });

      expect(
        await service.verifyCodeOrBackup(makeUser() as any, '123456'),
      ).toBe(false);
      expect(mockOtpVerify).not.toHaveBeenCalled();
      // A failed decrypt must still be recorded as a failed attempt.
      expect(mockRedis.incrWithExpiry).toHaveBeenCalledWith(
        'mfa:fail:verify:user-123',
        900,
      );
    });
  });

  // ─── SEC-04 regression: recovery-code replay ─────────────────────────────

  describe('backup-code replay protection (SEC-04)', () => {
    const encKey = crypto.createHash('sha256').update(TEST_JWT_SECRET).digest();
    const encryptForTest = (plain: string) => {
      const iv = crypto.randomBytes(12);
      const cipher = crypto.createCipheriv('aes-256-gcm', encKey, iv);
      const enc = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
      const tag = cipher.getAuthTag();
      return `${iv.toString('hex')}:${tag.toString('hex')}:${enc.toString('hex')}`;
    };

    it('a consumed backup code cannot be reused even if the read row is stale', async () => {
      const code = 'replay-code';
      const hashed = crypto.createHash('sha256').update(code).digest('hex');
      const storedCodes = JSON.stringify([hashed, 'other-hash']);
      mockPrisma.mfa_secrets.findUnique.mockResolvedValue({
        ...ACTIVE_SECRET,
        secret_encrypted: encryptForTest('SECRET'),
        backup_codes: storedCodes,
      });
      // Conditional update lost the race (another request consumed the code).
      mockPrisma.mfa_secrets.updateMany.mockResolvedValue({ count: 0 });
      mockOtpVerify.mockResolvedValue({ valid: false });

      expect(await service.verifyCodeOrBackup(makeUser() as any, code)).toBe(
        false,
      );
      expect(mockPrisma.mfa_secrets.updateMany).toHaveBeenCalledWith({
        where: { user_id: 'user-123', backup_codes: storedCodes },
        data: { backup_codes: JSON.stringify(['other-hash']) },
      });
      expect(mockRedis.incrWithExpiry).toHaveBeenCalledWith(
        'mfa:fail:verify:user-123',
        900,
      );
    });
  });

  // ─── SEC-04 regression: TOTP step replay ─────────────────────────────────

  describe('TOTP step replay protection (SEC-04)', () => {
    const encKey = crypto.createHash('sha256').update(TEST_JWT_SECRET).digest();
    const encryptForTest = (plain: string) => {
      const iv = crypto.randomBytes(12);
      const cipher = crypto.createCipheriv('aes-256-gcm', encKey, iv);
      const enc = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
      const tag = cipher.getAuthTag();
      return `${iv.toString('hex')}:${tag.toString('hex')}:${enc.toString('hex')}`;
    };

    it('rejects a code from the same or an earlier step and records a failure', async () => {
      mockPrisma.mfa_secrets.findUnique.mockResolvedValue({
        ...ACTIVE_SECRET,
        secret_encrypted: encryptForTest('SECRET'),
        backup_codes: null,
      });
      mockOtpVerify.mockResolvedValue({ valid: true, timeStep: 100 });
      // Only the laststep key takes the previous step value; the rate-limit
      // key must stay clear so the replay guard is the thing under test.
      mockRedis.get.mockImplementation((key: string) =>
        Promise.resolve(key === 'mfa:laststep:user-123' ? '100' : null),
      );

      expect(
        await service.verifyCodeOrBackup(makeUser() as any, '123456'),
      ).toBe(false);
      expect(mockRedis.set).not.toHaveBeenCalled();
      expect(mockRedis.incrWithExpiry).toHaveBeenCalledWith(
        'mfa:fail:verify:user-123',
        900,
      );
    });

    it('accepts a valid code from a newer step', async () => {
      mockPrisma.mfa_secrets.findUnique.mockResolvedValue({
        ...ACTIVE_SECRET,
        secret_encrypted: encryptForTest('SECRET'),
        backup_codes: null,
      });
      mockOtpVerify.mockResolvedValue({ valid: true, timeStep: 101 });
      mockRedis.get.mockImplementation((key: string) =>
        Promise.resolve(key === 'mfa:laststep:user-123' ? '100' : null),
      );

      expect(
        await service.verifyCodeOrBackup(makeUser() as any, '123456'),
      ).toBe(true);
      expect(mockRedis.set).toHaveBeenCalledWith(
        'mfa:laststep:user-123',
        '101',
        60,
      );
    });
  });

  // ─── SEC-04 regression: rate limiting ────────────────────────────────────

  describe('rate limiting (SEC-04)', () => {
    it('blocks verification after 5 failed attempts for 15 minutes', async () => {
      mockRedis.get.mockResolvedValue('5');

      await expect(
        service.verifyCodeOrBackup(makeUser() as any, '123456'),
      ).rejects.toMatchObject({ status: 429 });
      expect(mockPrisma.mfa_secrets.findUnique).not.toHaveBeenCalled();
    });

    it('records a failed attempt with the lockout TTL after an invalid code', async () => {
      const encKey = crypto
        .createHash('sha256')
        .update(TEST_JWT_SECRET)
        .digest();
      const iv = crypto.randomBytes(12);
      const cipher = crypto.createCipheriv('aes-256-gcm', encKey, iv);
      const enc = Buffer.concat([
        cipher.update('SECRET', 'utf8'),
        cipher.final(),
      ]);
      const tag = cipher.getAuthTag();
      mockPrisma.mfa_secrets.findUnique.mockResolvedValue({
        ...ACTIVE_SECRET,
        secret_encrypted: `${iv.toString('hex')}:${tag.toString('hex')}:${enc.toString('hex')}`,
        backup_codes: null,
      });
      // Valid ciphertext but wrong TOTP code → falls through to recordFailedAttempt.
      mockOtpVerify.mockResolvedValue({ valid: false });

      expect(
        await service.verifyCodeOrBackup(makeUser() as any, '000000'),
      ).toBe(false);
      expect(mockRedis.incrWithExpiry).toHaveBeenCalledWith(
        'mfa:fail:verify:user-123',
        900,
      );
      expect(mockRedis.expire).toHaveBeenCalledWith(
        'mfa:fail:verify:user-123',
        900,
      );
    });
  });

  // ─── SEC-04 regression: recovery-code regeneration ───────────────────────

  describe('regenerateBackupCodes (SEC-04)', () => {
    const encKey = crypto.createHash('sha256').update(TEST_JWT_SECRET).digest();
    const encryptForTest = (plain: string) => {
      const iv = crypto.randomBytes(12);
      const cipher = crypto.createCipheriv('aes-256-gcm', encKey, iv);
      const enc = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
      const tag = cipher.getAuthTag();
      return `${iv.toString('hex')}:${tag.toString('hex')}:${enc.toString('hex')}`;
    };

    it('replaces all previous codes with 10 new hashed codes after valid TOTP', async () => {
      const oldCode = 'old-code';
      const oldHash = crypto.createHash('sha256').update(oldCode).digest('hex');
      mockPrisma.mfa_secrets.findUnique.mockResolvedValue({
        ...ACTIVE_SECRET,
        secret_encrypted: encryptForTest('SECRET'),
        backup_codes: JSON.stringify([oldHash]),
      });
      mockOtpVerify.mockResolvedValue({ valid: true });

      const result = await service.regenerateBackupCodes('user-123', '123456');

      expect(result.backupCodes).toHaveLength(10);
      expect(result.backupCodes).not.toContain(oldCode);
      const stored = JSON.parse(
        mockPrisma.mfa_secrets.update.mock.calls[0][0].data.backup_codes,
      );
      expect(stored).toHaveLength(10);
      expect(stored).not.toContain(oldHash);
      result.backupCodes.forEach((code: string) => {
        expect(stored).toContain(
          crypto.createHash('sha256').update(code).digest('hex'),
        );
      });
    });

    it('refuses regeneration when the secret is half-configured', async () => {
      mockPrisma.mfa_secrets.findUnique.mockResolvedValue({
        ...HALF_CONFIGURED_SECRET,
        secret_encrypted: encryptForTest('SECRET'),
        backup_codes: null,
      });

      await expect(
        service.regenerateBackupCodes('user-123', '123456'),
      ).rejects.toThrow(BadRequestException);
      expect(mockOtpVerify).not.toHaveBeenCalled();
    });

    it('refuses regeneration with an invalid TOTP and records a failure', async () => {
      mockPrisma.mfa_secrets.findUnique.mockResolvedValue({
        ...ACTIVE_SECRET,
        secret_encrypted: encryptForTest('SECRET'),
        backup_codes: JSON.stringify([]),
      });
      mockOtpVerify.mockResolvedValue({ valid: false });

      await expect(
        service.regenerateBackupCodes('user-123', '000000'),
      ).rejects.toThrow(BadRequestException);
      expect(mockPrisma.mfa_secrets.update).not.toHaveBeenCalled();
      expect(mockRedis.incrWithExpiry).toHaveBeenCalledWith(
        'mfa:fail:regenerate:user-123',
        900,
      );
    });

    it('throws BadRequestException instead of crashing when the secret cannot be decrypted', async () => {
      mockPrisma.mfa_secrets.findUnique.mockResolvedValue({
        ...ACTIVE_SECRET,
        secret_encrypted: 'corrupt',
        backup_codes: null,
      });

      await expect(
        service.regenerateBackupCodes('user-123', '123456'),
      ).rejects.toThrow(BadRequestException);
      expect(mockOtpVerify).not.toHaveBeenCalled();
      expect(mockPrisma.mfa_secrets.update).not.toHaveBeenCalled();
    });
  });
});
