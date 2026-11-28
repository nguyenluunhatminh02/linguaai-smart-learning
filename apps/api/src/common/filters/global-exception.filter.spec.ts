import { GlobalExceptionFilter } from './global-exception.filter';
import {
  ArgumentsHost,
  BadRequestException,
  ForbiddenException,
  HttpException,
  HttpStatus,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '../../generated/prisma';
import {
  ApiErrorCode,
  ApiErrorResponse,
  ApiErrors,
} from '../interceptors/transform.interceptor';
import { ProviderException } from '../../common/services/groq.service';

describe('GlobalExceptionFilter', () => {
  let filter: GlobalExceptionFilter;
  let mockJson: jest.Mock;
  let mockStatus: jest.Mock;
  let setHeader: jest.Mock;
  let getHeader: jest.Mock;
  let request: Record<string, unknown>;
  let warnSpy: jest.SpyInstance;
  let errorSpy: jest.SpyInstance;

  beforeEach(() => {
    filter = new GlobalExceptionFilter();
    mockJson = jest.fn();
    mockStatus = jest.fn().mockReturnValue({ json: mockJson });
    setHeader = jest.fn();
    getHeader = jest.fn().mockReturnValue(undefined);
    request = { url: '/test', method: 'GET', headers: {} };
    // Error branches log for every case; suppress the noise without changing
    // the filter's behaviour.
    warnSpy = jest
      .spyOn((filter as any).logger, 'warn')
      .mockImplementation(() => undefined);
    errorSpy = jest
      .spyOn((filter as any).logger, 'error')
      .mockImplementation(() => undefined);
  });

  afterEach(() => {
    warnSpy.mockRestore();
    errorSpy.mockRestore();
  });

  const createMockHost = (url = '/test'): ArgumentsHost => {
    request.url = url;
    return {
      switchToHttp: () => ({
        getResponse: () => ({ status: mockStatus, setHeader, getHeader }),
        getRequest: () => request,
      }),
    } as unknown as ArgumentsHost;
  };

  /** Assert the full documented response envelope and return it for extra checks. */
  const expectEnvelope = (
    status: number,
    message: string,
    errors: ApiErrors = null,
    path = '/test',
    code: ApiErrorCode = 'INTERNAL_ERROR',
    retryable = false,
  ): ApiErrorResponse => {
    expect(mockStatus).toHaveBeenCalledTimes(1);
    expect(mockStatus).toHaveBeenCalledWith(status);
    expect(mockJson).toHaveBeenCalledTimes(1);
    const body = mockJson.mock.calls[0][0] as ApiErrorResponse;
    expect(Object.keys(body).sort()).toEqual(
      [
        'code',
        'data',
        'errors',
        'message',
        'path',
        'requestId',
        'retryable',
        'success',
        'timestamp',
      ].sort(),
    );
    expect(body).toEqual({
      success: false,
      message,
      data: null,
      errors,
      timestamp: expect.any(String),
      path,
      code,
      retryable,
      requestId: expect.stringMatching(/^[A-Za-z0-9._-]{1,64}$/),
    });
    expect(Number.isNaN(Date.parse(body.timestamp))).toBe(false);
    return body;
  };

  /** Assert no provider fragment or secret survives into any response field. */
  const expectNoLeak = (body: unknown, secrets: string[]) => {
    const serialized = JSON.stringify(body);
    for (const secret of secrets) {
      expect(serialized).not.toContain(secret);
    }
  };

  const knownPrismaError = (
    code: string,
  ): Prisma.PrismaClientKnownRequestError =>
    new Prisma.PrismaClientKnownRequestError(`Prisma error ${code}`, {
      code,
      clientVersion: 'test',
    });

  /** Prisma's validation error has no public constructor; use the real class prototype. */
  const validationError = (): Prisma.PrismaClientValidationError => {
    const error = Object.create(
      Prisma.PrismaClientValidationError.prototype,
    ) as Prisma.PrismaClientValidationError;
    Object.defineProperty(error, 'message', { value: 'Invalid query' });
    return error;
  };

  it('should handle string HttpException with a fixed validation message', () => {
    const exception = new HttpException('Bad Request', HttpStatus.BAD_REQUEST);
    filter.catch(exception, createMockHost());
    expectEnvelope(
      HttpStatus.BAD_REQUEST,
      'The request could not be validated.',
      null,
      '/test',
      'VALIDATION_ERROR',
    );
    expect(warnSpy).toHaveBeenCalled();
  });

  it('should normalise array messages from object HttpExceptions into errors', () => {
    const exception = new BadRequestException([
      'email must be an email',
      'password is too short',
      { notAString: true },
    ] as any);
    filter.catch(exception, createMockHost('/validation'));
    expectEnvelope(
      HttpStatus.BAD_REQUEST,
      'The request could not be validated.',
      ['email must be an email', 'password is too short'],
      '/validation',
      'VALIDATION_ERROR',
    );
  });

  it('should prefer a dedicated errors payload over the message array', () => {
    const exception = new BadRequestException({
      message: ['first message'],
      errors: { email: ['invalid', 'required'], password: [] },
    });
    filter.catch(exception, createMockHost());
    expectEnvelope(
      HttpStatus.BAD_REQUEST,
      'The request could not be validated.',
      { email: ['invalid', 'required'] },
      '/test',
      'VALIDATION_ERROR',
    );
  });

  it('should ignore violations and non-string-array errors payloads', () => {
    const exception = new HttpException(
      {
        statusCode: 400,
        violations: [{ property: 'name' }],
        errors: 'not an array',
      },
      HttpStatus.BAD_REQUEST,
    );
    filter.catch(exception, createMockHost());
    expectEnvelope(
      HttpStatus.BAD_REQUEST,
      'The request could not be validated.',
      null,
      '/test',
      'VALIDATION_ERROR',
    );
  });

  it('should map an empty message array to a validation fallback', () => {
    const exception = new BadRequestException({ message: [] });
    filter.catch(exception, createMockHost());
    expectEnvelope(
      HttpStatus.BAD_REQUEST,
      'The request could not be validated.',
      null,
      '/test',
      'VALIDATION_ERROR',
    );
  });

  it('should never echo caller-supplied messages', () => {
    const exception = new NotFoundException({
      message: 'Missing',
      error: 'Not Found',
    });
    filter.catch(exception, createMockHost());
    const body = expectEnvelope(
      HttpStatus.NOT_FOUND,
      'The requested resource was not found.',
      null,
      '/test',
      'RESOURCE_NOT_FOUND',
    );
    expect(body.message).not.toContain('Missing');
  });

  it.each([
    [400, 'VALIDATION_ERROR', 'The request could not be validated.', false],
    [401, 'AUTHENTICATION_REQUIRED', 'Authentication is required.', false],
    [403, 'ACCESS_DENIED', 'Access to this resource is denied.', false],
    [404, 'RESOURCE_NOT_FOUND', 'The requested resource was not found.', false],
    [
      409,
      'OPERATION_CONFLICT',
      'The request conflicts with the current state of the resource.',
      false,
    ],
    [
      422,
      'OPERATION_CONFLICT',
      'The request conflicts with the current state of the resource.',
      false,
    ],
    [429, 'RATE_LIMITED', 'Too many requests. Please try again shortly.', true],
    [408, 'PROVIDER_TIMEOUT', 'The AI service did not respond in time.', true],
    [504, 'PROVIDER_TIMEOUT', 'The AI service did not respond in time.', true],
    [
      503,
      'PROVIDER_UNAVAILABLE',
      'The AI service is temporarily unavailable.',
      true,
    ],
    [418, 'INTERNAL_ERROR', 'Internal server error', false],
  ])('should map HTTP %s to %s', (status, code, message, retryable) => {
    filter.catch(new HttpException('SECRET', status), createMockHost());
    const body = expectEnvelope(
      status,
      message,
      null,
      '/test',
      code as ApiErrorCode,
      retryable,
    );
    expect(body.message).not.toContain('SECRET');
  });

  it('should honour an allowlisted code from an HttpException payload', () => {
    const exception = new ForbiddenException({
      code: 'INSUFFICIENT_CREDITS',
      message: 'SECRET provider message',
    });
    filter.catch(exception, createMockHost());
    const body = expectEnvelope(
      HttpStatus.FORBIDDEN,
      'Not enough credits to complete this request.',
      null,
      '/test',
      'INSUFFICIENT_CREDITS',
    );
    expect(body.message).not.toContain('SECRET');
  });

  it('should take the retry hint from the allowlisted code, not the payload flag', () => {
    const exception = new ForbiddenException({
      code: 'PROVIDER_TIMEOUT',
      message: 'SECRET provider message',
      retryable: false,
    });
    filter.catch(exception, createMockHost());
    const body = expectEnvelope(
      HttpStatus.FORBIDDEN,
      'The AI service did not respond in time.',
      null,
      '/test',
      'PROVIDER_TIMEOUT',
      true,
    );
    expectNoLeak(body, ['SECRET']);
    mockStatus.mockClear();
    mockJson.mockClear();
    const retrySpoof = new HttpException(
      { code: 'VALIDATION_ERROR', message: 'SECRET', retryable: true },
      HttpStatus.BAD_REQUEST,
    );
    filter.catch(retrySpoof, createMockHost());
    expectEnvelope(
      HttpStatus.BAD_REQUEST,
      'The request could not be validated.',
      null,
      '/test',
      'VALIDATION_ERROR',
      false,
    );
  });

  it('should keep ProviderException details and retry flags out of the HTTP envelope', () => {
    const secret = 'sk-live-provider-secret';
    const exception = new ProviderException({
      code: 'PROVIDER_TIMEOUT',
      message: secret,
      retryable: true,
      aborted: false,
      statusCode: HttpStatus.GATEWAY_TIMEOUT,
    });
    filter.catch(exception, createMockHost('/chat/send'));
    const body = expectEnvelope(
      HttpStatus.GATEWAY_TIMEOUT,
      'The AI service did not respond in time.',
      null,
      '/chat/send',
      'PROVIDER_TIMEOUT',
      true,
    );
    expect(exception.getPayload().retryable).toBe(true);
    expectNoLeak(body, [secret]);
  });

  it('should cap and sanitize validation errors', () => {
    const exception = new BadRequestException({
      message: ['first message'],
      errors: {
        fieldA: ['x'.repeat(250), 'second\nmessage', 'third', { secret: true }],
        fieldB: Array.from({ length: 25 }, (_, i) => `item-${i}`),
        fieldC: ['keep'],
        secret: 'not an array',
      },
    });
    filter.catch(exception, createMockHost());
    expectEnvelope(
      HttpStatus.BAD_REQUEST,
      'The request could not be validated.',
      expect.any(Object),
      '/test',
      'VALIDATION_ERROR',
    );
    expect(mockJson.mock.calls[0][0].errors).toEqual({
      fieldA: ['x'.repeat(200), 'second message', 'third'],
      fieldB: Array.from({ length: 20 }, (_, i) => `item-${i}`),
      fieldC: ['keep'],
    });
  });

  it('should omit errors entirely from non-400 responses', () => {
    const exception = new HttpException(
      { message: 'SECRET', errors: { email: ['invalid'] } },
      HttpStatus.CONFLICT,
    );
    filter.catch(exception, createMockHost());
    expectEnvelope(
      HttpStatus.CONFLICT,
      'The request conflicts with the current state of the resource.',
      null,
      '/test',
      'OPERATION_CONFLICT',
    );
  });

  it('should reflect a validated requestId and never trust a raw header', () => {
    request = {
      url: '/test',
      method: 'GET',
      headers: { 'x-request-id': 'attacker\nsecret' },
      requestId: 'req-123',
    };
    filter.catch(new Error('SECRET'), createMockHost());
    const body = expectEnvelope(
      HttpStatus.INTERNAL_SERVER_ERROR,
      'Internal server error',
    );
    expect(body.requestId).toBe('req-123');
    expect(setHeader).toHaveBeenCalledWith('X-Request-ID', 'req-123');
    expectNoLeak(body, ['attacker']);
  });

  it('should generate a UUID requestId when middleware did not set one', () => {
    filter.catch(new Error('SECRET'), createMockHost());
    const body = expectEnvelope(
      HttpStatus.INTERNAL_SERVER_ERROR,
      'Internal server error',
    );
    expect(body.requestId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
    );
    expect(setHeader).toHaveBeenCalledWith('X-Request-ID', body.requestId);
  });

  it('should reject an unvalidated requestId on the request object', () => {
    request = {
      url: '/test',
      method: 'GET',
      headers: { 'x-request-id': 'bad\nid' },
      requestId: 'bad\nid',
    };
    filter.catch(new Error('SECRET'), createMockHost());
    const body = expectEnvelope(
      HttpStatus.INTERNAL_SERVER_ERROR,
      'Internal server error',
    );
    expect(body.requestId).not.toContain('\n');
    expectNoLeak(body, ['bad\\nid']);
  });

  it('should strip query strings from path and log', () => {
    request = {
      path: '/api/secure',
      url: '/api/secure?token=SECRET&email=a@b.c',
    };
    filter.catch(new Error('SECRET'), createMockHost());
    const body = expectEnvelope(
      HttpStatus.INTERNAL_SERVER_ERROR,
      'Internal server error',
      null,
      '/api/secure',
    );
    expectNoLeak(body, ['SECRET']);
    expect(errorSpy.mock.calls[0][0]).not.toContain('token=SECRET');
  });

  it('should not leak arbitrary exception fields to the client', () => {
    const exception = new HttpException(
      {
        statusCode: 400,
        detail: 'postgres://user:SECRET@db:5432/app',
        message: ['Validation failed'],
        extra: 'SECRET',
      },
      HttpStatus.BAD_REQUEST,
    );
    filter.catch(exception, createMockHost());
    const body = expectEnvelope(
      HttpStatus.BAD_REQUEST,
      'The request could not be validated.',
      ['Validation failed'],
      '/test',
      'VALIDATION_ERROR',
    );
    expectNoLeak(body, ['SECRET']);
    expect(body.errors).not.toHaveProperty('detail');
  });

  it('should log requestId and code alongside operator detail', () => {
    request = {
      path: '/api/secure',
      url: '/api/secure?token=SECRET',
      requestId: 'req-123',
    };
    filter.catch(
      new Error('SECRET database connection string'),
      createMockHost(),
    );
    expectEnvelope(
      HttpStatus.INTERNAL_SERVER_ERROR,
      'Internal server error',
      null,
      '/api/secure',
    );
    const calls = errorSpy.mock.calls;
    expect(calls.length).toBeGreaterThan(0);
    const log = JSON.parse(calls[0][0]);
    expect(log).toEqual(
      expect.objectContaining({
        requestId: 'req-123',
        code: 'INTERNAL_ERROR',
        status: HttpStatus.INTERNAL_SERVER_ERROR,
        detail: 'SECRET database connection string',
        path: '/api/secure',
      }),
    );
    expect(calls[0][0]).not.toContain('token=SECRET');
  });

  it.each([
    ['P2002', HttpStatus.CONFLICT, 'OPERATION_CONFLICT', false],
    ['P2025', HttpStatus.NOT_FOUND, 'RESOURCE_NOT_FOUND', false],
    ['P2003', HttpStatus.BAD_REQUEST, 'VALIDATION_ERROR', false],
    ['P2014', HttpStatus.BAD_REQUEST, 'VALIDATION_ERROR', false],
    ['P2020', HttpStatus.BAD_REQUEST, 'VALIDATION_ERROR', false],
    ['P2034', HttpStatus.INTERNAL_SERVER_ERROR, 'OPERATION_CONFLICT', false],
    ['P2021', HttpStatus.INTERNAL_SERVER_ERROR, 'INTERNAL_ERROR', false],
    ['P2022', HttpStatus.INTERNAL_SERVER_ERROR, 'INTERNAL_ERROR', false],
    ['P9999', HttpStatus.INTERNAL_SERVER_ERROR, 'INTERNAL_ERROR', false],
  ])(
    'should map Prisma %s to status %s with code %s',
    (code, status, errorCode, retryable) => {
      const exception = knownPrismaError(code);
      expect(exception).toBeInstanceOf(Prisma.PrismaClientKnownRequestError);
      filter.catch(exception, createMockHost());
      const body = expectEnvelope(
        status as number,
        expect.any(String) as string,
        null,
        '/test',
        errorCode as ApiErrorCode,
        retryable,
      );
      expect(body.message).not.toContain(`Prisma error ${code}`);
      const logSpy = status >= 500 ? errorSpy : warnSpy;
      expect(logSpy.mock.calls[0][0]).toContain(`[${code}]`);
    },
  );

  it('should still map known Prisma errors when a subclass is thrown', () => {
    class FakePrismaError extends Prisma.PrismaClientKnownRequestError {}
    const exception = new FakePrismaError('subclass', {
      code: 'P2002',
      clientVersion: 'test',
    });
    filter.catch(exception, createMockHost());
    expectEnvelope(
      HttpStatus.CONFLICT,
      'The request conflicts with the current state of the resource.',
      null,
      '/test',
      'OPERATION_CONFLICT',
    );
  });

  it('should map PrismaInitializationError to 503', () => {
    const exception = Object.create(
      Prisma.PrismaClientInitializationError.prototype,
    ) as Prisma.PrismaClientInitializationError;
    Object.defineProperty(exception, 'message', { value: 'DB down' });
    filter.catch(exception, createMockHost());
    const body = expectEnvelope(
      HttpStatus.SERVICE_UNAVAILABLE,
      'The database is temporarily unavailable.',
      null,
      '/test',
      'DATABASE_UNAVAILABLE',
      true,
    );
    expect(body.message).not.toContain('DB down');
  });

  it('should map PrismaValidationError to 400', () => {
    const exception = validationError();
    expect(exception).toBeInstanceOf(Prisma.PrismaClientValidationError);
    filter.catch(exception, createMockHost());
    const body = expectEnvelope(
      HttpStatus.BAD_REQUEST,
      'The request could not be validated.',
      null,
      '/test',
      'VALIDATION_ERROR',
    );
    expect(body.message).not.toContain('Invalid query');
  });

  it('should handle unknown exceptions with 500 without leaking internals', () => {
    const exception = new Error('SECRET database connection string');
    filter.catch(exception, createMockHost());
    const body = expectEnvelope(
      HttpStatus.INTERNAL_SERVER_ERROR,
      'Internal server error',
    );
    expectNoLeak(body, ['SECRET']);
    expect(errorSpy).toHaveBeenCalledWith(expect.any(String), exception.stack);
  });

  it.each([undefined, null, 'boom', 42, { secret: 'value' }, 10n])(
    'should handle non-Error throw %p with 500',
    (thrown) => {
      filter.catch(thrown, createMockHost());
      const body = expectEnvelope(
        HttpStatus.INTERNAL_SERVER_ERROR,
        'Internal server error',
      );
      expectNoLeak(body, ['secret']);
      expect(body.code).toBe('INTERNAL_ERROR');
      expect(errorSpy).toHaveBeenCalledWith(
        expect.stringContaining('Unknown exception:'),
      );
    },
  );
});
