// @ts-nocheck
import { Test, TestingModule } from '@nestjs/testing';
import 'reflect-metadata';

import { LearningService } from './learning.service';
import { PrismaService } from '../prisma/prisma.service';
import { CompleteSkillActivityDto } from './learning.dto';
import { AnalyticsService } from '../analytics/analytics.service';

const USER_ID = '00000000-0000-4000-8000-000000000001';
const ACTIVITY_ID = 'reading-passage-123';
const COMPLETED_AT = new Date('2026-11-28T12:00:00.000Z');

/**
 * Completion persistence contract for skill activities and scenarios.
 *
 * `CompleteSkillActivityDto` gained optional score/total/attemptNumber fields.
 * `saveCompletion` writes score/total on BOTH the create and update branches of
 * the upsert while omitting `duration_seconds` from the update payload when
 * the caller did not provide one; `attempt_number` is written by a separate
 * guarded raw update because the column is added by a migration rather than by
 * schema.prisma. Everything is mocked in memory: no live DB is required.
 */
describe('LearningService completion persistence', () => {
  let service: LearningService;
  let prisma: any;

  const mockPrisma = {
    learning_completions: {
      upsert: jest.fn(),
      findUnique: jest.fn(),
      findMany: jest.fn(),
    },
    $queryRaw: jest.fn(),
    $executeRaw: jest.fn(),
    $transaction: jest.fn((callback) => callback(mockPrisma)),
    learning_attempts: {
      create: jest.fn(async ({ data }) => ({
        id: 'attempt-1',
        completed_at: COMPLETED_AT,
        ...data,
      })),
      findUnique: jest.fn(),
    },
    decks: { upsert: jest.fn(), update: jest.fn() },
    cards: { findUnique: jest.fn(), create: jest.fn() },
  };

  const mockAnalytics = {
    recordActivity: jest.fn().mockResolvedValue(undefined),
  };

  const upsertPayload = (callIndex = 0) =>
    mockPrisma.learning_completions.upsert.mock.calls[callIndex][0];

  const completeWith = async (dto: Record<string, unknown>) => {
    await service.completeSkillActivity(
      USER_ID,
      dto as unknown as CompleteSkillActivityDto,
    );
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    mockPrisma.learning_completions.findUnique.mockResolvedValue(null);
    mockPrisma.learning_completions.findMany.mockResolvedValue([]);
    mockPrisma.learning_completions.upsert.mockResolvedValue({
      id: 'completion-1',
      user_id: USER_ID,
      activity_type: 'reading',
      activity_id: ACTIVITY_ID,
      language: 'english',
      score: null,
      total: null,
      duration_seconds: 0,
      completed_at: COMPLETED_AT,
    });
    // Column-existence probe: report the migration as applied so the
    // attempt_number write path is exercised deterministically.
    mockPrisma.$queryRaw.mockResolvedValue([{ present: true }]);
    mockPrisma.$executeRaw.mockResolvedValue(1);
    mockAnalytics.recordActivity.mockResolvedValue(undefined);
    // hasAttemptNumberColumn() memoizes its answer on the constructor; reset
    // it so each test starts from the probe above.
    (LearningService as any).attemptColumnAvailable = undefined;

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        LearningService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: AnalyticsService, useValue: mockAnalytics },
      ],
    }).compile();

    service = module.get<LearningService>(LearningService);
    prisma = module.get<PrismaService>(PrismaService);
  });

  describe('saveCompletion upsert contract', () => {
    it('writes score, total, and attemptNumber on create when provided', async () => {
      await completeWith({
        activityType: 'reading',
        activityId: ACTIVITY_ID,
        language: 'english',
        score: 8,
        total: 10,
        attemptNumber: 1,
        durationSeconds: 120,
      });

      expect(prisma.learning_completions.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            user_id_activity_type_activity_id: {
              user_id: USER_ID,
              activity_type: 'reading',
              activity_id: ACTIVITY_ID,
            },
          },
          create: expect.objectContaining({
            user_id: USER_ID,
            activity_type: 'reading',
            activity_id: ACTIVITY_ID,
            language: 'english',
            score: 8,
            total: 10,
            duration_seconds: 120,
          }),
          update: expect.objectContaining({
            score: 8,
            total: 10,
            duration_seconds: 120,
          }),
        }),
      );
      // attempt_number is applied through the guarded raw update after the upsert.
      expect(prisma.$executeRaw).toHaveBeenCalledTimes(1);
      expect(prisma.$queryRaw).toHaveBeenCalledTimes(1);
    });

    it('preserves duration_seconds on update when not provided', async () => {
      await completeWith({
        activityType: 'listening',
        activityId: 'listening-clip-456',
        language: 'english',
        score: 5,
        total: 10,
        attemptNumber: 2,
      });

      const { create, update } = upsertPayload();
      expect(update).toEqual(expect.objectContaining({ score: 5, total: 10 }));
      expect(update).not.toHaveProperty('duration_seconds');
      expect(create).not.toHaveProperty('duration_seconds');
    });

    it('updates score, total, and attemptNumber on subsequent attempts', async () => {
      mockPrisma.learning_completions.findUnique.mockResolvedValue({
        id: 'completion-1',
      });

      await completeWith({
        activityType: 'reading',
        activityId: ACTIVITY_ID,
        language: 'english',
        score: 6,
        total: 10,
        attemptNumber: 1,
        durationSeconds: 90,
      });
      await completeWith({
        activityType: 'reading',
        activityId: ACTIVITY_ID,
        language: 'english',
        score: 9,
        total: 10,
        attemptNumber: 2,
        durationSeconds: 75,
      });

      expect(prisma.learning_completions.upsert).toHaveBeenCalledTimes(2);
      expect(upsertPayload(1).update).toEqual(
        expect.objectContaining({
          score: 9,
          total: 10,
          duration_seconds: 75,
        }),
      );
      expect(prisma.$executeRaw).toHaveBeenCalledTimes(2);
    });

    it('omits undefined optional fields from create and update', async () => {
      await completeWith({
        activityType: 'reading',
        activityId: ACTIVITY_ID,
        language: 'english',
      });

      const { create, update } = upsertPayload();
      for (const payload of [create, update]) {
        expect(payload).not.toHaveProperty('attempt_number');
        expect(payload).not.toHaveProperty('duration_seconds');
        // Missing score/total are stored as SQL NULL so a rerun cannot leave
        // a stale score behind.
        expect(payload.score).toBeNull();
        expect(payload.total).toBeNull();
      }
      expect(prisma.$executeRaw).not.toHaveBeenCalled();
    });
  });

  describe('completeScenario score calculation', () => {
    // `greetings` has a single question whose correct option is index 1.
    it('calculates score and total from scenario questions', async () => {
      mockPrisma.learning_completions.upsert.mockResolvedValue({
        id: 'completion-1',
        user_id: USER_ID,
        activity_type: 'scenario',
        activity_id: 'greetings',
        language: 'english',
        score: 1,
        total: 1,
        completed_at: COMPLETED_AT,
      });

      const result = await service.completeScenario(USER_ID, 'greetings', [1]);

      expect(result).toEqual(expect.objectContaining({ score: 1, total: 1 }));
      expect(result.results).toHaveLength(1);
      expect(result.results[0].isCorrect).toBe(true);
      expect(upsertPayload().create).toEqual(
        expect.objectContaining({
          activity_type: 'scenario',
          activity_id: 'greetings',
          score: 1,
          total: 1,
        }),
      );
      expect(upsertPayload().update).toEqual(
        expect.objectContaining({ score: 1, total: 1 }),
      );
    });
  });

  describe('getProgress', () => {
    it('returns completion records with score, total, and attempt_number', async () => {
      const completions = [
        {
          activity_type: 'reading',
          activity_id: ACTIVITY_ID,
          language: 'english',
          completed_at: COMPLETED_AT,
          score: 8,
          total: 10,
          attempt_number: 2,
          duration_seconds: 120,
        },
      ];
      mockPrisma.learning_completions.findMany.mockResolvedValue(completions);

      const result = await service.getProgress(USER_ID);

      expect(prisma.learning_completions.findMany).toHaveBeenCalledWith({
        where: { user_id: USER_ID },
        orderBy: { completed_at: 'desc' },
        select: expect.objectContaining({
          activity_type: true,
          activity_id: true,
          language: true,
          completed_at: true,
          score: true,
          total: true,
          duration_seconds: true,
        }),
      });
      // The service returns the raw rows: any extra columns added by the
      // migration (such as attempt_number) flow through to callers unchanged.
      expect(result).toHaveLength(1);
      expect(result[0]).toMatchObject({
        score: 8,
        total: 10,
        attempt_number: 2,
      });
      expect(mockAnalytics.recordActivity).not.toHaveBeenCalled();
    });
  });
});

