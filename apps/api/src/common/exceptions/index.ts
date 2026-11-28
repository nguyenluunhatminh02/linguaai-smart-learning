import { HttpException, HttpStatus } from '@nestjs/common';

/**
 * Machine-readable error codes shared by HTTP responses, SSE failures and the
 * AI operation refund policy. Client messages are always safe, fixed strings:
 * provider details belong in server logs and must never reach this registry.
 */
export type ErrorCode =
  | 'VALIDATION_ERROR'
  | 'INSUFFICIENT_CREDITS'
  | 'OPERATION_CONFLICT'
  | 'RATE_LIMITED'
  | 'PROVIDER_UNAVAILABLE'
  | 'PROVIDER_TIMEOUT'
  | 'INVALID_AI_OUTPUT'
  | 'OPERATION_UNKNOWN'
  | 'INTERNAL_ERROR';

export type ErrorCategory =
  | 'client'
  | 'billing'
  | 'concurrency'
  | 'provider'
  | 'system';

export interface ErrorCodeMetadata {
  httpStatus: number;
  safeMessage: string;
  retryable: boolean;
  category: ErrorCategory;
}

/** Single source of truth: HTTP status, safe message and retry classification. */
export const ERROR_CODE_METADATA: Readonly<
  Record<ErrorCode, ErrorCodeMetadata>
> = Object.freeze({
  VALIDATION_ERROR: {
    httpStatus: HttpStatus.BAD_REQUEST,
    safeMessage: 'The request could not be validated.',
    retryable: false,
    category: 'client',
  },
  INSUFFICIENT_CREDITS: {
    httpStatus: HttpStatus.PAYMENT_REQUIRED,
    safeMessage: 'Not enough credits to complete this request.',
    retryable: false,
    category: 'billing',
  },
  OPERATION_CONFLICT: {
    httpStatus: HttpStatus.CONFLICT,
    safeMessage: 'The operation could not be completed due to a conflict.',
    retryable: false,
    category: 'concurrency',
  },
  RATE_LIMITED: {
    httpStatus: HttpStatus.TOO_MANY_REQUESTS,
    safeMessage: 'Too many requests. Please try again shortly.',
    retryable: true,
    category: 'client',
  },
  PROVIDER_UNAVAILABLE: {
    httpStatus: HttpStatus.SERVICE_UNAVAILABLE,
    safeMessage: 'The AI service is temporarily unavailable.',
    retryable: true,
    category: 'provider',
  },
  PROVIDER_TIMEOUT: {
    httpStatus: HttpStatus.GATEWAY_TIMEOUT,
    safeMessage: 'The AI service did not respond in time.',
    retryable: true,
    category: 'provider',
  },
  INVALID_AI_OUTPUT: {
    httpStatus: HttpStatus.BAD_GATEWAY,
    safeMessage: 'The AI service returned an invalid response.',
    retryable: false,
    category: 'provider',
  },
  OPERATION_UNKNOWN: {
    httpStatus: HttpStatus.INTERNAL_SERVER_ERROR,
    safeMessage: 'The outcome of this operation is unknown.',
    retryable: true,
    category: 'system',
  },
  INTERNAL_ERROR: {
    httpStatus: HttpStatus.INTERNAL_SERVER_ERROR,
    safeMessage: 'The request could not be completed.',
    retryable: false,
    category: 'system',
  },
});

/** All frozen entries, keeping the map immutable even via nested mutation. */
for (const metadata of Object.values(ERROR_CODE_METADATA)) {
  Object.freeze(metadata);
}

/** Stable allowlist matching the registry keys. */
export const ERROR_CODES: readonly ErrorCode[] = Object.freeze(
  Object.keys(ERROR_CODE_METADATA) as ErrorCode[],
);

/** Failures with a known outcome: safe to refund once via the ledger key. */
export const REFUNDABLE_ERROR_CODES: ReadonlySet<ErrorCode> = Object.freeze(
  new Set<ErrorCode>([
    'VALIDATION_ERROR',
    'INSUFFICIENT_CREDITS',
    'RATE_LIMITED',
    'PROVIDER_UNAVAILABLE',
    'INVALID_AI_OUTPUT',
    'INTERNAL_ERROR',
  ]),
);

/** Ambiguous failures: the operation needs reconciliation before any refund. */
export const AMBIGUOUS_ERROR_CODES: ReadonlySet<ErrorCode> = Object.freeze(
  new Set<ErrorCode>(['PROVIDER_TIMEOUT', 'OPERATION_UNKNOWN']),
);

export function isErrorCode(value: unknown): value is ErrorCode {
  return (
    typeof value === 'string' &&
    Object.prototype.hasOwnProperty.call(ERROR_CODE_METADATA, value)
  );
}

export function getErrorMessage(code: ErrorCode): string {
  return ERROR_CODE_METADATA[code].safeMessage;
}

export function getHttpStatus(code: ErrorCode): number {
  return ERROR_CODE_METADATA[code].httpStatus;
}

export function isRetryable(code: ErrorCode): boolean {
  return ERROR_CODE_METADATA[code].retryable;
}

