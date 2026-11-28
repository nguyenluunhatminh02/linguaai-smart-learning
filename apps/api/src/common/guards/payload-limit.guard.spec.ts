import { ExecutionContext, PayloadTooLargeException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Test, TestingModule } from '@nestjs/testing';

import { PAYLOAD_LIMIT_KEY } from '../decorators/payload-limit.decorator';
import { PayloadLimitGuard } from './payload-limit.guard';

const makeContext = (headers: Record<string, unknown>): ExecutionContext =>
  ({
    getHandler: () => 'handler',
    getClass: () => ({ name: 'TestController' }),
    switchToHttp: () => ({ getRequest: () => ({ headers }) }),
  } as any);

describe('PayloadLimitGuard', () => {
  let guard: PayloadLimitGuard;
  let reflector: Reflector;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [PayloadLimitGuard, { provide: Reflector, useValue: new Reflector() }],
    }).compile();
    guard = module.get(PayloadLimitGuard);
    reflector = module.get(Reflector);
  });

  const setLimit = (value: unknown) =>
    jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(value);

  it('rejects a declared size over the limit with 413', () => {
    setLimit({ bytes: 1024 });
    expect(() => guard.canActivate(makeContext({ 'content-length': '1025' }))).toThrow(
      PayloadTooLargeException,
    );
    try {
      guard.canActivate(makeContext({ 'content-length': '1025' }));
    } catch (error) {
      expect((error as PayloadTooLargeException).getStatus()).toBe(413);
    }
  });

  it('accepts a body at the boundary and one below it', () => {
    setLimit({ bytes: 1024 });
    expect(guard.canActivate(makeContext({ 'content-length': '1024' }))).toBe(true);
    expect(guard.canActivate(makeContext({ 'content-length': '512' }))).toBe(true);
  });

  it('lets through missing, chunked (absent), and invalid Content-Length values', () => {
    setLimit({ bytes: 1024 });
    expect(guard.canActivate(makeContext({}))).toBe(true);
    expect(
      guard.canActivate(makeContext({ 'content-length': 'not-a-number' })),
    ).toBe(true);
    expect(guard.canActivate(makeContext({ 'content-length': '-1' }))).toBe(true);
    expect(
      guard.canActivate(makeContext({ 'content-length': '9999999999999999999999' })),
    ).toBe(true);
    expect(guard.canActivate(makeContext({ 'content-length': ['1', '2'] }))).toBe(true);
  });

  it('does not reject anything without decorator metadata', () => {
    setLimit(undefined);
    expect(() => guard.canActivate(makeContext({ 'content-length': '10000000' }))).not.toThrow();
  });

  it('ignores an invalid configured limit instead of failing closed on misconfiguration', () => {
    setLimit({ bytes: 0 });
    expect(guard.canActivate(makeContext({ 'content-length': '10000000' }))).toBe(true);
    setLimit({ bytes: Number.MAX_SAFE_INTEGER });
    expect(guard.canActivate(makeContext({ 'content-length': '10000000' }))).toBe(true);
  });

  it('reads the decorator metadata key used by @PayloadLimit()', () => {
    const spy = setLimit({ bytes: 100 });
    guard.canActivate(makeContext({ 'content-length': '99' }));
    expect(spy).toHaveBeenCalledWith(
      PAYLOAD_LIMIT_KEY,
      expect.any(Array),
    );
  });
});
