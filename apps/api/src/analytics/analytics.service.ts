import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

const DAY_MS = 86_400_000;
const MAX_TIMEZONE_OFFSET_MINUTES = 14 * 60;

/**
 * PRODUCT-06 event taxonomy. Only identifiers and coarse metadata may be
 * emitted; raw learner text/audio is never part of an analytics event.
 * `plan_completed` and `error_reported` are intentionally absent until their
 * producers (PRODUCT-04 / PRODUCT-05) exist.
 */
export const LEARNING_EVENT_TYPES = [
  'onboarding_completed',
  'lesson_started',
  'lesson_completed',
  'review_completed',
  'quiz_completed',
  'feedback_received',
] as const;
export type LearningEventType = (typeof LEARNING_EVENT_TYPES)[number];

export interface LearningEvent {
  eventType: LearningEventType;
  userId: string;
  entityType?: string;
  entityId?: string;
  occurredAt?: Date;
  /** Allowlisted metadata: ids, versions, scores, credits. No raw text/audio. */
  payload?: Record<string, string | number | boolean | null>;
}

export interface RatioMetric {
  numerator: number;
  denominator: number;
  /** null when the denominator is zero: never emit NaN/Infinity. */
  value: number | null;
}

export interface ActivationMetrics {
  windowDays: number;
  cohortSize: number;
  activated: number;
  rate: RatioMetric;
  byStep: Record<'onboarding' | 'lesson' | 'review', number>;
  /** Activation requires all three signals, in any order, within the window. */
  definition: string;
}

export interface CompletionMetrics {
  from: Date;
  to: Date;
  lessons: {
    completed: number;
    reviewed: number;
    ratio: RatioMetric;
    averageScore: RatioMetric;
  };
  quizzes: {
    attempted: number;
    passed: number;
    ratio: RatioMetric;
    averageScore: RatioMetric;
  };
  reviews: {
    sessionsFinished: number;
    sessionsStarted: number;
    ratio: RatioMetric;
  };
}

export interface ReturnMetrics {
  windowDays: number;
  cohortSize: number;
  d1: RatioMetric;
  d7: RatioMetric;
  dayBoundary: 'UTC';
}

export interface ReviewMetrics {
  from: Date;
  to: Date;
  sessionsFinished: number;
  cardsReviewed: number;
  cardsCorrect: number;
  accuracy: RatioMetric;
  cardsDue: number;
  activeLearners: number;
  reviewsPerActiveLearner: RatioMetric;
  reviewsPerDay: RatioMetric;
}

export interface CostMetrics {
  from: Date;
  to: Date;
  currency: 'credits';
  chargedCredits: number;
  succeededOperations: number;
  completedLessons: number;
  completedQuizzes: number;
  creditsPerCompletedLesson: RatioMetric;
  creditsPerCompletedQuiz: RatioMetric;
  creditsPerActiveLearner7d: RatioMetric;
  activeLearners7d: number;
  /** Credit-based estimate only. Provider token cost needs AI-03. */
  basis: 'ai_operations.charged_credits';
  pricingVersions: Array<{ version: string; credits: number }>;
}

const PASSING_SCORE_RATIO = 0.6;

function ratio(numerator: number, denominator: number): RatioMetric {
  return {
    numerator,
    denominator,
    value: denominator > 0 ? numerator / denominator : null,
  };
}

function average(total: number, count: number): RatioMetric {
  return ratio(total, count);
}

