// @ts-nocheck
import { RequestMethod } from '@nestjs/common';
import {
  GUARDS_METADATA,
  METHOD_METADATA,
  PATH_METADATA,
  ROLES_KEY,
} from '@nestjs/common/constants';
import { Test, TestingModule } from '@nestjs/testing';
import 'reflect-metadata';

import { AnalyticsController } from './analytics.controller';
import { AnalyticsService } from './analytics.service';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { PrismaService } from '../prisma/prisma.service';
import { Role } from '../users/enums/role.enum';

const USER_ID = '11111111-1111-4111-8111-111111111111';
const FIXED_NOW = new Date('2026-11-28T12:00:00.000Z');

const tx = {
  user_streaks: { findUnique: jest.fn(), upsert: jest.fn() },
  users: { update: jest.fn() },
};

const prismaMock = {
  $transaction: jest.fn((cb: (client: typeof tx) => Promise<unknown>) =>
    cb(tx),
  ),
  $queryRaw: jest.fn(),
  user_streaks: {
    ...tx.user_streaks,
    findMany: jest.fn(),
    groupBy: jest.fn(),
  },
  users: {
    ...tx.users,
    findUnique: jest.fn(),
    findMany: jest.fn(),
  },
  user_card_progress: { count: jest.fn() },
  decks: { count: jest.fn() },
  review_sessions: { aggregate: jest.fn(), findMany: jest.fn() },
};

const ACTIVITY_ROWS = [
  { date: '2026-11-22', seconds: 60n, reviews: 2n },
  { date: '2026-11-27', seconds: 120n, reviews: 4n },
  { date: '2026-11-28', seconds: 600n, reviews: 12n },
  // Outside the seven-day window: must not leak into weeklyActivity/streak.
  { date: '2026-11-01', seconds: 9999n, reviews: 1n },
];

const WEEKLY_XP_ROWS = [
  { date: '2026-11-22', xp_earned: 10 },
  { date: '2026-11-27', xp_earned: 40 },
  { date: '2026-11-28', xp_earned: 25 },
];

const LEADERBOARD_USERS = [
  {
    id: 'public-1',
    first_name: 'Ada',
    last_name: 'Lovelace',
    avatar_url: '/avatars/ada.png',
    total_xp: 900,
    streak_count: 12,
    profile_public: true,
    is_active: true,
    is_deleted: false,
    show_activity_status: true,
  },
  {
    id: 'hidden-1',
    first_name: 'Grace',
    last_name: 'Hopper',
    avatar_url: '/avatars/grace.png',
    total_xp: 800,
    streak_count: 20,
    profile_public: true,
    is_active: true,
    is_deleted: false,
    show_activity_status: false,
  },
  {
    id: 'visible-1',
    first_name: 'Katherine',
    last_name: 'Johnson',
    avatar_url: '/avatars/katherine.png',
    total_xp: 500,
    streak_count: 8,
    profile_public: true,
    is_active: true,
    is_deleted: false,
    show_activity_status: true,
  },
  {
    id: 'filler-1',
    first_name: '',
    last_name: '',
    avatar_url: null,
    total_xp: 100,
    streak_count: 3,
    profile_public: true,
    is_active: true,
    is_deleted: false,
    show_activity_status: true,
  },
  {
    id: 'private-1',
    first_name: 'Private',
    last_name: 'Learner',
    avatar_url: null,
    total_xp: 9999,
    streak_count: 99,
    profile_public: false,
    is_active: true,
    is_deleted: false,
    show_activity_status: true,
  },
  {
    id: 'inactive-1',
    first_name: 'Inactive',
    last_name: 'Learner',
    avatar_url: null,
    total_xp: 8888,
    streak_count: 88,
    profile_public: true,
    is_active: false,
    is_deleted: false,
    show_activity_status: true,
  },
  {
    id: 'deleted-1',
    first_name: 'Deleted',
    last_name: 'Learner',
    avatar_url: null,
    total_xp: 7777,
    streak_count: 77,
    profile_public: true,
    is_active: true,
    is_deleted: true,
    show_activity_status: true,
  },
];

