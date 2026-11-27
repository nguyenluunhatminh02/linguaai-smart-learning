import { GlobalExceptionFilter } from './global-exception.filter';
import { ArgumentsHost, BadRequestException, HttpException, HttpStatus, NotFoundException } from '@nestjs/common';
import { Prisma } from '../../generated/prisma';
import { ApiErrors } from '../interceptors/transform.interceptor';

describe('GlobalExceptionFilter', () => {
  let filter: GlobalExceptionFilter;
  let mockJson: jest.Mock;
  let mockStatus: jest.Mock;
  let warnSpy: jest.SpyInstance;
  let errorSpy: jest.SpyInstance;

  beforeEach(() => {
    filter = new GlobalExceptionFilter();
    mockJson = jest.fn();
    mockStatus = jest.fn().mockReturnValue({ json: mockJson });
    // Error branches log for every case; suppress the noise without changing
    // the filter's behaviour.
    warnSpy = jest.spyOn((filter as any).logger, 'warn').mockImplementation(() => undefined);
    errorSpy = jest.spyOn((filter as any).logger, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => {
    warnSpy.mockRestore();
    errorSpy.mockRestore();
  });

  const createMockHost = (url = '/test'): ArgumentsHost =>
    ({
      switchToHttp: () => ({
        getResponse: () => ({ status: mockStatus }),
        getRequest: () => ({ url, method: 'GET' }),
      }),
    }) as unknown as ArgumentsHost;

  /** Assert the full documented response envelope and return it for extra checks. */
  const expectEnvelope = (
    status: number,
    message: string,
    errors: ApiErrors = null,
    path = '/test',
  ) => {
    expect(mockStatus).toHaveBeenCalledTimes(1);
    expect(mockStatus).toHaveBeenCalledWith(status);
    expect(mockJson).toHaveBeenCalledTimes(1);
    const body = mockJson.mock.calls[0][0];
    expect(Object.keys(body).sort()).toEqual(
      ['data', 'errors', 'message', 'path', 'success', 'timestamp'].sort(),
    );
    expect(body).toEqual({
      success: false,
      message,
      data: null,
      errors,
      timestamp: expect.any(String),
      path,
    });
    expect(Number.isNaN(Date.parse(body.timestamp))).toBe(false);
    return body;
  };

  const knownPrismaError = (code: string): Prisma.PrismaClientKnownRequestError =>
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

  it('should handle string HttpException', () => {
    const exception = new HttpException('Bad Request', HttpStatus.BAD_REQUEST);
    filter.catch(exception, createMockHost());
    expectEnvelope(HttpStatus.BAD_REQUEST, 'Bad Request');
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
      'email must be an email',
      ['email must be an email', 'password is too short'],
      '/validation',
    );
  });

  it('should prefer a dedicated errors payload over the message array', () => {
    const exception = new BadRequestException({
      message: ['first message'],
      errors: { email: ['invalid', 'required'], password: [] },
    });
    filter.catch(exception, createMockHost());
    expectEnvelope(HttpStatus.BAD_REQUEST, 'first message', {
      email: ['invalid', 'required'],
    });
  });

  it('should ignore violations and non-string-array errors payloads', () => {
    const exception = new HttpException(
      { statusCode: 400, violations: [{ property: 'name' }], errors: 'not an array' },
      HttpStatus.BAD_REQUEST,
    );
    filter.catch(exception, createMockHost());
    expectEnvelope(HttpStatus.BAD_REQUEST, 'Internal server error');
  });

  it('should map an empty message array to a validation fallback', () => {
    const exception = new BadRequestException({ message: [] });
    filter.catch(exception, createMockHost());
    expectEnvelope(HttpStatus.BAD_REQUEST, 'Validation failed');
  });

  it('should use the string message from an object HttpException', () => {
    const exception = new NotFoundException({ message: 'Missing', error: 'Not Found' });
    filter.catch(exception, createMockHost());
    expectEnvelope(HttpStatus.NOT_FOUND, 'Missing');
  });

  it.each([
    ['P2002', HttpStatus.CONFLICT, 'A resource with this identifier already exists'],
    ['P2025', HttpStatus.NOT_FOUND, 'The requested resource was not found'],
    ['P2003', HttpStatus.BAD_REQUEST, 'Invalid request: related record is missing or invalid'],
    ['P2014', HttpStatus.BAD_REQUEST, 'Invalid request: related record is missing or invalid'],
    ['P2020', HttpStatus.BAD_REQUEST, 'Invalid request: related record is missing or invalid'],
    // Everything else is an infrastructure failure, never a client conflict.
    ['P2021', HttpStatus.INTERNAL_SERVER_ERROR, 'Internal server error'],
    ['P2022', HttpStatus.INTERNAL_SERVER_ERROR, 'Internal server error'],
    ['P2034', HttpStatus.INTERNAL_SERVER_ERROR, 'Internal server error'],
    ['P9999', HttpStatus.INTERNAL_SERVER_ERROR, 'Internal server error'],
  ])('should map Prisma %s to %s', (code, status, message) => {
    const exception = knownPrismaError(code as string);
    // instanceof must hold for the mapping to run at all.
    expect(exception).toBeInstanceOf(Prisma.PrismaClientKnownRequestError);
    filter.catch(exception, createMockHost());
    const body = expectEnvelope(status as number, message as string);
    expect(body.message).not.toContain(`Prisma error ${code}`);
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining(`[${code}]`));
  });

  it('should still map known Prisma errors when a subclass is thrown', () => {
    class FakePrismaError extends Prisma.PrismaClientKnownRequestError {}
    const exception = new FakePrismaError('subclass', {
      code: 'P2002',
      clientVersion: 'test',
    });
    filter.catch(exception, createMockHost());
    expectEnvelope(HttpStatus.CONFLICT, 'A resource with this identifier already exists');
  });

  it('should map PrismaInitializationError to 503', () => {
    const exception = Object.create(
      Prisma.PrismaClientInitializationError.prototype,
    ) as Prisma.PrismaClientInitializationError;
    Object.defineProperty(exception, 'message', { value: 'DB down' });
    filter.catch(exception, createMockHost());
    const body = expectEnvelope(
      HttpStatus.SERVICE_UNAVAILABLE,
      'Database service unavailable',
    );
    expect(body.message).not.toContain('DB down');
  });

  it('should map PrismaValidationError to 400', () => {
    const exception = validationError();
    expect(exception).toBeInstanceOf(Prisma.PrismaClientValidationError);
    filter.catch(exception, createMockHost());
    const body = expectEnvelope(HttpStatus.BAD_REQUEST, 'Database validation failed');
    expect(body.message).not.toContain('Invalid query');
  });

  it('should handle unknown exceptions with 500 without leaking internals', () => {
    const exception = new Error('SECRET database connection string');
    filter.catch(exception, createMockHost());
    const body = expectEnvelope(HttpStatus.INTERNAL_SERVER_ERROR, 'Internal server error');
    expect(body.message).not.toContain('SECRET');
    expect(errorSpy).toHaveBeenCalledWith(exception.message, exception.stack);
  });

  it.each([undefined, null, 'boom', 42, { secret: 'value' }, 10n])(
    'should handle non-Error throw %p with 500',
    (thrown) => {
      filter.catch(thrown, createMockHost());
      const body = expectEnvelope(HttpStatus.INTERNAL_SERVER_ERROR, 'Internal server error');
      expect(body.message).not.toContain('secret');
      expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('Unknown exception:'));
    },
  );
});
