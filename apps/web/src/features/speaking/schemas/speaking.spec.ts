import { describe, expect, it } from 'vitest';
import {
  parseSpeakingWsEvent,
  parseTopicResponse,
  speakingHistoryResponseSchema,
  speakingScoresSchema,
  speakingTopicSchema,
  speakingWsEventSchema,
  topicRequestSchema,
  transcriptResponseSchema,
} from './speaking';

const validTopic = {
  topic: 'Một ngày ở Đà Lạt',
  prompt: 'Describe a memorable morning in Da Lat. 東京の朝について話してください。',
  tips: ['Dùng thì quá khứ', 'Mention the weather'],
  samplePhrases: ['Tôi đi dạo', 'The air was cool'],
  duration: 60,
  difficulty: 'medium',
};

const validHistoryItem = {
  id: 'cmt-123',
  topic: null,
  transcript: 'Xin chào thế giới',
  feedback: 'Good effort. こんにちは',
  scores: null,
  language: 'vietnamese',
  level: 'B1',
  durationSec: 0,
  createdAt: '2026-11-28T10:30:00.000Z',
};

describe('topicRequestSchema', () => {
  it('accepts the values sent by the speaking page', () => {
    expect(
      topicRequestSchema.parse({
        level: 'B1',
        category: 'daily',
        language: 'english',
      }),
    ).toEqual({ level: 'B1', category: 'daily', language: 'english' });
  });

  it('supplies the page defaults for omitted fields', () => {
    expect(topicRequestSchema.parse({})).toEqual({
      level: 'B1',
      category: 'daily',
      language: 'english',
    });
  });

  it('rejects unsupported level, language, category and extra keys', () => {
    for (const body of [
      { level: 'C2' },
      { level: 1 },
      { language: 'italian' },
      { category: 'unknown' },
      { level: 'B1', category: 'daily', language: 'english', idempotencyKey: 'x' },
    ]) {
      expect(topicRequestSchema.safeParse(body).success).toBe(false);
    }
  });

  it('rejects control and format characters', () => {
    expect(topicRequestSchema.safeParse({ category: 'daily\u0000' }).success).toBe(false);
    expect(topicRequestSchema.safeParse({ language: 'english‎' }).success).toBe(false);
  });
});

describe('speakingTopicSchema', () => {
  it('accepts Vietnamese and CJK text with extra server fields', () => {
    expect(
      speakingTopicSchema.parse({ ...validTopic, operationId: 'op-1', model: 'llama' }),
    ).toMatchObject(validTopic);
  });

  it('rejects missing or empty required text', () => {
    for (const key of ['topic', 'prompt'] as const) {
      const body = { ...validTopic, [key]: '   ' };
      expect(speakingTopicSchema.safeParse(body).success).toBe(false);
    }
    const missing = { ...validTopic } as Partial<typeof validTopic>;
    delete missing.tips;
    expect(speakingTopicSchema.safeParse(missing).success).toBe(false);
  });

  it('enforces duration and difficulty bounds', () => {
    expect(speakingTopicSchema.safeParse({ ...validTopic, duration: 29 }).success).toBe(false);
    expect(speakingTopicSchema.safeParse({ ...validTopic, duration: 121 }).success).toBe(false);
    expect(speakingTopicSchema.safeParse({ ...validTopic, duration: 45.5 }).success).toBe(false);
    expect(speakingTopicSchema.safeParse({ ...validTopic, difficulty: 'expert' }).success).toBe(false);
    expect(speakingTopicSchema.safeParse({ ...validTopic, duration: 30, difficulty: 'easy' }).success).toBe(true);
  });

  it('bounds arrays and rejects control characters', () => {
    expect(
      speakingTopicSchema.safeParse({
        ...validTopic,
        tips: Array.from({ length: 13 }, () => 'tip'),
      }).success,
    ).toBe(false);
    expect(
      speakingTopicSchema.safeParse({
        ...validTopic,
        samplePhrases: ['hello\u0007'],
      }).success,
    ).toBe(false);
  });
});

describe('scores', () => {
  it('accepts transcript-basis scores with extra fields and rejects out-of-range values', () => {
    expect(
      speakingScoresSchema.parse({
        overall: 85,
        grammar: 70,
        vocabulary: 90,
        basis: 'transcript',
        source: 'llama',
      }),
    ).toEqual({
      overall: 85,
      grammar: 70,
      vocabulary: 90,
      basis: 'transcript',
      source: 'llama',
    });
    expect(
      speakingScoresSchema.safeParse({ overall: 101, grammar: 70, vocabulary: 90 }).success,
    ).toBe(false);
    expect(
      speakingScoresSchema.safeParse({ overall: 50, grammar: 70.5, vocabulary: 90 }).success,
    ).toBe(false);
    expect(
      speakingScoresSchema.safeParse({ overall: -1, grammar: 70, vocabulary: 90 }).success,
    ).toBe(false);
  });
});

describe('transcriptResponseSchema', () => {
  it('accepts any script but rejects an empty transcript', () => {
    expect(transcriptResponseSchema.parse({ transcript: 'こんにちは世界' })).toEqual({
      transcript: 'こんにちは世界',
    });
    expect(transcriptResponseSchema.safeParse({ transcript: '' }).success).toBe(false);
    expect(transcriptResponseSchema.safeParse({ transcript: '  ' }).success).toBe(false);
  });
});

