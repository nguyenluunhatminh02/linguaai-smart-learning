import { test, expect, type Page, type Route } from '@playwright/test';

/**
 * Browser learning flow: flashcard review, chat SSE, writing feedback and the
 * personalized daily plan. These specs exercise the real UI against a mocked
 * API so they run deterministically in CI without live AI/LLM credentials.
 *
 * Credentials come only from CI fixture variables (with the same local dev
 * defaults used by auth-flow.spec.ts / review-session.spec.ts); no .env value
 * or committed secret is read here.
 */

const TEST_EMAIL = process.env.E2E_TEST_EMAIL || 'nguyen.minh@linguaai.local';
const TEST_PASSWORD = process.env.E2E_TEST_PASSWORD || 'TestUser!2024';

const DECK_ID = '11111111-1111-4111-8111-111111111111';
const CARDS = [
  { id: 'card-0001', frontText: 'hello', backText: 'xin chào', exampleSentence: 'Hello, how are you?' },
  { id: 'card-0002', frontText: 'thank you', backText: 'cảm ơn', exampleSentence: 'Thank you for your help.' },
] as const;

const WRITING_TEXT = 'I go to school yesterday and learn many thing.';
const WRITING_RESULT = {
  id: 'writing-result-0001',
  overallScore: 72,
  feedback: 'Good start. Watch your past tense verb forms.',
  errors: [
    { original: 'go', correction: 'went', explanation: 'Use the past tense for yesterday.', type: 'grammar' },
    { original: 'thing', correction: 'things', explanation: 'Use the plural form after "many".', type: 'grammar' },
  ],
  suggestions: ['Practise irregular past tense verbs.', 'Review plural nouns.'],
  rewrittenText: 'I went to school yesterday and learned many things.',
  scores: { grammar: 6, vocabulary: 7, coherence: 8, taskAchievement: 7 },
  language: 'english',
  targetLevel: 'B1',
  createdAt: '2026-01-02T03:04:05.000Z',
  userText: WRITING_TEXT,
};

const LEARNING_PATH = {
  userId: 'test-user-0001',
  generatedAt: '2026-01-02T03:04:05.000Z',
  activities: [
    {
      rank: 1,
      type: 'srs_review',
      title: 'Review due flashcards',
      description: 'Clear your due cards to keep your streak.',
      urgency: 'high',
      estimatedMinutes: 5,
      action: { deckId: DECK_ID, dueCount: 2 },
    },
    {
      rank: 2,
      type: 'writing_practice',
      title: 'Writing practice',
      description: 'Write a short paragraph and get feedback.',
      urgency: 'medium',
      estimatedMinutes: 10,
      action: {},
    },
  ],
  summary: 'Start with the flashcards, then write a short paragraph.',
};

/** Respond to an API route with a JSON body. */
async function routeJson(page: Page, pattern: string | RegExp, body: unknown, status = 200) {
  await page.route(pattern, (route: Route) =>
    route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) }),
  );
}

/** Login through the real UI form and wait for the dashboard redirect. */
async function login(page: Page) {
  await page.goto('/login');
  await page.waitForSelector('input[type="email"]');
  await page.fill('input[type="email"]', TEST_EMAIL);
  await page.fill('input[type="password"]', TEST_PASSWORD);
  await page.click('button[type="submit"]');
  await expect(page).toHaveURL(/.*dashboard/, { timeout: 20000 });
}

/** Mock the session endpoints every flow needs before navigation. */
async function mockSession(page: Page) {
  await routeJson(page, '**/api/auth/refresh', { data: { accessToken: 'e2e-access-token' } });
  await routeJson(page, '**/users/me/learning-preferences', {
    level: 'A1',
    dailyStudyMinutes: 10,
    dailyWordGoal: 5,
    dailyReviewGoal: 10,
    configured: true,
  });
  await routeJson(page, '**/analytics/dashboard', {
    streak: 5,
    totalXp: 1250,
    dueCards: 2,
    masteredCards: 45,
    totalDecks: 1,
    totalReviews: 120,
    weeklyActivity: [],
  });
  await routeJson(page, '**/token-balance', { balance: 1000 });
  await routeJson(page, '**/recommendations/learning-path', LEARNING_PATH);
  await routeJson(page, '**/recommendations/invalidate-cache', { success: true });
}

/**
 * Return a complete SSE response body. Splitting the wire format across
 * duplicate `data:` lines exercises the shared chunk-safe SSE parser too.
 */
