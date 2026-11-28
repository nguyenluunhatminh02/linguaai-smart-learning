import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { Prisma } from '../generated/prisma';
import { FsrsAlgorithm, FsrsGrade } from './fsrs.algorithm';
import { ReviewCardDto, StartSessionDto, FinishSessionDto } from './dto/srs.dto';

@Injectable()
export class SrsService {
  constructor(private prisma: PrismaService) {}

  /** Shared read guard: a deck is visible only to its creator or to any user when public. */
  private async assertDeckAccess(userId: string, deckId: string) {
    const deck = await this.prisma.decks.findFirst({
      where: { id: deckId, OR: [{ creator_id: userId }, { is_public: true }] },
      select: { id: true },
    });
    if (!deck) throw new NotFoundException('Deck not found');
    return deck;
  }

  async getDueCards(userId: string, deckId: string, limit = 20) {
    await this.assertDeckAccess(userId, deckId);
    const now = new Date();

    // Due cards in the specified deck
    const dueProgress = await this.prisma.user_card_progress.findMany({
      where: {
        user_id: userId,
        next_review_date: { lte: now },
        cards: { deck_id: deckId, retired_at: null, decks: { OR: [{ creator_id: userId }, { is_public: true }] } },
      },
      include: { cards: true },
      take: limit,
      orderBy: { next_review_date: 'asc' },
    });

    const remaining = limit - dueProgress.length;
    let newCards: any[] = [];
    if (remaining > 0) {
      const learnedCardIds = (
        await this.prisma.user_card_progress.findMany({
          where: { user_id: userId },
          select: { card_id: true },
        })
      ).map((r) => r.card_id);

      newCards = await this.prisma.cards.findMany({
        where: {
          deck_id: deckId,
          retired_at: null,
          id: { notIn: learnedCardIds },
          decks: { OR: [{ creator_id: userId }, { is_public: true }] },
        },
        take: remaining,
      });
    }

    return {
      dueCards: dueProgress.map((p) => ({
        card: p.cards,
        progress: {
          easeFactor: p.ease_factor,
          intervalDays: p.interval_days,
          repetitionCount: p.repetition_count,
        },
      })),
      newCards,
      totalDue: dueProgress.length,
      totalNew: newCards.length,
    };
  }

  /**
   * A replayed operation must not create progress for a card that is no longer
   * visible to the caller (e.g. a private deck was unlisted after the first
   * review). This check runs before the replay response is returned.
   */
  private async assertCardAccess(userId: string, cardId: string) {
    const card = await this.prisma.cards.findFirst({
      where: { id: cardId, retired_at: null, decks: { OR: [{ creator_id: userId }, { is_public: true }] } },
      select: { id: true },
    });
    if (!card) throw new NotFoundException('Card not found');
    return card;
  }

