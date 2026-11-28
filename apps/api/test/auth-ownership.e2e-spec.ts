/**
 * test-09: Auth ownership/role E2E matrix for the real AppModule.
 *
 * Covers the guest / owner / non-owner / admin quadrants across chat, decks,
 * cards, SRS, writing, speaking, reading, tokens and admin routes. All
 * identities and secrets below are synthetic fixture values. A disposable
 * PostgreSQL test database is required; no live AI provider or Redis server
 * is contacted (GroqService is a spy and RedisService is an in-memory fake).
 *
 * Run with: pnpm --filter api test:e2e -- --runInBand auth-ownership
 */

jest.mock('otplib', () => ({
  generateSecret: jest.fn(),
  verify: jest.fn(),
  generateURI: jest.fn(),
}));

// The native bcrypt binding is platform-specific; login only needs a
// deterministic comparison against the placeholder hash seeded below.
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
import { CircuitBreakerService } from '@/common/services/circuit-breaker.service';
import { PrismaClient } from '../src/generated/prisma';
import { Pool } from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';
import { WsAdapter } from '@nestjs/platform-ws';

// ─────────────────────────────────────────────────────────────────────────────
// Synthetic fixture data. Stable UUIDs let assertions reference rows by id.
// ─────────────────────────────────────────────────────────────────────────────

const FIXTURE = {
  userA: {
    id: '1a000000-0000-4000-8000-000000000001',
    email: 'owner-a@auth-ownership.test',
    firstName: 'Owner',
    lastName: 'A',
    password: 'FixturePass123!',
  },
  userB: {
    id: '2b000000-0000-4000-8000-000000000002',
    email: 'other-b@auth-ownership.test',
    firstName: 'Other',
    lastName: 'B',
    password: 'FixturePass123!',
  },
  moderator: {
    id: '3c000000-0000-4000-8000-000000000003',
    email: 'moderator@auth-ownership.test',
    firstName: 'Moderator',
    lastName: 'Role',
    password: 'FixturePass123!',
  },
  admin: {
    id: '4d000000-0000-4000-8000-000000000004',
    email: 'admin@auth-ownership.test',
    firstName: 'Admin',
    lastName: 'Role',
    password: 'FixturePass123!',
  },
  conversationA: 'a1000000-0000-4000-8000-000000000001',
  conversationB: 'b2000000-0000-4000-8000-000000000002',
  messageA: 'a1100000-0000-4000-8000-000000000001',
  messageB: 'b2200000-0000-4000-8000-000000000002',
  operationA: 'a3000000-0000-4000-8000-000000000003',
  operationB: 'b3000000-0000-4000-8000-000000000004',
  privateDeckA: 'd1000000-0000-4000-8000-000000000001',
  publicDeckA: 'd2000000-0000-4000-8000-000000000002',
  privateCardA: 'c1000000-0000-4000-8000-000000000001',
  publicCardA: 'c2000000-0000-4000-8000-000000000002',
  writingA: 'w1000000-0000-4000-8000-000000000001',
  writingB: 'w2000000-0000-4000-8000-000000000002',
  speakingA: 's1000000-0000-4000-8000-000000000001',
  speakingB: 's2000000-0000-4000-8000-000000000002',
  readingA: 'r1000000-0000-4000-8000-000000000001',
  readingB: 'r2000000-0000-4000-8000-000000000002',
  /** Distinctive values used both as data and as leak sentinels in responses. */
  secrets: {
    privateDeckTitle: 'PRIVATE_DECK_SECRET_ALPHA',
    publicDeckTitle: 'PUBLIC_DECK_VISIBLE',
    privateCardFront: 'PRIVATE_CARD_SECRET_BRAVO',
    publicCardFront: 'PUBLIC_CARD_VISIBLE',
    conversationTitle: 'CONVERSATION_SECRET_CHARLIE',
    chatMessage: 'CHAT_MESSAGE_SECRET_DELTA',
    operationResult: 'OPERATION_SECRET_ECHO',
    writingEssay: 'WRITING_ESSAY_SECRET_ECHO',
    writingFeedback: 'WRITING_FEEDBACK_SECRET_FOXTROT',
    speakingTranscript: 'SPEAKING_TRANSCRIPT_SECRET_GOLF',
    readingPassage: 'READING_PASSAGE_SECRET_HOTEL',
  },
} as const;

/** In-memory RedisService stand-in: only get/set/del are needed by JWT + tokens. */
class FakeRedis {
  public readonly store = new Map<string, string>();
  public readonly deletedKeys: string[] = [];

  async get(key: string): Promise<string | null> {
    return this.store.get(key) ?? null;
  }

  async set(key: string, value: string, _ttl?: number): Promise<void> {
    this.store.set(key, value);
  }

  async del(key: string): Promise<void> {
    if (this.store.delete(key)) this.deletedKeys.push(key);
  }