export function isAmbiguous(code: ErrorCode): boolean {
  return AMBIGUOUS_ERROR_CODES.has(code);
}

export class AppException extends HttpException {
  public readonly code: ErrorCode;

  constructor(
    message: string,
    status: HttpStatus | number,
    code: ErrorCode = 'INTERNAL_ERROR',
  ) {
    super({ success: false, message, statusCode: status, code }, status);
    this.code = code;
  }

  override getResponse(): {
    success: false;
    message: string;
    statusCode: number;
    code: ErrorCode;
  } {
    return super.getResponse() as {
      success: false;
      message: string;
      statusCode: number;
      code: ErrorCode;
    };
  }
}

export class AuthException extends AppException {
  constructor(
    message: string,
    status: HttpStatus | number,
    code: ErrorCode = 'VALIDATION_ERROR',
  ) {
    super(message, status, code);
  }
}

export class BadCredentialsException extends AuthException {
  constructor(message = 'Invalid email or password') {
    super(message, HttpStatus.UNAUTHORIZED);
  }
}

export class InvalidTokenException extends AuthException {
  constructor(message = 'Token is invalid or expired') {
    super(message, HttpStatus.UNAUTHORIZED);
  }
}

export class MfaException extends AuthException {
  constructor(message = 'Invalid MFA code') {
    super(message, HttpStatus.UNAUTHORIZED);
  }
}

export class EmailNotVerifiedException extends AuthException {
  constructor(message = 'Please verify your email before logging in') {
    super(message, HttpStatus.FORBIDDEN);
  }
}

export class DeviceLimitExceededException extends AuthException {
  constructor(
    message = 'Maximum number of devices reached. Please remove a device first.',
  ) {
    super(message, HttpStatus.FORBIDDEN, 'RATE_LIMITED');
  }
}

export class ResourceNotFoundException extends AppException {
  constructor(resource = 'Resource') {
    super(`${resource} not found`, HttpStatus.NOT_FOUND, 'VALIDATION_ERROR');
  }
}

export class ResourceAlreadyExistsException extends AppException {
  constructor(resource = 'Resource') {
    super(
      `${resource} already exists`,
      HttpStatus.CONFLICT,
      'OPERATION_CONFLICT',
    );
  }
}

export class AccountLockedException extends AuthException {
  constructor(
    message = 'Account is locked due to too many failed attempts. Try again later.',
  ) {
    super(message, 423, 'RATE_LIMITED');
  }
}

/**
 * Base classes pin their code and default safe message so handlers cannot
 * accidentally expose provider details in an error response. Callers may
 * override the message with another fixed, client-safe string.
 */
export class ValidationException extends AppException {
  constructor(message = getErrorMessage('VALIDATION_ERROR')) {
    super(message, getHttpStatus('VALIDATION_ERROR'), 'VALIDATION_ERROR');
  }
}

export class InsufficientCreditsException extends AppException {
  constructor(message = getErrorMessage('INSUFFICIENT_CREDITS')) {
    super(
      message,
      getHttpStatus('INSUFFICIENT_CREDITS'),
      'INSUFFICIENT_CREDITS',
    );
  }
}

export class OperationConflictException extends AppException {
  constructor(message = getErrorMessage('OPERATION_CONFLICT')) {
    super(message, getHttpStatus('OPERATION_CONFLICT'), 'OPERATION_CONFLICT');
  }
}

export class RateLimitedException extends AppException {
  constructor(message = getErrorMessage('RATE_LIMITED')) {
    super(message, getHttpStatus('RATE_LIMITED'), 'RATE_LIMITED');
  }
}

/** @deprecated Use RateLimitedException. Kept for existing auth callers. */
export class RateLimitExceededException extends RateLimitedException {}

export class ProviderUnavailableException extends AppException {
  constructor(message = getErrorMessage('PROVIDER_UNAVAILABLE')) {
    super(
      message,
      getHttpStatus('PROVIDER_UNAVAILABLE'),
      'PROVIDER_UNAVAILABLE',
    );
  }
}

export class ProviderTimeoutException extends AppException {
  constructor(message = getErrorMessage('PROVIDER_TIMEOUT')) {
    super(message, getHttpStatus('PROVIDER_TIMEOUT'), 'PROVIDER_TIMEOUT');
  }
}

export class InvalidAiOutputException extends AppException {
  constructor(message = getErrorMessage('INVALID_AI_OUTPUT')) {
    super(message, getHttpStatus('INVALID_AI_OUTPUT'), 'INVALID_AI_OUTPUT');
  }
}

export class OperationUnknownException extends AppException {
  constructor(message = getErrorMessage('OPERATION_UNKNOWN')) {
    super(message, getHttpStatus('OPERATION_UNKNOWN'), 'OPERATION_UNKNOWN');
  }
}

export class PasswordValidationException extends ValidationException {
  public readonly errors: string[];

  constructor(errors: string[]) {
    super('Password does not meet requirements');
    this.errors = errors;
    const response = this.getResponse() as { errors?: string[] };
    response.errors = errors;
  }
}
