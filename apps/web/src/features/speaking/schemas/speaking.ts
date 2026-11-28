import { z } from 'zod';

/**
 * Boundary schemas for the speaking feature. Requests are strict (unknown keys
 * are a client bug); responses from the BFF, Nest API and WebSocket gateway are
 * deliberately permissive so new server fields cannot invalidate a session.
 */

/** Matches the edge-route guard: all Unicode scripts, no control/format chars. */
export const SAFE_TEXT_PATTERN = /^[^\p{Cc}\p{Cf}]*$/u;

export const safeText = (max: number, label = 'Text') =>
  z
    .string()
    .max(max, `${label} is too long`)
    .regex(SAFE_TEXT_PATTERN, `${label} contains unsupported control characters`);

const nonEmptyText = (max: number, label: string) =>
  safeText(max, label).refine((value) => value.trim().length > 0, {
    message: `${label} is required`,
  });

/** UI levels only; the gateway also accepts C2, but no UI control offers it. */
export const SPEAKING_LEVELS = ['A1', 'A2', 'B1', 'B2', 'C1'] as const;
export const SPEAKING_LANGUAGES = [
  'english',
  'vietnamese',
  'japanese',
  'korean',
  'chinese',
  'spanish',
  'french',
  'german',
] as const;
export const SPEAKING_CATEGORIES = [
  'daily',
  'travel',
  'work',
  'opinion',
  'story',
] as const;

export const topicRequestSchema = z
  .object({
    level: z.enum(SPEAKING_LEVELS).default('B1'),
    category: z.enum(SPEAKING_CATEGORIES).default('daily'),
    language: z.enum(SPEAKING_LANGUAGES).default('english'),
  })
  .strict();

export const speakingTopicSchema = z
  .object({
    topic: nonEmptyText(200, 'Topic'),
    prompt: nonEmptyText(2_000, 'Prompt'),
    tips: z.array(safeText(500, 'Tip')).max(12),
    samplePhrases: z.array(safeText(300, 'Sample phrase')).max(12),
    duration: z.number().int('Duration must be an integer').min(30).max(120),
    difficulty: z.enum(['easy', 'medium', 'hard']),
  })
  .passthrough();

const scoreSchema = z.number().int('Score must be an integer').min(0).max(100);

export const speakingScoresSchema = z
  .object({
    overall: scoreSchema,
    grammar: scoreSchema,
    vocabulary: scoreSchema,
    basis: z.literal('transcript').optional(),
  })
  .passthrough();

export const nullableSpeakingScoresSchema = speakingScoresSchema.nullable();

export const transcriptResponseSchema = z
  .object({
    transcript: nonEmptyText(8_000, 'Transcript'),
  })
  .passthrough();

const isoDateTime = z
  .string()
  .datetime({ offset: true })
  .refine((value) => !Number.isNaN(Date.parse(value)), 'Invalid date');

export const speakingHistoryItemSchema = z
  .object({
    id: nonEmptyText(128, 'Id'),
    topic: z.string().nullable(),
    transcript: safeText(8_000, 'Transcript'),
    feedback: safeText(12_000, 'Feedback'),
    scores: nullableSpeakingScoresSchema,
    language: nonEmptyText(30, 'Language'),
    level: nonEmptyText(20, 'Level'),
    durationSec: z.number().int('Duration must be an integer').min(0).max(86_400),
    createdAt: isoDateTime,
  })
  .passthrough();

export const speakingHistoryResponseSchema = z
  .object({
    total: z.number().int().min(0),
    page: z.number().int().min(1),
    limit: z.number().int().min(1),
    items: z.array(speakingHistoryItemSchema),
  })
  .passthrough();

const wsData = <T extends z.ZodRawShape>(shape: T) =>
  z.object(shape).passthrough();

