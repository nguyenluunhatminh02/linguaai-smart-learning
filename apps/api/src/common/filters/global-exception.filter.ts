import {
  ExceptionFilter,
  Catch,
  ArgumentsHost,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Request, Response } from 'express';
import { inspect } from 'util';
import { DateUtil } from '../utils/date.util';
import { Prisma } from '../../generated/prisma';
import type { ApiErrors } from '../interceptors/transform.interceptor';

/**
 * Prisma known-request codes that stem from invalid user input.
 * Everything not listed here is an infrastructure/engine problem and must
 * fail closed with 500 rather than being reported as a client conflict.
 */
const PRISMA_BAD_REQUEST_CODES = new Set(['P2003', 'P2014', 'P2020']);

/** Normalise an exception payload to the documented ApiErrors contract. */
function toApiErrors(value: unknown): ApiErrors {
  if (Array.isArray(value)) {
    return value.filter((item): item is string => typeof item === 'string');
  }
  if (value && typeof value === 'object') {
    // Record<string, string[]> is part of ApiErrors, but only keep entries
    // whose values are string arrays so no arbitrary thrown shape leaks out.
    const result: Record<string, string[]> = {};
    for (const [key, item] of Object.entries(value)) {
      if (Array.isArray(item)) {
        const strings = item.filter((part): part is string => typeof part === 'string');
        if (strings.length) result[key] = strings;
      }
    }
    return Object.keys(result).length ? result : null;
  }
  return null;
}

@Catch()
export class GlobalExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(GlobalExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    let status = HttpStatus.INTERNAL_SERVER_ERROR;
    let message = 'Internal server error';
    let errors: ApiErrors = null;

    if (exception instanceof HttpException) {
      status = exception.getStatus();
      const exceptionResponse = exception.getResponse();
      if (typeof exceptionResponse === 'string') {
        message = exceptionResponse;
      } else if (exceptionResponse && typeof exceptionResponse === 'object') {
        const resp = exceptionResponse as Record<string, unknown>;
        if (Array.isArray(resp.message)) {
          message = resp.message[0] ?? 'Validation failed';
        } else if (typeof resp.message === 'string') {
          message = resp.message;
        }
        // Documented precedence: a dedicated `errors` payload wins over the
        // message array; both are normalised to ApiErrors. No `violations`
        // branch: NestJS does not emit that field.
        errors = toApiErrors(resp.errors) ?? toApiErrors(resp.message);
      }
      if (status >= 500) {
        this.logger.error(`[${status}] ${message} — ${request.method} ${request.url}`);
      } else if (status >= 400) {
        this.logger.warn(`[${status}] ${message} — ${request.method} ${request.url}`);
      }
    } else if (exception instanceof Prisma.PrismaClientKnownRequestError) {
      this.logger.error(`Prisma Error [${exception.code}]: ${exception.message}`);
      if (exception.code === 'P2002') {
        status = HttpStatus.CONFLICT;
        message = 'A resource with this identifier already exists';
      } else if (exception.code === 'P2025') {
        status = HttpStatus.NOT_FOUND;
        message = 'The requested resource was not found';
      } else if (PRISMA_BAD_REQUEST_CODES.has(exception.code)) {
        status = HttpStatus.BAD_REQUEST;
        message = 'Invalid request: related record is missing or invalid';
      } else {
        // P2021/P2022/P2034 and any future code: engine/schema/write failure.
        // Fail closed with a generic 500; details stay in the server log.
        status = HttpStatus.INTERNAL_SERVER_ERROR;
        message = 'Internal server error';
      }
    } else if (exception instanceof Prisma.PrismaClientInitializationError) {
      this.logger.error(`Prisma Init Error: ${exception.message}`);
      status = HttpStatus.SERVICE_UNAVAILABLE;
      message = 'Database service unavailable';
    } else if (exception instanceof Prisma.PrismaClientValidationError) {
      this.logger.error(`Prisma Validation: ${exception.message}`);
      status = HttpStatus.BAD_REQUEST;
      message = 'Database validation failed';
    } else if (exception instanceof Error) {
      this.logger.error(exception.message, exception.stack);
    } else {
      // inspect() is safe for every value, including undefined, symbols and
      // BigInt (JSON.stringify throws on BigInt).
      this.logger.error(`Unknown exception: ${inspect(exception)}`);
    }

    response.status(status).json({
      success: false,
      message,
      data: null,
      errors: errors ?? null,
      timestamp: DateUtil.nowISO(),
      path: request.url,
    });
  }
}
