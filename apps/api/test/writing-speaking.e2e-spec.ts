/**
 * TEST-08 E2E matrix for writing score consistency and upload ownership.
 *
 * Anchors: DB-03 (score contract), SEC-02/SEC-08 (ownership, file privacy),
 * TEST-08 (Writing history/detail + speaking uploads).
 *
 * These are contract (red) specs modelled on chat-billing.e2e-spec.ts. They use
 * a fake AI client and fake storage — no live AI credentials or Redis server
 * are required. A disposable PostgreSQL test DB is still required for the
 * submission persistence assertions.
 *
 * Run with: pnpm --filter api test:e2e -- writing-speaking
 */

jest.mock('otplib', () => ({
  generateSecret: jest.fn(),
  verify: jest.fn(),
  generateURI: jest.fn(),
}));

jest.mock('bcrypt', () => ({
  hash: jest.fn(async () => 'test-password-hash'),
  compare: jest.fn(async () => true),
  genSalt: jest.fn(async () => 'test-salt'),
}));

// Deterministic, non-secret test values so AppModule's security strategies
// can be constructed without reading or printing any real .env credentials.
process.env.NODE_ENV = 'test';
process.env.JWT_SECRET =
  'test-jwt-secret-with-at-least-32-characters-for-validation';
process.env.JWT_REFRESH_SECRET =
  'test-jwt-refresh-secret-with-at-least-32-characters';
process.env.GOOGLE_CLIENT_ID = 'test-google-client-id';
process.env.GOOGLE_CLIENT_SECRET = 'test-google-client-secret';
process.env.GITHUB_CLIENT_ID = 'test-github-client-id';
process.env.GITHUB_CLIENT_SECRET = 'test-github-client-secret';
process.env.GITHUB_CALLBACK_URL =
  'http://localhost:3000/api/v1/auth/oauth2/callback/github';

import { Test } from '@nestjs/testing';
import {
  INestApplication,
  ValidationPipe,
  VersioningType,
} from '@nestjs/common';
import * as request from 'supertest';
import { AppModule } from '@/app.module';
import { AiClientService } from '@/common/services/ai-client.service';
import { RedisService } from '@/common/services/redis.service';
import { CircuitBreakerService } from '@/common/services/circuit-breaker.service';
import { PrismaClient } from '../src/generated/prisma';
import { PrismaService } from '@/prisma/prisma.service';
import { Pool } from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';
import { WsAdapter } from '@nestjs/platform-ws';

/** Fixed UUIDs so assertions can reference rows by stable id. */
const FIXTURE = {
  userA: {
    id: 'aaaaaaaa-1111-4aaa-aaaa-aaaaaaaaaaaa',
    email: 'user-a-ws@example.com',
    password: 'password123',
    first_name: 'User',
    last_name: 'A-WS',
  },
  userB: {
    id: 'bbbbbbbb-2222-4bbb-bbbb-bbbbbbbbbbbb',
    email: 'user-b-ws@example.com',
    password: 'password123',
    first_name: 'User',
    last_name: 'B-WS',
  },
  writingSubmissionA: 'dddddddd-4444-4ddd-dddd-dddddddddddd',
  speakingSubmissionA: 'eeeeeeee-5555-4eee-eeee-eeeeeeeeeeee',
} as const;

/**
 * Fake AI client that returns predictable writing assessments with explicit
 * scale metadata. The fake records call count so tests can assert idempotency.
 */
class FakeAiClientService {
  public callCount = 0;
  public lastPayload: any = null;

  async post<T>(path: string, payload: any): Promise<T> {
    this.callCount += 1;
    this.lastPayload = { path, payload };

    if (path === '/ai/writing/assess') {
      // Return a response with explicit scale metadata (DB-03 contract)
      return {
        overall_score: 7,
        scoreScale: 10,
        maxScore: 10,
        rubricVersion: 'writing-rubric-v1',
        feedback: 'Good effort with minor grammar issues.',
        errors: [
          {
            original: 'I are',
            correction: 'I am',
            explanation: 'Subject-verb agreement',
            type: 'grammar',
          },
        ],
        tips: ['Review subject-verb agreement rules.'],
        corrected_text: 'I am happy.',
        scores: {
          overall: 7,
          grammar: 6,
          vocabulary: 8,
          coherence: 7,
          task_achievement: 7,
        },
      } as T;
    }

    if (path === '/ai/writing/errors/analyze') {
      return {
        summary: 'Focus on grammar accuracy.',
        priority_focus: 'Subject-verb agreement',
        patterns: [{ type: 'grammar', count: 3 }],
        exercises: [{ title: 'Practice agreement', description: '...' }],
      } as T;
    }

    throw new Error(`Unexpected AI path: ${path}`);
  }
}

