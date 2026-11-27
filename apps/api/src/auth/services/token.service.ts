import { Injectable, Logger, ServiceUnavailableException } from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import { ConfigService } from "@nestjs/config";
import { v4 as uuidv4 } from "uuid";
import { RedisService } from "../../common/services/redis.service";
import { PrismaService } from "../../prisma/prisma.service";
import { DateUtil } from "../../common/utils/date.util";

export interface TokenUser {
  id: string;
  email: string;
  roles: string[];
}

@Injectable()
export class TokenService {
  private readonly logger = new Logger(TokenService.name);
  private readonly accessTtlMs: number;
  private readonly refreshTtlMs: number;
  private readonly failClosedOnRedisOutage: boolean;

  constructor(
    private readonly jwtService: JwtService,
    private readonly config: ConfigService,
    private readonly redis: RedisService,
    private readonly prisma: PrismaService,
  ) {
    this.accessTtlMs = DateUtil.parseDurationMs(
      config.get<string>("JWT_ACCESS_EXPIRY", "15m"),
      900_000,
    );
    this.refreshTtlMs = DateUtil.parseDurationMs(
      config.get<string>("JWT_REFRESH_EXPIRY", "7d"),
      604_800_000,
    );
    this.failClosedOnRedisOutage =
      config.get<string>("NODE_ENV") === "production";
  }

  getAccessTtlMs(): number {
    return this.accessTtlMs;
  }

  // ─── Access Token ──────────────────────────────────────────────────────────

  generateAccessToken(user: TokenUser, deviceId: string): string {
    const jti = uuidv4();
    const expiresIn = Math.floor(this.accessTtlMs / 1000);
    return this.jwtService.sign(
      {
        sub: user.id,
        email: user.email,
        roles: user.roles,
        deviceId,
        type: "ACCESS",
        jti,
        // Second-granularity `iat` cannot distinguish tokens minted just
        // before a revocation from those minted just after it. This claim is
        // compared with the millisecond revocation markers stored in Redis.
        iatMs: Date.now(),
      },
      { expiresIn },
    );
  }

  // ─── Refresh Token ─────────────────────────────────────────────────────────

  generateRefreshToken(
    user: TokenUser,
    deviceId: string,
    rememberMe = false,
  ): { token: string; jti: string; ttlSec: number } {
    const jti = uuidv4();
    // rememberMe → 28 ngày, bình thường → config
    const ttlSec = rememberMe
      ? 28 * 24 * 3600
      : Math.floor(this.refreshTtlMs / 1000);
    const token = this.jwtService.sign(
      {
        sub: user.id,
        email: user.email,
        roles: user.roles,
        deviceId,
        type: "REFRESH",
        jti,
      },
      { expiresIn: ttlSec },
    );
    return { token, jti, ttlSec };
  }

  // ─── MFA Token (5 min) ─────────────────────────────────────────────────────

  generateMfaToken(userId: string): string {
    const jti = uuidv4();
    return this.jwtService.sign(
      { sub: userId, type: "MFA_PENDING", jti },
      { expiresIn: 300 },
    );
  }

  decodeMfaToken(token: string): { userId: string } | null {
    try {
      const payload = this.jwtService.verify(token) as any;
      if (payload.type !== "MFA_PENDING") return null;
      return { userId: payload.sub };
    } catch {
      return null;
    }
  }

  // ─── Redis: lưu / validate Refresh Token ──────────────────────────────────

  /**
   * Lưu JTI của refresh token vào Redis.
   * Key format: refresh:{userId}:{deviceId}
   */
  async storeRefreshToken(
    userId: string,
    deviceId: string,
    jti: string,
    ttlSec: number,
  ): Promise<void> {
    await this.redis.set(`refresh:${userId}:${deviceId}`, jti, ttlSec);
  }

  /**
   * Kiểm tra refresh token hợp lệ:
   * 1. Verify JWT signature + expiry
   * 2. Kiểm tra type === 'REFRESH'
   * 3. So sánh JTI trong Redis
   */
  async validateRefreshToken(
    token: string,
  ): Promise<{ userId: string; deviceId: string; roles: string[] } | null> {
    try {
      const payload = this.jwtService.verify(token) as any;
      if (payload.type !== "REFRESH") return null;

      // A refresh token is only valid while its server-side session key exists.
      // Never fall back to signature-only validation: revocation (logout,
      // password reset, device removal) works by deleting that key, so a
      // fail-open check would resurrect revoked sessions in any environment.
      if (!this.redis.isAvailable()) {
        this.logger.error("Redis unavailable - failing closed on refresh token validation");
        return null;
      }

      const storedJti = await this.redis.get(
        `refresh:${payload.sub}:${payload.deviceId}`,
      );
      if (!storedJti || storedJti !== payload.jti) return null;

      return {
        userId: payload.sub,
        deviceId: payload.deviceId,
        roles: payload.roles || [],
      };
    } catch (error: any) {
      this.logger.debug(`Refresh token validation failed: ${error.message}`);
      return null;
    }
  }

