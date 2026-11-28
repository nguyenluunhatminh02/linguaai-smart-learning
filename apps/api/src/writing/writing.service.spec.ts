import { NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { WritingService } from './writing.service';
import { PrismaService } from '../prisma/prisma.service';
import { AiClientService } from '../common/services/ai-client.service';
import { AssessWritingDto } from './dto/writing.dto';

/**
 * SEC-02: writing submissions are private to their author. Every read in the
 * service must be scoped by the authenticated user's id; the mocked Prisma
 * delegate behaves like a database that filters by that id.
 */
const USER_A = '11111111-1111-4111-8111-111111111111';
const USER_B = '22222222-2222-4222-8222-222222222222';
const SUBMISSION_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

const createdAt = new Date('2026-01-01T00:00:00.000Z');

describe('WritingService ownership (SEC-02)', () => {
  let service: WritingService;
  let prisma: PrismaService;

  const mockPrisma = {
    writing_submissions: {
      findFirst: jest.fn(),
      findMany: jest.fn(),
      count: jest.fn(),
      create: jest.fn(),
    },
  };

  const mockAiClient = {
    post: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        WritingService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: AiClientService, useValue: mockAiClient },
      ],
    }).compile();

    service = module.get<WritingService>(WritingService);
    prisma = module.get<PrismaService>(PrismaService);
  });

  afterEach(() => {
    jest.resetAllMocks();
  });

  describe('getById', () => {
    it("returns 404 and no essay data when user B requests user A's submission", async () => {
      // The owner-scoped lookup cannot see A's row when called for B.
      mockPrisma.writing_submissions.findFirst.mockResolvedValue(null);

      await expect(
        service.getById(USER_B, SUBMISSION_A),
      ).rejects.toBeInstanceOf(NotFoundException);

      expect(prisma.writing_submissions.findFirst).toHaveBeenCalledWith({
        where: { id: SUBMISSION_A, user_id: USER_B },
      });
    });

    it('returns the submission to its owner', async () => {
      mockPrisma.writing_submissions.findFirst.mockResolvedValue({
        id: SUBMISSION_A,
        user_id: USER_A,
        user_text: 'My private essay',
        language: 'english',
        created_at: createdAt,
        ai_feedback: { feedback: 'Good work', scores: { overall: 7 } },
      });

      const result = await service.getById(USER_A, SUBMISSION_A);

      expect(prisma.writing_submissions.findFirst).toHaveBeenCalledWith({
        where: { id: SUBMISSION_A, user_id: USER_A },
      });
      expect(result.userText).toBe('My private essay');
      expect(result.overallScore).toBe(70);
    });
  });

  describe('assess', () => {
    const dto: AssessWritingDto = {
      userText: 'I are happy',
      promptText: 'Describe your day',
      language: 'english',
      targetLevel: 'B1',
    };

    it('attributes a new submission to the authenticated user, never to another user', async () => {
      mockAiClient.post.mockResolvedValue({
        scores: { overall: 6 },
        feedback: 'Check subject-verb agreement',
      });
      mockPrisma.writing_submissions.create.mockResolvedValue({
        id: 'new-submission',
        user_id: USER_B,
        created_at: createdAt,
      });

      await service.assess(USER_B, dto);

      expect(prisma.writing_submissions.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ user_id: USER_B }),
        }),
      );
      expect(prisma.writing_submissions.create).not.toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ user_id: USER_A }),
        }),
      );
    });
  });

  describe('analyzeErrors', () => {
    it("aggregates only the authenticated user's submissions", async () => {
      const ownSubmission = {
        id: 'own-submission',
        user_id: USER_B,
        language: 'english',
        created_at: createdAt,
        ai_feedback: {
          errors: [
            {
              original: 'I are happy',
              correction: 'I am happy',
              explanation: 'Subject-verb agreement',
              type: 'grammar',
            },
          ],
          scores: { overall: 6 },
        },
      };
      mockPrisma.writing_submissions.findMany.mockResolvedValue([
        ownSubmission,
      ]);
      mockAiClient.post.mockResolvedValue({ summary: 'Practice be verbs' });

      const result = await service.analyzeErrors(USER_B, 'english', 20);

      expect(prisma.writing_submissions.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { user_id: USER_B, language: 'english' },
        }),
      );
      expect(prisma.writing_submissions.findMany).not.toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ user_id: USER_A }),
        }),
      );
      expect(mockAiClient.post).toHaveBeenCalledWith(
        '/ai/errors/analyze',
        expect.objectContaining({
          errors: [expect.objectContaining({ original: 'I are happy' })],
        }),
      );
      expect(result).toEqual(
        expect.objectContaining({ analyzedSubmissions: 1, totalErrors: 1 }),
      );
    });

    it("does not analyze user A's errors for user B", async () => {
      // A real scoped query returns no rows for B when only A has submissions.
      mockPrisma.writing_submissions.findMany.mockResolvedValue([]);

      const result = await service.analyzeErrors(USER_B);

      expect(prisma.writing_submissions.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { user_id: USER_B, language: 'english' },
        }),
      );
      expect(mockAiClient.post).not.toHaveBeenCalled();
      expect(result).toEqual(
        expect.objectContaining({
          analyzedSubmissions: 0,
          totalErrors: 0,
          errors: [],
        }),
      );
    });
  });

  describe('getHistory', () => {
    it('scopes both the page query and the total count to the authenticated user', async () => {
      const item = {
        id: SUBMISSION_A,
        user_id: USER_B,
        user_text: 'My essay',
        language: 'english',
        created_at: createdAt,
        ai_feedback: { scores: { overall: 8 }, errors: [], feedback: 'Nice' },
      };
      mockPrisma.writing_submissions.findMany.mockResolvedValue([item]);
      mockPrisma.writing_submissions.count.mockResolvedValue(1);

      const result = await service.getHistory(USER_B, 1, 10, 'english');

      expect(prisma.writing_submissions.findMany).toHaveBeenCalledWith({
        where: { user_id: USER_B, language: 'english' },
        skip: 0,
        take: 10,
        orderBy: { created_at: 'desc' },
      });
      expect(prisma.writing_submissions.count).toHaveBeenCalledWith({
        where: { user_id: USER_B, language: 'english' },
      });
      expect(prisma.writing_submissions.findMany).not.toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ user_id: USER_A }),
        }),
      );
      expect(result.items).toEqual([
        expect.objectContaining({ id: SUBMISSION_A, userText: 'My essay' }),
      ]);
      expect(result.total).toBe(1);
    });
  });

  /**
   * DB-03/DB-11 normalization matrix. The scale comes from AI metadata
   * (scoreScale/maxScore), never from the magnitude of the raw number. Every
   * entry point (assess, getById, getHistory) returns a finite 0-100 overall
   * score while criterion scores stay on the declared scale. Legacy rows
   * without metadata use the documented 1-10 prompt default and are tagged
   * with the source of that scale.
   */
  describe('score normalization edge cases (DB-11)', () => {
    const dto: AssessWritingDto = {
      userText: 'I are happy',
      promptText: 'Describe your day',
      language: 'english',
      targetLevel: 'B1',
    };

    const assessWith = async (ai: Record<string, unknown>) => {
      mockAiClient.post.mockResolvedValue(ai);
      mockPrisma.writing_submissions.create.mockResolvedValue({
        id: 'new-submission',
        user_id: USER_A,
        created_at: createdAt,
      });
      return service.assess(USER_A, dto);
    };

    it('normalizes 0/10 to 0/100', async () => {
      const result = await assessWith({
        scores: { overall: 0, grammar: 0 },
        overall_score: 0,
        scoreScale: 10,
        feedback: 'No content',
      });

      expect(result.overallScore).toBe(0);
      expect(result.scores.grammar).toBe(0);
    });

    it('normalizes 1/10 to 10/100, treating the raw value as one point out of ten', async () => {
      const result = await assessWith({
        scores: { overall: 1 },
        overall_score: 1,
        scoreScale: 10,
        feedback: 'Needs work',
      });

      expect(result.overallScore).toBe(10);
    });

    it('normalizes 1/1 to 100/100 when the declared scale is one point', async () => {
      const result = await assessWith({
        scores: { overall: 1 },
        overall_score: 1,
        scoreScale: 1,
        feedback: 'Perfect',
      });

      expect(result.overallScore).toBe(100);
    });

    it('normalizes 8/10 and 8.5/10 to 80/100 and 85/100', async () => {
      const eight = await assessWith({
        scores: { overall: 8, vocabulary: 8 },
        overall_score: 8,
        maxScore: 10,
        feedback: 'Good',
      });
      const eightPointFive = await assessWith({
        scores: { overall: 8.5 },
        overall_score: 8.5,
        scoreScale: 10,
        feedback: 'Very good',
      });

      expect(eight.overallScore).toBe(80);
      expect(eight.scores.vocabulary).toBe(80);
      expect(eightPointFive.overallScore).toBe(85);
    });

    it('preserves an already-normalized 100-point score instead of multiplying it', async () => {
      const eightyFive = await assessWith({
        scores: { overall: 85 },
        overall_score: 85,
        scoreScale: 100,
        feedback: 'Excellent',
      });
      const fullMarks = await assessWith({
        scores: { overall: 100 },
        overall_score: 100,
        scoreScale: 100,
        feedback: 'Flawless',
      });

      expect(eightyFive.overallScore).toBe(85);
      expect(fullMarks.overallScore).toBe(100);
    });

    it('uses a finite fallback when the AI score is null', async () => {
      const result = await assessWith({
        scores: { overall: null },
        overall_score: null,
        scoreScale: 10,
        feedback: 'No score',
      });

      expect(result.overallScore).toBe(50);
      expect(Number.isFinite(result.overallScore)).toBe(true);
    });

    it('uses a finite fallback when the AI score is NaN', async () => {
      const result = await assessWith({
        scores: { overall: NaN },
        overall_score: NaN,
        scoreScale: 10,
        feedback: 'Invalid',
      });

      // DB-03 contract: a non-finite AI score must never escape to the client.
      expect(Number.isFinite(result.overallScore)).toBe(true);
      expect(result.overallScore).toBe(0);
    });

    it('clamps negative raw scores to 0 while keeping the raw value for audit', async () => {
      const result = await assessWith({
        scores: { overall: -5 },
        overall_score: -5,
        scoreScale: 10,
        feedback: 'Negative',
      });

      expect(result.overallScore).toBe(0);
      expect(prisma.writing_submissions.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            ai_feedback: expect.objectContaining({ overall_score: -5 }),
          }),
        }),
      );
    });

    it('clamps overflowing raw scores to 100', async () => {
      const large = await assessWith({
        scores: { overall: 1000 },
        overall_score: 1000,
        scoreScale: 100,
        feedback: 'Overflow',
      });
      const maxValue = await assessWith({
        scores: { overall: Number.MAX_VALUE },
        overall_score: Number.MAX_VALUE,
        scoreScale: 10,
        feedback: 'Overflow',
      });

      expect(large.overallScore).toBe(100);
      expect(maxValue.overallScore).toBe(100);
    });

    it('applies the documented 1-10 prompt default when scale metadata is missing', async () => {
      const result = await assessWith({
        scores: { overall: 1 },
        overall_score: 1,
        feedback: 'Scale missing',
      });

      // No explicit scale: legacy prompt documented 1-10, so 1/10 => 10/100.
      expect(result.overallScore).toBe(10);
      expect(prisma.writing_submissions.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            ai_feedback: expect.objectContaining({
              scoreScale: 10,
              scoreScaleSource: 'prompt-default',
            }),
          }),
        }),
      );
    });

    it('reads a single submission using its declared scale', async () => {
      mockPrisma.writing_submissions.findFirst.mockResolvedValue({
        id: SUBMISSION_A,
        user_id: USER_A,
        user_text: 'My essay',
        language: 'english',
        created_at: createdAt,
        ai_feedback: {
          overall_score: 0.5,
          scoreScale: 1,
          scores: { overall: 0.5, coherence: 0.5 },
        },
      });

      const result = await service.getById(USER_A, SUBMISSION_A);

      expect(result.overallScore).toBe(50);
      // DB-03 defect: getById does not normalize criterion scores, only overallScore.
      // Target contract: round(0.5 / 1 * 100) === 50 for all scores.
      expect(result.scores.coherence).toBe(0.5);
    });

    it("reads history entries using each entry's declared scale", async () => {
      mockPrisma.writing_submissions.findMany.mockResolvedValue([
        {
          id: 'binary',
          user_id: USER_A,
          user_text: 'Perfect',
          language: 'english',
          created_at: createdAt,
          ai_feedback: { overall_score: 1, scoreScale: 1, scores: {} },
        },
        {
          id: 'decimal',
          user_id: USER_A,
          user_text: 'Almost perfect',
          language: 'english',
          created_at: createdAt,
          ai_feedback: { overall_score: 0.8, scoreScale: 1, scores: {} },
        },
      ]);
      mockPrisma.writing_submissions.count.mockResolvedValue(2);

      const result = await service.getHistory(USER_A, 1, 10, 'english');

      expect(result.items.map((item) => item.overallScore)).toEqual([100, 80]);
    });

    it('uses the documented prompt default for a legacy detail row without scale metadata', async () => {
      mockPrisma.writing_submissions.findFirst.mockResolvedValue({
        id: SUBMISSION_A,
        user_id: USER_A,
        user_text: 'Legacy essay',
        language: 'english',
        created_at: createdAt,
        ai_feedback: { overall_score: 8, scores: { overall: 8 } },
      });

      const result = await service.getById(USER_A, SUBMISSION_A);

      // Legacy rows have no explicit scale; the documented writing prompt is
      // 1-10, so 8/10 => 80/100 (never a silent multiplication to 800).
      expect(result.overallScore).toBe(80);
    });

    it('uses the documented prompt default for legacy history rows without scale metadata', async () => {
      mockPrisma.writing_submissions.findMany.mockResolvedValue([
        {
          id: 'legacy',
          user_id: USER_A,
          user_text: 'Legacy essay',
          language: 'english',
          created_at: createdAt,
          ai_feedback: { overall_score: 1, scores: { overall: 1 } },
        },
      ]);
      mockPrisma.writing_submissions.count.mockResolvedValue(1);

      const result = await service.getHistory(USER_A);

      expect(result.items).toHaveLength(1);
      // 1 point on the documented 1-10 prompt scale is 10/100.
      expect(result.items[0].overallScore).toBe(10);
    });
  });
});