/**
 * Minimal in-memory stand-in for RedisService. The matrix only needs basic
 * get/set/del so the fake satisfies those without network dependencies.
 */
class FakeRedis {
  public store = new Map<string, string>();

  async get(key: string): Promise<string | null> {
    return this.store.get(key) ?? null;
  }
  async set(key: string, value: string, _ttl?: number): Promise<void> {
    this.store.set(key, value);
  }
  async del(key: string): Promise<void> {
    this.store.delete(key);
  }
  async exists(key: string): Promise<boolean> {
    return this.store.has(key);
  }
  async setNx(key: string, value: string, _ttl?: number): Promise<boolean> {
    if (this.store.has(key)) return false;
    this.store.set(key, value);
    return true;
  }
  async incrWithExpiry(key: string, _windowSeconds: number): Promise<number> {
    const current = parseInt(this.store.get(key) ?? '0', 10) + 1;
    this.store.set(key, String(current));
    return current;
  }
  async keys(_pattern: string): Promise<string[]> {
    return [...this.store.keys()];
  }
  async delMany(keys: string[]): Promise<void> {
    for (const k of keys) this.store.delete(k);
  }
  isAvailable(): boolean {
    return true;
  }
}

/**
 * Seed the test database with fixture users and balances. Uses the same Prisma
 * client shape as setup.ts but keeps the data scoped to this matrix.
 */
async function seedWritingSpeakingFixtures(prisma: any): Promise<void> {
  await prisma.$executeRaw`TRUNCATE TABLE users CASCADE`;

  const bcrypt = require('bcrypt') as typeof import('bcrypt');
  const passwordHash = await bcrypt.hash('password123', 10);

  for (const u of [FIXTURE.userA, FIXTURE.userB]) {
    await prisma.users.create({
      data: {
        id: u.id,
        email: u.email,
        password: passwordHash,
        first_name: u.first_name,
        last_name: u.last_name,
        email_verified: true,
      },
    });
  }

  // User A: plenty of balance for writing/speaking tests.
  await prisma.user_token_balance.create({
    data: { user_id: FIXTURE.userA.id, balance: 1000 },
  });
  // User B: also well-funded for ownership tests.
  await prisma.user_token_balance.create({
    data: { user_id: FIXTURE.userB.id, balance: 1000 },
  });

  // Prevent daily top-up from silently raising balances during the test.
  const today = new Date().toISOString().slice(0, 10);
  for (const u of [FIXTURE.userA, FIXTURE.userB]) {
    await prisma.daily_credit_grants.create({
      data: {
        user_id: u.id,
        grant_type: 'DAILY_TOPUP',
        day: new Date(today),
        amount: 0,
      },
    });
  }
}

