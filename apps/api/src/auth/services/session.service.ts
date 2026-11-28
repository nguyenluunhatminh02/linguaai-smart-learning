import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Request } from 'express';
import { PrismaService } from '../../prisma/prisma.service';
import { TokenService } from './token.service';
import { TokenBlacklistService } from './token-blacklist.service';
import { RedisService } from '../../common/services/redis.service';
import { AuditLogService } from '../../common/services/audit-log.service';
import { extractRequestContext } from '../../common/utils/request-context.util';
import { LoginAction } from '../../users/enums/login-action.enum';
import { DeleteStatus } from '../../users/enums/delete-status.enum';
import { User } from '../../users/entities/user.entity';
import { DateUtil } from '../../common/utils/date.util';

@Injectable()
export class SessionService {
  private readonly logger = new Logger(SessionService.name);

  constructor(
    private prisma: PrismaService,
    private tokenService: TokenService,
    private tokenBlacklistService: TokenBlacklistService,
    private auditLogService: AuditLogService,
    private redis: RedisService,
  ) {}

  /**
   * Key families that hold per-user state or user content in Redis.
   * `revoked-user:*`, `revoked-device:*` and `blacklist:user:*` are
   * deliberately absent: they are token-revocation markers whose TTL must
   * outlive the grace period, and clearing them would un-revoke tokens.
   */
  private static readonly USER_CACHE_PATTERNS: readonly string[] = [
    'cache:user:{user}',
    'token:balance:{user}',
    'checkin:{user}:*',
    'token:last_topup:{user}',
    'mfa:fail:*:{user}',
    'mfa:laststep:{user}',
    'grammar:*:{user}:*',
    'learning-path:{user}',
    'recommendations:{user}:*',
  ];

  /** Substitute the concrete user id into each family pattern. */
  private static userCachePatterns(userId: string): string[] {
    return SessionService.USER_CACHE_PATTERNS.map((pattern) =>
      pattern.replaceAll('{user}', userId),
    );
  }

  private async invalidateUserCache(userId: string): Promise<void> {
    // JwtStrategy reads this cache before the DB and stores is_active /
    // delete_status there for 60s; without eviction a deleted account keeps
    // authenticating (and a cancelled deletion stays locked out).
    await this.redis.del(`cache:user:${userId}`);

    // Remove the remaining per-user Redis state (AI token balance, check-in /
    // top-up markers, MFA throttles, grammar/learning-path/recommendation
    // caches). Every pattern has the user id in a dedicated segment, so no
    // other user's keys can match. `keys()` returns [] when Redis is down,
    // leaving this best-effort like the rest of RedisService.
    const patterns = SessionService.userCachePatterns(userId).filter(
      (pattern) => pattern !== `cache:user:${userId}`,
    );
    const keys = (
      await Promise.all(patterns.map((pattern) => this.redis.keys(pattern)))
    )
      .flat()
      // Defence in depth: never delete a key that does not carry this exact
      // user id segment, even if a pattern or Redis response is malformed.
      .filter((key) => key === `cache:user:${userId}` || key.includes(userId));
    await this.redis.delMany([...new Set(keys)]);
  }

  async deleteAccount(user: User, accessToken: string, req: Request): Promise<void> {
    const { ip } = extractRequestContext(req);

    // Revoke tokens before disabling the account so a failure in revocation
    // cannot leave a disabled account with live sessions.
    await this.tokenService.revokeAllSessions(user.id);
    await this.tokenService.blacklistToken(accessToken);

    await this.prisma.users.update({
      where: { id: user.id },
      data: {
        delete_status: DeleteStatus.DELETE_REQUESTED,
        delete_requested_at: DateUtil.now(),
        is_active: false,
      },
    });

    await this.invalidateUserCache(user.id);
    await this.auditLogService.recordAuditLog(user.id, 'ACCOUNT_DELETE_REQUESTED', ip);
  }

  async cancelDeleteAccount(user: User, req?: Request): Promise<void> {
    // `req` is optional for backwards compatibility with callers that do not
    // carry request context; audit then records 'unknown' as the IP.
    const { ip } = req
      ? extractRequestContext(req)
      : { ip: 'unknown' };

    // The JWT-derived user comes from the 60s Redis cache which may still say
    // ACTIVE even though the DB already has DELETE_REQUESTED. Trust the DB.
    const current = await this.prisma.users.findUnique({
      where: { id: user.id },
      select: { delete_status: true },
    });
    if (current?.delete_status !== DeleteStatus.DELETE_REQUESTED) {
      throw new NotFoundException('No pending delete request');
    }

    await this.prisma.users.update({
      where: { id: user.id },
      data: {
        delete_status: DeleteStatus.ACTIVE,
        delete_requested_at: null,
        is_active: true,
      },
    });
    await this.invalidateUserCache(user.id);
    await this.auditLogService.recordAuditLog(user.id, 'ACCOUNT_DELETE_CANCELLED', ip);
  }

  async logoutSession(accessToken: string, sessionId: string, user: User, req: Request): Promise<void> {
    const { ip } = extractRequestContext(req);

    // `sessionId` is a refresh_tokens.id (see users.controller.ts), not a
    // device_id. Resolve the owning device from that row before revoking.
    const session = await this.prisma.refresh_tokens.findFirst({
      where: {
        id: sessionId,
        user_id: user.id,
        is_revoked: false,
        expires_at: { gt: DateUtil.now() },
      },
      select: { device_info: true },
    });
    if (!session) {
      throw new NotFoundException('Session not found');
    }

    const deviceId = this.extractDeviceId(session.device_info);
    if (deviceId) {
      await this.tokenService.revokeDeviceSession(user.id, deviceId);
    }
    // Mark the refresh-token row revoked so this session no longer shows as
    // active, including for rows with no parseable device id.
    await this.prisma.refresh_tokens.updateMany({
      where: { id: sessionId, user_id: user.id },
      data: { is_revoked: true },
    });

    await this.tokenService.blacklistToken(accessToken);
    await this.auditLogService.recordAuditLog(user.id, 'LOGOUT_SESSION', ip);
  }

  /**
   * device_info may be a plain device id or a session JWT whose `deviceId`
   * claim identifies the device (users.service.ts decodes JTIs from it).
   */
  private extractDeviceId(deviceInfo: string | null): string | null {
    if (!deviceInfo) return null;
    if (!deviceInfo.includes('.')) return deviceInfo;

    try {
      const payload = deviceInfo.split('.')[1];
      const decoded = JSON.parse(
        Buffer.from(payload, 'base64url').toString('utf8'),
      );
      return typeof decoded?.deviceId === 'string' ? decoded.deviceId : null;
    } catch {
      return null;
    }
  }
}