  async reviewCard(userId: string, dto: ReviewCardDto) {
    const replay = async (event: { user_id: string; card_id: string; result: Prisma.JsonValue }) => {
      if (event.user_id !== userId || event.card_id !== dto.cardId) {
        throw new ConflictException('Review operation already exists');
      }
      const saved = event.result as { grade: number; response: Prisma.JsonObject };
      if (saved.grade !== dto.grade) throw new ConflictException('Review operation already exists');
      await this.assertCardAccess(userId, dto.cardId);
      return saved.response;
    };

    try {
      return await this.prisma.$transaction(async (tx) => {
        const lockKey = `srs:${userId}:${dto.cardId}`;
        await tx.$queryRaw`SELECT 1 FROM pg_advisory_xact_lock(hashtextextended(${lockKey}, 0))`;
        if (dto.operationId) {
          const event = await tx.srs_review_events.findUnique({ where: { id: dto.operationId } });
          if (event) return replay(event);
        }

        const card = await tx.cards.findFirst({
          where: { id: dto.cardId, retired_at: null, decks: { OR: [{ creator_id: userId }, { is_public: true }] } },
          select: { id: true },
        });
        if (!card) throw new NotFoundException('Card not found');

        const response = await this.saveReview(tx, userId, dto);
        if (dto.operationId) {
          await tx.srs_review_events.create({
            data: { id: dto.operationId, user_id: userId, card_id: dto.cardId, result: { grade: dto.grade, response } },
          });
        }
        return response;
      });
    } catch (error) {
      if (!dto.operationId || !(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== 'P2002') throw error;
      const event = await this.prisma.srs_review_events.findUnique({ where: { id: dto.operationId } });
      if (!event) throw error;
      return replay(event);
    }
  }

  private async saveReview(tx: Prisma.TransactionClient, userId: string, dto: ReviewCardDto) {
    const existing = await tx.user_card_progress.findUnique({
      where: { user_id_card_id: { user_id: userId, card_id: dto.cardId } },
    });

    const lastReview = existing?.last_review_date;
    const daysSinceLast = lastReview
      ? Math.max(0, (Date.now() - lastReview.getTime()) / 86_400_000)
      : 0;

    const previousStability = existing?.ease_factor ?? 0;
    const result = FsrsAlgorithm.calculate(
      dto.grade as FsrsGrade,
      existing?.ease_factor ?? 0.4,
      existing?.difficulty ?? 5.0,
      existing?.repetition_count ?? 0,
      daysSinceLast,
      Boolean(lastReview || (Array.isArray(existing?.quality_history) && existing.quality_history.length)),
    );

    const history = Array.isArray(existing?.quality_history) ? existing.quality_history : [];
    const qualityHistory = [...history, dto.grade];
    const nextReviewDate = FsrsAlgorithm.getNextReviewDate(result.interval);
    const reviewedAt = new Date();

    const progress = await tx.user_card_progress.upsert({
      where: { user_id_card_id: { user_id: userId, card_id: dto.cardId } },
      create: {
        user_id: userId,
        card_id: dto.cardId,
        ease_factor: result.stability,
        difficulty: result.difficulty,
        interval_days: result.interval,
        repetition_count: result.repetitions,
        next_review_date: nextReviewDate,
        last_review_date: reviewedAt,
        quality_history: qualityHistory,
      },
      update: {
        ease_factor: result.stability,
        difficulty: result.difficulty,
        interval_days: result.interval,
        repetition_count: result.repetitions,
        next_review_date: nextReviewDate,
        last_review_date: reviewedAt,
        quality_history: qualityHistory,
      },
    });

    return {
      cardId: dto.cardId,
      stability: result.stability,
      difficulty: result.difficulty,
      newInterval: result.interval,
      nextReviewDate: (progress.next_review_date ?? nextReviewDate).toISOString(),
      // Retrievability describes the state *before* this review, so use the
      // pre-review stability rather than the newly calculated one.
      retrievability: lastReview
        ? Math.round(
            FsrsAlgorithm.retrievability(daysSinceLast, previousStability) * 100,
          )
        : 100,
    };
  }

  async startSession(userId: string, dto: StartSessionDto) {
    if (dto.sessionId) {
      const existing = await this.prisma.review_sessions.findUnique({ where: { id: dto.sessionId } });
      if (existing) {
        this.confirmSession(existing, userId, dto.deckId);
        // A replay must not bypass the deck visibility check applied to a
        // fresh session, even when the session itself belongs to the caller.
        await this.assertDeckAccess(userId, dto.deckId);
        return existing;
      }
    }
    await this.assertDeckAccess(userId, dto.deckId);
    try {
      return await this.prisma.review_sessions.create({
        data: { id: dto.sessionId, user_id: userId, deck_id: dto.deckId },
      });
    } catch (error) {
      if (!dto.sessionId || !(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== 'P2002') throw error;
      const existing = await this.prisma.review_sessions.findUnique({ where: { id: dto.sessionId } });
      if (!existing) throw error;
      return this.confirmSession(existing, userId, dto.deckId);
    }
  }

  private confirmSession<T extends { user_id: string; deck_id: string }>(session: T, userId: string, deckId: string) {
    if (session.user_id !== userId || session.deck_id !== deckId) {
      throw new ConflictException('Session operation already exists');
    }
    return session;
  }

  async finishSession(userId: string, dto: FinishSessionDto) {
    if (dto.cardsCorrect > dto.cardsReviewed) throw new BadRequestException('Correct cards cannot exceed reviewed cards');
    await this.prisma.review_sessions.updateMany({
      where: { id: dto.sessionId, user_id: userId, finished_at: null },
      data: {
        cards_reviewed: dto.cardsReviewed,
        cards_correct: dto.cardsCorrect,
        duration_seconds: dto.durationSeconds,
        finished_at: new Date(),
      },
    });
    const session = await this.prisma.review_sessions.findFirst({ where: { id: dto.sessionId, user_id: userId } });
    if (!session) throw new NotFoundException('Session not found');
    return session;
  }

  async getStats(userId: string) {
    const allProgress = await this.prisma.user_card_progress.findMany({
      where: {
        user_id: userId,
        cards: {
          retired_at: null,
          decks: { OR: [{ creator_id: userId }, { is_public: true }] },
        },
      },
    });
    const learnedCardIds = allProgress.map((p) => p.card_id);
    const newCards = await this.prisma.cards.count({
      where: {
        retired_at: null,
        decks: { OR: [{ creator_id: userId }, { is_public: true }] },
        id: { notIn: learnedCardIds },
      },
    });
    const now = new Date();

    const dueCards = allProgress.filter((p) => p.next_review_date <= now).length;
    const learnedCards = allProgress.filter(
      (p) => p.repetition_count >= 3 && p.interval_days >= 7,
    ).length;
    const totalCards = allProgress.length;

    const allQualities = allProgress.flatMap((p) => (p.quality_history as number[]) || []);
    const goodReviews = allQualities.filter((q) => q >= 3).length;
    const retentionRate =
      allQualities.length > 0 ? goodReviews / allQualities.length : 0;

    const avgStability =
      totalCards > 0
        ? allProgress.reduce((sum, p) => sum + p.ease_factor, 0) / totalCards
        : 0;
    const avgDifficulty =
      totalCards > 0
        ? allProgress.reduce((sum, p) => sum + (p.difficulty || 5.0), 0) / totalCards
        : 5.0;

    return {
      dueCards,
      newCards,
      learnedCards,
      averageStability: Math.round(avgStability * 100) / 100,
      averageDifficulty: Math.round(avgDifficulty * 100) / 100,
      retentionRate: Math.round(retentionRate * 100) / 100,
      totalReviews: allQualities.length,
      algorithm: 'FSRS-4.5',
    };
  }

  async getForecast(userId: string, days = 30) {
    const allProgress = await this.prisma.user_card_progress.findMany({
      where: {
        user_id: userId,
        cards: {
          retired_at: null,
          // Forecast is derived from the same visible-card policy used by
          // stats/dashboard; private decks of other users are excluded.
          decks: { OR: [{ creator_id: userId }, { is_public: true }] },
        },
      },
    });
    const forecast: { date: string; count: number }[] = [];
    const now = new Date();

    const todayUtc = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
    for (let i = 0; i < days; i++) {
      // Use UTC boundaries throughout: the date key comes from toISOString(),
      // so local-midnight boundaries would label the bucket with the wrong day.
      const dayStart = new Date(todayUtc + i * 86_400_000);
      const dayEnd = new Date(dayStart.getTime() + 86_400_000);

      const count = allProgress.filter(
        (p) => p.next_review_date >= dayStart && p.next_review_date < dayEnd,
      ).length;

      forecast.push({ date: dayStart.toISOString().slice(0, 10), count });
    }

    return forecast;
  }

  async getRetentionDashboard(userId: string) {
    const allProgress = await this.prisma.user_card_progress.findMany({
      where: {
        user_id: userId,
        cards: {
          retired_at: null,
          decks: { OR: [{ creator_id: userId }, { is_public: true }] },
        },
      },
      include: { cards: true },
      orderBy: { next_review_date: 'asc' },
    });
    const now = new Date();

    const deckMap = new Map<
      string,
      {
        deckId: string;
        cards: Array<{
          cardId: string;
          frontText: string;
          backText: string;
          exampleSentence: string | null;
          stability: number;
          difficulty: number;
          intervalDays: number;
          retrievabilityPct: number;
          isAtRisk: boolean;
          nextReviewDate: Date;
          repetitions: number;
          attempts: number;
          correctAttempts: number;
          lastReviewDate: Date | null;
        }>;
      }
    >();

    for (const p of allProgress) {
      const deckId = p.cards?.deck_id || 'unknown';
      if (!deckMap.has(deckId)) deckMap.set(deckId, { deckId, cards: [] });

      const grades = Array.isArray(p.quality_history) ? p.quality_history : [];
      const elapsed = p.last_review_date
        ? Math.max(0, (now.getTime() - p.last_review_date.getTime()) / 86_400_000)
        : 0;
      const R =
        p.last_review_date
          ? FsrsAlgorithm.retrievability(elapsed, p.ease_factor)
          : 1.0;
      const retrievabilityPct = Math.round(R * 100);
      const isAtRisk = grades[grades.length - 1] === 1 || (retrievabilityPct < 70 && Boolean(p.last_review_date));

      deckMap.get(deckId)!.cards.push({
        cardId: p.card_id,
        frontText: p.cards?.front_text || '',
        backText: p.cards?.back_text || '',
        exampleSentence: p.cards?.example_sentence ?? null,
        stability: p.ease_factor,
        difficulty: p.difficulty || 5.0,
        intervalDays: p.interval_days,
        retrievabilityPct,
        isAtRisk,
        nextReviewDate: p.next_review_date,
        repetitions: p.repetition_count,
        attempts: grades.length,
        correctAttempts: grades.filter((grade) => typeof grade === 'number' && grade >= 2).length,
        lastReviewDate: p.last_review_date,
      });
    }

    const decks = Array.from(deckMap.values()).map((d) => {
      const sorted = d.cards.sort((a, b) => Number(b.isAtRisk) - Number(a.isAtRisk) || a.retrievabilityPct - b.retrievabilityPct);
      const avgRetention =
        d.cards.length > 0
          ? Math.round(d.cards.reduce((s, c) => s + c.retrievabilityPct, 0) / d.cards.length)
          : 100;
      return {
        deckId: d.deckId,
        totalCards: d.cards.length,
        atRiskCards: d.cards.filter((c) => c.isAtRisk).length,
        avgRetentionPct: avgRetention,
        worstCards: sorted.slice(0, 10),
      };
    });

    const globalAtRisk = decks.reduce((s, d) => s + d.atRiskCards, 0);
    const globalAvgRetention =
      decks.length > 0
        ? Math.round(decks.reduce((s, d) => s + d.avgRetentionPct, 0) / decks.length)
        : 100;

    return {
      totalTracked: allProgress.length,
      atRiskTotal: globalAtRisk,
      globalAvgRetentionPct: globalAvgRetention,
      decks,
      algorithm: 'FSRS-4.5',
      generatedAt: now.toISOString(),
    };
  }
}
