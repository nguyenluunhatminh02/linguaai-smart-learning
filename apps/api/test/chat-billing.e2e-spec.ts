/**
 * CHAT-04 E2E matrix T01–T08, T11–T12 for POST /api/v1/chat/stream.
 *
 * These are deliberately written as contract (red) specs against the
 * orchestration described in LinguaAI_Engineering_Roadmap.md. They use a fake
 * LLM provider and a fake Redis service — no live AI credentials or Redis
 * server are required. A disposable PostgreSQL test DB is still required for
 * the billing ledger assertions.
 *
 * Run with: pnpm --filter api test:e2e -- chat-billing
 */

jest.mock('otplib', () => ({
  generateSecret: jest.fn(),
  verify: jest.fn(),
  generateURI: jest.fn(),
}));

// The native bcrypt binding is platform-specific and is not needed for the
// billing matrix: fixture users are seeded with a deterministic placeholder
// hash and login uses the same mocked comparison.
jest.mock('bcrypt', () => ({
  hash: jest.fn(async () => 'test-password-hash'),
  compare: jest.fn(async () => true),
  genSalt: jest.fn(async () => 'test-salt'),
}));

import { Test } from '@nestjs/testing';
import {
  INestApplication,
  ValidationPipe,
  VersioningType,
} from '@nestjs/common';
import * as request from 'supertest';
import { AppModule } from '@/app.module';
import { GroqService } from '@/common/services/groq.service';
import { RedisService } from '@/common/services/redis.service';
import { PrismaClient } from '../src/generated/prisma';
import { Pool } from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';
import { WsAdapter } from '@nestjs/platform-ws';
import {
  FIXTURE,
  FakeLlmProvider,
  FakeRedis,
  seedChatBillingFixtures,
  readChatBillingState,
  parseSseEvents,
} from './fixtures/chat-billing.fixture';

