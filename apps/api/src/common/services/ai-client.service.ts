import { Injectable, Logger, HttpException, HttpStatus } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios, { AxiosInstance, AxiosError } from 'axios';
import { requestContextStorage } from '../utils/request-context';

/** Wire contract shared by the NestJS adapter and the FastAPI AI service. */
export const AI_SCHEMA_VERSION = '1.0.0';

/** AI features currently routed through {@link AiClientService.post}. */
export type AiFeature =
  | 'grammar.explain'
  | 'reading.generate'
  | 'reading.nlp.analyze'
  | 'writing.assess'
  | 'writing.errors.analyze'
  | 'cards.generate'
  | 'quiz.generate';

export const AI_FEATURES: readonly AiFeature[] = [
  'grammar.explain',
  'reading.generate',
  'reading.nlp.analyze',
  'writing.assess',
  'writing.errors.analyze',
  'cards.generate',
  'quiz.generate',
];

export type AiResultCode = 'OK' | 'ACCEPTED';

export const AI_RESULT_CODES: readonly AiResultCode[] = ['OK', 'ACCEPTED'];

/** Codes that may cross the NestJS ↔ FastAPI boundary. */
export type AiErrorCode =
  | 'VALIDATION_ERROR'
  | 'INSUFFICIENT_CREDITS'
  | 'OPERATION_CONFLICT'
  | 'RATE_LIMITED'
  | 'PROVIDER_UNAVAILABLE'
  | 'PROVIDER_TIMEOUT'
  | 'INVALID_AI_OUTPUT'
  | 'OPERATION_UNKNOWN'
  | 'INTERNAL_ERROR';

export const AI_ERROR_CODES: readonly AiErrorCode[] = [
  'VALIDATION_ERROR',
  'INSUFFICIENT_CREDITS',
  'OPERATION_CONFLICT',
  'RATE_LIMITED',
  'PROVIDER_UNAVAILABLE',
  'PROVIDER_TIMEOUT',
  'INVALID_AI_OUTPUT',
  'OPERATION_UNKNOWN',
  'INTERNAL_ERROR',
];

export interface AiRequestMeta {
  requestId: string;
  feature: AiFeature;
  schemaVersion: string;
  /** ISO-8601 instant after which the caller no longer waits for a result. */
  deadline: string;
  operationId?: string;
}

export interface AiSuccessEnvelope<T> extends AiRequestMeta {
  resultCode: AiResultCode;
  result: T;
}

export interface AiErrorDetail {
  code: AiErrorCode;
  message: string;
  retryable: boolean;
  operationId?: string;
}

export interface AiErrorEnvelope extends AiRequestMeta {
  error: AiErrorDetail;
}

export type AiResponse<T> = AiSuccessEnvelope<T> | AiErrorEnvelope;

/** Safe, client-facing description of an AI-service failure. */
export interface AiClientError {
  code: AiErrorCode;
  message: string;
  retryable: boolean;
  requestId?: string;
  feature?: AiFeature;
  operationId?: string;
}

interface AxiosAiResponseData {
  response?: {
    status?: number;
    data?: unknown;
  };
}

const PATH_FEATURES: Readonly<Record<string, AiFeature>> = {
  '/ai/grammar/explain': 'grammar.explain',
  '/ai/reading/generate': 'reading.generate',
  '/ai/nlp/analyze': 'reading.nlp.analyze',
  '/ai/writing/assess': 'writing.assess',
  '/ai/writing/errors/analyze': 'writing.errors.analyze',
  '/ai/cards/generate': 'cards.generate',
  '/ai/quiz/generate': 'quiz.generate',
};

const STATUS_ERROR_CODES: Readonly<Record<number, AiErrorCode>> = {
  400: 'VALIDATION_ERROR',
  401: 'INTERNAL_ERROR',
  402: 'INSUFFICIENT_CREDITS',
  403: 'INTERNAL_ERROR',
  404: 'OPERATION_UNKNOWN',
  409: 'OPERATION_CONFLICT',
  429: 'RATE_LIMITED',
  500: 'INTERNAL_ERROR',
  502: 'INVALID_AI_OUTPUT',
  503: 'PROVIDER_UNAVAILABLE',
  504: 'PROVIDER_TIMEOUT',
};

