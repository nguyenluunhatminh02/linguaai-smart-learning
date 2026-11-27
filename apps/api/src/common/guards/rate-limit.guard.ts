import {
  Injectable,
  CanActivate,
  ExecutionContext,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { createHash } from 'crypto';
import { RateLimiterService } from '../services/rate-limiter.service';
import { RATE_LIMIT_KEY } from '../decorators/rate-limit.decorator';
import { DateUtil } from '../utils/date.util';

/**
 * Rate Limit Guard
 *
 * Enforces rate limiting on routes decorated with @RateLimit().
 * Uses IP address and user-specific keys for rate limiting.
 */
@Injectable()
export class RateLimitGuard implements CanActivate {
  private readonly logger = new Logger(RateLimitGuard.name);
  private readonly trustedProxies: string[];

  constructor(
    private reflector: Reflector,
    private rateLimiter: RateLimiterService,
    private config?: ConfigService,
  ) {
    // X-Forwarded-For is only meaningful when the direct peer is a proxy we
    // control. Configure TRUSTED_PROXIES as a comma-separated list of IPs /
    // CIDRs (matching app.set('trust proxy', ...)). With no configuration the
    // socket address is used, which is safe by default.
    this.trustedProxies = (this.config?.get<string>('TRUSTED_PROXIES') || '')
      .split(',')
      .map((value) => value.trim())
      .filter(Boolean);
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    // Get rate limit configuration from decorator
    const config = this.reflector.getAllAndOverride(RATE_LIMIT_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    // If no rate limit config, allow request
    if (!config) {
      return true;
    }

    const request = context.switchToHttp().getRequest();
    const response = context.switchToHttp().getResponse();

    // Build rate limit key
    const key = this.buildRateLimitKey(request, config);

    try {
      // Check rate limit
      const result = await this.rateLimiter.checkRateLimit(key, config);

      // Add rate limit headers to response
      response.setHeader('X-RateLimit-Limit', config.limit);
      response.setHeader('X-RateLimit-Remaining', result.remaining);
      response.setHeader('X-RateLimit-Reset', Math.floor(result.resetTime.getTime() / 1000));

      return true;
    } catch (error) {
      // Rate limit exceeded
      if (error instanceof HttpException && error.getStatus() === HttpStatus.TOO_MANY_REQUESTS) {
        const errorResponse = error.getResponse() as any;
        response.setHeader('X-RateLimit-Limit', config.limit);
        response.setHeader('X-RateLimit-Remaining', 0);
        response.setHeader('X-RateLimit-Reset', Math.floor(DateUtil.toDate(errorResponse.resetTime).getTime() / 1000));
        
        this.logger.warn(`Rate limit exceeded for key: ${key}`);
        throw error;
      }

      // Infrastructure failures must not disable brute-force protection:
      // reject the request rather than allowing unlimited attempts.
      this.logger.error(`Rate limiter error: ${error.message}`);
      throw new HttpException(
        'Rate limiter unavailable',
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }
  }

  /**
   * Build rate limit key based on request and configuration
   */
  private buildRateLimitKey(request: any, config: any): string {
    const { keyPrefix } = config;

    // Priority: User ID > Email > IP
    if (request.user?.id) {
      return `${keyPrefix}:user:${request.user.id}`;
    }

    if (request.body?.email) {
      // Hash the email so PII doesn't appear in Redis keys or log lines
      const emailHash = createHash('sha256').update(request.body.email.toLowerCase()).digest('hex').substring(0, 16);
      return `${keyPrefix}:email:${emailHash}`;
    }

    if (request.query?.email) {
      const emailHash = createHash('sha256').update((request.query.email as string).toLowerCase()).digest('hex').substring(0, 16);
      return `${keyPrefix}:email:${emailHash}`;
    }

    // Fall back to IP address
    const ip = this.getClientIp(request);
    return `${keyPrefix}:ip:${ip}`;
  }

  /**
   * Get client IP address from request.
   * X-Forwarded-For is only honoured when the direct peer is an explicitly
   * configured trusted proxy; otherwise it is trivially spoofable and would
   * let a client obtain a fresh rate-limit bucket on every request.
   */
  private getClientIp(request: any): string {
    const socketIp = request.socket?.remoteAddress || request.ip || 'unknown';

    if (this.trustedProxies.length === 0 || !this.trustedProxies.includes(socketIp)) {
      return socketIp;
    }

    const forwarded = request.headers['x-forwarded-for'];
    if (!forwarded) return socketIp;

    // Select a fixed hop from the right so leftmost (client-controlled)
    // entries cannot be used to switch buckets. `trust proxy` hop count is
    // expressed by the number of configured trusted proxies.
    const hops = (Array.isArray(forwarded) ? forwarded : String(forwarded).split(','))
      .flatMap((value) => String(value).split(','))
      .map((value) => value.trim())
      .filter(Boolean);
    const hopIndex = Math.max(0, hops.length - this.trustedProxies.length);
    return hops[hopIndex] || socketIp;
  }
}