function sseBody(events: Array<{ event?: string; data: string }>) {
  return events
    .map(({ event, data }) => `${event ? `event: ${event}\n` : ''}data: ${data}\n\n`)
    .join('');
}

test.describe('Flashcard learning flow', () => {
  test('deck -> study -> grade -> saved summary', async ({ page }) => {
    test.setTimeout(60000);

    const reviewRequests: Array<{ cardId: string; grade: number; operationId: string }> = [];
    const finishRequests: Array<Record<string, unknown>> = [];

    await mockSession(page);
    await login(page);

    await routeJson(page, '**/decks', [
      { id: DECK_ID, title: 'E2E greeting deck', description: 'Greetings', cardCount: CARDS.length, isPublic: false, createdAt: '2026-01-01T00:00:00.000Z' },
    ]);
    await routeJson(page, '**/srs/due-cards', {
      dueCards: [{ card: CARDS[0] }],
      newCards: [CARDS[1]],
    });
    await routeJson(page, '**/srs/session/start', { id: 'session-0001', startedAt: '2026-01-02T03:00:00.000Z' });
    await page.route('**/srs/review', (route: Route) => {
      reviewRequests.push(route.request().postDataJSON() as typeof reviewRequests[number]);
      return route.fulfill({ status: 201, contentType: 'application/json', body: JSON.stringify({ success: true }) });
    });
    await page.route('**/srs/session/finish', (route: Route) => {
      finishRequests.push(route.request().postDataJSON() as Record<string, unknown>);
      return route.fulfill({ status: 201, contentType: 'application/json', body: JSON.stringify({ success: true }) });
    });

    await page.goto('/flashcards');
    await expect(page.locator('h1')).toContainText(/Flashcard/i);
    const deckLink = page.getByRole('link', { name: /E2E greeting deck/ });
    await expect(deckLink).toBeVisible();
    await deckLink.click();
    await expect(page).toHaveURL(new RegExp(`/flashcards/${DECK_ID}`));

    await page.getByRole('link', { name: /Study/ }).click();
    await expect(page).toHaveURL(new RegExp(`/flashcards/${DECK_ID}/study`));

    // First card: reveal the answer, then grade Good.
    await expect(page.getByText(CARDS[0].frontText, { exact: true })).toBeVisible();
    await page.getByRole('button', { name: /Show answer/i }).click();
    await expect(page.locator('#flashcard-answer')).toContainText(CARDS[0].backText);
    await page.getByRole('button', { name: /^Good$/i }).click();

    // Second card: Forget, which completes the session.
    await expect(page.getByText(CARDS[1].frontText, { exact: true })).toBeVisible();
    await page.getByRole('button', { name: /Show answer/i }).click();
    await expect(page.locator('#flashcard-answer')).toContainText(CARDS[1].backText);
    await page.getByRole('button', { name: /^Forgot$/i }).click();

    await expect(page.getByRole('heading', { name: /Review saved/i })).toBeVisible();
    await expect(page.getByRole('status')).toContainText('1/2 cards remembered');

    expect(reviewRequests).toHaveLength(2);
    expect(reviewRequests[0]).toMatchObject({ cardId: CARDS[0].id, grade: 3 });
    expect(reviewRequests[1]).toMatchObject({ cardId: CARDS[1].id, grade: 1 });
    expect(reviewRequests.every((r) => typeof r.operationId === 'string' && r.operationId.length > 0)).toBe(true);
    expect(finishRequests).toHaveLength(1);
    expect(finishRequests[0]).toMatchObject({ cardsReviewed: 2, cardsCorrect: 1 });
    expect(typeof finishRequests[0].sessionId).toBe('string');
    expect(typeof finishRequests[0].durationSeconds).toBe('number');
  });
});

