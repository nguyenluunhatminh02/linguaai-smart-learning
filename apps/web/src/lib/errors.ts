/**
 * Typed error model for API responses.
 *
 * Pure module: it deliberately does not import api-client or auth-store so it
 * can be used by axios interceptors, SSE consumers and UI code without cycles.
 *
 * The server's current envelope (global-exception.filter.ts) is
 * `{ success, message, data, errors, timestamp, path, code, retryable, requestId }`.
 * REL-01 also proposes a nested `error` object with an optional `operationId`;
 * both shapes, plus their snake_case variants, are accepted here.
 */

/** Allowlisted codes from REL-01 and the current NestJS error catalog. */
export type AppErrorCode =
  | 'VALIDATION_ERROR'
  | 'INSUFFICIENT_CREDITS'
  | 'OPERATION_CONFLICT'
  | 'RATE_LIMITED'
  | 'PROVIDER_UNAVAILABLE'
  | 'PROVIDER_TIMEOUT'
  | 'INVALID_AI_OUTPUT'
  | 'OPERATION_UNKNOWN'
  | 'INTERNAL_ERROR'
  | 'AUTHENTICATION_REQUIRED'
  | 'ACCESS_DENIED'
  | 'RESOURCE_NOT_FOUND'
  | 'DATABASE_UNAVAILABLE';

const ERROR_CODES = new Set<AppErrorCode>([
  'VALIDATION_ERROR',
  'INSUFFICIENT_CREDITS',
  'OPERATION_CONFLICT',
  'RATE_LIMITED',
  'PROVIDER_UNAVAILABLE',
  'PROVIDER_TIMEOUT',
  'INVALID_AI_OUTPUT',
  'OPERATION_UNKNOWN',
  'INTERNAL_ERROR',
  'AUTHENTICATION_REQUIRED',
  'ACCESS_DENIED',
  'RESOURCE_NOT_FOUND',
  'DATABASE_UNAVAILABLE',
]);

/** Codes are bounded, uppercase tokens; anything else is untrusted. */
const CODE_PATTERN = /^[A-Z0-9_]{1,64}$/;
const MAX_MESSAGE_LENGTH = 200;

/** `ApiErrors` contract shared with the NestJS transform interceptor. */
export type ApiErrors = string[] | Record<string, string[]> | null;

/** Both the live envelope and the proposed nested REL-01 error object. */
export interface ApiEnvelopeShape {
  success: boolean;
  message: string | null;
  data: unknown;
  errors: ApiErrors;
  timestamp?: string;
  path?: string;
  // Current server envelope.
  code?: string;
  retryable?: boolean;
  requestId?: string;
  operationId?: string;
  // Proposed REL-01 envelope; snake_case keys are also tolerated.
  error?: {
    code?: string;
    message?: string;
    retryable?: boolean;
    requestId?: string;
    operationId?: string;
    request_id?: string;
    operation_id?: string;
    error_code?: string;
  };
  error_code?: string;
  request_id?: string;
  operation_id?: string;
}

export interface AppErrorOptions {
  httpStatus?: number;
  retryable?: boolean;
  requestId?: string;
  operationId?: string;
  details?: ApiErrors;
}

/** Error carrying typed, UI-safe metadata instead of a raw transport error. */
export class AppError extends Error {
  readonly code: AppErrorCode;
  readonly httpStatus?: number;
  readonly retryable: boolean;
  readonly requestId?: string;
  readonly operationId?: string;
  readonly details?: ApiErrors;

  constructor(message: string, code: AppErrorCode, options: AppErrorOptions = {}) {
    super(message);
    this.name = 'AppError';
    this.code = code;
    this.httpStatus = options.httpStatus;
    this.retryable = options.retryable ?? false;
    this.requestId = options.requestId;
    this.operationId = options.operationId;
    this.details = options.details;
    // Required when targeting ES5/ES2022 via transpilers that break the chain.
    Object.setPrototypeOf(this, AppError.prototype);
  }
}

