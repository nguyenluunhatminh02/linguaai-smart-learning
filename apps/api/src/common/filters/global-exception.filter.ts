import {
  ExceptionFilter,
  Catch,
  ArgumentsHost,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Request, Response } from 'express';
import { randomUUID } from 'crypto';
import { inspect } from 'util';
import { DateUtil } from '../utils/date.util';
import { Prisma } from '../../generated/prisma';
import type {
  ApiErrorResponse,
  ApiErrorCode,
  ApiErrors,
} from '../interceptors/transform.interceptor';

interface CodeDescriptor {
  code: ApiErrorCode;
  message: string;
  retryable: boolean;
}

/** Single source of truth for client-visible code, message and retry hint. */
const ERROR_CATALOG: Readonly<Record<ApiErrorCode, CodeDescriptor>> = {
  VALIDATION_ERROR: {
    code: 'VALIDATION_ERROR',
    message: 'The request could not be validated.',
    retryable: false,
  },
  AUTHENTICATION_REQUIRED: {
    code: 'AUTHENTICATION_REQUIRED',
    message: 'Authentication is required.',
    retryable: false,
  },
  ACCESS_DENIED: {
    code: 'ACCESS_DENIED',
    message: 'Access to this resource is denied.',
    retryable: false,
  },
  RESOURCE_NOT_FOUND: {
    code: 'RESOURCE_NOT_FOUND',
    message: 'The requested resource was not found.',
    retryable: false,
  },
  OPERATION_CONFLICT: {
    code: 'OPERATION_CONFLICT',
    message: 'The request conflicts with the current state of the resource.',
    retryable: false,
  },
  RATE_LIMITED: {
    code: 'RATE_LIMITED',
    message: 'Too many requests. Please try again shortly.',
    retryable: true,
  },
  PROVIDER_TIMEOUT: {
    code: 'PROVIDER_TIMEOUT',
    message: 'The AI service did not respond in time.',
    retryable: true,
  },
  PROVIDER_UNAVAILABLE: {
    code: 'PROVIDER_UNAVAILABLE',
    message: 'The AI service is temporarily unavailable.',
    retryable: true,
  },
  DATABASE_UNAVAILABLE: {
    code: 'DATABASE_UNAVAILABLE',
    message: 'The database is temporarily unavailable.',
    retryable: true,
  },
  INSUFFICIENT_CREDITS: {
    code: 'INSUFFICIENT_CREDITS',
    message: 'Not enough credits to complete this request.',
    retryable: false,
  },
  INTERNAL_ERROR: {
    code: 'INTERNAL_ERROR',
    message: 'Internal server error',
    retryable: false,
  },
};

/** Exposed codes must be known; only catalog entries set the retry hint. */
const CODE_SET = new Set<string>(Object.keys(ERROR_CATALOG));

const STATUS_CODES: Readonly<Record<number, ApiErrorCode>> = {
  400: 'VALIDATION_ERROR',
  401: 'AUTHENTICATION_REQUIRED',
  403: 'ACCESS_DENIED',
  404: 'RESOURCE_NOT_FOUND',
  408: 'PROVIDER_TIMEOUT',
  409: 'OPERATION_CONFLICT',
  422: 'OPERATION_CONFLICT',
  429: 'RATE_LIMITED',
  503: 'PROVIDER_UNAVAILABLE',
  504: 'PROVIDER_TIMEOUT',
};

/**
 * Prisma known-request codes that stem from invalid user input.
 * Everything not listed here is an infrastructure/engine problem and must
 * fail closed with 500 rather than being reported as a client conflict.
 */
const PRISMA_BAD_REQUEST_CODES = new Set(['P2003', 'P2014', 'P2020']);
const PRISMA_CONFLICT_CODES = new Set(['P2034']);

const MAX_ERROR_FIELDS = 20;
const MAX_ERROR_ITEMS = 20;
const MAX_ERROR_LENGTH = 200;

/** Strip control characters that could forge log lines or JSON structure. */
function sanitizeErrorText(value: string): string {
  // eslint-disable-next-line no-control-regex
  return value
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .slice(0, MAX_ERROR_LENGTH);
}

/** Normalise an exception payload to the documented ApiErrors contract. */
function toApiErrors(value: unknown): ApiErrors {
  if (Array.isArray(value)) {
    const strings: string[] = [];
    for (const item of value) {
      if (typeof item === 'string' && strings.length < MAX_ERROR_ITEMS) {
        strings.push(sanitizeErrorText(item));
      }
    }
    return strings.length ? strings : null;
  }
  if (value && typeof value === 'object') {
    // Record<string, string[]> is part of ApiErrors, but only keep entries
    // whose values are string arrays so no arbitrary thrown shape leaks out.
    const result: Record<string, string[]> = {};
    for (const [key, item] of Object.entries(value)) {
      if (Object.keys(result).length >= MAX_ERROR_FIELDS) break;
      if (Array.isArray(item)) {
        const strings: string[] = [];
        for (const part of item) {
          if (typeof part === 'string' && strings.length < MAX_ERROR_ITEMS) {
            strings.push(sanitizeErrorText(part));
          }
        }
        if (strings.length) result[sanitizeErrorText(key)] = strings;
      }
    }
    return Object.keys(result).length ? result : null;
  }
  return null;
}

/** Reuse only validated request IDs; anything else becomes a fresh UUID. */
function resolveRequestId(request: Request): string {
  const requestId = (request as Request & { requestId?: unknown }).requestId;
  return typeof requestId === 'string' &&
    /^[A-Za-z0-9._-]{1,64}$/.test(requestId)
    ? requestId
    : randomUUID();
}

