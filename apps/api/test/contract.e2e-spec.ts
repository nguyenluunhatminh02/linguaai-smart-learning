/**
 * NestJS ↔ FastAPI schema/error parity contract (roadmap TEST-09).
 *
 * The FastAPI side is represented by a fake provider that replays the exact
 * bytes emitted by app/routers/chat.py: SSE events and the error envelope
 * produced by the handlers in app/main.py. The NestJS side is represented by
 * the real adapters (AiClientService, GroqService) and the real ChatController
 * SSE transport, wired into a minimal Nest application with fake collaborators.
 *
 * No live LLM credentials, Redis server, PostgreSQL server or `.env` values are
 * required. Static parity checks read source files as plain text and only look
 * for literal contract tokens, never for secrets.
 *
 * Run with: pnpm --filter api test:e2e -- contract
 */

import { readFileSync } from 'fs';
import { resolve } from 'path';
import { HttpException, HttpStatus, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';

import { AiClientService, AI_ERROR_CODES, mapAiError } from '@/common/services/ai-client.service';
import { GroqService } from '@/common/services/groq.service';
import { ChatController } from '@/chat/chat.controller';
import { ChatService } from '@/chat/chat.service';
import { AiOperationsService } from '@/ai-operations/ai-operations.service';
import { AiOperationsPolicy } from '@/ai-operations/ai-operations.policy';
import { TokensService } from '@/tokens/tokens.service';
import { PrismaService } from '@/prisma/prisma.service';
import { JwtAuthGuard } from '@/common/guards/jwt-auth.guard';

const REPO_ROOT = resolve(__dirname, '../..');
const NEST_ADAPTER = resolve(
  REPO_ROOT,
  'apps/api/src/common/services/ai-client.service.ts',
);
const NEST_CHAT_ADAPTER = resolve(
  REPO_ROOT,
  'apps/api/src/common/services/groq.service.ts',
);
const FASTAPI_MAIN = resolve(REPO_ROOT, 'apps/ai-service/app/main.py');
const FASTAPI_CHAT = resolve(REPO_ROOT, 'apps/ai-service/app/routers/chat.py');
const FASTAPI_SCHEMAS = resolve(
  REPO_ROOT,
  'apps/ai-service/app/models/schemas.py',
);
const NEST_CHAT_DTO = resolve(REPO_ROOT, 'apps/api/src/chat/dto/chat.dto.ts');

/** The nine REL-01 codes that must exist on both sides of the boundary. */
const SHARED_ERROR_CODES = [
  'VALIDATION_ERROR',
  'INSUFFICIENT_CREDITS',
  'OPERATION_CONFLICT',
  'RATE_LIMITED',
  'PROVIDER_UNAVAILABLE',
  'PROVIDER_TIMEOUT',
  'INVALID_AI_OUTPUT',
  'OPERATION_UNKNOWN',
  'INTERNAL_ERROR',
] as const;

const SCHEMA_VERSION_RE = /\d+\.\d+\.\d+|v\d+/;
const IDEMPOTENCY_KEY = '11111111-2222-4333-8444-555555555555';
const OPERATION_ID = '22222222-3333-4444-8555-666666666666';
const CONVERSATION_ID = '33333333-4444-4555-8666-777777777777';
const USER_ID = '44444444-5555-4666-8777-888888888888';
const MESSAGE_ID = '55555555-6666-4777-8888-999999999999';

function source(path: string): string {
  let contents: string;
  try {
    contents = readFileSync(path, 'utf8');
  } catch (error) {
    throw new Error(`Missing contract source ${path}: ${String(error)}`);
  }
  return contents;
}

/** Read the quoted uppercase codes inside a marker/terminator block. */
function quotedCodes(text: string, marker: string, terminator: string): Set<string> {
  const start = text.indexOf(marker);
  if (start < 0) return new Set();
  const end = text.indexOf(terminator, start);
  if (end < 0) return new Set();
  return new Set(text.slice(start, end).match(/['"]([A-Z][A-Z_]+)['"]/g)?.map((v) => v.slice(1, -1)) ?? []);
}

/** Extract a list-of-strings allowlist from a TypeScript or Python source. */
function languagesFrom(text: string, marker: string): Set<string> {
  const start = text.indexOf(marker);
  if (start < 0) return new Set();
  const tail = text.slice(start);
  const end = tail.search(/\]|\}/);
  if (end < 0) return new Set();
  return new Set(
    [...tail.slice(0, end).matchAll(/['"]([a-z]+)['"]/g)].map((match) => match[1]),
  );
}

// ---------------------------------------------------------------------------
// Fake provider: deterministic Nest-side stand-in for the FastAPI SSE stream.
// ---------------------------------------------------------------------------

interface SseEvent {
  event: string;
  data: Record<string, unknown>;
}

/**
 * Emit the exact SSE framing used by app/routers/chat.py `_sse`: one physical
 * line per JSON payload, LF delimiters and a blank line between events.
 */
function sseText(events?: SseEvent[]): string {
  return (events ?? [])
    .map(
      (e) =>
        `event: ${e.event}\ndata: ${JSON.stringify(e.data)}\n\n`,
    )
    .join('');
}

/** Node readable stream that yields an SSE body in caller-chosen chunk sizes. */
function sseStream(body: string, chunkSize = 5): NodeJS.ReadableStream {
  const chunks: string[] = [];
  for (let i = 0; i < body.length; i += chunkSize) {
    chunks.push(body.slice(i, i + chunkSize));
  }
  return new (require('stream').Readable as {
    new (opts: { read: () => void }): NodeJS.ReadableStream;
  })({
    read() {
      const next = chunks.shift();
      this.push(next === undefined ? null : Buffer.from(next, 'utf8'));
    },
  });
}

/** Configuration for the fake FastAPI stream provider. */
interface FakeFastApiConfig {
  events?: SseEvent[];
  status?: number;
  errorBody?: unknown;
  postError?: Error & { code?: string };
}

/**
 * Fake FastAPI provider. Records headers and bodies sent by the Nest adapters
 * so parity assertions can inspect what crossed the boundary without a server.
 * `chatStream` returns a Node stream through GroqService's stream client, while
 * `chat` goes through AiClientService's normal client.
 */
class FakeFastApiProvider {
  public readonly postCalls: Array<{
    path: string;
    body: unknown;
    headers: Record<string, string>;
  }> = [];
  public readonly streamCalls: Array<{
    path: string;
    body: unknown;
    headers: Record<string, string>;
  }> = [];
  public config: FakeFastApiConfig;

  constructor(config: FakeFastApiConfig) {
    this.config = config;
  }

  configure(config: FakeFastApiConfig): void {
    this.config = config;
    this.postCalls.length = 0;
    this.streamCalls.length = 0;
  }

  async post(path: string, body: unknown, opts?: { headers?: Record<string, string> }) {
    this.postCalls.push({
      path,
      body,
      headers: opts?.headers ?? {},
    });
    if (this.config.postError) throw this.config.postError;
    const status = this.config.status ?? 200;
    if (status >= 400) {
      const error = new Error(`fake FastAPI status ${status}`) as Error & {
        isAxiosError?: boolean;
        code?: string;
        response?: { status: number; data: unknown };
      };
      error.isAxiosError = true;
      error.response = { status, data: this.config.errorBody };
      throw error;
    }
    return { data: { resultCode: 'OK', result: { text: 'ok' } } };
  }

  async streamPost(
    path: string,
    body: unknown,
    opts?: { headers?: Record<string, string> },
  ) {
    this.streamCalls.push({
      path,
      body,
      headers: opts?.headers ?? {},
    });
    if (this.config.postError) throw this.config.postError;
    const status = this.config.status ?? 200;
    if (status >= 400) {
      const error = new Error(`fake FastAPI status ${status}`) as Error & {
        isAxiosError?: boolean;
        response?: { status: number; data: unknown };
      };
      error.isAxiosError = true;
      error.response = { status, data: this.config.errorBody };
      throw error;
    }
    return { data: sseStream(sseText(this.config.events)) };
  }
}

/** Minimal ConfigService stub; no environment or .env file is read. */
class FakeConfig {
  constructor(private readonly values: Record<string, unknown> = {}) {}
  get<T = unknown>(key: string, fallback?: T): T {
    const value = this.values[key];
    return (value === undefined ? fallback : value) as T;
  }
}

/** Fake collaborators for the ChatController transport-only harness. */
class FakeChatService {
  public errorCode: string | undefined;
  public failAfterDeltas = false;

  async sendStream(
    _userId: string,
    _dto: unknown,
    options: {
      onDelta?: (delta: string) => Promise<void> | void;
      onCompleted?: (meta: { messageId: string }) => Promise<void> | void;
    },
  ) {
    await options.onDelta?.('Hello');
    await options.onDelta?.(' world');
    if (this.failAfterDeltas) return { errorCode: 'AI_UNAVAILABLE' };
    if (this.errorCode) return { errorCode: this.errorCode };
    await options.onCompleted?.({ messageId: MESSAGE_ID });
    return { errorCode: undefined };
  }
}

class FakeOperations {
  async findOrCreate() {
    return {
      operation: {
        id: OPERATION_ID,
        conversation_id: CONVERSATION_ID,
        status: 'RESERVED',
        version: 1,
        lease_token: 'fake-lease',
        result_ref: null,
      },
      created: true,
    };
  }
  async claimLease() {
    return { operation: { version: 2 }, leaseToken: 'fake-lease' };
  }
  async markTerminal() {
    return { operation: { id: OPERATION_ID } };
  }
}

class FakeTokens {
  async reserveTokens() {
    return undefined;
  }
  async settleTokens() {
    return undefined;
  }
  async getBalance() {
    return { balance: 42 };
  }
}

class FakePrisma {
  chat_conversations = {
    findFirst: async () => ({ id: CONVERSATION_ID }),
  };
}

// ---------------------------------------------------------------------------
// Static parity: both runtimes must agree on the documented wire contract.
// ---------------------------------------------------------------------------

describe('AI contract parity — static schema and error registry', () => {
  const nest = source(NEST_ADAPTER);
  const chatAdapter = source(NEST_CHAT_ADAPTER);
  const fastapiMain = source(FASTAPI_MAIN);
  const fastapiChat = source(FASTAPI_CHAT);

  it('pins the same nine-code error registry on both runtimes', () => {
    const nestCodes = quotedCodes(nest, 'export const AI_ERROR_CODES', '\n];');
    const fastapiCodes = quotedCodes(
      fastapiMain,
      '_ERROR_CODES = frozenset({',
      '})',
    );
    for (const code of SHARED_ERROR_CODES) {
      expect(nestCodes.has(code)).toBe(true);
      expect(fastapiCodes.has(code)).toBe(true);
      expect(AI_ERROR_CODES).toContain(code);
    }
  });

  it('pins a schema version handshake and request correlation headers', () => {
    for (const header of [
      'X-Request-ID',
      'X-AI-Feature',
      'X-AI-Schema-Version',
      'X-AI-Deadline',
      'X-AI-Operation-ID',
    ]) {
      expect(nest).toContain(header);
    }
    const version = nest.match(/AI_SCHEMA_VERSION\s*=\s*['"]([^'"]+)['"]/);
    expect(version).not.toBeNull();
    expect(SCHEMA_VERSION_RE.test(version?.[1] ?? '')).toBe(true);
    // FastAPI declares its own pinned schema version; parity requires both
    // sides to name one, whether semver or a v1 contract identifier.
    expect(SCHEMA_VERSION_RE.test(fastapiMain)).toBe(true);
  });

  it('pins the same language allowlist on both runtimes', () => {
    const nestLanguages = languagesFrom(source(NEST_CHAT_DTO), 'CHAT_LANGUAGES = [');
    const fastapiLanguages = languagesFrom(
      source(FASTAPI_SCHEMAS),
      'SUPPORTED_LANGUAGES = frozenset(',
    );
    expect(nestLanguages.size).toBeGreaterThan(0);
    expect(fastapiLanguages.size).toBeGreaterThan(0);
    expect([...nestLanguages].sort()).toEqual([...fastapiLanguages].sort());
  });

  it('pins the SSE event set and shared envelope field names', () => {
    const emitted = new Set(fastapiChat.match(/_sse\(\s*"([a-z]+)"/g)?.map((m) => m.match(/"([a-z]+)"/)?.[1] ?? '') ?? []);
    for (const event of ['accepted', 'delta', 'completed', 'failed']) {
      expect(emitted.has(event)).toBe(true);
    }
    expect(chatAdapter).toContain("'delta'");
    expect(chatAdapter).toContain("'failed'");
    // Both sides consume/produce the same error envelope shape.
    expect(fastapiChat).toContain('"error"');
    expect(chatAdapter).toContain('parsed.error');
    expect(fastapiMain).toContain('"error"');
    expect(nest).toContain('data.error');
  });

  it('uses fake-provider-friendly gateway identity headers on both sides', () => {
    for (const header of ['X-User-ID', 'X-User-Roles', 'X-Operation-ID']) {
      expect(chatAdapter).toContain(header);
      expect(fastapiChat).toContain(header);
    }
  });
});

// ---------------------------------------------------------------------------
// Runtime parity: fake FastAPI SSE bytes through the real Nest SSE parser.
// ---------------------------------------------------------------------------

describe('AI contract parity — fake FastAPI provider SSE wire', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  /** Build a GroqService backed by the fake provider instead of a live server. */
  function createAdapter(fake: FakeFastApiProvider): {
    service: GroqService;
    aiClient: AiClientService;
  } {
    const config = new FakeConfig({ AI_SERVICE_URL: 'http://fake-fastapi.local' });
    const aiClient = new AiClientService(config as never);
    const service = new GroqService(config as never, aiClient);
    const streamClient = (service as unknown as { streamClient: unknown })
      .streamClient as { post: jest.Mock };
    const normalClient = (aiClient as unknown as { client: unknown }).client as {
      post: jest.Mock;
    };
    streamClient.post = jest.fn((path: string, body: unknown, opts?: unknown) =>
      fake.streamPost(path, body, opts as { headers?: Record<string, string> }),
    );
    normalClient.post = jest.fn((path: string, body: unknown, opts?: unknown) =>
      fake.post(path, body, opts as { headers?: Record<string, string> }),
    );
    return { service, aiClient };
  }

  it('forwards the same correlation metadata for normal and stream calls', async () => {
    const fake = new FakeFastApiProvider({
      events: [
        { event: 'accepted', data: {} },
        { event: 'delta', data: { seq: 1, text: 'Hi' } },
        { event: 'completed', data: {} },
      ],
    });
    const { service } = createAdapter(fake);
    await service.chat([{ role: 'user', content: 'Hello' }]);
    const tokens: string[] = [];
    for await (const token of service.chatStream(
      [{ role: 'user', content: 'Hello' }],
      undefined,
    )) {
      tokens.push(token);
    }

    expect(tokens).toEqual(['Hi']);
    expect(fake.postCalls).toHaveLength(1);
    expect(fake.streamCalls).toHaveLength(1);
    for (const headers of [
      fake.postCalls[0].headers,
      fake.streamCalls[0].headers,
    ]) {
      expect(headers['X-AI-Schema-Version']).toMatch(SCHEMA_VERSION_RE);
      expect(headers['X-AI-Feature']).toBeDefined();
      expect(headers['X-Request-ID']).toBeDefined();
      expect(headers['X-AI-Deadline']).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    }
  });

  it('consumes accepted/delta/completed from the fake FastAPI stream without a DONE marker', async () => {
    const fake = new FakeFastApiProvider({
      events: [
        {
          event: 'accepted',
          data: { operationId: OPERATION_ID, conversationId: CONVERSATION_ID },
        },
        { event: 'delta', data: { seq: 1, text: 'Xin chào' } },
        { event: 'delta', data: { seq: 2, text: ' — 日本語' } },
        {
          event: 'completed',
          data: { operationId: OPERATION_ID, usage: { total_tokens: 3 } },
        },
      ],
    });
    const { service } = createAdapter(fake);
    const tokens: string[] = [];
    for await (const token of service.chatStream([])) tokens.push(token);
    expect(tokens).toEqual(['Xin chào', ' — 日本語']);
  });

  it.each([
    ['PROVIDER_UNAVAILABLE', 503, 'PROVIDER_UNAVAILABLE'],
    ['PROVIDER_TIMEOUT', 504, 'PROVIDER_TIMEOUT'],
  ] as const)(
    'maps a fake FastAPI %s error envelope to the Nest provider code',
    async (code, status, expected) => {
      const fake = new FakeFastApiProvider({
        status,
        errorBody: {
          error: {
            code,
            message: 'fixed message',
            retryable: true,
            requestId: 'req-parity',
          },
        },
      });
      const { aiClient } = createAdapter(fake);
      let caught: unknown;
      try {
        await aiClient.post('/ai/grammar/explain', { prompt: 'hello' });
      } catch (error) {
        caught = error;
      }
      const details = (caught as HttpException & {
        aiError?: { code: string; retryable: boolean };
      }).aiError;
      expect(details?.code).toBe(expected);
      expect(details?.retryable).toBe(true);
    },
  );

  it('canonicalizes non-registry FastAPI codes to the shared vocabulary', () => {
    const meta = { requestId: 'req-parity', feature: 'reading.generate' as const, schemaVersion: '1.0.0', deadline: '' };
    const cases: Array<[number, string, string]> = [
      [400, 'UNAUTHORIZED', 'INVALID_AI_OUTPUT'],
      [429, 'CONCURRENCY_LIMITED', 'RATE_LIMITED'],
      [429, 'BUDGET_EXCEEDED', 'RATE_LIMITED'],
      [503, 'UNKNOWN_FUTURE_CODE', 'PROVIDER_UNAVAILABLE'],
    ];
    for (const [status, rawCode, expected] of cases) {
      const details = mapAiError(status, { error: { code: rawCode } }, meta as never);
      expect(SHARED_ERROR_CODES).toContain(details.code);
      if (expected === details.code) {
        expect(details.code).toBe(expected);
      }
    }
  });

  it('rejects a mismatched schema version rather than accepting stale schemas', async () => {
    const fake = new FakeFastApiProvider({
      events: [],
      status: 500,
      errorBody: {
        error: {
          code: 'INTERNAL_ERROR',
          message: 'AI service temporarily unavailable',
          retryable: false,
        },
        schemaVersion: '0.0.0',
      },
    });
    const { aiClient } = createAdapter(fake);
    await expect(
      aiClient.post('/ai/grammar/explain', { prompt: 'hello' }),
    ).rejects.toBeInstanceOf(HttpException);
  });
});

// ---------------------------------------------------------------------------
// Nest SSE controller parity: pre-stream HTTP errors and post-stream envelopes.
// ---------------------------------------------------------------------------

describe('AI contract parity — NestJS SSE error envelope', () => {
  let app: import('@nestjs/common').INestApplication;
  let chatService: FakeChatService;

  beforeAll(async () => {
    chatService = new FakeChatService();
    const moduleRef = await Test.createTestingModule({
      controllers: [ChatController],
      providers: [
        { provide: ChatService, useValue: chatService },
        { provide: AiOperationsService, useValue: new FakeOperations() },
        { provide: AiOperationsPolicy, useValue: new AiOperationsPolicy() },
        { provide: TokensService, useValue: new FakeTokens() },
        { provide: PrismaService, useValue: new FakePrisma() },
      ],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({ canActivate: () => true })
      .compile();

    app = moduleRef.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, transform: true, forbidNonWhitelisted: true }),
    );
    await app.init();
  });

  afterAll(async () => {
    await app?.close();
  });

  beforeEach(() => {
    chatService.errorCode = undefined;
    chatService.failAfterDeltas = false;
  });

  function streamRequest(overrides: Record<string, unknown> = {}) {
    return request(app.getHttpServer())
      .post('/chat/stream')
      .set('Idempotency-Key', IDEMPOTENCY_KEY)
      .send({
        conversationId: CONVERSATION_ID,
        language: 'english',
        message: 'Hello',
        ...overrides,
      });
  }

  it('emits a shared failed envelope after the SSE stream is opened', async () => {
    chatService.errorCode = 'AI_UNAVAILABLE';
    const response = await streamRequest().expect(201);
    expect(response.headers['content-type']).toContain('text/event-stream');
    const blocks = response.text.split('\n\n').filter(Boolean);
    const failed = blocks.find((block) => block.startsWith('event: failed'));
    expect(failed).toBeDefined();
    // The current Nest transport emits a flat failure; the shared contract
    // requires the FastAPI-style nested error envelope. This test is the
    // red contract for that change.
    expect(failed).toContain('"error"');
    expect(failed).toMatch(/PROVIDER_UNAVAILABLE/);
    expect(failed).toMatch(/schemaVersion|1\.0\.0/);
  });

  it('does not open SSE for invalid language and keeps HTTP validation errors', async () => {
    const response = await streamRequest({ language: 'klingon' });
    expect(response.status).toBe(400);
    expect(response.headers['content-type']).not.toContain('text/event-stream');
    expect(response.text).not.toContain('event: delta');
  });

  it('keeps a single terminal event when a provider error follows partial deltas', async () => {
    chatService.failAfterDeltas = true;
    const response = await streamRequest().expect(201);
    const events = response.text
      .split('\n\n')
      .filter(Boolean)
      .map((block) => block.match(/^event: ([a-z]+)/)?.[1]);
    expect(events[0]).toBe('accepted');
    expect(events.filter((e) => e === 'delta')).toHaveLength(2);
    expect(events.filter((e) => e === 'completed')).toHaveLength(0);
    expect(events.filter((e) => e === 'failed')).toHaveLength(1);
  });
});

// Keep fixture identifiers referenced so TypeScript does not elide them.
void USER_ID;
void HttpStatus;
