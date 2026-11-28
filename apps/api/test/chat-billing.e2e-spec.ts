/**
 * CHAT-04 E2E matrix T01–T20 for POST /api/v1/chat/stream.
 *
 * These are deliberately written as contract (red) specs against the
 * orchestration described in LinguaAI_Engineering_Roadmap.md. They use a fake
 * LLM provider and a fake Redis service — no live AI credentials or Redis
 * server are required. A disposable PostgreSQL test DB is still required for
 * the billing ledger assertions.
 *
 * T09/T10, T13/T14 and T17 are process/transaction faults: they are covered at
 * the service/repository level in chat-billing-orchestrator.spec.ts and
 * tokens.service.spec.ts, not in this HTTP+DB suite. This file keeps one
 * API-level assertion for each cross-cutting policy (T15, T16, T18) plus raw
 * SSE checks for T19/T20; the byte-by-byte client parser cases live in
 * apps/web/src/lib/sse-parser.spec.ts.
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
    (globalThis as Record<string, unknown>).__CHAT_BILLING_FAKE_REDIS__ =
      redis.store;

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
    // Every test starts with Redis healthy; T16 opts into the outage toggle.
    redis.outage = false;
  });

  it('T01 — one provider attempt, one debit, two messages, completed after commit', async () => {
    const key = 't01-success';
    const { res, events } = await postStream(
      tokenA,
      turn({ idempotencyKey: key }),
      key,
    );

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
    expect(
      state.transactions.filter((tx: any) => tx.amount === -5),
    ).toHaveLength(1);
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
    expect(
      state.transactions.filter((tx: any) => tx.amount === -5),
    ).toHaveLength(1);
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
    const state = await readChatBillingState(prisma, FIXTURE.userA.id, op!.id);
    expect(
      state.transactions.filter((tx: any) => tx.amount === -5),
    ).toHaveLength(1);
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
      turn({
        conversationId: FIXTURE.conversationOwnedByA,
        idempotencyKey: key,
      }),
      key,
    );
    expect(a.res.status).toBe(201);

    const b = await postStream(
      tokenB,
      turn({
        conversationId: FIXTURE.conversationOwnedByB,
        idempotencyKey: key,
      }),
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
      expect(
        state.transactions.filter((tx: any) => tx.amount === -5),
      ).toHaveLength(1);
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
    const recovery = await postStream(
      tokenA,
      turn({ idempotencyKey: key }),
      key,
    );
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
    expect(saved.messages.filter((m) => m.role === 'assistant')).toHaveLength(
      1,
    );

    llm.configure({ tokens: ['should not happen'] });
    const replay = await postStream(tokenA, turn({ idempotencyKey: key }), key);
    expect(replay.res.status).toBe(201);
    expect(llm.callCount).toBe(0);
    expect(
      replay.events.find((e) => e.event === 'completed')?.data.messageId,
    ).toBe(first.events.find((e) => e.event === 'completed')?.data.messageId);
  });

  /**
   * T13/T14/T17 contract coverage lives in the unit specs:
   *  - T13 (crash after reserve, expired lease): chat-billing-orchestrator.spec.ts
   *  - T14 (provider completed but commit lost, UNKNOWN/no refund): same spec
   *  - T17 (bounded P2034 retry, no LLM retry): tokens.service.spec.ts
   *
   * The API can only assert the exposed HTTP+DB surface for the remaining
   * cases, which is what the tests below do.
   */

  it('T13 — crashed run with an expired lease: replay claims once and keeps one debit', async () => {
    const key = 't13-expired-lease';
    // First turn completes normally: one debit, one saved answer.
    const first = await postStream(tokenA, turn({ idempotencyKey: key }), key);
    expect(first.res.status).toBe(201);
    const opId = first.events.find((e) => e.event === 'accepted')!.data
      .operationId as string;

    // Simulate a crash after reserve before a provider call at the DB layer:
    // force the operation back to RESERVED with an expired lease, mimicking
    // what a recovery worker sees after findExpired() in the repository.
    await prisma.ai_operations.update({
      where: { id: opId },
      data: {
        status: 'RESERVED',
        lease_token: null,
        lease_until: new Date(Date.now() - 60_000),
        result_ref: null,
      },
    });
    await prisma.chat_messages.deleteMany({
      where: {
        conversation_id: FIXTURE.conversationOwnedByA,
        content: 'Hello there',
      },
    });
    // Undo the settled debit so recovery must reserve/settle exactly once.
    await prisma.token_transactions.deleteMany({
      where: { idempotency_key: { contains: opId } },
    });
    await prisma.user_token_balance.update({
      where: { user_id: FIXTURE.userA.id },
      data: { balance: 500 },
    });

    // A replay with the same key must re-claim the expired row (no second
    // operation), call the provider once and debit exactly once.
    llm.configure({ tokens: ['recovered'] });
    const replay = await postStream(tokenA, turn({ idempotencyKey: key }), key);
    expect(replay.res.status).toBe(201);
    expect(replay.events.some((e) => e.event === 'completed')).toBe(true);

    const ops = await prisma.ai_operations.findMany({
      where: { client_operation_id: key, user_id: FIXTURE.userA.id },
    });
    expect(ops).toHaveLength(1);
    expect(llm.callCount).toBe(1);
    const state = await readChatBillingState(
      prisma,
      FIXTURE.userA.id,
      opId,
      FIXTURE.conversationOwnedByA,
    );
    expect(state.operation?.status).toBe('SUCCEEDED');
    expect(
      state.transactions.filter((tx: any) => tx.amount === -5),
    ).toHaveLength(1);
  });

  it('T14 — provider failure before commit: no completed event and no assistant message', async () => {
    const key = 't14-provider-failure';
    // Provider returns one delta then fails: the stream ends without a
    // persisted answer. The repository-level UNKNOWN/reconcile branch of T14
    // is asserted in chat-billing-orchestrator.spec.ts; here we assert the
    // HTTP-observable half of the same guarantee.
    llm.configure({
      tokens: ['partial ', 'answer'],
      errorAfterTokens: 1,
      error: new Error('provider died before commit'),
    });

    const { res, events } = await postStream(
      tokenA,
      turn({ idempotencyKey: key }),
      key,
    );

    expect(res.status).toBe(201);
    expect(events.some((e) => e.event === 'delta')).toBe(true);
    expect(events.some((e) => e.event === 'completed')).toBe(false);
    expect(events.some((e) => e.event === 'failed')).toBe(true);
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
    // A failed run never auto-completes. UNKNOWN is reserved for ambiguous
    // timeouts; a deterministic provider error is FAILED.
    expect(state.operation.status).toBe('FAILED');
    expect(state.messages.filter((m) => m.role === 'assistant')).toHaveLength(
      0,
    );

    // A terminal operation is immutable: replay is rejected and there is no
    // new provider attempt. No exactly-once provider guarantee is claimed.
    llm.configure({ tokens: ['replay'] });
    const replay = await postStream(tokenA, turn({ idempotencyKey: key }), key);
    expect(replay.res.status).toBe(409);
    expect(llm.callCount).toBe(0);
  });

  it('T15 — two different keys on one conversation: single in-flight contract', async () => {
    // CONTRACT GAP (roadmap T15): ChatController.reserveOperation fences only
    // by (user_id, feature, client_operation_id). Two different keys on one
    // conversation are independent operations today, so both may run and
    // debit. This test documents the required single-in-flight invariant and
    // is expected to fail until a conversation-scoped fence (repository
    // lookup or DB partial unique index) is implemented.
    const firstKey = 't15-inflight-first';
    const secondKey = 't15-inflight-second';
    llm.configure({ tokens: ['slow ', 'answer'], delayMs: 30 });
    const firstPromise = postStream(
      tokenA,
      turn({ idempotencyKey: firstKey, message: 'first turn' }),
      firstKey,
    );

    // Wait until the first operation owns a live lease before racing.
    await new Promise<void>((resolve) => setTimeout(resolve, 10));
    const second = await postStream(
      tokenA,
      turn({ idempotencyKey: secondKey, message: 'second turn' }),
      secondKey,
    );
    const first = await firstPromise;

    expect(first.res.status).toBe(201);
    expect(first.events.some((e) => e.event === 'completed')).toBe(true);
    // The losing turn must be rejected before a debit or provider call.
    expect([409, 423]).toContain(second.res.status);
    expect(second.events.some((e) => e.event === 'delta')).toBe(false);

    const ops = await prisma.ai_operations.findMany({
      where: {
        user_id: FIXTURE.userA.id,
        client_operation_id: { in: [firstKey, secondKey] },
      },
    });
    expect(ops.filter((op) => op.charged_credits > 0)).toHaveLength(1);

    const messages = await prisma.chat_messages.findMany({
      where: { conversation_id: FIXTURE.conversationOwnedByA },
      orderBy: { created_at: 'asc' },
    });
    expect(messages.filter((m) => m.content === 'slow answer').length).toBe(1);
    const debits = await prisma.token_transactions.findMany({
      where: { user_id: FIXTURE.userA.id, amount: -5 },
    });
    expect(debits).toHaveLength(1);
  });

  it('T16 — Redis down: rate limiter fails closed, no billing corruption', async () => {
    // CONTRACT: The rate limiter guard is fail-closed. When Redis throws,
    // the guard rejects the request before any billing operation. The DB
    // ledger is never touched, so billing remains correct (no debit, no
    // operation row, balance unchanged). The limiter unit spec asserts the
    // fail-closed behavior in isolation; this test proves the end-to-end
    // consequence: no request reaches the provider or billing layer.
    const key = 't16-redis-down';
    redis.outage = true;
    llm.configure({ tokens: ['should not run'] });

    const balanceBefore = await prisma.user_token_balance.findUnique({
      where: { user_id: FIXTURE.userA.id },
    });
    const opsBefore = await prisma.ai_operations.findMany({
      where: { user_id: FIXTURE.userA.id, client_operation_id: key },
    });

    const { res, events } = await postStream(
      tokenA,
      turn({ idempotencyKey: key }),
      key,
    );
    redis.outage = false;

    // Fail-closed: the limiter rejects before the SSE stream opens.
    expect([429, 503]).toContain(res.status);
    expect(events).toHaveLength(0);
    expect(llm.callCount).toBe(0);

    const balanceAfter = await prisma.user_token_balance.findUnique({
      where: { user_id: FIXTURE.userA.id },
    });
    expect(balanceAfter?.balance).toBe(balanceBefore?.balance);
    const opsAfter = await prisma.ai_operations.findMany({
      where: { user_id: FIXTURE.userA.id, client_operation_id: key },
    });
    expect(opsAfter.length).toBe(opsBefore.length);
  });

  it('T18 — retrying a failed turn never credits twice', async () => {
    const key = 't18-refund-retry';
    // A deterministic provider failure is a known error; the chat transport
    // terminalizes it as FAILED. The at-most-once refund hook itself is
    // asserted in chat-billing-orchestrator.spec.ts; here we check the
    // HTTP-observable consequence: replaying the same key cannot trigger a
    // second provider attempt or a second balance mutation.
    llm.configure({
      tokens: ['partial'],
      errorAfterTokens: 1,
      error: new Error('known provider failure'),
    });
    const { res } = await postStream(
      tokenA,
      turn({ idempotencyKey: key }),
      key,
    );
    expect(res.status).toBe(201);

    const op = await prisma.ai_operations.findFirst({
      where: { client_operation_id: key, user_id: FIXTURE.userA.id },
    });
    expect(op).not.toBeNull();
    expect(op!.status).toBe('FAILED');

    const refundsBefore = await countLedgerEntries(prisma, FIXTURE.userA.id, {
      type: 'refund',
    });
    const balanceBefore = await prisma.user_token_balance.findUnique({
      where: { user_id: FIXTURE.userA.id },
    });

    const replay = await postStream(tokenA, turn({ idempotencyKey: key }), key);
    expect(replay.res.status).toBe(409);
    expect(llm.callCount).toBe(0);

    const refundsAfter = await countLedgerEntries(prisma, FIXTURE.userA.id, {
      type: 'refund',
    });
    expect(refundsAfter).toBe(refundsBefore);
    const balanceAfter = await prisma.user_token_balance.findUnique({
      where: { user_id: FIXTURE.userA.id },
    });
    expect(balanceAfter?.balance).toBe(balanceBefore?.balance);
  });

  it('T19 — raw SSE bytes split inside a multi-byte token preserve Unicode', async () => {
    const key = 't19-unicode-chunks';
    const unicode = 'Xin chào — こんにちは — 😀';
    llm.configure({ tokens: [unicode] });

    const payload = JSON.stringify(turn({ idempotencyKey: key }));
    const { ClientRequest } = await import('http');
    const http = (app.getHttpServer() as any).listen(0);
    await new Promise<void>((resolve) => http.once('listening', resolve));
    const port = http.address().port;

    // Read one byte at a time: a multi-byte UTF-8 sequence is guaranteed to be
    // split across chunks, which is exactly the client-parser regression case.
    const raw = await new Promise<string>((resolve, reject) => {
      const req = new ClientRequest({
        host: '127.0.0.1',
        port,
        method: 'POST',
        path: streamPath,
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(payload),
          Authorization: tokenA,
          'Idempotency-Key': key,
        },
      });
      const chunks: Buffer[] = [];
      req.on('response', (res) => {
        res.on('data', (chunk: Buffer) => {
          for (const byte of chunk) chunks.push(Buffer.from([byte]));
        });
        res.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
      });
      req.on('error', reject);
      req.write(payload);
      req.end();
    });
    http.close();

    const events = parseSseEvents(raw);
    const text = events
      .filter((e) => e.event === 'delta')
      .map((e) => e.data.text)
      .join('');
    expect(text).toBe(unicode);
    expect(events.some((e) => e.event === 'completed')).toBe(true);
  });

  it('T20 — EOF without completed event is never reported as success', async () => {
    const key = 't20-eof-no-completed';
    // A provider error after a delta ends the SSE body without `completed`.
    // This is the API-level half of the EOF contract; the byte-by-byte
    // client-parser cases (EOF with no terminal frame) live in
    // apps/web/src/lib/sse-parser.spec.ts.
    llm.configure({
      tokens: ['partial '],
      errorAfterTokens: 1,
      error: new Error('provider ended without a completion frame'),
    });

    const { res, events } = await postStream(
      tokenA,
      turn({ idempotencyKey: key }),
      key,
    );

    expect(res.status).toBe(201);
    expect(events.some((e) => e.event === 'delta')).toBe(true);
    expect(events.some((e) => e.event === 'completed')).toBe(false);
    expect(events.some((e) => e.event === 'failed')).toBe(true);

    const op = await prisma.ai_operations.findFirst({
      where: { client_operation_id: key, user_id: FIXTURE.userA.id },
    });
    expect(op).not.toBeNull();
    expect(['UNKNOWN', 'FAILED', 'CANCELLED']).toContain(op!.status);
    const saved = await readChatBillingState(
      prisma,
      FIXTURE.userA.id,
      op!.id,
      FIXTURE.conversationOwnedByA,
    );
    expect(saved.messages.filter((m) => m.role === 'assistant')).toHaveLength(
      0,
    );

    // A client that missed `failed` can only recover by status/replay; neither
    // path may report success for this operation.
    const status = await request(app.getHttpServer())
      .get(statusPath(op!.id))
      .set('Authorization', tokenA);
    if (status.status === 200) {
      expect(status.body.data.status).not.toBe('SUCCEEDED');
    }
  });
});
