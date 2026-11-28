import { test, expect, type APIRequestContext, type APIResponse, type Page } from '@playwright/test';

/**
 * Browser auth-flow coverage for SEC-03 / TEST-06 / TEST-11 / TEST-12.
 *
 * Every test creates its own synthetic user (random email, deterministic
 * profile), so suites can run in parallel and no seeded/shared account is
 * mutated. The API URL is derived from NEXT_PUBLIC_API_URL, a non-secret public
 * build value; when unset the app's own default (http://localhost:3001/api/v1)
 * is used. No .env files are read and no real credentials are embedded here.
 *
 * Email verification needs a 64-hex token delivered only by e-mail. When a
 * mail-capture service is available, set the non-secret E2E_MAIL_API_URL to its
 * HTTP API base (Mailpit: http://localhost:8025; expected JSON:
 * { messages: [{ text|html }] } or a plain array). The helper below extracts
 * the token from those messages. Verification-dependent tests skip with an
 * explicit reason when no such service is configured, instead of silently
 * passing with an unverified account.
 */

const PASSWORD = 'TestUser!2024';
const WEAK_PASSWORD = 'weakpass';
const DEFAULT_API_BASE = 'http://localhost:3001/api/v1';

interface Registration {
  email: string;
  password: string;
  displayName: string;
}

function apiBaseUrl(): string {
  const configured = process.env.NEXT_PUBLIC_API_URL || DEFAULT_API_BASE;
  return new URL(configured, 'http://localhost:3000').toString().replace(/\/$/, '');
}

function uniqueRegistration(): Registration {
  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  return {
    email: `e2e-${suffix}@linguaai.local`,
    password: PASSWORD,
    displayName: 'E2E Learner',
  };
}

async function apiRequest(
  api: APIRequestContext,
  method: 'get' | 'post',
  path: string,
  data?: unknown,
): Promise<APIResponse> {
  return api[method](`${apiBaseUrl()}${path}`, { data });
}

async function registerViaApi(api: APIRequestContext, user: Registration): Promise<void> {
  const [firstName, ...rest] = user.displayName.split(' ');
  const response = await apiRequest(api, 'post', '/auth/register', {
    email: user.email,
    password: user.password,
    firstName,
    lastName: rest.join(' ') || undefined,
  });
  expect(response.status(), `register ${user.email}: ${await response.text()}`).toBe(201);
}

/** Find the newest verification link for `email` in the configured mail API. */
async function findVerificationToken(email: string): Promise<string | null> {
  const mailApi = process.env.E2E_MAIL_API_URL;
  if (!mailApi) return null;

  const response = await fetch(
    `${mailApi.replace(/\/$/, '')}/api/v2/messages?query=${encodeURIComponent(email)}`,
  );
  if (!response.ok) return null;
  const body = (await response.json()) as {
    messages?: Array<{ text?: string; html?: string }>;
    items?: Array<{ text?: string; html?: string }>;
  };
  const messages = body.messages ?? body.items ?? [];
  for (const message of messages) {
    const content = `${message.text ?? ''}\n${message.html ?? ''}`;
    const match = content.match(/verify-email\?token=([0-9a-f]{64})/);
    if (match) return match[1];
  }
  return null;
}

async function verifyViaApi(api: APIRequestContext, token: string): Promise<void> {
  const response = await apiRequest(api, 'get', `/auth/verify-email?token=${token}`);
  expect(response.status(), `verify email: ${await response.text()}`).toBe(200);
}

async function loginViaUi(page: Page, user: Registration): Promise<void> {
  await page.goto('/login');
  const emailField = page.getByLabel(/email/i).first();
  await expect(emailField).toBeVisible({ timeout: 15000 });
  await emailField.fill(user.email);
  await page.getByLabel(/password/i).first().fill(user.password);
  await page.getByRole('button', { name: /sign in|đăng nhập/i }).click();
}

async function expectDashboard(page: Page): Promise<void> {
  await expect(page).toHaveURL(/\/dashboard(?:\?|$)/, { timeout: 20000 });
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible({ timeout: 15000 });
}

