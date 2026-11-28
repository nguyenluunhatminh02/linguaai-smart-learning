// @ts-nocheck
import { ExecutionContext, RequestMethod } from '@nestjs/common';
import { GUARDS_METADATA } from '@nestjs/common/constants';
import { Reflector } from '@nestjs/core';

import { AnalyticsController } from './analytics.controller';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { PUBLIC_KEY, ROLES_KEY } from '../common/decorators/roles.decorator';

const ROUTE_METHODS = {
  [RequestMethod.GET]: 'GET',
  [RequestMethod.POST]: 'POST',
  [RequestMethod.PUT]: 'PUT',
  [RequestMethod.PATCH]: 'PATCH',
  [RequestMethod.DELETE]: 'DELETE',
};

const routes = Object.getOwnPropertyNames(AnalyticsController.prototype)
  .filter((name) => name !== 'constructor')
  .map((name) => {
    const handler = AnalyticsController.prototype[name];
    const method = Reflect.getMetadata('method', handler);
    const path = Reflect.getMetadata('path', handler);
    if (method === undefined || path === undefined) return null;
    return {
      handler,
      name,
      label: `${ROUTE_METHODS[method] ?? String(method)} analytics/${String(path).replace(/^\//, '')}`,
    };
  })
  .filter((route) => route !== null);

const makeContext = (handler: (...args: any[]) => any, roles: string[]): ExecutionContext => {
  const request = { user: { id: 'learner-1', roles } };
  return {
    getHandler: () => handler,
    getClass: () => AnalyticsController,
    getRequest: () => request,
    getResponse: () => ({}),
    switchToHttp: () => ({ getRequest: () => request, getResponse: () => ({}) }),
  } as any;
};

/**
 * SEC-01 authorization matrix for analytics.
 *
 * These routes are deliberately learner-facing: dashboard and sessions are
 * scoped to the current user, and leaderboard is a ranking for ordinary users.
 * They are authenticated (JwtAuthGuard) but NOT admin-only. Asserting a 403 for
 * a USER-role caller here would encode the wrong policy and break normal users;
 * this spec pins that decision and detects an accidental RolesGuard/@Roles
 * addition to this controller.
 */
describe('AnalyticsController authorization policy (SEC-01)', () => {
  const reflector = new Reflector();

  it('discovers every analytics route from Nest metadata', () => {
    expect(routes.map((route) => route.label)).toEqual([
      'GET analytics/dashboard',
      'GET analytics/leaderboard',
      'GET analytics/sessions',
    ]);
  });

  it.each(routes)(
    '$label requires authentication and stays open to non-admin learners',
    ({ handler }) => {
      const guards = [
        ...(Reflect.getMetadata(GUARDS_METADATA, AnalyticsController) ?? []),
        ...(Reflect.getMetadata(GUARDS_METADATA, handler) ?? []),
      ];

      expect(guards).toContain(JwtAuthGuard);
      expect(guards).not.toContain(RolesGuard);
      expect(reflector.getAllAndOverride(ROLES_KEY, [handler, AnalyticsController])).toBeUndefined();
      expect(reflector.getAllAndOverride(PUBLIC_KEY, [handler, AnalyticsController])).toBeFalsy();

      // A wrong-role test against an admin-only policy is intentionally absent:
      // USER and MODERATOR are valid callers for these routes. The only
      // unauthenticated case is handled by JwtAuthGuard at the HTTP boundary.
      expect(makeContext(handler, ['USER']).switchToHttp().getRequest().user.roles).toEqual(['USER']);
    },
  );
});
