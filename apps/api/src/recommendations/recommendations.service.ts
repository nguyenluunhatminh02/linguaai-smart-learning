import { Injectable, Inject } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { Cache } from 'cache-manager';
import { FsrsAlgorithm } from '../srs/fsrs.algorithm';
import { COMMUNICATION_SCENARIOS } from '../learning/communication-scenarios';

const supportedLanguages = ['english', 'chinese', 'japanese'];
const sevenDaysMs = 7 * 24 * 60 * 60 * 1000;

/** ai_feedback is an unconstrained Json? column: only treat `errors` as an
 * array when it actually is one, otherwise flatMap/filter would throw. */
function getWritingErrors(
  feedback: unknown,
): Array<{ type?: string; explanation?: string }> {
  if (
    feedback &&
    typeof feedback === 'object' &&
    !Array.isArray(feedback) &&
    Array.isArray((feedback as { errors?: unknown }).errors)
  ) {
    return (feedback as { errors: unknown[] }).errors.filter(
      (error): error is { type?: string; explanation?: string } =>
        Boolean(error) && typeof error === 'object',
    );
  }
  return [];
}

export interface LearningActivity {
  rank: number;
  type: 'srs_review' | 'reading' | 'writing_practice' | 'quiz' | 'error_exercises' | 'grammar';
  title: string;
  description: string;
  urgency: 'high' | 'medium' | 'low';
  estimatedMinutes: number;
  action: Record<string, unknown>;
}

@Injectable()
export class RecommendationsService {
  constructor(
    private prisma: PrismaService,
    @Inject(CACHE_MANAGER) private cache: Cache,
  ) {}

  async getNextActivity(userId: string, requestedLanguage?: string) {
    const settings = await this.prisma.users.findUnique({
      where: { id: userId },
      select: {
        target_language: true,
        learning_level: true,
        daily_study_minutes: true,
      },
    });
    const language = [requestedLanguage, settings?.target_language].find(
      (value): value is string => typeof value === 'string' && supportedLanguages.includes(value),
    ) ?? 'english';
    const budget = settings?.daily_study_minutes ?? 10;
    const now = new Date();
    const deckFilter = { language, OR: [{ is_public: true }, { creator_id: userId }] };
    const dueFilter = { user_id: userId, next_review_date: { lte: now } };

    const due = await this.prisma.user_card_progress.findFirst({
      where: { ...dueFilter, cards: { decks: deckFilter } },
      orderBy: [{ next_review_date: 'asc' }, { id: 'asc' }],
      select: { cards: { select: { decks: { select: { id: true, title: true } } } } },
    });
    if (due) {
      const deck = due.cards.decks;
      const count = await this.prisma.user_card_progress.count({
        where: { ...dueFilter, cards: { deck_id: deck.id } },
      });
      const sessionSize = Math.min(count, budget * 2, 20);
      if (sessionSize > 0) return {
        type: 'srs_review',
        href: `/flashcards/${deck.id}/study?limit=${sessionSize}`,
        title: deck.title,
        estimatedMinutes: Math.ceil(sessionSize / 2),
        dueCount: sessionSize,
      } as const;
    }

    const scenarios = language === 'english'
      ? COMMUNICATION_SCENARIOS.filter(({ level }) => settings?.learning_level !== 'A2' || level === 'A2')
      : [];
    if (scenarios.length > 0) {
      const completions = await this.prisma.learning_completions.findMany({
        where: { user_id: userId, activity_type: 'scenario', language },
        select: { activity_id: true },
      });
      const completed = new Set(completions.map(({ activity_id }) => activity_id));
      const next = scenarios.find(({ slug }) => !completed.has(slug));
      if (next) return {
        type: 'scenario',
        href: `/learn/${next.slug}`,
        title: next.title,
        objective: next.objective,
        estimatedMinutes: next.estimatedMinutes,
      } as const;
    }

    const quizLanguage = { OR: [{ language }, { language: null, decks: { language } }] };
    const recentAttempt = await this.prisma.quiz_attempts.findFirst({
      where: {
        user_id: userId,
        completed_at: { gte: new Date(now.getTime() - sevenDaysMs) },
        quizzes: quizLanguage,
      },
      select: { id: true },
    });
    if (!recentAttempt) {
      const quiz = await this.prisma.quizzes.findFirst({
        where: {
          AND: [
            quizLanguage,
            { OR: [{ creator_id: userId }, { decks: { is_public: true } }] },
          ],
          quiz_questions: { some: {} },
          time_limit_minutes: { lte: budget },
        },
        orderBy: [{ time_limit_minutes: 'asc' }, { created_at: 'asc' }, { id: 'asc' }],
        select: { id: true, title: true, time_limit_minutes: true },
      });
      if (quiz) return {
        type: 'quiz',
        href: `/quiz/${quiz.id}`,
        title: quiz.title,
        estimatedMinutes: quiz.time_limit_minutes,
      } as const;
    }

    return {
      type: 'library',
      href: language === 'english' ? '/learn' : language === 'chinese' ? '/chinese' : '/japanese',
    } as const;
  }

