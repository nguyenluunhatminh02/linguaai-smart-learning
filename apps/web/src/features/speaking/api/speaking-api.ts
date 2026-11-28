import { z } from 'zod';
import apiClient from '@/lib/api-client';
import { getAccessToken } from '@/stores/auth-store';

/** Stable error vocabulary shared by every speaking UI surface. */
export type SpeakingErrorCode =
  | 'UNAUTHORIZED'
  | 'INSUFFICIENT_CREDITS'
  | 'INVALID_AUDIO'
  | 'UNSUPPORTED_FORMAT'
  | 'TRANSCRIPTION_FAILED'
  | 'FEEDBACK_FAILED'
  | 'TOPIC_GENERATION_FAILED'
  | 'NETWORK_ERROR'
  | 'TIMEOUT'
  | 'OPERATION_CONFLICT'
  | 'RATE_LIMITED'
  | 'WS_DISCONNECTED'
  | 'WS_TIMEOUT'
  | 'UNKNOWN';

const RETRYABLE_CODES: ReadonlySet<SpeakingErrorCode> = new Set([
  'NETWORK_ERROR',
  'TIMEOUT',
  'RATE_LIMITED',
  'FEEDBACK_FAILED',
  'TOPIC_GENERATION_FAILED',
  'WS_DISCONNECTED',
  'WS_TIMEOUT',
]);

const ERROR_MESSAGES: Record<SpeakingErrorCode, string> = {
  UNAUTHORIZED: 'Please sign in to continue.',
  INSUFFICIENT_CREDITS: 'Not enough credits to complete this request.',
  INVALID_AUDIO: 'The audio recording could not be read. Please try again.',
  UNSUPPORTED_FORMAT: 'This audio format is not supported.',
  TRANSCRIPTION_FAILED: 'Transcription failed. Please try again.',
  FEEDBACK_FAILED: 'Feedback is temporarily unavailable. Please try again.',
  TOPIC_GENERATION_FAILED: 'Could not generate a speaking topic. Please try again.',
  NETWORK_ERROR: 'Network error. Please check your connection.',
  TIMEOUT: 'The request took too long. Please try again.',
  OPERATION_CONFLICT: 'This request was already submitted. Please wait for its result.',
  RATE_LIMITED: 'Too many requests. Please try again shortly.',
  WS_DISCONNECTED: 'The connection was interrupted. Please try again.',
  WS_TIMEOUT: 'Feedback timed out. Please try again.',
  UNKNOWN: 'Something went wrong. Please try again.',
};

export interface SpeakingApiErrorOptions {
  statusCode?: number;
  operationId?: string;
  cause?: unknown;
}

/**
 * A normalized failure. `message` is always a generic, localized-safe string;
 * backend/provider text is never surfaced verbatim to the UI.
 */
export class SpeakingApiError extends Error {
  readonly code: SpeakingErrorCode;
  readonly statusCode?: number;
  readonly operationId?: string;
  readonly retryable: boolean;

  constructor(code: SpeakingErrorCode, options: SpeakingApiErrorOptions = {}) {
    super(ERROR_MESSAGES[code]);
    this.name = 'SpeakingApiError';
    this.code = code;
    this.retryable = RETRYABLE_CODES.has(code);
    if (options.statusCode !== undefined) this.statusCode = options.statusCode;
    if (options.operationId !== undefined) this.operationId = options.operationId;
    if (options.cause !== undefined) this.cause = options.cause;
  }
}

export type SpeakingErrorContext =
  | 'transcribe'
  | 'topic'
  | 'history'
  | 'submission'
  | 'operation'
  | 'websocket';

