/**
 * CHAT-04 test fixtures.
 *
 * Synthetic users, conversations and a fake LLM stream that lets the E2E
 * matrix run without a live Groq key or a real Redis instance. The fake
 * provider is deterministic: it yields a configurable sequence of tokens,
 * can be told to timeout, error-after-delta, or honour an AbortSignal so
 * disconnect tests can exercise the orchestration path end-to-end.
 */

/** Fixed UUIDs so assertions can reference rows by stable id. */
export const FIXTURE = {
  userA: {
    id: 'aaaaaaaa-1111-4aaa-aaaa-aaaaaaaaaaaa',
    email: 'user-a@example.com',
    password: 'password123',
    first_name: 'User',
    last_name: 'A',
  },
  userB: {
    id: 'bbbbbbbb-2222-4bbb-bbbb-bbbbbbbbbbbb',
    email: 'user-b@example.com',
    password: 'password123',
    first_name: 'User',
    last_name: 'B',
  },
  lowBalanceUser: {
    id: 'cccccccc-3333-4ccc-cccc-cccccccccccc',
    email: 'low-balance@example.com',
    password: 'password123',
    first_name: 'Low',
    last_name: 'Balance',
  },
  /** A conversation owned by userA that the matrix can reuse. */
  conversationOwnedByA: 'dddddddd-4444-4ddd-dddd-dddddddddddd',
  /** A conversation owned by userB (used for ownership / cross-user tests). */
  conversationOwnedByB: 'eeeeeeee-5555-4eee-eeee-eeeeeeeeeeee',
} as const;

/**
 * Shape of a fake LLM stream configuration. The fixture builds an async
 * generator that yields the configured tokens, optionally sleeping between
 * them, and optionally throwing or timing out at a specific point.
 */
export interface FakeStreamConfig {
  /** Tokens yielded as `delta` events. */
  tokens?: string[];
  /** Milliseconds to wait before each token (simulates provider latency). */
  delayMs?: number;
  /** If set, throw this error after yielding `errorAfterTokens` tokens. */
  errorAfterTokens?: number;
  /** Error to throw (defaults to a generic provider error). */
  error?: Error;
  /** If true, the stream never yields and never resolves (simulates a hang). */
  hang?: boolean;
  /** If true, the stream throws only when the abort signal fires. */
  throwOnAbort?: boolean;
}

/**
 * A fake LLM provider that records how many times it was invoked and exposes
 * a configurable async generator. The orchestrator slice is expected to
 * accept any object matching the `chatStream(messages, systemPrompt, signal?)`
 * shape; this fixture satisfies that contract.
 */
export class FakeLlmProvider {
  public callCount = 0;
  public lastMessages: Array<{ role: string; content: string }> | null = null;
  public lastSystemPrompt: string | null = null;
  public lastSignal: AbortSignal | null = null;
  private config: FakeStreamConfig;

  constructor(config: FakeStreamConfig = {}) {
    this.config = config;
  }

  /** Replace the stream configuration between tests. */
  configure(config: FakeStreamConfig): void {
    this.config = config;
    this.callCount = 0;
    this.lastMessages = null;
    this.lastSystemPrompt = null;
    this.lastSignal = null;
  }

  /** Non-streaming chat: returns the concatenated tokens. */
  async chat(
    messages: Array<{ role: string; content: string }>,
    systemPrompt?: string,
  ): Promise<string> {
    this.callCount += 1;
    this.lastMessages = messages;
    this.lastSystemPrompt = systemPrompt ?? null;
    const tokens = this.config.tokens ?? ['ok'];
    return tokens.join('');
  }

  /**
   * Streaming chat: yields tokens according to the configured script.
   * Defined as an arrow property because ChatService extracts the method
   * (`this.groqService.chatStream`) before invoking it, which would otherwise
   * detach a prototype method from its instance state.
   */
  chatStream = async function* (
    this: FakeLlmProvider,
    messages: Array<{ role: string; content: string }>,
    systemPrompt?: string,
    options: { signal?: AbortSignal } | AbortSignal = {},
  ): AsyncGenerator<string> {
    // ChatService passes `{ signal }`; older adapters pass the signal itself.
    const signal =
      options instanceof AbortSignal
        ? options
        : ((options as { signal?: AbortSignal }).signal ?? null);
    this.callCount += 1;
    this.lastMessages = messages;
    this.lastSystemPrompt = systemPrompt ?? null;
    this.lastSignal = signal;

    if (this.config.hang) {
      // Park forever; the orchestrator's timeout / abort path is what we test.
      await new Promise<void>(() => {
        /* never resolves */
      });
      return;
    }

    const tokens = this.config.tokens ?? ['hello', ' ', 'world'];
    const delay = this.config.delayMs ?? 0;
    const errorAt = this.config.errorAfterTokens;
    const error = this.config.error ?? new Error('provider failure');

    if (this.config.throwOnAbort && signal) {
      await new Promise<void>((resolve, reject) => {
        const onAbort = () => reject(new Error('aborted'));
        if (signal.aborted) return onAbort();
        signal.addEventListener('abort', onAbort, { once: true });
      });
    }

    for (let i = 0; i < tokens.length; i += 1) {
      if (delay > 0) {
        await new Promise<void>((resolve) => setTimeout(resolve, delay));
      }
      if (signal?.aborted) {
        throw new Error('aborted');
      }
      if (errorAt !== undefined && i >= errorAt) {
        throw error;
      }
      yield tokens[i];
    }
  }.bind(this);
}

