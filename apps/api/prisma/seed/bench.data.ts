/**
 * Benchmark fixture data builder (DB-04 / PERF-01).
 *
 * Pure and side-effect free: no Prisma client, no env access, no clock reads,
 * no random state outside the local PRNG instance. Importing this module cannot
 * touch a database or start a benchmark. The optional CLI in
 * `prisma/seed-bench.ts` decides when (and whether) these rows are written.
 *
 * Design notes:
 * - Every field derives from `(seed, options)`, so the same inputs always
 *   produce byte-identical plans. `JSON.stringify(plan)` is a stable snapshot.
 * - Row counts are exact: with target N, `progress.length === N` and
 *   `ledger.length === N`. Events are proportional but capped so a 1M-row plan
 *   stays buildable in memory on a normal dev machine.
 * - Progress rows are spread across many users using a power-law-ish curve,
 *   with one deliberately hot user. Twenty percent of rows are "due" at the
 *   frozen clock, with repeated timestamps for cursor-stability testing.
 * - `card_id` values are version-4-shaped placeholders derived from the PRNG.
 *   The CLI resolves real catalogue card IDs by `seed_key` before writing.
 */

// ─── Frozen clock and defaults ────────────────────────────────────────────────

/** Fixed 2026-01-01T00:00:00.000Z — used for every generated timestamp. */
export const BENCH_EPOCH_MS = Date.UTC(2026, 0, 1, 0, 0, 0);

/** Fixed default PRNG seed; callers may override for divergence experiments. */
export const DEFAULT_BENCH_SEED = 20260101;

/** Default number of synthetic users. */
export const DEFAULT_BENCH_USERS = 200;

/** Supported scale steps: 10k, 100k and 1M progress/ledger rows. */
export const BENCH_TARGETS = {
  '10k': 10_000,
  '100k': 100_000,
  '1m': 1_000_000,
} as const;

export type BenchTarget = keyof typeof BENCH_TARGETS;
export type BenchTargetRows = (typeof BENCH_TARGETS)[BenchTarget];

// ─── Types ────────────────────────────────────────────────────────────────────

export interface BenchUserRow {
  /** Deterministic UUID; the CLI writes this exact ID (uuid v5 semantics). */
  id: string;
  email: string;
  first_name: string;
  last_name: string;
  password: string | null;
  provider: 'LOCAL';
  is_active: boolean;
  email_verified: boolean;
  preferred_language: string;
  language: string;
  native_language: string;
  target_language: string;
  created_at: Date;
}

/** Card selection emitted by the planner; `card_id` is a placeholder UUID. */
export interface BenchCardRef {
  card_id: string;
  /** Stable catalogue key (`deck.seed_key`) used by the CLI to resolve a real ID. */
  seed_key: string;
  language: string;
}

export interface BenchProgressRow {
  id: string;
  user_id: string;
  card_id: string;
  ease_factor: number;
  difficulty: number;
  interval_days: number;
  repetition_count: number;
  next_review_date: Date;
  last_review_date: Date;
  /** Numeric grades only; SrsService reads this as `number[]`. */
  quality_history: number[];
}

/** JSON scalar/object subset accepted by Prisma's InputJsonValue. */
export type BenchJsonValue = string | number | boolean | null | BenchJsonValue[] | { [key: string]: BenchJsonValue };

export interface BenchReviewEventRow {
  id: string;
  user_id: string;
  card_id: string;
  /** Shape matches `srs_review_events.result` written by SrsService.reviewCard. */
  result: { grade: number; response: { [key: string]: BenchJsonValue } };
  created_at: Date;
}

export type BenchLedgerType = 'purchase' | 'bonus' | 'consumption' | 'refund';

export interface BenchLedgerRow {
  id: string;
  user_id: string;
  amount: number;
  type: BenchLedgerType;
  feature: string;
  balance_after: number;
  idempotency_key: string;
  created_at: Date;
}

export interface BenchBalanceRow {
  user_id: string;
  /** Always equals the last ledger `balance_after` for that user. */
  balance: number;
}