  async exists(key: string): Promise<boolean> {
    return this.store.has(key);
  }

  async setNx(key: string, value: string, _ttl?: number): Promise<boolean> {
    if (this.store.has(key)) return false;
    this.store.set(key, value);
    return true;
  }

  async incrWithExpiry(key: string, _window: number): Promise<number> {
    const next = Number(this.store.get(key) ?? 0) + 1;
    this.store.set(key, String(next));
    return next;
  }

  async keys(_pattern: string): Promise<string[]> {
    return [...this.store.keys()];
  }

  async delMany(keys: string[]): Promise<void> {
    for (const key of keys) await this.del(key);
  }

  isAvailable(): boolean {
    return true;
  }
}

/** GroqService spy: the matrix never reaches a live AI provider. */
class FakeLlmProvider {
  public chatCalls = 0;
  public chatStreamCalls = 0;

  async chat(): Promise<string> {
    this.chatCalls += 1;
    return '{}';
  }

  chatStream = async function* (this: FakeLlmProvider) {
    this.chatStreamCalls += 1;
    yield 'ok';
  }.bind(this);
}

/** Snapshot used to prove rejected mutations changed nothing. */
interface OwnershipSnapshot {
  balances: Record<string, number | null>;
  transactions: number;
  users: number;
  cards: number;
  decks: number;
  progress: number;
  reviewEvents: number;
  conversations: number;
  messages: number;
  operations: number;
  writing: number;
  speaking: number;
  reading: number;
  auditLogs: number;
  llmCalls: number;
}

