// @ts-nocheck
/**
 * SEC-02 regression tests for reading ownership.
 *
 * reading_passages has a generated_by_user_id owner column, and history and
 * recommendations already use it. Before this fix, getById() used findUnique()
 * with only the passage id, so any authenticated user could read another
 * user's passage if they knew its UUID. These tests pin the owner-scoped query
 * and the 404 behaviour for foreign ids.
 */
import { NotFoundException } from '@nestjs/common';

import { ReadingService } from './reading.service';

const OWNER_ID = '00000000-0000-4000-8000-000000000001';
const OTHER_USER_ID = '00000000-0000-4000-8000-000000000002';
const PASSAGE_ID = '00000000-0000-4000-8000-000000000003';
const FOREIGN_PASSAGE_ID = '00000000-0000-4000-8000-000000000004';

describe('ReadingService ownership (SEC-02)', () => {
  let service: ReadingService;
  let prisma: any;
  let aiClient: any;
  let cache: any;

  beforeEach(() => {
    prisma = {
      reading_passages: {
        create: jest.fn(),
        findFirst: jest.fn(),
        findMany: jest.fn().mockResolvedValue([]),
        count: jest.fn().mockResolvedValue(0),
        findUnique: jest.fn(),
      },
    };
    aiClient = { post: jest.fn() };
    cache = {
      get: jest.fn().mockResolvedValue(undefined),
      set: jest.fn().mockResolvedValue(undefined),
    };
    service = new ReadingService(prisma, aiClient, cache);
  });

  describe('getById', () => {
    it('looks up the passage with both its id and the caller id', async () => {
      const passage = {
        id: PASSAGE_ID,
        generated_by_user_id: OWNER_ID,
        passage_text: 'owner passage',
      };
      prisma.reading_passages.findFirst.mockResolvedValue(passage);

      await expect(service.getById(OWNER_ID, PASSAGE_ID)).resolves.toBe(
        passage,
      );
      expect(prisma.reading_passages.findFirst).toHaveBeenCalledWith({
        where: { id: PASSAGE_ID, generated_by_user_id: OWNER_ID },
      });
      // A plain findUnique by id would expose the row regardless of owner.
      expect(prisma.reading_passages.findUnique).not.toHaveBeenCalled();
    });

    it("throws NotFoundException for another user's valid passage UUID", async () => {
      // The row exists, but an owner-scoped query must never see it.
      prisma.reading_passages.findFirst.mockResolvedValue(null);

      await expect(service.getById(OTHER_USER_ID, PASSAGE_ID)).rejects.toThrow(
        NotFoundException,
      );
      expect(prisma.reading_passages.findFirst).toHaveBeenCalledWith({
        where: { id: PASSAGE_ID, generated_by_user_id: OTHER_USER_ID },
      });
    });

    it('throws NotFoundException for a missing passage', async () => {
      prisma.reading_passages.findFirst.mockResolvedValue(null);
      await expect(
        service.getById(OWNER_ID, FOREIGN_PASSAGE_ID),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('owner-scoped reads and writes', () => {
    it("getHistory filters and counts only the caller's passages", async () => {
      prisma.reading_passages.findMany.mockResolvedValue([
        { id: PASSAGE_ID, generated_by_user_id: OWNER_ID, topic: 'travel' },
      ]);
      prisma.reading_passages.count.mockResolvedValue(1);

      const result = await service.getHistory(OWNER_ID, 2, 5);

      expect(prisma.reading_passages.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { generated_by_user_id: OWNER_ID },
          skip: 5,
          take: 5,
        }),
      );
      expect(prisma.reading_passages.count).toHaveBeenCalledWith({
        where: { generated_by_user_id: OWNER_ID },
      });
      expect(result.total).toBe(1);
    });

    it('generate stores the generated passage with the caller as owner', async () => {
      aiClient.post.mockResolvedValue({
        passage: 'A short passage.',
        vocabulary: [{ word: 'passage', definition: 'a section of text' }],
        questions: [
          {
            question: 'What is it?',
            options: ['passage', 'book'],
            correctAnswer: 'passage',
          },
        ],
      });
      prisma.reading_passages.create.mockResolvedValue({ id: PASSAGE_ID });

      const result = await service.generate(OWNER_ID, {
        level: 'B1',
        topic: 'travel',
        language: 'english',
        wordCount: 100,
      } as any);

      expect(prisma.reading_passages.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ generated_by_user_id: OWNER_ID }),
        }),
      );
      expect(result.id).toBe(PASSAGE_ID);
    });

    it("getRecommendations reads only the caller's history", async () => {
      await service.getRecommendations(OWNER_ID, 'english', 5);

      expect(prisma.reading_passages.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { generated_by_user_id: OWNER_ID } }),
      );
    });
  });
});