  /**
   * Generate a personalized learning path for the user.
   * Combines FSRS retention data, writing error history, and reading history
   * to produce a ranked list of actionable learning activities.
   */
  async getLearningPath(userId: string): Promise<{
    userId: string;
    generatedAt: string;
    activities: LearningActivity[];
    summary: string;
  }> {
    const cacheKey = `learning-path:${userId}`;
    try {
      const cached = await this.cache.get<{ userId: string; generatedAt: string; activities: LearningActivity[]; summary: string }>(cacheKey);
      if (cached) return cached;
    } catch {
      // cache-manager store incompatibility – proceed without cache
    }

    const activities: LearningActivity[] = [];
    const now = new Date();

    // ── 1. SRS Due Cards ─────────────────────────────────────────────────────
    // Only load progress rows that are due or actually reviewed: a reviewed
    // card can be at risk before its due date, while never-reviewed cards are
    // neither due yet nor at risk. Also select only the joined deck_id.
    const dueProgress = await this.prisma.user_card_progress.findMany({
      where: {
        user_id: userId,
        OR: [
          { next_review_date: { lte: now } },
          { repetition_count: { gt: 0 }, last_review_date: { not: null } },
        ],
      },
      select: {
        next_review_date: true,
        repetition_count: true,
        last_review_date: true,
        ease_factor: true,
        cards: { select: { deck_id: true } },
      },
    });

    // Group cards by deck. A card that is both due and at risk belongs to the
    // due count only: treating the two flags as additive double-counts cards.
    const deckDueMap = new Map<string, { dueCount: number; atRiskCount: number }>();
    for (const p of dueProgress) {
      if (!p.cards?.deck_id) continue;
      const deckId = p.cards.deck_id;
      if (!deckDueMap.has(deckId)) deckDueMap.set(deckId, { dueCount: 0, atRiskCount: 0 });
      const entry = deckDueMap.get(deckId)!;
      const isDue = p.next_review_date <= now;
      if (isDue) entry.dueCount++;
      // At risk: retrievability < 70% for reviewed cards not already counted as due
      if (!isDue && p.repetition_count > 0 && p.last_review_date) {
        const elapsed = (now.getTime() - p.last_review_date.getTime()) / 86_400_000;
        const R = FsrsAlgorithm.retrievability(elapsed, p.ease_factor);
        if (R < 0.7) entry.atRiskCount++;
      }
    }

    // Fetch deck names
    const deckIds = Array.from(deckDueMap.keys());
    const decks = deckIds.length > 0
      ? await this.prisma.decks.findMany({ where: { id: { in: deckIds } } })
      : [];
    const deckNameMap = new Map(decks.map((d) => [d.id, d.title]));

    let srsRank = 1;
    for (const [deckId, info] of deckDueMap) {
      if (info.dueCount === 0 && info.atRiskCount === 0) continue;
      const deckName = deckNameMap.get(deckId) || 'Unknown Deck';
      const totalConcern = info.dueCount + info.atRiskCount;
      activities.push({
        rank: srsRank++,
        type: 'srs_review',
        title: `Review ${totalConcern} cards in "${deckName}"`,
        description: info.dueCount > 0
          ? `${info.dueCount} cards are due today${info.atRiskCount > 0 ? `, ${info.atRiskCount} more are at risk of being forgotten` : ''}`
          : `${info.atRiskCount} cards are at risk of being forgotten (< 70% retention)`,
        urgency: info.dueCount > 10 ? 'high' : info.dueCount > 3 ? 'medium' : 'low',
        estimatedMinutes: Math.max(5, Math.round(totalConcern * 0.5)),
        action: { deckId, deckName, dueCount: info.dueCount, atRiskCount: info.atRiskCount },
      });
    }

    // ── 2. Writing Error Exercises ───────────────────────────────────────────
    const writingCount = await this.prisma.writing_submissions.count({ where: { user_id: userId } });
    if (writingCount >= 3) {
      const recentWriting = await this.prisma.writing_submissions.findMany({
        where: { user_id: userId },
        orderBy: { created_at: 'desc' },
        take: 10,
      });
      const allErrors = recentWriting.flatMap((w) => getWritingErrors(w.ai_feedback));
      if (allErrors.length > 0) {
        // Count error types
        const errCounts: Record<string, number> = {};
        for (const e of allErrors) errCounts[e.type || 'grammar'] = (errCounts[e.type || 'grammar'] || 0) + 1;
        const topError = Object.entries(errCounts).sort((a, b) => b[1] - a[1])[0];
        const lang = recentWriting[0]?.language || 'english';

        activities.push({
          rank: 0, // will be sorted later
          type: 'error_exercises',
          title: 'Practice your weak areas',
          description: `Based on ${allErrors.length} writing errors — most frequent: ${topError[0]} (${topError[1]}×). Get targeted exercises now.`,
          urgency: allErrors.length > 20 ? 'high' : 'medium',
          estimatedMinutes: 15,
          action: { language: lang, errorCount: allErrors.length, topErrorType: topError[0] },
        });
      }
    }

    // ── 3. Reading (not done today) ──────────────────────────────────────────
    // Use UTC midnight: a process-local "today" boundary misreports activity
    // for users in other time zones. Prisma timestamps are absolute instants.
    const todayStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
    // Check if any reading today
    const recentReading = await this.prisma.reading_passages.findMany({
      where: { generated_by_user_id: userId },
      orderBy: { created_at: 'desc' },
      take: 5,
      select: { topic: true, language: true, level: true, created_at: true },
    });
    const doneToday = recentReading.some((r) => r.created_at >= todayStart);

    if (!doneToday) {
      const recentTopics = new Set(recentReading.map((r) => r.topic?.toLowerCase()));
      const lang = recentReading[0]?.language || 'english';
      const level = recentReading[0]?.level || 'A1';
      // Suggest a fresh topic
      const topicPool = ['technology', 'health', 'environment', 'culture', 'science', 'travel'];
      const freshTopic = topicPool.find((t) => !recentTopics.has(t)) || 'current events';
      activities.push({
        rank: 0,
        type: 'reading',
        title: 'Read a new passage',
        description: `You haven't read anything today. Try a passage about "${freshTopic}" at ${level} level.`,
        urgency: 'medium',
        estimatedMinutes: 10,
        action: { language: lang, level, suggestedTopic: freshTopic },
      });
    }

    // ── 4. Quiz (not done this week) ─────────────────────────────────────────
    const recentQuiz = await this.prisma.quiz_attempts.findFirst({
      where: { user_id: userId, completed_at: { gte: new Date(now.getTime() - sevenDaysMs) } },
      select: { id: true },
    });
    if (!recentQuiz) {
      activities.push({
        rank: 0,
        type: 'quiz',
        title: 'Take a practice quiz',
        description: `No quiz activity this week. Test your knowledge with a short quiz.`,
        urgency: 'low',
        estimatedMinutes: 10,
        action: { suggestion: 'Take any available quiz from your deck collection' },
      });
    }

    // ── 5. Grammar hint from writing error ──────────────────────────────────
    if (writingCount >= 1) {
      const latestWriting = await this.prisma.writing_submissions.findFirst({
        where: { user_id: userId },
        orderBy: { created_at: 'desc' },
      });
      const grammarErrors = getWritingErrors(latestWriting?.ai_feedback).filter(
        (e) => e.type === 'grammar',
      );
      if (grammarErrors.length > 0) {
        activities.push({
          rank: 0,
          type: 'grammar',
          title: 'Review a grammar rule',
          description: `Your last writing had ${grammarErrors.length} grammar error(s). Study the related grammar rule for improvement.`,
          urgency: 'low',
          estimatedMinutes: 8,
          action: {
            language: latestWriting?.language || 'english',
            hint: grammarErrors[0]?.explanation?.substring(0, 100) || 'Review recent grammar points',
          },
        });
      }
    }

    // ── Cold start: no history at all ─────────────────────────────────────────
    if (activities.length === 0) {
      return {
        userId,
        generatedAt: now.toISOString(),
        activities: [{
          rank: 1,
          type: 'reading' as const,
          title: 'Get started with your first passage',
          description: 'Create a flashcard deck, then generate a reading passage to begin learning.',
          urgency: 'medium' as const,
          estimatedMinutes: 5,
          action: { suggestion: 'Add cards to a deck or generate a first reading passage' },
        }],
        summary: 'Welcome! Start with a short activity to build your personalized learning path.',
      };
    }

    // ── Sort & assign final ranks ─────────────────────────────────────────────
    const urgencyWeight = { high: 3, medium: 2, low: 1 };
    activities.sort((a, b) => urgencyWeight[b.urgency] - urgencyWeight[a.urgency]);
    activities.forEach((a, i) => (a.rank = i + 1));

    // ── Summary ───────────────────────────────────────────────────────────────
    const highPriority = activities.filter((a) => a.urgency === 'high').length;
    const totalMinutes = activities.reduce((s, a) => s + a.estimatedMinutes, 0);
    const summary = highPriority > 0
      ? `${highPriority} high-priority task(s) need your attention. Estimated study time: ${totalMinutes} minutes.`
      : `Nice work! You have ${activities.length} recommended activities. Estimated time: ${totalMinutes} minutes.`;

    const result = {
      userId,
      generatedAt: now.toISOString(),
      activities,
      summary,
    };

    try {
      await this.cache.set(cacheKey, result, 1_800_000); // 30 min cache
    } catch {
      // cache-manager store incompatibility – ignore
    }
    return result;
  }

  /** Invalidate learning path cache when user completes an activity */
  async invalidateCache(userId: string): Promise<void> {
    try {
      await this.cache.del(`learning-path:${userId}`);
    } catch {
      // cache-manager store incompatibility – ignore
    }
  }
}
