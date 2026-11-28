'use client';

/**
 * Speaking feedback hook (roadmap FE-07).
 *
 * Owns the two HTTP-backed speaking operations: topic generation and
 * transcript feedback. The page stays composition/UI only; media capture and
 * WebSocket streaming remain in `use-audio-recorder` / `use-speaking-session`.
 *
 * Every request is abortable and every failure is mapped to a typed error with
 * a Vietnamese message. Provider bodies are never surfaced verbatim: only an
 * allowlisted, bounded code is retained (same rule as `src/lib/sse-parser.ts`).
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { z } from 'zod';
import { getAccessToken } from '@/stores/auth-store';

export type SpeakingPhase =
  | 'ready'
  | 'topic'
  | 'recording'
  | 'connecting'
  | 'transcribing'
  | 'analyzing'
  | 'streaming'
  | 'done';

export type SpeakingErrorKind =
  | 'aborted'
  | 'unauthorized'
  | 'validation'
  | 'rate_limited'
  | 'quota'
  | 'server'
  | 'network';

export interface SpeakingTopic {
  topic: string;
  prompt: string;
  tips: string[];
  samplePhrases: string[];
  duration: number;
  difficulty: string;
}

export interface SpeakingScores {
  overall: number;
  grammar: number;
  vocabulary: number;
}

export interface SpeakingFeedback {
  text: string;
  scores: SpeakingScores | null;
  operationId?: string;
}

export interface GenerateTopicInput {
  level: string;
  category: string;
  language: string;
}

export interface RequestFeedbackInput {
  /** Transcript to assess. Validated locally before any billable call. */
  text: string;
  topic?: string;
  level?: string;
  language?: string;
}

export interface SpeakingRequestOptions {
  signal?: AbortSignal;
  /** Caller-supplied replay key; the BFF derives a stable one when omitted. */
  idempotencyKey?: string;
}

const SAFE_CODE = /^[A-Za-z0-9_.:-]{1,64}$/;

function safeCode(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0 && SAFE_CODE.test(value)
    ? value
    : undefined;
}

const MESSAGES: Record<SpeakingErrorKind, string> = {
  aborted: 'Yêu cầu đã được hủy.',
  unauthorized: 'Phiên đăng nhập hết hạn. Vui lòng đăng nhập lại và thử lại.',
  validation: 'Dữ liệu không hợp lệ. Vui lòng kiểm tra lại và thử lại.',
  rate_limited: 'Gửi quá nhiều yêu cầu. Vui lòng đợi một lát rồi thử lại.',
  quota: 'Bạn đã hết token. Vui lòng nạp thêm token để tiếp tục.',
  server: 'Dịch vụ AI tạm thời không khả dụng. Vui lòng thử lại sau.',
  network: 'Không thể kết nối tới máy chủ. Kiểm tra mạng rồi thử lại.',
};

export class SpeakingError extends Error {
  readonly isSpeakingError = true as const;
  readonly kind: SpeakingErrorKind;
  readonly status?: number;
  readonly code?: string;

  constructor(
    kind: SpeakingErrorKind,
    options: { status?: number; code?: string } = {},
  ) {
    super(MESSAGES[kind]);
    this.name = 'SpeakingError';
    this.kind = kind;
    if (typeof options.status === 'number' && Number.isFinite(options.status)) {
      this.status = options.status;
    }
    const code = safeCode(options.code);
    if (code) this.code = code;
  }
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error &&
    (error.name === 'AbortError' || error.name === 'TimeoutError');
}

function statusKind(status: number): SpeakingErrorKind {
  if (status === 401 || status === 403) return 'unauthorized';
  if (status === 429) return 'rate_limited';
  if (status >= 500) return 'server';
  return 'validation';
}

export function toSpeakingError(error: unknown): SpeakingError {
  if (error instanceof SpeakingError) return error;
  if (isAbortError(error)) return new SpeakingError('aborted');
  if (error instanceof z.ZodError) {
    return new SpeakingError('validation', { code: 'INVALID_RESPONSE' });
  }
  if (error instanceof Error && 'status' in error) {
    const status = (error as Error & { status: unknown }).status;
    if (typeof status === 'number' && Number.isFinite(status)) {
      return new SpeakingError(statusKind(status));
    }
  }
  return new SpeakingError('network');
}

