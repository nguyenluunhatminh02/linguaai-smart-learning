import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomBytes, createHash, createHmac, timingSafeEqual } from 'crypto';
import { RedisService } from './redis.service';

/**
 * CSRF Service
 *
 * Provides Cross-Site Request Forgery protection by generating and validating CSRF tokens.
 * Tokens are stored in Redis for distributed environments.
 *
 * CSRF tokens are only meaningful when the browser sends the session cookie
 * automatically: Keep the refresh cookie HttpOnly/Secure/SameSite, allow only
 * concrete CORS origins with credentials, and wire verification into every
 * cookie-authenticated state-changing route (the guard itself is owned by the
 * auth slice).
 */
@Injectable()
export class CsrfService {
  private readonly logger = new Logger(CsrfService.name);
  private readonly TOKEN_LENGTH = 32;
  private readonly PREFIX = 'csrf:';
  private readonly DEFAULT_TTL_SECONDS = 3600;

  constructor(
    private config: ConfigService,
    private redis: RedisService,
  ) {}

  /**
   * Server-side signing secret. Without it a token could be forged by anyone
   * who knows the source code, so both issuing and verifying fail closed.
   */
  private getSecret(): string {
    const secret = this.config.get<string>('JWT_SECRET');
    if (!secret) {
      throw new Error('JWT_SECRET is required for CSRF tokens');
    }
    return secret;
  }

  private ttlSeconds(maxAgeMs: number): number {
    return Number.isFinite(maxAgeMs) && maxAgeMs > 0
      ? Math.ceil(maxAgeMs / 1000)
      : this.DEFAULT_TTL_SECONDS;
  }

  /**
   * Generate a new CSRF token
   *
   * @param sessionId - The session ID to associate with the token
   * @param ttlSeconds - Time to live in seconds (default: 1 hour)
   * @returns The generated CSRF token
   */
  async generateToken(
    sessionId: string,
    ttlSeconds: number = this.DEFAULT_TTL_SECONDS,
  ): Promise<string> {
    if (!sessionId) {
      throw new Error('sessionId is required to issue a CSRF token');
    }
    // Generate random token
    const token = randomBytes(this.TOKEN_LENGTH).toString('hex');

    // Store only its hash: a Redis read must not hand a usable CSRF token
    // to anyone with read access to the cache.
    const key = `${this.PREFIX}${sessionId}`;
    await this.redis.set(key, this.hashToken(token), ttlSeconds);

    return token;
  }

  /**
   * Validate a CSRF token
   *
   * @param token - The token to validate
   * @param sessionId - The session ID to check against
   * @returns True if the token is valid, false otherwise
   */
  async validateToken(token: string, sessionId: string): Promise<boolean> {
    if (!token || !sessionId || token.length !== this.TOKEN_LENGTH * 2) {
      return false;
    }

    try {
      const key = `${this.PREFIX}${sessionId}`;
      const storedHash = await this.redis.get(key);

      if (!storedHash) {
        // Never log session identifiers: they are credentials.
        this.logger.warn('No CSRF token found for session');
        return false;
      }

      // Use constant-time comparison to prevent timing attacks
      return this.constantTimeCompare(this.hashToken(token), storedHash);
    } catch (error) {
      this.logger.error(`CSRF token validation error: ${error.message}`);
      return false;
    }
  }

  /**
   * Constant-time string comparison to prevent timing attacks
   */
  private constantTimeCompare(a: string, b: string): boolean {
    if (a.length !== b.length) {
      return false;
    }

    const aBuf = Buffer.from(a);
    const bBuf = Buffer.from(b);
    return timingSafeEqual(aBuf, bBuf);
  }

  /**
   * Generate a hash for CSRF token comparison
   *
   * @param token - The token to hash
   * @returns The hashed token
   */
  hashToken(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }

  /**
   * Compute an HMAC-SHA256 signature for a CSRF token.
   * Uses the server-side JWT_SECRET so forgery requires knowledge of the secret.
   * The session ID is part of the signed material: a token issued for one
   * session cannot be replayed with another session's identifier.
   */
  private computeHmac(
    token: string,
    timestamp: string,
    sessionId: string,
  ): string {
    return createHmac('sha256', this.getSecret())
      .update(`${token}:${timestamp}:${sessionId}`)
      .digest('hex');
  }

  /**
   * Generate a signed CSRF token
   *
   * @param sessionId - The session ID
   * @returns A signed token that can be verified later
   */
  async generateSignedToken(
    sessionId: string,
    maxAgeMs: number = this.DEFAULT_TTL_SECONDS * 1000,
  ): Promise<string> {
    if (!sessionId) {
      throw new Error('sessionId is required to issue a CSRF token');
    }

    const token = randomBytes(this.TOKEN_LENGTH).toString('hex');
    const timestamp = Date.now().toString();
    const signature = this.computeHmac(token, timestamp, sessionId);
    const signedToken = `${token}:${timestamp}:${signature}`;

    // Track the token hash in Redis so it can be revoked with the session and
    // consumed exactly once on validation. TTL mirrors maxAge so the cache
    // entry never outlives the token's logical validity window.
    await this.redis.set(
      `${this.PREFIX}signed:${sessionId}`,
      this.hashToken(token),
      this.ttlSeconds(maxAgeMs),
    );

    return signedToken;
  }

  /**
   * Verify a signed CSRF token
   *
   * @param signedToken - The signed token to verify
   * @param sessionId - The session ID
   * @param maxAge - Maximum age in milliseconds (default: 1 hour)
   * @returns True if the token is valid and not expired
   */
  async verifySignedToken(
    signedToken: string,
    sessionId: string,
    maxAge: number = 3600000,
  ): Promise<boolean> {
    if (!signedToken || !sessionId) {
      return false;
    }
    // Fail closed before any parsing: an unconfigured server must never
    // accept CSRF tokens, even malformed ones.
    this.getSecret();

    const parts = signedToken.split(':');
    // Signature is last part, timestamp is second-to-last, token is everything before
    if (parts.length < 3) {
      return false;
    }
    const signature = parts[parts.length - 1];
    const timestamp = parts[parts.length - 2];
    const token = parts.slice(0, parts.length - 2).join(':');

    if (!token || !signature || !/^\d{13}$/.test(timestamp)) {
      return false;
    }

    // Check if token is expired
    const tokenAge = Date.now() - parseInt(timestamp, 10);
    if (isNaN(tokenAge) || tokenAge > maxAge || tokenAge < 0) {
      this.logger.warn('CSRF token expired or has invalid timestamp');
      return false;
    }

    // Verify HMAC signature — constant-time to prevent timing attacks.
    // Binding to sessionId prevents cross-session replay.
    const expectedSignature = this.computeHmac(token, timestamp, sessionId);
    if (!this.constantTimeCompare(signature, expectedSignature)) {
      this.logger.warn('CSRF token signature mismatch');
      return false;
    }

    // Verify the token is still stored for this session (it may have been
    // revoked on logout) and consume it so it cannot be reused. RedisService
    // returns null / swallows errors when Redis is unavailable; fail closed in
    // that case instead of accepting a signature-only token.
    const key = `${this.PREFIX}signed:${sessionId}`;
    try {
      const storedHash = await this.redis.get(key);
      if (
        !storedHash ||
        !this.constantTimeCompare(this.hashToken(token), storedHash)
      ) {
        this.logger.warn(
          'CSRF signed token not found or mismatched for session',
        );
        return false;
      }
      await this.redis.del(key);
    } catch (error) {
      this.logger.error(
        `CSRF signed token verification error: ${error.message}`,
      );
      return false;
    }

    return true;
  }
}
