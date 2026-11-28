import {
  BENCH_EPOCH_MS,
  BENCH_TARGETS,
  BenchPlan,
  DEFAULT_BENCH_SEED,
  buildPlan,
  summarizePlan,
} from '../prisma/seed/bench.data';

const UUID_V4 =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const assertLedgerInvariants = (plan: BenchPlan): void => {
  const lastBalance = new Map<string, number>();
  const running = new Map<string, number>();
  for (const tx of plan.ledger) {
    expect(UUID_V4.test(tx.id)).toBe(true);
    expect(tx.balance_after).toBeGreaterThanOrEqual(0);
    expect(['purchase', 'bonus', 'consumption', 'refund']).toContain(tx.type);
    const next = (running.get(tx.user_id) ?? 0) + tx.amount;
    expect(next).toBe(tx.balance_after);
    running.set(tx.user_id, next);
    lastBalance.set(tx.user_id, next);
  }
  for (const balance of plan.balances) {
    expect(balance.balance).toBe(lastBalance.get(balance.user_id));
    expect(balance.balance).toBeGreaterThanOrEqual(0);
  }
  expect(new Set(plan.ledger.map((tx) => tx.idempotency_key)).size).toBe(
    plan.ledger.length,
  );
};

describe('benchmark fixture data (pure, no DB)', () => {
  it('uses the fixed default seed and a frozen epoch', () => {
    const plan = buildPlan();
    expect(plan.seed).toBe(DEFAULT_BENCH_SEED);
    expect(BENCH_EPOCH_MS).toBe(Date.UTC(2026, 0, 1, 0, 0, 0));
    expect(plan.users[0].created_at.toISOString()).toBe(
      '2026-01-01T00:00:00.000Z',
    );
  });

  it('is byte-identical for the same seed and diverges for a different seed', () => {
    const a = buildPlan({ target: '10k' });
    const b = buildPlan({ target: '10k' });
    const c = buildPlan({ target: '10k', seed: DEFAULT_BENCH_SEED + 1 });
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    expect(JSON.stringify(a)).not.toBe(JSON.stringify(c));
    expect(summarizePlan(a)).toEqual(summarizePlan(b));
  });

  it.each(
    Object.entries(BENCH_TARGETS) as [keyof typeof BENCH_TARGETS, number][],
  )('produces exactly %s rows (%i) across many users', (target, rows) => {
    const plan = buildPlan({ target });
    expect(plan.progress).toHaveLength(rows);
    expect(plan.ledger).toHaveLength(rows);
    expect(plan.users).toHaveLength(200);
    expect(new Set(plan.users.map((user) => user.email)).size).toBe(200);
    expect(plan.users.every((user) => UUID_V4.test(user.id))).toBe(true);

    const summary = summarizePlan(plan);
    expect(summary.users).toBe(200);
    expect(summary.maxRowsPerUser).toBeLessThan(rows);
    expect(summary.maxUserShare).toBeLessThan(1);
    expect(summary.dueRatio).toBeGreaterThan(0);
    expect(summary.timestampTies).toBeGreaterThan(0);

    assertLedgerInvariants(plan);
  });

  it('keeps every (user_id, card_id) pair and every row ID unique', () => {
    const plan = buildPlan({ target: '100k' });
    const pairs = new Set(
      plan.progress.map((row) => `${row.user_id}|${row.card_id}`),
    );
    expect(pairs.size).toBe(plan.progress.length);
    expect(new Set(plan.progress.map((row) => row.id)).size).toBe(
      plan.progress.length,
    );
    expect(new Set(plan.events.map((row) => row.id)).size).toBe(
      plan.events.length,
    );
    expect(new Set(plan.ledger.map((row) => row.id)).size).toBe(
      plan.ledger.length,
    );
  });

  it('keeps grades, histories and due dates in valid ranges', () => {
    const plan = buildPlan({ target: '10k', users: 25 });
    for (const row of plan.progress) {
      expect(row.quality_history).toEqual(expect.any(Array));
      for (const grade of row.quality_history) {
        expect(Number.isInteger(grade)).toBe(true);
        expect(grade).toBeGreaterThanOrEqual(1);
        expect(grade).toBeLessThanOrEqual(4);
      }
      expect(row.repetition_count).toBe(row.quality_history.length);
      expect(row.ease_factor).toBeGreaterThanOrEqual(1.3);
      expect(row.last_review_date.getTime()).toBeLessThanOrEqual(
        BENCH_EPOCH_MS,
      );
      expect(Number.isFinite(row.next_review_date.getTime())).toBe(true);
    }
    for (const event of plan.events) {
      expect(event.result.grade).toBeGreaterThanOrEqual(1);
      expect(event.result.grade).toBeLessThanOrEqual(4);
      expect(event.result.response).toEqual(expect.any(Object));
    }
  });
});
