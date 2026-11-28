// @ts-nocheck
/**
 * OAuth2Controller Unit Tests (SEC-04)
 *
 * Covers the public surface used by the OAuth2 flow:
 *   - getProviders: returns the allowlist
 *   - createState: issues an HMAC-signed state bound to a cookie
 *   - verifyState (private, exercised via callbacks): rejects tampered,
 *     expired, missing, and replayed states; consumes the cookie
 *   - googleCallback / githubCallback: delegate to AuthService on success
 *   - getConnectedAccounts: returns the user's linked accounts
 *   - disconnectProvider: deletes only the caller's own link
 *
 * The controller reads JWT_SECRET from process.env, so tests set and restore it.
 *
 * AuthService transitively imports bcrypt (native binding unavailable in this
 * environment), so it is mocked at module level before the controller import.
 */

jest.mock('../services/auth.service', () => ({
  AuthService: class {},
}));

import { Test, TestingModule } from '@nestjs/testing';
import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import * as crypto from 'crypto';

import { OAuth2Controller } from './oauth2.controller';
import { AuthService } from '../services/auth.service';
import { PrismaService } from '../../prisma/prisma.service';

const TEST_JWT_SECRET = 'oauth2-test-secret-32-bytes-long!!';
const OAUTH_STATE_TTL_MS = 10 * 60 * 1000;

const signState = (state: string, secret = TEST_JWT_SECRET): string =>
  crypto.createHmac('sha256', secret).update(state).digest('hex');

const buildCookie = (state: string, secret = TEST_JWT_SECRET): string =>
  `${state}.${signState(state, secret)}`;

const makeReq = (overrides: any = {}) =>
  ({
    query: {},
    cookies: {},
    headers: {},
    socket: { remoteAddress: '127.0.0.1' },
    ...overrides,
  }) as any;

const makeRes = () => {
  const res: any = {
    cookie: jest.fn(),
    clearCookie: jest.fn(),
  };
  return res;
};

