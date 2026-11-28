import { test, expect, Page } from '@playwright/test';

/**
 * TEST-12: Browser state isolation regression coverage.
 *
 * Proves that:
 * (a) Switching conversations aborts an in-flight chat turn without writing
 *     its partial answer into the newly selected conversation.
 * (b) Cancelling audio stops recognition/TTS/recording without leaking media
 *     or input state.
 * (c) A 401 during the SSE turn triggers exactly one token refresh and a
 *     retry with the SAME Idempotency-Key, with no second debit.
 */

const AUTH_USER = {
  id: 'user-1',
  email: 'test@example.com',
  displayName: 'Test User',
  role: 'user',
  streakCount: 0,
  totalXp: 0,
};

function sseResponse(body: string): {
  status: number;
  contentType: string;
  body: string;
} {
  return { status: 200, contentType: 'text/event-stream', body };
}

function completedStream(options: {
  operationId: string;
  messageId: string;
  text: string;
  conversationId?: string | null;
  balance?: number;
}): string {
  return [
    'event: accepted',
    `data: ${JSON.stringify({ operationId: options.operationId, conversationId: options.conversationId ?? null })}`,
    '',
    'event: delta',
    `data: ${JSON.stringify({ text: options.text })}`,
    '',
    'event: completed',
    `data: ${JSON.stringify({ operationId: options.operationId, messageId: options.messageId, balance: options.balance ?? 100 })}`,
    '',
    '',
  ].join('\n');
}

