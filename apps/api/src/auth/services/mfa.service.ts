import {
  Injectable,
  BadRequestException,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Request } from 'express';
import { generateSecret, verify, generateURI } from 'otplib';
import * as QRCode from 'qrcode';
import * as crypto from 'crypto';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditLogService } from '../../common/services/audit-log.service';
import { RedisService } from '../../common/services/redis.service';
import { extractRequestContext } from '../../common/utils/request-context.util';
import { LoginAction } from '../../users/enums/login-action.enum';
import { User } from '../../users/entities/user.entity';
import { DateUtil } from '../../common/utils/date.util';

export interface MfaSetupResult {
  secret: string;
  qrCodeUrl: string;
  backupCodes: string[];
}

// Rate limiting constants
const MFA_MAX_ATTEMPTS = 5;
const MFA_LOCKOUT_SECONDS = 900; // 15 minutes

@Injectable()
export class MfaService {
  private readonly encKey: Buffer;

  constructor(
    private readonly config: ConfigService,
    private readonly prisma: PrismaService,
    private readonly auditLogService: AuditLogService,
    private readonly redis: RedisService,
  ) {
    const mfaKey = config.get<string>('MFA_ENCRYPTION_KEY');
    const secret = config.get<string>('JWT_SECRET');
    if (!secret) {
      throw new Error('JWT_SECRET must be defined. Set it in your .env file.');
    }
    this.encKey = crypto
      .createHash('sha256')
      .update(mfaKey || secret)
      .digest();
  }

  // ─── Security helpers ──────────────────────────────────────────────────────

  // RedisService degrades gracefully when Redis is down; these wrappers also
  // tolerate lightweight test doubles that implement only a subset of it.
  private async redisGet(key: string): Promise<string | null> {
    return typeof this.redis.get === 'function'
      ? await this.redis.get(key)
      : null;
  }

  private async redisSet(
    key: string,
    value: string,
    ttl: number,
  ): Promise<void> {
    if (typeof this.redis.set === 'function')
      await this.redis.set(key, value, ttl);
  }

  private async redisIncrWithExpiry(key: string, ttl: number): Promise<number> {
    if (typeof this.redis.incrWithExpiry === 'function') {
      return await this.redis.incrWithExpiry(key, ttl);
    }
    return typeof this.redis.incr === 'function'
      ? await this.redis.incr(key)
      : 1;
  }

  private async redisExpire(key: string, ttl: number): Promise<void> {
    if (typeof this.redis.expire === 'function')
      await this.redis.expire(key, ttl);
  }