  // ─── Blacklist (Access Token) ──────────────────────────────────────────────

  /**
   * Persist a revocation marker for a single access token.
   *
   * Uses the verified payload (never jwtService.decode) so an unsigned or
   * tampered token cannot influence a Redis key. Throws when the marker cannot
   * be stored: callers must not report a successful logout while the token is
   * still usable. RedisService.set swallows its own errors, so availability
   * and a read-after-write check are both required here.
   */
  async blacklistToken(token: string): Promise<void> {
    let payload: any;
    try {
      payload = this.jwtService.verify(token) as any;
    } catch (err: any) {
      // An already-expired token cannot be used again; no revocation needed.
      if (err?.name === "TokenExpiredError") return;
      throw new ServiceUnavailableException("Could not revoke access token");
    }
    if (!payload?.jti || !payload?.exp) {
      throw new ServiceUnavailableException("Could not revoke access token");
    }
    const ttl = payload.exp - Math.floor(Date.now() / 1000);
    if (ttl <= 0) return; // already expired — nothing to revoke

    if (!this.redis.isAvailable()) {
      // Checked again after the write so a connection lost mid-request cannot
      // silently drop the marker. Dev/test fail-open only for this single JTI.
      if (this.failClosedOnRedisOutage) {
        this.logger.error("Redis unavailable - cannot blacklist access token");
        throw new ServiceUnavailableException("Could not revoke access token");
      }
      this.logger.warn(
        "Redis unavailable - access token blacklist not persisted (non-production)",
      );
      return;
    }
    const key = `blacklist:${payload.jti}`;
    await this.redis.set(key, "1", ttl);
    if (this.failClosedOnRedisOutage && !this.redis.isAvailable()) {
      this.logger.error("Redis disconnected while blacklisting access token");
      throw new ServiceUnavailableException("Could not revoke access token");
    }
  }

  async isTokenBlacklisted(token: string): Promise<boolean> {
    let payload: any;
    try {
      payload = this.jwtService.verify(token) as any;
    } catch (error: any) {
      this.logger.debug(`Token blacklist check failed: ${error.message}`);
      // Production fails closed on unverifiable tokens (including a Redis
      // outage that changes the signing configuration); dev/test fail open.
      return this.failClosedOnRedisOutage;
    }
    if (!payload?.jti) return false;

    // Fail-closed in production: if Redis is unavailable we cannot prove the
    // token was NOT revoked, so reject it rather than silently accepting a
    // potentially blacklisted token. In non-production we fail-open to keep
    // local development usable without Redis.
    if (!this.redis.isAvailable()) {
      if (this.failClosedOnRedisOutage) {
        this.logger.error(
          "Redis unavailable - failing closed on token blacklist check",
        );
        return true;
      }
      this.logger.warn(
        "Redis unavailable - failing open on token blacklist check (non-production)",
      );
      return false;
    }

    // A user-level marker revokes every access token issued before it; the
    // device marker covers "log out this session" for tokens that were issued
    // before the device session was revoked. Tokens issued after a re-login
    // remain valid. Prefer the millisecond issue time; fall back to standard
    // `iat` for tokens minted before this claim existed.
    const issuedAt = typeof payload.iatMs === "number"
      ? payload.iatMs
      : (payload.iat ?? 0) * 1000;
    if (await this.isUserSessionRevoked(payload.sub, issuedAt)) {
      return true;
    }
    if (
      payload.deviceId &&
      (await this.isDeviceSessionRevoked(
        payload.sub,
        payload.deviceId,
        issuedAt,
      ))
    ) {
      return true;
    }
    return await this.existsWithFallback(`blacklist:${payload.jti}`);
  }

  /** Redis.exists() read wrapper that fails closed in production on errors. */
  private async existsWithFallback(key: string): Promise<boolean> {
    try {
      return await this.redis.exists(key);
    } catch (error: any) {
      this.logger.debug(`Blacklist lookup failed for ${key}: ${error.message}`);
      return this.failClosedOnRedisOutage;
    }
  }