describe('speakingHistoryResponseSchema', () => {
  it('accepts camelCase items with null scores and extra fields', () => {
    const payload = {
      total: 1,
      page: 1,
      limit: 10,
      items: [{ ...validHistoryItem, audioUrl: 'https://example.test/a.webm' }],
    };
    expect(speakingHistoryResponseSchema.parse(payload)).toEqual(payload);
  });

  it('accepts scores with a transcript basis', () => {
    const payload = {
      total: 1,
      page: 1,
      limit: 10,
      items: [
        {
          ...validHistoryItem,
          topic: 'Travel',
          scores: { overall: 72, grammar: 60, vocabulary: 80, basis: 'transcript' },
        },
      ],
    };
    expect(speakingHistoryResponseSchema.safeParse(payload).success).toBe(true);
  });

  it('rejects snake_case-only items, invalid dates and negative duration', () => {
    const base = { total: 1, page: 1, limit: 10 };
    const snakeCase = {
      ...validHistoryItem,
      duration_sec: 3,
      created_at: validHistoryItem.createdAt,
    };
    delete (snakeCase as Record<string, unknown>).durationSec;
    delete (snakeCase as Record<string, unknown>).createdAt;
    expect(
      speakingHistoryResponseSchema.safeParse({ ...base, items: [snakeCase] }).success,
    ).toBe(false);
    expect(
      speakingHistoryResponseSchema.safeParse({
        ...base,
        items: [{ ...validHistoryItem, createdAt: 'not-a-date' }],
      }).success,
    ).toBe(false);
    expect(
      speakingHistoryResponseSchema.safeParse({
        ...base,
        items: [{ ...validHistoryItem, durationSec: -1 }],
      }).success,
    ).toBe(false);
    expect(
      speakingHistoryResponseSchema.safeParse({ ...base, page: 0, items: [] }).success,
    ).toBe(false);
  });
});

describe('speakingWsEventSchema', () => {
  const validEvents = [
    { event: 'connected', data: { sid: '123-abc', extra: true } },
    { event: 'session_ready', data: {} },
    { event: 'status', data: { phase: 'transcribing', message: 'Đang nghe...' } },
    { event: 'status', data: { phase: 'analyzing' } },
    { event: 'transcript', data: { text: 'Xin chào' } },
    { event: 'feedback_chunk', data: { chunk: 'Good ' } },
    {
      event: 'feedback_done',
      data: {
        transcript: 'Xin chào thế giới',
        feedback: 'Tốt lắm!',
        scores: { overall: 80, grammar: 70, vocabulary: 90 },
        feedbackBasis: 'transcript',
        scoresAvailable: true,
      },
    },
    { event: 'error', data: { message: 'Authentication required' } },
  ];

  it.each(validEvents)('accepts $event frames', (frame) => {
    expect(speakingWsEventSchema.safeParse(frame).success).toBe(true);
  });

  it('accepts feedback_done with null scores and extra fields', () => {
    const frame = {
      event: 'feedback_done',
      data: {
        transcript: 'hello',
        feedback: 'retry',
        scores: null,
        scoresAvailable: false,
        traceId: 't-1',
      },
    };
    const result = speakingWsEventSchema.safeParse(frame);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.event).toBe('feedback_done');
    }
  });

  it('rejects unknown events and malformed frames', () => {
    expect(speakingWsEventSchema.safeParse({ event: 'ping', data: {} }).success).toBe(false);
    expect(speakingWsEventSchema.safeParse({ event: 'transcript' }).success).toBe(false);
    expect(
      speakingWsEventSchema.safeParse({ event: 'error', data: { message: '' } }).success,
    ).toBe(false);
    expect(
      speakingWsEventSchema.safeParse({ event: 'status', data: { phase: 'done' } }).success,
    ).toBe(false);
  });
});

describe('parseTopicResponse', () => {
  it('unwraps a valid { data } envelope', () => {
    const result = parseTopicResponse({ data: validTopic, operationId: 'op-1' });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data).toMatchObject(validTopic);
  });

  it('rejects error envelopes, missing data and invalid inner payloads', () => {
    expect(parseTopicResponse({ error: 'Insufficient tokens' }).success).toBe(false);
    expect(parseTopicResponse({ data: null }).success).toBe(false);
    expect(parseTopicResponse(validTopic).success).toBe(false);
    expect(parseTopicResponse({ data: { ...validTopic, duration: 5 } }).success).toBe(false);
  });
});

describe('parseSpeakingWsEvent', () => {
  it('parses raw WebSocket message strings', () => {
    const frame = {
      event: 'feedback_done',
      data: { transcript: 'hi', feedback: 'ok', scores: null },
    };
    const result = parseSpeakingWsEvent(JSON.stringify(frame));
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.event).toBe('feedback_done');
  });

  it('returns a failure result for malformed and unknown frames without throwing', () => {
    for (const input of ['{not json', null, 42, { event: 'future_event', data: {} }]) {
      expect(() => parseSpeakingWsEvent(input)).not.toThrow();
      expect(parseSpeakingWsEvent(input).success).toBe(false);
    }
  });
});