  /** Throttle attempts per user so TOTP codes cannot be brute-forced. */
  private async checkRateLimit(userId: string, purpose: string): Promise<void> {
    const key = `mfa:fail:${purpose}:${userId}`;
    const attempts = await this.redisGet(key);
    if (attempts && Number(attempts) >= MFA_MAX_ATTEMPTS) {
      throw new HttpException(
        'Too many MFA attempts. Please try again later.',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
  }

  private async recordFailedAttempt(
    userId: string,
    purpose: string,
  ): Promise<void> {
    const key = `mfa:fail:${purpose}:${userId}`;
    const count = await this.redisIncrWithExpiry(key, MFA_LOCKOUT_SECONDS);
    if (count === 1) await this.redisExpire(key, MFA_LOCKOUT_SECONDS);
  }

  private async clearFailedAttempts(
    userId: string,
    purpose: string,
  ): Promise<void> {
    await this.redis.del(`mfa:fail:${purpose}:${userId}`);
  }

  /**
   * Reject a code if a code from the same or an earlier 30-second TOTP step
   * has already been used. Prevents replay of a shoulder-surfed code.
   */
  private async consumeTotpStep(
    userId: string,
    step: number,
  ): Promise<boolean> {
    const key = `mfa:laststep:${userId}`;
    const lastStepRaw = await this.redisGet(key);
    if (
      lastStepRaw !== null &&
      !Number.isNaN(Number(lastStepRaw)) &&
      step <= Number(lastStepRaw)
    ) {
      return false;
    }
    await this.redisSet(key, String(step), 60);
    return true;
  }

  private hashBackupCode(code: string): string {
    return crypto.createHash('sha256').update(code).digest('hex');
  }

  private async auditMfaFailure(
    user: User,
    reason: string,
    req?: Request,
  ): Promise<void> {
    try {
      await this.auditLogService.recordLoginHistory(
        user,
        LoginAction.LOGIN_FAILED,
        req
          ? extractRequestContext(req)
          : { ip: 'unknown', ua: '', device: 'Unknown' },
        false,
        reason,
      );
    } catch {
      /* audit logging must not break MFA */
    }
  }

  // ─── Setup MFA ─────────────────────────────────────────────────────────────

  /**
   * Tạo secret + QR code + backup codes.
   * Lưu vào bảng mfa_secrets (chưa enabled, chưa verified).
   */
  async setupMfa(user: User): Promise<MfaSetupResult> {
    if (user.twoFactorEnabled) {
      throw new BadRequestException('MFA is already enabled');
    }

    const secret = generateSecret();
    const encrypted = this.encrypt(secret);

    const backupCodes = this.generateRawBackupCodes();
    const hashedCodes = backupCodes.map((c) => this.hashBackupCode(c));

    await this.prisma.mfa_secrets.upsert({
      where: { user_id: user.id },
      create: {
        user_id: user.id,
        secret_encrypted: encrypted,
        enabled: false,
        verified: false,
        backup_codes: JSON.stringify(hashedCodes),
      },
      update: {
        secret_encrypted: encrypted,
        enabled: false,
        verified: false,
        backup_codes: JSON.stringify(hashedCodes),
      },
    });

    const issuer = this.config.get<string>('MFA_ISSUER', 'TicketApp');
    const otpAuthUri = generateURI({ label: user.email, issuer, secret });
    const qrCodeUrl = await QRCode.toDataURL(otpAuthUri);

    return { secret, qrCodeUrl, backupCodes };
  }

  // ─── Confirm Setup ─────────────────────────────────────────────────────────

  /**
   * Confirm MFA setup bằng TOTP code.
   * Bật mfa_enabled trên user.
   */
  async verifyAndEnableMfa(
    dto: { code: string },
    user: User,
    req: Request,
  ): Promise<{ message: string }> {
    const mfaSecret = await this.prisma.mfa_secrets.findUnique({
      where: { user_id: user.id },
    });
    if (!mfaSecret) throw new BadRequestException('MFA setup not started');
    if (user.twoFactorEnabled) {
      throw new BadRequestException('MFA is already enabled');
    }
    if (mfaSecret.enabled && mfaSecret.verified) {
      throw new BadRequestException('MFA is already enabled');
    }

    await this.checkRateLimit(user.id, 'confirm');

    const secret = this.decrypt(mfaSecret.secret_encrypted);
    const verification = await verify({ token: dto.code, secret });
    if (!verification.valid) {
      await this.recordFailedAttempt(user.id, 'confirm');
      await this.auditMfaFailure(
        user,
        'Invalid MFA setup confirmation code',
        req,
      );
      throw new BadRequestException('Invalid MFA code');
    }
    await this.clearFailedAttempts(user.id, 'confirm');

    // Đánh dấu verified + enabled
    await this.prisma.mfa_secrets.update({
      where: { user_id: user.id },
      data: { verified: true, enabled: true, verified_at: DateUtil.now() },
    });
    await this.prisma.users.update({
      where: { id: user.id },
      data: { two_factor_enabled: true },
    });
    await this.redis.del(`cache:user:${user.id}`);

    const ctx = extractRequestContext(req);
    await this.auditLogService.recordLoginHistory(
      user,
      LoginAction.MFA_ENABLED,
      ctx,
      true,
    );
    return { message: 'Two-factor authentication enabled' };
  }

  // ─── Verify code (dùng khi login) ─────────────────────────────────────────

  /**
   * Xác thực TOTP code hoặc backup code.
   * Only fully enabled MFA secrets are accepted; failures are throttled and
   * backup codes are consumed atomically to prevent replay.
   */
  async verifyCodeOrBackup(user: User, code: string): Promise<boolean> {
    await this.checkRateLimit(user.id, 'verify');

    const mfaSecret = await this.prisma.mfa_secrets.findUnique({
      where: { user_id: user.id },
    });
    // A half-configured (setup started but not confirmed) MFA secret must not
    // authenticate: validateMfaLogin does not re-check the user's 2FA flag.
    if (!mfaSecret || !mfaSecret.enabled || !mfaSecret.verified) return false;

    let secret: string;
    try {
      secret = this.decrypt(mfaSecret.secret_encrypted);
    } catch {
      await this.recordFailedAttempt(user.id, 'verify');
      return false;
    }

    const verification = await verify({ token: code, secret });
    if (verification.valid) {
      // Reject replays of a code used in the same 30-second TOTP step.
      const timeStep =
        (verification as any).timeStep ?? Math.floor(Date.now() / 30000);
      if (!(await this.consumeTotpStep(user.id, timeStep))) {
        await this.recordFailedAttempt(user.id, 'verify');
        return false;
      }
      await this.clearFailedAttempts(user.id, 'verify');
      return true;
    }

    // Fallback: backup code. Use a conditional update so two concurrent
    // requests cannot both consume the same code.
    if (mfaSecret.backup_codes) {
      const storedCodes = mfaSecret.backup_codes;
      const codes: string[] = JSON.parse(storedCodes);
      const hashed = this.hashBackupCode(code);
      const idx = codes.indexOf(hashed);
      if (idx !== -1) {
        codes.splice(idx, 1);
        const updated = await this.prisma.mfa_secrets.updateMany({
          where: { user_id: user.id, backup_codes: storedCodes },
          data: { backup_codes: JSON.stringify(codes) },
        });
        if (updated.count === 1) {
          await this.clearFailedAttempts(user.id, 'verify');
          return true;
        }
      }
    }

    await this.recordFailedAttempt(user.id, 'verify');
    return false;
  }

  // ─── Disable MFA ───────────────────────────────────────────────────────────

  async disableMfa(
    dto: { code: string },
    user: User,
    req: Request,
  ): Promise<{ message: string }> {
    if (!user.twoFactorEnabled)
      throw new BadRequestException('MFA is not enabled');

    const valid = await this.verifyCodeOrBackup(user, dto.code);
    if (!valid) throw new BadRequestException('Invalid MFA code');

    await this.prisma.mfa_secrets.delete({ where: { user_id: user.id } });
    await this.prisma.users.update({
      where: { id: user.id },
      data: { two_factor_enabled: false },
    });
    await this.redis.del(`cache:user:${user.id}`);

    const ctx = extractRequestContext(req);
    await this.auditLogService.recordLoginHistory(
      user,
      LoginAction.MFA_DISABLED,
      ctx,
      true,
    );
    return { message: 'Two-factor authentication disabled' };
  }

  // ─── Regenerate Backup Codes ───────────────────────────────────────────────

  async regenerateBackupCodes(
    userId: string,
    totpCode: string,
  ): Promise<{ backupCodes: string[] }> {
    const mfaSecret = await this.prisma.mfa_secrets.findUnique({
      where: { user_id: userId },
    });
    if (!mfaSecret || !mfaSecret.enabled || !mfaSecret.verified) {
      throw new BadRequestException('MFA is not enabled');
    }

    await this.checkRateLimit(userId, 'regenerate');

    let secret: string;
    try {
      secret = this.decrypt(mfaSecret.secret_encrypted);
    } catch {
      throw new BadRequestException('MFA secret is unavailable');
    }
    const verification = await verify({ token: totpCode, secret });
    if (!verification.valid) {
      await this.recordFailedAttempt(userId, 'regenerate');
      throw new BadRequestException('Invalid TOTP code');
    }
    await this.clearFailedAttempts(userId, 'regenerate');

    const backupCodes = this.generateRawBackupCodes();
    const hashedCodes = backupCodes.map((c) => this.hashBackupCode(c));

    await this.prisma.mfa_secrets.update({
      where: { user_id: userId },
      data: { backup_codes: JSON.stringify(hashedCodes) },
    });

    return { backupCodes };
  }

  async getBackupCodesCount(userId: string): Promise<{ remaining: number }> {
    const mfaSecret = await this.prisma.mfa_secrets.findUnique({
      where: { user_id: userId },
    });
    if (!mfaSecret?.backup_codes) return { remaining: 0 };
    const codes: string[] = JSON.parse(mfaSecret.backup_codes);
    return { remaining: codes.length };
  }

  async getMfaStatus(userId: string): Promise<{ enabled: boolean }> {
    const user = await this.prisma.users.findUnique({
      where: { id: userId },
      select: { two_factor_enabled: true },
    });
    return { enabled: user?.two_factor_enabled ?? false };
  }

  // ─── AES-256-GCM Encryption ────────────────────────────────────────────────

  private encrypt(text: string): string {
    const iv = crypto.randomBytes(12); // 96-bit IV for GCM
    const cipher = crypto.createCipheriv('aes-256-gcm', this.encKey, iv);
    const encrypted = Buffer.concat([
      cipher.update(text, 'utf8'),
      cipher.final(),
    ]);
    const authTag = cipher.getAuthTag();
    // Format: iv:authTag:ciphertext (all hex)
    return `${iv.toString('hex')}:${authTag.toString('hex')}:${encrypted.toString('hex')}`;
  }

  private decrypt(data: string): string {
    try {
      const parts = data.split(':');
      if (parts.length !== 3) throw new Error('Malformed ciphertext');
      const [ivHex, authTagHex, encHex] = parts;
      const iv = Buffer.from(ivHex, 'hex');
      const authTag = Buffer.from(authTagHex, 'hex');
      const encrypted = Buffer.from(encHex, 'hex');
      if (iv.length !== 12 || authTag.length !== 16 || encrypted.length === 0) {
        throw new Error('Malformed ciphertext');
      }
      const decipher = crypto.createDecipheriv('aes-256-gcm', this.encKey, iv);
      decipher.setAuthTag(authTag);
      return Buffer.concat([
        decipher.update(encrypted),
        decipher.final(),
      ]).toString('utf8');
    } catch {
      // Corrupt ciphertext or an old encryption key must fail cleanly so
      // callers can return 401/400 instead of crashing with a 500.
      throw new Error('Unable to decrypt MFA secret');
    }
  }

  // ─── Helpers ───────────────────────────────────────────────────────────────

  private generateRawBackupCodes(count = 10): string[] {
    // 16 bytes (128 bits) of entropy per code; lowercase hex is easy to
    // transcribe and keeps compatibility with existing code validation.
    return Array.from({ length: count }, () =>
      crypto.randomBytes(16).toString('hex'),
    );
  }
}