interface ErrorLike {
  code?: unknown;
  message?: unknown;
  response?: {
    status?: unknown;
    data?: unknown;
  };
  request?: unknown;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function errorPayload(error: ErrorLike): Record<string, unknown> | null {
  const data = asRecord(error.response?.data);
  if (!data) return null;
  return asRecord(data.data) ?? data;
}

function errorText(payload: Record<string, unknown> | null, error: ErrorLike): string {
  const candidates = [payload?.message, payload?.error, payload?.detail, error.message];
  for (const candidate of candidates) {
    if (typeof candidate === 'string' && candidate.trim()) return candidate.toLowerCase();
    if (Array.isArray(candidate) && typeof candidate[0] === 'string') {
      return candidate[0].toLowerCase();
    }
  }
  return '';
}

function statusOf(error: ErrorLike): number | undefined {
  const status = error.response?.status;
  return typeof status === 'number' ? status : undefined;
}

function operationIdOf(payload: Record<string, unknown> | null): string | undefined {
  const id = payload?.operationId;
  return typeof id === 'string' && id.trim() ? id : undefined;
}

/**
 * Map any transport error to the speaking error vocabulary. This is the only
 * place where raw status/message text is inspected; callers receive a stable
 * code plus a generic message.
 */
export function mapApiError(
  error: unknown,
  context: SpeakingErrorContext,
): SpeakingApiError {
  if (error instanceof SpeakingApiError) return error;

  const err = (asRecord(error) ?? {}) as ErrorLike;
  const payload = errorPayload(err);
  const status = statusOf(err);
  const text = errorText(payload, err);
  const errorCode = typeof payload?.code === 'string' ? payload.code.toUpperCase() : '';
  const options = {
    statusCode: status,
    operationId: operationIdOf(payload),
    cause: error,
  };

  if (errorCode === 'INSUFFICIENT_CREDITS' ||
      status === 402 ||
      /insufficient|not enough (tokens|credits)|out of credits/.test(text)) {
    return new SpeakingApiError('INSUFFICIENT_CREDITS', options);
  }
  if (status === 401 || status === 403 || /\bunauthorized\b|\btoken (expired|invalid)\b/.test(text)) {
    return new SpeakingApiError('UNAUTHORIZED', options);
  }
  if (status === 409 || errorCode === 'OPERATION_CONFLICT' || /\bduplicate request\b|\bconflict\b/.test(text)) {
    return new SpeakingApiError('OPERATION_CONFLICT', options);
  }
  if (status === 429 || errorCode === 'RATE_LIMITED' || /too many requests/.test(text)) {
    return new SpeakingApiError('RATE_LIMITED', options);
  }
  if (status === 504 || err.code === 'ECONNABORTED' || err.code === 'ETIMEDOUT' ||
      /\btimeout\b|\btimed out\b/.test(text)) {
    return new SpeakingApiError('TIMEOUT', options);
  }
  if (status === 400 || status === 413 || status === 415 || status === 422) {
    if (context === 'topic') {
      return new SpeakingApiError('TOPIC_GENERATION_FAILED', options);
    }
    if (context === 'websocket') {
      return new SpeakingApiError('INVALID_AUDIO', options);
    }
    if (status === 415 || /unsupported (format|media type)|invalid (audio )?format/.test(text)) {
      return new SpeakingApiError('UNSUPPORTED_FORMAT', options);
    }
    if (/audio|mime|base64|decode/.test(text)) {
      return new SpeakingApiError('INVALID_AUDIO', options);
    }
    return new SpeakingApiError(
      context === 'transcribe' ? 'INVALID_AUDIO' : 'UNKNOWN',
      options,
    );
  }
  if (status === 502 || status === 503) {
    if (context === 'topic') return new SpeakingApiError('TOPIC_GENERATION_FAILED', options);
    if (context === 'transcribe') return new SpeakingApiError('TRANSCRIPTION_FAILED', options);
    if (context === 'websocket') return new SpeakingApiError('FEEDBACK_FAILED', options);
    return new SpeakingApiError('UNKNOWN', options);
  }
  if (status !== undefined) {
    if (status >= 500) {
      if (context === 'transcribe') return new SpeakingApiError('TRANSCRIPTION_FAILED', options);
      return new SpeakingApiError('FEEDBACK_FAILED', options);
    }
    return new SpeakingApiError('UNKNOWN', options);
  }
  if (err.request !== undefined || err.code === 'ERR_NETWORK' ||
      /network error|failed to fetch|socket hang up/.test(text)) {
    return new SpeakingApiError('NETWORK_ERROR', options);
  }
  return new SpeakingApiError('UNKNOWN', options);
}

// ---------------------------------------------------------------------------
// Operation keys
// ---------------------------------------------------------------------------

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function randomSuffix(): string {
  const globalCrypto = typeof globalThis !== 'undefined'
    ? (globalThis as { crypto?: { randomUUID?: () => string } }).crypto
    : undefined;
  if (globalCrypto && typeof globalCrypto.randomUUID === 'function') {
    return globalCrypto.randomUUID();
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}-${Math.random().toString(36).slice(2, 10)}`;
}

/**
 * Generate one key per user intent. Callers must keep the returned key and
 * pass it on every retry: topic generation is billed once per idempotency key.
 */
export function createSpeakingOperationKey(feature: string): string {
  const normalized = feature.trim().toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '');
  return `speaking-${normalized || 'operation'}-${randomSuffix()}`;
}

export function isValidOperationKey(key: unknown): key is string {
  if (typeof key !== 'string' || key.length > 128) return false;
  const match = /^speaking-([a-z0-9-]+)-(.+)$/.exec(key);
  if (!match) return false;
  return UUID_PATTERN.test(match[2]) || /^[a-z0-9]+-[a-z0-9]+$/.test(match[2]);
}

// ---------------------------------------------------------------------------
// Boundary schemas (kept here until the neighbouring types/schemas files land)
// ---------------------------------------------------------------------------

const scoresSchema = z.object({
  overall: z.number(),
  grammar: z.number(),
  vocabulary: z.number(),
  basis: z.enum(['transcript']).optional(),
});

const speakingTopicSchema = z.object({
  topic: z.string(),
  prompt: z.string(),
  tips: z.array(z.string()),
  samplePhrases: z.array(z.string()),
  duration: z.number(),
  difficulty: z.string(),
});

const speakingHistoryItemSchema = z.object({
  id: z.string(),
  topic: z.string().nullable(),
  transcript: z.string(),
  feedback: z.string(),
  scores: scoresSchema.nullable(),
  language: z.string(),
  level: z.string(),
  durationSec: z.number(),
  createdAt: z.string(),
});

const historyResponseSchema = z.object({
  total: z.number(),
  page: z.number(),
  limit: z.number(),
  items: z.array(speakingHistoryItemSchema),
});

const submissionSchema = speakingHistoryItemSchema.extend({
  audioUrl: z.string().nullable().optional(),
});

const transcriptResponseSchema = z.object({
  transcript: z.string(),
});

const feedbackChunkSchema = z.object({
  text: z.string(),
});

const operationStatusSchema = z.object({
  status: z.enum(['PENDING', 'RUNNING', 'SUCCEEDED', 'FAILED', 'CANCELLED', 'UNKNOWN']),
  errorCode: z.string().nullable().optional(),
  conversationId: z.string().nullable().optional(),
  messageId: z.string().nullable().optional(),
  balance: z.number().optional(),
});

export type SpeakingTopic = z.infer<typeof speakingTopicSchema>;
export type Scores = z.infer<typeof scoresSchema>;
export type SpeakingHistoryItem = z.infer<typeof speakingHistoryItemSchema>;
export type SpeakingSubmission = z.infer<typeof submissionSchema>;
export type HistoryResponse = z.infer<typeof historyResponseSchema>;
export type Phase =
  | 'ready'
  | 'topic'
  | 'recording'
  | 'connecting'
  | 'transcribing'
  | 'analyzing'
  | 'streaming'
  | 'done';

export type OperationStatus = z.infer<typeof operationStatusSchema>['status'];

export interface SpeakingOperationStatus {
  status: OperationStatus;
  errorCode?: string | null;
  conversationId?: string | null;
  messageId?: string | null;
  balance?: number;
}

export interface TranscribeRequest {
  audio: string;
  mimeType?: string;
  language?: string;
  /** Reuse the key from the original attempt so retries are not re-billed. */
  operationKey?: string;
}

export interface GenerateTopicRequest {
  level: string;
  category: string;
  language: string;
  /** Generate once per user intent; replay the same value for retries. */
  operationKey?: string;
  signal?: AbortSignal;
}

export interface GenerateTopicResult {
  topic: SpeakingTopic;
  operationId: string;
  balance?: number;
}

export interface WebFeedbackChunk {
  text: string;
}

function parseAtBoundary<T>(schema: z.ZodType<T>, value: unknown, context: SpeakingErrorContext): T {
  const parsed = schema.safeParse(value);
  if (!parsed.success) {
    void context;
    throw new SpeakingApiError('UNKNOWN', { statusCode: 200, cause: parsed.error });
  }
  return parsed.data;
}

function envelopeData(value: unknown): unknown {
  const record = asRecord(value);
  return record && 'data' in record ? record.data : value;
}

function apiErrorMessage(value: unknown): string | undefined {
  const payload = asRecord(value);
  const candidate = payload?.error ?? payload?.message ?? payload?.detail;
  return typeof candidate === 'string' && candidate.trim() ? candidate : undefined;
}

// ---------------------------------------------------------------------------
// Query keys
// ---------------------------------------------------------------------------

export const speakingQueryKeys = {
  all: ['speaking'] as const,
  history: () => [...speakingQueryKeys.all, 'history'] as const,
  historyPage: (page: number, limit = 10) =>
    [...speakingQueryKeys.history(), 'page', page, limit] as const,
  submission: (id: string) => [...speakingQueryKeys.all, 'submission', id] as const,
  topic: (level: string, category: string, language: string) =>
    [...speakingQueryKeys.all, 'topic', level, category, language] as const,
};

// ---------------------------------------------------------------------------
// API surface
// ---------------------------------------------------------------------------

function wsBaseUrl(apiBase: string): string {
  const base = apiBase.replace(/\/api(?:\/v\d+)?\/?$/, '').replace(/\/+$/, '');
  if (/^https:\/\//i.test(base)) return `wss://${base.slice('https://'.length)}`;
  if (/^http:\/\//i.test(base)) return `ws://${base.slice('http://'.length)}`;
  if (/^wss:\/\//i.test(base) || /^ws:\/\//i.test(base)) return base;
  return `ws://${base}`;
}

/** Build the authenticated WebSocket URL; the gateway reads the JWT from `token`. */
export function buildSpeakingWsUrl(apiBase?: string): string {
  const base = wsBaseUrl(apiBase || process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001/api/v1');
  const url = `${base}/speaking-ws`;
  const token = getAccessToken();
  return token ? `${url}?token=${encodeURIComponent(token)}` : url;
}

/**
 * Topic generation is billed through the BFF. Never mint a key here: the
 * caller owns it for the lifetime of the intent (including retries).
 */
async function generateTopic(
  request: GenerateTopicRequest,
): Promise<GenerateTopicResult> {
  const key = request.operationKey ?? createSpeakingOperationKey('topic');
  let response: Response;
  try {
    response = await fetch('/api/speaking/topic', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Idempotency-Key': key,
      },
      credentials: 'same-origin',
      body: JSON.stringify({
        level: request.level,
        category: request.category,
        language: request.language,
        idempotencyKey: key,
      }),
      signal: request.signal,
      cache: 'no-store',
    });
  } catch (error) {
    throw mapApiError(error, 'topic');
  }

  const body: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const message = apiErrorMessage(body);
    throw mapApiError(
      {
        response: {
          status: response.status,
          data: { ...(asRecord(body) ?? {}), message: message ?? '' },
        },
      },
      'topic',
    );
  }

  const payload = asRecord(body);
  if (!payload) throw new SpeakingApiError('UNKNOWN', { statusCode: response.status });

  return {
    topic: parseAtBoundary(speakingTopicSchema, payload.data, 'topic'),
    operationId: typeof payload.operationId === 'string' && payload.operationId.trim()
      ? payload.operationId
      : key,
    balance: typeof payload.balance === 'number' ? payload.balance : undefined,
  };
}

async function transcribe(request: TranscribeRequest): Promise<string> {
  try {
    const response = await apiClient.post('/speaking/transcribe', {
      audio: request.audio,
      mimeType: request.mimeType,
      language: request.language,
      ...(request.operationKey ? { idempotencyKey: request.operationKey } : {}),
    });
    return parseAtBoundary(
      transcriptResponseSchema,
      envelopeData(response.data),
      'transcribe',
    ).transcript;
  } catch (error) {
    throw mapApiError(error, 'transcribe');
  }
}

async function getHistory(page = 1, limit = 10): Promise<HistoryResponse> {
  try {
    const response = await apiClient.get('/speaking/history', {
      params: { page, limit },
    });
    return parseAtBoundary(historyResponseSchema, envelopeData(response.data), 'history');
  } catch (error) {
    throw mapApiError(error, 'history');
  }
}

async function getSubmission(id: string): Promise<SpeakingSubmission> {
  try {
    const response = await apiClient.get(`/speaking/${encodeURIComponent(id)}`);
    return parseAtBoundary(submissionSchema, envelopeData(response.data), 'submission');
  } catch (error) {
    throw mapApiError(error, 'submission');
  }
}

function parseFeedbackChunk(value: unknown): WebFeedbackChunk {
  return parseAtBoundary(feedbackChunkSchema, value, 'websocket');
}

/** Best-effort reconciliation; returns null when the endpoint is unavailable. */
async function getOperationStatus(
  operationId: string,
  signal?: AbortSignal,
): Promise<SpeakingOperationStatus | null> {
  const base = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001/api/v1';
  for (const path of [`/ai-operations/${operationId}`, `/chat/operations/${operationId}`]) {
    try {
      const response = await fetch(`${base}${path}`, {
        headers: { Authorization: `Bearer ${getAccessToken() ?? ''}` },
        signal,
        cache: 'no-store',
      });
      if (!response.ok) continue;
      const body: unknown = await response.json().catch(() => null);
      const parsed = operationStatusSchema.safeParse(envelopeData(body));
      if (!parsed.success) return null;
      const { status, errorCode, conversationId, messageId, balance } = parsed.data;
      return {
        status,
        ...(errorCode !== undefined ? { errorCode } : {}),
        ...(conversationId !== undefined ? { conversationId } : {}),
        ...(messageId !== undefined ? { messageId } : {}),
        ...(balance !== undefined ? { balance } : {}),
      };
    } catch {
      // Legacy backend or aborted request: try the next path.
    }
  }
  return null;
}

export const speakingApi = {
  generateTopic,
  transcribe,
  getHistory,
  getSubmission,
  buildWsUrl: buildSpeakingWsUrl,
  getOperationStatus,
  parseFeedbackChunk,
};

export default speakingApi;
