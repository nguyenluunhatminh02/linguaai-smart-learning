import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { NextRequest } from 'next/server';
import { middleware } from './middleware';
import { verifyJwt } from '@/lib/auth/jwt-verify';

vi.mock('@/lib/auth/jwt-verify', () => ({
  verifyJwt: vi.fn(),
}));

const mockedVerifyJwt = vi.mocked(verifyJwt);

function request(path: string, cookies: Record<string, string> = {}) {
  return new NextRequest(`https://app.example.com${path}`, {
    headers: {
      cookie: Object.entries(cookies)
        .map(([name, value]) => `${name}=${value}`)
        .join('; '),
    },
  });
}

describe('SEC-05 web middleware', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('NEXT_PUBLIC_DISABLE_AUTH', undefined);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('redirects unauthenticated users to login with a callback URL', async () => {
    mockedVerifyJwt.mockResolvedValue(null);
    const response = await middleware(request('/dashboard'));

    expect(response.status).toBe(307);
    expect(response.headers.get('location')).toContain('/login');
    expect(response.headers.get('location')).toContain('callbackUrl=%2Fdashboard');
    expect(response.headers.get('set-cookie')).toBeNull();
  });

  it('rejects non-admins from /admin even with a valid session', async () => {
    mockedVerifyJwt.mockResolvedValue({
      id: '1',
      email: 'user@example.com',
      roles: ['STUDENT'],
      isAdmin: false,
    });
    const response = await middleware(request('/admin', { refreshToken: 'valid.refresh.token' }));

    expect(response.status).toBe(307);
    expect(response.headers.get('location')).toBe('https://app.example.com/');
  });

  it('allows admins into /admin', async () => {
    mockedVerifyJwt.mockResolvedValue({
      id: '1',
      email: 'admin@example.com',
      roles: ['ADMIN'],
      isAdmin: true,
    });
    const response = await middleware(request('/admin/export.csv', { refreshToken: 'valid.refresh.token' }));

    expect(response.status).toBe(200);
  });

  it('lets stale or revoked refresh cookies reach public auth pages', async () => {
    mockedVerifyJwt.mockResolvedValue(null);
    const response = await middleware(
      request('/login', { refreshToken: 'stale.refresh.token' }),
    );

    expect(response.status).toBe(200);
    expect(mockedVerifyJwt).toHaveBeenCalledWith('stale.refresh.token');
    expect(response.headers.get('set-cookie')).toBeNull();
  });

  it('uses exact public-path matching', async () => {
    mockedVerifyJwt.mockResolvedValue(null);
    expect((await middleware(request('/reset-password'))).status).toBe(200);
    expect((await middleware(request('/reset-password/admin'))).status).toBe(307);
    expect((await middleware(request('/login/attack'))).status).toBe(307);
  });

  it('ignores the public auth-disable flag in production', async () => {
    process.env.NEXT_PUBLIC_DISABLE_AUTH = 'true';
    mockedVerifyJwt.mockResolvedValue(null);

    expect((await middleware(request('/dashboard'))).status).toBe(307);
  });

  it('bypasses API and Next.js internal paths without verifying cookies', async () => {
    const response = await middleware(request('/api/auth/refresh'));

    expect(response.status).toBe(200);
    expect(mockedVerifyJwt).not.toHaveBeenCalled();
  });

  it('never trusts an auth_session cookie as a session marker', async () => {
    const response = await middleware(request('/dashboard', { auth_session: 'forged' }));

    expect(response.status).toBe(307);
    expect(mockedVerifyJwt).not.toHaveBeenCalled();
  });
});