/** Bounded, Unicode-safe strings; no control characters reach the backend. */
const SAFE_TEXT = /^[^\p{Cc}\p{Cf}]*$/u;
const safeString = (max: number) =>
  z
    .string()
    .max(max)
    .regex(SAFE_TEXT, 'Text contains unsupported control characters');

const topicInputSchema = z
  .object({
    level: safeString(20).regex(/^[A-Za-z0-9_-]+$/, 'Invalid level'),
    category: safeString(50).regex(/^[A-Za-z0-9_-]+$/, 'Invalid category'),
    language: safeString(30).regex(/^[a-z_-]+$/, 'Invalid language'),
  })
  .strict();

const feedbackInputSchema = z
  .object({
    text: safeString(4000).refine((value) => value.trim().length > 0, {
      message: 'Text is required',
    }),
    topic: safeString(200).optional(),
    level: safeString(20).regex(/^[A-Za-z0-9_-]+$/, 'Invalid level').optional(),
    language: safeString(30).regex(/^[a-z_-]+$/, 'Invalid language').optional(),
  })
  .strict();

const topicSchema = z
  .object({
    topic: z.string(),
    prompt: z.string(),
    tips: z.array(z.string()),
    samplePhrases: z.array(z.string()),
    duration: z.number().finite().nonnegative(),
    difficulty: z.string(),
  })
  .strict();

const topicResponseSchema = z
  .object({
    data: topicSchema,
    operationId: z.string().min(1),
    balance: z.unknown().optional(),
  })
  .passthrough();

const scoresSchema = z.object({
  overall: z.number().finite(),
  grammar: z.number().finite(),
  vocabulary: z.number().finite(),
});

const feedbackResponseSchema = z
  .object({
    data: z
      .object({
        text: z.string().optional(),
        feedback: z.string().optional(),
        transcript: z.string().optional(),
        scores: scoresSchema.nullable().optional(),
        overallFeedback: z.string().optional(),
        overallScore: z.number().finite().optional(),
        grammar: z.number().finite().optional(),
        vocabulary: z.number().finite().optional(),
      })
      .passthrough(),
    operationId: z.string().min(1).optional(),
  })
  .passthrough();

const errorEnvelopeSchema = z
  .object({
    error: z.string().optional(),
    message: z.string().optional(),
    code: z.string().optional(),
  })
  .passthrough();

function requestHeaders(idempotencyKey?: string): Record<string, string> {
  const token = getAccessToken();
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Accept: 'application/json',
  };
  if (token) headers.Authorization = `Bearer ${token}`;
  const key = safeCode(idempotencyKey);
  if (key) headers['Idempotency-Key'] = key;
  return headers;
}

/**
 * Fetch + JSON parse with a typed network/abort boundary. A failed parse is
 * never reported as a transport failure: the HTTP status still decides.
 */
async function fetchSpeakingJson(
  url: string,
  init: RequestInit & { signal?: AbortSignal },
): Promise<{ status: number; payload: unknown }> {
  let response: Response;
  try {
    response = await fetch(url, { ...init, cache: 'no-store' });
  } catch (error) {
    throw isAbortError(error) || init.signal?.aborted
      ? new SpeakingError('aborted')
      : new SpeakingError('network');
  }
  const payload: unknown = await response.json().catch(() => null);
  return { status: response.status, payload };
}

function statusError(status: number, payload: unknown): SpeakingError {
  // Only a bounded allowlisted code may reach UI/state. The provider text is
  // read solely to classify the failure and is never stored on the error.
  const envelope = errorEnvelopeSchema.safeParse(payload);
  const fields = envelope.success ? envelope.data : undefined;
  const code = safeCode(fields?.code);
  const message = fields?.error ?? fields?.message ?? '';
  const quota =
    code === 'INSUFFICIENT_CREDITS' ||
    code === 'INSUFFICIENT_TOKENS' ||
    /insufficient (tokens|credits)/i.test(message) ||
    /not enough tokens/i.test(message);

  if (quota) return new SpeakingError('quota', { status, code });
  return new SpeakingError(statusKind(status), { status, code });
}