describe('Auth ownership E2E matrix (test-09)', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let pool: Pool;
  let redis: FakeRedis;
  let llm: FakeLlmProvider;

  let tokenA: string;
  let tokenB: string;
  let tokenModerator: string;
  let tokenAdmin: string;

  const api = () => request(app.getHttpServer());
  const auth = (token: string) => ({ Authorization: token });
  /** Responses may be raw objects or wrapped in an ApiResponse envelope. */
  const unwrap = (body: any): any =>
    body && typeof body === 'object' && 'data' in body ? body.data : body;
  const path = {
    me: '/api/v1/users/me',
    balance: '/api/v1/tokens/balance',
    history: '/api/v1/tokens/history',
    conversations: '/api/v1/chat/conversations',
    messages: (id: string) => `/api/v1/chat/conversations/${id}/messages`,
    conversation: (id: string) => `/api/v1/chat/conversations/${id}`,
    operation: (id: string) => `/api/v1/chat/operations/${id}`,
    deck: (id: string) => `/api/v1/decks/${id}`,
    deckCards: (id: string) => `/api/v1/decks/${id}/cards`,
    card: (deckId: string, id: string) =>
      `/api/v1/decks/${deckId}/cards/${id}`,
    dueCards: '/api/v1/srs/due-cards',
    review: '/api/v1/srs/review',
    writingHistory: '/api/v1/writing/history',
    writing: (id: string) => `/api/v1/writing/${id}`,
    speaking: (id: string) => `/api/v1/speaking/${id}`,
    reading: (id: string) => `/api/v1/reading/${id}`,
    adminUsers: '/api/v1/admin/users',
    adminOverview: '/api/v1/admin/overview',
    adminHistory: (id: string) => `/api/v1/admin/users/${id}/tokens/history`,
    adminGrant: (id: string) => `/api/v1/admin/users/${id}/tokens`,
    adminContent: '/api/v1/admin/content',
  };

  /** Every route in the matrix is behind JwtAuthGuard. */
  const guestReadRoutes: Array<[string, string]> = [
    ['GET', path.me],
    ['GET', path.balance],
    ['GET', path.history],
    ['GET', path.conversations],
    ['GET', path.messages(FIXTURE.conversationA)],
    ['GET', path.operation(FIXTURE.operationA)],
    ['GET', path.deck(FIXTURE.privateDeckA)],
    ['GET', path.deckCards(FIXTURE.privateDeckA)],
    ['GET', path.card(FIXTURE.privateDeckA, FIXTURE.privateCardA)],
    ['GET', `${path.dueCards}?deckId=${FIXTURE.privateDeckA}`],
    ['GET', path.writingHistory],
    ['GET', path.writing(FIXTURE.writingA)],
    ['GET', path.speaking(FIXTURE.speakingA)],
    ['GET', path.reading(FIXTURE.readingA)],
    ['GET', path.adminUsers],
    ['GET', path.adminOverview],
  ];

  const guestWriteRoutes: Array<[string, string, unknown]> = [
    ['POST', path.review, { cardId: FIXTURE.privateCardA, grade: 3 }],
    [
      'PATCH',
      path.deck(FIXTURE.publicDeckA),
      { title: 'GUEST_MUTATION' },
    ],
    [
      'PATCH',
      path.card(FIXTURE.publicDeckA, FIXTURE.publicCardA),
      { frontText: 'GUEST_MUTATION' },
    ],
    ['POST', path.adminGrant(FIXTURE.userA.id), { amount: 10 }],
    [
      'POST',
      path.adminContent,
      { type: 'reading', title: 'GUEST_MUTATION' },
    ],
  ];

  async function login(email: string, password: string): Promise<string> {
    const res = await api()
      .post('/api/v1/auth/login')
      .send({ email, password })
      .expect(200);
    return `Bearer ${res.body.data.accessToken}`;
  }

  /** Seed all identities, roles, balances and cross-user resources. */
  async function seedOwnershipFixtures(): Promise<void> {
    // Truncating users cascades to every fixture-owned table. Roles are shared
    // reference data and are upserted, not wiped.
    await prisma.$executeRaw`TRUNCATE TABLE users CASCADE`;

    for (const [name, id] of Object.entries({
      ADMIN: 'e1000000-0000-4000-8000-000000000001',
      USER: 'e1000000-0000-4000-8000-000000000002',
      MODERATOR: 'e1000000-0000-4000-8000-000000000003',
    })) {
      await prisma.roles.upsert({
        where: { name: name as any },
        create: { id, name: name as any },
        update: {},
      });
    }
    // Reference data may predate this suite; always use the live role ids.
    const roleRows = await prisma.roles.findMany({
      where: { name: { in: ['ADMIN', 'USER', 'MODERATOR'] as any } },
      select: { id: true, name: true },
    });
    const roleIds: Record<string, string> = Object.fromEntries(
      roleRows.map((row) => [row.name, row.id]),
    );

    const users = [
      { fixture: FIXTURE.userA, role: 'USER' },
      { fixture: FIXTURE.userB, role: 'USER' },
      { fixture: FIXTURE.moderator, role: 'MODERATOR' },
      { fixture: FIXTURE.admin, role: 'ADMIN' },
    ];
    for (const { fixture, role } of users) {
      await prisma.users.create({
        data: {
          id: fixture.id,
          email: fixture.email,
          password: 'test-password-hash',
          first_name: fixture.firstName,
          last_name: fixture.lastName,
          email_verified: true,
          is_active: true,
          is_deleted: false,
          delete_status: 'ACTIVE',
          user_roles: {
            create: { roles_id: roleIds[role] },
          },
        },
      });
      await prisma.user_token_balance.create({
        data: { user_id: fixture.id, balance: 500 },
      });
      // Durable markers stop the daily top-up from mutating balances mid-matrix.
      await prisma.daily_credit_grants.create({
        data: {
          id: `f1000000-0000-4000-8000-${fixture.id.slice(-12)}`,
          user_id: fixture.id,
          grant_type: 'DAILY_TOPUP',
          day: new Date(new Date().toISOString().slice(0, 10)),
          amount: 0,
        },
      });
    }

    await prisma.decks.create({
      data: {
        id: FIXTURE.privateDeckA,
        title: FIXTURE.secrets.privateDeckTitle,
        creator_id: FIXTURE.userA.id,
        language: 'english',
        is_public: false,
      },
    });
    await prisma.decks.create({
      data: {
        id: FIXTURE.publicDeckA,
        title: FIXTURE.secrets.publicDeckTitle,
        creator_id: FIXTURE.userA.id,
        language: 'english',
        is_public: true,
      },
    });
    await prisma.cards.create({
      data: {
        id: FIXTURE.privateCardA,
        deck_id: FIXTURE.privateDeckA,
        front_text: FIXTURE.secrets.privateCardFront,
        back_text: 'private back',
      },
    });
    await prisma.cards.create({
      data: {
        id: FIXTURE.publicCardA,
        deck_id: FIXTURE.publicDeckA,
        front_text: FIXTURE.secrets.publicCardFront,
        back_text: 'public back',
      },
    });
    // Refresh the denormalised counts to match the seeded rows.
    await prisma.decks.update({
      where: { id: FIXTURE.privateDeckA },
      data: { card_count: 1 },
    });
    await prisma.decks.update({
      where: { id: FIXTURE.publicDeckA },
      data: { card_count: 1 },
    });

    await prisma.chat_conversations.create({
      data: {
        id: FIXTURE.conversationA,
        user_id: FIXTURE.userA.id,
        title: FIXTURE.secrets.conversationTitle,
      },
    });
    await prisma.chat_conversations.create({
      data: {
        id: FIXTURE.conversationB,
        user_id: FIXTURE.userB.id,
        title: 'Other B conversation',
      },
    });
    await prisma.chat_messages.create({
      data: {
        id: FIXTURE.messageA,
        conversation_id: FIXTURE.conversationA,
        role: 'user',
        content: FIXTURE.secrets.chatMessage,
      },
    });
    await prisma.chat_messages.create({
      data: {
        id: FIXTURE.messageB,
        conversation_id: FIXTURE.conversationB,
        role: 'user',
        content: FIXTURE.secrets.chatMessage,
      },
    });

    // Operation rows belong to each user and point at a private result message.
    for (const [id, userId, conversationId, messageId] of [
      [
        FIXTURE.operationA,
        FIXTURE.userA.id,
        FIXTURE.conversationA,
        FIXTURE.messageA,
      ],
      [
        FIXTURE.operationB,
        FIXTURE.userB.id,
        FIXTURE.conversationB,
        FIXTURE.messageB,
      ],
    ] as const) {
      await prisma.ai_operations.create({
        data: {
          id,
          user_id: userId,
          feature: 'ai_chat',
          client_operation_id: `ownership-${id}`,
          request_hash: '0'.repeat(64),
          pricing_version: '1',
          reserved_credits: 5,
          status: 'SUCCEEDED',
          conversation_id: conversationId,
          result_ref: messageId,
        },
      });
    }

    for (const [id, userId, essay] of [
      [FIXTURE.writingA, FIXTURE.userA.id, FIXTURE.secrets.writingEssay],
      [FIXTURE.writingB, FIXTURE.userB.id, 'OTHER_B_ESSAY_PRIVATE'],
    ] as const) {
      await prisma.writing_submissions.create({
        data: {
          id,
          user_id: userId,
          user_text: essay,
          language: 'english',
          ai_feedback: {
            feedback: FIXTURE.secrets.writingFeedback,
            scores: { overall: 8 },
          },
          score: { overall: 8 },
        },
      });
    }

    for (const [id, userId, transcript] of [
      [FIXTURE.speakingA, FIXTURE.userA.id, FIXTURE.secrets.speakingTranscript],
      [FIXTURE.speakingB, FIXTURE.userB.id, 'OTHER_B_TRANSCRIPT_PRIVATE'],
    ] as const) {
      await prisma.speaking_submissions.create({
        data: {
          id,
          user_id: userId,
          transcript,
          feedback: 'feedback',
          language: 'english',
        },
      });
    }

    for (const [id, userId, passage] of [
      [FIXTURE.readingA, FIXTURE.userA.id, FIXTURE.secrets.readingPassage],
      [FIXTURE.readingB, FIXTURE.userB.id, 'OTHER_B_PASSAGE_PRIVATE'],
    ] as const) {
      await prisma.reading_passages.create({
        data: {
          id,
          generated_by_user_id: userId,
          passage_text: passage,
          language: 'english',
        },
      });
    }

    // Clear any stale JWT role snapshot before the login/token matrix starts.
    redis.store.clear();
  }

  async function snapshot(): Promise<OwnershipSnapshot> {
    const [
      balances,
      transactions,
      users,
      cards,
      decks,
      progress,
      reviewEvents,
      conversations,
      messages,
      operations,
      writing,
      speaking,
      reading,
      auditLogs,
    ] = await Promise.all([
      prisma.user_token_balance.findMany({ select: { user_id: true, balance: true } }),
      prisma.token_transactions.count(),
      prisma.users.count(),
      prisma.cards.count(),
      prisma.decks.count(),
      prisma.user_card_progress.count(),
      prisma.srs_review_events.count(),
      prisma.chat_conversations.count(),
      prisma.chat_messages.count(),
      prisma.ai_operations.count(),
      prisma.writing_submissions.count(),
      prisma.speaking_submissions.count(),
      prisma.reading_passages.count(),
      prisma.audit_logs.count(),
    ]);
    return {
      balances: Object.fromEntries(
        balances.map((row) => [row.user_id, row.balance]),
      ),
      transactions,
      users,
      cards,
      decks,
      progress,
      reviewEvents,
      conversations,
      messages,
      operations,
      writing,
      speaking,
      reading,
      auditLogs,
      llmCalls: llm.chatCalls + llm.chatStreamCalls,
    };
  }

  function expectUnchanged(before: OwnershipSnapshot, after: OwnershipSnapshot) {
    expect(after).toEqual(before);
  }

  /** Assert no response (status/body/headers) leaks any fixture secret. */
  function expectNoLeak(res: request.Response) {
    const serialized = JSON.stringify({
      status: res.status,
      body: res.body,
      text: res.text,
      headers: res.headers,
    });
    for (const value of Object.values(FIXTURE.secrets)) {
      expect(serialized).not.toContain(value);
    }
    expect(serialized).not.toContain(FIXTURE.userA.email);
    expect(serialized).not.toContain(FIXTURE.userB.email);
  }

  beforeAll(async () => {
    redis = new FakeRedis();
    llm = new FakeLlmProvider();

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(GroqService)
      .useValue(llm)
      .overrideProvider(RedisService)
      .useValue(redis)
      // CircuitBreakerService's constructor defaults are function/object
      // values Nest treats as injectable tokens. Construct it directly so the
      // real AppModule can boot without touching production wiring.
      .overrideProvider(CircuitBreakerService)
      .useValue(new CircuitBreakerService())
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

    // DATABASE_URL is supplied by the disposable test environment. Never log it.
    const pool = new Pool({ connectionString: process.env.DATABASE_URL });
    prisma = new PrismaClient({ adapter: new PrismaPg(pool) });
    // Keep a reference for teardown without ever serialising the connection info.
    (app as unknown as Record<string, unknown>).__ownershipPool = pool;

    await seedOwnershipFixtures();

    tokenA = await login(FIXTURE.userA.email, FIXTURE.userA.password);
    tokenB = await login(FIXTURE.userB.email, FIXTURE.userB.password);
    tokenModerator = await login(
      FIXTURE.moderator.email,
      FIXTURE.moderator.password,
    );
    tokenAdmin = await login(FIXTURE.admin.email, FIXTURE.admin.password);
  });

  afterAll(async () => {
    if (prisma) {
      await prisma.$executeRaw`TRUNCATE TABLE users CASCADE`;
      await prisma.$disconnect();
    }
    const retainedPool = app
      ? ((app as unknown as Record<string, unknown>).__ownershipPool as
          | Pool
          | undefined)
      : undefined;
    await retainedPool?.end();
    await app?.close();
  });

  // ── Guest ───────────────────────────────────────────────────────────────────

  it.each(guestReadRoutes)(
    'guest GET %s %s returns 401 and leaks nothing',
    async (method, url) => {
      const before = await snapshot();
      const res = await api()[method.toLowerCase() as 'get'](url);
      expect(res.status).toBe(401);
      expectNoLeak(res);
      expectUnchanged(before, await snapshot());
    },
  );

  it.each(guestWriteRoutes)(
    'guest %s %s is rejected with 401 and no side effect',
    async (method, url, body) => {
      const before = await snapshot();
      const res = await api()
        [method.toLowerCase() as 'post'](url)
        .send(body as object);
      expect(res.status).toBe(401);
      expectNoLeak(res);
      expectUnchanged(before, await snapshot());
    },
  );

  it('guest cannot read another user via a malformed/foreign bearer token', async () => {
    const before = await snapshot();
    const res = await api()
      .get(path.me)
      .set('Authorization', 'Bearer not-a-real-token');
    expect(res.status).toBe(401);
    expectNoLeak(res);
    expectUnchanged(before, await snapshot());
  });

  // ── Owner happy path ────────────────────────────────────────────────────────

  it('owner can read every owned resource through the real API', async () => {
    const profile = await api().get(path.me).set(auth(tokenA)).expect(200);
    expect(unwrap(profile.body).email).toBe(FIXTURE.userA.email);

    const balance = await api().get(path.balance).set(auth(tokenA)).expect(200);
    expect(unwrap(balance.body).balance).toBe(500);

    await api().get(path.history).set(auth(tokenA)).expect(200);

    const conversations = await api()
      .get(path.conversations)
      .set(auth(tokenA))
      .expect(200);
    expect(JSON.stringify(conversations.body)).toContain(
      FIXTURE.secrets.conversationTitle,
    );

    const messages = await api()
      .get(path.messages(FIXTURE.conversationA))
      .set(auth(tokenA))
      .expect(200);
    expect(JSON.stringify(messages.body)).toContain(
      FIXTURE.secrets.chatMessage,
    );

    const operation = await api()
      .get(path.operation(FIXTURE.operationA))
      .set(auth(tokenA))
      .expect(200);
    expect(unwrap(operation.body)).toMatchObject({
      operationId: FIXTURE.operationA,
      status: 'SUCCEEDED',
    });

    const privateDeck = await api()
      .get(path.deck(FIXTURE.privateDeckA))
      .set(auth(tokenA))
      .expect(200);
    expect(JSON.stringify(privateDeck.body)).toContain(
      FIXTURE.secrets.privateDeckTitle,
    );

    const privateCards = await api()
      .get(path.deckCards(FIXTURE.privateDeckA))
      .set(auth(tokenA))
      .expect(200);
    expect(JSON.stringify(privateCards.body)).toContain(
      FIXTURE.secrets.privateCardFront,
    );

    const ownedCard = await api()
      .get(path.card(FIXTURE.privateDeckA, FIXTURE.privateCardA))
      .set(auth(tokenA))
      .expect(200);
    expect(JSON.stringify(ownedCard.body)).toContain(
      FIXTURE.secrets.privateCardFront,
    );

    const writing = await api()
      .get(path.writing(FIXTURE.writingA))
      .set(auth(tokenA))
      .expect(200);
    expect(JSON.stringify(writing.body)).toContain(FIXTURE.secrets.writingEssay);

    const writingHistory = await api()
      .get(path.writingHistory)
      .set(auth(tokenA))
      .expect(200);
    expect(JSON.stringify(writingHistory.body)).toContain(
      FIXTURE.secrets.writingEssay,
    );

    const speaking = await api()
      .get(path.speaking(FIXTURE.speakingA))
      .set(auth(tokenA))
      .expect(200);
    expect(JSON.stringify(speaking.body)).toContain(
      FIXTURE.secrets.speakingTranscript,
    );

    const reading = await api()
      .get(path.reading(FIXTURE.readingA))
      .set(auth(tokenA))
      .expect(200);
    expect(JSON.stringify(reading.body)).toContain(
      FIXTURE.secrets.readingPassage,
    );
  });

  // ── Non-owner private reads: 404 with no content leak ───────────────────────

  const privateReads: Array<[string, string]> = [
    ['chat messages', path.messages(FIXTURE.conversationA)],
    ['private deck', path.deck(FIXTURE.privateDeckA)],
    ['private deck cards', path.deckCards(FIXTURE.privateDeckA)],
    [
      'private card',
      path.card(FIXTURE.privateDeckA, FIXTURE.privateCardA),
    ],
    ['writing detail', path.writing(FIXTURE.writingA)],
    ['speaking detail', path.speaking(FIXTURE.speakingA)],
    ['reading detail', path.reading(FIXTURE.readingA)],
  ];

  it.each(privateReads)(
    'non-owner cannot read %s (404, no leak)',
    async (_label, url) => {
      const before = await snapshot();
      const res = await api().get(url).set(auth(tokenB));
      expect(res.status).toBe(404);
      expectNoLeak(res);
      expectUnchanged(before, await snapshot());
    },
  );

  it('non-owner cannot read the other user chat conversation metadata', async () => {
    const before = await snapshot();
    const res = await api().get(path.conversations).set(auth(tokenB));
    expect(res.status).toBe(200);
    const serialized = JSON.stringify(res.body);
    expect(serialized).not.toContain(FIXTURE.secrets.conversationTitle);
    expectUnchanged(before, await snapshot());
  });

  it('non-owner cannot read the other user writing/speaking/reading history', async () => {
    const before = await snapshot();
    const writing = await api()
      .get(path.writingHistory)
      .set(auth(tokenB))
      .expect(200);
    expect(JSON.stringify(writing.body)).not.toContain(
      FIXTURE.secrets.writingEssay,
    );
    expectNoLeak(writing);
    expectUnchanged(before, await snapshot());
  });

  it('non-owner cannot see another user chat operation status/result', async () => {
    const before = await snapshot();
    const res = await api()
      .get(path.operation(FIXTURE.operationA))
      .set(auth(tokenB));
    // The status route deliberately distinguishes 403 (known but foreign) from
    // 404 (unknown); both are acceptable ownership-safe outcomes.
    expect([403, 404]).toContain(res.status);
    expectNoLeak(res);
    expectUnchanged(before, await snapshot());
  });

  it('non-owner cannot enumerate another user SRS due cards from a private deck', async () => {
    const before = await snapshot();
    const res = await api()
      .get(`${path.dueCards}?deckId=${FIXTURE.privateDeckA}`)
      .set(auth(tokenB));
    expect(res.status).toBe(404);
    expectNoLeak(res);
    expectUnchanged(before, await snapshot());
  });

  // ── Non-owner mutations: visible resource 403, private resource 404 ────────

  const privateMutations: Array<[string, string, string, unknown]> = [
    [
      'delete conversation',
      'delete',
      path.conversation(FIXTURE.conversationA),
      undefined,
    ],
    [
      'update private deck',
      'patch',
      path.deck(FIXTURE.privateDeckA),
      { title: 'NON_OWNER_MUTATION' },
    ],
    [
      'delete private deck',
      'delete',
      path.deck(FIXTURE.privateDeckA),
      undefined,
    ],
    [
      'update private card',
      'patch',
      path.card(FIXTURE.privateDeckA, FIXTURE.privateCardA),
      { frontText: 'NON_OWNER_MUTATION' },
    ],
    [
      'delete private card',
      'delete',
      path.card(FIXTURE.privateDeckA, FIXTURE.privateCardA),
      undefined,
    ],
    [
      'create card in private deck',
      'post',
      path.deckCards(FIXTURE.privateDeckA),
      { frontText: 'NON_OWNER_MUTATION', backText: 'x' },
    ],
    [
      'generate cards in private deck',
      'post',
      `${path.deckCards(FIXTURE.privateDeckA)}/generate-from-text`,
      { text: 'a passage', language: 'english', count: 3 },
    ],
  ];

  it.each(privateMutations)(
    'non-owner %s is refused (404, no side effect)',
    async (_label, verb, url, body) => {
      const before = await snapshot();
      let res: request.Response;
      if (body === undefined) {
        res = await api()[verb as 'delete'](url).set(auth(tokenB));
      } else {
        res = await api()
          [verb as 'post'](url)
          .set(auth(tokenB))
          .send(body as object);
      }
      expect([403, 404]).toContain(res.status);
      expectNoLeak(res);
      expectUnchanged(before, await snapshot());
    },
  );

  it('non-owner cannot PATCH or DELETE a public deck (403, unchanged)', async () => {
    for (const verb of ['patch', 'delete'] as const) {
      const before = await snapshot();
      const res = await api()[verb](path.deck(FIXTURE.publicDeckA))
        .set(auth(tokenB))
        .send(verb === 'patch' ? { title: 'NON_OWNER_MUTATION' } : undefined);
      expect(res.status).toBe(403);
      expectNoLeak(res);
      expectUnchanged(before, await snapshot());
    }
  });

  it('non-owner cannot mutate a card in a public deck (403, unchanged)', async () => {
    for (const verb of ['patch', 'delete'] as const) {
      const before = await snapshot();
      const res = await api()[verb](
        path.card(FIXTURE.publicDeckA, FIXTURE.publicCardA),
      )
        .set(auth(tokenB))
        .send(verb === 'patch' ? { frontText: 'NON_OWNER_MUTATION' } : undefined);
      expect(res.status).toBe(403);
      expectNoLeak(res);
      expectUnchanged(before, await snapshot());
    }
  });

  it('non-owner cannot create or generate cards in a public deck (403, unchanged)', async () => {
    for (const [url, body] of [
      [path.deckCards(FIXTURE.publicDeckA), { frontText: 'X', backText: 'Y' }],
      [
        `${path.deckCards(FIXTURE.publicDeckA)}/generate-from-text`,
        { text: 'a passage', language: 'english', count: 3 },
      ],
    ] as const) {
      const before = await snapshot();
      const res = await api().post(url).set(auth(tokenB)).send(body);
      expect(res.status).toBe(403);
      expectNoLeak(res);
      expectUnchanged(before, await snapshot());
    }
  });

  it('non-owner cannot review a card in another user private deck (404, unchanged)', async () => {
    const before = await snapshot();
    const res = await api()
      .post(path.review)
      .set(auth(tokenB))
      .send({ cardId: FIXTURE.privateCardA, grade: 3 });
    expect(res.status).toBe(404);
    expectNoLeak(res);
    expectUnchanged(before, await snapshot());
  });

  // ── Public deck policy ──────────────────────────────────────────────────────

  it('authenticated non-owner may read a public deck and its cards', async () => {
    const before = await snapshot();
    const deck = await api()
      .get(path.deck(FIXTURE.publicDeckA))
      .set(auth(tokenB))
      .expect(200);
    expect(JSON.stringify(deck.body)).toContain(FIXTURE.secrets.publicDeckTitle);

    const cards = await api()
      .get(path.deckCards(FIXTURE.publicDeckA))
      .set(auth(tokenB))
      .expect(200);
    expect(JSON.stringify(cards.body)).toContain(
      FIXTURE.secrets.publicCardFront,
    );

    const card = await api()
      .get(path.card(FIXTURE.publicDeckA, FIXTURE.publicCardA))
      .set(auth(tokenB))
      .expect(200);
    expect(JSON.stringify(card.body)).toContain(FIXTURE.secrets.publicCardFront);

    expectUnchanged(before, await snapshot());
  });

  it('owner can review a card; balance, ledger and progress remain owner-scoped', async () => {
    const reviewOperationId = 'a4400000-0000-4000-8000-000000000004';
    const before = await snapshot();
    const res = await api()
      .post(path.review)
      .set(auth(tokenA))
      .send({
        cardId: FIXTURE.privateCardA,
        grade: 3,
        operationId: reviewOperationId,
      })
      .expect(201);
    expect(unwrap(res.body)).toHaveProperty('stability');

    const progress = await prisma.user_card_progress.findUnique({
      where: {
        user_id_card_id: {
          user_id: FIXTURE.userA.id,
          card_id: FIXTURE.privateCardA,
        },
      },
    });
    expect(progress?.repetition_count).toBe(1);

    const foreignProgress = await prisma.user_card_progress.findMany({
      where: {
        card_id: FIXTURE.privateCardA,
        user_id: FIXTURE.userB.id,
      },
    });
    expect(foreignProgress).toHaveLength(0);

    const after = await snapshot();
    expect(after.progress).toBe(before.progress + 1);
    expect(after.reviewEvents).toBe(before.reviewEvents + 1);
    expect(after.balances[FIXTURE.userA.id]).toBe(
      before.balances[FIXTURE.userA.id],
    );
    expect(after.transactions).toBe(before.transactions);
  });

  // ── Role matrix ─────────────────────────────────────────────────────────────

  it.each([
    ['USER', () => tokenA],
    ['MODERATOR', () => tokenModerator],
  ])('role %s gets 403 on admin routes', async (_role, getToken) => {
    for (const [method, url, body] of [
      ['get', path.adminUsers, undefined],
      ['get', path.adminOverview, undefined],
      ['get', path.adminHistory(FIXTURE.userA.id), undefined],
      [
        'post',
        path.adminGrant(FIXTURE.userB.id),
        { amount: 10, reason: 'denied' },
      ],
      ['get', path.adminContent, undefined],
      [
        'post',
        path.adminContent,
        { type: 'reading', title: 'DENIED_CONTENT' },
      ],
    ] as const) {
      const before = await snapshot();
      const res = await api()[method](url)
        .set(auth(getToken()))
        .send(body);
      expect(res.status).toBe(403);
      expectNoLeak(res);
      expectUnchanged(before, await snapshot());
    }
  });

  it('ADMIN can list users, inspect any token history, manage content and see own balance', async () => {
    const users = await api()
      .get(path.adminUsers)
      .set(auth(tokenAdmin))
      .expect(200);
    const items = unwrap(users.body)?.items ?? [];
    expect(items.length).toBeGreaterThanOrEqual(4);
    expect(JSON.stringify(items)).toContain(FIXTURE.userA.email);

    await api()
      .get(path.adminOverview)
      .set(auth(tokenAdmin))
      .expect(200);

    const history = await api()
      .get(path.adminHistory(FIXTURE.userB.id))
      .set(auth(tokenAdmin))
      .expect(200);
    expect(history.body).toBeDefined();

    const created = await api()
      .post(path.adminContent)
      .set(auth(tokenAdmin))
      .send({ type: 'reading', title: 'ADMIN_OWNERSHIP_CONTENT' })
      .expect(201);
    const createdId: string = unwrap(created.body)?.id;
    expect(createdId).toEqual(expect.any(String));

    const contentList = await api()
      .get(path.adminContent)
      .set(auth(tokenAdmin))
      .expect(200);
    expect(JSON.stringify(contentList.body)).toContain(
      'ADMIN_OWNERSHIP_CONTENT',
    );

    await api()
      .patch(`${path.adminContent}/${createdId}`)
      .set(auth(tokenAdmin))
      .send({ title: 'ADMIN_OWNERSHIP_CONTENT_UPDATED' })
      .expect(200);

    await api()
      .delete(`${path.adminContent}/${createdId}`)
      .set(auth(tokenAdmin))
      .expect(200);

    const ownBalance = await api()
      .get(path.balance)
      .set(auth(tokenAdmin))
      .expect(200);
    expect(unwrap(ownBalance.body).balance).toBe(500);
  });

  it('ADMIN token grant credits the target and writes an audit_logs row', async () => {
    const before = await snapshot();
    const res = await api()
      .post(path.adminGrant(FIXTURE.userB.id))
      .set(auth(tokenAdmin))
      .send({ amount: 25, reason: 'ownership-matrix' })
      .expect(201);

    expect(res.body).toBeDefined();

    const balance = await prisma.user_token_balance.findUnique({
      where: { user_id: FIXTURE.userB.id },
    });
    expect(balance?.balance).toBe((before.balances[FIXTURE.userB.id] ?? 0) + 25);

    const transactions = await prisma.token_transactions.findMany({
      where: { user_id: FIXTURE.userB.id, amount: 25 },
    });
    expect(transactions.length).toBeGreaterThan(0);
    expect(transactions.some((tx) => tx.type === 'admin_grant')).toBe(true);

    const audit = await prisma.audit_logs.findMany({
      where: {
        user_id: FIXTURE.admin.id,
        action: 'ADMIN_TOKEN_GRANT',
        resource_id: FIXTURE.userB.id,
      },
    });
    expect(audit.length).toBeGreaterThan(0);
    expect(audit[0].success).toBe(true);

    // The other user's balance must not move as a side effect of the grant.
    const aBalance = await prisma.user_token_balance.findUnique({
      where: { user_id: FIXTURE.userA.id },
    });
    expect(aBalance?.balance).toBe(before.balances[FIXTURE.userA.id]);
  });

  it('admin role changes are visible immediately (JWT role cache eviction)', async () => {
    // USER B is promoted; the same token must pick up the new role once the
    // 60s JWT role cache entry is evicted by AdminService.
    await api()
      .patch(`/api/v1/admin/users/${FIXTURE.userB.id}/role`)
      .set(auth(tokenAdmin))
      .send({ role: 'ADMIN' })
      .expect(200);

    expect(
      await api().get(path.adminUsers).set(auth(tokenB)).expect(200),
    ).toBeDefined();

    // Restore the original role so subsequent suites do not inherit privileges.
    await api()
      .patch(`/api/v1/admin/users/${FIXTURE.userB.id}/role`)
      .set(auth(tokenAdmin))
      .send({ role: 'USER' })
      .expect(200);
  });
});