describe('OAuth2Controller', () => {
  let controller: OAuth2Controller;
  let mockAuthService: any;
  let mockPrisma: any;
  let originalJwtSecret: string | undefined;

  beforeAll(() => {
    originalJwtSecret = process.env.JWT_SECRET;
    process.env.JWT_SECRET = TEST_JWT_SECRET;
  });

  afterAll(() => {
    if (originalJwtSecret === undefined) {
      delete process.env.JWT_SECRET;
    } else {
      process.env.JWT_SECRET = originalJwtSecret;
    }
  });

  beforeEach(async () => {
    mockAuthService = {
      handleOAuthLogin: jest.fn().mockResolvedValue({ accessToken: 'tok' }),
    };
    mockPrisma = {
      oauth_accounts: {
        findMany: jest.fn().mockResolvedValue([]),
        findFirst: jest.fn().mockResolvedValue(null),
        delete: jest.fn().mockResolvedValue({}),
      },
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [OAuth2Controller],
      providers: [
        { provide: AuthService, useValue: mockAuthService },
        { provide: PrismaService, useValue: mockPrisma },
      ],
    }).compile();

    controller = module.get<OAuth2Controller>(OAuth2Controller);
  });

  // ─── getProviders ────────────────────────────────────────────────────────

  describe('getProviders', () => {
    it('returns the allowlisted providers', () => {
      const result = controller.getProviders();
      expect(result.providers).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ name: 'google' }),
          expect.objectContaining({ name: 'github' }),
        ]),
      );
    });
  });

  // ─── createState ─────────────────────────────────────────────────────────

  describe('createState', () => {
    it('returns a state string prefixed with the normalised provider', () => {
      const res = makeRes();
      const result = controller.createState('google', res);
      expect(result.state).toMatch(/^google\.\d+\.[a-f0-9]+$/);
    });

    it('normalises the provider to lower-case', () => {
      const res = makeRes();
      const result = controller.createState('GITHUB', res);
      expect(result.state).toMatch(/^github\./);
    });

    it('rejects an unsupported provider', () => {
      const res = makeRes();
      expect(() => controller.createState('facebook', res)).toThrow(
        BadRequestException,
      );
    });

    it('rejects an empty provider', () => {
      const res = makeRes();
      expect(() => controller.createState('', res)).toThrow(
        BadRequestException,
      );
    });

    it('sets an httpOnly, sameSite=lax cookie with the TTL', () => {
      const res = makeRes();
      controller.createState('google', res);
      expect(res.cookie).toHaveBeenCalledWith(
        'oauth_state',
        expect.any(String),
        expect.objectContaining({
          httpOnly: true,
          sameSite: 'lax',
          maxAge: OAUTH_STATE_TTL_MS,
          path: '/',
        }),
      );
    });

    it('signs the cookie with HMAC-SHA256 of the state', () => {
      const res = makeRes();
      const result = controller.createState('google', res);
      const cookieValue = res.cookie.mock.calls[0][1] as string;
      const separator = cookieValue.lastIndexOf('.');
      const state = cookieValue.slice(0, separator);
      const signature = cookieValue.slice(separator + 1);
      expect(state).toBe(result.state);
      expect(signature).toBe(signState(state));
    });
  });

  // ─── verifyState (via callbacks) ─────────────────────────────────────────

  describe('verifyState (via googleCallback)', () => {
    const issueState = (provider = 'google', ageMs = 0) => {
      const issuedAt = Date.now() - ageMs;
      const state = `${provider}.${issuedAt}.deadbeef`;
      return { state, cookie: buildCookie(state) };
    };

    it('accepts a valid state and delegates to AuthService.handleOAuthLogin', async () => {
      const { state, cookie } = issueState();
      const req = makeReq({
        cookies: { oauth_state: cookie },
        query: { state },
      });
      const res = makeRes();
      (req as any).user = { provider: 'google', sub: 'abc' };

      await controller.googleCallback(req, res, state);

      expect(mockAuthService.handleOAuthLogin).toHaveBeenCalledWith(
        (req as any).user,
        req,
      );
      expect(res.clearCookie).toHaveBeenCalledWith('oauth_state', {
        path: '/',
      });
    });

    it('throws ForbiddenException when state query param is missing', async () => {
      const { cookie } = issueState();
      const req = makeReq({ cookies: { oauth_state: cookie } });
      const res = makeRes();

      await expect(
        controller.googleCallback(req, res, undefined),
      ).rejects.toThrow(ForbiddenException);
    });

    it('throws ForbiddenException when the cookie is missing', async () => {
      const { state } = issueState();
      const req = makeReq({ cookies: {}, query: { state } });
      const res = makeRes();

      await expect(controller.googleCallback(req, res, state)).rejects.toThrow(
        ForbiddenException,
      );
    });

    it('throws ForbiddenException when the signature is tampered', async () => {
      const { state } = issueState();
      const tampered = `${state}.deadbeef0000`;
      const req = makeReq({
        cookies: { oauth_state: tampered },
        query: { state },
      });
      const res = makeRes();

      await expect(controller.googleCallback(req, res, state)).rejects.toThrow(
        ForbiddenException,
      );
    });

    it('throws ForbiddenException when the state was signed with a different secret', async () => {
      const { state } = issueState();
      const cookie = buildCookie(state, 'a-completely-different-secret!!');
      const req = makeReq({
        cookies: { oauth_state: cookie },
        query: { state },
      });
      const res = makeRes();

      await expect(controller.googleCallback(req, res, state)).rejects.toThrow(
        ForbiddenException,
      );
    });

    it('throws ForbiddenException when the state value in the cookie does not match the query', async () => {
      const { state: realState, cookie } = issueState();
      const swappedState = realState.replace('deadbeef', 'feedface');
      const req = makeReq({
        cookies: { oauth_state: cookie },
        query: { state: swappedState },
      });
      const res = makeRes();

      await expect(
        controller.googleCallback(req, res, swappedState),
      ).rejects.toThrow(ForbiddenException);
    });

    it('throws ForbiddenException when the state has expired', async () => {
      const { state, cookie } = issueState('google', OAUTH_STATE_TTL_MS + 1000);
      const req = makeReq({
        cookies: { oauth_state: cookie },
        query: { state },
      });
      const res = makeRes();

      await expect(controller.googleCallback(req, res, state)).rejects.toThrow(
        ForbiddenException,
      );
    });

    it('consumes the cookie so a captured callback URL cannot be replayed', async () => {
      const { state, cookie } = issueState();
      const req = makeReq({
        cookies: { oauth_state: cookie },
        query: { state },
      });
      const res = makeRes();
      (req as any).user = {};

      await controller.googleCallback(req, res, state);
      expect(res.clearCookie).toHaveBeenCalledWith('oauth_state', {
        path: '/',
      });
    });

    it('throws when the cookie has no signature separator', async () => {
      const { state } = issueState();
      const req = makeReq({
        cookies: { oauth_state: 'noseparator' },
        query: { state },
      });
      const res = makeRes();

      await expect(controller.googleCallback(req, res, state)).rejects.toThrow(
        ForbiddenException,
      );
    });
  });

  // ─── getConnectedAccounts ────────────────────────────────────────────────

  describe('getConnectedAccounts', () => {
    it('returns the accounts for the authenticated user', async () => {
      const accounts = [
        {
          id: '1',
          provider: 'GOOGLE',
          email: 'a@b.com',
          name: null,
          image_url: null,
        },
      ];
      mockPrisma.oauth_accounts.findMany.mockResolvedValue(accounts);

      const result = await controller.getConnectedAccounts('user-1');

      expect(result.accounts).toEqual(accounts);
      expect(mockPrisma.oauth_accounts.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { user_id: 'user-1' } }),
      );
    });
  });

  // ─── disconnectProvider ──────────────────────────────────────────────────

  describe('disconnectProvider', () => {
    it('rejects an unsupported provider', async () => {
      await expect(
        controller.disconnectProvider('user-1', 'facebook'),
      ).rejects.toThrow(BadRequestException);
    });

    it('rejects when the provider is not linked to the caller', async () => {
      mockPrisma.oauth_accounts.findFirst.mockResolvedValue(null);
      await expect(
        controller.disconnectProvider('user-1', 'google'),
      ).rejects.toThrow(NotFoundException);
    });

    it('deletes only the row belonging to the caller', async () => {
      mockPrisma.oauth_accounts.findFirst.mockResolvedValue({ id: 'row-7' });

      const result = await controller.disconnectProvider('user-1', 'google');

      expect(mockPrisma.oauth_accounts.findFirst).toHaveBeenCalledWith({
        where: { user_id: 'user-1', provider: 'GOOGLE' },
        select: { id: true },
      });
      expect(mockPrisma.oauth_accounts.delete).toHaveBeenCalledWith({
        where: { id: 'row-7' },
      });
      expect(result.message).toMatch(/google disconnected/);
    });

    it('normalises the provider parameter to upper case', async () => {
      mockPrisma.oauth_accounts.findFirst.mockResolvedValue({ id: 'row-1' });
      await controller.disconnectProvider('user-1', 'GitHub');
      expect(mockPrisma.oauth_accounts.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ provider: 'GITHUB' }),
        }),
      );
    });
  });
});
