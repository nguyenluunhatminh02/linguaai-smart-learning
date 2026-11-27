import { Injectable } from '@nestjs/common';
import { User } from '../../users/entities/user.entity';
import * as crypto from 'crypto';
import { PrismaService } from '../../prisma/prisma.service';
import { DateUtil } from '../../common/utils/date.util';

const MAX_ACTIVE_SESSIONS = 3;

@Injectable()
export class RefreshTokenService {
  constructor(private readonly prisma: PrismaService) {}

  async createRefreshToken(
    user: User,
    expiresInDays: number,
    deviceInfo?: string,
    ipAddress?: string,
    userAgent?: string,
  ): Promise<any> {
    // Wrap eviction + creation in a transaction to prevent race conditions
    // where concurrent logins could exceed MAX_ACTIVE_SESSIONS
    return this.prisma.$transaction(async (tx) => {
      // Enforce max sessions: evict oldest if at limit
      const activeSessions = await tx.refresh_tokens.findMany({
        where: { user_id: user.id, is_revoked: false },
        orderBy: { created_at: 'asc' },
      });

      if (activeSessions.length >= MAX_ACTIVE_SESSIONS) {
        const oldest = activeSessions[0];
        await tx.refresh_tokens.update({
          where: { id: oldest.id },
          data: { is_revoked: true },
        });
      }

      const expiresAt = DateUtil.addDays(expiresInDays);

      return tx.refresh_tokens.create({
        data: {
          token: crypto.randomBytes(64).toString('hex'),
          user_id: user.id,
          expires_at: expiresAt,
          device_info: deviceInfo ?? null,
          ip_address: ipAddress ?? null,
          user_agent: userAgent ?? null,
          last_active_at: DateUtil.now(),
          created_at: DateUtil.now(),
        },
      });
    });
  }

  async findValid(token: string): Promise<any | null> {
    return this.prisma.refresh_tokens.findFirst({
      where: { token, is_revoked: false },
      include: {
        users: {
          include: {
            user_roles: {
              include: {
                roles: true,
              },
            },
          },
        },
      },
    });
  }

  async revoke(token: string): Promise<void> {
    await this.prisma.refresh_tokens.updateMany({
      where: { token },
      data: { is_revoked: true },
    });
  }

  async revokeById(id: string, userId: string): Promise<boolean> {
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!uuidRegex.test(id)) return false;
    const rt = await this.prisma.refresh_tokens.findFirst({
      where: { id, user_id: userId, is_revoked: false },
    });
    if (!rt) return false;
    await this.prisma.refresh_tokens.update({
      where: { id },
      data: { is_revoked: true },
    });
    return true;
  }

  async revokeAllForUser(userId: string): Promise<void> {
    await this.prisma.refresh_tokens.updateMany({
      where: { user_id: userId, is_revoked: false },
      data: { is_revoked: true },
    });
  }

  async findActiveByUserId(userId: string): Promise<any[]> {
    return this.prisma.refresh_tokens.findMany({
      where: { user_id: userId, is_revoked: false },
      orderBy: { last_active_at: 'desc' },
    });
  }

  async updateLastActive(token: string): Promise<void> {
    await this.prisma.refresh_tokens.updateMany({
      where: { token },
      data: { last_active_at: DateUtil.now() },
    });
  }

  async removeExpired(): Promise<void> {
    await this.prisma.refresh_tokens.deleteMany({
      where: { expires_at: { lt: DateUtil.now() } },
    });
  }

  /**
   * Rotate refresh token atomically.
   *
   * Uses an atomic UPDATE...WHERE is_revoked=false to both validate and revoke
   * the old token in a single statement. Under Postgres Read Committed, two
   * concurrent rotations of the same token will serialize on the row lock
   * acquired by the UPDATE: the first commits and sets is_revoked=true, the
   * second's WHERE clause matches zero rows, so it throws instead of issuing
   * a second new token. This prevents the classic refresh-token reuse / theft
   * scenario where both the legitimate client and an attacker receive new
   * tokens from the same old one.
   *
   * @param oldToken - The old refresh token to rotate
   * @param expiresInDays - New token expiration in days
   * @returns The new refresh token record
   * @throws Error if old token is invalid or already revoked
   */
  async rotateToken(oldToken: string, expiresInDays: number = 7): Promise<any> {
    return this.prisma.$transaction(async (tx) => {
      // Atomic check-and-revoke: UPDATE returns the number of affected rows.
      // If zero rows matched, the token was already revoked (or never existed),
      // so we throw — this is the reuse-detection signal.
      const revokeResult = await tx.refresh_tokens.updateMany({
        where: { token: oldToken, is_revoked: false },
        data: { is_revoked: true },
      });

      if (revokeResult.count === 0) {
        throw new Error('Invalid or expired refresh token');
      }

      // Re-fetch the now-revoked row to obtain user_id and device metadata
      // needed to mint the replacement token.
      const oldRt = await tx.refresh_tokens.findFirst({
        where: { token: oldToken },
        include: {
          users: {
            include: { user_roles: { include: { roles: true } } },
          },
        },
      });

      if (!oldRt) {
        // Should not happen after a successful updateMany, but guard anyway.
        throw new Error('Invalid or expired refresh token');
      }

      const expiresAt = DateUtil.addDays(expiresInDays);

      return tx.refresh_tokens.create({
        data: {
          token: crypto.randomBytes(64).toString('hex'),
          user_id: oldRt.user_id,
          expires_at: expiresAt,
          device_info: oldRt.device_info,
          ip_address: oldRt.ip_address,
          user_agent: oldRt.user_agent,
          last_active_at: DateUtil.now(),
          created_at: DateUtil.now(),
        },
      });
    });
  }
}
