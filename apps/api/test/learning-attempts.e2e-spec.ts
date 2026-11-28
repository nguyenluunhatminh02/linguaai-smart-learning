jest.mock('otplib', () => ({
  generateSecret: jest.fn(),
  verify: jest.fn(),
  generateURI: jest.fn(),
}));

import { INestApplication, VersioningType } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { Pool } from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';
import { WsAdapter } from '@nestjs/platform-ws';
import * as request from 'supertest';
import { AppModule } from '@/app.module';
import { PrismaClient } from '../src/generated/prisma';
import { seedTestDB, cleanupTestDB } from './setup';

/**
 * DB-02 / TEST-04: end-to-end coverage of retry counting and best/latest
 * rules. The API writes attempts with raw SQL and the generated Prisma client
 * has not been regenerated with the new models yet, so DB assertions also use
 * raw SQL. This follows the srs-review.e2e-spec.ts pattern: real HTTP + JWT
 * + PostgreSQL against the live database.
 */
describe('Learning attempts E2E', () => {
  let app: INestApplication;
  let accessToken: string;
  let userId: string;
  let prisma: PrismaClient;
  let pool: Pool;

  const activityId = 'e2e-reading-attempts';
  let attemptCounter = 0;

  const attemptId = () => {
    attemptCounter += 1;
    return `00000000-0000-4000-8000-${String(attemptCounter).padStart(12, '0')}`;
  };

  const progressBody = (overrides: Record<string, unknown> = {}) => ({
    activityType: 'reading',
    activityId,
    language: 'english',
    clientAttemptId: attemptId(),
    score: 2,
    total: 10,
    durationSeconds: 60,
    ...overrides,
  });

  const postAttempt = (body: Record<string, unknown>) =>
    request(app.getHttpServer())
      .post('/api/v1/learning/progress')
      .set('Authorization', `Bearer ${accessToken}`)
      .send(body);

  const attemptsForActivity = (activity: string) =>
    prisma.$queryRaw<
      Array<{
        client_attempt_id: string;
        raw_score: number | null;
        total: number | null;
        duration_seconds: number;
      }>
    >`
      SELECT client_attempt_id, raw_score, total, duration_seconds
      FROM learning_attempts
      WHERE user_id = ${userId}::uuid AND activity_id = ${activity}
      ORDER BY completed_at ASC, id ASC
    `;

  const summaryForActivity = (activity: string) =>
    prisma.$queryRaw<
      Array<{
        attempt_count: number;
        score: number | null;
        total: number | null;
        best_score: number | null;
        latest_score: number | null;
        duration_seconds: number;
        total_duration_seconds: number;
        first_completed_at: Date | null;
        last_completed_at: Date | null;
        completed_at: Date;
      }>
    >`
      SELECT attempt_count, score, total, best_score, latest_score,
             duration_seconds, total_duration_seconds,
             first_completed_at, last_completed_at, completed_at
      FROM learning_completions
      WHERE user_id = ${userId}::uuid
        AND activity_type = 'reading'
        AND activity_id = ${activity}
    `;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleRef.createNestApplication();
    app.useWebSocketAdapter(new WsAdapter(app));
    app.setGlobalPrefix('api');
    app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' });
    await app.init();

    const dbUrl =
      process.env.DATABASE_URL ||
      'postgresql://linguaai:linguaai_secret@localhost:5432/linguaai_test';
    pool = new Pool({ connectionString: dbUrl });
    prisma = new PrismaClient({ adapter: new PrismaPg(pool) });

    const seedResult = await seedTestDB();
    userId = seedResult.user.id;

    const loginRes = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email: 'test@example.com', password: 'password123' })
      .expect(200);
    accessToken = loginRes.body.data.accessToken;
  });

  afterAll(async () => {
    await cleanupTestDB();
    await app.close();
    await prisma.$disconnect();
    await pool.end();
  });

  it('records one attempt for the first submission and exposes it via GET /learning/progress', async () => {
    const body = progressBody({ score: 3, durationSeconds: 120 });

    const response = await postAttempt(body).expect(201);
    expect(response.body.data).toMatchObject({
      activity_type: 'reading',
      activity_id: activityId,
      language: 'english',
      score: 3,
      total: 10,
    });
    expect(response.body.data.completed_at).toBeDefined();

    const attempts = await attemptsForActivity(activityId);
    expect(attempts).toHaveLength(1);
    expect(attempts[0]).toMatchObject({
      client_attempt_id: body.clientAttemptId,
      raw_score: 3,
      total: 10,
      duration_seconds: 120,
    });

    const [summary] = await summaryForActivity(activityId);
    expect(summary).toMatchObject({
      attempt_count: 1,
      best_score: 3,
      latest_score: 3,
      total_duration_seconds: 120,
    });
    expect(summary.first_completed_at).not.toBeNull();
    expect(summary.last_completed_at).not.toBeNull();

    const progress = await request(app.getHttpServer())
      .get('/api/v1/learning/progress')
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(200);
    const entry = progress.body.data?.find(
      (item: { activity_id: string }) => item.activity_id === activityId,
    );
    expect(entry).toMatchObject({
      activity_type: 'reading',
      score: 3,
      total: 10,
    });
  });

  it('increments attempt_count per distinct retry with monotonic best and latest score', async () => {
    const activity = `${activityId}-best`;
    const first = progressBody({
      activityId: activity,
      score: 1,
      durationSeconds: 30,
    });
    const better = progressBody({
      activityId: activity,
      score: 9,
      durationSeconds: 90,
    });
    const lower = progressBody({
      activityId: activity,
      score: 4,
      durationSeconds: 60,
    });

    await postAttempt(first).expect(201);
    await postAttempt(better).expect(201);
    await postAttempt(lower).expect(201);

    const attempts = await attemptsForActivity(activity);
    expect(attempts.map((row) => row.client_attempt_id)).toEqual(
      expect.arrayContaining([
        first.clientAttemptId,
        better.clientAttemptId,
        lower.clientAttemptId,
      ]),
    );
    expect(attempts).toHaveLength(3);

    const [summary] = await summaryForActivity(activity);
    expect(summary).toMatchObject({
      attempt_count: 3,
      best_score: 9,
      latest_score: 4,
      total_duration_seconds: 180,
    });
  });

  it('treats a repeated clientAttemptId as a replay without changing count or stored score', async () => {
    const activity = `${activityId}-replay`;
    const body = progressBody({
      activityId: activity,
      score: 2,
      durationSeconds: 60,
    });

    const first = await postAttempt(body).expect(201);
    // Same key, different payload: the stored attempt must win.
    const retry = await postAttempt({
      ...body,
      score: 10,
      durationSeconds: 600,
    }).expect(201);
    expect(retry.body.data).toEqual(first.body.data);

    const attempts = await attemptsForActivity(activity);
    expect(attempts).toEqual([
      {
        client_attempt_id: body.clientAttemptId,
        raw_score: 2,
        total: 10,
        duration_seconds: 60,
      },
    ]);

    const [summary] = await summaryForActivity(activity);
    expect(summary).toMatchObject({
      attempt_count: 1,
      best_score: 2,
      latest_score: 2,
      total_duration_seconds: 60,
    });
    expect(retry.body.data.completed_at).toEqual(
      first.body.data.completed_at,
    );
  });

  it('keeps completed_at monotonic and first_completed_at stable for an older retry', async () => {
    const activity = `${activityId}-out-of-order`;
    const future = new Date(Date.now() + 60 * 60 * 1000);
    const past = new Date(Date.now() - 60 * 60 * 1000);

    // Seed a legacy summary whose completed_at is ahead of any incoming
    // attempt. The upsert must not move it backwards, while latest_score
    // still follows the newly recorded attempt.
    await prisma.$executeRaw`
      INSERT INTO learning_completions (
        user_id, activity_type, activity_id, language, score, total,
        duration_seconds, completed_at, first_completed_at, last_completed_at,
        attempt_count, best_score, latest_score, total_duration_seconds
      ) VALUES (
        ${userId}::uuid, 'reading', ${activity}, 'english', 5, 10,
        60, ${future}, ${past}, ${future},
        1, 5, 5, 60
      )
    `;

    await postAttempt(
      progressBody({ activityId: activity, score: 2, durationSeconds: 30 }),
    ).expect(201);

    const [summary] = await summaryForActivity(activity);
    expect(summary.attempt_count).toBe(2);
    expect(summary.best_score).toBe(5);
    expect(summary.latest_score).toBe(2);
    expect(new Date(summary.completed_at).getTime()).toBe(future.getTime());
    expect(new Date(summary.last_completed_at!).getTime()).toBe(
      future.getTime(),
    );
    expect(new Date(summary.first_completed_at!).getTime()).toBe(
      past.getTime(),
    );
  });

  it('inserts once and increments attempt_count once for concurrent retries with the same key', async () => {
    const activity = `${activityId}-concurrent`;
    const body = progressBody({
      activityId: activity,
      score: 6,
      durationSeconds: 90,
    });

    // Capture the generated key so both requests use the same one.
    const shared = { ...body, clientAttemptId: attemptId() };
    const responses = await Promise.all([
      postAttempt(shared),
      postAttempt({ ...shared, score: 9, durationSeconds: 300 }),
    ]);
    responses.forEach((response) => expect(response.status).toBe(201));

    const attempts = await attemptsForActivity(activity);
    expect(attempts).toHaveLength(1);
    expect(attempts[0]).toMatchObject({
      client_attempt_id: shared.clientAttemptId,
      raw_score: 6,
    });

    const [summary] = await summaryForActivity(activity);
    expect(summary).toMatchObject({
      attempt_count: 1,
      total_duration_seconds: 90,
    });

    const completions = await prisma.$queryRaw<
      Array<{ activity_id: string; attempt_count: number }>
    >`
      SELECT activity_id, attempt_count FROM learning_completions
      WHERE user_id = ${userId}::uuid AND activity_id = ${activity}
    `;
    expect(completions).toHaveLength(1);
  });

  it('replays deterministically when the client key is absent', async () => {
    const activity = `${activityId}-fallback`;
    const body = progressBody({
      activityId: activity,
      score: 3,
      durationSeconds: 45,
    });
    delete (body as { clientAttemptId?: string }).clientAttemptId;

    const first = await postAttempt(body).expect(201);
    const retry = await postAttempt(body).expect(201);
    expect(retry.body.data).toEqual(first.body.data);

    const attempts = await attemptsForActivity(activity);
    expect(attempts).toHaveLength(1);
    const [summary] = await summaryForActivity(activity);
    expect(summary.attempt_count).toBe(1);
  });
});
