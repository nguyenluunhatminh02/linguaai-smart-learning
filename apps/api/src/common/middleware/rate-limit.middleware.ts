import { HttpException, Injectable, NestMiddleware } from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';
import { isIP } from 'net';
import { RateLimiterService } from '../services/rate-limiter.service';

/**
 * Shared-store rate limiter.
 *
 * The previous implementation kept counters in a per-process object, which
 * allowed clients to multiply their quota by hitting other replicas/workers
 * and lost all limits on restart. It also iterated every key synchronously in
 * cleanup(), blocking the event loop as the store grew. Use the Redis-backed
 * RateLimiterService instead: counters are shared across processes, atomic,
 * and expire automatically via TTL — no local store or cleanup timer needed.
 *
 * NOTE: this middleware is not currently registered in AppModule; ThrottlerGuard
 * is the active general limiter. It is kept for callers that choose to register
 * it with Nest's middleware consumer.
 */
@Injectable()
export class RateLimitMiddleware implements NestMiddleware {
  private readonly windowSec: number;
  private readonly maxRequests: number;

  constructor(private readonly rateLimiter: RateLimiterService) {
    const windowMs = parseInt(
      process.env.RATE_LIMIT_WINDOW_MS || (15 * 60 * 1000).toString(),
      10,
    );
    this.windowSec = Math.max(1, Math.floor(windowMs / 1000));
    this.maxRequests = parseInt(
      process.env.RATE_LIMIT_MAX_REQUESTS || '100',
      10,
    );
  }

  async use(req: Request, res: Response, next: NextFunction): Promise<void> {
    // Include the route so one endpoint cannot consume another's budget.
    const key = `${this.getClientKey(req)}:${req.method}:${req.path}`;
    try {
      const result = await this.rateLimiter.checkRateLimit(key, {
        limit: this.maxRequests,
        window: this.windowSec,
        keyPrefix: 'general',
      });
      res.setHeader('X-RateLimit-Limit', result.limit);
      res.setHeader('X-RateLimit-Remaining', result.remaining);
      // Epoch seconds (HTTP convention), not ISO 8601 text.
      res.setHeader('X-RateLimit-Reset', result.resetAt);
      next();
    } catch (error) {
      // checkRateLimit throws 429 (quota) or 503 (closed-policy outage).
      // Expose the TTL-derived retry hint, then hand off to Nest's exception
      // filter. Never call next() here: a failed limiter must not pass traffic.
      const payload =
        error instanceof HttpException
          ? (error.getResponse() as {
              resetAt?: number;
              retryAfterSeconds?: number;
            })
          : undefined;
      const retryAfter = payload?.retryAfterSeconds ?? this.windowSec;
      res.setHeader('Retry-After', String(retryAfter));
      res.setHeader('X-RateLimit-Limit', this.maxRequests);
      res.setHeader('X-RateLimit-Remaining', 0);
      res.setHeader(
        'X-RateLimit-Reset',
        payload?.resetAt ?? Math.floor(Date.now() / 1000) + retryAfter,
      );
      next(error);
    }
  }

  /**
   * Derive the client IP without trusting unvalidated forwarded headers.
   * X-Forwarded-For is only consulted when the immediate peer is a trusted
   * proxy (TRUST_PROXY_IPS, comma-separated IPs/CIDRs), and only its last
   * untrusted hop is used. Otherwise the socket address is authoritative.
   */
  private getClientKey(req: Request): string {
    const socketIp = req.socket?.remoteAddress || req.ip || '';
    const normalizedSocketIp = normalizeIp(socketIp);
    const trustedProxies = (process.env.TRUST_PROXY_IPS || '')
      .split(',')
      .map((value) => value.trim())
      .filter(Boolean);

    let clientIp = normalizedSocketIp || 'unknown';
    if (isTrustedProxy(normalizedSocketIp, trustedProxies)) {
      const forwarded = req.headers['x-forwarded-for'];
      const forwardedIps = (
        Array.isArray(forwarded) ? forwarded.join(',') : forwarded || ''
      )
        .split(',')
        .map((value) => value.trim())
        .map((value) => normalizeIp(value))
        .filter((ip): ip is string => isIP(ip) !== 0);

      // Walk right-to-left: the rightmost entry is written by the trusted
      // proxy, so the first untrusted address from the right is the client.
      for (let i = forwardedIps.length - 1; i >= 0; i--) {
        if (!isTrustedProxy(forwardedIps[i], trustedProxies)) {
          clientIp = forwardedIps[i];
          break;
        }
      }
    }

    return `rate_limit:${clientIp}`;
  }
}

/** Normalize IPv4-mapped IPv6 (e.g. ::ffff:127.0.0.1) to comparable IPv4. */
function normalizeIp(value: string): string {
  const mapped = value.trim().replace(/^::ffff:/i, '');
  return isIP(mapped) !== 0 ? mapped : '';
}

function isTrustedProxy(ip: string, trustedProxies: string[]): boolean {
  if (!ip || trustedProxies.length === 0) return false;
  return trustedProxies.some((entry) => {
    if (entry === ip) return true;
    if (!entry.includes('/')) return false;
    const [network, bitsRaw] = entry.split('/');
    const bits = Number(bitsRaw);
    if (!isIP(network) || !Number.isInteger(bits)) return false;
    return isInCidr(ip, network, bits);
  });
}

function isInCidr(ip: string, network: string, bits: number): boolean {
  const isV6 = isIP(ip) === 6;
  if (isIP(network) !== (isV6 ? 6 : 4)) return false;

  if (isV6) {
    const ipBytes = expandIPv6(ip);
    const netBytes = expandIPv6(network);
    if (!ipBytes || !netBytes) return false;
    const fullBytes = Math.floor(bits / 8);
    const remainder = bits % 8;
    for (let i = 0; i < fullBytes; i++) {
      if (ipBytes[i] !== netBytes[i]) return false;
    }
    if (remainder) {
      const mask = 0xff << (8 - remainder);
      if ((ipBytes[fullBytes] & mask) !== (netBytes[fullBytes] & mask))
        return false;
    }
    return true;
  }

  const toInt = (address: string) =>
    address.split('.').reduce((acc, part) => (acc << 8) | Number(part), 0) >>>
    0;
  const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0;
  return (toInt(ip) & mask) === (toInt(network) & mask);
}

function expandIPv6(address: string): Uint8Array | null {
  const parts = address.split('::');
  const leftGroups = parts[0] ? parts[0].split(':') : [];
  const rightGroups = parts.length > 1 && parts[1] ? parts[1].split(':') : [];
  const missing = 8 - leftGroups.length - rightGroups.length;
  if (
    parts.length > 1
      ? missing < 0
      : leftGroups.length + rightGroups.length !== 8
  )
    return null;
  const groups = [
    ...leftGroups,
    ...Array(Math.max(0, missing)).fill('0'),
    ...rightGroups,
  ];
  const bytes = new Uint8Array(16);
  for (let i = 0; i < 8; i++) {
    const value = parseInt(groups[i], 16);
    if (!Number.isInteger(value)) return null;
    bytes[i * 2] = value >> 8;
    bytes[i * 2 + 1] = value & 0xff;
  }
  return bytes;
}