const RETRYABLE_ERROR_CODES: ReadonlySet<AiErrorCode> = new Set<AiErrorCode>([
  'PROVIDER_UNAVAILABLE',
  'PROVIDER_TIMEOUT',
  'RATE_LIMITED',
  'INTERNAL_ERROR',
]);

export const AI_ERROR_MESSAGES: Readonly<Record<AiErrorCode, string>> = {
  VALIDATION_ERROR: 'Invalid AI request',
  INSUFFICIENT_CREDITS: 'Insufficient credits for this AI request',
  OPERATION_CONFLICT: 'The AI operation is already in progress',
  RATE_LIMITED: 'AI request rate limit exceeded',
  PROVIDER_UNAVAILABLE: 'AI service temporarily unavailable',
  PROVIDER_TIMEOUT: 'AI service request timed out',
  INVALID_AI_OUTPUT: 'AI service returned an invalid result',
  OPERATION_UNKNOWN: 'AI operation not found',
  INTERNAL_ERROR: 'AI service temporarily unavailable',
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isAiErrorCode(value: unknown): value is AiErrorCode {
  return (
    typeof value === 'string' && AI_ERROR_CODES.includes(value as AiErrorCode)
  );
}

function isAiFeature(value: unknown): value is AiFeature {
  return typeof value === 'string' && AI_FEATURES.includes(value as AiFeature);
}

function isResultCode(value: unknown): value is AiResultCode {
  return (
    typeof value === 'string' && AI_RESULT_CODES.includes(value as AiResultCode)
  );
}

function firstString(...values: unknown[]): string | undefined {
  for (const value of values) {
    if (typeof value === 'string' && value.trim().length > 0) return value;
  }
  return undefined;
}

/** Resolve the feature key for a route. */
export function aiFeatureForPath(path: string): AiFeature {
  const normalized = path.split('?')[0].replace(/\/+$/, '') || '/';
  return PATH_FEATURES[normalized] ?? 'reading.generate';
}

/** Build one metadata object per logical request, reused across retries. */
export function buildAiRequestMeta(
  path: string,
  data: Record<string, unknown>,
  deadlineMs = 60_000,
): AiRequestMeta {
  // RequestStore is extended by the durable-operation work in progress; this
  // adapter only reads the optional field when a caller has populated it.
  const store = requestContextStorage.getStore() as
    | { requestId?: unknown; operationId?: unknown }
    | undefined;
  const detail = isRecord(data) ? data : {};
  const operationId = firstString(
    detail.operationId,
    detail.operation_id,
    store?.operationId,
  );
  const suppliedRequestId = firstString(
    store?.requestId,
    detail.requestId,
    detail.request_id,
  );
  const requestId = isValidRequestId(suppliedRequestId)
    ? (suppliedRequestId as string)
    : generateRequestId();
  const deadline = new Date(Date.now() + Math.max(1, deadlineMs)).toISOString();

  return {
    requestId,
    feature: aiFeatureForPath(path),
    schemaVersion: AI_SCHEMA_VERSION,
    deadline,
    ...(operationId ? { operationId } : {}),
  };
}

/** Convert metadata into stable, low-cardinality HTTP headers. */
export function toAiHeaders(meta: AiRequestMeta): Record<string, string> {
  return {
    'X-Request-ID': meta.requestId,
    'X-AI-Feature': meta.feature,
    'X-AI-Schema-Version': meta.schemaVersion,
    'X-AI-Deadline': meta.deadline,
    ...(meta.operationId ? { 'X-AI-Operation-ID': meta.operationId } : {}),
    'X-AI-Envelope': 'result',
  };
}

/**
 * Accept the documented envelope and the legacy flat body. Only an envelope
 * with a matching schema version, request ID and result code is unwrapped.
 */
export function unwrapAiResponse<T>(body: unknown, meta: AiRequestMeta): T {
  if (!isRecord(body)) return body as T;
  if (!('result' in body) || !isResultCode(body.resultCode)) return body as T;
  if ('schemaVersion' in body && body.schemaVersion !== meta.schemaVersion) {
    return body as T;
  }
  if ('feature' in body && !isAiFeature(body.feature)) return body as T;
  if ('requestId' in body && body.requestId !== meta.requestId)
    return body as T;
  if (isAiErrorCode(body.errorCode)) {
    const details = aiClientErrorFromCode(body.errorCode, meta, body.message);
    throw withAiError(
      new HttpException(details.message, statusForCode(details.code, 200)),
      details,
    );
  }
  return body.result as T;
}

/** Map any transport/response failure to a bounded, safe AiClientError. */
export function mapAiError(
  status: number,
  body: unknown,
  meta: AiRequestMeta,
): AiClientError {
  const data = isRecord(body) ? body : {};
  const error = isRecord(data.error) ? data.error : undefined;
  const rawCode = error?.code ?? data.error_code ?? data.errorCode;
  const code = isAiErrorCode(rawCode)
    ? rawCode
    : (STATUS_ERROR_CODES[status] ?? 'INTERNAL_ERROR');

  // Service-only codes are logged internally but never exposed on the wire.
  const publicCode = normalizeLegacyCode(code, rawCode);
  const message = firstString(error?.message, data.message, data.detail);
  const retryable =
    typeof error?.retryable === 'boolean'
      ? error.retryable
      : RETRYABLE_ERROR_CODES.has(publicCode);
  const operationId = firstString(
    error?.operationId,
    error?.operation_id,
    data.operationId,
    data.operation_id,
    meta.operationId,
  );

  return {
    code: publicCode,
    // Provider details never cross the boundary; only fixed messages do.
    message: message
      ? sanitizeErrorMessage(message, publicCode)
      : AI_ERROR_MESSAGES[publicCode],
    retryable,
    requestId: meta.requestId,
    feature: meta.feature,
    ...(operationId ? { operationId } : {}),
  };
}

function normalizeLegacyCode(code: AiErrorCode, rawCode: unknown): AiErrorCode {
  if (typeof rawCode !== 'string') return code;
  switch (rawCode.toUpperCase()) {
    case 'UNAUTHORIZED':
      return 'INTERNAL_ERROR';
    case 'CONCURRENCY_LIMITED':
    case 'BUDGET_EXCEEDED':
      return 'RATE_LIMITED';
    default:
      return code;
  }
}

function sanitizeErrorMessage(message: string, code: AiErrorCode): string {
  const trimmed = message.trim();
  // Only known safe phrases are forwarded; everything else uses the code's
  // fixed message so upstream provider text cannot leak through detail.
  const safeMessages = new Set(
    Object.values(AI_ERROR_MESSAGES).map((value) => value.toLowerCase()),
  );
  if (safeMessages.has(trimmed.toLowerCase())) return trimmed;
  return AI_ERROR_MESSAGES[code];
}

function aiClientErrorFromCode(
  code: AiErrorCode,
  meta: AiRequestMeta,
  rawMessage?: unknown,
): AiClientError {
  const message = typeof rawMessage === 'string' ? rawMessage : undefined;
  return {
    code,
    message: message
      ? sanitizeErrorMessage(message, code)
      : AI_ERROR_MESSAGES[code],
    retryable: RETRYABLE_ERROR_CODES.has(code),
    requestId: meta.requestId,
    feature: meta.feature,
    ...(meta.operationId ? { operationId: meta.operationId } : {}),
  };
}

function isValidRequestId(value: unknown): boolean {
  if (typeof value !== 'string' || value.length === 0 || value.length > 128) {
    return false;
  }
  return /^[A-Za-z0-9._:-]+$/.test(value);
}

function generateRequestId(): string {
  return `ai-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function statusForCode(code: AiErrorCode, responseStatus: number): number {
  if (responseStatus >= 400 && responseStatus < 600) return responseStatus;
  switch (code) {
    case 'VALIDATION_ERROR':
      return HttpStatus.BAD_REQUEST;
    case 'INSUFFICIENT_CREDITS':
      return HttpStatus.PAYMENT_REQUIRED;
    case 'OPERATION_CONFLICT':
      return HttpStatus.CONFLICT;
    case 'OPERATION_UNKNOWN':
      return HttpStatus.NOT_FOUND;
    case 'RATE_LIMITED':
      return HttpStatus.TOO_MANY_REQUESTS;
    case 'PROVIDER_TIMEOUT':
      return HttpStatus.GATEWAY_TIMEOUT;
    case 'PROVIDER_UNAVAILABLE':
    case 'INVALID_AI_OUTPUT':
    case 'INTERNAL_ERROR':
    default:
      return HttpStatus.SERVICE_UNAVAILABLE;
  }
}

function withAiError(
  error: HttpException,
  details: AiClientError,
): HttpException {
  const response = error.getResponse();
  if (isRecord(response)) {
    (response as Record<string, unknown>).error = details;
  }
  (error as HttpException & { aiError?: AiClientError }).aiError = details;
  return error;
}

@Injectable()
export class AiClientService {
  private client: AxiosInstance;
  private readonly logger = new Logger(AiClientService.name);
  private readonly MAX_RETRIES = 3;
  private readonly RETRY_DELAY_MS = 1000;

  constructor(private config: ConfigService) {
    const base = config.get('AI_SERVICE_URL', 'http://localhost:8000');
    // First key from AI_SERVICE_API_KEYS — used for server-to-server auth.
    const keys = (config.get<string>('AI_SERVICE_API_KEYS') || '')
      .split(',')
      .map((k) => k.trim())
      .filter(Boolean);
    const apiKey = keys[0];
    this.client = axios.create({
      baseURL: base.endsWith('/v1') ? base : `${base}/v1`,
      timeout: 60_000,
      headers: apiKey ? { 'X-API-Key': apiKey } : {},
    });
  }

  /**
   * Post to the AI service. Every call site triggers paid LLM generation, and
   * the AI service has no idempotency-key handling, so retrying a request that
   * may already have reached it would bill the same completion multiple times.
   * Only retry failures that provably happened before the request reached the
   * service (connection-level errors with no response received).
   */
  async post<T = unknown>(
    path: string,
    data: Record<string, unknown>,
  ): Promise<T> {
    let lastError: Error | null = null;
    let attemptsUsed = 0;
    // Metadata is computed once per logical request so retries keep the same
    // request ID, feature and deadline, and can be correlated end-to-end.
    const meta = buildAiRequestMeta(path, data);
    const headers = toAiHeaders(meta);

    for (let attempt = 1; attempt <= this.MAX_RETRIES; attempt++) {
      try {
        attemptsUsed = attempt;
        const res = await this.client.post(path, data, { headers });
        return unwrapAiResponse<T>(res.data, meta);
      } catch (error: unknown) {
        if (error instanceof HttpException) throw error;
        lastError = error as Error;
        const axiosError = error as AxiosError<AxiosAiResponseData>;
        const status = axiosError.response?.status;

        const errorData = axiosError.response?.data as unknown;
        const responseData =
          isRecord(errorData) && isRecord(errorData.response)
            ? errorData.response.data
            : errorData;
        if (status && status >= 400 && status < 600) {
          const details = mapAiError(status, responseData, meta);
          this.logger.warn(
            `AI service returned ${status} (${details.code}) for ${meta.feature} (${meta.requestId})`,
          );
          throw withAiError(
            new HttpException(
              details.message,
              statusForCode(details.code, status),
            ),
            details,
          );
        }

        // A response (including 5xx) or a timeout means the service may already
        // have generated content — retrying would duplicate spend. A request
        // setup error cannot safely be retried either. Only connection errors
        // with no response are provably pre-send and safe to retry.
        const isConnectionError =
          !axiosError.response &&
          !axiosError.code?.includes('TIMEOUT') &&
          (axiosError.code === 'ECONNREFUSED' ||
            axiosError.code === 'ENOTFOUND' ||
            axiosError.code === 'EAI_AGAIN' ||
            axiosError.code === 'ECONNRESET' ||
            axiosError.code === 'ERR_NETWORK' ||
            axiosError.code === 'EPIPE');

        if (!isConnectionError) {
          this.logger.error(
            `AI service call failed without safe retry (attempt ${attempt}/${this.MAX_RETRIES}): ${lastError.message}`,
          );
          break;
        }

        if (attempt < this.MAX_RETRIES) {
          this.logger.warn(
            `AI service connection failed before send (attempt ${attempt}/${this.MAX_RETRIES}): ${lastError.message}. Retrying...`,
          );
          await this.sleep(this.RETRY_DELAY_MS * attempt);
        }
      }
    }

    // All retries exhausted (or a non-retryable failure occurred)
    this.logger.error(
      `AI service call failed after ${attemptsUsed} attempt(s): ${lastError?.message}`,
    );
    const details = aiClientErrorFromCode('PROVIDER_UNAVAILABLE', meta);
    throw withAiError(
      new HttpException(details.message, HttpStatus.SERVICE_UNAVAILABLE),
      details,
    );
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