/**
 * DB-02/DB-08: append-only attempt history + summary invariants.
 *
 * The fake below interprets Prisma-style atomic writes (`{ increment: n }`)
 * and compound unique keys in memory, so the tests observe the same state a
 * real Postgres transaction would produce. Barriers are deferred promises:
 * every interleaving is forced explicitly, without sleeps or wall-clock waits.
 */
describe('LearningService learning attempt history (DB-02/DB-08)', () => {
  const ATTEMPT_KEYS = [
    'aaaaaaaa-0000-4000-8000-000000000001',
    'aaaaaaaa-0000-4000-8000-000000000002',
    'aaaaaaaa-0000-4000-8000-000000000003',
    'aaaaaaaa-0000-4000-8000-000000000004',
  ];
  const T0 = new Date('2026-11-28T09:00:00.000Z');
  const T1 = new Date('2026-11-28T10:00:00.000Z');
  const T2 = new Date('2026-11-28T11:00:00.000Z');

  const deferred = <T>() => {
    let resolve!: (value: T | PromiseLike<T>) => void;
    const promise = new Promise<T>((res) => {
      resolve = res;
    });
    return { promise, resolve };
  };
  const flush = () => new Promise<void>((resolve) => setImmediate(resolve));
  const iso = (value: unknown) =>
    value == null ? null : new Date(value as string).toISOString();

  const attemptDto = (overrides: Record<string, unknown> = {}) => ({
    activityType: 'reading',
    activityId: ACTIVITY_ID,
    language: 'english',
    clientAttemptId: ATTEMPT_KEYS[0],
    score: 0,
    total: 10,
    durationSeconds: 60,
    startedAt: T0,
    completedAt: T0,
    contentVersion: 'v1',
    ...overrides,
  });

  let service: LearningService;
  let state: {
    attempts: any[];
    summary: any;
    inserts: number;
  };
  let prismaMock: any;
  let analytics: { recordActivity: jest.Mock };
  let xpCalls: () => Array<[string, number, number, number?]>;

  const findAttempt = (where: any) => {
    const clientId =
      where?.user_id_client_attempt_id?.client_attempt_id ??
      where?.client_attempt_id;
    if (!clientId) return null;
    return (
      state.attempts.find(
        (attempt) =>
          attempt.client_attempt_id === clientId &&
          (where?.user_id_client_attempt_id?.user_id === undefined ||
            attempt.user_id === where.user_id_client_attempt_id.user_id),
      ) ?? null
    );
  };

  const initSummary = () => {
    if (!state.summary) {
      state.summary = {
        id: 'completion-1',
        user_id: USER_ID,
        activity_type: 'reading',
        activity_id: ACTIVITY_ID,
        language: 'english',
        score: null,
        total: null,
        duration_seconds: 0,
        completed_at: T0,
        first_completed_at: null,
        last_completed_at: null,
        attempt_count: 0,
        best_score: null,
        latest_score: null,
        total_duration_seconds: 0,
      };
    }
    return state.summary;
  };

  const summaryMatches = (where: any) => {
    const key = where?.user_id_activity_type_activity_id ?? where ?? {};
    const summary = state.summary;
    if (!summary) return false;
    if (key.id !== undefined && key.id !== summary.id) return false;
    if (key.user_id !== undefined && key.user_id !== summary.user_id)
      return false;
    if (
      key.activity_type !== undefined &&
      key.activity_type !== summary.activity_type
    )
      return false;
    if (
      key.activity_id !== undefined &&
      key.activity_id !== summary.activity_id
    )
      return false;
    return true;
  };

  const applySummaryWrite = (data: any) => {
    if (!data) return initSummary();
    const summary = initSummary();
    for (const [field, value] of Object.entries(data)) {
      if (value === undefined) continue;
      if (value && typeof value === 'object' && !(value instanceof Date)) {
        const atomic = value as Record<string, unknown>;
        if (typeof atomic.increment === 'number') {
          summary[field] = (summary[field] ?? 0) + atomic.increment;
          continue;
        }
        if (typeof atomic.decrement === 'number') {
          summary[field] = (summary[field] ?? 0) - atomic.decrement;
          continue;
        }
        if ('set' in atomic) {
          summary[field] = atomic.set;
          continue;
        }
        // Conditional expressions are only meaningful in updateMany; ignore
        // them here rather than writing a raw object into the fake row.
        continue;
      }
      summary[field] = value;
    }
    return summary;
  };

  const insertAttempt = (data: any) => {
    const clientAttemptId = data.client_attempt_id ?? data.clientAttemptId;
    if (!clientAttemptId) {
      throw new Error('clientAttemptId is required for an attempt insert');
    }
    if (
      findAttempt({
        user_id_client_attempt_id: { client_attempt_id: clientAttemptId },
      })
    ) {
      const error = new Error(
        'Unique constraint failed on the fields: (`user_id`,`client_attempt_id`)',
      ) as Error & { code?: string };
      error.code = 'P2002';
      throw error;
    }
    const row = {
      id: `attempt-${state.attempts.length + 1}`,
      user_id: USER_ID,
      language: 'english',
      activity_type: 'reading',
      activity_id: ACTIVITY_ID,
      content_version: null,
      client_attempt_id: clientAttemptId,
      raw_score: null,
      score_scale: null,
      normalized_score: null,
      total: null,
      duration_seconds: 0,
      started_at: null,
      completed_at: T0,
      feedback_ref: null,
      ...data,
      client_attempt_id: clientAttemptId,
    };
    state.attempts.push(row);
    state.inserts += 1;
    return row;
  };

  const matchesWhere = (row: any, where: any = {}) =>
    Object.entries(where).every(([field, condition]) => {
      if (
        condition === null ||
        typeof condition !== 'object' ||
        condition instanceof Date
      ) {
        return row[field] === condition;
      }
      const clause = condition as Record<string, unknown>;
      if ('equals' in clause) return row[field] === clause.equals;
      const compare = (operator: string, test: (delta: number) => boolean) => {
        if (!(operator in clause)) return true;
        return test(
          new Date(row[field] as string).getTime() -
            new Date(clause[operator] as string).getTime(),
        );
      };
      return (
        compare('lt', (delta) => delta < 0) &&
        compare('lte', (delta) => delta <= 0) &&
        compare('gt', (delta) => delta > 0) &&
        compare('gte', (delta) => delta >= 0)
      );
    });

  beforeEach(async () => {
    jest.clearAllMocks();
    state = { attempts: [], summary: null, inserts: 0 };
    analytics = { recordActivity: jest.fn().mockResolvedValue(undefined) };
    (LearningService as any).attemptColumnAvailable = undefined;

    prismaMock = {
      learning_attempts: {
        findUnique: jest.fn(async ({ where }) => findAttempt(where)),
        findFirst: jest.fn(async ({ where }) => findAttempt(where)),
        findMany: jest.fn(async () =>
          state.attempts.map((row) => ({ ...row })),
        ),
        count: jest.fn(async () => state.attempts.length),
        create: jest.fn(async ({ data }) => insertAttempt(data)),
        createMany: jest.fn(async ({ data, skipDuplicates }) => {
          const rows = Array.isArray(data) ? data : [data];
          let created = 0;
          for (const row of rows) {
            try {
              insertAttempt(row);
              created += 1;
            } catch (error) {
              if (!skipDuplicates || (error as any).code !== 'P2002')
                throw error;
            }
          }
          return { count: created };
        }),
        upsert: jest.fn(async ({ where, create, update }) => {
          const existing = findAttempt(where);
          if (existing) return applySummaryWrite(update);
          return insertAttempt(create);
        }),
      },
      learning_completions: {
        findUnique: jest.fn(async ({ where }) =>
          summaryMatches(where) ? { ...state.summary } : null,
        ),
        findFirst: jest.fn(async ({ where }) =>
          summaryMatches(where) ? { ...state.summary } : null,
        ),
        findMany: jest.fn(async () =>
          state.summary ? [{ ...state.summary }] : [],
        ),
        create: jest.fn(async ({ data }) => ({ ...applySummaryWrite(data) })),
        upsert: jest.fn(async ({ where, create, update }) => {
          const exists = summaryMatches(where);
          if (!exists && create) applySummaryWrite(create);
          return { ...applySummaryWrite(exists ? update : {}) };
        }),
        update: jest.fn(async ({ where, data }) =>
          summaryMatches(where) ? { ...applySummaryWrite(data) } : null,
        ),
        updateMany: jest.fn(async ({ where, data }) => {
          const count =
            state.summary && matchesWhere(state.summary, where ?? {}) ? 1 : 0;
          if (count) applySummaryWrite(data);
          return { count };
        }),
      },
      $transaction: jest.fn(async (argument) =>
        Array.isArray(argument) ? Promise.all(argument) : argument(prismaMock),
      ),
      $queryRaw: jest.fn(async () => [{ present: true }]),
      $executeRaw: jest.fn(async () => 1),
      decks: { upsert: jest.fn(), update: jest.fn() },
      cards: { findUnique: jest.fn(), create: jest.fn() },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        LearningService,
        { provide: PrismaService, useValue: prismaMock },
        { provide: AnalyticsService, useValue: analytics },
      ],
    }).compile();

    service = module.get<LearningService>(LearningService);
    xpCalls = () =>
      analytics.recordActivity.mock.calls.map(
        (call: unknown[]) => call as [string, number, number, number?],
      );
  });

  const completeAttempt = (dto: Record<string, unknown>) =>
    service.completeSkillActivity(
      USER_ID,
      dto as unknown as CompleteSkillActivityDto,
    );

  it('tracks low scores across attempts with monotonic best, latest score, summed duration and XP', async () => {
    const scores = [0, 1, 2];
    const durations = [60, 120, 180];
    const completed = [T0, T1, T2];

    for (let index = 0; index < scores.length; index += 1) {
      await completeAttempt(
        attemptDto({
          clientAttemptId: ATTEMPT_KEYS[index],
          score: scores[index],
          durationSeconds: durations[index],
          completedAt: completed[index],
        }),
      );
    }

    expect(state.inserts).toBe(3);
    expect(state.attempts).toHaveLength(3);
    expect(state.attempts[0]).toMatchObject({
      user_id: USER_ID,
      client_attempt_id: ATTEMPT_KEYS[0],
      activity_type: 'reading',
      activity_id: ACTIVITY_ID,
      language: 'english',
      total: 10,
      duration_seconds: 60,
    });
    expect(iso(state.attempts[0].completed_at)).toBe(T0.toISOString());
    expect(state.summary).toMatchObject({
      attempt_count: 3,
      best_score: 2,
      latest_score: 2,
      total_duration_seconds: 360,
    });
    expect(xpCalls().map((call) => call[1])).toEqual([5, 7, 9]);
    expect(xpCalls().map((call) => call[2])).toEqual([1, 2, 3]);
  });

  it('tracks high scores, grants the perfect bonus only on full marks and caps XP at 50', async () => {
    const scores = [8, 10, 9];
    for (let index = 0; index < scores.length; index += 1) {
      await completeAttempt(
        attemptDto({
          clientAttemptId: ATTEMPT_KEYS[index],
          score: scores[index],
          completedAt: [T0, T1, T2][index],
        }),
      );
    }

    expect(state.summary).toMatchObject({
      attempt_count: 3,
      best_score: 10,
      latest_score: 9,
    });
    expect(xpCalls().map((call) => call[1])).toEqual([21, 30, 23]);

    await completeAttempt(
      attemptDto({
        clientAttemptId: ATTEMPT_KEYS[3],
        score: 100,
        total: 100,
        completedAt: new Date('2026-11-28T12:00:00.000Z'),
      }),
    );

    expect(state.summary.best_score).toBe(100);
    expect(state.summary.latest_score).toBe(100);
    expect(xpCalls()[3][1]).toBe(50);
  });

  it('treats a repeated clientAttemptId as a no-op for attempts, summary and analytics', async () => {
    const dto = attemptDto({ score: 2, durationSeconds: 60 });
    const first = await completeAttempt(dto);
    const retry = await completeAttempt({
      ...dto,
      score: 8,
      durationSeconds: 600,
    });

    expect(state.inserts).toBe(1);
    expect(state.attempts).toHaveLength(1);
    expect(state.summary).toMatchObject({
      attempt_count: 1,
      best_score: 2,
      latest_score: 2,
      total_duration_seconds: 60,
    });
    expect(xpCalls()).toHaveLength(1);
    expect(xpCalls()[0].slice(0, 3)).toEqual([USER_ID, 9, 1]);
    expect(retry).toBeDefined();
    expect(first).toBeDefined();
  });

  it('keeps first/last timestamps and latest score correct for out-of-order completions', async () => {
    // Arrival order differs from completion order; the summary must follow
    // completed_at, while best_score stays monotonic.
    await completeAttempt(
      attemptDto({
        clientAttemptId: ATTEMPT_KEYS[0],
        score: 2,
        completedAt: T2,
      }),
    );
    await completeAttempt(
      attemptDto({
        clientAttemptId: ATTEMPT_KEYS[1],
        score: 0,
        completedAt: T0,
      }),
    );
    await completeAttempt(
      attemptDto({
        clientAttemptId: ATTEMPT_KEYS[2],
        score: 10,
        completedAt: T1,
      }),
    );

    expect(iso(state.summary.first_completed_at)).toBe(T0.toISOString());
    expect(iso(state.summary.last_completed_at)).toBe(T2.toISOString());
    expect(state.summary).toMatchObject({
      attempt_count: 3,
      best_score: 10,
      latest_score: 2,
      total_duration_seconds: 180,
    });
  });

  it('serializes concurrent distinct attempts without losing increments (deferred barrier)', async () => {
    const gate = deferred<void>();
    let gateArmed = false;
    prismaMock.learning_completions.upsert.mockImplementation(
      async ({ where, create, update }: any) => {
        if (!gateArmed) {
          gateArmed = true;
          await gate.promise;
        }
        const exists = summaryMatches(where);
        if (!exists && create) applySummaryWrite(create);
        return { ...applySummaryWrite(exists ? update : {}) };
      },
    );

    const newer = service.completeSkillActivity(
      USER_ID,
      attemptDto({
        clientAttemptId: ATTEMPT_KEYS[0],
        score: 4,
        completedAt: T1,
      }) as unknown as CompleteSkillActivityDto,
    );
    const older = service.completeSkillActivity(
      USER_ID,
      attemptDto({
        clientAttemptId: ATTEMPT_KEYS[1],
        score: 7,
        completedAt: T0,
      }) as unknown as CompleteSkillActivityDto,
    );
    await flush();
    gate.resolve();
    await Promise.all([newer, older]);

    expect(state.inserts).toBe(2);
    expect(state.summary).toMatchObject({
      attempt_count: 2,
      best_score: 7,
      latest_score: 4,
      total_duration_seconds: 120,
    });
    expect(xpCalls()).toHaveLength(2);
    expect(
      xpCalls()
        .map((call) => call[1])
        .sort((a, b) => a - b),
    ).toEqual([13, 19]);
  });

  it('inserts once when two callers race with the same clientAttemptId', async () => {
    const firstInsert = deferred<void>();
    const lookups = new Map<string, number>();
    prismaMock.learning_completions.findUnique.mockImplementation(
      async ({ where }: any) => {
        const key =
          where?.user_id_activity_type_activity_id?.activity_id ?? 'unknown';
        const seen = (lookups.get(key) ?? 0) + 1;
        lookups.set(key, seen);
        const existing =
          state.summary && summaryMatches(where) ? { ...state.summary } : null;
        if (existing) return existing;
        // Hold every lookup after the first until the first attempt insert
        // lands; no timer or sleep is involved.
        if (seen > 1) await firstInsert.promise;
        return state.summary && summaryMatches(where)
          ? { ...state.summary }
          : null;
      },
    );
    prismaMock.learning_attempts.create.mockImplementation(
      async ({ data }: any) => {
        const row = insertAttempt(data);
        firstInsert.resolve();
        return row;
      },
    );

    const dto = attemptDto({ score: 6, durationSeconds: 90 });
    await Promise.all([
      completeAttempt(dto),
      completeAttempt({ ...dto, score: 9, durationSeconds: 300 }),
    ]);

    expect(state.inserts).toBe(1);
    expect(state.attempts).toHaveLength(1);
    expect(state.summary).toMatchObject({
      attempt_count: 1,
      best_score: 6,
      latest_score: 6,
      total_duration_seconds: 90,
    });
    expect(xpCalls()).toHaveLength(1);
    expect(xpCalls()[0].slice(0, 3)).toEqual([USER_ID, 17, 2]);
  });

  it('still completes an inserted attempt when analytics bookkeeping fails', async () => {
    analytics.recordActivity.mockRejectedValueOnce(new Error('analytics down'));

    await expect(
      completeAttempt(attemptDto({ score: 3 })),
    ).resolves.toBeDefined();

    expect(state.inserts).toBe(1);
    expect(state.summary.attempt_count).toBe(1);
    expect(xpCalls()).toHaveLength(1);
  });

  it('projects the attempt summary fields through getProgress', async () => {
    await completeAttempt(attemptDto({ score: 5 }));

    await service.getProgress(USER_ID);

    expect(prismaMock.learning_completions.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { user_id: USER_ID },
        orderBy: { completed_at: 'desc' },
        select: expect.objectContaining({
          first_completed_at: true,
          last_completed_at: true,
          attempt_count: true,
          best_score: true,
          latest_score: true,
          total_duration_seconds: true,
        }),
      }),
    );
  });
});
