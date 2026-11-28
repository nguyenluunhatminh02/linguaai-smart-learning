// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { NextRequest } from 'next/server';

/**
 * Characterization coverage for the BFF routes migrated behind the NestJS API.
 * Every upstream boundary is mocked: no provider key, token service or file
 * system is touched, and only observable HTTP status + JSON body are asserted.
 */
const harness = vi.hoisted(() => {
  // Deterministic configuration installed before route modules evaluate their
  // module-level constants. Values are test-only placeholders.
  process.env.NEXT_PUBLIC_API_URL = 'http://api.test/api/v1';
  process.env.CMS_BACKEND_URL = 'http://cms.test/api/v1';
  process.env.INTERNAL_API_URL = '';
  process.env.GROQ_API_KEY = 'test-only-key';
  process.env.GROQ_MODEL = 'test-model';

  class DummyNextRequest extends Request {}

  // A class (not a bare object) keeps `err instanceof NextResponse` in the
  // listening upload route from throwing on the error path.
  class DummyNextResponse {
    static json(body: unknown, init?: ResponseInit): Response {
      return new Response(JSON.stringify(body), {
        status: init?.status ?? 200,
        headers: init?.headers,
      });
    }
  }

  const fsMock = {
    existsSync: vi.fn(() => true),
    mkdirSync: vi.fn(),
    writeFileSync: vi.fn(),
    promises: {
      mkdir: vi.fn(),
      writeFile: vi.fn(),
      unlink: vi.fn(),
    },
  };

  return {
    DummyNextRequest,
    DummyNextResponse,
    fsMock,
    mocks: {
      verifyAuthHeader: vi.fn(),
      isAdmin: vi.fn(),
      fetch: vi.fn(),
      createLesson: vi.fn(),
    },
  };
});

vi.mock('next/server', () => ({
  NextRequest: harness.DummyNextRequest,
  NextResponse: harness.DummyNextResponse,
}));

vi.mock('@/lib/auth/jwt-verify', () => ({
  verifyAuthHeader: harness.mocks.verifyAuthHeader,
  isAdmin: harness.mocks.isAdmin,
}));

vi.mock('@/lib/cms-storage', () => ({
  createLesson: harness.mocks.createLesson,
}));

vi.mock('fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('fs')>();
  return {
    ...actual,
    default: {
      ...((actual as unknown as { default?: Record<string, unknown> }).default ?? {}),
      ...harness.fsMock,
      promises: { ...actual.promises, ...harness.fsMock.promises },
    },
    ...harness.fsMock,
    promises: { ...actual.promises, ...harness.fsMock.promises },
  };
});

import { POST as translationGenerate } from './translation/generate/route';
import { POST as listeningGenerate } from './listening/generate/route';
import { POST as speakingFeedback } from './speaking/route';
import { POST as speakingTopic } from './speaking/topic/route';
import { POST as transcriptGenerate } from './cms/lessons/generate-from-transcript/route';
import { POST as cmsUpload } from './cms/upload/route';
import { POST as audioUpload } from './cms/upload-audio/route';
import { POST as listeningUpload } from './listening/upload-user/route';

const learner = {
  id: 'user-123',
  email: 'learner@test.invalid',
  roles: ['STUDENT'],
  isAdmin: false,
};
const admin = {
  id: 'admin-1',
  email: 'admin@test.invalid',
  roles: ['ADMIN'],
  isAdmin: true,
};

const OPERATION_ID = '11111111-1111-4111-8111-111111111111';
const AUDIO_URL = 'https://cdn.test/uploads/user-123/audio.mp3';
const YOUTUBE_URL = 'https://www.youtube.com/watch?v=abcdefghijK';
const TRANSCRIPT = 'Toi la Lan. Xin chao ban.';
const PNG = Uint8Array.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d,
]);
// RIFF header with a non-WAVE form type: suitable for negative byte tests.
const WAV = Uint8Array.from([
  0x52, 0x49, 0x46, 0x46, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
]);
const VALID_WAV = Uint8Array.from([
  0x52, 0x49, 0x46, 0x46, 0x00, 0x00, 0x00, 0x00, 0x57, 0x41, 0x56, 0x45,
]);
const AI_LESSON = {
  titleVi: 'Bai nghe',
  vocabulary: [
    { word: 'Xin chao', definition: 'hello', definitionVi: 'xin chào' },
  ],
  questions: [
    {
      question: 'Who is speaking?',
      options: ['Lan', 'Mai', 'Nam', 'Nobody'],
      correctAnswer: 0,
      explanation: 'The transcript says Toi la Lan.',
      evidence: 'Toi la Lan.',
    },
  ],
};

function jsonResponse(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  });
}

function textResponse(body: string, status: number): Response {
  return new Response(body, { status });
}

function request(path: string, init: RequestInit = {}): NextRequest {
  return new harness.DummyNextRequest(`http://localhost${path}`, init) as unknown as NextRequest;
}

function auth(extra: Record<string, string> = {}): Record<string, string> {
  return { Authorization: 'Bearer test-token', ...extra };
}

