import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

const DAY_MS = 86_400_000;
const MAX_TIMEZONE_OFFSET_MINUTES = 14 * 60;

// Only account for learners who opted into a public profile and whose account
// is still active. Private learners must not appear in a global leaderboard,
// even when they have earned XP/streaks through activity recording.
const publicUserFilter = { profile_public: true, is_active: true, is_deleted: false };

@Injectable()
export class AnalyticsService {
  constructor(private prisma: PrismaService) {}

  async getDashboard(userId: string, timezoneOffsetMinutes = 0) {
    const now = new Date();
    const offset = Number.isInteger(timezoneOffsetMinutes) && Math.abs(timezoneOffsetMinutes) <= MAX_TIMEZONE_OFFSET_MINUTES
      ? timezoneOffsetMinutes
      : 0;
    const localNow = new Date(now.getTime() - offset * 60_000);
    const localDate = (daysAgo: number) => new Date(localNow.getTime() - daysAgo * DAY_MS).toISOString().slice(0, 10);
    const today = localDate(0);
    const utcTodayStart = new Date(Date.parse(`${today}T00:00:00.000Z`) + offset * 60_000);
    const utcTomorrowStart = new Date(utcTodayStart.getTime() + DAY_MS);
    const activeCards = { user_id: userId, cards: { retired_at: null } };
    const [user, totalCards, masteredCards, dueCards, totalDecks, allReviews, todayWords, activity, weeklyXp] = await Promise.all([
      this.prisma.users.findUnique({ where: { id: userId }, select: { total_xp: true, daily_goal: true } }),
      this.prisma.user_card_progress.count({ where: activeCards }),
      this.prisma.user_card_progress.count({ where: { ...activeCards, repetition_count: { gte: 5 } } }),
      this.prisma.user_card_progress.count({ where: { ...activeCards, next_review_date: { lte: now } } }),
      this.prisma.decks.count({ where: { creator_id: userId } }),
      this.prisma.review_sessions.aggregate({
        where: { user_id: userId, finished_at: { not: null } },
        _sum: { cards_reviewed: true },
      }),
      this.prisma.user_card_progress.count({
        where: { ...activeCards, last_review_date: { gte: utcTodayStart, lt: utcTomorrowStart } },
      }),
      this.prisma.$queryRaw<Array<{ date: string; seconds: bigint; reviews: bigint }>>`
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

    const activityByDate = new Map(activity.map((entry) => [entry.date, entry]));
    const xpByDate = new Map(weeklyXp.map((entry) => [entry.date, entry.xp_earned]));
    let streak = 0;
    for (let day = activityByDate.has(today) ? 0 : 1; activityByDate.has(localDate(day)); day++) {
      streak++;
    }
    const weeklyActivity = Array.from({ length: 7 }, (_, index) => {
      const date = localDate(6 - index);
      return { date, xp: xpByDate.get(date) ?? 0, minutes: Math.floor(Number(activityByDate.get(date)?.seconds ?? 0) / 60) };
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

  async recordActivity(userId: string, xp: number, minutes: number, timezoneOffsetMinutes = 0) {
    // This endpoint can be called through several controllers with a client
    // supplied timezone, so clamp it here as well. An out-of-range offset can
    // otherwise produce a nonsense date string (or an Invalid Date) that gets
    // persisted in user_streaks and breaks the leaderboard/dashboard windows.
    const offset = Number.isInteger(timezoneOffsetMinutes) && Math.abs(timezoneOffsetMinutes) <= MAX_TIMEZONE_OFFSET_MINUTES
      ? timezoneOffsetMinutes
      : 0;
    const localNow = new Date(Date.now() - offset * 60_000);
    const today = localNow.toISOString().slice(0, 10);
    const yesterday = new Date(localNow.getTime() - DAY_MS).toISOString().slice(0, 10);

    // All streak/XP mutations happen in one transaction. Two concurrent calls
    // for the same user/day cannot both observe a missing streak row, and a
    // failed transaction must not leave a partially credited activity behind.
    await this.prisma.$transaction(async (tx) => {
      const existing = await tx.user_streaks.findUnique({
        where: { user_id_date: { user_id: userId, date: today } },
      });

      await tx.user_streaks.upsert({
        where: { user_id_date: { user_id: userId, date: today } },
        create: { user_id: userId, date: today, xp_earned: xp, minutes_studied: minutes },
        update: { xp_earned: { increment: xp }, minutes_studied: { increment: minutes } },
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

  async getLeaderboard(limit = 10, period: 'thisWeek' | 'thisMonth' | 'allTime' = 'allTime') {
    if (period === 'allTime') {
      const users = await this.prisma.users.findMany({
        where: publicUserFilter,
        select: { id: true, first_name: true, last_name: true, avatar_url: true, total_xp: true, streak_count: true },
        orderBy: { total_xp: 'desc' },
        take: limit,
      });
      return users.map((u) => ({
        id: u.id,
        displayName: [u.first_name, u.last_name].filter(Boolean).join(' ') || 'Learner',
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
        id: true, first_name: true, last_name: true, avatar_url: true,
        streak_count: true, show_activity_status: true,
      },
    });

    const userInfoMap = new Map(usersInfo.map((u) => [u.id, u]));

    // Delete/slice after resolving public users so private accounts never take
    // a leaderboard slot (and their XP is never exposed via the ranking).
    const visibleStreaks = sortedStreaks.filter((s) => userInfoMap.has(s.userId)).slice(0, limit);
    const result = visibleStreaks.map((s) => {
      const u = userInfoMap.get(s.userId)!;
      return {
        id: s.userId,
        displayName: [u.first_name, u.last_name].filter(Boolean).join(' ') || 'Learner',
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
          id: true, first_name: true, last_name: true, avatar_url: true,
          streak_count: true, show_activity_status: true,
        },
        take: remainingLimit,
      });

      for (const u of otherUsers) {
        result.push({
          id: u.id,
          displayName: [u.first_name, u.last_name].filter(Boolean).join(' ') || 'Learner',
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
}