  /**
   * Read a revocation timestamp and reject tokens issued before or at it.
   * Only pre-revocation tokens are rejected, so logging in again after a
   * logout-all keeps working.
   */
  private async isRevokedSince(key: string, tokenIssuedAt: number): Promise<boolean> {
    let raw: string | null;
    try {
      raw = await this.redis.get(key);
    } catch (error: any) {
      this.logger.debug(`Revocation lookup failed for ${key}: ${error.message}`);
      return this.failClosedOnRedisOutage;
    }
    if (!raw) return false;
    const revokedAt = Number.parseInt(raw, 10);
    return Number.isFinite(revokedAt) && tokenIssuedAt <= revokedAt;
  }

  private isUserSessionRevoked(userId: string, tokenIssuedAt: number): Promise<boolean> {
    return this.isRevokedSince(`revoked-user:${userId}`, tokenIssuedAt);
  }

  /** Device marker is only checked for tokens with a deviceId claim. */
  private isDeviceSessionRevoked(
    userId: string,
    deviceId: string,
    tokenIssuedAt: number,
  ): Promise<boolean> {
    return this.isRevokedSince(
      `revoked-device:${userId}:${deviceId}`,
      tokenIssuedAt,
    );
  }

  // ─── Revoke Sessions ───────────────────────────────────────────────────────

  /** Thu hồi 1 device session: xóa Redis key + set device inactive */
  async revokeDeviceSession(userId: string, deviceId: string): Promise<void> {
    await this.redis.del(`refresh:${userId}:${deviceId}`);
    // Deleting the refresh key alone leaves already-issued access tokens valid
    // for their remaining TTL. Mark the device revoked so JwtStrategy rejects
    // tokens issued up to this instant, while allowing freshly issued ones.
    if (this.redis.isAvailable()) {
      await this.redis.set(
        `revoked-device:${userId}:${deviceId}`,
        `${Date.now()}`,
        Math.ceil(this.accessTtlMs / 1000),
      );
    } else if (this.failClosedOnRedisOutage) {
      throw new ServiceUnavailableException("Could not revoke device session");
    }
    await this.prisma.user_devices.updateMany({
      where: { user_id: userId, device_id: deviceId },
      data: { active: false },
    });
  }

  /** Thu hồi tất cả sessions (logout all) */
  async revokeAllSessions(userId: string): Promise<void> {
    const keys = await this.redis.keys(`refresh:${userId}:*`);
    if (keys.length > 0) await this.redis.delMany(keys);
    // Access tokens are stateless and are not enumerated by the refresh keys
    // above. Store the revocation instant; JwtStrategy rejects access tokens
    // issued at or before it for the length of their maximum TTL.
    if (this.redis.isAvailable()) {
      await this.redis.set(
        `revoked-user:${userId}`,
        `${Date.now()}`,
        Math.ceil(this.accessTtlMs / 1000) + 60,
      );
    } else if (this.failClosedOnRedisOutage) {
      throw new ServiceUnavailableException("Could not revoke sessions");
    }
    await this.prisma.user_devices.updateMany({
      where: { user_id: userId },
      data: { active: false },
    });
  }

  /** Thu hồi tất cả sessions trừ device hiện tại */
  async revokeOtherSessions(
    userId: string,
    currentDeviceId: string,
  ): Promise<void> {
    const allKeys = await this.redis.keys(`refresh:${userId}:*`);
    const otherKeys = allKeys.filter((k) => !k.endsWith(`:${currentDeviceId}`));
    if (otherKeys.length > 0) await this.redis.delMany(otherKeys);
    // Mark every other device so their outstanding access tokens are revoked
    // as well, while the caller's current device keeps working.
    const revokedAt = `${Date.now()}`;
    const ttl = Math.ceil(this.accessTtlMs / 1000);
    for (const key of otherKeys) {
      const deviceId = key.slice(`refresh:${userId}:`.length);
      if (!deviceId) continue;
      if (this.redis.isAvailable()) {
        await this.redis.set(`revoked-device:${userId}:${deviceId}`, revokedAt, ttl);
      } else if (this.failClosedOnRedisOutage) {
        throw new ServiceUnavailableException("Could not revoke other sessions");
      }
    }
    await this.prisma.user_devices.updateMany({
      where: { user_id: userId, device_id: { not: currentDeviceId } },
      data: { active: false },
    });
  }

  /** Đếm số active sessions của user */
  async getActiveSessionCount(userId: string): Promise<number> {
    const keys = await this.redis.keys(`refresh:${userId}:*`);
    return keys.length;
  }
}
