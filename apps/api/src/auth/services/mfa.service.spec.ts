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
  generateSecret: jest.fn().mockReturnValue('GENERATED_SECRET'),
  generateURI: jest.fn().mockReturnValue('otpauth://totp/test'),
  verify: jest.fn().mockResolvedValue({ valid: true }),
}));

jest.mock('qrcode', () => ({
  toDataURL: jest.fn().mockResolvedValue('data:image/png;base64,mock-qr'),
}));

import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { BadRequestException } from '@nestjs/common';
import * as crypto from 'crypto';

import { MfaService } from './mfa.service';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditLogService } from '../../common/services/audit-log.service';
import { RedisService } from '../../common/services/redis.service';
import { generateURI, verify as otpVerify } from 'otplib';

const mockOtpVerify = otpVerify as unknown as jest.Mock;
const mockGenerateURI = generateURI as unknown as jest.Mock;

const TEST_JWT_SECRET = 'test-jwt-secret-for-mfa-encryption-only';

const makeUser = (over: any = {}) => ({
  id: 'user-123',
  email: 'john@example.com',
  firstName: 'John',
  lastName: 'Doe',
  twoFactorEnabled: false,
  ...over,
});

const mockReq = (over: any = {}) =>
  ({ headers: {}, socket: { remoteAddress: '127.0.0.1' }, get: jest.fn(), ...over } as any);

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
      delete: jest.fn().mockResolvedValue({}),
    },
  };

  const mockAuditLog = {
    recordLoginHistory: jest.fn().mockResolvedValue(undefined),
  };

  const mockRedis = {
    del: jest.fn().mockResolvedValue(undefined),
  };

  beforeEach(async () => {
    jest.clearAllMocks();
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
        expect.objectContaining({ issuer: 'TestApp', label: 'john@example.com' }),
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
        service.verifyAndEnableMfa({ code: '123456' }, makeUser() as any, mockReq()),
      ).rejects.toThrow(BadRequestException);
    });

    it('throws BadRequestException when TOTP is invalid', async () => {
      mockPrisma.mfa_secrets.findUnique.mockResolvedValue({
        secret_encrypted: encryptForTest('SECRET'),
      });
      mockOtpVerify.mockResolvedValue({ valid: false });
      await expect(
        service.verifyAndEnableMfa({ code: '000000' }, makeUser() as any, mockReq()),
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
      expect(await service.verifyCodeOrBackup(makeUser() as any, '000000')).toBe(false);
    });

    it('returns true on a valid TOTP code', async () => {
      mockPrisma.mfa_secrets.findUnique.mockResolvedValue({
        secret_encrypted: encryptForTest('SECRET'),
        backup_codes: null,
      });
      mockOtpVerify.mockResolvedValue({ valid: true });
      expect(await service.verifyCodeOrBackup(makeUser() as any, '123456')).toBe(true);
    });

    it('falls back to backup code and consumes it when TOTP fails', async () => {
      const code = 'abcd1234';
      const hashed = crypto.createHash('sha256').update(code).digest('hex');
      mockPrisma.mfa_secrets.findUnique.mockResolvedValue({
        secret_encrypted: encryptForTest('SECRET'),
        backup_codes: JSON.stringify([hashed]),
      });
      mockOtpVerify.mockResolvedValue({ valid: false });

      const result = await service.verifyCodeOrBackup(makeUser() as any, code);

      expect(result).toBe(true);
      // The used backup code must be removed from storage.
      expect(mockPrisma.mfa_secrets.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ backup_codes: JSON.stringify([]) }),
        }),
      );
    });

    it('returns false when both TOTP and backup-code lookup fail', async () => {
      mockPrisma.mfa_secrets.findUnique.mockResolvedValue({
        secret_encrypted: encryptForTest('SECRET'),
        backup_codes: JSON.stringify(['some-other-hash']),
      });
      mockOtpVerify.mockResolvedValue({ valid: false });
      expect(await service.verifyCodeOrBackup(makeUser() as any, 'wrong-code')).toBe(false);
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
        service.disableMfa({ code: '000000' }, makeUser({ twoFactorEnabled: true }) as any, mockReq()),
      ).rejects.toThrow(BadRequestException);
    });

    it('clears two_factor_enabled and deletes the mfa_secrets row on success', async () => {
      const encKey = crypto.createHash('sha256').update(TEST_JWT_SECRET).digest();
      const iv = crypto.randomBytes(12);
      const cipher = crypto.createCipheriv('aes-256-gcm', encKey, iv);
      const enc = Buffer.concat([cipher.update('SECRET', 'utf8'), cipher.final()]);
      const tag = cipher.getAuthTag();
      const secret_encrypted = `${iv.toString('hex')}:${tag.toString('hex')}:${enc.toString('hex')}`;

      mockPrisma.mfa_secrets.findUnique.mockResolvedValue({
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
      expect(await service.getMfaStatus('user-123')).toEqual({ enabled: false });
    });

    it('returns the user.two_factor_enabled flag', async () => {
      mockPrisma.users.findUnique.mockResolvedValue({ two_factor_enabled: true });
      expect(await service.getMfaStatus('user-123')).toEqual({ enabled: true });
    });
  });

  // ─── getBackupCodesCount ──────────────────────────────────────────────────

  describe('getBackupCodesCount', () => {
    it('returns 0 when no backup codes stored', async () => {
      mockPrisma.mfa_secrets.findUnique.mockResolvedValue({ backup_codes: null });
      expect(await service.getBackupCodesCount('user-123')).toEqual({ remaining: 0 });
    });

    it('returns the remaining count from JSON column', async () => {
      mockPrisma.mfa_secrets.findUnique.mockResolvedValue({
        backup_codes: JSON.stringify(['a', 'b', 'c']),
      });
      expect(await service.getBackupCodesCount('user-123')).toEqual({ remaining: 3 });
    });
  });
});