function finiteNumber(value: unknown): number {
  const parsed = typeof value === 'bigint' ? Number(value) : Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function validEntityId(id: string | undefined): boolean {
  // Allowlisted shape only: ids are opaque UUID/slug values, never user text.
  return typeof id === 'string' && /^[A-Za-z0-9_.:\/-]{1,160}$/.test(id);
}

function sanitizePayload(
  payload: LearningEvent['payload'],
): Record<string, string | number | boolean | null> | undefined {
  if (!payload) return undefined;
  const clean: Record<string, string | number | boolean | null> = {};
  for (const [key, value] of Object.entries(payload)) {
    if (!/^[a-zA-Z][a-zA-Z0-9_]{0,39}$/.test(key)) continue;
    if (typeof value === 'string') {
      if (value.length <= 160 && validEntityId(value)) clean[key] = value;
    } else if (typeof value === 'number' && Number.isFinite(value)) {
      clean[key] = value;
    } else if (typeof value === 'boolean' || value === null) {
      clean[key] = value;
    }
  }
  return Object.keys(clean).length > 0 ? clean : undefined;
}

function dayKey(date: Date): string {
  // All cohort/return windows use UTC calendar-day boundaries.
  return date.toISOString().slice(0, 10);
}

function parseDay(date: string): number {
  return Date.parse(`${date}T00:00:00.000Z`);
}

function clampWindowDays(days: number, fallback: number): number {
  return Number.isInteger(days) && days >= 1 && days <= 365 ? days : fallback;
}

function windowRange(from?: Date, to?: Date): { from: Date; to: Date } {
  const toDate = to instanceof Date && !Number.isNaN(to.getTime())
    ? to
    : new Date();
  const fromDate =
    from instanceof Date && !Number.isNaN(from.getTime())
      ? from
      : new Date(toDate.getTime() - 30 * DAY_MS);
  return fromDate.getTime() < toDate.getTime()
    ? { from: fromDate, to: toDate }
    : { from: new Date(toDate.getTime() - DAY_MS), to: toDate };
}

// Only account for learners who opted into a public profile and whose account
// is still active. Private learners must not appear in a global leaderboard,
// even when they have earned XP/streaks through activity recording.
const publicUserFilter = {
  profile_public: true,
  is_active: true,
  is_deleted: false,
};

@Injectable()
export class AnalyticsService {
  private readonly logger = new Logger(AnalyticsService.name);

  constructor(private prisma: PrismaService) {}

  /**
   * PRODUCT-06 fire-and-forget event hook. `emitEvent` is deliberately a no-op
   * until the append-only `learning_events` table lands (out of scope for this
   * file), so production paths can already call it safely. A dedicated writer
   * can override this method without changing any producer. Failures are
   * swallowed: analytics must never fail a lesson/quiz/review/billing request.
   */
  emitEvent(event: LearningEvent): void {
    if (!LEARNING_EVENT_TYPES.includes(event.eventType)) return;
    if (typeof event.userId !== 'string' || !validEntityId(event.userId)) return;
    if (event.entityId !== undefined && !validEntityId(event.entityId)) return;
    // Validate-only in this slice; no raw text/audio is retained.
    sanitizePayload(event.payload);
  }

  /** Alias used by producers that prefer the verb form. */
  recordEvent(event: LearningEvent): void {
    this.emitEvent(event);
  }

  async getDashboard(userId: string, timezoneOffsetMinutes = 0) {
    const now = new Date();
    const offset =
      Number.isInteger(timezoneOffsetMinutes) &&
      Math.abs(timezoneOffsetMinutes) <= MAX_TIMEZONE_OFFSET_MINUTES
        ? timezoneOffsetMinutes
        : 0;
    const localNow = new Date(now.getTime() - offset * 60_000);
    const localDate = (daysAgo: number) =>
      new Date(localNow.getTime() - daysAgo * DAY_MS)
        .toISOString()
        .slice(0, 10);
    const today = localDate(0);
    const utcTodayStart = new Date(
      Date.parse(`${today}T00:00:00.000Z`) + offset * 60_000,
    );
    const utcTomorrowStart = new Date(utcTodayStart.getTime() + DAY_MS);
    const activeCards = { user_id: userId, cards: { retired_at: null } };
    const [
      user,
      totalCards,
      masteredCards,
      dueCards,
      totalDecks,
      allReviews,
      todayWords,
      activity,
      weeklyXp,
    ] = await Promise.all([
      this.prisma.users.findUnique({
        where: { id: userId },
        select: { total_xp: true, daily_goal: true },
      }),
      this.prisma.user_card_progress.count({ where: activeCards }),
      this.prisma.user_card_progress.count({
        where: { ...activeCards, repetition_count: { gte: 5 } },
      }),
      this.prisma.user_card_progress.count({
        where: { ...activeCards, next_review_date: { lte: now } },
      }),
      this.prisma.decks.count({ where: { creator_id: userId } }),
      this.prisma.review_sessions.aggregate({
        where: { user_id: userId, finished_at: { not: null } },
        _sum: { cards_reviewed: true },
      }),
      this.prisma.user_card_progress.count({
        where: {
          ...activeCards,
          last_review_date: { gte: utcTodayStart, lt: utcTomorrowStart },
        },
      }),
      this.prisma.$queryRaw<
        Array<{ date: string; seconds: bigint; reviews: bigint }>
      >`
        SELECT to_char(completed - (${offset}::int * interval '1 minute'), 'YYYY-MM-DD') AS date,
          SUM(seconds) AS seconds, SUM(reviews) AS reviews
        FROM (
          SELECT finished_at AS completed, duration_seconds AS seconds, cards_reviewed AS reviews
          FROM review_sessions WHERE user_id = ${userId}::uuid AND finished_at IS NOT NULL AND cards_reviewed > 0
          UNION ALL
          SELECT completed_at, duration_seconds, 0
          FROM quiz_attempts WHERE user_id = ${userId}::uuid AND total_questions > 0
          UNION ALL
          SELECT completed_at, duration_seconds, 0
          FROM learning_completions WHERE user_id = ${userId}::uuid
        ) AS activities
        GROUP BY 1
      `,
      this.prisma.user_streaks.findMany({
        where: { user_id: userId, date: { gte: localDate(6), lte: today } },
        select: { date: true, xp_earned: true },
      }),
    ]);

    const activityByDate = new Map(
      activity.map((entry) => [entry.date, entry]),
    );
    const xpByDate = new Map(
      weeklyXp.map((entry) => [entry.date, entry.xp_earned]),
    );
    let streak = 0;
    for (
      let day = activityByDate.has(today) ? 0 : 1;
      activityByDate.has(localDate(day));
      day++
    ) {
      streak++;
    }
    const weeklyActivity = Array.from({ length: 7 }, (_, index) => {
      const date = localDate(6 - index);
      return {
        date,
        xp: xpByDate.get(date) ?? 0,
        minutes: Math.floor(
          Number(activityByDate.get(date)?.seconds ?? 0) / 60,
        ),
      };
    });

    return {
      streak,
      totalXp: user?.total_xp || 0,
      totalCards,
      masteredCards,
      dueCards,
      dailyGoal: user?.daily_goal || 20,
      totalDecks,
      totalReviews: allReviews._sum.cards_reviewed ?? 0,
      weeklyActivity,
      todayReviews: Number(activityByDate.get(today)?.reviews ?? 0),
      todayWords,
    };
  }

  async recordActivity(
    userId: string,
    xp: number,
    minutes: number,
    timezoneOffsetMinutes = 0,
  ) {
    // This endpoint can be called through several controllers with a client
    // supplied timezone, so clamp it here as well. An out-of-range offset can
    // otherwise produce a nonsense date string (or an Invalid Date) that gets
    // persisted in user_streaks and breaks the leaderboard/dashboard windows.
    const offset =
      Number.isInteger(timezoneOffsetMinutes) &&
      Math.abs(timezoneOffsetMinutes) <= MAX_TIMEZONE_OFFSET_MINUTES
        ? timezoneOffsetMinutes
        : 0;
    const localNow = new Date(Date.now() - offset * 60_000);
    const today = localNow.toISOString().slice(0, 10);
    const yesterday = new Date(localNow.getTime() - DAY_MS)
      .toISOString()
      .slice(0, 10);

    // All streak/XP mutations happen in one transaction. Two concurrent calls
    // for the same user/day cannot both observe a missing streak row, and a
    // failed transaction must not leave a partially credited activity behind.
    await this.prisma.$transaction(async (tx) => {
      const existing = await tx.user_streaks.findUnique({
        where: { user_id_date: { user_id: userId, date: today } },
      });

      await tx.user_streaks.upsert({
        where: { user_id_date: { user_id: userId, date: today } },
        create: {
          user_id: userId,
          date: today,
          xp_earned: xp,
          minutes_studied: minutes,
        },
        update: {
          xp_earned: { increment: xp },
          minutes_studied: { increment: minutes },
        },
      });

      if (!existing) {
        const hadYesterday = await tx.user_streaks.findUnique({
          where: { user_id_date: { user_id: userId, date: yesterday } },
        });
        await tx.users.update({
          where: { id: userId },
          data: { streak_count: hadYesterday ? { increment: 1 } : 1 },
        });
      }

      await tx.users.update({
        where: { id: userId },
        data: { total_xp: { increment: xp } },
      });
    });
  }

  async getLeaderboard(
    limit = 10,
    period: 'thisWeek' | 'thisMonth' | 'allTime' = 'allTime',
  ) {
    if (period === 'allTime') {
      const users = await this.prisma.users.findMany({
        where: publicUserFilter,
        select: {
          id: true,
          first_name: true,
          last_name: true,
          avatar_url: true,
          total_xp: true,
          streak_count: true,
        },
        orderBy: { total_xp: 'desc' },
        take: limit,
      });
      return users.map((u) => ({
        id: u.id,
        displayName:
          [u.first_name, u.last_name].filter(Boolean).join(' ') || 'Learner',
        avatarUrl: u.avatar_url,
        totalXp: u.total_xp,
        streakCount: u.streak_count,
      }));
    }

    let startDate = '';
    const now = new Date();
    if (period === 'thisWeek') {
      const startOfWeek = new Date(now);
      const day = startOfWeek.getDay();
      const diff = startOfWeek.getDate() - day + (day === 0 ? -6 : 1);
      startOfWeek.setDate(diff);
      startDate = startOfWeek.toISOString().slice(0, 10);
    } else if (period === 'thisMonth') {
      const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
      startDate = startOfMonth.toISOString().slice(0, 10);
    }
    // Activity dates come from a client timezone header; bound the window at
    // both ends so future-dated rows cannot rank above real activity.
    const endDate = now.toISOString().slice(0, 10);

    const streaks = await this.prisma.user_streaks.groupBy({
      by: ['user_id'],
      _sum: {
        xp_earned: true,
      },
      where: {
        date: { gte: startDate, lte: endDate },
      },
    });

    const sortedStreaks = streaks
      .map((s) => ({
        userId: s.user_id,
        xp: s._sum.xp_earned || 0,
      }))
      .sort((a, b) => b.xp - a.xp)
      .slice(0, limit);

    const rankedUserIds = sortedStreaks.map((s) => s.userId);
    const usersInfo = await this.prisma.users.findMany({
      where: { ...publicUserFilter, id: { in: rankedUserIds } },
      select: {
        id: true,
        first_name: true,
        last_name: true,
        avatar_url: true,
        streak_count: true,
        show_activity_status: true,
      },
    });

    const userInfoMap = new Map(usersInfo.map((u) => [u.id, u]));

    // Delete/slice after resolving public users so private accounts never take
    // a leaderboard slot (and their XP is never exposed via the ranking).
    const visibleStreaks = sortedStreaks
      .filter((s) => userInfoMap.has(s.userId))
      .slice(0, limit);
    const result = visibleStreaks.map((s) => {
      const u = userInfoMap.get(s.userId)!;
      return {
        id: s.userId,
        displayName:
          [u.first_name, u.last_name].filter(Boolean).join(' ') || 'Learner',
        avatarUrl: u.avatar_url,
        // show_activity_status=false keeps participation visible but hides the
        // learner's activity figures from other users.
        totalXp: u.show_activity_status ? s.xp : 0,
        streakCount: u.show_activity_status ? u.streak_count : 0,
      };
    });

    if (result.length < limit) {
      const remainingLimit = limit - result.length;
      const existingUserIds = result.map((r) => r.id);
      const otherUsers = await this.prisma.users.findMany({
        where: { ...publicUserFilter, id: { notIn: existingUserIds } },
        select: {
          id: true,
          first_name: true,
          last_name: true,
          avatar_url: true,
          streak_count: true,
          show_activity_status: true,
        },
        take: remainingLimit,
      });

      for (const u of otherUsers) {
        result.push({
          id: u.id,
          displayName:
            [u.first_name, u.last_name].filter(Boolean).join(' ') || 'Learner',
          avatarUrl: u.avatar_url,
          totalXp: 0,
          streakCount: u.show_activity_status ? u.streak_count : 0,
        });
      }
    }

    return result;
  }

  async getRecentSessions(userId: string, limit = 10) {
    return this.prisma.review_sessions.findMany({
      where: { user_id: userId },
      orderBy: { started_at: 'desc' },
      take: limit,
    });
  }

  // ── PRODUCT-06: product analytics ─────────────────────────────────────────
  // Metrics are derived from existing persisted tables so this slice needs no
  // schema change. Every ratio is null when its denominator is zero. All day
  // boundaries are UTC; no time-spent optimization goal is encoded here.

  /**
   * Activation = onboarding + lesson + review within N days of signup.
   * Today onboarding is proxied by configured learning preferences, lesson by
   * a learning_completions row, and review by a finished review_sessions row.
   * Event-based attribution will replace the proxies when learning_events
   * exists. A learner with no completed lesson is never counted as activated.
   */
  async getActivationMetrics(windowDays = 7): Promise<ActivationMetrics> {
    const days = clampWindowDays(windowDays, 7);
    const now = new Date();
    const [users, onboardingRows, lessonRows, reviewRows] = await Promise.all([
      this.prisma.users.findMany({
        where: { is_deleted: false },
        select: { id: true, created_at: true, learning_level: true },
      }),
      this.prisma.users.findMany({
        where: {
          is_deleted: false,
          learning_level: { not: null },
          daily_study_minutes: { not: null },
        },
        select: { id: true, updated_at: true },
      }),
      this.prisma.learning_completions.findMany({
        select: { user_id: true, completed_at: true },
      }),
      this.prisma.review_sessions.findMany({
        where: { finished_at: { not: null } },
        select: { user_id: true, finished_at: true },
      }),
    ]);

    const onboardingAt = new Map(
      onboardingRows.map((row) => [row.id, row.updated_at.getTime()]),
    );
    const lessonAt = new Map<string, number>();
    for (const row of lessonRows) {
      const at = row.completed_at.getTime();
      if (!Number.isFinite(at)) continue;
      const current = lessonAt.get(row.user_id);
      if (current === undefined || at < current) lessonAt.set(row.user_id, at);
    }
    const reviewAt = new Map<string, number>();
    for (const row of reviewRows) {
      const at = row.finished_at?.getTime();
      if (at === undefined || !Number.isFinite(at)) continue;
      const current = reviewAt.get(row.user_id);
      if (current === undefined || at < current) reviewAt.set(row.user_id, at);
    }

    const windowMs = days * DAY_MS;
    let activated = 0;
    let onboarded = 0;
    let completedLesson = 0;
    let completedReview = 0;
    for (const user of users) {
      const signup = user.created_at.getTime();
      const onboarding = onboardingAt.get(user.id);
      const lesson = lessonAt.get(user.id);
      const review = reviewAt.get(user.id);
      const within = (at: number | undefined): boolean =>
        at !== undefined && at >= signup && at <= signup + windowMs;
      if (within(onboarding)) onboarded++;
      if (within(lesson)) completedLesson++;
      if (within(review)) completedReview++;
      if (within(onboarding) && within(lesson) && within(review)) activated++;
    }

    return {
      windowDays: days,
      cohortSize: users.length,
      activated,
      rate: ratio(activated, users.length),
      byStep: {
        onboarding: onboarded,
        lesson: completedLesson,
        review: completedReview,
      },
      definition: `onboarding_completed AND lesson_completed AND review_completed within ${days} days of signup (UTC)`,
    };
  }

  /** Completion ratios by activity type. `from`/`to` bound the UTC window. */
  async getCompletionMetrics(from?: Date, to?: Date): Promise<CompletionMetrics> {
    const window = windowRange(from, to);
    const [lessons, quizzes, sessionsStarted, sessionsFinished] =
      await Promise.all([
        this.prisma.learning_completions.findMany({
          where: { completed_at: { gte: window.from, lt: window.to } },
          select: { score: true, total: true, duration_seconds: true },
        }),
        this.prisma.quiz_attempts.findMany({
          where: { completed_at: { gte: window.from, lt: window.to } },
          select: { score: true, total_questions: true },
        }),
        this.prisma.review_sessions.count({
          where: { started_at: { gte: window.from, lt: window.to } },
        }),
        this.prisma.review_sessions.count({
          where: { finished_at: { gte: window.from, lt: window.to } },
        }),
      ]);

    let lessonScoreTotal = 0;
    let lessonScoreCount = 0;
    for (const lesson of lessons) {
      if (lesson.score !== null && lesson.total && lesson.total > 0) {
        lessonScoreTotal += lesson.score / lesson.total;
        lessonScoreCount++;
      }
    }
    let quizScoreTotal = 0;
    let quizScoreCount = 0;
    let passed = 0;
    for (const quiz of quizzes) {
      if (quiz.total_questions <= 0) continue;
      const scored = quiz.score / quiz.total_questions;
      quizScoreTotal += scored;
      quizScoreCount++;
      if (scored >= PASSING_SCORE_RATIO) passed++;
    }

    return {
      from: window.from,
      to: window.to,
      lessons: {
        completed: lessons.length,
        reviewed: sessionsFinished,
        ratio: ratio(sessionsFinished, lessons.length),
        averageScore: average(lessonScoreTotal, lessonScoreCount),
      },
      quizzes: {
        attempted: quizzes.length,
        passed,
        ratio: ratio(passed, quizzes.length),
        averageScore: average(quizScoreTotal, quizScoreCount),
      },
      reviews: {
        sessionsFinished,
        sessionsStarted,
        ratio: ratio(sessionsFinished, sessionsStarted),
      },
    };
  }

  /**
   * Voluntary return D1/D7. A "return" is any new learning signal on exactly
   * day N (UTC) after first activity, counted once per learner.
   */
  async getReturnMetrics(days = 7): Promise<ReturnMetrics> {
    const windowDays = clampWindowDays(days, 7);
    const [completions, quizzes, sessions, streaks] = await Promise.all([
      this.prisma.learning_completions.findMany({
        select: { user_id: true, completed_at: true },
      }),
      this.prisma.quiz_attempts.findMany({
        select: { user_id: true, completed_at: true },
      }),
      this.prisma.review_sessions.findMany({
        where: { finished_at: { not: null } },
        select: { user_id: true, finished_at: true },
      }),
      this.prisma.user_streaks.findMany({
        select: { user_id: true, date: true },
      }),
    ]);

    const activityDates = new Map<string, Set<string>>();
    const add = (userId: string, at: Date | null | undefined) => {
      if (!at || !Number.isFinite(at.getTime())) return;
      let dates = activityDates.get(userId);
      if (!dates) {
        dates = new Set();
        activityDates.set(userId, dates);
      }
      dates.add(dayKey(at));
    };
    for (const row of completions) {
      add(row.user_id, row.completed_at);
    }
    for (const row of quizzes) add(row.user_id, row.completed_at);
    for (const row of sessions) add(row.user_id, row.finished_at);
    for (const row of streaks) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(row.date)) continue;
      add(row.user_id, new Date(`${row.date}T00:00:00.000Z`));
    }

    let d1 = 0;
    let d7 = 0;
    for (const dates of activityDates.values()) {
      const sorted = [...dates].sort();
      const first = parseDay(sorted[0]);
      if (!Number.isFinite(first)) continue;
      if (dates.has(dayKey(new Date(first + DAY_MS)))) d1++;
      if (windowDays >= 7 && dates.has(dayKey(new Date(first + 7 * DAY_MS)))) {
        d7++;
      }
    }
    const cohortSize = activityDates.size;
    return {
      windowDays,
      cohortSize,
      d1: ratio(d1, cohortSize),
      d7: ratio(d7, cohortSize),
      dayBoundary: 'UTC',
    };
  }

  /** Review quality and cadence from SRS/session data. */
  async getReviewMetrics(from?: Date, to?: Date): Promise<ReviewMetrics> {
    const window = windowRange(from, to);
    const [sessions, dueCards, activeLearners] = await Promise.all([
      this.prisma.review_sessions.findMany({
        where: { finished_at: { gte: window.from, lt: window.to } },
        select: { cards_reviewed: true, cards_correct: true, user_id: true },
      }),
      this.prisma.user_card_progress.count({
        where: {
          next_review_date: { lte: window.to },
          cards: { retired_at: null },
        },
      }),
      this.prisma.review_sessions.groupBy({
        by: ['user_id'],
        where: { finished_at: { gte: window.from, lt: window.to } },
      }),
    ]);
    const cardsReviewed = sessions.reduce(
      (sum, row) => sum + finiteNumber(row.cards_reviewed),
      0,
    );
    const cardsCorrect = sessions.reduce(
      (sum, row) => sum + finiteNumber(row.cards_correct),
      0,
    );
    const days = Math.max(
      1,
      Math.ceil((window.to.getTime() - window.from.getTime()) / DAY_MS),
    );
    return {
      from: window.from,
      to: window.to,
      sessionsFinished: sessions.length,
      cardsReviewed,
      cardsCorrect,
      accuracy: ratio(cardsCorrect, cardsReviewed),
      cardsDue: dueCards,
      activeLearners: activeLearners.length,
      reviewsPerActiveLearner: ratio(cardsReviewed, activeLearners.length),
      reviewsPerDay: ratio(cardsReviewed, days),
    };
  }

  /**
   * Cost per completed activity, from the durable AI operation ledger.
   * No provider token table exists in this slice, so this is a credit-based
   * estimate grouped by pricing version, not a real currency spend figure.
   */
  async getCostMetrics(from?: Date, to?: Date): Promise<CostMetrics> {
    const window = windowRange(from, to);
    const activeFrom = new Date(window.to.getTime() - 7 * DAY_MS);
    const [operations, lessons, quizzes, activeLearners] = await Promise.all([
      this.prisma.ai_operations.findMany({
        where: {
          status: 'SUCCEEDED',
          OR: [
            { finished_at: { gte: window.from, lt: window.to } },
            { finished_at: null, updated_at: { gte: window.from, lt: window.to } },
          ],
        },
        select: { charged_credits: true, pricing_version: true },
      }),
      this.prisma.learning_completions.count({
        where: { completed_at: { gte: window.from, lt: window.to } },
      }),
      this.prisma.quiz_attempts.count({
        where: { completed_at: { gte: window.from, lt: window.to } },
      }),
      this.prisma.review_sessions.groupBy({
        by: ['user_id'],
        where: { finished_at: { gte: activeFrom, lt: window.to } },
      }),
    ]);

    const byVersion = new Map<string, number>();
    let chargedCredits = 0;
    for (const op of operations) {
      const credits = finiteNumber(op.charged_credits);
      if (credits < 0) continue;
      chargedCredits += credits;
      byVersion.set(
        op.pricing_version,
        (byVersion.get(op.pricing_version) ?? 0) + credits,
      );
    }

    return {
      from: window.from,
      to: window.to,
      currency: 'credits',
      chargedCredits,
      succeededOperations: operations.length,
      completedLessons: lessons,
      completedQuizzes: quizzes,
      creditsPerCompletedLesson: ratio(chargedCredits, lessons),
      creditsPerCompletedQuiz: ratio(chargedCredits, quizzes),
      creditsPerActiveLearner7d: ratio(chargedCredits, activeLearners.length),
      activeLearners7d: activeLearners.length,
      basis: 'ai_operations.charged_credits',
      pricingVersions: [...byVersion.entries()]
        .map(([version, credits]) => ({ version, credits }))
        .sort((a, b) => a.version.localeCompare(b.version)),
    };
  }

  /** Convenience aggregate for an admin dashboard without extra controllers. */
  async getProductMetrics(from?: Date, to?: Date) {
    const [activation, completion, returns, reviews, cost] = await Promise.all([
      this.getActivationMetrics(7),
      this.getCompletionMetrics(from, to),
      this.getReturnMetrics(7),
      this.getReviewMetrics(from, to),
      this.getCostMetrics(from, to),
    ]);
    return { activation, completion, returns, reviews, cost };
  }
}