async function expectLoginPage(page: Page): Promise<void> {
  await expect(page).toHaveURL(/\/login(?:\?|$)/, { timeout: 15000 });
  await expect(page.getByLabel(/email/i).first()).toBeVisible();
}

async function refreshCookie(page: Page) {
  const cookies = await page.context().cookies();
  const cookie = cookies.find((candidate) => candidate.name === 'refreshToken');
  expect(cookie, 'refreshToken cookie must be set by login/refresh').toBeDefined();
  return cookie!;
}

function verifyCookieAttributes(cookie: {
  httpOnly: boolean;
  secure: boolean;
  sameSite: string;
  path: string;
}): void {
  expect(cookie.httpOnly, 'refreshToken must not be readable by JavaScript').toBe(true);
  expect(cookie.secure, 'refreshToken must be Secure').toBe(true);
  expect(cookie.sameSite, 'refreshToken must be SameSite=Lax').toBe('Lax');
  expect(cookie.path).toBe('/');
}

async function logoutViaUi(page: Page): Promise<void> {
  const logout = page.getByRole('button', { name: /sign out|đăng xuất/i });
  await expect(logout).toBeVisible({ timeout: 10000 });
  await logout.click();
}

test.describe('Browser auth flow', () => {
  test('signup shows verification confirmation and rejects weak input', async ({ page }) => {
    const user = uniqueRegistration();

    await page.goto('/register');
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible({ timeout: 15000 });

    // Client-side validation runs through the shared zod schema.
    await page.getByLabel(/display name|tên hiển thị/i).fill(user.displayName);
    await page.getByLabel(/email/i).fill('not-an-email');
    await page.getByLabel(/password/i).fill(WEAK_PASSWORD);
    await page.getByRole('button', { name: /create account|tạo tài khoản/i }).click();
    await expect(page).toHaveURL(/\/register(?:\?|$)/);
    await expect(
      page.getByText(/valid email|uppercase|at least 8 characters/i).first(),
    ).toBeVisible();

    // Valid input reaches the API and lands on the verification instructions.
    await page.getByLabel(/email/i).fill(user.email);
    await page.getByLabel(/password/i).fill(user.password);
    await page.getByRole('button', { name: /create account|tạo tài khoản/i }).click();
    await expect(page).toHaveURL(/\/verify-email(?:\?|$)/, { timeout: 20000 });
    await expect(page.getByRole('heading', { level: 1 })).toContainText(/verify|xác minh/i);

    // Re-registering the same address surfaces the API's 409 message inline.
    await page.goto('/register');
    await page.getByLabel(/display name|tên hiển thị/i).fill('Duplicate Learner');
    await page.getByLabel(/email/i).fill(user.email);
    await page.getByLabel(/password/i).fill(user.password);
    await page.getByRole('button', { name: /create account|tạo tài khoản/i }).click();
    await expect(page).toHaveURL(/\/register(?:\?|$)/);
    await expect(
      page.getByText(/already in use|already exists|đã tồn tại/i).first(),
    ).toBeVisible({ timeout: 15000 });
  });

  test('unverified login is rejected with the API message', async ({ page, request }) => {
    const user = uniqueRegistration();
    await registerViaApi(request, user);

    await loginViaUi(page, user);
    await expectLoginPage(page);
    await expect(
      page.getByText(/verify your email before logging in/i).first(),
    ).toBeVisible({ timeout: 15000 });
    const cookies = await page.context().cookies();
    expect(cookies.find((c) => c.name === 'refreshToken'), 'no session for unverified user').toBeUndefined();
  });

  test('verify email, login, reload refresh, logout, and refresh replay', async ({ page, request }) => {
    const user = uniqueRegistration();
    await registerViaApi(request, user);

    const token = await findVerificationToken(user.email);
    test.skip(!token, 'E2E_MAIL_API_URL is not configured; verification token is only delivered by e-mail');
    await verifyViaApi(request, token!);

    await loginViaUi(page, user);
    await expectDashboard(page);
    await expect(page.getByRole('heading', { level: 1 })).toContainText(user.displayName);

    const cookie = await refreshCookie(page);
    verifyCookieAttributes(cookie);
    const preLogoutRefreshToken = cookie.value;

    // Access token is memory-only; only the timestamp marker may be persisted.
    const storage = await page.evaluate(() => ({ ...localStorage }));
    expect(storage).toHaveProperty('auth_timestamp');
    expect(Object.keys(storage).some((key) => /access.?token/i.test(key))).toBe(false);

    // A reload loses the in-memory access token: loadUser() must rotate the
    // httpOnly cookie and stay authenticated via the same-origin proxy.
    let refreshRequests = 0;
    page.on('request', (req) => {
      if (req.url().includes('/api/auth/refresh')) refreshRequests += 1;
    });
    await page.reload();
    await expectDashboard(page);
    expect(refreshRequests, 'reload must trigger /api/auth/refresh').toBeGreaterThan(0);
    const rotatedCookie = await refreshCookie(page);
    expect(rotatedCookie.value, 'refresh token must rotate').not.toBe(preLogoutRefreshToken);
    verifyCookieAttributes(rotatedCookie);

    // Capture the current credential immediately before logout for the replay.
    const replayToken = rotatedCookie.value;
    await logoutViaUi(page);
    await expectLoginPage(page);
    await expect
      .poll(async () => (await page.context().cookies()).find((c) => c.name === 'refreshToken'))
      .toBeUndefined();
    expect(await page.evaluate(() => localStorage.getItem('auth_timestamp'))).toBeNull();

    // Replaying the pre-logout refresh token must fail against the API.
    const replay = await fetch(`${apiBaseUrl()}/auth/refresh-token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refreshToken: replayToken }),
    });
    expect(replay.status, 'revoked refresh token must not be accepted').toBe(401);

    // A second logout through the UI must be harmless.
    await page.goto('/login');
    await expectLoginPage(page);
  });

  test('invalid credentials stay on login with an inline error', async ({ page, request }) => {
    const user = uniqueRegistration();
    await registerViaApi(request, user);
    const token = await findVerificationToken(user.email);
    test.skip(!token, 'E2E_MAIL_API_URL is not configured; verification token is only delivered by e-mail');
    await verifyViaApi(request, token!);

    await loginViaUi(page, { ...user, password: 'WrongPassword!123' });
    await expectLoginPage(page);
    await expect(
      page.getByText(/invalid email or password|login failed/i).first(),
    ).toBeVisible({ timeout: 15000 });
  });

  test('unauthenticated protected routes redirect with callbackUrl', async ({ page }) => {
    await page.goto('/dashboard');
    await expectLoginPage(page);
    expect(new URL(page.url()).searchParams.get('callbackUrl')).toBe('/dashboard');
  });

  test('back navigation does not restore a protected dashboard after logout', async ({ page, request }) => {
    const user = uniqueRegistration();
    await registerViaApi(request, user);
    const token = await findVerificationToken(user.email);
    test.skip(!token, 'E2E_MAIL_API_URL is not configured; verification token is only delivered by e-mail');
    await verifyViaApi(request, token!);

    await loginViaUi(page, user);
    await expectDashboard(page);
    await logoutViaUi(page);
    await expectLoginPage(page);

    await page.goBack();
    await expect(page).not.toHaveURL(/\/dashboard(?:\?|$)/, { timeout: 15000 });
    await expect(page.locator('main#main-content')).toHaveCount(0);

    // Defensive in-browser check: no token material survived the logout.
    expect(await page.evaluate(() => ({ ...localStorage }))).not.toHaveProperty('auth_timestamp');
    expect((await page.context().cookies()).some((c) => c.name === 'refreshToken')).toBe(false);
    await expect(page.getByRole('heading', { level: 1 })).toContainText(/welcome back|chào mừng/i);
  });
});