test.describe('Chat learning flow', () => {
  test('new conversation -> SSE send -> saved reply', async ({ page }) => {
    test.setTimeout(60000);

    const sent: Array<{ conversationId: string | null; language: string; message: string; key: string | null }> = [];
    await mockSession(page);
    await login(page);

    await routeJson(page, '**/chat/conversations', []);
    await routeJson(page, '**/chat/conversations/*/messages', []);
    await routeJson(page, '**/chat/operations/*', {
      status: 'SUCCEEDED',
      conversationId: 'conv-e2e-0001',
      messageId: 'msg-e2e-0001',
      balance: 950,
      content: 'Hello! How can I help you today?',
    });
    await routeJson(page, '**/ai-operations/*', {
      status: 'SUCCEEDED',
      conversationId: 'conv-e2e-0001',
      messageId: 'msg-e2e-0001',
      balance: 950,
      content: 'Hello! How can I help you today?',
    });
    await page.route('**/chat/stream', (route: Route) => {
      const request = route.request();
      sent.push({
        conversationId: (request.postDataJSON() as { conversationId?: string | null }).conversationId ?? null,
        language: (request.postDataJSON() as { language?: string }).language ?? '',
        message: (request.postDataJSON() as { message?: string }).message ?? '',
        key: request.headers()['idempotency-key'] ?? null,
      });
      return route.fulfill({
        status: 200,
        contentType: 'text/event-stream',
        body: sseBody([
          { event: 'accepted', data: JSON.stringify({ operationId: 'op-e2e-0001', conversationId: 'conv-e2e-0001' }) },
          { event: 'delta', data: JSON.stringify({ text: 'Hello! ' }) },
          { event: 'delta', data: JSON.stringify({ text: 'How can I help you today?' }) },
          { event: 'completed', data: JSON.stringify({ operationId: 'op-e2e-0001', messageId: 'msg-e2e-0001', balance: 950 }) },
        ]),
      });
    });

    await page.goto('/chat');
    await expect(page.locator('#chat-input')).toBeVisible();

    // New conversation ensures no pre-existing turn is reused.
    await page.getByRole('button', { name: /New chat/i }).click();
    await expect(page.locator('#chat-input')).toHaveValue('');

    const message = 'Hello, can you help me practise English?';
    await page.locator('#chat-input').fill(message);
    await page.getByRole('button', { name: 'Send message' }).click();

    await expect(page.getByText(message)).toBeVisible();
    await expect(page.getByRole('status')).toContainText('Response saved.', { timeout: 15000 });
    await expect(page.getByText('Hello! How can I help you today?')).toBeVisible();
    await expect(page.getByText('Partial response — not saved until confirmed.')).toHaveCount(0);

    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ language: 'english', message });
    expect(sent[0].conversationId).toBeNull(); // a fresh turn sends no fabricated conversation id
    expect(sent[0].key).toBeTruthy();
  });

  test('failed stream is marked incomplete and no reply is saved', async ({ page }) => {
    test.setTimeout(60000);

    await mockSession(page);
    await login(page);

    await routeJson(page, '**/chat/conversations', []);
    await routeJson(page, '**/chat/conversations/*/messages', []);
    // No status endpoint recovery: all recovery lookups 404.
    await routeJson(page, '**/chat/operations/*', { message: 'not found' }, 404);
    await routeJson(page, '**/ai-operations/*', { message: 'not found' }, 404);
    await page.route('**/chat/stream', (route: Route) =>
      route.fulfill({
        status: 200,
        contentType: 'text/event-stream',
        // A partial answer followed by EOF must never become a saved reply.
        body: sseBody([
          { event: 'accepted', data: JSON.stringify({ operationId: 'op-e2e-0002', conversationId: 'conv-e2e-0002' }) },
          { event: 'delta', data: JSON.stringify({ text: 'This partial text is not saved.' }) },
        ]),
      }),
    );

    await page.goto('/chat');
    await expect(page.locator('#chat-input')).toBeVisible();
    await page.locator('#chat-input').fill('Will this partial reply be saved?');
    await page.getByRole('button', { name: 'Send message' }).click();

    const status = page.getByRole('status');
    await expect(status).toContainText(/not saved|did not|without a result|incomplete/i, { timeout: 15000 });
    await expect(status).not.toContainText('Response saved.');
    await expect(page.getByText('Partial response — not saved until confirmed.')).toBeVisible();
  });
});

