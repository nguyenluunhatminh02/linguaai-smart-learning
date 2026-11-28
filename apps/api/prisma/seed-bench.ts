/**
 * Opt-in benchmark fixture writer (DB-04 / PERF-01).
 *
 * NOT imported by `prisma/seed.ts` and NOT reachable through `pnpm db:seed`.
 * Run explicitly with `pnpm db:seed:bench -- --confirm --target=10k`. This
 * script only seeds data; measuring and reporting remain a separate step.
 *
 * Safety gates (all must pass before any write):
 *   1. main() runs only when this file is the script entry point.
 *   2. `--confirm` is required.
 *   3. NODE_ENV=production additionally requires `--allow-production`.
 *   4. `--dry-run` builds the plan and logs it but performs zero writes.
 *
 * Re-runs are idempotent: every primary key is uuid v5 derived from the
 * explicit seed, so `upsert`/`createMany(skipDuplicates)` writes the same rows
 * instead of duplicating them.
 *
 * This module imports database drivers, but does not construct a pool or
 * client at import time. Importing it in tests has no side effects beyond
 * module evaluation.
 */

import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';
import { v5 as uuidv5 } from 'uuid';
import { PrismaClient, roles_name_enum } from '../src/generated/prisma';

import {
  BENCH_TARGETS,
  BenchBuildOptions,
  BenchCardRef,
  BenchPlan,
  buildPlan,
  summarizePlan,
} from './seed/bench.data';
import { DECK_CATALOG } from './seed/decks.data';

/** Namespace for all deterministic benchmark UUIDs. */
const BENCH_UUID_NAMESPACE = '3f4a1b7c-6d92-4e18-9b05-7a2c8d1e0f43';
/** Curator email is read by env variable *name* only; no password is used. */
const CURATOR_EMAIL = process.env.SEED_CURATOR_EMAIL ?? 'seed-curator@linguaai.local';

const BATCH_SIZE = 5_000;
const DEFAULT_SEED = 20260101;
const DEFAULT_USERS = 200;

interface CliArgs {
  target: keyof typeof BENCH_TARGETS;
  seed: number;
  users: number;
  dryRun: boolean;
  confirm: boolean;
  allowProduction: boolean;
}

const USAGE =
  'Usage: db:seed:bench --target=10k|100k|1m --seed=<int> --users=<int> [--dry-run] --confirm [--allow-production]';

export function parseArgs(argv: readonly string[], env: NodeJS.ProcessEnv = process.env): CliArgs {
  const values = new Map<string, string | true>();
  for (const arg of argv) {
    if (!arg.startsWith('--')) throw new Error(`unexpected argument: ${arg}\n${USAGE}`);
    const eq = arg.indexOf('=');
    const key = eq === -1 ? arg.slice(2) : arg.slice(2, eq);
    const value: string | true = eq === -1 ? true : arg.slice(eq + 1);
    if (values.has(key)) throw new Error(`duplicate option: --${key}`);
    values.set(key, value);
  }
  for (const key of values.keys()) {
    if (!['target', 'seed', 'users', 'dry-run', 'confirm', 'allow-production'].includes(key)) {
      throw new Error(`unknown option: --${key}\n${USAGE}`);
    }
  }

  const targetArg = values.get('target');
  if (typeof targetArg !== 'string' || !(targetArg in BENCH_TARGETS)) {
    throw new Error(`--target must be one of ${Object.keys(BENCH_TARGETS).join(', ')}\n${USAGE}`);
  }
  const parsePositiveInt = (key: string, fallback: number): number => {
    const raw = values.get(key);
    if (raw === undefined) return fallback;
    if (typeof raw !== 'string' || !/^\d+$/.test(raw) || Number(raw) < 1) {
      throw new Error(`--${key} must be a positive integer`);
    }
    return Number(raw);
  };

  return {
    target: targetArg as CliArgs['target'],
    seed: parsePositiveInt('seed', DEFAULT_SEED),
    users: parsePositiveInt('users', DEFAULT_USERS),
    dryRun: values.get('dry-run') === true,
    confirm: values.get('confirm') === true,
    allowProduction:
      values.get('allow-production') === true || env.BENCH_SEED_ALLOW_PRODUCTION === 'true',
  };
}

/** Production may only be seeded with an explicit second confirmation. */
export function isProductionGateBlocked(
  env: NodeJS.ProcessEnv,
  args: Pick<CliArgs, 'allowProduction'>,
): boolean {
  return env.NODE_ENV === 'production' && !args.allowProduction;
}

const id = (kind: string, index: number): string =>
  uuidv5(`${kind}:${index}`, BENCH_UUID_NAMESPACE);

/** Load active, non-retired cards from public decks in the requested languages. */
async function loadCatalogueCards(
  prisma: PrismaClient,
  languages: readonly string[],
): Promise<BenchCardRef[]> {
  const curator = await prisma.users.findUnique({ where: { email: CURATOR_EMAIL } });
  if (!curator) {
    throw new Error(
      `Benchmark precondition failed: curator user ${CURATOR_EMAIL} not found. Run db:seed first.`,
    );
  }
  const decks = await prisma.decks.findMany({
    where: { is_public: true, creator_id: curator.id, language: { in: [...languages] } },
    select: { id: true, language: true },
    orderBy: { title: 'asc' },
  });
  if (!decks.length) {
    throw new Error(
      'Benchmark precondition failed: no public decks for the requested languages. Run db:seed first.',
    );
  }
  const cards = await prisma.cards.findMany({
    where: { deck_id: { in: decks.map((deck) => deck.id) }, retired_at: null },
    select: { id: true, deck_id: true },
    orderBy: { created_at: 'asc' },
  });
  if (!cards.length) {
    throw new Error(
      'Benchmark precondition failed: no active cards in public decks. Run db:seed first.',
    );
  }
  const languageByDeck = new Map(decks.map((deck) => [deck.id, deck.language]));
  return cards.map((card, index) => ({
    card_id: card.id,
    seed_key: `catalogue|${languageByDeck.get(card.deck_id) ?? 'unknown'}|${index}`,
    language: languageByDeck.get(card.deck_id) ?? 'english',
  }));
}