export const speakingWsEventSchema = z.discriminatedUnion('event', [
  z.object({
    event: z.literal('connected'),
    data: wsData({ sid: nonEmptyText(128, 'Session id') }),
  }),
  z.object({
    event: z.literal('session_ready'),
    data: z.object({}).passthrough(),
  }),
  z.object({
    event: z.literal('status'),
    data: wsData({
      phase: z.enum(['transcribing', 'analyzing']).optional(),
      message: safeText(500, 'Status message').optional(),
    }),
  }),
  z.object({
    event: z.literal('transcript'),
    data: wsData({ text: nonEmptyText(8_000, 'Transcript') }),
  }),
  z.object({
    event: z.literal('feedback_chunk'),
    data: wsData({ chunk: safeText(2_000, 'Feedback chunk') }),
  }),
  z.object({
    event: z.literal('feedback_done'),
    data: wsData({
      transcript: nonEmptyText(8_000, 'Transcript'),
      feedback: safeText(12_000, 'Feedback'),
      scores: nullableSpeakingScoresSchema,
      feedbackBasis: z.literal('transcript').optional(),
      scoresAvailable: z.boolean().optional(),
    }),
  }),
  z.object({
    event: z.literal('error'),
    data: wsData({ message: nonEmptyText(500, 'Error message') }),
  }),
]);

export type TopicRequest = z.infer<typeof topicRequestSchema>;
export type SpeakingTopic = z.infer<typeof speakingTopicSchema>;
export type SpeakingScores = z.infer<typeof speakingScoresSchema>;
export type TranscriptResponse = z.infer<typeof transcriptResponseSchema>;
export type SpeakingHistoryItem = z.infer<typeof speakingHistoryItemSchema>;
export type SpeakingHistoryResponse = z.infer<typeof speakingHistoryResponseSchema>;
export type SpeakingWsEvent = z.infer<typeof speakingWsEventSchema>;

/** Uniform, non-throwing result for callers at a network boundary. */
export type SpeakingParseResult<T> =
  | { success: true; data: T }
  | { success: false; error: string };

const failure = <T>(error: string): SpeakingParseResult<T> => ({
  success: false,
  error,
});

const fromZodResult = <T>(
  result: z.SafeParseReturnType<unknown, T>,
): SpeakingParseResult<T> =>
  result.success
    ? { success: true, data: result.data }
    : failure(
        result.error.issues.map((issue) => issue.message).join('; ') ||
          'Invalid speaking payload',
      );

/**
 * Parse a `/api/speaking/topic` envelope. Error envelopes and missing `data`
 * are rejected before the inner model payload is validated.
 */
export const speakingTopicEnvelopeSchema = z
  .object({
    data: z.unknown(),
    error: z.string().optional(),
  })
  .passthrough()
  .superRefine((value, ctx) => {
    if (
      !Object.prototype.hasOwnProperty.call(value, 'data') ||
      value.data === null ||
      value.data === undefined
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Response is missing data',
        path: ['data'],
      });
    }
    if (typeof value.error === 'string' && value.error.trim()) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: value.error.trim(),
        path: ['error'],
      });
    }
  });

export function parseTopicResponse(input: unknown): SpeakingParseResult<SpeakingTopic> {
  const envelope = speakingTopicEnvelopeSchema.safeParse(input);
  if (!envelope.success) {
    return failure(
      envelope.error.issues.map((issue) => issue.message).join('; ') ||
        'Invalid topic response',
    );
  }
  return fromZodResult(speakingTopicSchema.safeParse(envelope.data.data));
}

/**
 * Accept either a parsed frame or the raw `WebSocketMessageEvent.data` string.
 * Unknown events, malformed frames and invalid JSON yield a failure result.
 */
export function parseSpeakingWsEvent(input: unknown): SpeakingParseResult<SpeakingWsEvent> {
  let value: unknown = input;
  if (typeof input === 'string') {
    try {
      value = JSON.parse(input);
    } catch {
      return failure('WebSocket frame is not valid JSON');
    }
  }
  return fromZodResult(speakingWsEventSchema.safeParse(value));
}
