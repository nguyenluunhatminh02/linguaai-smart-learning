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
    decks: { upsert: jest.fn(), update: jest.fn() },
    cards: { findUnique: jest.fn(), create: jest.fn() },
  };

  const mockAnalytics = {
    recordActivity: jest.fn().mockResolvedValue(undefined),
  };

  const upsertPayload = (callIndex = 0) => mockPrisma.learning_completions.upsert.mock.calls[callIndex][0];

  const completeWith = async (dto: Record<string, unknown>) => {
    await service.completeSkillActivity(USER_ID, dto as unknown as CompleteSkillActivityDto);
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
      mockPrisma.learning_completions.findUnique.mockResolvedValue({ id: 'completion-1' });

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
      expect(upsertPayload(1).update).toEqual(expect.objectContaining({
        score: 9,
        total: 10,
        duration_seconds: 75,
      }));
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
      expect(upsertPayload().create).toEqual(expect.objectContaining({
        activity_type: 'scenario',
        activity_id: 'greetings',
        score: 1,
        total: 1,
      }));
      expect(upsertPayload().update).toEqual(expect.objectContaining({ score: 1, total: 1 }));
    });
  });

  describe('getProgress', () => {
    it('returns completion records with score, total, and attempt_number', async () => {
      const completions = [{
        activity_type: 'reading',
        activity_id: ACTIVITY_ID,
        language: 'english',
        completed_at: COMPLETED_AT,
        score: 8,
        total: 10,
        attempt_number: 2,
        duration_seconds: 120,
      }];
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
      expect(result[0]).toMatchObject({ score: 8, total: 10, attempt_number: 2 });
      expect(mockAnalytics.recordActivity).not.toHaveBeenCalled();
    });
  });
});