/**
 * Replace planner placeholders with real catalogue card IDs. Users and rows
 * are bound to v5 IDs in one pass each, so 1M-row plans stay linear.
 */
function bindRealIds(plan: BenchPlan, catalogue: BenchCardRef[]): void {
  const originalCards = [...plan.cards];
  const cardRemap = new Map<string, string>();
  plan.cards = originalCards.map((card, index) => {
    const real = catalogue[index % catalogue.length];
    cardRemap.set(card.card_id, real.card_id);
    return { ...real };
  });

  const userRemap = new Map<string, string>();
  plan.users.forEach((user, index) => userRemap.set(user.id, id('bench-user', index)));
  plan.users = plan.users.map((user, index) => ({ ...user, id: id('bench-user', index) }));

  // Card remaps must be applied against the ORIGINAL card list to avoid
  // cascading replacements when a catalogue ID equals another placeholder.
  for (const row of plan.progress) {
    const real = cardRemap.get(row.card_id);
    if (real) row.card_id = real;
    const user = userRemap.get(row.user_id);
    if (user) row.user_id = user;
  }
  for (const row of plan.events) {
    const real = cardRemap.get(row.card_id);
    if (real) {
      row.card_id = real;
      row.result.response.cardId = real;
    }
    const user = userRemap.get(row.user_id);
    if (user) row.user_id = user;
  }
  for (const row of plan.ledger) {
    const user = userRemap.get(row.user_id);
    if (user) row.user_id = user;
  }
  for (const row of plan.balances) {
    const user = userRemap.get(row.user_id);
    if (user) row.user_id = user;
  }
}

async function writeBatches<T>(
  label: string,
  rows: readonly T[],
  write: (batch: T[]) => Promise<void>,
): Promise<void> {
  for (let offset = 0; offset < rows.length; offset += BATCH_SIZE) {
    await write(rows.slice(offset, offset + BATCH_SIZE) as T[]);
    const done = Math.min(rows.length, offset + BATCH_SIZE);
    console.log(`  ${label}: ${done}/${rows.length}`);
  }
}

async function loadRolesAndBaseline(prisma: PrismaClient): Promise<void> {
  const requiredRoles = Object.values(roles_name_enum);
  const existingRoles = await prisma.roles.findMany({
    where: { name: { in: [...requiredRoles] } },
    select: { name: true },
  });
  if (existingRoles.length !== requiredRoles.length) {
    throw new Error('Benchmark precondition failed: default roles missing. Run db:seed first.');
  }
}

/** Seed the fixture. Exported so tests can import without side effects. */
export async function runBenchSeed(args: CliArgs): Promise<void> {
  if (!args.confirm) throw new Error('Confirmation required: pass --confirm');
  if (isProductionGateBlocked(process.env, args)) {
    throw new Error('Refusing to seed benchmark data in production without --allow-production');
  }

  const options: BenchBuildOptions = {
    target: args.target,
    seed: args.seed,
    users: args.users,
  };
  const plan = buildPlan(options);
  const summary = summarizePlan(plan);
  console.log('benchmark plan', JSON.stringify(summary));
  if (args.dryRun) {
    console.log('dry-run: no writes performed');
    return;
  }

  // Only environment variable NAMES are referenced; no .env is parsed and no
  // credential value is logged. TLS verification is never disabled.
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL || undefined,
    host: process.env.DATABASE_HOST || 'localhost',
    port: Number(process.env.DATABASE_PORT || 5432),
    user: process.env.DATABASE_USER || 'linguaai',
    password: process.env.DATABASE_PASSWORD || 'linguaai_secret',
    database: process.env.DATABASE_NAME || 'linguaai',
    ssl: process.env.DATABASE_SSL === 'true',
  });
  const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });

  try {
    await loadRolesAndBaseline(prisma);
    const catalogue = await loadCatalogueCards(prisma, plan.cards.map((card) => card.language));
    bindRealIds(plan, catalogue);

    await writeBatches('users', plan.users, async (batch) => {
      await prisma.users.createMany({ data: batch, skipDuplicates: true });
    });
    await writeBatches('progress', plan.progress, async (batch) => {
      await prisma.user_card_progress.createMany({ data: batch, skipDuplicates: true });
    });
    await writeBatches('events', plan.events, async (batch) => {
      await prisma.srs_review_events.createMany({ data: batch, skipDuplicates: true });
    });
    await writeBatches('ledger', plan.ledger, async (batch) => {
      await prisma.token_transactions.createMany({ data: batch, skipDuplicates: true });
    });
    await writeBatches('balances', plan.balances, async (batch) => {
      await prisma.user_token_balance.createMany({ data: batch, skipDuplicates: true });
    });

    console.log('✅ benchmark fixture seeded', JSON.stringify(summary));
  } finally {
    await prisma.$disconnect();
    await pool.end();
  }
}

/** Entry point guard: importing this file never runs the seeder. */
export function isMainModule(
  moduleFilename: string,
  entryFilename: string | undefined,
): boolean {
  if (!entryFilename) return false;
  return moduleFilename === entryFilename;
}

if (isMainModule(__filename, require.main?.filename)) {
  runBenchSeed(parseArgs(process.argv.slice(2))).catch((error: unknown) => {
    console.error('benchmark seed failed:', error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}

void DECK_CATALOG;