/**
 * Minimal in-memory stand-in for RedisService. The billing matrix only needs
 * `get`/`set`/`del` and `incrWithExpiry`; the fake satisfies those and
 * records calls so tests can assert cache invalidation happened.
 *
 * The `outage` toggle (T16) makes every read/write throw, simulating a Redis
 * failure. Billing must remain correct because daily grant and debit are
 * DB-backed, not Redis-backed; only the rate limiter's fail-open/fail-closed
 * behaviour is affected, and that is asserted in a dedicated unit spec.
 */
export class FakeRedis {
  public store = new Map<string, string>();
  public delCalls: string[] = [];
  /** When true, every operation rejects with a Redis-shaped error. */
  public outage = false;

  private guard(method: string): void {
    if (this.outage) {
      const err = new Error(`Redis ${method}: ECONNREFUSED (fake outage)`);
      (err as Error & { code?: string }).code = 'ECONNREFUSED';
      throw err;
    }
  }

  async get(key: string): Promise<string | null> {
    this.guard('get');
    return this.store.get(key) ?? null;
  }
  async set(key: string, value: string, _ttl?: number): Promise<void> {
    this.guard('set');
    this.store.set(key, value);
  }
  async del(key: string): Promise<void> {
    this.guard('del');
    this.store.delete(key);
    this.delCalls.push(key);
  }
  async exists(key: string): Promise<boolean> {
    this.guard('exists');
    return this.store.has(key);
  }
  async setNx(key: string, value: string, _ttl?: number): Promise<boolean> {
    this.guard('setNx');
    if (this.store.has(key)) return false;
    this.store.set(key, value);
    return true;
  }
  async incrWithExpiry(key: string, _windowSeconds: number): Promise<number> {
    this.guard('incrWithExpiry');
    const current = parseInt(this.store.get(key) ?? '0', 10) + 1;
    this.store.set(key, String(current));
    return current;
  }
  async ttl(_key: string): Promise<number> {
    this.guard('ttl');
    return -1;
  }
  async keys(_pattern: string): Promise<string[]> {
    this.guard('keys');
    return [...this.store.keys()];
  }
  async delMany(keys: string[]): Promise<void> {
    this.guard('delMany');
    for (const k of keys) this.store.delete(k);
    this.delCalls.push(...keys);
  }
  isAvailable(): boolean {
    return !this.outage;
  }
}

/**
 * Seed the test database with the fixture users, balances and conversations.
 * Uses the same Prisma client shape as `setup.ts` but keeps the data scoped
 * to this matrix so other e2e suites are not affected.
 */