/** Generate a billable topic. Throws only typed `SpeakingError` values. */
export async function generateSpeakingTopic(
  input: GenerateTopicInput,
  options: SpeakingRequestOptions = {},
): Promise<{ topic: SpeakingTopic; operationId: string; balance?: unknown }> {
  const body = topicInputSchema.parse(input);
  const { status, payload } = await fetchSpeakingJson('/api/speaking/topic', {
    method: 'POST',
    headers: requestHeaders(),
    body: JSON.stringify(body),
    signal: options.signal,
  });
  if (status < 200 || status >= 300) throw statusError(status, payload);

  const result = topicResponseSchema.safeParse(payload);
  if (!result.success) {
    throw new SpeakingError('validation', { status, code: 'INVALID_TOPIC' });
  }
  return {
    topic: result.data.data,
    operationId: result.data.operationId,
    ...(result.data.balance !== undefined ? { balance: result.data.balance } : {}),
  };
}

/** Request transcript feedback. Throws only typed `SpeakingError` values. */
export async function requestSpeakingFeedback(
  input: RequestFeedbackInput,
  options: SpeakingRequestOptions = {},
): Promise<SpeakingFeedback> {
  const body = feedbackInputSchema.parse(input);
  const { status, payload } = await fetchSpeakingJson('/api/speaking', {
    method: 'POST',
    headers: requestHeaders(options.idempotencyKey),
    body: JSON.stringify(body),
    signal: options.signal,
  });
  if (status < 200 || status >= 300) throw statusError(status, payload);

  const result = feedbackResponseSchema.safeParse(payload);
  if (!result.success) {
    throw new SpeakingError('validation', { status, code: 'INVALID_FEEDBACK' });
  }
  const data = result.data.data;
  const text = data.text ?? data.feedback ?? data.transcript ?? data.overallFeedback ?? '';
  let scores = data.scores ?? null;
  if (
    !scores &&
    (data.overallScore !== undefined ||
      data.grammar !== undefined ||
      data.vocabulary !== undefined)
  ) {
    const flat = scoresSchema.safeParse({
      overall: data.overallScore ?? 0,
      grammar: data.grammar ?? 0,
      vocabulary: data.vocabulary ?? 0,
    });
    if (flat.success) scores = flat.data;
  }
  return {
    text,
    scores,
    ...(result.data.operationId ? { operationId: result.data.operationId } : {}),
  };
}

export interface UseSpeakingFeedbackOptions extends GenerateTopicInput {}

export interface UseSpeakingFeedbackResult {
  topic: SpeakingTopic | null;
  phase: SpeakingPhase;
  error: SpeakingError | null;
  isGeneratingTopic: boolean;
  isAnalyzing: boolean;
  generateTopic: (input?: Partial<GenerateTopicInput>) => Promise<SpeakingTopic | null>;
  getFeedback: (input: RequestFeedbackInput) => Promise<SpeakingFeedback | null>;
  cancel: () => void;
  reset: () => void;
}

/**
 * One AbortController per in-flight request. A new request or an explicit
 * cancel/abort-and-forget aborts the previous one; only the request that still
 * owns the ref may clear it, so a stale response cannot clobber a new request.
 * Unmount aborts whatever is in flight and suppresses all state updates.
 */