/** Strip user-controlled query strings before putting a path in a response or log. */
function safePath(request: Request): string {
  const raw = request.path ?? request.url.split('?')[0];
  return raw.replace(/[\u0000-\u001f\u007f]/g, '?');
}

@Catch()
export class GlobalExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(GlobalExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();
    const path = safePath(request);
    const requestId = resolveRequestId(request);

    let status = HttpStatus.INTERNAL_SERVER_ERROR;
    let descriptor = ERROR_CATALOG.INTERNAL_ERROR;
    let errors: ApiErrors = null;
    let detail = '';
    let stack: string | undefined;

    if (exception instanceof HttpException) {
      status = exception.getStatus();
      const exceptionResponse = exception.getResponse();
      let explicitCode: string | undefined;

      const payload = (
        exception as HttpException & {
          getPayload?: () => Record<string, unknown>;
        }
      ).getPayload?.();
      if (typeof exceptionResponse === 'string') {
        detail = exceptionResponse;
      } else if (exceptionResponse && typeof exceptionResponse === 'object') {
        const resp = exceptionResponse as Record<string, unknown>;
        // Only a known, allowlisted code can refine the mapping (e.g. 403
        // with INSUFFICIENT_CREDITS); messages and unknown codes are ignored.
        if (typeof resp.code === 'string' && CODE_SET.has(resp.code)) {
          explicitCode = resp.code;
        } else if (
          payload &&
          typeof payload.code === 'string' &&
          CODE_SET.has(payload.code)
        ) {
          explicitCode = payload.code;
        }
        detail =
          typeof resp.message === 'string'
            ? resp.message
            : Array.isArray(resp.message) && typeof resp.message[0] === 'string'
              ? resp.message[0]
              : JSON.stringify(exceptionResponse);
        // Documented precedence: a dedicated `errors` payload wins over the
        // message array; both are normalised to ApiErrors. No `violations`
        // branch: NestJS does not emit that field.
        errors = toApiErrors(resp.errors) ?? toApiErrors(resp.message);
      }

      const mappedCode: ApiErrorCode = STATUS_CODES[status] ?? 'INTERNAL_ERROR';
      const selectedCode: ApiErrorCode = explicitCode
        ? (explicitCode as ApiErrorCode)
        : mappedCode;
      // The catalog alone decides the advisory retry hint; a payload
      // `retryable` flag is never trusted.
      descriptor = ERROR_CATALOG[selectedCode];
    } else if (exception instanceof Prisma.PrismaClientKnownRequestError) {
      detail = `[${exception.code}] Prisma Error: ${exception.message}`;
      if (exception.code === 'P2002') {
        status = HttpStatus.CONFLICT;
        descriptor = ERROR_CATALOG.OPERATION_CONFLICT;
      } else if (exception.code === 'P2025') {
        status = HttpStatus.NOT_FOUND;
        descriptor = ERROR_CATALOG.RESOURCE_NOT_FOUND;
      } else if (PRISMA_BAD_REQUEST_CODES.has(exception.code)) {
        status = HttpStatus.BAD_REQUEST;
        descriptor = ERROR_CATALOG.VALIDATION_ERROR;
      } else if (PRISMA_CONFLICT_CODES.has(exception.code)) {
        // Advisory retry hint only; keep the current 500 status so clients do
        // not depend on a new write-conflict status. Retries must reuse the
        // same Idempotency-Key.
        descriptor = ERROR_CATALOG.OPERATION_CONFLICT;
      } else {
        // P2021/P2022 and any future code: engine/schema failure. Fail closed
        // with a generic 500; details stay in the server log.
        status = HttpStatus.INTERNAL_SERVER_ERROR;
        descriptor = ERROR_CATALOG.INTERNAL_ERROR;
      }
    } else if (exception instanceof Prisma.PrismaClientInitializationError) {
      detail = `Prisma Init Error: ${exception.message}`;
      status = HttpStatus.SERVICE_UNAVAILABLE;
      descriptor = ERROR_CATALOG.DATABASE_UNAVAILABLE;
    } else if (exception instanceof Prisma.PrismaClientValidationError) {
      detail = `Prisma Validation: ${exception.message}`;
      status = HttpStatus.BAD_REQUEST;
      descriptor = ERROR_CATALOG.VALIDATION_ERROR;
    } else if (exception instanceof Error) {
      detail = exception.message;
      stack = exception.stack;
    } else {
      // inspect() is safe for every value, including undefined, symbols and
      // BigInt (JSON.stringify throws on BigInt).
      detail = `Unknown exception: ${inspect(exception)}`;
    }

    // `errors` carries user-input validation detail only; never echo arbitrary
    // fields from an exception payload to the client.
    if (status !== HttpStatus.BAD_REQUEST) errors = null;

    const { code, message, retryable } = descriptor;
    const logMessage = JSON.stringify({
      requestId,
      code,
      status,
      detail,
      method: request.method,
      path,
    });
    if (status >= 500) {
      if (stack) this.logger.error(logMessage, stack);
      else this.logger.error(logMessage);
    } else if (status >= 400) {
      this.logger.warn(logMessage);
    }

    if (
      typeof response.setHeader === 'function' &&
      typeof response.getHeader === 'function' &&
      !response.getHeader('X-Request-ID')
    ) {
      response.setHeader('X-Request-ID', requestId);
    }

    const body: ApiErrorResponse = {
      success: false,
      message,
      data: null,
      errors,
      timestamp: DateUtil.nowISO(),
      path,
      code,
      retryable,
      requestId,
    };

    response.status(status).json(body);
  }
}
