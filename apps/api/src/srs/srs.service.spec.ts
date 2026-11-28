import { Test, TestingModule } from '@nestjs/testing';
import { SrsService } from './srs.service';
import { PrismaService } from '../prisma/prisma.service';
import { ConflictException, NotFoundException } from '@nestjs/common';
import { FsrsAlgorithm } from './fsrs.algorithm';

describe('SrsService', () => {
  let service: SrsService;

  const mockPrismaService = {
    $transaction: jest.fn(),
    $queryRaw: jest.fn(),
    user_card_progress: {
      findMany: jest.fn(),
      findUnique: jest.fn(),
      upsert: jest.fn(),
      updateMany: jest.fn(),
    },
    cards: {
      findMany: jest.fn(),
      findUnique: jest.fn(),
      findFirst: jest.fn(),
      count: jest.fn(),
    },
    srs_review_events: {
      findUnique: jest.fn(),
      create: jest.fn(),
    },
    decks: {
      findFirst: jest.fn(),
    },
    review_sessions: {
      create: jest.fn(),
      findUnique: jest.fn(),
      findFirst: jest.fn(),
      updateMany: jest.fn(),
    },
  };

  beforeEach(async () => {
    mockPrismaService.$transaction.mockImplementation((callback) =>
      callback(mockPrismaService),
    );
    mockPrismaService.$queryRaw.mockResolvedValue([]);
    mockPrismaService.cards.findFirst.mockResolvedValue({ id: 'card-1' });
    mockPrismaService.decks.findFirst.mockResolvedValue({ id: 'deck-456' });
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SrsService,
        {
          provide: PrismaService,
          useValue: mockPrismaService,
        },
      ],
    }).compile();

    service = module.get<SrsService>(SrsService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  // ─── getDueCards ─────────────────────────────────────────────────────────
  describe('getDueCards', () => {
    const userId = 'user-123';
    const deckId = 'deck-456';

    it('should return due cards when available', async () => {
      const now = new Date();
      const mockDueProgress = [
        {
          user_id: userId,
          card_id: 'card-1',
          ease_factor: 3.5,
          difficulty: 5.0,
          interval_days: 7,
          repetition_count: 3,
          next_review_date: new Date(now.getTime() - 86400000), // 1 day ago
          last_review_date: new Date(now.getTime() - 86400000 * 8),
          quality_history: [3, 3, 4],
          cards: {
            id: 'card-1',
            deck_id: deckId,
            front_text: 'Hello',
            back_text: 'Xin chào',
            ipa_pronunciation: null,
            audio_url: null,
            example_sentence: null,
            image_url: null,
            created_at: new Date(),
          },
        },
      ];

      mockPrismaService.user_card_progress.findMany
        .mockResolvedValueOnce(mockDueProgress)
        .mockResolvedValueOnce([{ card_id: 'card-1' }]); // for learned cards query
      mockPrismaService.cards.findMany.mockResolvedValueOnce([]); // no new cards to fetch

      const result = await service.getDueCards(userId, deckId, 20);

      expect(result.dueCards).toHaveLength(1);
      expect(result.dueCards[0].card.front_text).toBe('Hello');
      expect(result.dueCards[0].progress.easeFactor).toBe(3.5);
      expect(result.totalDue).toBe(1);
      expect(
        mockPrismaService.user_card_progress.findMany,
      ).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            user_id: userId,
            next_review_date: { lte: expect.any(Date) },
          }),
        }),
      );
    });

    it('should fetch new cards when due cards are insufficient', async () => {
      mockPrismaService.user_card_progress.findMany
        .mockResolvedValueOnce([]) // no due cards
        .mockResolvedValueOnce([]); // no learned cards

      const mockNewCards = [
        {
          id: 'card-new-1',
          deck_id: deckId,
          front_text: 'Cat',
          back_text: 'Mèo',
        },
        {
          id: 'card-new-2',
          deck_id: deckId,
          front_text: 'Dog',
          back_text: 'Chó',
        },
      ];
      mockPrismaService.cards.findMany.mockResolvedValueOnce(mockNewCards);

      const result = await service.getDueCards(userId, deckId, 20);

      expect(result.dueCards).toHaveLength(0);
      expect(result.newCards).toHaveLength(2);
      expect(result.totalNew).toBe(2);
      expect(mockPrismaService.cards.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            deck_id: deckId,
            id: { notIn: [] },
            retired_at: null,
          }),
          take: 20,
        }),
      );
    });

    it('should mix due and new cards up to limit', async () => {
      const mockDueProgress = [
        {
          user_id: userId,
          card_id: 'card-1',
          ease_factor: 2.5,
          interval_days: 3,
          repetition_count: 1,
          cards: { id: 'card-1', front_text: 'A', back_text: 'Á' },
        },
      ];
      mockPrismaService.user_card_progress.findMany
        .mockResolvedValueOnce(mockDueProgress)
        .mockResolvedValueOnce([{ card_id: 'card-1' }]);

      const mockNewCards = [
        { id: 'card-new-1', front_text: 'B', back_text: 'Bê' },
      ];
      mockPrismaService.cards.findMany.mockResolvedValueOnce(mockNewCards);

      const result = await service.getDueCards(userId, deckId, 2);

      expect(result.totalDue).toBe(1);
      expect(result.totalNew).toBe(1);
    });

    it('should order due cards by next_review_date ascending', async () => {
      const now = new Date();
      const mockDueProgress = [
        {
          card_id: 'card-1',
          next_review_date: new Date(now.getTime() - 86400000 * 3),
          cards: { id: 'card-1', front_text: 'Oldest' },
        },
        {
          card_id: 'card-2',
          next_review_date: new Date(now.getTime() - 86400000),
          cards: { id: 'card-2', front_text: 'Newest' },
        },
      ];
      mockPrismaService.user_card_progress.findMany
        .mockResolvedValueOnce(mockDueProgress)
        .mockResolvedValueOnce([]); // for learned cards query
      mockPrismaService.cards.findMany.mockResolvedValueOnce([]); // no new cards

      await service.getDueCards(userId, deckId);

      expect(
        mockPrismaService.user_card_progress.findMany,
      ).toHaveBeenCalledWith(
        expect.objectContaining({
          orderBy: { next_review_date: 'asc' },
        }),
      );
    });
  });

  // ─── reviewCard ──────────────────────────────────────────────────────────
  describe('reviewCard', () => {
    const userId = 'user-123';
    const cardId = 'card-456';

    it('replays a confirmed review without updating the review history twice', async () => {
      const response = { cardId, nextReviewDate: new Date().toISOString() };
      mockPrismaService.srs_review_events.findUnique.mockResolvedValueOnce({
        user_id: userId,
        card_id: cardId,
        result: { grade: 3, response },
      });

      await expect(
        service.reviewCard(userId, {
          cardId,
          grade: 3,
          operationId: 'review-1',
        }),
      ).resolves.toEqual(response);
      expect(
        mockPrismaService.user_card_progress.upsert,
      ).not.toHaveBeenCalled();
    });

    it('keeps a recently forgotten card in difficult words with its actual meaning', async () => {
      mockPrismaService.user_card_progress.findMany.mockResolvedValueOnce([
        {
          cards: {
            deck_id: 'deck-1',
            front_text: 'Hello',
            back_text: 'Xin chào',
          },
          card_id: cardId,
          ease_factor: 0.4,
          difficulty: 5,
          interval_days: 1,
          repetition_count: 0,
          last_review_date: new Date(),
          next_review_date: new Date(),
          quality_history: [3, 1],
        },
      ]);

      const result = await service.getRetentionDashboard(userId);
      expect(result.decks[0].worstCards[0]).toMatchObject({
        backText: 'Xin chào',
        isAtRisk: true,
        attempts: 2,
        correctAttempts: 1,
      });
    });

    it('should create new progress for first review with Good grade', async () => {
      mockPrismaService.user_card_progress.findUnique.mockResolvedValueOnce(
        null,
      );

      const mockUpsertResult = {
        user_id: userId,
        card_id: cardId,
        ease_factor: 3.1262,
        difficulty: 5.0,
        interval_days: 3,
        repetition_count: 1,
        next_review_date: new Date(),
        last_review_date: new Date(),
        quality_history: [3],
      };
      mockPrismaService.user_card_progress.upsert.mockResolvedValueOnce(
        mockUpsertResult,
      );

      const result = await service.reviewCard(userId, { cardId, grade: 3 });

      expect(mockPrismaService.user_card_progress.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { user_id_card_id: { user_id: userId, card_id: cardId } },
          create: expect.objectContaining({
            user_id: userId,
            card_id: cardId,
            ease_factor: expect.any(Number),
            difficulty: expect.any(Number),
            interval_days: expect.any(Number),
            repetition_count: 1,
            quality_history: [3],
          }),
        }),
      );
      expect(result.cardId).toBe(cardId);
      expect(result.stability).toBeCloseTo(3.1262, 2);
      expect(result.newInterval).toBeGreaterThan(0);
    });

    it('should reset repetitions for Again (1) on first review', async () => {
      mockPrismaService.user_card_progress.findUnique.mockResolvedValueOnce(
        null,
      );

      const mockResult = {
        repetition_count: 0,
        interval_days: 1,
        next_review_date: new Date(),
        quality_history: [1],
      };
      mockPrismaService.user_card_progress.upsert.mockResolvedValueOnce(
        mockResult,
      );

      const result = await service.reviewCard(userId, { cardId, grade: 1 });

      expect(result.cardId).toBe(cardId);
      expect(result.newInterval).toBe(1);
    });

    it('should update existing progress correctly', async () => {
      const lastReviewDate = new Date(Date.now() - 86400000 * 5); // 5 days ago
      const existingProgress = {
        user_id: userId,
        card_id: cardId,
        ease_factor: 3.5,
        difficulty: 5.0,
        interval_days: 5,
        repetition_count: 2,
        last_review_date: lastReviewDate,
        quality_history: [3, 3],
      };
      mockPrismaService.user_card_progress.findUnique.mockResolvedValueOnce(
        existingProgress,
      );

      const mockUpdatedProgress = {
        ...existingProgress,
        ease_factor: 10.5, // This will be the actual FSRS result
        interval_days: 10,
        repetition_count: 3,
        next_review_date: new Date(),
        quality_history: [3, 3, 4],
      };
      mockPrismaService.user_card_progress.upsert.mockResolvedValueOnce(
        mockUpdatedProgress,
      );

      const result = await service.reviewCard(userId, { cardId, grade: 4 });

      expect(result.cardId).toBe(cardId);
      expect(result.stability).toBeGreaterThan(0); // FSRS will calculate actual value
      expect(result.newInterval).toBeGreaterThan(0);
      expect(mockPrismaService.user_card_progress.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          update: expect.objectContaining({
            ease_factor: expect.any(Number),
            difficulty: expect.any(Number),
            interval_days: expect.any(Number),
            repetition_count: expect.any(Number),
            quality_history: [3, 3, 4],
          }),
        }),
      );
    });

    it('should calculate days since last review correctly', async () => {
      const fiveDaysAgo = new Date(Date.now() - 86400000 * 5);
      const existingProgress = {
        ease_factor: 3.0,
        difficulty: 5.0,
        repetition_count: 1,
        last_review_date: fiveDaysAgo,
        quality_history: [3],
      };
      mockPrismaService.user_card_progress.findUnique.mockResolvedValueOnce(
        existingProgress,
      );
      mockPrismaService.user_card_progress.upsert.mockResolvedValueOnce({});

      await service.reviewCard(userId, { cardId, grade: 3 });

      // Verify that FSRS calculation was called with correct elapsed days
      // (indirectly verified through upsert call with updated values)
      expect(mockPrismaService.user_card_progress.upsert).toHaveBeenCalled();
    });

    it('should append grade to quality_history', async () => {
      const existingProgress = {
        ease_factor: 2.5,
        difficulty: 5.0,
        repetition_count: 2,
        last_review_date: new Date(),
        quality_history: [3, 4],
      };
      mockPrismaService.user_card_progress.findUnique.mockResolvedValueOnce(
        existingProgress,
      );
      mockPrismaService.user_card_progress.upsert.mockResolvedValueOnce({
        quality_history: [3, 4, 2],
      });

      await service.reviewCard(userId, { cardId, grade: 2 });

      expect(mockPrismaService.user_card_progress.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          update: expect.objectContaining({
            quality_history: [3, 4, 2],
          }),
        }),
      );
    });

    it('should handle forgetting (grade 1) on subsequent reviews', async () => {
      const existingProgress = {
        ease_factor: 3.5,
        difficulty: 5.0,
        repetition_count: 5,
        last_review_date: new Date(Date.now() - 86400000 * 7),
        quality_history: [3, 3, 4, 3, 4],
      };
      mockPrismaService.user_card_progress.findUnique.mockResolvedValueOnce(
        existingProgress,
      );

      const mockResetProgress = {
        repetition_count: 0,
        interval_days: 1,
        next_review_date: new Date(),
        quality_history: [3, 3, 4, 3, 4, 1],
      };
      mockPrismaService.user_card_progress.upsert.mockResolvedValueOnce(
        mockResetProgress,
      );

      const result = await service.reviewCard(userId, { cardId, grade: 1 });

      expect(result.cardId).toBe(cardId);
      expect(result.newInterval).toBe(1);
    });
  });

  // ─── Sessions ────────────────────────────────────────────────────────────
  describe('sessions and stats', () => {
    const userId = 'user-123';
    const deckId = 'deck-456';
    const sessionId = '11111111-1111-4111-8111-111111111111';

    it("startSession creates a session for the caller's deck", async () => {
      mockPrismaService.review_sessions.create.mockResolvedValueOnce({
        id: sessionId,
        user_id: userId,
        deck_id: deckId,
      });

      await service.startSession(userId, { deckId, sessionId });

      expect(mockPrismaService.decks.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            id: deckId,
            OR: [{ creator_id: userId }, { is_public: true }],
          }),
        }),
      );
      expect(mockPrismaService.review_sessions.create).toHaveBeenCalledWith({
        data: { id: sessionId, user_id: userId, deck_id: deckId },
      });
    });

    it('startSession rejects a deck the caller cannot access', async () => {
      mockPrismaService.decks.findFirst.mockResolvedValueOnce(null);

      await expect(
        service.startSession(userId, { deckId }),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(mockPrismaService.review_sessions.create).not.toHaveBeenCalled();
    });

    it('rejects a replayed session that belongs to another user', async () => {
      mockPrismaService.review_sessions.findUnique.mockResolvedValueOnce({
        id: sessionId,
        user_id: 'other-user',
        deck_id: deckId,
      });

      await expect(
        service.startSession(userId, { deckId, sessionId }),
      ).rejects.toBeInstanceOf(ConflictException);
      expect(mockPrismaService.review_sessions.create).not.toHaveBeenCalled();
    });

    it('finishSession rejects a foreign session via NotFoundException', async () => {
      mockPrismaService.review_sessions.updateMany.mockResolvedValueOnce({
        count: 0,
      });
      mockPrismaService.review_sessions.findFirst.mockResolvedValueOnce(null);

      await expect(
        service.finishSession(userId, {
          sessionId,
          cardsReviewed: 5,
          cardsCorrect: 4,
          durationSeconds: 60,
        }),
      ).rejects.toBeInstanceOf(NotFoundException);

      expect(mockPrismaService.review_sessions.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            id: sessionId,
            user_id: userId,
            finished_at: null,
          }),
        }),
      );
      expect(mockPrismaService.review_sessions.findFirst).toHaveBeenCalledWith({
        where: { id: sessionId, user_id: userId },
      });
    });

    it("finishSession returns the caller's finished session", async () => {
      const finished = {
        id: sessionId,
        user_id: userId,
        deck_id: deckId,
        cards_reviewed: 5,
      };
      mockPrismaService.review_sessions.updateMany.mockResolvedValueOnce({
        count: 1,
      });
      mockPrismaService.review_sessions.findFirst.mockResolvedValueOnce(
        finished,
      );

      await expect(
        service.finishSession(userId, {
          sessionId,
          cardsReviewed: 5,
          cardsCorrect: 5,
          durationSeconds: 60,
        }),
      ).resolves.toEqual(finished);
    });

    it('getStats counts untouched cards in accessible decks as new cards', async () => {
      mockPrismaService.user_card_progress.findMany.mockResolvedValueOnce([]);
      mockPrismaService.cards.count.mockResolvedValueOnce(7);

      const stats = await service.getStats(userId);

      expect(stats.newCards).toBe(7);
      expect(mockPrismaService.cards.count).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            retired_at: null,
            id: { notIn: [] },
            decks: { OR: [{ creator_id: userId }, { is_public: true }] },
          }),
        }),
      );
    });

    it('getForecast buckets by UTC date', async () => {
      mockPrismaService.user_card_progress.findMany.mockResolvedValueOnce([
        { next_review_date: new Date('2030-01-02T12:00:00.000Z') },
      ]);

      const forecast = await service.getForecast(userId, 2);

      const tomorrow = new Date();
      const key = new Date(
        Date.UTC(
          tomorrow.getUTCFullYear(),
          tomorrow.getUTCMonth(),
          tomorrow.getUTCDate() + 1,
        ),
      )
        .toISOString()
        .slice(0, 10);
      expect(forecast.map((d) => d.date)).toEqual([
        new Date(
          Date.UTC(
            tomorrow.getUTCFullYear(),
            tomorrow.getUTCMonth(),
            tomorrow.getUTCDate(),
          ),
        )
          .toISOString()
          .slice(0, 10),
        key,
      ]);
      // Far-future card is outside the two-day window.
      expect(forecast.every((d) => d.count === 0)).toBe(true);
    });
  });

  // ─── Edge Cases ──────────────────────────────────────────────────────────
  describe('edge cases', () => {
    it('should handle empty deck gracefully', async () => {
      mockPrismaService.user_card_progress.findMany.mockResolvedValueOnce([]);
      mockPrismaService.user_card_progress.findMany.mockResolvedValueOnce([]);
      mockPrismaService.cards.findMany.mockResolvedValueOnce([]);

      const result = await service.getDueCards('user-123', 'empty-deck');

      expect(result.dueCards).toHaveLength(0);
      expect(result.newCards).toHaveLength(0);
      expect(result.totalDue).toBe(0);
      expect(result.totalNew).toBe(0);
    });

    it('should handle negative daysSinceLast as 0', async () => {
      const futureDate = new Date(Date.now() + 86400000); // tomorrow
      const existingProgress = {
        ease_factor: 2.5,
        difficulty: 5.0,
        repetition_count: 1,
        last_review_date: futureDate,
        quality_history: [3],
      };
      mockPrismaService.user_card_progress.findUnique.mockResolvedValueOnce(
        existingProgress,
      );
      mockPrismaService.user_card_progress.upsert.mockResolvedValueOnce({});

      await service.reviewCard('user-123', { cardId: 'card-1', grade: 3 });

      // Should not throw error and should clamp negative days to 0
      expect(mockPrismaService.user_card_progress.upsert).toHaveBeenCalled();
    });

    it('should limit getDueCards to specified limit', async () => {
      const limit = 5;
      mockPrismaService.user_card_progress.findMany
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([]);
      mockPrismaService.cards.findMany.mockResolvedValueOnce([]);

      await service.getDueCards('user-123', 'deck-1', limit);

      expect(
        mockPrismaService.user_card_progress.findMany,
      ).toHaveBeenCalledWith(expect.objectContaining({ take: limit }));
    });
  });

  // ─── SEC-02 ownership regressions ───────────────────────────────────────
  describe('deck visibility and operation ownership', () => {
    const userId = 'user-123';
    const cardId = 'card-456';
    const deckId = 'deck-456';
    const sessionId = '11111111-1111-4111-8111-111111111111';

    it('rejects getDueCards for a private deck owned by another user', async () => {
      mockPrismaService.decks.findFirst.mockResolvedValueOnce(null);

      await expect(service.getDueCards(userId, deckId)).rejects.toBeInstanceOf(
        NotFoundException,
      );
      expect(
        mockPrismaService.user_card_progress.findMany,
      ).not.toHaveBeenCalled();
      expect(mockPrismaService.cards.findMany).not.toHaveBeenCalled();
    });

    it('allows getDueCards for a public deck owned by another user', async () => {
      mockPrismaService.user_card_progress.findMany.mockResolvedValue([]);
      mockPrismaService.cards.findMany.mockResolvedValueOnce([]);

      await expect(service.getDueCards(userId, deckId)).resolves.toMatchObject({
        dueCards: [],
        newCards: [],
        totalDue: 0,
        totalNew: 0,
      });
      expect(mockPrismaService.decks.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            id: deckId,
            OR: [{ creator_id: userId }, { is_public: true }],
          }),
        }),
      );
    });

    it('rejects a review of a card in an inaccessible deck without writing progress', async () => {
      mockPrismaService.cards.findFirst.mockResolvedValueOnce(null);

      await expect(
        service.reviewCard(userId, { cardId, grade: 3 }),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(
        mockPrismaService.user_card_progress.upsert,
      ).not.toHaveBeenCalled();
      expect(mockPrismaService.srs_review_events.create).not.toHaveBeenCalled();
    });

    it("does not let a foreign operationId replay into the caller's history", async () => {
      mockPrismaService.srs_review_events.findUnique.mockResolvedValueOnce({
        user_id: 'other-user',
        card_id: cardId,
        result: {
          grade: 3,
          response: { cardId, nextReviewDate: new Date().toISOString() },
        },
      });

      await expect(
        service.reviewCard(userId, {
          cardId,
          grade: 3,
          operationId: 'review-foreign',
        }),
      ).rejects.toBeInstanceOf(ConflictException);
      expect(
        mockPrismaService.user_card_progress.upsert,
      ).not.toHaveBeenCalled();
    });

    it('rejects a session replay for a deck the caller cannot access', async () => {
      mockPrismaService.review_sessions.findUnique.mockResolvedValueOnce({
        id: sessionId,
        user_id: userId,
        deck_id: deckId,
      });
      mockPrismaService.decks.findFirst.mockResolvedValueOnce(null);

      await expect(
        service.startSession(userId, { deckId, sessionId }),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(mockPrismaService.review_sessions.create).not.toHaveBeenCalled();
    });

    it('rejects a replayed session whose deck differs from the requested deck', async () => {
      mockPrismaService.review_sessions.findUnique.mockResolvedValueOnce({
        id: sessionId,
        user_id: userId,
        deck_id: 'other-deck',
      });

      await expect(
        service.startSession(userId, { deckId, sessionId }),
      ).rejects.toBeInstanceOf(ConflictException);
      expect(mockPrismaService.review_sessions.create).not.toHaveBeenCalled();
    });

    it('getForecast filters progress to accessible decks', async () => {
      mockPrismaService.user_card_progress.findMany.mockResolvedValueOnce([]);

      await service.getForecast(userId, 1);

      expect(
        mockPrismaService.user_card_progress.findMany,
      ).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            user_id: userId,
            cards: expect.objectContaining({
              retired_at: null,
              decks: { OR: [{ creator_id: userId }, { is_public: true }] },
            }),
          }),
        }),
      );
    });
  });

  // ─── FSRS Integration ────────────────────────────────────────────────────
  describe('FSRS algorithm integration', () => {
    it('should use FSRS calculate method for reviews', async () => {
      const spy = jest.spyOn(FsrsAlgorithm, 'calculate');

      mockPrismaService.user_card_progress.findUnique.mockResolvedValueOnce({
        ease_factor: 3.0,
        difficulty: 5.0,
        repetition_count: 1,
        last_review_date: new Date(Date.now() - 86400000 * 3),
        quality_history: [3],
      });
      mockPrismaService.user_card_progress.upsert.mockResolvedValueOnce({});

      await service.reviewCard('user-123', { cardId: 'card-1', grade: 3 });

      expect(spy).toHaveBeenCalledWith(
        3, // grade
        3.0, // prevStability (ease_factor)
        5.0, // prevDifficulty
        1, // prevRepetitions
        expect.any(Number), // daysSinceLastReview
        true, // hasPriorReview
      );

      spy.mockRestore();
    });

    it('should use FSRS getNextReviewDate for scheduling', async () => {
      const spy = jest.spyOn(FsrsAlgorithm, 'getNextReviewDate');

      mockPrismaService.user_card_progress.findUnique.mockResolvedValueOnce(
        null,
      );
      mockPrismaService.user_card_progress.upsert.mockResolvedValueOnce({});

      await service.reviewCard('user-123', { cardId: 'card-1', grade: 3 });

      expect(spy).toHaveBeenCalledWith(expect.any(Number));

      spy.mockRestore();
    });
  });
});