export interface BenchPlan {
  seed: number;
  target: BenchTarget;
  targetRows: number;
  userCount: number;
  users: BenchUserRow[];
  cards: BenchCardRef[];
  progress: BenchProgressRow[];
  events: BenchReviewEventRow[];
  ledger: BenchLedgerRow[];
  balances: BenchBalanceRow[];
}

export interface BenchPlanSummary {
  seed: number;
  target: BenchTarget;
  targetRows: number;
  users: number;
  cards: number;
  progress: number;
  events: number;
  ledger: number;
  balances: number;
  /** Share of progress rows whose `next_review_date` is at or before the epoch. */
  dueRatio: number;
  /** Highest number of progress rows assigned to one user. */
  maxRowsPerUser: number;
  /** Highest user share of all progress rows, as a fraction in [0, 1]. */
  maxUserShare: number;
  minBalance: number;
  timestampTies: number;
}

export interface BenchBuildOptions {
  /** '10k' | '100k' | '1m', or an explicit positive row count. */
  target?: BenchTarget | number;
  /** Fixed PRNG seed. Defaults to DEFAULT_BENCH_SEED. */
  seed?: number;
  /** Number of synthetic users. Defaults to DEFAULT_BENCH_USERS. */
  users?: number;
  /**
   * Language distribution used for synthetic card references. Defaults to
   * all five catalogue languages. The CLI may filter this to existing decks.
   */
  languages?: readonly string[];
  /** User index (0-based) that receives the deliberately large share. */
  hotUserIndex?: number;
}

// ─── Deterministic helpers ────────────────────────────────────────────────────

