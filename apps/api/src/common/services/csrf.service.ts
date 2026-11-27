import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomBytes, createHash, createHmac, timingSafeEqual } from 'crypto';
import { RedisService } from './redis.service';

/**
 * CSRF Service
 * 
 * Provides Cross-Site Request Forgery protection by generating and validating CSRF tokens.
 * Tokens are stored in Redis for distributed environments.
 */
@Injectable()
export class CsrfService {
  private readonly logger = new Logger(CsrfService.name);
  private readonly TOKEN_LENGTH = 32;
  private readonly PREFIX = 'csrf:';

  constructor(
    private config: ConfigService,
    private redis: RedisService,
  ) {}

  /**
   * Generate a new CSRF token
   * 
   * @param sessionId - The session ID to associate with the token
   * @param ttlSeconds - Time to live in seconds (default: 1 hour)
   * @returns The generated CSRF token
   */
  async generateToken(sessionId: string, ttlSeconds: number = 3600): Promise<string> {
    // Generate random token
    const token = randomBytes(this.TOKEN_LENGTH).toString('hex');
    
    // Store token in Redis
    const key = `${this.PREFIX}${sessionId}`;
    await this.redis.set(key, token, ttlSeconds);
    
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
    if (!token || token.length !== this.TOKEN_LENGTH * 2) {
      return false;
    }

    try {
      const key = `${this.PREFIX}${sessionId}`;
      const storedToken = await this.redis.get(key);
      
      if (!storedToken) {
        this.logger.warn(`No CSRF token found for session: ${sessionId}`);
        return false;
      }

      // Use constant-time comparison to prevent timing attacks
      return this.constantTimeCompare(token, storedToken);
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
  private computeHmac(token: string, timestamp: string, sessionId: string): string {
    const secret = this.config.get<string>('JWT_SECRET') || 'fallback-secret';
    return createHmac('sha256', secret)
      .update(`${token}:${timestamp}:${sessionId}`)
      .digest('hex');
  }

  /**
   * Generate a signed CSRF token
   *
   * @param sessionId - The session ID
   * @returns A signed token that can be verified later
   */
  async generateSignedToken(sessionId: string): Promise<string> {
    if (!sessionId) {
      throw new Error('sessionId is required to issue a CSRF token');
    }

    const token = randomBytes(this.TOKEN_LENGTH).toString('hex');
    const timestamp = Date.now().toString();
    const signature = this.computeHmac(token, timestamp, sessionId);
    const signedToken = `${token}:${timestamp}:${signature}`;

    // Track the token in Redis so it can be revoked with the session and
    // consumed exactly once on validation.
    await this.redis.set(`${this.PREFIX}signed:${sessionId}`, token, 3600);

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
    // revoked on logout) and consume it so it cannot be reused.
    const key = `${this.PREFIX}signed:${sessionId}`;
    try {
      const storedToken = await this.redis.get(key);
      if (!storedToken || !this.constantTimeCompare(token, storedToken)) {
        this.logger.warn('CSRF signed token not found or mismatched for session');
        return false;
      }
      await this.redis.del(key);
    } catch (error) {
      this.logger.error(`CSRF signed token verification error: ${error.message}`);
      return false;
    }

    return true;
  }
}