function jsonRequest(path: string, body: unknown, extra: Record<string, string> = {}): NextRequest {
  return request(path, {
    method: 'POST',
    headers: { ...auth(), 'content-type': 'application/json', ...extra },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
}

function formRequest(path: string, form: FormData, extra: Record<string, string> = {}): NextRequest {
  return request(path, { method: 'POST', headers: auth(extra), body: form });
}

function formWithFile(name: string, bytes: Uint8Array<ArrayBuffer>, type: string, fields: Record<string, string> = {}): FormData {
  const form = new FormData();
  form.append('file', new File([bytes], name, { type }));
  for (const [key, value] of Object.entries(fields)) form.append(key, value);
  return form;
}

function fetchCalls(): Array<[string, RequestInit]> {
  return harness.mocks.fetch.mock.calls as Array<[string, RequestInit]>;
}

function header(init: RequestInit | undefined, name: string): string | null {
  return new Headers(init?.headers).get(name);
}

async function outcome(res: Response): Promise<{ status: number; body: { error?: string; [key: string]: unknown } }> {
  return { status: res.status, body: await res.json() };
}

function expectNoFsWrites(): void {
  expect(harness.fsMock.writeFileSync).not.toHaveBeenCalled();
  expect(harness.fsMock.existsSync).not.toHaveBeenCalled();
  expect(harness.fsMock.promises.mkdir).not.toHaveBeenCalled();
  expect(harness.fsMock.promises.writeFile).not.toHaveBeenCalled();
  expect(harness.fsMock.promises.unlink).not.toHaveBeenCalled();
}

async function withOneSecondPoll(call: () => Promise<Response>): Promise<Response> {
  vi.useFakeTimers();
  try {
    const pending = call();
    await vi.advanceTimersByTimeAsync(1_000);
    return await pending;
  } finally {
    vi.useRealTimers();
  }
}

beforeEach(() => {
  vi.clearAllMocks();
  harness.mocks.verifyAuthHeader.mockResolvedValue(learner);
  harness.mocks.isAdmin.mockImplementation((user: typeof learner | null) => Boolean(user?.isAdmin));
  harness.mocks.fetch.mockResolvedValue(jsonResponse({}));
  harness.mocks.createLesson.mockResolvedValue({ id: 'lesson-1' });
  vi.stubGlobal('fetch', harness.mocks.fetch);
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('POST /api/translation/generate', () => {
  it('rejects anonymous callers before parsing the body', async () => {
    harness.mocks.verifyAuthHeader.mockResolvedValue(null);
    expect(await outcome(await translationGenerate(jsonRequest('/api/translation/generate', {}, { Authorization: '' })))).toEqual({
      status: 401,
      body: { error: 'Unauthorized' },
    });
    expect(harness.mocks.fetch).not.toHaveBeenCalled();
  });

  it('returns 400 for malformed JSON', async () => {
    expect(await outcome(await translationGenerate(jsonRequest('/api/translation/generate', '{bad')))).toEqual({
      status: 400,
      body: { error: 'Invalid request body' },
    });
  });

  it('relays the legacy { data } shape and forwards an idempotency key', async () => {
    const data = { sentences: [{ source: 'hello', translated: 'xin chào' }] };
    harness.mocks.fetch.mockResolvedValue(jsonResponse({ data }));
    expect(await outcome(await translationGenerate(jsonRequest('/api/translation/generate', { text: 'hello' })))).toEqual({
      status: 200,
      body: { data },
    });
    expect(fetchCalls()[0][0]).toBe('http://api.test/api/v1/translation/generate');
    expect(header(fetchCalls()[0][1], 'Authorization')).toBe('Bearer test-token');
    expect(header(fetchCalls()[0][1], 'Idempotency-Key')).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('treats a 200 response without data as a broken backend contract', async () => {
    harness.mocks.fetch.mockResolvedValue(jsonResponse({ nothing: true }));
    expect(await outcome(await translationGenerate(jsonRequest('/api/translation/generate', {})))).toEqual({
      status: 502,
      body: { error: 'Invalid AI response' },
    });
  });

  it.each([
    [400, undefined, 400, 'Invalid request'],
    [400, { error: 'Bad input' }, 400, 'Bad input'],
    [401, undefined, 401, 'Unauthorized'],
    [403, { message: 'Forbidden' }, 401, 'Unauthorized'],
    [402, undefined, 402, 'Insufficient tokens'],
    [409, { detail: 'Seen before' }, 409, 'Seen before'],
    [429, undefined, 429, 'Too many requests'],
    [502, undefined, 502, 'AI service temporarily unavailable'],
    [500, undefined, 500, 'Internal server error'],
    [418, { message: 'Unexpected' }, 502, 'Unexpected'],
  ])('maps backend %i to the legacy UI error contract', async (upstream, payload, status, error) => {
    harness.mocks.fetch.mockResolvedValue(
      payload ? jsonResponse(payload, upstream) : textResponse('gateway error', upstream),
    );
    expect(await outcome(await translationGenerate(jsonRequest('/api/translation/generate', {})))).toEqual({
      status,
      body: { error },
    });
  });

  it('returns 502 when the upstream connection fails', async () => {
    harness.mocks.fetch.mockRejectedValue(new Error('network down'));
    expect(await outcome(await translationGenerate(jsonRequest('/api/translation/generate', {})))).toEqual({
      status: 502,
      body: { error: 'Failed to connect to translation service' },
    });
  });
});

describe('POST /api/listening/generate', () => {
  it('rejects anonymous callers', async () => {
    harness.mocks.verifyAuthHeader.mockResolvedValue(null);
    expect(await outcome(await listeningGenerate(jsonRequest('/api/listening/generate', {})))).toEqual({
      status: 401,
      body: { error: 'Unauthorized' },
    });
  });

  it.each([
    [{}, 'Invalid topic'],
    [{ topic: '   ' }, 'Invalid topic'],
    [{ topic: 'x'.repeat(501) }, 'Invalid topic'],
    [{ topic: 'ok', level: 'Z9' }, 'Invalid level'],
    [{ topic: 'ok', category: 'unknown' }, 'Invalid category'],
  ])('rejects invalid local input %j before calling the backend', async (body, error) => {
    expect(await outcome(await listeningGenerate(jsonRequest('/api/listening/generate', body)))).toEqual({
      status: 400,
      body: { error },
    });
    expect(harness.mocks.fetch).not.toHaveBeenCalled();
  });

  it('normalizes topic/level/category and relays { data }', async () => {
    const data = { id: 'lesson-1' };
    harness.mocks.fetch.mockResolvedValue(jsonResponse({ data }));
    const res = await listeningGenerate(
      jsonRequest('/api/listening/generate', { topic: '  daily life ', level: 'A2', category: 'news' }),
    );
    expect(await outcome(res)).toEqual({ status: 200, body: { data } });
    const [url, init] = fetchCalls()[0];
    expect(url).toBe('http://api.test/api/v1/listening/generate');
    expect(JSON.parse(String(init.body))).toEqual({ topic: 'daily life', level: 'A2', category: 'news' });
    expect(header(init, 'Idempotency-Key')).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('omits optional fields rather than forwarding nulls', async () => {
    harness.mocks.fetch.mockResolvedValue(jsonResponse({ data: { ok: true } }));
    await listeningGenerate(jsonRequest('/api/listening/generate', { topic: 'travel' }));
    expect(JSON.parse(String(fetchCalls()[0][1].body))).toEqual({ topic: 'travel' });
  });

  it('treats a 200 response without data as 502', async () => {
    harness.mocks.fetch.mockResolvedValue(jsonResponse({}));
    expect(await outcome(await listeningGenerate(jsonRequest('/api/listening/generate', { topic: 'travel' })))).toEqual({
      status: 502,
      body: { error: 'Invalid AI response' },
    });
  });

  it.each([
    [400, undefined, 400, 'Invalid request'],
    [400, { error: 'Topic too short' }, 400, 'Topic too short'],
    [401, undefined, 401, 'Unauthorized'],
    [403, undefined, 401, 'Unauthorized'],
    [402, undefined, 402, 'Insufficient tokens'],
    [409, undefined, 409, 'Duplicate request'],
    [429, undefined, 429, 'Too many requests'],
    [502, undefined, 502, 'AI service temporarily unavailable'],
    [503, undefined, 500, 'Internal server error'],
    [418, undefined, 502, 'Failed to generate listening exercise'],
  ])('maps backend %i to %i / %s', async (upstream, payload, status, error) => {
    harness.mocks.fetch.mockResolvedValue(
      payload ? jsonResponse(payload, upstream) : textResponse('bad gateway', upstream),
    );
    expect(await outcome(await listeningGenerate(jsonRequest('/api/listening/generate', { topic: 'travel' })))).toEqual({
      status,
      body: { error },
    });
  });

  it('returns 502 when the upstream connection fails', async () => {
    harness.mocks.fetch.mockRejectedValue(new Error('offline'));
    expect(await outcome(await listeningGenerate(jsonRequest('/api/listening/generate', { topic: 'travel' })))).toEqual({
      status: 502,
      body: { error: 'Failed to connect to listening service' },
    });
  });
});

describe('POST /api/speaking', () => {
  const valid = { text: 'Hello there', level: 'B1', language: 'english' };

  it('rejects anonymous callers', async () => {
    harness.mocks.verifyAuthHeader.mockResolvedValue(null);
    expect(await outcome(await speakingFeedback(jsonRequest('/api/speaking', valid)))).toEqual({
      status: 401,
      body: { error: 'Unauthorized' },
    });
    expect(harness.mocks.fetch).not.toHaveBeenCalled();
  });

  it('returns 400 for malformed JSON', async () => {
    expect(await outcome(await speakingFeedback(jsonRequest('/api/speaking', '{bad')))).toEqual({
      status: 400,
      body: { error: 'Invalid request body' },
    });
  });

  it.each([
    [{ text: '   ' }, 'Text is required'],
    [{ text: 'ok\u0007'}, 'Text contains unsupported control characters'],
    [{ text: 'x'.repeat(4001) }, null],
    [{ ...valid, unexpected: true }, null],
  ])('rejects invalid payload %j at the edge', async (body, error) => {
    const result = await outcome(await speakingFeedback(jsonRequest('/api/speaking', body)));
    expect(result.status).toBe(400);
    expect(typeof result.body.error).toBe('string');
    if (error) expect(result.body.error).toBe(error);
    expect(harness.mocks.fetch).not.toHaveBeenCalled();
  });

  it('reuses a valid caller idempotency key and forwards the backend envelope', async () => {
    const payload = { operationId: 'op-1', data: { score: 8 } };
    harness.mocks.fetch.mockResolvedValue(jsonResponse(payload));
    const res = await speakingFeedback(
      jsonRequest('/api/speaking', valid, { 'idempotency-key': 'client.key:1' }),
    );
    expect(await outcome(res)).toEqual({ status: 200, body: payload });
    expect(fetchCalls()[0][0]).toBe('http://api.test/api/v1/speaking/feedback');
    expect(header(fetchCalls()[0][1], 'Idempotency-Key')).toBe('client.key:1');
    expect(JSON.parse(String(fetchCalls()[0][1].body))).toEqual(valid);
  });

  it('derives a stable hashed key when the caller key is unusable', async () => {
    harness.mocks.fetch.mockResolvedValue(jsonResponse({ operationId: 'op-2', data: {} }));
    await speakingFeedback(
      jsonRequest('/api/speaking', valid, { 'idempotency-key': 'has spaces' }),
    );
    const key = header(fetchCalls()[0][1], 'Idempotency-Key');
    expect(key).toMatch(/^[0-9a-f]{64}$/);
    expect(key).not.toBe('has spaces');
  });

  it('forwards non-200 upstream statuses unchanged', async () => {
    harness.mocks.fetch.mockResolvedValue(
      jsonResponse({ error: 'Not enough tokens' }, 402),
    );
    expect(await outcome(await speakingFeedback(jsonRequest('/api/speaking', valid)))).toEqual({
      status: 402,
      body: { error: 'Not enough tokens' },
    });
  });

  it('returns 502 for a non-JSON backend reply or connection failure', async () => {
    harness.mocks.fetch.mockResolvedValueOnce(textResponse('<html>', 200));
    expect(await outcome(await speakingFeedback(jsonRequest('/api/speaking', valid)))).toEqual({
      status: 502,
      body: { error: 'Invalid response from speaking service' },
    });
    harness.mocks.fetch.mockRejectedValueOnce(new Error('timeout'));
    expect(await outcome(await speakingFeedback(jsonRequest('/api/speaking', valid)))).toEqual({
      status: 502,
      body: { error: 'Speaking feedback service unavailable' },
    });
  });
});

describe('POST /api/speaking/topic', () => {
  it('rejects anonymous callers', async () => {
    harness.mocks.verifyAuthHeader.mockResolvedValue(null);
    expect(await outcome(await speakingTopic(jsonRequest('/api/speaking/topic', {})))).toEqual({
      status: 401,
      body: { error: 'Unauthorized' },
    });
  });

  it.each([
    ['{bad', 'Invalid request body'],
    [JSON.stringify([]), 'Invalid speaking topic request'],
    [JSON.stringify({ language: 'x'.repeat(31) }), 'Invalid speaking topic request'],
    [JSON.stringify({ idempotencyKey: 'bad key' }), 'Invalid speaking topic request'],
  ])('rejects malformed request %s', async (raw, error) => {
    expect(await outcome(await speakingTopic(jsonRequest('/api/speaking/topic', raw)))).toEqual({
      status: 400,
      body: { error },
    });
    expect(harness.mocks.fetch).not.toHaveBeenCalled();
  });

  it('applies language/level/category defaults and mints a stable key', async () => {
    const payload = { data: { topics: [] }, operationId: 'op-9', balance: 42 };
    harness.mocks.fetch.mockResolvedValue(jsonResponse(payload));
    expect(await outcome(await speakingTopic(jsonRequest('/api/speaking/topic', {})))).toEqual({
      status: 200,
      body: payload,
    });
    const [url, init] = fetchCalls()[0];
    expect(url).toBe('http://api.test/api/v1/speaking/topic/generate');
    expect(JSON.parse(String(init.body))).toEqual({
      language: 'english',
      level: 'B1',
      category: 'general',
    });
    expect(header(init, 'Idempotency-Key')).toMatch(/^[0-9a-f]{64}$/);
    expect(header(init, 'Authorization')).toBe('Bearer test-token');
  });

  it('prefers the header key over the body key and lowercases language', async () => {
    harness.mocks.fetch.mockResolvedValue(
      jsonResponse({ data: {}, operationId: OPERATION_ID }),
    );
    await speakingTopic(
      jsonRequest(
        '/api/speaking/topic',
        { language: 'VIETNAMESE', level: 'a2', category: ' Daily ', idempotencyKey: 'from-body' },
        { 'idempotency-key': 'from-header' },
      ),
    );
    expect(header(fetchCalls()[0][1], 'Idempotency-Key')).toBe('from-header');
    expect(JSON.parse(String(fetchCalls()[0][1].body))).toEqual({
      language: 'vietnamese',
      level: 'a2',
      category: 'Daily',
    });
  });

  it.each([
    [202, { error: 'Working on it', operationId: 'op-1' }, 202, { error: 'Working on it', operationId: 'op-1' }],
    [400, { code: 'INSUFFICIENT_CREDITS' }, 400, { error: 'Insufficient tokens' }],
    [400, { error: 'Bad level' }, 400, { error: 'Bad level' }],
    [402, { message: 'Insufficient credits' }, 400, { error: 'Insufficient tokens' }],
    [401, undefined, 401, { error: 'Unauthorized' }],
    [403, undefined, 401, { error: 'Unauthorized' }],
    [409, { error: 'Duplicate request', operationId: 'op-1' }, 409, { error: 'Duplicate request', operationId: 'op-1' }],
    [422, { error: 'Invalid AI output' }, 422, { error: 'Invalid AI output' }],
    [429, { error: 'Slow down' }, 429, { error: 'Slow down' }],
    [503, undefined, 502, { error: 'AI service temporarily unavailable' }],
    [418, undefined, 502, { error: 'Failed to generate speaking topic' }],
  ])('maps backend %i to %i', async (upstream, payload, status, body) => {
    harness.mocks.fetch.mockResolvedValue(
      payload ? jsonResponse(payload, upstream) : textResponse('gateway', upstream),
    );
    expect(await outcome(await speakingTopic(jsonRequest('/api/speaking/topic', {})))).toEqual({
      status,
      body,
    });
  });

  it.each([
    [{ data: {}, operationId: '' }],
    [{ operationId: OPERATION_ID }],
  ])('rejects a paid 200 response without durable data/operationId', async (payload) => {
    harness.mocks.fetch.mockResolvedValue(jsonResponse(payload));
    expect(await outcome(await speakingTopic(jsonRequest('/api/speaking/topic', {})))).toEqual({
      status: 502,
      body: { error: 'Invalid AI response' },
    });
  });

  it('returns 502 when the backend cannot be reached', async () => {
    harness.mocks.fetch.mockRejectedValue(new Error('ECONNREFUSED'));
    expect(await outcome(await speakingTopic(jsonRequest('/api/speaking/topic', {})))).toEqual({
      status: 502,
      body: { error: 'Failed to connect to speaking service' },
    });
  });
});

describe('POST /api/cms/lessons/generate-from-transcript', () => {
  const path = '/api/cms/lessons/generate-from-transcript';
  const body = { transcript: 'Hello world', language: 'ENGLISH', level: 'b1' };
  const operation = (status: string) => ({
    success: true,
    data: { operationId: OPERATION_ID, status },
  });

  beforeEach(() => {
    harness.mocks.verifyAuthHeader.mockResolvedValue(admin);
  });

  it('rejects missing, non-admin and failing verification without a backend call', async () => {
    harness.mocks.verifyAuthHeader.mockResolvedValue(null);
    expect(await outcome(await transcriptGenerate(jsonRequest(path, body, { Authorization: '' })))).toEqual({
      status: 401,
      body: { error: 'Unauthorized' },
    });
    harness.mocks.verifyAuthHeader.mockResolvedValue(learner);
    expect(await outcome(await transcriptGenerate(jsonRequest(path, body)))).toEqual({
      status: 401,
      body: { error: 'Unauthorized' },
    });
    harness.mocks.verifyAuthHeader.mockRejectedValue(new Error('bad signature'));
    expect(await outcome(await transcriptGenerate(jsonRequest(path, body)))).toEqual({
      status: 401,
      body: { error: 'Unauthorized' },
    });
    expect(harness.mocks.fetch).not.toHaveBeenCalled();
  });

  it('returns 400 for malformed JSON and invalid fields', async () => {
    expect(await outcome(await transcriptGenerate(jsonRequest(path, '{bad')))).toEqual({
      status: 400,
      body: { error: 'Invalid request body' },
    });
    const cases: Array<[unknown, string]> = [
      [{ transcript: '  ' }, 'Transcript is required'],
      [{ transcript: 'x'.repeat(20_001) }, 'Transcript must be at most 20000 characters'],
      [{ transcript: 'ok', language: 'klingon' }, 'Unsupported transcript language'],
      [{ transcript: 'ok', level: 'Z9' }, 'Unsupported level'],
    ];
    for (const [payload, error] of cases) {
      expect(await outcome(await transcriptGenerate(jsonRequest(path, payload)))).toEqual({
        status: 400,
        body: { error },
      });
    }
    expect(await outcome(
      await transcriptGenerate(jsonRequest(path, body, { 'x-client-operation-id': 'x'.repeat(129) })),
    )).toEqual({ status: 400, body: { error: 'Idempotency key is too long' } });
    expect(harness.mocks.fetch).not.toHaveBeenCalled();
  });

  it('returns the legacy draft shape for a synchronously succeeded operation', async () => {
    const draft = { vocabulary: [{ word: 'hello' }], questions: [{ question: 'Q?' }] };
    harness.mocks.fetch.mockResolvedValue(
      jsonResponse({
        success: true,
        data: { operationId: OPERATION_ID, status: 'SUCCEEDED', draft },
      }),
    );
    expect(await outcome(
      await transcriptGenerate(jsonRequest(path, body, { 'x-client-operation-id': 'client-1' })),
    )).toEqual({ status: 200, body: { data: draft, operationId: OPERATION_ID } });
    const [url, init] = fetchCalls()[0];
    expect(url).toBe('http://cms.test/api/v1/content-workflow/generate-from-transcript');
    expect(header(init, 'Authorization')).toBe('Bearer test-token');
    expect(JSON.parse(String(init.body))).toEqual({
      transcript: 'Hello world',
      language: 'english',
      level: 'B1',
      clientOperationId: 'client-1',
    });
  });

  it('polls a processing operation and returns the terminal draft', async () => {
    harness.mocks.fetch
      .mockResolvedValueOnce(jsonResponse(operation('PROCESSING')))
      .mockResolvedValueOnce(jsonResponse({
        success: true,
        data: { operationId: OPERATION_ID, status: 'SUCCEEDED', draft: { questions: [] } },
      }));
    const res = await withOneSecondPoll(() => transcriptGenerate(jsonRequest(path, body)));
    expect(await outcome(res)).toEqual({
      status: 200,
      body: { data: { questions: [] }, operationId: OPERATION_ID },
    });
    expect(fetchCalls()).toHaveLength(2);
    expect(fetchCalls()[1][0]).toBe(
      `http://cms.test/api/v1/content-workflow/operations/${OPERATION_ID}`,
    );
    expect(fetchCalls()[1][1].method).toBe('GET');
  });

  it('preserves backend error codes and messages on initiation failure', async () => {
    harness.mocks.fetch.mockResolvedValue(
      jsonResponse({ success: false, errorCode: 'RATE_LIMITED', message: 'Slow down' }, 429),
    );
    expect(await outcome(await transcriptGenerate(jsonRequest(path, body)))).toEqual({
      status: 429,
      body: { error: 'Slow down', code: 'RATE_LIMITED' },
    });
  });

  it.each([
    [{ success: true, data: { operationId: 'not-a-uuid', status: 'SUCCEEDED' } }, 'Invalid generation response'],
    [{ success: true, data: { operationId: OPERATION_ID, status: 'SUCCEEDED' } }, 'Generated draft is unavailable'],
  ])('rejects broken terminal payloads with 502', async (payload, error) => {
    harness.mocks.fetch.mockResolvedValue(jsonResponse(payload));
    expect(await outcome(await transcriptGenerate(jsonRequest(path, body)))).toEqual({
      status: 502,
      body: { error },
    });
  });

  it('returns FAILED and UNKNOWN terminal states as distinct contracts', async () => {
    harness.mocks.fetch.mockResolvedValueOnce(jsonResponse({
      success: true,
      data: { operationId: OPERATION_ID, status: 'FAILED', errorCode: 'PROVIDER_TIMEOUT' },
    }));
    expect(await outcome(await transcriptGenerate(jsonRequest(path, body)))).toEqual({
      status: 502,
      body: { error: 'Generation failed', code: 'PROVIDER_TIMEOUT', operationId: OPERATION_ID },
    });
    harness.mocks.fetch.mockResolvedValueOnce(jsonResponse(operation('UNKNOWN')));
    expect(await outcome(await transcriptGenerate(jsonRequest(path, body)))).toEqual({
      status: 202,
      body: {
        error: 'Generation is still processing',
        code: 'OPERATION_UNKNOWN',
        operationId: OPERATION_ID,
        status: 'UNKNOWN',
      },
    });
  });

  it('maps poll failures to 502', async () => {
    harness.mocks.fetch
      .mockResolvedValueOnce(jsonResponse(operation('PROCESSING')))
      .mockRejectedValueOnce(new Error('network down'));
    expect(await outcome(await withOneSecondPoll(() => transcriptGenerate(jsonRequest(path, body))))).toEqual({
      status: 502,
      body: { error: 'Generation service temporarily unavailable' },
    });
  });

  it('maps connection failure during initiation to 502', async () => {
    harness.mocks.fetch.mockRejectedValue(new Error('offline'));
    expect(await outcome(await transcriptGenerate(jsonRequest(path, body)))).toEqual({
      status: 502,
      body: { error: 'Generation service temporarily unavailable' },
    });
  });
});

describe('POST /api/cms/upload', () => {
  const path = '/api/cms/upload';

  beforeEach(() => {
    harness.mocks.verifyAuthHeader.mockResolvedValue(admin);
  });

  it('rejects non-admins without calling the backend or writing files', async () => {
    harness.mocks.verifyAuthHeader.mockResolvedValue(learner);
    const res = await cmsUpload(formRequest(path, formWithFile('a.png', PNG, 'image/png')));
    expect(await outcome(res)).toEqual({ status: 401, body: { error: 'Unauthorized' } });
    expect(harness.mocks.fetch).not.toHaveBeenCalled();
    expectNoFsWrites();
  });

  it.each([
    [new Uint8Array(), 'image/png', 'No file provided'],
    [PNG, 'application/pdf', 'Unsupported format. Accepted: JPEG, PNG, GIF, WebP'],
    [WAV, 'image/png', 'File content does not match declared format'],
  ])('rejects bad image payloads before the backend call', async (bytes, type, error) => {
    const res = await cmsUpload(formRequest(path, formWithFile('a.png', bytes, type)));
    expect(await outcome(res)).toEqual({ status: 400, body: { error } });
    expect(harness.mocks.fetch).not.toHaveBeenCalled();
    expectNoFsWrites();
  });

  it('rejects a filename/MIME mismatch and files over 5MB', async () => {
    expect(await outcome(
      await cmsUpload(formRequest(path, formWithFile('a.jpg', PNG, 'image/png'))),
    )).toEqual({ status: 400, body: { error: 'File extension does not match its MIME type' } });
    const huge = formWithFile('big.png', new Uint8Array(5 * 1024 * 1024 + 1), 'image/png');
    expect(await outcome(await cmsUpload(formRequest(path, huge)))).toEqual({
      status: 400,
      body: { error: 'File too large. Maximum 5MB' },
    });
    expect(harness.mocks.fetch).not.toHaveBeenCalled();
  });

  it('returns 400 for a broken multipart body', async () => {
    const res = await cmsUpload(request(path, {
      method: 'POST',
      headers: { ...auth(), 'content-type': 'multipart/form-data' },
      body: 'not-multipart',
    }));
    expect(await outcome(res)).toEqual({ status: 400, body: { error: 'Invalid multipart payload' } });
  });

  it('forwards validated bytes with a neutral name and unwraps { data }', async () => {
    harness.mocks.fetch.mockResolvedValue(
      jsonResponse({ data: { url: AUDIO_URL, id: 'file-1' } }),
    );
    const res = await cmsUpload(
      formRequest(path, formWithFile('../../evil.png', PNG, 'image/png')),
    );
    expect(await outcome(res)).toEqual({
      status: 200,
      body: { url: AUDIO_URL, id: 'file-1' },
    });
    expect(fetchCalls()[0][0]).toBe('http://cms.test/api/v1/files/upload');
    expect(header(fetchCalls()[0][1], 'Authorization')).toBe('Bearer test-token');
    const forwarded = (fetchCalls()[0][1].body as FormData).get('file') as File;
    expect(forwarded.name).toBe('upload.png');
    expect(Array.from(new Uint8Array(await forwarded.arrayBuffer()))).toEqual(Array.from(PNG));
    expectNoFsWrites();
  });

  it.each([401, 403])('maps backend %i to 401', async (status) => {
    harness.mocks.fetch.mockResolvedValue(jsonResponse({}, status));
    expect(await outcome(await cmsUpload(formRequest(path, formWithFile('a.png', PNG, 'image/png'))))).toEqual({
      status: 401,
      body: { error: 'Unauthorized' },
    });
    expectNoFsWrites();
  });

  it.each([400, 413, 500, 503])('maps backend %i to 502', async (status) => {
    harness.mocks.fetch.mockResolvedValue(jsonResponse({}, status));
    expect(await outcome(await cmsUpload(formRequest(path, formWithFile('a.png', PNG, 'image/png'))))).toEqual({
      status: 502,
      body: { error: 'Upload service unavailable' },
    });
  });

  it('rejects an invalid backend reply or connection error with 502', async () => {
    harness.mocks.fetch.mockResolvedValueOnce(jsonResponse({ nope: true }));
    expect(await outcome(await cmsUpload(formRequest(path, formWithFile('a.png', PNG, 'image/png'))))).toEqual({
      status: 502,
      body: { error: 'Upload service returned an invalid response' },
    });
    harness.mocks.fetch.mockRejectedValueOnce(new Error('offline'));
    expect(await outcome(await cmsUpload(formRequest(path, formWithFile('a.png', PNG, 'image/png'))))).toEqual({
      status: 502,
      body: { error: 'Upload service unavailable' },
    });
    expectNoFsWrites();
  });
});

describe('POST /api/cms/upload-audio', () => {
  const path = '/api/cms/upload-audio';

  beforeEach(() => {
    harness.mocks.verifyAuthHeader.mockResolvedValue(admin);
  });

  it('rejects non-admins without a backend call or file write', async () => {
    harness.mocks.verifyAuthHeader.mockResolvedValue(null);
    expect(await outcome(await audioUpload(formRequest(path, formWithFile('a.mp3', WAV, 'audio/wav'))))).toEqual({
      status: 401,
      body: { error: 'Unauthorized' },
    });
    expect(harness.mocks.fetch).not.toHaveBeenCalled();
    expectNoFsWrites();
  });

  it('rejects oversized declared content-length before parsing', async () => {
    const res = await audioUpload(formRequest(
      path,
      formWithFile('a.wav', WAV, 'audio/wav'),
      { 'content-length': String(10 * 1024 * 1024 + 1) },
    ));
    expect(await outcome(res)).toEqual({
      status: 400,
      body: { error: 'File too large. Maximum 10MB' },
    });
    expect(harness.mocks.fetch).not.toHaveBeenCalled();
  });

  it.each([
    [new Uint8Array(), 'audio/wav', 'File is empty'],
    [WAV, 'video/mp4', 'Unsupported format. Accepted: MP3, WAV, OGG, M4A, AAC, FLAC'],
    [PNG, 'audio/wav', 'File content does not match declared format'],
  ])('rejects invalid audio bytes before upstream calls', async (bytes, type, error) => {
    expect(await outcome(await audioUpload(formRequest(path, formWithFile('a.wav', bytes, type))))).toEqual({
      status: 400,
      body: { error },
    });
    expect(harness.mocks.fetch).not.toHaveBeenCalled();
  });

  it('returns 400 for a broken multipart body and a missing file', async () => {
    const broken = request(path, {
      method: 'POST',
      headers: { ...auth(), 'content-type': 'multipart/form-data' },
      body: 'not-multipart',
    });
    expect(await outcome(await audioUpload(broken))).toEqual({
      status: 400,
      body: { error: 'Invalid multipart payload' },
    });
    expect(await outcome(await audioUpload(formRequest(path, new FormData())))).toEqual({
      status: 400,
      body: { error: 'No file provided' },
    });
  });

  it('forwards normalized MIME and a server-generated name, unwrapping { data }', async () => {
    harness.mocks.fetch.mockResolvedValue(jsonResponse({ data: { url: AUDIO_URL } }));
    const res = await audioUpload(
      formRequest(path, formWithFile('../evil.wav', VALID_WAV, 'audio/wav; codec=1')),
    );
    expect(await outcome(res)).toEqual({ status: 200, body: { url: AUDIO_URL } });
    const [url, init] = fetchCalls()[0];
    expect(url).toBe('http://cms.test/api/v1/files/upload');
    expect(header(init, 'Authorization')).toBe('Bearer test-token');
    const forwarded = (init.body as FormData).get('file') as File;
    expect(forwarded.name).toMatch(/^[0-9a-f-]+\.wav$/);
    expect(forwarded.type).toBe('audio/wav');
    expectNoFsWrites();
  });

  it.each([
    [401, 401, 'Unauthorized'],
    [403, 401, 'Unauthorized'],
    [500, 502, 'Upload service unavailable'],
  ])('maps backend %i to %i / %s', async (upstream, status, error) => {
    harness.mocks.fetch.mockResolvedValue(jsonResponse({}, upstream));
    expect(await outcome(await audioUpload(formRequest(path, formWithFile('a.wav', VALID_WAV, 'audio/wav'))))).toEqual({
      status,
      body: { error },
    });
  });

  it('returns 502 when the upload backend is unreachable', async () => {
    harness.mocks.fetch.mockRejectedValue(new Error('offline'));
    expect(await outcome(await audioUpload(formRequest(path, formWithFile('a.wav', VALID_WAV, 'audio/wav'))))).toEqual({
      status: 502,
      body: { error: 'Upload service unavailable' },
    });
    expectNoFsWrites();
  });
});

describe('POST /api/listening/upload-user', () => {
  const path = '/api/listening/upload-user';
  const audioFields = { language: 'english', level: 'B1', category: 'news', title: 'Practice' };

  function backendRouter(): void {
    harness.mocks.fetch.mockImplementation(async (url: string) => {
      const target = String(url);
      if (target.endsWith('/tokens/consume')) return jsonResponse({ data: { ok: true } });
      if (target.includes('/audio/transcriptions')) return jsonResponse({ text: TRANSCRIPT });
      if (target.includes('/chat/completions')) {
        return jsonResponse({ choices: [{ message: { content: JSON.stringify(AI_LESSON) } }] });
      }
      if (target.endsWith('/files/upload')) return jsonResponse({ data: { url: AUDIO_URL } });
      throw new Error(`Unexpected fetch to ${target}`);
    });
  }

  it('rejects anonymous callers without calling a provider', async () => {
    harness.mocks.verifyAuthHeader.mockResolvedValue(null);
    expect(await outcome(
      await listeningUpload(jsonRequest(path, { youtubeUrl: YOUTUBE_URL, transcript: TRANSCRIPT })),
    )).toEqual({ status: 401, body: { error: 'Unauthorized' } });
    expect(harness.mocks.fetch).not.toHaveBeenCalled();
    expectNoFsWrites();
  });

  it('rejects an invalid YouTube source before charging tokens', async () => {
    const res = await listeningUpload(jsonRequest(path, { youtubeUrl: 'not-a-url', transcript: TRANSCRIPT }));
    expect(await outcome(res)).toEqual({
      status: 400,
      body: {
        error: 'Hãy nhập link video YouTube và bản chép lời của video (tối đa 20.000 ký tự).',
      },
    });
    expect(harness.mocks.fetch).not.toHaveBeenCalled();
  });

  it.each([
    [new Uint8Array(), 'audio/wav', 'Chọn tệp âm thanh từ 1 byte đến 10 MB.'],
    [PNG, 'audio/wav', 'Nội dung tệp không khớp định dạng âm thanh đã khai báo.'],
    [WAV, 'audio/wav', 'Nội dung tệp không khớp định dạng âm thanh đã khai báo.'],
  ])('rejects invalid audio files before charging tokens', async (bytes, type, error) => {
    const res = await listeningUpload(formRequest(path, formWithFile('a.wav', bytes, type, audioFields)));
    expect(await outcome(res)).toEqual({ status: 400, body: { error } });
    expect(harness.mocks.fetch).not.toHaveBeenCalled();
  });

  it('rejects a declared content-length over 10MB', async () => {
    const res = await listeningUpload(formRequest(
      path,
      formWithFile('a.wav', VALID_WAV, 'audio/wav', audioFields),
      { 'content-length': String(10 * 1024 * 1024 + 1) },
    ));
    expect(await outcome(res)).toEqual({
      status: 400,
      body: { error: 'Chọn tệp âm thanh tối đa 10 MB.' },
    });
    expect(harness.mocks.fetch).not.toHaveBeenCalled();
  });

  it('rejects unsupported lesson metadata before charging tokens', async () => {
    const res = await listeningUpload(
      formRequest(path, formWithFile('a.wav', VALID_WAV, 'audio/wav', { ...audioFields, language: 'klingon' })),
    );
    const result = await outcome(res);
    expect(result.status).toBe(400);
    expect(result.body.error).toContain('Thông tin bài học không hợp lệ');
    expect(harness.mocks.fetch).not.toHaveBeenCalled();
  });

  it('maps token reservation failure to 400 and stops before provider calls', async () => {
    harness.mocks.fetch.mockResolvedValue(jsonResponse({ error: 'Insufficient tokens' }, 400));
    expect(await outcome(
      await listeningUpload(formRequest(path, formWithFile('a.wav', VALID_WAV, 'audio/wav', audioFields))),
    )).toEqual({ status: 400, body: { error: 'Insufficient tokens' } });
    expect(fetchCalls()).toHaveLength(1);
    expect(fetchCalls()[0][0]).toBe('http://api.test/api/v1/tokens/consume');
    expect(JSON.parse(String(fetchCalls()[0][1].body))).toEqual({
      feature: 'listening_generate',
      cost: 8,
    });
  });

  it('completes the file flow: reserve, transcribe, generate, upload, persist', async () => {
    backendRouter();
    const res = await listeningUpload(
      formRequest(
        path,
        formWithFile('a.wav', VALID_WAV, 'audio/wav', audioFields),
        { 'idempotency-key': 'lesson.key:1' },
      ),
    );
    expect(await outcome(res)).toEqual({ status: 200, body: { data: { id: 'lesson-1' } } });
    expect(fetchCalls().map(([url]) => url)).toEqual([
      'http://api.test/api/v1/tokens/consume',
      'https://api.groq.com/openai/v1/audio/transcriptions',
      'https://api.groq.com/openai/v1/chat/completions',
      'http://api.test/api/v1/files/upload',
    ]);
    expect(header(fetchCalls()[0][1], 'Idempotency-Key')).toBe('lesson.key:1');
    expect(header(fetchCalls()[3][1], 'Idempotency-Key')).toBe('lesson.key:1');
    expect(harness.mocks.createLesson).toHaveBeenCalledTimes(1);
    const dto = harness.mocks.createLesson.mock.calls[0][0];
    expect(dto).toMatchObject({
      userId: 'user-123',
      source: 'User Upload',
      title: 'Practice',
      content: {
        transcript: TRANSCRIPT,
        audioUrl: AUDIO_URL,
        vocabulary: AI_LESSON.vocabulary,
      },
    });
    expectNoFsWrites();
  });

  it('completes the YouTube flow without a transcription or storage call', async () => {
    backendRouter();
    const res = await listeningUpload(jsonRequest(path, {
      youtubeUrl: YOUTUBE_URL,
      transcript: TRANSCRIPT,
      language: 'english',
      level: 'B1',
      category: 'conversation',
      title: 'Demo',
    }));
    expect(await outcome(res)).toEqual({ status: 200, body: { data: { id: 'lesson-1' } } });
    expect(fetchCalls().map(([url]) => url)).toEqual([
      'http://api.test/api/v1/tokens/consume',
      'https://api.groq.com/openai/v1/chat/completions',
    ]);
    expect(harness.mocks.createLesson.mock.calls[0][0]).toMatchObject({
      userId: 'user-123',
      source: 'YouTube',
      content: { audioUrl: YOUTUBE_URL, transcript: TRANSCRIPT },
    });
  });

  it('returns 502 when the AI output has no transcript-grounded question', async () => {
    backendRouter();
    harness.mocks.fetch.mockImplementation(async (url: string) => {
      if (String(url).endsWith('/tokens/consume')) return jsonResponse({});
      if (String(url).includes('/chat/completions')) {
        return jsonResponse({
          choices: [{ message: { content: JSON.stringify({ ...AI_LESSON, questions: [] }) } }],
        });
      }
      throw new Error(`Unexpected fetch to ${String(url)}`);
    });
    expect(await outcome(
      await listeningUpload(jsonRequest(path, { youtubeUrl: YOUTUBE_URL, transcript: TRANSCRIPT, title: 'Test' })),
    )).toEqual({
      status: 502,
      body: { error: 'Chưa tạo được câu hỏi có căn cứ từ lời thoại.' },
    });
    expect(harness.mocks.createLesson).not.toHaveBeenCalled();
  });

  it('maps a failed Groq completion to 502', async () => {
    harness.mocks.fetch
      .mockResolvedValueOnce(jsonResponse({}))
      .mockResolvedValueOnce(textResponse('rate limited', 429));
    expect(await outcome(
      await listeningUpload(jsonRequest(path, { youtubeUrl: YOUTUBE_URL, transcript: TRANSCRIPT, title: 'Test' })),
    )).toEqual({ status: 502, body: { error: 'AI generation error' } });
  });

  it('maps a rejected storage upload to 401 and never persists a lesson', async () => {
    harness.mocks.fetch.mockImplementation(async (url: string) => {
      const target = String(url);
      if (target.endsWith('/tokens/consume')) return jsonResponse({});
      if (target.includes('/audio/transcriptions')) return jsonResponse({ text: TRANSCRIPT });
      if (target.includes('/chat/completions')) {
        return jsonResponse({ choices: [{ message: { content: JSON.stringify(AI_LESSON) } }] });
      }
      if (target.endsWith('/files/upload')) return jsonResponse({}, 401);
      throw new Error(`Unexpected fetch to ${target}`);
    });
    expect(await outcome(
      await listeningUpload(formRequest(path, formWithFile('a.wav', VALID_WAV, 'audio/wav', audioFields))),
    )).toEqual({ status: 401, body: { error: 'Unauthorized' } });
    expect(harness.mocks.createLesson).not.toHaveBeenCalled();
    expectNoFsWrites();
  });

  it('rejects a storage response without a usable URL', async () => {
    const validWav = Uint8Array.from([
      0x52, 0x49, 0x46, 0x46, 0x00, 0x00, 0x00, 0x00, 0x57, 0x41, 0x56, 0x45,
    ]);
    harness.mocks.fetch.mockImplementation(async (url: string) => {
      const target = String(url);
      if (target.endsWith('/tokens/consume')) return jsonResponse({});
      if (target.includes('/audio/transcriptions')) return jsonResponse({ text: TRANSCRIPT });
      if (target.includes('/chat/completions')) {
        return jsonResponse({ choices: [{ message: { content: JSON.stringify(AI_LESSON) } }] });
      }
      if (target.endsWith('/files/upload')) return jsonResponse({ data: {} });
      throw new Error(`Unexpected fetch to ${target}`);
    });
    expect(await outcome(
      await listeningUpload(formRequest(path, formWithFile('a.wav', VALID_WAV, 'audio/wav', audioFields))),
    )).toEqual({ status: 502, body: { error: 'Upload service unavailable' } });
    expect(harness.mocks.createLesson).not.toHaveBeenCalled();
  });

  it('returns 500 and cleans up the stored object when lesson persistence fails', async () => {
    backendRouter();
    harness.mocks.createLesson.mockRejectedValue(new Error('disk full'));
    expect(await outcome(
      await listeningUpload(formRequest(path, formWithFile('a.wav', VALID_WAV, 'audio/wav', audioFields))),
    )).toEqual({ status: 500, body: { error: 'Internal server error' } });
    expect(fetchCalls().map(([url]) => url)).toContain(
      'http://api.test/api/v1/files/user-123%2Faudio.mp3',
    );
    expect(fetchCalls()[4][1].method).toBe('DELETE');
  });
});
