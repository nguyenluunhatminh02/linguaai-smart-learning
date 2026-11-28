import { ExecutionContext } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Reflector } from '@nestjs/core';
import { Test, TestingModule } from '@nestjs/testing';

import { RateLimiterService } from '../services/rate-limiter.service';
import { RateLimitGuard } from './rate-limit.guard';

const CONFIG = { limit: 5, window: 60, keyPrefix: 'test' };

const makeContext = (headers: Record<string, unknown>): ExecutionContext =>
  ({
    getHandler: () => 'handler',
    getClass: () => ({ name: 'TestController' }),
    getResponse: () => ({ setHeader: jest.fn() }),
    switchToHttp: () => ({
      getRequest: () => ({
        headers,
        body: { email: 'alice@example.com' },
        socket: { remoteAddress: '127.0.0.1' },
      }),
      getResponse: () => ({ setHeader: jest.fn() }),
    }),
  }) as any;

describe('RateLimitGuard SEC-07 body pre-check', () => {
  let guard: RateLimitGuard;
  let reflector: Reflector;
  let limiter: { checkRateLimit: jest.Mock };

  beforeEach(async () => {
    limiter = {
      checkRateLimit: jest.fn().mockResolvedValue({
        remaining: 4,
        resetAt: Math.floor(Date.now() / 1000) + 60,
        retryAfterSeconds: 60,
      }),
    };
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RateLimitGuard,
        { provide: Reflector, useValue: new Reflector() },
        { provide: RateLimiterService, useValue: limiter },
        { provide: ConfigService, useValue: { get: () => undefined } },
      ],
    }).compile();
    guard = module.get(RateLimitGuard);
    reflector = module.get(Reflector);
    jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(CONFIG);
  });

  it('rejects an oversized body before any Redis work', async () => {
    await expect(
      guard.canActivate(
        makeContext({ 'content-length': String(64 * 1024 + 1) }),
      ),
    ).rejects.toMatchObject({ status: 413 });
    expect(limiter.checkRateLimit).not.toHaveBeenCalled();
  });

  it('still consumes a rate-limit token for an ordinary body', async () => {
    await expect(
      guard.canActivate(makeContext({ 'content-length': '256' })),
    ).resolves.toBe(true);
    expect(limiter.checkRateLimit).toHaveBeenCalledTimes(1);
  });

  it('does not consult headers on routes without @RateLimit metadata', async () => {
    jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(undefined);
    await expect(
      guard.canActivate(makeContext({ 'content-length': '9999999' })),
    ).resolves.toBe(true);
    expect(limiter.checkRateLimit).not.toHaveBeenCalled();
  });

  it('passes through unknown/understated lengths to the parser-level limit', async () => {
    for (const value of ['not-a-number', '-5', '1024']) {
      await expect(
        guard.canActivate(makeContext({ 'content-length': value })),
      ).resolves.toBe(true);
    }
    expect(limiter.checkRateLimit).toHaveBeenCalledTimes(3);
  });
});
