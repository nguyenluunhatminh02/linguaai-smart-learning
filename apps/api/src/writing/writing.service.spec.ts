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
  let aiClient: AiClientService;

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
    aiClient = module.get<AiClientService>(AiClientService);
  });

  afterEach(() => {
    jest.resetAllMocks();
  });

  describe('getById', () => {
    it("returns 404 and no essay data when user B requests user A's submission", async () => {
      // The owner-scoped lookup cannot see A's row when called for B.
      mockPrisma.writing_submissions.findFirst.mockResolvedValue(null);

      await expect(service.getById(USER_B, SUBMISSION_A)).rejects.toBeInstanceOf(
        NotFoundException,
      );

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
    it('aggregates only the authenticated user\'s submissions', async () => {
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
      mockPrisma.writing_submissions.findMany.mockResolvedValue([ownSubmission]);
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
          errors: [
            expect.objectContaining({ original: 'I are happy' }),
          ],
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
        expect.objectContaining({ where: { user_id: USER_B, language: 'english' } }),
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
});