export async function seedChatBillingFixtures(prisma: any): Promise<void> {
  await prisma.$executeRaw`TRUNCATE TABLE users CASCADE`;

  // Lazy require keeps the native binding out of DB-free unit tests.
  const bcrypt = require('bcrypt') as typeof import('bcrypt');
  const passwordHash = await bcrypt.hash('password123', 10);

  for (const u of [FIXTURE.userA, FIXTURE.userB, FIXTURE.lowBalanceUser]) {
    await prisma.users.create({
      data: {
        id: u.id,
        email: u.email,
        password: passwordHash,
        first_name: u.first_name,
        last_name: u.last_name,
        email_verified: true,
      },
    });
  }

  // User A: plenty of balance.
  await prisma.user_token_balance.create({
    data: { user_id: FIXTURE.userA.id, balance: 500 },
  });
  // User B: also well-funded (used for cross-user isolation tests).
  await prisma.user_token_balance.create({
    data: { user_id: FIXTURE.userB.id, balance: 500 },
  });
  // Low-balance user: below the cost of a single ai_chat turn. The daily
  // top-up is seeded in Redis so it cannot silently raise this balance and
  // turn T02 into a false pass/fail.
  await prisma.user_token_balance.create({
    data: { user_id: FIXTURE.lowBalanceUser.id, balance: 1 },
  });
  const today = new Date().toISOString().slice(0, 10);
  const grantStore = (globalThis as Record<string, unknown>)
    .__CHAT_BILLING_FAKE_REDIS__ as Map<string, string> | undefined;
  if (grantStore) {
    grantStore.set(`token:last_topup:${FIXTURE.lowBalanceUser.id}`, today);
    grantStore.set(`token:last_topup:${FIXTURE.userA.id}`, today);
    grantStore.set(`token:last_topup:${FIXTURE.userB.id}`, today);
  }

  await prisma.chat_conversations.create({
    data: {
      id: FIXTURE.conversationOwnedByA,
      user_id: FIXTURE.userA.id,
      title: 'A conversation',
    },
  });
  await prisma.chat_conversations.create({
    data: {
      id: FIXTURE.conversationOwnedByB,
      user_id: FIXTURE.userB.id,
      title: 'B conversation',
    },
  });
}

/**
 * Read the ledger state the matrix asserts against. Returns the operation
 * row, the token balance, the debit/settle/refund ledger entries and any
 * chat messages persisted for the conversation.
 */
export async function readChatBillingState(
  prisma: any,
  userId: string,
  operationId?: string,
  conversationId?: string,
) {
  const balance = await prisma.user_token_balance.findUnique({
    where: { user_id: userId },
    select: { balance: true },
  });

  const transactions = await prisma.token_transactions.findMany({
    where: { user_id: userId },
    orderBy: { created_at: 'asc' },
  });

  let operation: any = null;
  if (operationId) {
    operation = await prisma.ai_operations.findUnique({
      where: { id: operationId },
    });
  }

  let messages: any[] = [];
  if (conversationId) {
    messages = await prisma.chat_messages.findMany({
      where: { conversation_id: conversationId },
      orderBy: { created_at: 'asc' },
    });
  }

  return {
    balance: balance?.balance ?? null,
    transactions,
    operation,
    messages,
  };
}

/**
 * Count ledger entries for a user, optionally filtered by transaction type
 * (`consumption`/`refund`/`purchase`/`bonus`) and/or feature. Used by the
 * at-most-once refund assertion (T18) and the Redis-outage billing check
 * (T16) to prove the DB ledger stayed consistent without a working Redis.
 */
export async function countLedgerEntries(
  prisma: any,
  userId: string,
  filter: { type?: string; feature?: string } = {},
): Promise<number> {
  const where: Record<string, unknown> = { user_id: userId };
  if (filter.type) where.type = filter.type;
  if (filter.feature) where.feature = filter.feature;
  const rows = await prisma.token_transactions.findMany({ where });
  return rows.length;
}

/**
 * Force the `lease_until` of an ai_operations row into the past so the
 * repository's expired-lease predicate matches it. Used by the simulated
 * recovery tests (T13/T14 contract assertions) to exercise the
 * findExpired/markUnknown primitives without waiting for a real timeout.
 */
export async function markLeaseExpired(
  prisma: any,
  operationId: string,
): Promise<void> {
  const past = new Date(Date.now() - 60_000);
  await prisma.ai_operations.updateMany({
    where: { id: operationId },
    data: { lease_until: past },
  });
}

/**
 * Raw SSE reader that tolerates arbitrary chunk splits. The production
 * parser lives in the web app; this minimal version is just enough to drive
 * the matrix assertions (event name + JSON payload per event).
 */
export function parseSseEvents(
  raw: string,
): Array<{ event: string; data: any }> {
  const events: Array<{ event: string; data: any }> = [];
  const blocks = raw.split(/\n\n+/).filter(Boolean);
  let currentEvent = 'message';
  for (const block of blocks) {
    const lines = block.split(/\r?\n/);
    const dataLines: string[] = [];
    for (const line of lines) {
      if (line.startsWith('event:')) {
        currentEvent = line.slice(6).trim();
      } else if (line.startsWith('data:')) {
        dataLines.push(line.slice(5).trim());
      }
    }
    if (dataLines.length === 0) continue;
    const payload = dataLines.join('\n');
    let parsed: any = payload;
    if (payload.startsWith('{') || payload.startsWith('[')) {
      try {
        parsed = JSON.parse(payload);
      } catch {
        /* keep raw */
      }
    }
    events.push({ event: currentEvent, data: parsed });
    currentEvent = 'message';
  }
  return events;
}