/** Structural check for a server envelope; rejects arbitrary thrown values. */
export function isApiEnvelope(value: unknown): value is ApiEnvelopeShape {
  if (!isRecord(value)) return false;
  return (
    typeof value.success === 'boolean'
    && (value.message === null || typeof value.message === 'string')
    && 'data' in value
    && 'errors' in value
    && (value.timestamp === undefined || typeof value.timestamp === 'string')
    && (value.path === undefined || typeof value.path === 'string')
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isKnownCode(value: unknown): value is AppErrorCode {
  return typeof value === 'string' && CODE_PATTERN.test(value) && ERROR_CODES.has(value as AppErrorCode);
}

/**
 * Bound and clean a server message before it reaches the UI. Paths, queries,
 * tokens, script fragments and control characters are removed; no stack or
 * raw `String(err)` is ever forwarded.
 */
function sanitizeMessage(value: unknown, fallback: string): string {
  if (typeof value !== 'string') return fallback;
  let message = value
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/<script\b[^>]*>[\s\S]*?<\/script\s*>/gi, ' ')
    .replace(/<[^>]{0,200}>/g, ' ')
    .replace(/javascript:|onerror\s*=|onload\s*=/gi, ' ')
    // Query strings and bearer/JWT-like values can carry secrets.
    .replace(/[?&][\w.-]+=[^\s&]*/g, ' ')
    .replace(/Bearer\s+\S+/gi, 'Bearer [redacted]')
    .replace(/\beyJ[A-Za-z0-9_-]{8,}\b/g, '[redacted]')
    .replace(/\b[A-Za-z0-9_-]{40,}\b/g, '[redacted]')
    // Server paths and stack frames are diagnostics, not user-facing text.
    .replace(/(?:[A-Za-z]:)?[\\/][\w.\\/-]+/g, ' ')
    .replace(/\bat\s+[\w.$<>/-]+\s*\(/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  if (!message) return fallback;
  if (message.length > MAX_MESSAGE_LENGTH) {
    message = `${message.slice(0, MAX_MESSAGE_LENGTH - 1).trimEnd()}…`;
  }
  return message;
}

/** Codes implied by status when the payload has no explicit code. */
function codeForStatus(status?: number): AppErrorCode {
  switch (status) {
    case 400:
      return 'VALIDATION_ERROR';
    case 408:
    case 504:
      return 'PROVIDER_TIMEOUT';
    case 409:
    case 422:
      return 'OPERATION_CONFLICT';
    case 429:
      return 'RATE_LIMITED';
    case 503:
      return 'PROVIDER_UNAVAILABLE';
    default:
      // 401/403/404 statuses are deliberately not given a semantic code:
      // 403 may mean ownership, credit exhaustion or something else. Callers
      // can still inspect httpStatus, and explicit server codes win above.
      return 'INTERNAL_ERROR';
  }
}

/** Codes whose transient nature is known without a server hint. */
function defaultRetryable(code: AppErrorCode): boolean {
  return (
    code === 'RATE_LIMITED'
    || code === 'PROVIDER_TIMEOUT'
    || code === 'PROVIDER_UNAVAILABLE'
    || code === 'DATABASE_UNAVAILABLE'
  );
}

/** Unwrap nested `data:` objects (bounded), keeping outer candidates intact. */
function envelopeCandidates(payload: unknown): Record<string, unknown>[] {
  const candidates: Record<string, unknown>[] = [];
  let current = payload;
  for (let depth = 0; depth < 8 && isRecord(current); depth += 1) {
    candidates.push(current);
    if (!('data' in current) || !isRecord(current.data)) break;
    current = current.data;
  }
  return candidates;
}

function nestedError(record: Record<string, unknown>): Record<string, unknown> | undefined {
  return isRecord(record.error) ? record.error : undefined;
}

/** Lookup order: nested error.code, then top-level code / errorCode variants. */
function findCode(candidates: Record<string, unknown>[]): AppErrorCode | undefined {
  for (const candidate of candidates) {
    const error = nestedError(candidate);
    if (error && isKnownCode(error.code)) return error.code;
    if (isKnownCode(error?.error_code)) return error.error_code;
    if (isKnownCode(candidate.code)) return candidate.code;
    if (isKnownCode(candidate.errorCode)) return candidate.errorCode;
    if (isKnownCode(candidate.error_code)) return candidate.error_code;
  }
  return undefined;
}

/** True when a code-like value was supplied but failed validation. */
function hasInvalidCode(candidates: Record<string, unknown>[]): boolean {
  for (const candidate of candidates) {
    const error = nestedError(candidate);
    const values: unknown[] = [
      error?.code,
      error?.error_code,
      candidate.code,
      candidate.errorCode,
      candidate.error_code,
    ];
    if (values.some((value) => typeof value === 'string' && value.length > 0)) {
      return true;
    }
  }
  return false;
}

function findValue(
  candidates: Record<string, unknown>[],
  keys: readonly string[],
): string | undefined {
  for (const candidate of candidates) {
    const error = nestedError(candidate);
    for (const key of keys) {
      const value = error?.[key];
      if (typeof value === 'string' && value.trim()) return value;
    }
    for (const key of keys) {
      const value = candidate[key];
      if (typeof value === 'string' && value.trim()) return value;
    }
  }
  return undefined;
}

function findRetryable(candidates: Record<string, unknown>[]): boolean | undefined {
  for (const candidate of candidates) {
    const error = nestedError(candidate);
    if (typeof error?.retryable === 'boolean') return error.retryable;
    if (typeof candidate.retryable === 'boolean') return candidate.retryable;
  }
  return undefined;
}

/** Keep only string arrays; never render arbitrary objects from a payload. */
function findDetails(candidates: Record<string, unknown>[]): ApiErrors {
  for (const candidate of candidates) {
    const raw = candidate.errors ?? nestedError(candidate)?.errors;
    if (Array.isArray(raw)) {
      const values = raw.filter((item): item is string => typeof item === 'string');
      if (values.length) return values;
      continue;
    }
    if (isRecord(raw)) {
      const result: Record<string, string[]> = {};
      for (const [key, value] of Object.entries(raw)) {
        if (Array.isArray(value)) {
          const values = value.filter((item): item is string => typeof item === 'string');
          if (values.length) result[key] = values;
        }
      }
      if (Object.keys(result).length) return result;
    }
  }
  return null;
}

function findMessage(candidates: Record<string, unknown>[]): unknown {
  for (const candidate of candidates) {
    const error = nestedError(candidate);
    if (error && typeof error.message === 'string' && error.message.trim()) {
      return error.message;
    }
    if (typeof candidate.message === 'string' && candidate.message.trim()) {
      return candidate.message;
    }
  }
  return undefined;
}

/** Parse a server error payload into a typed AppError. */
export function parseApiError(payload: unknown, fallbackStatus?: number): AppError {
  const candidates = envelopeCandidates(payload);
  const explicitCode = findCode(candidates);
  // No code, or a code that failed validation, falls back to the HTTP status;
  // an invalid code must not silently masquerade as a known code.
  const code = explicitCode ?? (hasInvalidCode(candidates)
    ? 'INTERNAL_ERROR'
    : codeForStatus(fallbackStatus));
  const retryable = findRetryable(candidates) ?? defaultRetryable(code);

  return new AppError(
    sanitizeMessage(findMessage(candidates), 'Request failed'),
    code,
    {
      httpStatus: fallbackStatus,
      retryable,
      requestId: findValue(candidates, ['requestId', 'request_id']),
      operationId: findValue(candidates, ['operationId', 'operation_id']),
      details: findDetails(candidates),
    },
  );
}

/** Convert any thrown value (axios error, string, etc.) into an AppError. */
export function toAppError(error: unknown, fallbackMessage?: string): AppError {
  if (error instanceof AppError) return error;

  if (isRecord(error)) {
    const response = isRecord(error.response) ? error.response : undefined;
    if (response) {
      const status = typeof response.status === 'number' ? response.status : undefined;
      return parseApiError(response.data, status);
    }

    // Transport failures without a response: timeouts/network are transient,
    // but no provider text from the thrown error is trusted as a UI message.
    const transportCode = error.code;
    if (transportCode === 'ECONNABORTED' || transportCode === 'ETIMEDOUT') {
      return new AppError(
        sanitizeMessage(fallbackMessage, 'Request timed out'),
        'PROVIDER_TIMEOUT',
        { retryable: true },
      );
    }
    if (transportCode === 'ERR_NETWORK') {
      return new AppError(
        sanitizeMessage(fallbackMessage, 'Network error'),
        'DATABASE_UNAVAILABLE',
        { retryable: true },
      );
    }
  }

  const message = error instanceof Error ? error.message : undefined;
  return new AppError(
    sanitizeMessage(message ?? fallbackMessage, fallbackMessage ?? 'An unexpected error occurred'),
    'INTERNAL_ERROR',
  );
}

/** Retry hint for callers deciding whether to repeat an operation. */
export function isRetryableError(error: unknown): boolean {
  return error instanceof AppError && error.retryable;
}

/** Stable, i18n-friendly key for UI messages; never a raw transport string. */
export function describeError(error: unknown): AppErrorCode {
  return error instanceof AppError ? error.code : 'INTERNAL_ERROR';
}