// Mimic only the Prisma where predicates the service uses so the synthetic
// private/inactive/deleted rows are filtered at the same point as in the DB.
const matchesUserWhere = (
  user: Record<string, any>,
  where: Record<string, any>,
) =>
  Object.entries(where).every(([field, expected]) => {
    if (expected && typeof expected === 'object') {
      if (Array.isArray(expected.in)) {
        return expected.in.includes(user[field]);
      }
      if (Array.isArray(expected.notIn)) {
        return !expected.notIn.includes(user[field]);
      }
    }
    return user[field] === expected;
  });

const mockUsersForWhere = ({
  where,
  take,
}: {
  where: Record<string, any>;
  take?: number;
}) => {
  const users = LEADERBOARD_USERS.filter((user) =>
    matchesUserWhere(user, where),
  ).sort((a, b) => b.total_xp - a.total_xp);
  return Promise.resolve(take === undefined ? users : users.slice(0, take));
};

// The service derives week/month boundaries with local Date getters; derive
// the expected window the same way instead of assuming a CI timezone.
const periodStartDate = (period: 'thisWeek' | 'thisMonth') => {
  const now = new Date(FIXED_NOW);
  if (period === 'thisWeek') {
    const startOfWeek = new Date(now);
    const day = startOfWeek.getDay();
    const diff = startOfWeek.getDate() - day + (day === 0 ? -6 : 1);
    startOfWeek.setDate(diff);
    return startOfWeek.toISOString().slice(0, 10);
  }
  return new Date(now.getFullYear(), now.getMonth(), 1)
    .toISOString()
    .slice(0, 10);
};

const ROUTE_METHODS: Record<number, string> = {
  [RequestMethod.GET]: 'GET',
};

const analyticsRoutes = Object.getOwnPropertyNames(
  AnalyticsController.prototype,
)
  .filter((name) => name !== 'constructor')
  .map((name) => ({ name, handler: AnalyticsController.prototype[name] }))
  .filter(
    ({ handler }) =>
      Reflect.hasMetadata(PATH_METADATA, handler) &&
      Reflect.hasMetadata(METHOD_METADATA, handler),
  )
  .map((route) => ({
    ...route,
    label: `${ROUTE_METHODS[Reflect.getMetadata(METHOD_METADATA, route.handler)] ?? 'GET'} analytics/${String(
      Reflect.getMetadata(PATH_METADATA, route.handler),
    ).replace(/^\//, '')}`,
  }));

/**
 * Learning-activity event contract for XP/streak attribution.
 *
 * The HTTP surface (routes, guards, role policy) is pinned in the peer-owned
 * analytics.controller.spec.ts; this spec only adds a small delegation smoke
 * check and focuses on the write contract every skill completion relies on.
 */