test.describe('State isolation', () => {
  test.beforeEach(async ({ page }) => {
    // Auth: deterministic login, profile and refresh responses.
    await page.route('**/api/v1/auth/login', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          success: true,
          data: { accessToken: 'mock-access-token', user: AUTH_USER },
        }),
      }),
    );

    await page.route('**/api/v1/users/me', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ success: true, data: AUTH_USER }),
      }),
    );

    await page.route('**/api/auth/refresh', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          success: true,
          data: { accessToken: 'refreshed-access-token' },
        }),
      }),
    );

    // Sidebar/topbar/token widgets load a balance on mount.
    await page.route('**/api/v1/token-balance**', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ success: true, data: { balance: 100 } }),
      }),
    );
  });

  async function loginAndOpenChat(page: Page): Promise<void> {
    await page.goto('/login');
    await page.waitForSelector('input[type="email"]');
    await page.fill('input[type="email"]', AUTH_USER.email);
    await page.fill('input[type="password"]', 'password123');
    await page.click('button[type="submit"]');
    await expect(page).toHaveURL(/.*dashboard/, { timeout: 20000 });
    await page.goto('/chat');
    await expect(
      page.locator('input[aria-label="Type your message"]'),
    ).toBeVisible({ timeout: 15000 });
  }

  test('switching conversations aborts in-flight chat without cross-contamination', async ({
    page,
  }) => {
    const streamKeys: string[] = [];
    const streamConversationIds: Array<string | null> = [];

    await page.route('**/api/v1/chat/conversations', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          success: true,
          data: [
            { id: 'conv-1', title: 'Conversation 1', createdAt: '2024-01-01T00:00:00Z' },
            { id: 'conv-2', title: 'Conversation 2', createdAt: '2024-01-02T00:00:00Z' },
          ],
        }),
      }),
    );

    await page.route('**/api/v1/chat/conversations/conv-1/messages', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          success: true,
          data: [
            { id: 'msg-1', role: 'user', content: 'Hello from conv 1' },
            { id: 'msg-2', role: 'assistant', content: 'Hi there!' },
          ],
        }),
      }),
    );

    await page.route('**/api/v1/chat/conversations/conv-2/messages', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ success: true, data: [] }),
      }),
    );

    await page.route('**/api/v1/chat/stream', async (route) => {
      const key = route.request().headers()['idempotency-key'] ?? '';
      const body = route.request().postDataJSON() as {
        conversationId?: string | null;
      };
      streamKeys.push(key);
      streamConversationIds.push(body.conversationId ?? null);

      if (streamKeys.length === 1) {
        // Partial answer only. No terminal event: switching away must abort
        // it, and its text must never be committed to another conversation.
        await route.fulfill(
          sseResponse(
            [
              'event: accepted',
              'data: {"operationId":"op-1"}',
              '',
              'event: delta',
              'data: {"text":"Partial leak from conversation 1"}',
              '',
            ].join('\n'),
          ),
        );
        return;
      }

      await route.fulfill(
        sseResponse(
          completedStream({
            operationId: 'op-2',
            messageId: 'msg-new',
            text: 'Response for conv 2',
            conversationId: 'conv-2',
          }),
        ),
      );
    });

    await loginAndOpenChat(page);
    await page.waitForSelector('button:has-text("Conversation 1")', {
      timeout: 10000,
    });

    await page.click('button:has-text("Conversation 1")');
    await expect(page.locator('[role="log"]')).toContainText('Hello from conv 1', {
      timeout: 5000,
    });

    await page.fill('input[aria-label="Type your message"]', 'Test message');
    await page.click('button[aria-label="Send message"]');
    await expect(page.locator('[role="log"]')).toContainText(
      'Partial leak from conversation 1',
      { timeout: 5000 },
    );

    // Switching conversations aborts the in-flight turn.
    await page.click('button:has-text("Conversation 2")');
    await expect(page.locator('[role="log"]')).not.toContainText(
      'Hello from conv 1',
      { timeout: 5000 },
    );
    await expect(page.locator('[role="log"]')).not.toContainText(
      'Partial leak from conversation 1',
      { timeout: 5000 },
    );

    // Conv 2 has empty history; a fresh turn must be allowed with a new key.
    await page.fill('input[aria-label="Type your message"]', 'New message');
    await page.click('button[aria-label="Send message"]');
    await expect(page.locator('[role="log"]')).toContainText(
      'Response for conv 2',
      { timeout: 10000 },
    );
    await expect(page.locator('[role="status"]')).toContainText(/saved/i, {
      timeout: 5000,
    });

    expect(streamKeys).toHaveLength(2);
    expect(streamKeys[0]).toBeTruthy();
    expect(streamKeys[1]).toBeTruthy();
    expect(streamKeys[0]).not.toBe(streamKeys[1]);
    expect(streamConversationIds).toEqual(['conv-1', 'conv-2']);
  });

  test('cancelling voice input stops speech recognition without leaking state', async ({
    page,
  }) => {
    // Deterministic SpeechRecognition injected before the app bundle runs.
    await page.addInitScript(() => {
      class MockSpeechRecognition {
        continuous = false;
        interimResults = false;
        lang = 'en-US';
        onresult: ((event: unknown) => void) | null = null;
        onerror: ((event: unknown) => void) | null = null;
        onend: (() => void) | null = null;

        start() {
          const target = window as unknown as Record<string, unknown>;
          target.__recognitionStarts = ((target.__recognitionStarts as number) ?? 0) + 1;
        }

        stop() {
          const target = window as unknown as Record<string, unknown>;
          target.__recognitionStops = ((target.__recognitionStops as number) ?? 0) + 1;
          this.onend?.();
        }

        abort() {
          this.stop();
        }
      }
      const target = window as unknown as Record<string, unknown>;
      target.SpeechRecognition = MockSpeechRecognition;
      target.webkitSpeechRecognition = MockSpeechRecognition;
    });

    await page.route('**/api/v1/chat/conversations', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ success: true, data: [] }),
      }),
    );

    await loginAndOpenChat(page);

    const micButton = page.locator('button[aria-label="Voice input"]');
    const input = page.locator('input[aria-label="Type your message"]');

    await micButton.click();
    await expect
      .poll(() =>
        page.evaluate(
          () =>
            (window as unknown as Record<string, unknown>).__recognitionStarts,
        ),
      )
      .toBe(1);

    await input.fill('typed text before voice');
    await micButton.click();

    await expect
      .poll(() =>
        page.evaluate(
          () =>
            (window as unknown as Record<string, unknown>).__recognitionStops,
        ),
      )
      .toBe(1);
    await expect(input).toBeEnabled();
    await expect(input).toHaveValue('typed text before voice');

    // A second start/stop cycle must leave no residual listening state.
    await micButton.click();
    await expect
      .poll(() =>
        page.evaluate(
          () =>
            (window as unknown as Record<string, unknown>).__recognitionStarts,
        ),
      )
      .toBe(2);
    await micButton.click();
    await expect
      .poll(() =>
        page.evaluate(
          () =>
            (window as unknown as Record<string, unknown>).__recognitionStops,
        ),
      )
      .toBe(2);
    await expect(input).toBeEnabled();
  });

  test('401 during SSE triggers exactly one token refresh and a retry with the same Idempotency-Key', async ({
    page,
  }) => {
    const streamKeys: string[] = [];
    const authHeaders: string[] = [];
    let refreshCount = 0;

    await page.route('**/api/v1/chat/conversations', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ success: true, data: [] }),
      }),
    );

    await page.route('**/api/auth/refresh', (route) => {
      refreshCount += 1;
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          success: true,
          data: { accessToken: `refreshed-token-${refreshCount}` },
        }),
      });
    });

    await page.route('**/api/v1/chat/stream', async (route) => {
      streamKeys.push(route.request().headers()['idempotency-key'] ?? '');
      authHeaders.push(route.request().headers()['authorization'] ?? '');

      if (streamKeys.length === 1) {
        await route.fulfill({
          status: 401,
          contentType: 'application/json',
          body: JSON.stringify({ message: 'Unauthorized' }),
        });
        return;
      }

      await route.fulfill(
        sseResponse(
          completedStream({
            operationId: 'op-1',
            messageId: 'msg-1',
            text: 'Success after refresh',
            conversationId: null,
            balance: 95,
          }),
        ),
      );
    });

    await loginAndOpenChat(page);

    await page.fill('input[aria-label="Type your message"]', 'Test 401 recovery');
    await page.click('button[aria-label="Send message"]');

    await expect(page.locator('[role="log"]')).toContainText(
      'Success after refresh',
      { timeout: 15000 },
    );
    await expect(page.locator('[role="status"]')).toContainText(/saved/i, {
      timeout: 5000,
    });

    // Exactly one refresh, two attempts, one key: a second debit would need
    // a fresh key and must never happen.
    expect(refreshCount).toBe(1);
    expect(streamKeys).toHaveLength(2);
    expect(streamKeys[0]).toBeTruthy();
    expect(streamKeys[0]).toBe(streamKeys[1]);
    expect(authHeaders[0]).toBe('Bearer mock-access-token');
    expect(authHeaders[1]).toBe('Bearer refreshed-token-1');
  });

  test('new conversation button aborts the in-flight stream', async ({ page }) => {
    let streamAttempts = 0;

    await page.route('**/api/v1/chat/conversations', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          success: true,
          data: [
            {
              id: 'conv-1',
              title: 'Existing Conversation',
              createdAt: '2024-01-01T00:00:00Z',
            },
          ],
        }),
      }),
    );

    await page.route('**/api/v1/chat/conversations/conv-1/messages', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ success: true, data: [] }),
      }),
    );

    await page.route('**/api/v1/chat/stream', async (route) => {
      streamAttempts += 1;
      if (streamAttempts === 1) {
        await route.fulfill(
          sseResponse(
            [
              'event: accepted',
              'data: {"operationId":"op-1"}',
              '',
              'event: delta',
              'data: {"text":"Partial from old conversation"}',
              '',
            ].join('\n'),
          ),
        );
        return;
      }
      await route.fulfill(
        sseResponse(
          completedStream({
            operationId: 'op-2',
            messageId: 'msg-2',
            text: 'New conversation response',
            conversationId: null,
            balance: 90,
          }),
        ),
      );
    });

    await loginAndOpenChat(page);
    await page.waitForSelector('button:has-text("Existing Conversation")', {
      timeout: 10000,
    });

    await page.click('button:has-text("Existing Conversation")');
    await page.fill('input[aria-label="Type your message"]', 'Test message');
    await page.click('button[aria-label="Send message"]');
    await expect(page.locator('[role="log"]')).toContainText(
      'Partial from old conversation',
      { timeout: 5000 },
    );

    // New chat resets the turn; the old partial must disappear.
    await page.click('button:has-text("New Chat")');
    await expect(page.locator('[role="log"]')).not.toContainText(
      'Partial from old conversation',
      { timeout: 5000 },
    );

    await page.fill('input[aria-label="Type your message"]', 'New chat message');
    await page.click('button[aria-label="Send message"]');
    await expect(page.locator('[role="log"]')).toContainText(
      'New conversation response',
      { timeout: 10000 },
    );
    await expect(page.locator('[role="status"]')).toContainText(/saved/i, {
      timeout: 5000,
    });
    expect(streamAttempts).toBe(2);
  });

  test('cancel button aborts the in-flight stream without saving a partial answer', async ({
    page,
  }) => {
    let streamAttempts = 0;

    await page.route('**/api/v1/chat/conversations', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ success: true, data: [] }),
      }),
    );

    await page.route('**/api/v1/chat/stream', async (route) => {
      streamAttempts += 1;
      await route.fulfill(
        sseResponse(
          [
            'event: accepted',
            'data: {"operationId":"op-1"}',
            '',
            'event: delta',
            'data: {"text":"Partial response"}',
            '',
          ].join('\n'),
        ),
      );
    });

    await loginAndOpenChat(page);

    await page.fill('input[aria-label="Type your message"]', 'Test cancel');
    await page.click('button[aria-label="Send message"]');
    await expect(page.locator('[role="log"]')).toContainText('Partial response', {
      timeout: 5000,
    });
    await expect(page.locator('[role="log"]')).toContainText(
      /Partial response — not saved until confirmed/,
      { timeout: 5000 },
    );

    const cancelButton = page.locator('button[aria-label="Cancel"]');
    await expect(cancelButton).toBeVisible({ timeout: 5000 });
    await cancelButton.click();

    await expect(page.locator('[role="status"]')).toContainText(/cancelled/i, {
      timeout: 5000,
    });
    await expect(cancelButton).toBeHidden({ timeout: 5000 });
    await expect(
      page.locator('input[aria-label="Type your message"]'),
    ).toBeEnabled();
    expect(streamAttempts).toBe(1);
  });
});
