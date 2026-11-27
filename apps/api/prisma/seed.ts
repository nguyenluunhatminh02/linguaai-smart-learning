/**
 * Database seeder
 *
 * Runs via `pnpm db:seed` (see apps/api/package.json). Idempotent: re-running
 * the script will not create duplicate decks/cards/quizzes/badges/content.
 *
 * Strategy
 * --------
 * 1. Ensure the three default roles exist (ADMIN, USER, MODERATOR).
 * 2. Ensure a single "system curator" user owns every public deck.
 * 3. Upsert public decks and their cards by stable catalogue keys.
 * 4. For each quiz: upsert by (creator_id, title), then match questions by
 *    prompt so their IDs stay stable across curriculum updates.
 * 5. Upsert badges by name and content_items by (type, title, level).
 *
 * The script is purposely chatty — each phase logs how many rows were touched
 * so you can see at a glance what changed.
 */

import { PrismaClient, roles_name_enum } from '../src/generated/prisma';
import * as bcrypt from 'bcrypt';
import * as dotenv from 'dotenv';
import * as path from 'path';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';

// Resolve .env relative to this file's location (prisma/seed.ts -> repo root)
// so the path is correct regardless of the script's working directory.
const repoRoot = path.resolve(__dirname, '..', '..');
dotenv.config({ path: path.join(repoRoot, '.env') });
dotenv.config({ path: path.join(__dirname, '..', '.env') });

if (!process.env.DATABASE_URL && !process.env.DATABASE_HOST) {
  console.warn('⚠ No DATABASE_URL or DATABASE_HOST found — falling back to hardcoded defaults.');
}

import { DECK_CATALOG, SeedDeck } from './seed/decks.data';
import { QUIZ_CATALOG, SeedQuiz } from './seed/quizzes.data';
import { BADGE_CATALOG } from './seed/badges.data';
import { CONTENT_CATALOG } from './seed/content.data';

const host = process.env.DATABASE_HOST || 'localhost';
const port = process.env.DATABASE_PORT || 5432;
const username = process.env.DATABASE_USER || 'linguaai';
const password = process.env.DATABASE_PASSWORD || 'linguaai_secret';
const database = process.env.DATABASE_NAME || 'linguaai';
const ssl = process.env.DATABASE_SSL === 'true';

const url =
  process.env.DATABASE_URL ||
  `postgresql://${username}:${encodeURIComponent(password)}@${host}:${port}/${database}?schema=public${
    ssl ? '&sslmode=require' : ''
  }`;

const pool = new Pool({ connectionString: url });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

const CURATOR_EMAIL = process.env.SEED_CURATOR_EMAIL ?? 'seed-curator@linguaai.local';
const CURATOR_PASSWORD = process.env.SEED_CURATOR_PASSWORD ?? 'SeedCurator!2024';
const CURATOR_FIRST_NAME = 'LinguaAI';
const CURATOR_LAST_NAME = 'Curator';

// ─── Roles ────────────────────────────────────────────────────────────────────

async function ensureRoles(): Promise<void> {
  const names = Object.values(roles_name_enum);
  for (const name of names) {
    await prisma.roles.upsert({
      where: { name },
      update: {},
      create: { name },
    });
  }
  console.log(`✔ roles ensured (${names.length})`);
}

// ─── Curator user ────────────────────────────────────────────────────────────

async function ensureCurator(): Promise<string> {
  const existing = await prisma.users.findUnique({ where: { email: CURATOR_EMAIL } });
  if (existing) {
    console.log(`✔ curator already exists: ${CURATOR_EMAIL}`);
    return existing.id;
  }

  const passwordHash = await bcrypt.hash(CURATOR_PASSWORD, 10);
  const adminRole = await prisma.roles.findUnique({ where: { name: roles_name_enum.ADMIN } });
  if (!adminRole) throw new Error('ADMIN role missing — ensureRoles() must run first');

  const user = await prisma.users.create({
    data: {
      email: CURATOR_EMAIL,
      password: passwordHash,
      first_name: CURATOR_FIRST_NAME,
      last_name: CURATOR_LAST_NAME,
      email_verified: true,
      email_verified_at: new Date(),
      is_active: true,
      preferred_language: 'english',
      user_roles: {
        create: { roles_id: adminRole.id },
      },
    },
  });

  console.log(`✔ curator created: ${CURATOR_EMAIL}`);
  return user.id;
}

// ─── Decks + cards ───────────────────────────────────────────────────────────