describe('Analytics learning-activity contract', () => {
  let service: AnalyticsService;
  let controller: AnalyticsController;
  let serviceMock: Record<string, jest.Mock>;

  beforeEach(async () => {
    jest.useFakeTimers().setSystemTime(FIXED_NOW);
    jest.clearAllMocks();
    prismaMock.$transaction.mockImplementation((cb) => cb(tx));
    serviceMock = {
      getDashboard: jest.fn().mockResolvedValue({}),
      getLeaderboard: jest.fn().mockResolvedValue([]),
      getRecentSessions: jest.fn().mockResolvedValue([]),
    };
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AnalyticsService,
        AnalyticsController,
        { provide: PrismaService, useValue: prismaMock },
      ],
    }).compile();
    service = module.get(AnalyticsService);
    controller = module.get(AnalyticsController);
    Object.assign(service, serviceMock);
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  // beforeEach replaces the read methods with controller-delegation mocks.
  // Aggregation tests need a real service bound to the Prisma mock instead.
  const realService = () =>
    new AnalyticsService(prismaMock as unknown as PrismaService);

  const mockDashboardReads = () => {
    prismaMock.users.findUnique.mockResolvedValue({
      total_xp: 420,
      daily_goal: 30,
    });
    // All four counts share one mock: discriminate by predicate rather than
    // by call order, since Promise.all starts them concurrently.
    prismaMock.user_card_progress.count.mockImplementation(
      ({ where }: { where: Record<string, any> }) => {
        if (where.user_id !== USER_ID || where.cards?.retired_at !== null) {
          return Promise.resolve(0);
        }
        if (where.repetition_count?.gte === 5) return Promise.resolve(6);
        if (where.next_review_date?.lte instanceof Date) {
          return Promise.resolve(9);
        }
        if (where.last_review_date?.gte instanceof Date) {
          return Promise.resolve(4);
        }
        return Promise.resolve(40);
      },
    );
    prismaMock.decks.count.mockResolvedValue(3);
    prismaMock.review_sessions.aggregate.mockResolvedValue({
      _sum: { cards_reviewed: 128 },
    });
    prismaMock.$queryRaw.mockResolvedValue(ACTIVITY_ROWS);
    prismaMock.user_streaks.findMany.mockResolvedValue(WEEKLY_XP_ROWS);
  };

  describe('AnalyticsService.recordActivity', () => {
    it('exposes (userId, xp, minutes, timezoneOffsetMinutes = 0) => Promise<void>', async () => {
      tx.user_streaks.findUnique.mockResolvedValue(null);
      const signature: (
        id: string,
        xp: number,
        minutes: number,
        offset?: number,
      ) => Promise<void> = service.recordActivity.bind(service);
      expect(signature).toBeDefined();
      const pending = service.recordActivity(USER_ID, 10, 5);
      expect(pending).toBeInstanceOf(Promise);
      await pending;
    });

    it('credits XP and minutes for a first activity and starts the streak at 1', async () => {
      tx.user_streaks.findUnique.mockResolvedValue(null);

      await service.recordActivity(USER_ID, 25, 12, 0);

      expect(tx.user_streaks.findUnique).toHaveBeenCalledWith({
        where: { user_id_date: { user_id: USER_ID, date: '2026-11-28' } },
      });
      expect(tx.user_streaks.upsert).toHaveBeenCalledWith({
        where: { user_id_date: { user_id: USER_ID, date: '2026-11-28' } },
        create: {
          user_id: USER_ID,
          date: '2026-11-28',
          xp_earned: 25,
          minutes_studied: 12,
        },
        update: {
          xp_earned: { increment: 25 },
          minutes_studied: { increment: 12 },
        },
      });
      expect(tx.users.update).toHaveBeenCalledWith({
        where: { id: USER_ID },
        data: { streak_count: 1 },
      });
      expect(tx.users.update).toHaveBeenCalledWith({
        where: { id: USER_ID },
        data: { total_xp: { increment: 25 } },
      });
      expect(prismaMock.$transaction).toHaveBeenCalledTimes(1);
    });

    it('extends an existing streak when yesterday had an activity', async () => {
      tx.user_streaks.findUnique
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce({ user_id: USER_ID, date: '2026-11-27' });

      await service.recordActivity(USER_ID, 10, 4, 0);

      expect(tx.user_streaks.findUnique).toHaveBeenCalledWith({
        where: { user_id_date: { user_id: USER_ID, date: '2026-11-27' } },
      });
      expect(tx.users.update).toHaveBeenCalledWith({
        where: { id: USER_ID },
        data: { streak_count: { increment: 1 } },
      });
      expect(tx.users.update).toHaveBeenCalledWith({
        where: { id: USER_ID },
        data: { total_xp: { increment: 10 } },
      });
    });

    it('accumulates XP and minutes into an already-recorded day without resetting the streak', async () => {
      tx.user_streaks.findUnique.mockResolvedValue({
        user_id: USER_ID,
        date: '2026-11-28',
      });

      await service.recordActivity(USER_ID, 5, 3, 0);

      expect(tx.user_streaks.findUnique).toHaveBeenCalledTimes(1);
      expect(tx.user_streaks.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          update: {
            xp_earned: { increment: 5 },
            minutes_studied: { increment: 3 },
          },
        }),
      );
      expect(tx.users.update).not.toHaveBeenCalledWith({
        where: { id: USER_ID },
        data: { streak_count: 1 },
      });
      expect(tx.users.update).toHaveBeenCalledTimes(1);
      expect(tx.users.update).toHaveBeenCalledWith({
        where: { id: USER_ID },
        data: { total_xp: { increment: 5 } },
      });
    });

    it('uses the client timezone offset to select the local calendar day', async () => {
      jest.setSystemTime(new Date('2026-11-28T02:00:00.000Z'));
      tx.user_streaks.findUnique.mockResolvedValue(null);

      // recordActivity subtracts the header offset from the current instant,
      // so a negative offset shifts the selected day forward.
      await service.recordActivity(USER_ID, 7, 2, -480);

      expect(tx.user_streaks.findUnique).toHaveBeenCalledWith({
        where: { user_id_date: { user_id: USER_ID, date: '2026-11-28' } },
      });
      expect(tx.user_streaks.findUnique).toHaveBeenCalledWith({
        where: { user_id_date: { user_id: USER_ID, date: '2026-11-27' } },
      });
      expect(tx.user_streaks.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          create: {
            user_id: USER_ID,
            date: '2026-11-28',
            xp_earned: 7,
            minutes_studied: 2,
          },
        }),
      );
    });

    it.each([999, -999, NaN, 1.5])(
      'clamps offset %p to UTC',
      async (offset) => {
        tx.user_streaks.findUnique.mockResolvedValue(null);

        await service.recordActivity(USER_ID, 1, 1, offset);

        expect(tx.user_streaks.findUnique).toHaveBeenCalledWith({
          where: { user_id_date: { user_id: USER_ID, date: '2026-11-28' } },
        });
        expect(tx.user_streaks.upsert).toHaveBeenCalledWith(
          expect.objectContaining({
            create: {
              user_id: USER_ID,
              date: '2026-11-28',
              xp_earned: 1,
              minutes_studied: 1,
            },
          }),
        );
      },
    );

    it('accepts the largest valid offset without clamping', async () => {
      jest.setSystemTime(new Date('2026-11-28T02:00:00.000Z'));
      tx.user_streaks.findUnique.mockResolvedValue(null);

      await service.recordActivity(USER_ID, 3, 1, 840);

      expect(tx.user_streaks.findUnique).toHaveBeenCalledWith({
        where: { user_id_date: { user_id: USER_ID, date: '2026-11-27' } },
      });
    });

    it('propagates transaction failures without crediting XP', async () => {
      prismaMock.$transaction.mockRejectedValueOnce(new Error('db down'));

      await expect(service.recordActivity(USER_ID, 10, 5)).rejects.toThrow(
        'db down',
      );
      expect(tx.users.update).not.toHaveBeenCalled();
      expect(tx.user_streaks.upsert).not.toHaveBeenCalled();
    });
  });

  describe('AnalyticsService.getDashboard aggregation', () => {
    it('aggregates XP, cards, decks, reviews and seven daily buckets from synthetic data', async () => {
      mockDashboardReads();

      const result = await realService().getDashboard(USER_ID, 0);

      expect(result).toMatchObject({
        streak: 2,
        totalXp: 420,
        totalCards: 40,
        masteredCards: 6,
        dueCards: 9,
        dailyGoal: 30,
        totalDecks: 3,
        totalReviews: 128,
        todayReviews: 12,
        todayWords: 4,
      });
      expect(result.weeklyActivity).toEqual([
        { date: '2026-11-22', xp: 10, minutes: 1 },
        { date: '2026-11-23', xp: 0, minutes: 0 },
        { date: '2026-11-24', xp: 0, minutes: 0 },
        { date: '2026-11-25', xp: 0, minutes: 0 },
        { date: '2026-11-26', xp: 0, minutes: 0 },
        { date: '2026-11-27', xp: 40, minutes: 2 },
        { date: '2026-11-28', xp: 25, minutes: 10 },
      ]);
      expect(result.weeklyActivity).toHaveLength(7);
      // Stale 9999-second row is outside the window.
      expect(
        result.weeklyActivity.some((day) => day.minutes > 10),
      ).toBe(false);
    });

    it('forwards the timezone offset to the raw SQL query and streak window', async () => {
      jest.setSystemTime(new Date('2026-11-28T02:00:00.000Z'));
      mockDashboardReads();

      await realService().getDashboard(USER_ID, -480);

      const [sql, offset, userId] = prismaMock.$queryRaw.mock.calls[0];
      expect(sql.join('')).toContain('YYYY-MM-DD');
      expect(sql.join('')).toContain('review_sessions');
      expect(sql.join('')).toContain('quiz_attempts');
      expect(sql.join('')).toContain('learning_completions');
      expect(offset).toBe(-480);
      expect(userId).toBe(USER_ID);

      const streakQuery = prismaMock.user_streaks.findMany.mock.calls[0][0];
      expect(streakQuery.where.date).toEqual({
        gte: '2026-11-22',
        lte: '2026-11-28',
      });
      const todayWordsQuery =
        prismaMock.user_card_progress.count.mock.calls.find(
          ([args]: [{ where: Record<string, any> }]) =>
            args.where.last_review_date !== undefined,
        )[0];
      expect(todayWordsQuery.where.last_review_date).toEqual({
        gte: new Date('2026-11-27T16:00:00.000Z'),
        lt: new Date('2026-11-28T16:00:00.000Z'),
      });
    });

    it.each([999, NaN])(
      'falls back to UTC for invalid dashboard offset %p',
      async (offset) => {
        jest.setSystemTime(new Date('2026-11-28T02:00:00.000Z'));
        mockDashboardReads();

        const result = await realService().getDashboard(USER_ID, offset);

        expect(prismaMock.$queryRaw.mock.calls[0][1]).toBe(0);
        const todayWordsQuery =
          prismaMock.user_card_progress.count.mock.calls.find(
            ([args]: [{ where: Record<string, any> }]) =>
              args.where.last_review_date !== undefined,
          )[0];
        expect(todayWordsQuery.where.last_review_date).toEqual({
          gte: new Date('2026-11-28T00:00:00.000Z'),
          lt: new Date('2026-11-29T00:00:00.000Z'),
        });
        expect(result.todayReviews).toBe(12);
      },
    );
  });

  describe('AnalyticsService.getLeaderboard aggregation', () => {
    it('applies the public profile filter and maps empty names to Learner', async () => {
      prismaMock.users.findMany.mockImplementation(mockUsersForWhere);

      const result = await realService().getLeaderboard(4, 'allTime');

      expect(prismaMock.users.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            profile_public: true,
            is_active: true,
            is_deleted: false,
          },
          orderBy: { total_xp: 'desc' },
          take: 4,
        }),
      );
      expect(result.map((entry) => entry.id)).toEqual([
        'public-1',
        'hidden-1',
        'visible-1',
        'filler-1',
      ]);
      expect(result.map((entry) => entry.displayName)).toEqual([
        'Ada Lovelace',
        'Grace Hopper',
        'Katherine Johnson',
        'Learner',
      ]);
      expect(result.map((entry) => entry.totalXp)).toEqual([
        900, 800, 500, 100,
      ]);
      expect(prismaMock.user_streaks.groupBy).not.toHaveBeenCalled();
    });

    it.each(['thisWeek', 'thisMonth'] as const)(
      'ranks %s XP sums, hides private users and fills the limit',
      async (period) => {
        const startDate = periodStartDate(period);
        prismaMock.user_streaks.groupBy.mockResolvedValue([
          { user_id: 'private-1', _sum: { xp_earned: 5000 } },
          { user_id: 'hidden-1', _sum: { xp_earned: 900 } },
          { user_id: 'visible-1', _sum: { xp_earned: 250 } },
          { user_id: 'public-1', _sum: { xp_earned: null } },
          { user_id: 'deleted-1', _sum: { xp_earned: 800 } },
          { user_id: 'filler-1', _sum: { xp_earned: 100 } },
        ]);
        prismaMock.users.findMany.mockImplementation(mockUsersForWhere);

        const result = await realService().getLeaderboard(3, period);

        const groupByQuery = prismaMock.user_streaks.groupBy.mock.calls[0][0];
        expect(groupByQuery.by).toEqual(['user_id']);
        expect(groupByQuery._sum).toEqual({ xp_earned: true });
        expect(groupByQuery.where.date).toEqual({
          gte: startDate,
          lte: '2026-11-28',
        });
        expect(
          result.some((entry) => entry.id === 'private-1'),
        ).toBe(false);
        expect(
          result.some((entry) => entry.id === 'deleted-1'),
        ).toBe(false);
        expect(result.map((entry) => entry.id)).toEqual([
          'hidden-1',
          'public-1',
          'visible-1',
        ]);
        expect(result[0]).toMatchObject({
          displayName: 'Grace Hopper',
          totalXp: 0,
          streakCount: 0,
        });
        // The highest XP sums belong to private/deleted accounts; after
        // filtering they cannot occupy a slot, so all visible entries are
        // fillers with zero XP.
        expect(result).toHaveLength(3);
        expect(result.map((entry) => entry.totalXp)).toEqual([0, 0, 0]);
        expect(prismaMock.users.findMany).toHaveBeenCalledTimes(2);
        expect(prismaMock.users.findMany.mock.calls[0][0].where).toEqual({
          ...{
            profile_public: true,
            is_active: true,
            is_deleted: false,
          },
          id: { in: ['private-1', 'hidden-1', 'deleted-1'] },
        });
        expect(prismaMock.users.findMany.mock.calls[1][0]).toMatchObject({
          where: {
            profile_public: true,
            is_active: true,
            is_deleted: false,
            id: { notIn: ['hidden-1'] },
          },
          take: 2,
        });
      },
    );

    it('fills remaining slots with zero-XP public learners', async () => {
      prismaMock.user_streaks.groupBy.mockResolvedValue([
        { user_id: 'visible-1', _sum: { xp_earned: 250 } },
      ]);
      prismaMock.users.findMany.mockImplementation(mockUsersForWhere);

      const result = await realService().getLeaderboard(3, 'thisWeek');

      expect(result.map((entry) => entry.id)).toEqual([
        'visible-1',
        'public-1',
        'hidden-1',
      ]);
      expect(result.slice(1).map((entry) => entry.totalXp)).toEqual([0, 0]);
      expect(result[2]).toMatchObject({
        displayName: 'Grace Hopper',
        streakCount: 0,
      });
      const fillerQuery = prismaMock.users.findMany.mock.calls[1][0];
      expect(fillerQuery.take).toBe(2);
      expect(fillerQuery.where.id).toEqual({ notIn: ['visible-1'] });
    });
  });

  describe('AnalyticsService.getRecentSessions aggregation', () => {
    it('returns sessions ordered by most recent start time and limited', async () => {
      const sessions = [
        {
          id: 'session-2',
          user_id: USER_ID,
          started_at: new Date('2026-11-28T10:00:00.000Z'),
        },
        {
          id: 'session-1',
          user_id: USER_ID,
          started_at: new Date('2026-11-27T10:00:00.000Z'),
        },
      ];
      prismaMock.review_sessions.findMany.mockResolvedValue(sessions);

      const result = await realService().getRecentSessions(USER_ID, 5);

      expect(prismaMock.review_sessions.findMany).toHaveBeenCalledWith({
        where: { user_id: USER_ID },
        orderBy: { started_at: 'desc' },
        take: 5,
      });
      expect(result).toBe(sessions);
    });
  });

  describe('AnalyticsController learning surface', () => {
    it('exposes exactly three learner-facing GET routes', () => {
      expect(analyticsRoutes.map((route) => route.label)).toEqual([
        'GET analytics/dashboard',
        'GET analytics/leaderboard',
        'GET analytics/sessions',
      ]);
    });

    it.each(analyticsRoutes)(
      '$label stays authenticated but non-admin and delegates to the service',
      ({ name, handler }) => {
        const guards = [
          ...(Reflect.getMetadata(GUARDS_METADATA, AnalyticsController) ?? []),
          ...(Reflect.getMetadata(GUARDS_METADATA, handler) ?? []),
        ];
        expect(guards).toContain(JwtAuthGuard);
        expect(Reflect.getMetadata(ROLES_KEY, handler)).toBeUndefined();
        expect(
          Reflect.getMetadata(ROLES_KEY, AnalyticsController),
        ).toBeUndefined();

        const args: Record<string, unknown[]> = {
          getDashboard: [USER_ID, undefined],
          getLeaderboard: [],
          getRecentSessions: [USER_ID],
        };
        expect(() =>
          handler.call(controller, ...(args[name] ?? [])),
        ).not.toThrow();
        expect(serviceMock[name]).toHaveBeenCalled();
        expect(Role.USER).toBe('USER');
      },
    );
  });
});