describe('Chat billing / stream E2E matrix (CHAT-04)', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let pool: Pool;
  let llm: FakeLlmProvider;
  let redis: FakeRedis;
  let tokenA: string;
  let tokenB: string;
  let tokenLow: string;

  const streamPath = '/api/v1/chat/stream';
  const statusPath = (opId: string) => `/api/v1/chat/operations/${opId}`;

  const turn = (overrides: Record<string, unknown> = {}) => ({
    message: 'How do I use the past simple?',
    language: 'english',
    conversationId: FIXTURE.conversationOwnedByA,
    idempotencyKey: 'turn-1',
    ...overrides,
  });

  /** Post a stream request and parse the SSE body into typed events. */
  async function postStream(
    token: string,
    body: Record<string, unknown>,
    key?: string,
  ) {
    const req = request(app.getHttpServer())
      .post(streamPath)
      .set('Authorization', token)
      .set('Accept', 'text/event-stream');
    if (key) req.set('idempotency-key', key);
    const res = await req.send(body);
    return { res, events: parseSseEvents(res.text ?? '') };
  }

  beforeAll(async () => {
    llm = new FakeLlmProvider({ tokens: ['Hello', ' ', 'there'] });
    redis = new FakeRedis();
    (globalThis as Record<string, unknown>).__CHAT_BILLING_FAKE_REDIS__ = redis.store;

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      // Fake provider: the matrix never touches a live AI key.
      .overrideProvider(GroqService)
      .useValue(llm)
      // Fake Redis: deterministic cache behaviour, no network dependency.
      .overrideProvider(RedisService)
      .useValue(redis)
      .compile();

    app = moduleRef.createNestApplication();
    app.useWebSocketAdapter(new WsAdapter(app));
    app.setGlobalPrefix('api');
    app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' });
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        transform: true,
        forbidNonWhitelisted: true,
      }),
    );
    await app.init();

    const dbUrl =
      process.env.DATABASE_URL ||
      'postgresql://linguaai:linguaai_secret@localhost:5432/linguaai_test';
    pool = new Pool({ connectionString: dbUrl });
    prisma = new PrismaClient({ adapter: new PrismaPg(pool) });

    await seedChatBillingFixtures(prisma);

    // Authenticate through the real auth flow so the matrix exercises the
    // same JWT guard as production. Credentials are fixture-only values.
    async function login(email: string): Promise<string> {
      const res = await request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .send({ email, password: 'password123' })
        .expect(200);
      return `Bearer ${res.body.data.accessToken}`;
    }

    tokenA = await login(FIXTURE.userA.email);
    tokenB = await login(FIXTURE.userB.email);
    tokenLow = await login(FIXTURE.lowBalanceUser.email);
  });

  afterAll(async () => {
    await prisma?.$disconnect();
    await pool?.end();
    await app?.close();
  });

  beforeEach(() => {
    llm.configure({ tokens: ['Hello', ' ', 'there'] });
  });

  it('T01 — one provider attempt, one debit, two messages, completed after commit', async () => {
    const key = 't01-success';
    const { res, events } = await postStream(tokenA, turn({ idempotencyKey: key }), key);

    expect(res.status).toBe(201);

    const accepted = events.find((e) => e.event === 'accepted');
    expect(accepted?.data).toHaveProperty('operationId');
    expect(accepted?.data).toHaveProperty('conversationId');

    const operationId = accepted!.data.operationId as string;
    const deltas = events.filter((e) => e.event === 'delta');
    expect(deltas.map((e) => e.data.text).join('')).toBe('Hello there');

    const completed = events.find((e) => e.event === 'completed');
    expect(completed).toBeDefined();
    expect(completed!.data).toMatchObject({ operationId });

    expect(llm.callCount).toBe(1);

    const state = await readChatBillingState(
      prisma,
      FIXTURE.userA.id,
      operationId,
      FIXTURE.conversationOwnedByA,
    );
    expect(state.balance).toBe(495); // 500 - ai_chat(5)
    expect(state.transactions.filter((tx: any) => tx.amount === -5)).toHaveLength(1);
    expect(state.operation?.status).toBe('SUCCEEDED');
    expect(state.messages.map((m) => m.role)).toEqual(['user', 'assistant']);
    expect(state.messages[1].content).toBe('Hello there');
  });

  it('T02 — insufficient balance: no provider call, no debit, no message', async () => {
    const before = await readChatBillingState(
      prisma,
      FIXTURE.lowBalanceUser.id,
    );

    const { res, events } = await postStream(
      tokenLow,
      turn({ conversationId: null, idempotencyKey: 't02-no-balance' }),
      't02-no-balance',
    );

    expect([402, 403]).toContain(res.status);
    expect(events.some((e) => e.event === 'delta')).toBe(false);
    expect(events.some((e) => e.event === 'completed')).toBe(false);
    expect(llm.callCount).toBe(0);

    const after = await readChatBillingState(prisma, FIXTURE.lowBalanceUser.id);
    expect(after.balance).toBe(before.balance);
    expect(after.transactions).toHaveLength(0);
  });

  it('T03 — invalid language: 400 before any side effect', async () => {
    const { res, events } = await postStream(
      tokenA,
      turn({ language: 'klingon', idempotencyKey: 't03-invalid' }),
      't03-invalid',
    );

    expect(res.status).toBe(400);
    expect(events).toHaveLength(0);
    expect(llm.callCount).toBe(0);

    const op = await prisma.ai_operations.findFirst({
      where: { client_operation_id: 't03-invalid' },
    });
    expect(op).toBeNull();
  });

  it('T04 — conversation of another user: 404/403, no debit, no content leak', async () => {
    const before = await readChatBillingState(prisma, FIXTURE.userA.id);

    const { res, events } = await postStream(
      tokenA,
      turn({
        conversationId: FIXTURE.conversationOwnedByB,
        idempotencyKey: 't04-ownership',
      }),
      't04-ownership',
    );

    expect([403, 404]).toContain(res.status);
    const serialized = JSON.stringify(events);
    expect(serialized).not.toContain('B conversation');
    expect(llm.callCount).toBe(0);

    const after = await readChatBillingState(prisma, FIXTURE.userA.id);
    expect(after.balance).toBe(before.balance);
    expect(after.transactions).toHaveLength(before.transactions.length);
  });

  it('T05 — same key + same payload sequentially: replay result, no extra debit', async () => {
    const key = 't05-replay';
    const first = await postStream(tokenA, turn({ idempotencyKey: key }), key);
    expect(first.res.status).toBe(201);

    const accepted = first.events.find((e) => e.event === 'accepted');
    const operationId = accepted!.data.operationId as string;
    const firstCompleted = first.events.find((e) => e.event === 'completed');

    llm.configure({ tokens: ['different response'] });
    const second = await postStream(tokenA, turn({ idempotencyKey: key }), key);

    expect(second.res.status).toBe(201);
    expect(llm.callCount).toBe(0);
    const secondCompleted = second.events.find((e) => e.event === 'completed');
    expect(secondCompleted?.data).toMatchObject({
      operationId,
      messageId: firstCompleted?.data.messageId,
    });

    const state = await readChatBillingState(
      prisma,
      FIXTURE.userA.id,
      operationId,
      FIXTURE.conversationOwnedByA,
    );
    expect(state.balance).toBe(490); // exactly one debit across both requests
    expect(state.transactions.filter((tx: any) => tx.amount === -5)).toHaveLength(1);
  });

  it('T06 — same key concurrently: one operation claimed, one debit', async () => {
    const key = 't06-concurrent';
    const body = turn({ idempotencyKey: key });

    llm.configure({ tokens: ['slow'], delayMs: 20 });
    const [first, second] = await Promise.all([
      postStream(tokenA, body, key),
      postStream(tokenA, body, key),
    ]);

    expect([first.res.status, second.res.status]).toEqual([201, 201]);
    expect(llm.callCount).toBe(1);

    const op = await prisma.ai_operations.findFirst({
      where: { client_operation_id: key, user_id: FIXTURE.userA.id },
    });
    expect(op).not.toBeNull();
    const state = await readChatBillingState(
      prisma,
      FIXTURE.userA.id,
      op!.id,
    );
    expect(state.transactions.filter((tx: any) => tx.amount === -5)).toHaveLength(1);
    expect(op!.status).toBe('SUCCEEDED');
  });

  it('T07 — same key, different payload: 409, original operation unchanged', async () => {
    const key = 't07-conflict';
    const first = await postStream(tokenA, turn({ idempotencyKey: key }), key);
    expect(first.res.status).toBe(201);
    const originalOpId = first.events.find((e) => e.event === 'accepted')!.data
      .operationId as string;

    const before = await readChatBillingState(
      prisma,
      FIXTURE.userA.id,
      originalOpId,
    );

    const conflict = await postStream(
      tokenA,
      turn({ idempotencyKey: key, message: 'a different request' }),
      key,
    );

    expect(conflict.res.status).toBe(409);
    expect(llm.callCount).toBe(1); // only the first request called the provider

    const after = await readChatBillingState(
      prisma,
      FIXTURE.userA.id,
      originalOpId,
    );
    expect(after.operation?.request_hash).toBe(before.operation?.request_hash);
    expect(after.balance).toBe(before.balance);
  });

  it('T08 — same key from different users: isolated scopes, no result/balance leak', async () => {
    const key = 't08-cross-user';
    const a = await postStream(
      tokenA,
      turn({ conversationId: FIXTURE.conversationOwnedByA, idempotencyKey: key }),
      key,
    );
    expect(a.res.status).toBe(201);

    const b = await postStream(
      tokenB,
      turn({ conversationId: FIXTURE.conversationOwnedByB, idempotencyKey: key }),
      key,
    );
    expect(b.res.status).toBe(201);

    const opA = a.events.find((e) => e.event === 'accepted')!.data.operationId;
    const opB = b.events.find((e) => e.event === 'accepted')!.data.operationId;
    expect(opA).not.toBe(opB);
    expect(llm.callCount).toBe(2);

    // Each user is debited exactly once.
    for (const [userId, opId, convId] of [
      [FIXTURE.userA.id, opA, FIXTURE.conversationOwnedByA],
      [FIXTURE.userB.id, opB, FIXTURE.conversationOwnedByB],
    ] as const) {
      const state = await readChatBillingState(prisma, userId, opId, convId);
      expect(state.balance).toBe(495);
      expect(state.transactions.filter((tx: any) => tx.amount === -5)).toHaveLength(1);
      expect(state.messages).toHaveLength(2);
    }

    // User B cannot read A's operation by id. The status endpoint is part of
    // the CHAT-02 contract; when present it must be scoped by user and must
    // never expose A's email or answer.
    const leak = await request(app.getHttpServer())
      .get(statusPath(opA))
      .set('Authorization', tokenB);
    if (leak.status !== 404) {
      expect([403, 404]).toContain(leak.status);
      expect(JSON.stringify(leak.body)).not.toContain(FIXTURE.userA.email);
      expect(JSON.stringify(leak.body)).not.toContain('Hello there');
    }
  });

  it('T11 — disconnect before commit: ledger preserved and recovery returns/terminalizes operation', async () => {
    const key = 't11-disconnect-before-commit';
    llm.configure({ tokens: ['partial ', 'text'], delayMs: 25 });

    // Abort the socket after receiving the first delta but before the
    // orchestrator reaches its commit phase.
    const http = (app.getHttpServer() as any).listen(0);
    await new Promise<void>((resolve) => http.once('listening', resolve));
    const port = http.address().port;

    const payload = JSON.stringify(turn({ idempotencyKey: key }));
    const { ClientRequest } = await import('http');
    const partial = await new Promise<string>((resolve, reject) => {
      const headers: Record<string, string | number> = {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(payload),
        Authorization: tokenA,
        'Idempotency-Key': key,
      };
      const clientReq = new ClientRequest({
        host: '127.0.0.1',
        port,
        method: 'POST',
        path: '/api/v1/chat/stream',
        headers,
      });
      let buf = '';
      clientReq.on('response', (res) => {
        res.setEncoding('utf8');
        res.on('data', (chunk) => {
          buf += chunk;
          if (buf.includes('delta')) {
            clientReq.destroy(); // client disconnect before commit
            resolve(buf);
          }
        });
        res.on('end', () => resolve(buf));
      });
      clientReq.on('error', (err) => {
        if (buf.includes('delta')) resolve(buf);
        else reject(err);
      });
      clientReq.write(payload);
      clientReq.end();
    });

    expect(partial).toContain('delta');
    http.close();

    // Allow the server-side orchestrator to settle/cancel after the abort.
    await new Promise<void>((resolve) => setTimeout(resolve, 100));

    const op = await prisma.ai_operations.findFirst({
      where: { client_operation_id: key, user_id: FIXTURE.userA.id },
    });
    expect(op).not.toBeNull();

    const state = await readChatBillingState(
      prisma,
      FIXTURE.userA.id,
      op!.id,
      FIXTURE.conversationOwnedByA,
    );
    // Ledger is never lost: either one debit (charged) or debit+refund
    // (cancelled/failed), but the operation row and transaction exist.
    expect(state.transactions.length).toBeGreaterThanOrEqual(1);
    expect(['SUCCEEDED', 'FAILED', 'UNKNOWN', 'CANCELLED']).toContain(
      state.operation.status,
    );

    // Recovery: replay the same key and verify the result is returned
    // without a second provider call or a second debit.
    llm.configure({ tokens: ['fresh provider call'] });
    const recovery = await postStream(tokenA, turn({ idempotencyKey: key }), key);
    expect(recovery.res.status).toBe(201);
    expect(llm.callCount).toBe(0);
    expect(recovery.events.some((e) => e.event === 'completed')).toBe(true);
  });

  it('T12 — disconnect after commit before completed event: status/replay returns saved result, zero new AI calls', async () => {
    const key = 't12-disconnect-after-commit';
    const first = await postStream(tokenA, turn({ idempotencyKey: key }), key);
    const opId = first.events.find((e) => e.event === 'accepted')!.data
      .operationId as string;
    expect(first.events.some((e) => e.event === 'completed')).toBe(true);

    // Simulate a client that missed the terminal event: query status directly.
    // The status endpoint is part of the CHAT-02 recovery contract; when it is
    // present it must return the saved result for the caller's own operation.
    const status = await request(app.getHttpServer())
      .get(statusPath(opId))
      .set('Authorization', tokenA);
    if (status.status !== 404) {
      expect(status.status).toBe(200);
      expect(status.body.data).toMatchObject({
        operationId: opId,
        status: 'SUCCEEDED',
      });
      expect(status.body.data).toHaveProperty('result');
    }

    // The durable proof of the committed result is the assistant message and
    // the SUCCEEDED operation row, independent of the status endpoint.
    const saved = await readChatBillingState(
      prisma,
      FIXTURE.userA.id,
      opId,
      FIXTURE.conversationOwnedByA,
    );
    expect(saved.operation?.status).toBe('SUCCEEDED');
    expect(saved.messages.filter((m) => m.role === 'assistant')).toHaveLength(1);

    llm.configure({ tokens: ['should not happen'] });
    const replay = await postStream(tokenA, turn({ idempotencyKey: key }), key);
    expect(replay.res.status).toBe(201);
    expect(llm.callCount).toBe(0);
    expect(
      replay.events.find((e) => e.event === 'completed')?.data.messageId,
    ).toBe(first.events.find((e) => e.event === 'completed')?.data.messageId);

    // The replayed stream must not create a second assistant message.
    const messages = await prisma.chat_messages.findMany({
      where: { conversation_id: FIXTURE.conversationOwnedByA },
      orderBy: { created_at: 'asc' },
    });
    const replayedAssistant = messages.filter(
      (m) => m.content === 'Hello there',
    );
    expect(replayedAssistant).toHaveLength(1);
  });
});
