// @ts-nocheck
import {
  ExecutionContext,
  ForbiddenException,
  RequestMethod,
} from '@nestjs/common';
import { GUARDS_METADATA } from '@nestjs/common/constants';
import { Reflector } from '@nestjs/core';

import { AdminController } from './admin.controller';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { PUBLIC_KEY, ROLES_KEY } from '../common/decorators/roles.decorator';
import { Role } from '../users/enums/role.enum';

const ROUTE_METHODS = {
  [RequestMethod.GET]: 'GET',
  [RequestMethod.POST]: 'POST',
  [RequestMethod.DELETE]: 'DELETE',
  [RequestMethod.PATCH]: 'PATCH',
  [RequestMethod.PUT]: 'PUT',
  [RequestMethod.ALL]: 'ALL',
  [RequestMethod.OPTIONS]: 'OPTIONS',
  [RequestMethod.HEAD]: 'HEAD',
  [RequestMethod.SEARCH]: 'SEARCH',
};

type Route = {
  handler: (...args: any[]) => any;
  name: string;
  label: string;
};

const ADMIN_ID = '00000000-0000-4000-8000-000000000001';
const USER_ID = '00000000-0000-4000-8000-000000000002';
// Only used on the positive admin path, to prove the mocked dependencies can
// actually be reached when the guard allows the request through.
const sampleArgs: Record<string, any[]> = {
  grantTokens: [
    USER_ID,
    { amount: 5, reason: 'test' },
    { id: ADMIN_ID },
    { headers: {}, socket: {} },
  ],
  getUserTokenHistory: [USER_ID],
  getOverview: [],
  getUsers: [1, 20],
  updateRole: [
    USER_ID,
    { role: 'USER' },
    { id: ADMIN_ID },
    { headers: {}, socket: {} },
  ],
  deleteUser: [USER_ID, { id: ADMIN_ID }, { headers: {}, socket: {} }],
  getContent: ['reading'],
  createContent: [{ type: 'reading', title: 'Test' }],
  updateContent: [USER_ID, { title: 'Updated' }],
  deleteContent: [USER_ID],
};

// Discover handlers from the controller's own route metadata so a newly added
// admin endpoint cannot silently escape the wrong-role policy tests.
const routes: Route[] = Object.getOwnPropertyNames(AdminController.prototype)
  .filter((name) => name !== 'constructor')
  .map((name) => {
    const handler = AdminController.prototype[name];
    const method = Reflect.getMetadata('method', handler);
    const path = Reflect.getMetadata('path', handler);
    if (method === undefined || path === undefined) return null;
    return {
      handler,
      name,
      label: `${ROUTE_METHODS[method] ?? String(method)} admin/${String(path).replace(/^\//, '')}`,
    };
  })
  .filter((route): route is Route => route !== null);

const makeContext = (
  handler: (...args: any[]) => any,
  roles?: string[],
): ExecutionContext => {
  const request =
    roles === undefined ? {} : { user: { id: 'test-user', roles } };
  return {
    getHandler: () => handler,
    getClass: () => AdminController,
    getRequest: () => request,
    getResponse: () => ({}),
    switchToHttp: () => ({
      getRequest: () => request,
      getResponse: () => ({}),
    }),
  } as any;
};

describe('AdminController authorization policy (SEC-01)', () => {
  const reflector = new Reflector();
  const guard = new RolesGuard(reflector);
  let adminService: any;
  let tokensService: any;
  let prisma: any;
  let controller: AdminController;
  let serviceMocks: jest.Mock[];

  beforeEach(() => {
    adminService = {
      getOverview: jest.fn(),
      getAllUsers: jest.fn(),
      updateUserRole: jest.fn(),
      deleteUser: jest.fn(),
      getContent: jest.fn(),
      createContent: jest.fn(),
      updateContent: jest.fn(),
      deleteContent: jest.fn(),
    };
    tokensService = {
      addTokens: jest.fn(),
      getHistory: jest.fn(),
    };
    prisma = { audit_logs: { create: jest.fn() } };
    controller = new AdminController(adminService, tokensService, prisma);
    serviceMocks = [
      ...Object.values(adminService),
      ...Object.values(tokensService),
      prisma.audit_logs.create,
    ] as jest.Mock[];
  });

  it('discovers every admin route from Nest metadata', () => {
    expect(routes.map((route) => route.label)).toEqual([
      'POST admin/users/:id/tokens',
      'GET admin/users/:id/tokens/history',
      'GET admin/overview',
      'GET admin/users',
      'PATCH admin/users/:id/role',
      'DELETE admin/users/:id',
      'GET admin/content',
      'POST admin/content',
      'PATCH admin/content/:id',
      'DELETE admin/content/:id',
    ]);
  });

  it.each(routes)(
    '$label declares JwtAuthGuard, RolesGuard and @Roles(ADMIN)',
    ({ handler }) => {
      const classRoles = Reflect.getMetadata(ROLES_KEY, AdminController) ?? [];
      const methodRoles = Reflect.getMetadata(ROLES_KEY, handler) ?? [];
      const guards = [
        ...(Reflect.getMetadata(GUARDS_METADATA, AdminController) ?? []),
        ...(Reflect.getMetadata(GUARDS_METADATA, handler) ?? []),
      ];

      expect([...classRoles, ...methodRoles]).toContain(Role.ADMIN);
      expect(guards).toEqual(
        expect.arrayContaining([JwtAuthGuard, RolesGuard]),
      );
      expect(Reflect.getMetadata(PUBLIC_KEY, handler)).toBeUndefined();
      expect(Reflect.getMetadata(PUBLIC_KEY, AdminController)).toBeUndefined();
    },
  );

  it.each(routes)(
    '$label invokes its service only after the guard allows an ADMIN',
    ({ handler, name }) => {
      expect(() =>
        guard.canActivate(makeContext(handler, [Role.ADMIN])),
      ).not.toThrow();
      expect(() => controller[name](...(sampleArgs[name] ?? []))).not.toThrow();
      expect(serviceMocks.some((mock) => mock.mock.calls.length > 0)).toBe(
        true,
      );
    },
  );

  it.each(['USER', 'MODERATOR'] as const)(
    'rejects %s users on every admin route before any service/Prisma work',
    (role) => {
      for (const route of routes) {
        // Guards run before parameter pipes and handlers in Nest's request
        // lifecycle, so even invalid UUID/body values must stop at 403.
        expect(() =>
          guard.canActivate(makeContext(route.handler, [role])),
        ).toThrow(ForbiddenException);
      }
      expect(serviceMocks.every((mock) => mock.mock.calls.length === 0)).toBe(
        true,
      );
    },
  );

  it('rejects requests without an authenticated user on every admin route', () => {
    for (const route of routes) {
      expect(() => guard.canActivate(makeContext(route.handler))).toThrow(
        ForbiddenException,
      );
    }
    expect(serviceMocks.every((mock) => mock.mock.calls.length === 0)).toBe(
      true,
    );
  });
});