test.describe('Writing practice flow', () => {
  test('submit text -> feedback panel -> history shows same submission', async ({ page }) => {
    test.setTimeout(60000);

    let assessCount = 0;
    await mockSession(page);
    await login(page);

    await page.route('**/writing/assess', (route: Route) => {
      const body = route.request().postDataJSON() as Record<string, unknown>;
      expect(body).toMatchObject({ userText: WRITING_TEXT, language: 'english', targetLevel: 'B1' });
      assessCount += 1;
      return route.fulfill({ status: 201, contentType: 'application/json', body: JSON.stringify(WRITING_RESULT) });
    });
    await routeJson(page, '**/writing/history?*', {
      items: [{ ...WRITING_RESULT, errorCount: WRITING_RESULT.errors.length }],
      total: 1,
    });

    await page.goto('/writing');
    const editor = page.locator('textarea');
    await expect(editor).toBeVisible();
    await editor.fill(WRITING_TEXT);
    await page.getByRole('button', { name: /Get feedback|chấm bài/i }).click();

    await expect(page.getByText(WRITING_RESULT.feedback)).toBeVisible();
    await expect(page.getByText(WRITING_RESULT.rewrittenText)).toBeVisible();
    await expect(page.getByText('went', { exact: true }).first()).toBeVisible();
    expect(assessCount).toBe(1);

    // Switch to history; the same submission must appear there.
    await page.getByRole('button', { name: /History|Lịch sử/i }).click();
    await expect(page.getByText(WRITING_TEXT)).toBeVisible();
    await expect(page.getByText(WRITING_RESULT.feedback)).toBeVisible();
  });

  test('failed assessment shows role=alert and no feedback panel', async ({ page }) => {
    test.setTimeout(60000);

    await mockSession(page);
    await login(page);

    await routeJson(page, '**/writing/assess', { message: 'The assessment service is unavailable.' }, 503);
    await routeJson(page, '**/writing/history?*', { items: [], total: 0 });

    await page.goto('/writing');
    await page.locator('textarea').fill(WRITING_TEXT);
    await page.getByRole('button', { name: /Get feedback|chấm bài/i }).click();

    await expect(page.getByRole('alert')).toContainText(/Không thể chấm bài|unavailable/i, { timeout: 15000 });
    await expect(page.getByText(WRITING_RESULT.feedback)).toHaveCount(0);
  });
});

test.describe('Daily plan flow', () => {
  test('onboarding preferences -> plan renders -> first activity href -> refresh', async ({ page }) => {
    test.setTimeout(60000);

    let preferencePatches = 0;
    let pathRequests = 0;
    await mockSession(page);
    await login(page);

    // First load: onboarding is shown because preferences are not configured.
    await routeJson(page, '**/users/me/learning-preferences', {
      level: 'A1',
      dailyStudyMinutes: 10,
      dailyWordGoal: 5,
      dailyReviewGoal: 10,
      configured: false,
    });
    await page.route('**/users/me/learning-preferences', (route: Route) => {
      if (route.request().method() === 'PATCH') {
        const changes = route.request().postDataJSON() as Record<string, unknown>;
        expect(changes).toMatchObject({ level: 'A2', dailyStudyMinutes: 15 });
        preferencePatches += 1;
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            level: changes.level,
            dailyStudyMinutes: changes.dailyStudyMinutes,
            dailyWordGoal: 5,
            dailyReviewGoal: 10,
            configured: true,
          }),
        });
      }
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          level: 'A1',
          dailyStudyMinutes: 10,
          dailyWordGoal: 5,
          dailyReviewGoal: 10,
          configured: preferencePatches === 0,
        }),
      });
    });
    await page.route('**/recommendations/learning-path', (route: Route) => {
      pathRequests += 1;
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(LEARNING_PATH) });
    });

    await page.goto('/dashboard');

    // Onboarding form: choose level A2 and 15 minutes, then save.
    const levelSelect = page.getByLabel(/current level|trình độ tự đánh giá/i);
    const minutesSelect = page.getByLabel(/time per day|thời gian mỗi ngày/i);
    await expect(levelSelect).toBeVisible();
    await levelSelect.selectOption('A2');
    await minutesSelect.selectOption('15');
    await page.getByRole('button', { name: /^Save$/i }).click();

    await expect(levelSelect).toHaveCount(0);
    await expect(page.getByRole('heading', { name: LEARNING_PATH.activities[0].title })).toBeVisible();
    await expect(page.getByText(LEARNING_PATH.summary)).toBeVisible();
    expect(preferencePatches).toBe(1);

    // First activity links directly to the study route with a bounded limit.
    const continueLink = page.getByRole('link', { name: /Continue learning|Học tiếp/i });
    await expect(continueLink).toHaveAttribute(
      'href',
      `/flashcards/${DECK_ID}/study?limit=2`,
    );

    // Refresh invalidates the server cache and refetches; the plan survives.
    await page.getByRole('button', { name: /Refresh path|Làm mới lộ trình/i }).click();
    await expect(page.getByRole('heading', { name: LEARNING_PATH.activities[0].title })).toBeVisible();
    expect(pathRequests).toBeGreaterThan(1);

    // A page reload keeps the saved preferences and the plan, not onboarding.
    await page.reload();
    await expect(page.getByRole('heading', { name: LEARNING_PATH.activities[0].title })).toBeVisible();
    await expect(page.getByRole('link', { name: /Continue learning|Học tiếp/i })).toHaveAttribute(
      'href',
      `/flashcards/${DECK_ID}/study?limit=2`,
    );
  });
});