describe('Writing/Speaking E2E matrix (TEST-08)', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let pool: Pool;
  let aiClient: FakeAiClientService;
  let redis: FakeRedis;
  let tokenA: string;
  let tokenB: string;

  beforeAll(async () => {
    aiClient = new FakeAiClientService();
    redis = new FakeRedis();

    // Create a standalone Prisma client for test seeding. We also override the
    // app's PrismaService with a minimal stub so the app can boot without
    // needing $on() event setup (which fails under jest's module isolation).
    const dbUrl =
      process.env.DATABASE_URL ||
      'postgresql://linguaai:linguaai_secret@localhost:5432/linguaai_test';
    pool = new Pool({ connectionString: dbUrl });
    prisma = new PrismaClient({ adapter: new PrismaPg(pool) });

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(AiClientService)
      .useValue(aiClient)
      .overrideProvider(RedisService)
      .useValue(redis)
      .overrideProvider(CircuitBreakerService)
      .useValue({
        execute: async (_key: string, operation: () => Promise<any>) =>
          operation(),
      })
      .overrideProvider(PrismaService)
      .useValue(prisma)
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

    await seedWritingSpeakingFixtures(prisma);

    async function login(email: string): Promise<string> {
      const res = await request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .send({ email, password: 'password123' })
        .expect(200);
      return `Bearer ${res.body.data.accessToken}`;
    }

    tokenA = await login(FIXTURE.userA.email);
    tokenB = await login(FIXTURE.userB.email);
  });

  afterAll(async () => {
    await prisma?.$disconnect();
    await pool?.end();
    await app?.close();
  });

  beforeEach(() => {
    aiClient.callCount = 0;
    aiClient.lastPayload = null;
  });

  describe('Writing score consistency (DB-03)', () => {
    it('T01 — assess returns 0-100 normalized score matching declared scale', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/writing/assess')
        .set('Authorization', tokenA)
        .set('idempotency-key', 't01-assess')
        .send({
          userText: 'I are happy today.',
          language: 'english',
          targetLevel: 'B1',
        })
        .expect(201);

      expect(res.body).toHaveProperty('id');
      expect(res.body).toHaveProperty('overallScore');
      expect(typeof res.body.overallScore).toBe('number');
      expect(res.body.overallScore).toBeGreaterThanOrEqual(0);
      expect(res.body.overallScore).toBeLessThanOrEqual(100);

      // Fake AI returns 7/10 -> 70/100
      expect(res.body.overallScore).toBe(70);

      // Verify subscores are also normalized
      expect(res.body.scores).toBeDefined();
      expect(res.body.scores.grammar).toBe(60); // 6/10 -> 60
      expect(res.body.scores.vocabulary).toBe(80); // 8/10 -> 80

      expect(aiClient.callCount).toBe(1);
    });

    it('T02 — history returns same 0-100 score for same submission', async () => {
      // First, create a submission
      const assessRes = await request(app.getHttpServer())
        .post('/api/v1/writing/assess')
        .set('Authorization', tokenA)
        .set('idempotency-key', 't02-history')
        .send({
          userText: 'I are happy.',
          language: 'english',
        })
        .expect(201);

      const submissionId = assessRes.body.id;
      const expectedScore = assessRes.body.overallScore;

      // Now fetch history
      const historyRes = await request(app.getHttpServer())
        .get('/api/v1/writing/history')
        .set('Authorization', tokenA)
        .query({ page: 1, limit: 10 })
        .expect(200);

      expect(historyRes.body.items).toBeInstanceOf(Array);
      const found = historyRes.body.items.find(
        (item: any) => item.id === submissionId,
      );
      expect(found).toBeDefined();
      expect(found.overallScore).toBe(expectedScore);
      expect(found.overallScore).toBe(70);
    });

    it('T03 — detail (getById) returns same 0-100 score', async () => {
      // Create a submission
      const assessRes = await request(app.getHttpServer())
        .post('/api/v1/writing/assess')
        .set('Authorization', tokenA)
        .set('idempotency-key', 't03-detail')
        .send({
          userText: 'I are happy.',
          language: 'english',
        })
        .expect(201);

      const submissionId = assessRes.body.id;
      const expectedScore = assessRes.body.overallScore;

      // Fetch detail
      const detailRes = await request(app.getHttpServer())
        .get(`/api/v1/writing/${submissionId}`)
        .set('Authorization', tokenA)
        .expect(200);

      expect(detailRes.body.id).toBe(submissionId);
      expect(detailRes.body.overallScore).toBe(expectedScore);
      expect(detailRes.body.overallScore).toBe(70);
    });

    it('T04 — legacy payload without scale metadata uses prompt-default (1-10)', async () => {
      // Manually insert a legacy submission without scale metadata
      const legacyPayload = {
        overall_score: 7,
        feedback: 'Legacy feedback',
        errors: [],
        tips: [],
        // No scoreScale or maxScore
      };

      await prisma.writing_submissions.create({
        data: {
          user_id: FIXTURE.userA.id,
          user_text: 'Legacy text',
          language: 'english',
          ai_feedback: legacyPayload as any,
          score: { overall: 7 } as any,
        },
      });

      // Fetch history
      const historyRes = await request(app.getHttpServer())
        .get('/api/v1/writing/history')
        .set('Authorization', tokenA)
        .query({ page: 1, limit: 10 })
        .expect(200);

      const legacy = historyRes.body.items.find(
        (item: any) => item.userText === 'Legacy text',
      );
      expect(legacy).toBeDefined();
      // Legacy payload without metadata should use prompt-default scale (1-10)
      // 7/10 -> 70/100
      expect(legacy.overallScore).toBe(70);
    });

    it('T05 — idempotent replay returns same result, no double charge', async () => {
      const key = 't05-idempotent';
      const body = {
        userText: 'I are happy.',
        language: 'english',
      };

      // First request
      const first = await request(app.getHttpServer())
        .post('/api/v1/writing/assess')
        .set('Authorization', tokenA)
        .set('idempotency-key', key)
        .send(body)
        .expect(201);

      const firstScore = first.body.overallScore;
      const firstId = first.body.id;
      expect(aiClient.callCount).toBe(1);

      // Second request with same key
      const second = await request(app.getHttpServer())
        .post('/api/v1/writing/assess')
        .set('Authorization', tokenA)
        .set('idempotency-key', key)
        .send(body)
        .expect(201);

      // Should return the same result without calling AI again
      expect(second.body.overallScore).toBe(firstScore);
      expect(second.body.id).toBe(firstId);
      expect(aiClient.callCount).toBe(1); // No additional AI call

      // Verify only one token transaction
      const transactions = await prisma.token_transactions.findMany({
        where: {
          user_id: FIXTURE.userA.id,
          idempotency_key: {
            contains: 'writing-assess',
          },
        },
        orderBy: { created_at: 'desc' },
        take: 5,
      });

      const matchingTx = transactions.filter((tx) =>
        tx.idempotency_key?.includes(key.substring(0, 8)),
      );
      // Should have exactly one debit for this idempotency key
      const debits = matchingTx.filter((tx) => tx.amount < 0);
      expect(debits.length).toBeLessThanOrEqual(1);
    });
  });

  describe('Upload ownership (SEC-02/SEC-08)', () => {
    let submissionAId: string;

    beforeAll(async () => {
      // Create a writing submission for user A
      const res = await request(app.getHttpServer())
        .post('/api/v1/writing/assess')
        .set('Authorization', tokenA)
        .set('idempotency-key', 'ownership-setup')
        .send({
          userText: 'User A submission',
          language: 'english',
        })
        .expect(201);

      submissionAId = res.body.id;
    });

    it('T06 — user B cannot read user A\'s writing submission (404)', async () => {
      const res = await request(app.getHttpServer())
        .get(`/api/v1/writing/${submissionAId}`)
        .set('Authorization', tokenB);

      // Must be 404 (not 403) to avoid disclosing the resource exists
      expect(res.status).toBe(404);
      expect(res.body).not.toHaveProperty('userText');
      expect(res.body).not.toHaveProperty('ai_feedback');
    });

    it('T07 — user B cannot read user A\'s speaking submission (404)', async () => {
      // Manually create a speaking submission for user A
      const speakingA = await prisma.speaking_submissions.create({
        data: {
          user_id: FIXTURE.userA.id,
          topic: 'User A speaking',
          transcript: 'Hello world',
          feedback: 'Good pronunciation',
          language: 'english',
          level: 'B1',
          duration_sec: 10,
        },
      });

      const res = await request(app.getHttpServer())
        .get(`/api/v1/speaking/${speakingA.id}`)
        .set('Authorization', tokenB);

      expect(res.status).toBe(404);
      expect(res.body).not.toHaveProperty('transcript');
      expect(res.body).not.toHaveProperty('feedback');
    });

    it('T08 — user B cannot see user A\'s submissions in history', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/writing/history')
        .set('Authorization', tokenB)
        .query({ page: 1, limit: 100 })
        .expect(200);

      // User B's history should not contain user A's submission
      const found = res.body.items.find(
        (item: any) => item.id === submissionAId,
      );
      expect(found).toBeUndefined();

      // User B's history should only contain their own submissions
      for (const item of res.body.items) {
        const dbRow = await prisma.writing_submissions.findUnique({
          where: { id: item.id },
          select: { user_id: true },
        });
        expect(dbRow?.user_id).toBe(FIXTURE.userB.id);
      }
    });

    it('T09 — user A can read their own submission', async () => {
      const res = await request(app.getHttpServer())
        .get(`/api/v1/writing/${submissionAId}`)
        .set('Authorization', tokenA)
        .expect(200);

      expect(res.body.id).toBe(submissionAId);
      expect(res.body).toHaveProperty('userText');
      expect(res.body).toHaveProperty('overallScore');
    });

    it('T10 — invalid UUID returns 400', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/writing/not-a-uuid')
        .set('Authorization', tokenA);

      expect(res.status).toBe(400);
    });

    it('T11 — non-existent submission returns 404', async () => {
      const fakeId = 'ffffffff-ffff-4fff-ffff-ffffffffffff';
      const res = await request(app.getHttpServer())
        .get(`/api/v1/writing/${fakeId}`)
        .set('Authorization', tokenA);

      expect(res.status).toBe(404);
    });
  });

  describe('Speaking transcription (TEST-08)', () => {
    it('T12 — transcribe accepts valid audio payload', async () => {
      // Minimal WebM/EBML header so validateAudioPayload's signature check
      // passes. The service mocks transcription when no live key is present.
      const dummyAudio = Buffer.from([
        0x1a, 0x45, 0xdf, 0xa3, 0x9f, 0x42, 0x86, 0x81, 0x01, 0x42, 0xf7, 0x81,
        0x01,
      ]).toString('base64');

      const res = await request(app.getHttpServer())
        .post('/api/v1/speaking/transcribe')
        .set('Authorization', tokenA)
        .send({
          audio: dummyAudio,
          mimeType: 'audio/webm',
          language: 'english',
        })
        .expect(201);

      expect(res.body).toHaveProperty('transcript');
      expect(typeof res.body.transcript).toBe('string');
      expect(res.body.transcript.length).toBeGreaterThan(0);
    });

    it('T13 — transcribe rejects invalid MIME type', async () => {
      const dummyAudio = Buffer.from('dummy').toString('base64');

      const res = await request(app.getHttpServer())
        .post('/api/v1/speaking/transcribe')
        .set('Authorization', tokenA)
        .send({
          audio: dummyAudio,
          mimeType: 'application/pdf',
          language: 'english',
        });

      expect(res.status).toBe(400);
    });

    it('T14 — speaking history is scoped by user', async () => {
      // Create submissions for both users
      await prisma.speaking_submissions.create({
        data: {
          user_id: FIXTURE.userA.id,
          topic: 'A topic',
          transcript: 'A transcript',
          feedback: 'A feedback',
          language: 'english',
        },
      });

      await prisma.speaking_submissions.create({
        data: {
          user_id: FIXTURE.userB.id,
          topic: 'B topic',
          transcript: 'B transcript',
          feedback: 'B feedback',
          language: 'english',
        },
      });

      // User A's history
      const resA = await request(app.getHttpServer())
        .get('/api/v1/speaking/history')
        .set('Authorization', tokenA)
        .expect(200);

      expect(resA.body.items).toBeInstanceOf(Array);
      for (const item of resA.body.items) {
        expect(item.topic).not.toBe('B topic');
      }

      // User B's history
      const resB = await request(app.getHttpServer())
        .get('/api/v1/speaking/history')
        .set('Authorization', tokenB)
        .expect(200);

      expect(resB.body.items).toBeInstanceOf(Array);
      for (const item of resB.body.items) {
        expect(item.topic).not.toBe('A topic');
      }
    });
  });

  describe('Error analysis (TEST-08)', () => {
    it('T15 — error analysis requires at least one submission', async () => {
      // Create a fresh user with no submissions
      const newUser = await prisma.users.create({
        data: {
          id: 'cccccccc-3333-4ccc-cccc-cccccccccccc',
          email: 'no-submissions@example.com',
          password: 'test-password-hash',
          first_name: 'No',
          last_name: 'Submissions',
          email_verified: true,
        },
      });

      await prisma.user_token_balance.create({
        data: { user_id: newUser.id, balance: 1000 },
      });

      const loginRes = await request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .send({ email: newUser.email, password: 'password123' })
        .expect(200);

      const token = `Bearer ${loginRes.body.data.accessToken}`;

      const res = await request(app.getHttpServer())
        .get('/api/v1/writing/error-analysis')
        .set('Authorization', token)
        .set('idempotency-key', 't15-no-submissions')
        .query({ language: 'english', limit: 10 })
        .expect(200);

      expect(res.body).toHaveProperty('message');
      expect(res.body.totalErrors).toBe(0);
      expect(res.body.analyzedSubmissions).toBe(0);
    });

    it('T16 — error analysis aggregates errors from submissions', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/writing/error-analysis')
        .set('Authorization', tokenA)
        .set('idempotency-key', 't16-with-submissions')
        .query({ language: 'english', limit: 10 })
        .expect(200);

      expect(res.body).toHaveProperty('analyzedSubmissions');
      expect(res.body).toHaveProperty('totalErrors');
      expect(res.body).toHaveProperty('level');
      expect(res.body.analyzedSubmissions).toBeGreaterThan(0);
    });
  });
});