export function useSpeakingFeedback(
  options: UseSpeakingFeedbackOptions,
): UseSpeakingFeedbackResult {
  const [topic, setTopic] = useState<SpeakingTopic | null>(null);
  const [phase, setPhase] = useState<SpeakingPhase>('ready');
  const [error, setError] = useState<SpeakingError | null>(null);
  const [isGeneratingTopic, setIsGeneratingTopic] = useState(false);
  const [isAnalyzing, setIsAnalyzing] = useState(false);

  const controllerRef = useRef<AbortController | null>(null);
  // The ownership ref may be cleared as soon as a request settles. Keep the
  // last controller too so unmount can always abort a still-settling request.
  const lastControllerRef = useRef<AbortController | null>(null);
  const requestSeqRef = useRef(0);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      requestSeqRef.current += 1;
      controllerRef.current?.abort();
      lastControllerRef.current?.abort();
      controllerRef.current = null;
      lastControllerRef.current = null;
    };
  }, []);

  const releaseController = useCallback((controller: AbortController) => {
    if (controllerRef.current === controller) controllerRef.current = null;
  }, []);

  /** Supersede any in-flight request without touching state here. */
  const beginRequest = useCallback((): { controller: AbortController; seq: number } => {
    controllerRef.current?.abort();
    const controller = new AbortController();
    controllerRef.current = controller;
    lastControllerRef.current = controller;
    const seq = ++requestSeqRef.current;
    return { controller, seq };
  }, []);

  const isCurrent = useCallback(
    (controller: AbortController, seq: number) =>
      mountedRef.current &&
      requestSeqRef.current === seq &&
      controllerRef.current === controller &&
      !controller.signal.aborted,
    [],
  );

  const cancel = useCallback(() => {
    requestSeqRef.current += 1;
    const controller = controllerRef.current;
    controller?.abort();
    releaseController(controller ?? new AbortController());
    if (mountedRef.current) {
      setIsGeneratingTopic(false);
      setIsAnalyzing(false);
    }
  }, [releaseController]);

  const reset = useCallback(() => {
    cancel();
    if (!mountedRef.current) return;
    setTopic(null);
    setPhase('ready');
    setError(null);
  }, [cancel]);

  const generateTopic = useCallback(
    async (input: Partial<GenerateTopicInput> = {}): Promise<SpeakingTopic | null> => {
      const { controller, seq } = beginRequest();
      if (mountedRef.current) {
        setError(null);
        setIsGeneratingTopic(true);
      }
      try {
        const result = await generateSpeakingTopic(
          {
            level: input.level ?? options.level,
            category: input.category ?? options.category,
            language: input.language ?? options.language,
          },
          { signal: controller.signal },
        );
        if (isCurrent(controller, seq)) {
          setTopic(result.topic);
          setPhase('topic');
        }
        return isCurrent(controller, seq) ? result.topic : null;
      } catch (caught) {
        const typed = toSpeakingError(caught);
        // Aborts (superseded request, cancel, unmount) are not user-visible
        // errors and never move the state machine into `error`.
        if (typed.kind !== 'aborted' && isCurrent(controller, seq)) {
          setError(typed);
          setPhase('ready');
        }
        return null;
      } finally {
        releaseController(controller);
        if (isCurrent(controller, seq)) setIsGeneratingTopic(false);
      }
    },
    [beginRequest, isCurrent, options.category, options.language, options.level, releaseController],
  );

  const getFeedback = useCallback(
    async (input: RequestFeedbackInput): Promise<SpeakingFeedback | null> => {
      const { controller, seq } = beginRequest();
      if (mountedRef.current) {
        setError(null);
        setIsAnalyzing(true);
        setPhase('analyzing');
      }
      try {
        const result = await requestSpeakingFeedback(input, { signal: controller.signal });
        if (isCurrent(controller, seq)) setPhase('done');
        return isCurrent(controller, seq) ? result : null;
      } catch (caught) {
        const typed = toSpeakingError(caught);
        if (typed.kind !== 'aborted' && isCurrent(controller, seq)) {
          setError(typed);
          setPhase(topic ? 'topic' : 'ready');
        }
        return null;
      } finally {
        releaseController(controller);
        if (isCurrent(controller, seq)) setIsAnalyzing(false);
      }
    },
    [beginRequest, isCurrent, releaseController, topic],
  );

  return {
    topic,
    phase,
    error,
    isGeneratingTopic,
    isAnalyzing,
    generateTopic,
    getFeedback,
    cancel,
    reset,
  };
}
