import { HttpException, HttpStatus } from '@nestjs/common';
import { NextFunction, Request, Response } from 'express';
import { RateLimitMiddleware } from './rate-limit.middleware';

function makeRequest(overrides: Record<string, unknown> = {}): Request {
  return {
    socket: { remoteAddress: '10.0.0.7' },
    ip: '10.0.0.7',
    method: 'POST',
    path: '/api/chat',
    headers: {},
    ...overrides,
  } as unknown as Request;
}

function makeResponse() {
  const headers: Record<string, unknown> = {};
  return {
    headers,
    res: {
      setHeader: jest.fn((name: string, value: unknown) => {
        headers[name] = value;
      }),
    } as unknown as Response,
  };
}

describe('RateLimitMiddleware', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env.RATE_LIMIT_WINDOW_MS = '60000';
    process.env.RATE_LIMIT_MAX_REQUESTS = '100';
    delete process.env.TRUST_PROXY_IPS;
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  it('calls next() and exposes epoch-second reset headers on success', async () => {
    const checkRateLimit = jest.fn().mockResolvedValue({
      success: true,
      remaining: 99,
      resetTime: new Date(1_700_000_060_000),
      limit: 100,
      resetAt: 1_700_000_060,
      retryAfterSeconds: 60,
    });
    const { res, headers } = makeResponse();
    const next = jest.fn() as NextFunction;
    const middleware = new RateLimitMiddleware({ checkRateLimit } as any);

    await middleware.use(makeRequest(), res, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(next).toHaveBeenCalledWith();
    expect(headers['X-RateLimit-Limit']).toBe(100);
    expect(headers['X-RateLimit-Remaining']).toBe(99);
    expect(headers['X-RateLimit-Reset']).toBe(1_700_000_060);
    expect(checkRateLimit).toHaveBeenCalledWith(
      expect.stringContaining('10.0.0.7:POST:/api/chat'),
      expect.objectContaining({ limit: 100, window: 60, keyPrefix: 'general' }),
    );
  });

  it('forwards a 429 via next(error) with Retry-After and never calls next()', async () => {
    const error = new HttpException(
      {
        message: 'Too many requests',
        remaining: 0,
        limit: 100,
        resetAt: 1_700_000_055,
        retryAfterSeconds: 55,
        resetTime: new Date(1_700_000_055_000).toISOString(),
      },
      HttpStatus.TOO_MANY_REQUESTS,
    );
    const checkRateLimit = jest.fn().mockRejectedValue(error);
    const { res, headers } = makeResponse();
    const next = jest.fn() as NextFunction;
    const middleware = new RateLimitMiddleware({ checkRateLimit } as any);

    await middleware.use(makeRequest(), res, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(next).toHaveBeenCalledWith(error);
    expect(headers['Retry-After']).toBe('55');
    expect(headers['X-RateLimit-Reset']).toBe(1_700_000_055);
    expect(headers['X-RateLimit-Remaining']).toBe(0);
  });

  it('forwards a limiter outage (503) via next(error) and blocks the request', async () => {
    const error = new HttpException(
      {
        message: 'Rate limiting is temporarily unavailable. Please try again shortly.',
        limit: 100,
        resetAt: 1_700_000_060,
        retryAfterSeconds: 60,
        resetTime: new Date(1_700_000_060_000).toISOString(),
      },
      HttpStatus.SERVICE_UNAVAILABLE,
    );
    const checkRateLimit = jest.fn().mockRejectedValue(error);
    const { res, headers } = makeResponse();
    const next = jest.fn() as NextFunction;
    const middleware = new RateLimitMiddleware({ checkRateLimit } as any);

    await middleware.use(makeRequest(), res, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(next).toHaveBeenCalledWith(error);
    expect(headers['Retry-After']).toBe('60');
    expect(headers['X-RateLimit-Remaining']).toBe(0);
  });

  it('does not trust forwarded headers unless the peer is a configured proxy', async () => {
    const checkRateLimit = jest.fn().mockResolvedValue({
      success: true,
      remaining: 99,
      limit: 100,
      resetAt: 1_700_000_060,
      retryAfterSeconds: 60,
      resetTime: new Date(1_700_000_060_000),
    });
    const middleware = new RateLimitMiddleware({ checkRateLimit } as any);
    const request = makeRequest({
      socket: { remoteAddress: '10.0.0.1' },
      headers: { 'x-forwarded-for': '1.2.3.4, 10.0.0.1' },
    });
    const { res } = makeResponse();
    const next = jest.fn() as NextFunction;

    await middleware.use(request, res, next);
    expect(checkRateLimit.mock.calls[0][0]).toContain('10.0.0.1:POST:/api/chat');

    process.env.TRUST_PROXY_IPS = '10.0.0.1';
    const trusting = new RateLimitMiddleware({ checkRateLimit } as any);
    await trusting.use(request, res, next);
    expect(checkRateLimit.mock.calls[1][0]).toContain('1.2.3.4:POST:/api/chat');
  });
});