/** mulberry32: small, fast, deterministic 32-bit PRNG. */
export function createPrng(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Version-4-shaped UUID from a PRNG; stable because the PRNG is seeded. */
const uuidFromRandom = (random: () => number): string => {
  const bytes = new Uint8Array(16);
  for (let i = 0; i < 16; i += 1) bytes[i] = Math.floor(random() * 256);
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
};

const clampInteger = (value: number, min: number, max: number, fallback: number): number => {
  if (!Number.isSafeInteger(value) || value < min || value > max) return fallback;
  return value;
};

const normalizeTarget = (target: BenchBuildOptions['target']): { name: BenchTarget; rows: number } => {
  if (typeof target === 'number') {
    if (!Number.isSafeInteger(target) || target < 1) {
      throw new RangeError('target must be a positive safe integer');
    }
    const known = (Object.entries(BENCH_TARGETS) as [BenchTarget, number][]).find(
      ([, rows]) => rows === target,
    );
    return { name: known ? known[0] : '10k', rows: target };
  }
  const name = target ?? '10k';
  if (!(name in BENCH_TARGETS)) throw new RangeError(`unknown benchmark target: ${name}`);
  return { name, rows: BENCH_TARGETS[name] };
};

const LANGUAGES = ['english', 'japanese', 'chinese', 'korean', 'vietnamese'] as const;
const FEATURES = ['ai_chat', 'writing_feedback', 'quiz_generate'] as const;
const LEDGER_TYPES: readonly BenchLedgerType[] = ['purchase', 'bonus', 'consumption', 'refund'];

/** Power-law-ish weights: a few heavy users, many light ones, plus a hot user. */
const buildUserWeights = (
  random: () => number,
  userCount: number,
  hotUserIndex: number,
): number[] => {
  const weights: number[] = [];
  for (let i = 0; i < userCount; i += 1) {
    const rank = i + 1;
    const base = 1 / Math.pow(rank, 0.72);
    weights.push(base * (0.7 + 0.6 * random()));
  }
  weights[hotUserIndex] += 2.5;
  const total = weights.reduce((sum, weight) => sum + weight, 0);
  return weights.map((weight) => weight / total);
};

/** Map a fraction in [0,1) to a user index using cumulative weights. */
const pickUser = (cumulative: number[], fraction: number): number => {
  let low = 0;
  let high = cumulative.length - 1;
  while (low < high) {
    const mid = (low + high) >>> 1;
    if (fraction < cumulative[mid]) high = mid;
    else low = mid + 1;
  }
  return low;
};

// ─── Plan builder ─────────────────────────────────────────────────────────────

export function buildPlan(options: BenchBuildOptions = {}): BenchPlan {
  const { name: target, rows: targetRows } = normalizeTarget(options.target);
  const seed = clampInteger(options.seed ?? DEFAULT_BENCH_SEED, 0, 0xffffffff, DEFAULT_BENCH_SEED);
  const userCount = clampInteger(options.users ?? DEFAULT_BENCH_USERS, 1, 100_000, DEFAULT_BENCH_USERS);
  const hotUserIndex = clampInteger(options.hotUserIndex ?? 0, 0, userCount - 1, 0);
  const languages = options.languages?.length ? [...options.languages] : [...LANGUAGES];

  const random = createPrng(seed);
  const cumulative: number[] = [];
  let running = 0;
  for (const weight of buildUserWeights(random, userCount, hotUserIndex)) {
    running += weight;
    cumulative.push(running);
  }

  // User IDs are consumed from the same deterministic PRNG before row IDs.
  const userIds = Array.from({ length: userCount }, () => uuidFromRandom(random));
  const users: BenchUserRow[] = [];
  for (let i = 0; i < userCount; i += 1) {
    users.push({
      id: userIds[i],
      email: `bench-user-${String(i).padStart(5, '0')}@bench.linguaai.local`,
      first_name: 'Bench',
      last_name: `User${String(i).padStart(5, '0')}`,
      password: null,
      provider: 'LOCAL',
      is_active: true,
      email_verified: true,
      preferred_language: languages[i % languages.length],
      language: 'en',
      native_language: 'vi',
      target_language: languages[i % languages.length],
      created_at: new Date(BENCH_EPOCH_MS),
    });
  }

  // Enough distinct cards for every user to own every card, so the unique
  // (user_id, card_id) constraint can never force an infinite search.
  const cardCount = Math.min(Math.max(50, Math.ceil(targetRows / userCount) + 1), 5_000);
  const cardIds = Array.from({ length: cardCount }, () => uuidFromRandom(random));
  const cards: BenchCardRef[] = [];
  for (let i = 0; i < cardCount; i += 1) {
    const language = languages[i % languages.length];
    cards.push({
      card_id: cardIds[i],
      seed_key: `bench|${language}|${String(i).padStart(5, '0')}`,
      language,
    });
  }

  const progress: BenchProgressRow[] = [];
  const events: BenchReviewEventRow[] = [];
  const ledger: BenchLedgerRow[] = [];
  const balances: BenchBalanceRow[] = [];
  const balanceByUser = new Array<number>(userCount).fill(0);
  const ledgerCountByUser = new Array<number>(userCount).fill(0);
  const pairSeen = new Set<string>();

  const eventCount = Math.min(targetRows, 5_000);
  const ledgerCount = targetRows;
  const dueEvery = 5; // 20% due at the frozen clock

  for (let i = 0; i < targetRows; i += 1) {
    const userIndex = pickUser(cumulative, random());
    const user = users[userIndex];
    // Walk the card ring until an unused (user, card) pair is found: the
    // schema has a unique constraint on that pair.
    let cardIndex = i % cards.length;
    let pairKey = `${userIndex}:${cardIndex}`;
    while (pairSeen.has(pairKey)) {
      cardIndex = (cardIndex + 1) % cards.length;
      pairKey = `${userIndex}:${cardIndex}`;
    }
    pairSeen.add(pairKey);
    const card = cards[cardIndex];

    const repetition = i % 7;
    const due = i % dueEvery === 0;
    const tie = (i % 17) * 1000; // deliberate next_review_date ties
    const dayOffset = due ? -(1 + (i % 7)) : 1 + (i % 30);
    const nextReviewDate = new Date(BENCH_EPOCH_MS + dayOffset * 86_400_000 + tie);
    const lastReviewDate = new Date(BENCH_EPOCH_MS - (1 + (i % 45)) * 86_400_000 + tie);

    progress.push({
      id: uuidFromRandom(random),
      user_id: user.id,
      card_id: card.card_id,
      ease_factor: Number((1.3 + (i % 23) * 0.05).toFixed(2)),
      difficulty: Number((1 + (i % 9) * 0.5).toFixed(2)),
      interval_days: repetition === 0 ? 0 : 1 + (i % 30),
      repetition_count: repetition,
      next_review_date: nextReviewDate,
      last_review_date: lastReviewDate,
      quality_history: Array.from(
        { length: repetition },
        (_, j) => 1 + ((i + j) % 4),
      ),
    });
  }

  for (let i = 0; i < eventCount; i += 1) {
    const userIndex = pickUser(cumulative, random());
    const card = cards[(i + 1) % cards.length];
    const grade = 1 + Math.floor(random() * 4);
    events.push({
      id: uuidFromRandom(random),
      user_id: users[userIndex].id,
      card_id: card.card_id,
      result: {
        grade,
        response: {
          cardId: card.card_id,
          stability: 1.3 + (i % 23) * 0.05,
          difficulty: 1 + (i % 9) * 0.5,
          newInterval: 1 + (i % 30),
          nextReviewDate: new Date(BENCH_EPOCH_MS + (i % 30) * 86_400_000).toISOString(),
          retrievability: 50 + (i % 50),
        },
      },
      created_at: new Date(BENCH_EPOCH_MS + (i % 45) * 86_400_000 + (i % 13) * 1000),
    });
  }

  for (let i = 0; i < ledgerCount; i += 1) {
    const userIndex = pickUser(cumulative, random());
    const cycle = ledgerCountByUser[userIndex]++;
    const type: BenchLedgerType = LEDGER_TYPES[cycle % LEDGER_TYPES.length];
    // Grants precede consumption for every user, so balances never go negative.
    const amount =
      type === 'purchase' ? 100 + (i % 50) :
      type === 'bonus' ? 5 + (i % 10) :
      type === 'refund' ? 3 + (i % 5) :
      -(1 + (i % 4));
    balanceByUser[userIndex] += amount;
    ledger.push({
      id: uuidFromRandom(random),
      user_id: users[userIndex].id,
      amount,
      type,
      feature: FEATURES[i % FEATURES.length],
      balance_after: balanceByUser[userIndex],
      idempotency_key: `bench-ledger-${seed}-${String(i).padStart(9, '0')}`,
      created_at: new Date(BENCH_EPOCH_MS + (i % 90) * 86_400_000 + (i % 11) * 1000),
    });
  }

  for (let i = 0; i < userCount; i += 1) {
    balances.push({ user_id: users[i].id, balance: balanceByUser[i] });
  }

  return {
    seed,
    target,
    targetRows,
    userCount,
    users,
    cards,
    progress,
    events,
    ledger,
    balances,
  };
}

/** Cheap, allocation-light summary of a plan (does not copy row arrays). */
export function summarizePlan(plan: BenchPlan): BenchPlanSummary {
  const perUser = new Map<string, number>();
  let due = 0;
  for (const row of plan.progress) {
    perUser.set(row.user_id, (perUser.get(row.user_id) ?? 0) + 1);
    if (row.next_review_date.getTime() <= BENCH_EPOCH_MS) due += 1;
  }
  const maxRowsPerUser = perUser.size ? Math.max(...perUser.values()) : 0;
  const timestamps = new Set<number>();
  let timestampTies = 0;
  for (const row of plan.progress) {
    const ms = row.next_review_date.getTime();
    if (timestamps.has(ms)) timestampTies += 1;
    else timestamps.add(ms);
  }
  const minBalance = plan.balances.length
    ? Math.min(...plan.balances.map((row) => row.balance))
    : 0;
  return {
    seed: plan.seed,
    target: plan.target,
    targetRows: plan.targetRows,
    users: plan.users.length,
    cards: plan.cards.length,
    progress: plan.progress.length,
    events: plan.events.length,
    ledger: plan.ledger.length,
    balances: plan.balances.length,
    dueRatio: plan.progress.length ? due / plan.progress.length : 0,
    maxRowsPerUser,
    maxUserShare: plan.progress.length ? maxRowsPerUser / plan.progress.length : 0,
    minBalance,
    timestampTies,
  };
}
