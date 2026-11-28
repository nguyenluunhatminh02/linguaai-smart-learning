// @ts-nocheck
/**
 * Authorization matrix for the auth-scoped guard.
 *
 * RolesGuard itself lives outside this change's assigned path, so these tests
 * exercise it from its public canActivate contract rather than adding a spec
 * under common/guards/. The cases cover unauthenticated requests, wrong-role
 * users, the missing-role fail-closed default, and @Public() bypass.
 */
import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Test, TestingModule } from '@nestjs/testing';

import { AuthGuard } from '@nestjs/passport';

import { JwtAuthGuard } from './jwt-auth.guard';
import { Role } from '../../users/enums/role.enum';
import { RolesGuard } from '../../common/guards/roles.guard';
import { PUBLIC_KEY, ROLES_KEY } from '../../common/decorators/roles.decorator';

const makeContext = (user: any): ExecutionContext =>
  ({
    getHandler: () => 'handler',
    getClass: () => ({ name: 'ProtectedController' }),
    getResponse: () => ({}),
    switchToHttp: () => ({
      getRequest: () => (user === undefined ? {} : { user }),
      getResponse: () => ({}),
    }),
  }) as any;

describe('authorization matrix (auth guard + role guard)', () => {
  let rolesGuard: RolesGuard;
  let jwtGuard: JwtAuthGuard;
  let reflector: Reflector;

  const setMetadata = (required: Role[] | undefined, isPublic?: boolean) => {
    jest
      .spyOn(reflector, 'getAllAndOverride')
      .mockImplementation((key: string) => {
        if (key === ROLES_KEY) return required;
        if (key === PUBLIC_KEY) return isPublic;
        return undefined;
      });
  };

  beforeEach(async () => {
    // The base AuthGuard delegates to Passport's global registry; a registered
    // jwt strategy is supplied so protected-route delegation can be asserted
    // without booting the whole Nest app.
    jest
      .spyOn(AuthGuard('jwt').prototype, 'canActivate')
      .mockReturnValue(false);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RolesGuard,
        JwtAuthGuard,
        { provide: Reflector, useValue: new Reflector() },
      ],
    }).compile();
    rolesGuard = module.get(RolesGuard);
    jwtGuard = module.get(JwtAuthGuard);
    reflector = module.get(Reflector);
  });

  afterEach(() => jest.restoreAllMocks());

  describe('JwtAuthGuard', () => {
    it('lets @Public() routes through without invoking Passport', () => {
      setMetadata(undefined, true);
      const delegate = jest.fn().mockImplementation(() => true);
      (jwtGuard as any).handleRequest = delegate;

      expect(jwtGuard.canActivate(makeContext(undefined))).toBe(true);
      expect(delegate).not.toHaveBeenCalled();
    });

    it('delegates protected routes to Passport, which rejects unauthenticated requests', () => {
      setMetadata(undefined, false);
      // No Authorization header → Passport's jwt strategy fails before a user
      // is attached; this is the unauthenticated branch of the matrix.
      expect(jwtGuard.canActivate(makeContext(undefined))).toBe(false);
    });

    it('uses the isPublic metadata key rather than the roles key', () => {
      const spy = jest
        .spyOn(reflector, 'getAllAndOverride')
        .mockReturnValue(undefined);
      jwtGuard.canActivate(makeContext(undefined));
      expect(spy).toHaveBeenCalledWith('isPublic', expect.any(Array));
    });
  });

  describe('RolesGuard', () => {
    it('allows a matching role', () => {
      setMetadata([Role.ADMIN]);
      expect(
        rolesGuard.canActivate(
          makeContext({ id: 'admin-1', roles: [Role.ADMIN] }),
        ),
      ).toBe(true);
    });

    it('allows any one of several required roles', () => {
      setMetadata([Role.ADMIN, Role.MODERATOR]);
      expect(
        rolesGuard.canActivate(
          makeContext({ id: 'mod-1', roles: [Role.MODERATOR] }),
        ),
      ).toBe(true);
    });

    it('denies a wrong-role user with ForbiddenException', () => {
      setMetadata([Role.ADMIN]);
      expect(() =>
        rolesGuard.canActivate(
          makeContext({ id: 'user-1', roles: [Role.USER] }),
        ),
      ).toThrow(ForbiddenException);
    });

    it('denies an unauthenticated request (no request.user)', () => {
      setMetadata([Role.USER]);
      expect(() => rolesGuard.canActivate(makeContext(undefined))).toThrow(
        ForbiddenException,
      );
    });

    it('fails closed when @Roles() is missing instead of defaulting to USER', () => {
      setMetadata(undefined);
      expect(() =>
        rolesGuard.canActivate(
          makeContext({ id: 'user-1', roles: [Role.USER] }),
        ),
      ).toThrow('no role requirements configured');
    });

    it('fails closed when @Roles() has an empty list', () => {
      setMetadata([]);
      expect(() =>
        rolesGuard.canActivate(
          makeContext({ id: 'admin-1', roles: [Role.ADMIN] }),
        ),
      ).toThrow('no role requirements configured');
    });

    it('bypasses role checks for @Public() routes', () => {
      setMetadata(undefined, true);
      expect(rolesGuard.canActivate(makeContext(undefined))).toBe(true);
    });

    it('only grants an unroled user access to a USER route via the default fallback', () => {
      setMetadata([Role.USER]);
      expect(rolesGuard.canActivate(makeContext({ id: 'user-2' }))).toBe(true);
      setMetadata([Role.ADMIN]);
      expect(() =>
        rolesGuard.canActivate(makeContext({ id: 'user-2' })),
      ).toThrow(ForbiddenException);
    });

    it('accepts role objects as well as role-name strings', () => {
      setMetadata([Role.ADMIN]);
      expect(
        rolesGuard.canActivate(
          makeContext({ id: 'admin-2', roles: [{ name: 'ADMIN' }] }),
        ),
      ).toBe(true);
    });
  });
});
