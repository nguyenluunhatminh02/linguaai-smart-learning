import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { RedisService } from '../../common/services/redis.service';
import { PrismaService } from '../../prisma/prisma.service';
import { EmailService } from '../../email/email.service';
import {
  AccountLockedException,
  RateLimitExceededException,
} from '../../common/exceptions';
import { DateUtil } from '../../common/utils/date.util';

@Injectable()
export class LoginAttemptService {
  private readonly logger = new Logger(LoginAttemptService.name);
  private readonly maxAttempts: number;
  private readonly lockDurationSec: number;
  private readonly ipLimit = 50;
  private readonly windowSec = 3600;
  private readonly failClosedOnRedisOutage: boolean;

  constructor(
    private readonly redis: RedisService,
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly emailService: EmailService,
  ) {
    this.maxAttempts = config.get<number>('MAX_LOGIN_ATTEMPTS', 5);
    this.lockDurationSec = config.get<number>('LOCKOUT_DURATION_MINUTES', 30) * 60;
    this.failClosedOnRedisOutage =
      config.get<string>('NODE_ENV') === 'production';
  }

  // ─── Check trước khi login ─────────────────────────────────────────────────

  /**
   * Gọi TRƯỚC khi verify password.
   * Throw AccountLockedException nếu account đang bị lock.
   * Throw RateLimitExceededException nếu IP bị rate limit.
   */
  async checkBruteForce(email: string, ip: string): Promise<void> {
    // A Redis outage must not silently disable brute-force protection. In
    // production we reject while counters cannot be trusted; elsewhere we
    // fall back to counting attempts recorded in the DB.
    if (!this.redis.isAvailable() && this.failClosedOnRedisOutage) {
      this.logger.error('Redis unavailable - failing closed on brute-force check');
      throw new RateLimitExceededException('Login temporarily unavailable');
    }

    if (this.redis.isAvailable()) {
      // kiểm tra account lock
      const locked = await this.redis.get(`account_lock:${email}`);
      if (locked) {
        throw new AccountLockedException();
      }

      // kiểm tra IP rate limit: 50 lần/giờ
      const ipCount = await this.redis.get(`ip_attempts:${ip}`);
      if (ipCount && parseInt(ipCount, 10) >= this.ipLimit) {
        throw new RateLimitExceededException('Too many login attempts from this IP');
      }
      return;
    }

    // Non-production fallback: derive the counters from the persisted attempts.
    const since = DateUtil.subtractMs(this.windowSec * 1000);
    const [lockedUser, failedIpCount] = await Promise.all([
      this.prisma.users.findFirst({
        where: { email, is_locked: true, lock_time: { gt: since } },
        select: { id: true },
      }),
      this.prisma.login_attempts.count({
        where: { ip_address: ip, success: false, attempted_at: { gte: since } },
      }),
    ]);

    if (lockedUser) {
      throw new AccountLockedException();
    }
    if (failedIpCount >= this.ipLimit) {
      throw new RateLimitExceededException('Too many login attempts from this IP');
    }
  }

  // ─── Ghi thất bại ─────────────────────────────────────────────────────────

  /**
   * Gọi khi login thất bại (sai password, user không tồn tại, v.v.)
   */
  async recordFailedLogin(
    email: string,
    ip: string,
    userId?: string,
    reason?: string,
  ): Promise<void> {
    // Ghi vào DB
    await this.prisma.login_attempts.create({
      data: {
        email,
        ip_address: ip,
        user_id: userId ?? null,
        success: false,
        failure_reason: reason ?? 'Unknown',
      },
    });

    // Redis counters use an atomic INCR + conditional EXPIRE so a crash or
    // race between awaits can never leave a permanently unexpiring counter.
    // When Redis is unavailable we derive the count from DB rows instead of
    // trusting incr()'s 0 sentinel (which would disable all throttling).
    let count: number;
    let ipCount: number;

    if (this.redis.isAvailable()) {
      const emailKey = `login_attempts:${email}`;
      const ipKey = `ip_attempts:${ip}`;
      [count, ipCount] = await Promise.all([
        this.redis.incrWithExpiry(emailKey, this.windowSec),
        this.redis.incrWithExpiry(ipKey, this.windowSec),
      ]);
    } else {
      const since = DateUtil.subtractMs(this.windowSec * 1000);
      [count, ipCount] = await Promise.all([
        this.prisma.login_attempts.count({
          where: { email, success: false, attempted_at: { gte: since } },
        }),
        this.prisma.login_attempts.count({
          where: { ip_address: ip, success: false, attempted_at: { gte: since } },
        }),
      ]);
      this.logger.warn(
        'Redis unavailable - counting failed logins from the database',
      );
    }

    // Lock account nếu đủ số lần
    if (count >= this.maxAttempts) {
      await this.lockAccount(email);
    }
  }

  // ─── Ghi thành công ────────────────────────────────────────────────────────

  /**
   * Gọi khi login thành công — xóa counter.
   */
  async recordSuccessfulLogin(email: string, ip: string, userId: string): Promise<void> {
    await this.prisma.login_attempts.create({
      data: {
        email,
        ip_address: ip,
        user_id: userId,
        success: true,
      },
    });
    await this.redis.del(`login_attempts:${email}`);
    await this.redis.del(`ip_attempts:${ip}`);
  }

  // ─── Lock account ──────────────────────────────────────────────────────────

  private async lockAccount(email: string): Promise<void> {
    // NX guard để tránh race condition — chỉ set nếu chưa có key.
    // During a Redis outage setNx() always returns false; fall back to the
    // DB's is_locked/lock_time so the lock is still applied (checkBruteForce
    // and auth.service.ts both read those fields).
    if (this.redis.isAvailable()) {
      const wasSet = await this.redis.setNx(`account_lock:${email}`, '1', this.lockDurationSec);
      if (!wasSet) return; // đã lock rồi
    } else {
      const existing = await this.prisma.users.findFirst({
        where: { email, is_locked: true, lock_time: { gt: DateUtil.now() } },
        select: { id: true },
      });
      if (existing) return; // already locked
    }

    const lockedUntil = DateUtil.addSeconds(this.lockDurationSec);
    await this.prisma.users.updateMany({
      where: { email },
      data: { is_locked: true, lock_time: lockedUntil },
    });

    // Gửi email thông báo
    const user = await this.prisma.users.findFirst({ where: { email } });
    if (user) {
      this.emailService
        .sendAccountLockedEmail(user.email, user.first_name)
        .catch(e => this.logger.warn(`Account locked email failed: ${e.message}`));
    }

    this.logger.warn(`Account locked: ${email} until ${lockedUntil.toISOString()}`);
  }

  // ─── Login History (paginated) ─────────────────────────────────────────────

  async getLoginHistory(
    userId: string,
    page = 1,
    size = 20,
  ): Promise<{ data: any[]; total: number; page: number; size: number }> {
    const since = DateUtil.subtractDays(90);
    const skip = (page - 1) * size;

    const [data, total] = await Promise.all([
      this.prisma.login_attempts.findMany({
        where: { user_id: userId, attempted_at: { gte: since } },
        orderBy: { attempted_at: 'desc' },
        skip,
        take: size,
      }),
      this.prisma.login_attempts.count({
        where: { user_id: userId, attempted_at: { gte: since } },
      }),
    ]);

    return { data, total, page, size };
  }
}
