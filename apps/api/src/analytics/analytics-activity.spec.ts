// @ts-nocheck
import { RequestMethod } from '@nestjs/common';
import { GUARDS_METADATA, METHOD_METADATA, PATH_METADATA, ROLES_KEY } from '@nestjs/common/constants';
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
  $transaction: jest.fn((cb: (client: typeof tx) => Promise<unknown>) => cb(tx)),
  user_streaks: tx.user_streaks,
  users: tx.users,
};

const ROUTE_METHODS: Record<number, string> = {
  [RequestMethod.GET]: 'GET',
};

const analyticsRoutes = Object.getOwnPropertyNames(AnalyticsController.prototype)
  .filter((name) => name !== 'constructor')
  .map((name) => ({ name, handler: AnalyticsController.prototype[name] }))
  .filter(({ handler }) =>
    Reflect.hasMetadata(PATH_METADATA, handler) && Reflect.hasMetadata(METHOD_METADATA, handler),
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

  describe('AnalyticsService.recordActivity', () => {
    it('exposes (userId, xp, minutes, timezoneOffsetMinutes = 0) => Promise<void>', async () => {
      tx.user_streaks.findUnique.mockResolvedValue(null);
      const signature: (id: string, xp: number, minutes: number, offset?: number) => Promise<void> =
        service.recordActivity.bind(service);
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
        create: { user_id: USER_ID, date: '2026-11-28', xp_earned: 25, minutes_studied: 12 },
        update: { xp_earned: { increment: 25 }, minutes_studied: { increment: 12 } },
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
      tx.user_streaks.findUnique.mockResolvedValue({ user_id: USER_ID, date: '2026-11-28' });

      await service.recordActivity(USER_ID, 5, 3, 0);

      expect(tx.user_streaks.findUnique).toHaveBeenCalledTimes(1);
      expect(tx.user_streaks.upsert).toHaveBeenCalledWith(expect.objectContaining({
        update: { xp_earned: { increment: 5 }, minutes_studied: { increment: 3 } },
      }));
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
      expect(tx.user_streaks.upsert).toHaveBeenCalledWith(expect.objectContaining({
        create: { user_id: USER_ID, date: '2026-11-28', xp_earned: 7, minutes_studied: 2 },
      }));
    });

    it.each([999, -999, NaN, 1.5])('clamps offset %p to UTC', async (offset) => {
      tx.user_streaks.findUnique.mockResolvedValue(null);

      await service.recordActivity(USER_ID, 1, 1, offset);

      expect(tx.user_streaks.findUnique).toHaveBeenCalledWith({
        where: { user_id_date: { user_id: USER_ID, date: '2026-11-28' } },
      });
      expect(tx.user_streaks.upsert).toHaveBeenCalledWith(expect.objectContaining({
        create: { user_id: USER_ID, date: '2026-11-28', xp_earned: 1, minutes_studied: 1 },
      }));
    });

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

      await expect(service.recordActivity(USER_ID, 10, 5)).rejects.toThrow('db down');
      expect(tx.users.update).not.toHaveBeenCalled();
      expect(tx.user_streaks.upsert).not.toHaveBeenCalled();
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

    it.each(analyticsRoutes)('$label stays authenticated but non-admin and delegates to the service', ({ name, handler }) => {
      const guards = [
        ...(Reflect.getMetadata(GUARDS_METADATA, AnalyticsController) ?? []),
        ...(Reflect.getMetadata(GUARDS_METADATA, handler) ?? []),
      ];
      expect(guards).toContain(JwtAuthGuard);
      expect(Reflect.getMetadata(ROLES_KEY, handler)).toBeUndefined();
      expect(Reflect.getMetadata(ROLES_KEY, AnalyticsController)).toBeUndefined();

      const args: Record<string, unknown[]> = {
        getDashboard: [USER_ID, undefined],
        getLeaderboard: [],
        getRecentSessions: [USER_ID],
      };
      expect(() => handler.call(controller, ...(args[name] ?? []))).not.toThrow();
      expect(serviceMock[name]).toHaveBeenCalled();
      expect(Role.USER).toBe('USER');
    });
  });
});
