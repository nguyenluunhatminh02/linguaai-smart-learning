import {
  CanActivate,
  ExecutionContext,
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { createHash } from 'crypto';
import {
  RateLimiterService,
  RateLimitResult,
  RateLimitUnavailablePayload,
} from '../services/rate-limiter.service';
import { RATE_LIMIT_KEY } from '../decorators/rate-limit.decorator';

/**
 * Early body-size pre-check for rate-limited routes. An oversized body is
 * rejected before any Redis counter work. Content-Length is client-controlled,
 * so the parser/upload limits remain the definitive enforcement point.
 */
const MAX_RATE_LIMIT_BODY_BYTES = 64 * 1024;

function parseContentLength(value: unknown): number | undefined {
  if (typeof value === 'number') {
    return Number.isSafeInteger(value) && value >= 0 ? value : undefined;
  }
  if (typeof value !== 'string' || !/^\d+$/.test(value.trim()))
    return undefined;
  const parsed = Number(value.trim());
  return Number.isSafeInteger(parsed) ? parsed : undefined;
}

/** Metadata applied by @RateLimit(); kept permissive for custom configs. */
type GuardConfig = {
  limit: number;
  window: number;
  keyPrefix?: string;
  failurePolicy?: 'closed' | 'open';
  [key: string]: unknown;
};

/** Response from the service, including the metadata needed for headers. */
type AllowedResult = RateLimitResult & {
  limit: number;
  resetAt: number;
  retryAfterSeconds: number;
};

type DeniedPayload = {
  resetTime?: string;
  limit?: number;
  resetAt?: number;
  retryAfterSeconds?: number;
  message?: string | string[];
};

/**
 * Rate Limit Guard
 *
 * Enforces rate limiting on routes decorated with @RateLimit().
 * Keys are scoped by user, identity and feature; all counters live in Redis.
 * A backend outage blocks the request (503) for closed-policy configs, which
 * includes AI write routes. It never silently allows unlimited traffic.
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
    const config = this.reflector.getAllAndOverride<GuardConfig | undefined>(
      RATE_LIMIT_KEY,
      [context.getHandler(), context.getClass()],
    );

    // Routes without a @RateLimit() decorator are outside this guard's scope.
    if (!config) return true;

    const request = context.switchToHttp().getRequest();
    const response = context.switchToHttp().getResponse();

    // Reject an oversized body before hashing an email, touching Redis, or
    // consuming a rate-limit token. Never log the header value itself.
    const declaredLength = parseContentLength(
      request?.headers?.['content-length'],
    );
    if (
      declaredLength !== undefined &&
      declaredLength > MAX_RATE_LIMIT_BODY_BYTES
    ) {
      throw new HttpException(
        'Request body is too large',
        HttpStatus.PAYLOAD_TOO_LARGE,
      );
    }

    const key = this.buildRateLimitKey(request, config);

    try {
      const result = await this.rateLimiter.checkRateLimit(key, config);
      this.applyHeaders(response, config, result);
      return true;
    } catch (error) {
      this.handleFailure(error, response, config, key);
    }
  }

  private applyHeaders(
    response: any,
    config: GuardConfig,
    result: AllowedResult,
  ): void {
    response.setHeader('X-RateLimit-Limit', config.limit);
    response.setHeader('X-RateLimit-Remaining', result.remaining);
    // HTTP convention for X-RateLimit-Reset is epoch seconds, not ISO text.
    response.setHeader('X-RateLimit-Reset', result.resetAt);
  }

  private handleFailure(
    error: unknown,
    response: any,
    config: GuardConfig,
    key: string,
  ): never {
    if (
      error instanceof HttpException &&
      error.getStatus() === HttpStatus.TOO_MANY_REQUESTS
    ) {
      const payload = error.getResponse() as DeniedPayload;
      this.applyHeaders(response, config, {
        remaining: 0,
        limit: config.limit,
        resetAt: payload.resetAt ?? this.toEpochSeconds(payload.resetTime),
        retryAfterSeconds: payload.retryAfterSeconds ?? 1,
      } as AllowedResult);
      response.setHeader('Retry-After', String(payload.retryAfterSeconds ?? 1));
      this.logger.warn(
        `Rate limit exceeded for key: ${this.safeIdentity(key)}`,
      );
      throw error;
    }

    if (
      error instanceof HttpException &&
      error.getStatus() === HttpStatus.SERVICE_UNAVAILABLE
    ) {
      // The service already classified this as a closed-policy outage.
      const payload = error.getResponse() as DeniedPayload;
      this.applyOutageHeaders(response, config, payload);
      this.logger.error(
        `Rate limiter unavailable for key: ${this.safeIdentity(key)}`,
      );
      throw error;
    }

    // Unexpected guard/limiter errors must also fail closed.
    this.logger.error(
      `Rate limiter error for key ${this.safeIdentity(key)}: ${error instanceof Error ? error.message : String(error)}`,
    );
    const nowFields = {
      resetTime: new Date(
        Date.now() + Math.max(1, config.window || 1) * 1000,
      ).toISOString(),
      limit: config.limit,
      resetAt: Math.floor(Date.now() / 1000) + Math.max(1, config.window || 1),
      retryAfterSeconds: Math.max(1, config.window || 1),
    };
    this.applyOutageHeaders(response, config, nowFields);
    throw new HttpException(
      {
        message: 'Rate limiter unavailable. Please try again shortly.',
        ...nowFields,
      } satisfies RateLimitUnavailablePayload,
      HttpStatus.SERVICE_UNAVAILABLE,
    );
  }

  private applyOutageHeaders(
    response: any,
    config: GuardConfig,
    payload: DeniedPayload,
  ): void {
    this.applyHeaders(response, config, {
      remaining: 0,
      limit: config.limit,
      resetAt: payload.resetAt ?? 0,
      retryAfterSeconds: payload.retryAfterSeconds ?? 1,
    } as AllowedResult);
    response.setHeader('Retry-After', String(payload.retryAfterSeconds ?? 1));
  }

  private toEpochSeconds(resetTime?: string): number {
    if (!resetTime) return Math.floor(Date.now() / 1000) + 1;
    const parsed = new Date(resetTime).getTime();
    return Number.isFinite(parsed)
      ? Math.floor(parsed / 1000)
      : Math.floor(Date.now() / 1000) + 1;
  }

  /** Hash identity before logging: emails and tokens never reach log lines. */
  private safeIdentity(key: string): string {
    return createHash('sha256').update(key).digest('hex').substring(0, 16);
  }

  /**
   * Build rate limit key based on request and configuration
   */
  private buildRateLimitKey(request: any, config: GuardConfig): string {
    const { keyPrefix } = config;

    // Priority: User ID > Email > IP
    if (request.user?.id) {
      return `${keyPrefix}:user:${request.user.id}`;
    }

    if (request.body?.email) {
      // Hash the email so PII doesn't appear in Redis keys or log lines
      const emailHash = createHash('sha256')
        .update(request.body.email.toLowerCase())
        .digest('hex')
        .substring(0, 16);
      return `${keyPrefix}:email:${emailHash}`;
    }

    if (request.query?.email) {
      const emailHash = createHash('sha256')
        .update((request.query.email as string).toLowerCase())
        .digest('hex')
        .substring(0, 16);
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

    if (
      this.trustedProxies.length === 0 ||
      !this.trustedProxies.includes(socketIp)
    ) {
      return socketIp;
    }

    const forwarded = request.headers['x-forwarded-for'];
    if (!forwarded) return socketIp;

    // Select a fixed hop from the right so leftmost (client-controlled)
    // entries cannot be used to switch buckets. `trust proxy` hop count is
    // expressed by the number of configured trusted proxies.
    const hops = (
      Array.isArray(forwarded) ? forwarded : String(forwarded).split(',')
    )
      .flatMap((value) => String(value).split(','))
      .map((value) => value.trim())
      .filter(Boolean);
    const hopIndex = Math.max(0, hops.length - this.trustedProxies.length);
    return hops[hopIndex] || socketIp;
  }
}