async function seedDeck(curatorId: string, deck: SeedDeck): Promise<{ created: boolean }> {
  return prisma.$transaction(async (tx) => {
    // Serialize simultaneous catalogue updates, including the first import.
    await tx.$queryRaw`SELECT id FROM users WHERE id = ${curatorId}::uuid FOR UPDATE`;
    let row = await tx.decks.findFirst({
      where: { creator_id: curatorId, title: deck.title },
    });

    let created = false;
    if (!row) {
      row = await tx.decks.create({
        data: {
          title: deck.title,
          description: deck.description,
          language: deck.language,
          level: deck.level,
          is_public: true,
          creator_id: curatorId,
        },
      });
      created = true;
    } else {
      // Refresh metadata in case the catalogue was edited.
      await tx.decks.update({
        where: { id: row.id },
        data: {
          description: deck.description,
          language: deck.language,
          level: deck.level,
          is_public: true,
        },
      });
    }

    const deckId = row.id;
    const existingCards = await tx.cards.findMany({ where: { deck_id: deckId }, orderBy: { created_at: 'asc' } });
    const keyedCards = new Map(existingCards.filter((card) => card.seed_key !== null).map((card) => [card.seed_key, card]));
    const matchedKeys = new Set<string>();
    for (const card of deck.cards) {
      const key = card.key ?? card.front;
      if (matchedKeys.has(key)) throw new Error(`Duplicate seed card key in ${deck.title}: ${key}`);
      matchedKeys.add(key);
      // Older installations already have cards but no seed key. Adopt an exact legacy prompt.
      const previous = keyedCards.get(key) ?? existingCards.find(
        (item) => item.seed_key === null && (item.front_text === key || item.front_text === card.front),
      );
      const data = {
        front_text: card.front,
        back_text: card.back,
        ipa_pronunciation: card.ipa ?? null,
        example_sentence: card.example ?? null,
        seed_key: key,
        retired_at: null,
      };
      if (previous) {
        await tx.cards.update({ where: { id: previous.id }, data });
        previous.seed_key = key;
      } else {
        await tx.cards.create({ data: { deck_id: deckId, ...data } });
      }
    }
    const retiredIds = existingCards.filter(
      (card) => card.seed_key !== null && card.retired_at === null && !matchedKeys.has(card.seed_key),
    ).map((card) => card.id);
    if (retiredIds.length > 0) {
      await tx.cards.updateMany({
        where: { id: { in: retiredIds } },
        data: { retired_at: new Date() },
      });
    }
    const cardCount = await tx.cards.count({ where: { deck_id: deckId, retired_at: null } });
    await tx.decks.update({ where: { id: deckId }, data: { card_count: cardCount } });

    return { created };
  });
}

async function seedAllDecks(curatorId: string): Promise<void> {
  let created = 0;
  let updated = 0;
  let totalCards = 0;
  for (const deck of DECK_CATALOG) {
    const { created: wasCreated } = await seedDeck(curatorId, deck);
    if (wasCreated) created += 1;
    else updated += 1;
    totalCards += deck.cards.length;
  }
  console.log(
    `✔ decks: ${created} created, ${updated} updated, ${totalCards} cards across ${DECK_CATALOG.length} decks`,
  );
}

// ─── Quizzes ──────────────────────────────────────────────────────────────────

async function seedQuiz(curatorId: string, quiz: SeedQuiz): Promise<'created' | 'updated' | 'skipped'> {
  const deck = await prisma.decks.findFirst({
    where: { creator_id: curatorId, title: quiz.deckTitle },
  });
  if (!deck) {
    console.warn(`  ⚠ quiz "${quiz.title}" skipped — deck "${quiz.deckTitle}" not found`);
    return 'skipped';
  }

  return prisma.$transaction(async (tx) => {
    let row = await tx.quizzes.findFirst({
      where: { creator_id: curatorId, title: quiz.title },
    });

    let outcome: 'created' | 'updated' = 'updated';
    if (!row) {
      row = await tx.quizzes.create({
        data: {
          title: quiz.title,
          description: quiz.description,
          deck_id: deck.id,
          language: deck.language,
          creator_id: curatorId,
          time_limit_minutes: quiz.time_limit_minutes,
        },
      });
      outcome = 'created';
    } else {
      await tx.quizzes.update({
        where: { id: row.id },
        data: {
          description: quiz.description,
          deck_id: deck.id,
          language: deck.language,
          time_limit_minutes: quiz.time_limit_minutes,
        },
      });
    }

    const existingQuestions = await tx.quiz_questions.findMany({
      where: { quiz_id: row.id },
      orderBy: { created_at: 'asc' },
      select: { id: true, question_text: true },
    });
    const used = new Set<string>();
    for (const [index, q] of quiz.questions.entries()) {
      const prompt = q.question_text.trim();
      const matched = existingQuestions.find((item) => !used.has(item.id) && item.question_text.trim() === prompt)
        ?? existingQuestions.find((item) => !used.has(item.id) && index < existingQuestions.length && existingQuestions[index].id === item.id);
      const data = {
        question_text: q.question_text,
        question_type: q.question_type,
        options: q.options ? (q.options as unknown as object) : undefined,
        correct_answer: q.correct_answer,
        explanation: q.explanation ?? '',
        difficulty: q.difficulty,
      };
      if (matched) {
        used.add(matched.id);
        await tx.quiz_questions.update({ where: { id: matched.id }, data });
      } else {
        await tx.quiz_questions.create({ data: { quiz_id: row!.id, ...data } });
      }
    }
    const removedIds = existingQuestions.filter((item) => !used.has(item.id)).map((item) => item.id);
    if (removedIds.length > 0) {
      await tx.quiz_questions.deleteMany({ where: { id: { in: removedIds } } });
    }

    return outcome;
  });
}

async function seedAllQuizzes(curatorId: string): Promise<void> {
  let created = 0;
  let updated = 0;
  let skipped = 0;
  for (const quiz of QUIZ_CATALOG) {
    const outcome = await seedQuiz(curatorId, quiz);
    if (outcome === 'created') created += 1;
    else if (outcome === 'updated') updated += 1;
    else skipped += 1;
  }
  console.log(`✔ quizzes: ${created} created, ${updated} updated, ${skipped} skipped`);
}

// ─── Badges ──────────────────────────────────────────────────────────────────

async function seedBadges(): Promise<void> {
  let created = 0;
  let updated = 0;
  for (const badge of BADGE_CATALOG) {
    const existing = await prisma.badges.findFirst({ where: { name: badge.name } });
    if (existing) {
      await prisma.badges.update({
        where: { id: existing.id },
        data: {
          description: badge.description,
          condition: badge.condition as unknown as object,
        },
      });
      updated += 1;
    } else {
      await prisma.badges.create({
        data: {
          name: badge.name,
          description: badge.description,
          condition: badge.condition as unknown as object,
        },
      });
      created += 1;
    }
  }
  console.log(`✔ badges: ${created} created, ${updated} updated`);
}

// ─── CMS content_items ───────────────────────────────────────────────────────

async function seedContent(): Promise<void> {
  let created = 0;
  let updated = 0;
  const seenKeys = new Set<string>();
  for (const item of CONTENT_CATALOG) {
    // Match on (type, title, level) so the same title at different levels
    // does not clobber one another — the web app filters lessons by level.
    const existing = await prisma.content_items.findFirst({
      where: { type: item.type, title: item.title, level: item.level },
    });
    const catalogKey = `${item.type}|${item.level}|${item.title}`;
    if (seenKeys.has(catalogKey)) {
      console.warn(`  ⚠ duplicate content catalog entry skipped: ${catalogKey}`);
      continue;
    }
    seenKeys.add(catalogKey);

    const data = {
      type: item.type,
      title: item.title,
      title_vi: item.title_vi,
      level: item.level,
      category: item.category,
      content: item.content,
      data: (item.data ?? {}) as unknown as object,
      questions: item.questions as unknown as object,
      audio_url: item.audio_url ?? '',
      duration: item.duration,
      word_count: item.word_count,
      published: true,
      sort_order: item.sort_order,
      updated_at: new Date(),
    };

    if (existing) {
      await prisma.content_items.update({ where: { id: existing.id }, data });
      updated += 1;
    } else {
      await prisma.content_items.create({ data });
      created += 1;
    }
  }
  console.log(`✔ content_items: ${created} created, ${updated} updated`);
}

// ─── Orchestrator ─────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  console.log('🌱 LinguaAI seed starting…');
  console.log(`   curator: ${CURATOR_EMAIL}`);

  await ensureRoles();
  const curatorId = await ensureCurator();
  await seedAllDecks(curatorId);
  await seedAllQuizzes(curatorId);
  await seedBadges();
  await seedContent();

  console.log('✅ seed completed');
}

main()
  .catch((err) => {
    console.error('❌ seed failed', err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
    await pool.end();
  });
