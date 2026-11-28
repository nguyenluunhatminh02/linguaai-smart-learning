import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '../generated/prisma';
import { PrismaService } from '../prisma/prisma.service';

/**
 * PRODUCT-04 daily plan generation.
 *
 * The service deliberately depends only on PrismaService: DTO classes, the
 * raw-SQL migration, module registration and controllers are separate slices.
 * All request-facing shapes are declared here so this file compiles on its
 * own and can be wired once those neighbours land.
 */

export const DAILY_PLAN_VERSION = '1';
export const DEFAULT_TIME_BUDGET_MINUTES = 30;
export const MAX_TIME_BUDGET_MINUTES = 240;
export const DEFAULT_ITEM_MINUTES = 10;
const MAX_DUE_CARDS = 200;
const MAX_CANDIDATES = 200;
const MAX_REASON_LENGTH = 500;
const MAX_TIMEZONE_LENGTH = 50;
const SUPPORTED_LANGUAGES = [
  'english',
  'chinese',
  'japanese',
  'korean',
  'french',
  'spanish',
  'german',
  'vietnamese',
] as const;
const DONE_ITEM_STATUSES = new Set(['COMPLETED', 'SKIPPED']);
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export interface GetDailyPlanQueryDto {
  /** Explicit local day (YYYY-MM-DD). Skips timezone resolution when supplied. */
  date?: string;
  /** IANA timezone used to derive the local day; invalid values fall back to UTC. */
  timezone?: string;
  /** Hard cap in minutes; overrides the learner preference when supplied. */
  timeBudgetMinutes?: number | string;
  /** Curated-content language filter. Defaults to the learner's target language. */
  language?: string;
  /** Curated-content CEFR level filter (A1..C2). */
  level?: string;
}

export interface RefreshDailyPlanDto extends GetDailyPlanQueryDto {}

export interface DailyPlanResult {
  id: string;
  userId: string;
  date: string;
  timezone: string;
  version: number;
  status: string;
  timeBudgetMinutes: number;
  generatedAt: string;
  updatedAt: string;
  reused?: boolean;
  items: Array<{
    id: string | null;
    position: number;
    source: string;
    activityType: string;
    activityId: string;
    contentVersion: string;
    estimatedMinutes: number;
    reason: string;
    status: string;
    knowledgeTags: string[];
  }>;
}

interface LearnerRow {
  id: string;
  target_language: string | null;
  preferred_language: string | null;
  learning_level: string | null;
  daily_study_minutes: number | bigint | string | null;
  daily_goal: number | bigint | string | null;
  timezone: string | null;
}

interface DueCardRow {
  card_id: string;
  deck_id: string;
  deck_title: string | null;
  front_text: string | null;
  language: string | null;
  level: string | null;
  next_review_date: Date | string;
  ease_factor: number | string | null;
  difficulty: number | string | null;
}

interface WeakSkillRow {
  language: string;
  skill: string;
  cefr_estimate: string;
  confidence: number | string;
  evidence_count: number | bigint | string;
}

interface CompletionRow {
  activity_type: string;
  activity_id: string;
  language: string;
  completed_at: Date | string;
}

interface ContentRow {
  id: string;
  type: string;
  title: string;
  category: string | null;
  level: string | null;
  duration: string | null;
  sort_order: number | bigint | string | null;
}

interface StoredPlanRow {
  id: string;
  user_id: string;
  day: Date | string;
  version: number | bigint | string;
  timezone: string;
  status: string;
  generated_at: Date | string;
  updated_at: Date | string;
}

interface StoredItemRow {
  id: string;
  order_index: number | bigint | string;
  activity_type: string;
  activity_id: string;
  estimated_minutes: number | bigint | string;
  reason: string | null;
  status: string;
  knowledge_tags: Prisma.JsonValue | string | null;
}

interface PlanCandidate {
  source: 'srs' | 'curated';
  activityType: string;
  activityId: string;
  contentVersion: string;
  estimatedMinutes: number;
  reason: string;
  knowledgeTags: string[];
  /** Sort metadata; never persisted. */
  tier: number;
  priority: number;
  skill: string;
}

/** Stable key: one planned activity per source/type/id/version. */
export function dailyPlanItemKey(item: {
  source: string;
  activityType: string;
  activityId: string;
  contentVersion?: string;
}): string {
  return [
    item.source,
    item.activityType,
    item.activityId,
    item.contentVersion ?? '1',
  ].join('|');
}

function asNumber(value: unknown, fallback = 0): number {
  const parsed = typeof value === 'bigint' ? Number(value) : Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function boundedInt(
  value: number | bigint | string | undefined | null,
  fallback: number,
  min: number,
  max: number,
): number {
  if (value === undefined || value === null || value === '') return fallback;
  const parsed = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, Math.trunc(parsed)));
}

function normalizeLabel(value: unknown): string {
  return typeof value === 'string' ? value.trim().toLowerCase() : '';
}

function normalizeDate(value: unknown): string | null {
  if (typeof value !== 'string' || !DATE_PATTERN.test(value)) return null;
  const date = new Date(`${value}T00:00:00.000Z`);
  if (!Number.isFinite(date.getTime())) return null;
  return date.toISOString().slice(0, 10) === value ? value : null;
}

/** Invalid timezones never change the day key: UTC is the explicit fallback. */
function normalizeTimezone(value: unknown): string {
  if (typeof value !== 'string' || !value.trim()) return 'UTC';
  const trimmed = value.trim().slice(0, MAX_TIMEZONE_LENGTH);
  try {
    new Intl.DateTimeFormat('en-CA', { timeZone: trimmed });
    return trimmed;
  } catch {
    return 'UTC';
  }
}

function localDateKey(now: Date, timezone: string): string {
  if (timezone === 'UTC') return now.toISOString().slice(0, 10);
  // en-CA formats as YYYY-MM-DD; hourCycle h23 keeps midnight on the same day.
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(now);
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((p) => p.type === type)?.value ?? '';
  const date = `${part('year')}-${part('month')}-${part('day')}`;
  return normalizeDate(date) ?? now.toISOString().slice(0, 10);
}

function isoDate(value: Date | string): string {
  const date = value instanceof Date ? value : new Date(value);
  return Number.isFinite(date.getTime())
    ? date.toISOString().slice(0, 10)
    : '';
}

function iso(value: Date | string): string {
  const date = value instanceof Date ? value : new Date(value);
  return Number.isFinite(date.getTime())
    ? date.toISOString()
    : new Date(0).toISOString();
}

/** Parse "10 min", "1h 20m", "45" into whole minutes with a sane default. */
function durationMinutes(value: unknown): number {
  if (typeof value !== 'string') return DEFAULT_ITEM_MINUTES;
  const text = value.toLowerCase();
  const hours = /(?:^|\s)(\d+(?:\.\d+)?)\s*(?:h|hr|hrs|hour|hours)/.exec(text);
  const minutes = /(?:^|\s)(\d+(?:\.\d+)?)\s*(?:m|min|mins|minute|minutes)/.exec(
    text,
  );
  let total = 0;
  if (hours) total += Number(hours[1]) * 60;
  if (minutes) total += Number(minutes[1]);
  if (!hours && !minutes) {
    const plain = Number(text.trim());
    if (Number.isFinite(plain)) total = plain;
  }
  return Math.min(
    MAX_TIME_BUDGET_MINUTES,
    Math.max(1, Math.round(total || DEFAULT_ITEM_MINUTES)),
  );
}

function knowledgeTagsForSkill(skill: string, level: string): string[] {
  const normalized = skill.toLowerCase().replace(/[^a-z]/g, '') || 'general';
  return [`en.${normalized}.${level.toLowerCase()}`];
}

function reasonForWeakSkill(skill: string, estimate: string): string {
  return `Weak ${skill} evidence (${estimate}): reinforce before harder work`;
}

/**
 * Pure candidate selection: due SRS reviews first, then curated activities
 * aligned with weak skills and recent completions. Deterministic tie-breaks
 * and per-skill/per-type diversity caps make the same inputs produce the same
 * ordered plan without any database or AI call.
 */
export function rankDailyPlanCandidates(
  input: {
    dueCards: Array<{
      cardId: string;
      deckId: string;
      frontText: string;
      language: string;
      level: string;
      nextReviewDate: string;
      easeFactor: number;
      difficulty: number;
    }>;
    weakSkills: Array<{
      language: string;
      skill: string;
      cefrEstimate: string;
      confidence: number;
      evidenceCount: number;
    }>;
    completions: Array<{
      activityType: string;
      activityId: string;
      language: string;
      completedAt: string;
    }>;
    content: Array<{
      id: string;
      type: string;
      title: string;
      category: string;
      level: string;
      duration: string;
      sortOrder: number;
    }>;
    language: string;
    level: string;
    timeBudgetMinutes: number;
    now?: string;
  },
  maxItems = 12,
): PlanCandidate[] {
  const now = input.now ? Date.parse(input.now) : Date.now();
  const language = normalizeLabel(input.language) || 'english';
  const level = String(input.level || 'A1').trim().toUpperCase() || 'A1';
  const budget = Math.min(
    MAX_TIME_BUDGET_MINUTES,
    Math.max(1, Math.trunc(input.timeBudgetMinutes || DEFAULT_TIME_BUDGET_MINUTES)),
  );
  const completedKeys = new Set(
    input.completions.map((c) =>
      dailyPlanItemKey({
        source: 'curated',
        activityType: c.activityType,
        activityId: c.activityId,
      }),
    ),
  );
  const candidates: PlanCandidate[] = [];

  // Tier 0: SRS due cards. Overdue cards and lower retrievability rank first;
  // activity id is the final deterministic tie-break.
  for (const card of input.dueCards) {
    const dueAt = Date.parse(card.nextReviewDate);
    const overdueDays = Number.isFinite(dueAt)
      ? Math.max(0, (now - dueAt) / 86_400_000)
      : 0;
    const difficulty = Number.isFinite(card.difficulty) ? card.difficulty : 5;
    const easeFactor = Number.isFinite(card.easeFactor)
      ? card.easeFactor
      : 2.5;
    candidates.push({
      source: 'srs',
      activityType: 'review',
      activityId: card.cardId,
      contentVersion: '1',
      estimatedMinutes: DEFAULT_ITEM_MINUTES,
      reason: `Due SRS review: ${card.frontText || 'card'} (${Math.round(overdueDays)}d overdue)`,
      knowledgeTags: [`${language}.vocab.${level}`, card.deckId],
      tier: 0,
      priority: Math.round(overdueDays * 100 + difficulty * 10 - easeFactor),
      skill: 'vocabulary',
    });
  }

  // Weak knowledge proxy: skill_proficiency rows plus recent completions.
  // Recent completion of the same activity is a negative signal (already seen).
  const weakBySkill = new Map<string, (typeof input.weakSkills)[number]>();
  for (const skill of input.weakSkills) {
    if (normalizeLabel(skill.language) !== language) continue;
    const key = normalizeLabel(skill.skill);
    const current = weakBySkill.get(key);
    if (
      !current ||
      asNumber(skill.evidenceCount) < asNumber(current.evidenceCount) ||
      asNumber(skill.confidence) < asNumber(current.confidence)
    ) {
      weakBySkill.set(key, skill);
    }
  }
  for (const completion of input.completions) {
    if (normalizeLabel(completion.language) !== language) continue;
    const skill = normalizeLabel(completion.activityType);
    if (!weakBySkill.has(skill)) {
      weakBySkill.set(skill, {
        language,
        skill,
        cefrEstimate: level,
        confidence: 0.5,
        evidenceCount: 1,
      });
    }
  }

  const skillHint = (item: (typeof input.content)[number]): string => {
    const haystack = `${item.category} ${item.title}`.toLowerCase();
    for (const skill of weakBySkill.keys()) {
      if (haystack.includes(skill)) return skill;
    }
    return 'vocabulary';
  };

  for (const item of input.content) {
    const contentLevel = String(item.level || 'A1').trim().toUpperCase();
    if (contentLevel && contentLevel !== level) continue;
    const skill = skillHint(item);
    const weak = weakBySkill.get(skill);
    const version = '1';
    // Previously completed content stays eligible but is demoted, so a refresh
    // can surface it again only when nothing else fits the budget.
    const seenBefore = completedKeys.has(
      dailyPlanItemKey({
        source: 'curated',
        activityType: item.type,
        activityId: item.id,
        contentVersion: version,
      }),
    );
    const confidence = weak ? asNumber(weak.confidence, 0.5) : 0.5;
    const evidenceCount = weak ? asNumber(weak.evidenceCount) : 0;
    candidates.push({
      source: 'curated',
      activityType: item.type,
      activityId: item.id,
      contentVersion: version,
      estimatedMinutes: durationMinutes(item.duration),
      reason: weak
        ? reasonForWeakSkill(skill, weak.cefrEstimate || level)
        : `Curated ${item.type} practice for ${level}`,
      knowledgeTags: knowledgeTagsForSkill(skill, contentLevel || level),
      tier: weak && !seenBefore ? 1 : 2,
      priority:
        (weak && !seenBefore ? 1 : 0) * 100 -
        Math.round(confidence * 20) -
        evidenceCount,
      skill,
    });
  }

  candidates.sort(
    (a, b) =>
      a.tier - b.tier ||
      b.priority - a.priority ||
      a.activityId.localeCompare(b.activityId) ||
      a.activityType.localeCompare(b.activityType),
  );

  const selected: PlanCandidate[] = [];
  const seen = new Set<string>();
  const skillCounts = new Map<string, number>();
  const typeCounts = new Map<string, number>();
  let minutesUsed = 0;
  for (const candidate of candidates) {
    if (selected.length >= maxItems) break;
    const key = dailyPlanItemKey(candidate);
    if (seen.has(key)) continue;
    if (minutesUsed + candidate.estimatedMinutes > budget) continue;
    // Diversity: at most 3 items per skill and 4 per activity type before the
    // hard budget is filled. Reviews are exempt so due cards are never hidden.
    if (
      candidate.source !== 'srs' &&
      (skillCounts.get(candidate.skill) ?? 0) >= 3
    )
      continue;
    if (
      candidate.source !== 'srs' &&
      (typeCounts.get(candidate.activityType) ?? 0) >= 4
    )
      continue;
    seen.add(key);
    selected.push(candidate);
    minutesUsed += candidate.estimatedMinutes;
    skillCounts.set(candidate.skill, (skillCounts.get(candidate.skill) ?? 0) + 1);
    typeCounts.set(
      candidate.activityType,
      (typeCounts.get(candidate.activityType) ?? 0) + 1,
    );
  }
  return selected;
}

@Injectable()
export class DailyPlanService {
  constructor(private readonly prisma: PrismaService) {}

  /** GET /learning/daily-plan: read the stored plan, generating it if absent. */
  async getDailyPlan(userId: string, query: GetDailyPlanQueryDto = {}) {
    return this.generate(userId, query);
  }

  /**
   * Idempotent by (user, local day, timezone policy, version). Recomputes the
   * candidate set outside the transaction so no AI or long read holds locks.
   */
  async generate(userId: string, query: GetDailyPlanQueryDto = {}) {
    const input = await this.resolveInput(userId, query);
    const existing = await this.readStoredPlan(userId, input);
    if (existing) return { ...existing, reused: true };

    const candidates = await this.buildCandidates(userId, input);
    const version = Number(DAILY_PLAN_VERSION);
    try {
      return await this.persist(userId, input, version, candidates);
    } catch (error) {
      // Concurrent generator won the unique-key race; read and return it.
      if (!this.isUniqueViolation(error)) throw error;
      const winner = await this.readStoredPlan(userId, input);
      if (!winner) throw error;
      return { ...winner, reused: true };
    }
  }

  /**
   * POST /learning/daily-plan/refresh: recompute reasons/estimates for a new
   * version without deleting or overwriting COMPLETED/SKIPPED items.
   */
  async refresh(userId: string, dto: RefreshDailyPlanDto = {}) {
    const input = await this.resolveInput(userId, dto);
    const version = Number(DAILY_PLAN_VERSION) + 1;
    const candidates = await this.buildCandidates(userId, input);

    try {
      return await this.persist(userId, input, version, candidates, true);
    } catch (error) {
      if (!this.isUniqueViolation(error)) throw error;
      const winner = await this.readStoredPlan(userId, input, version);
      if (!winner) throw error;
      return winner;
    }
  }

  private async resolveInput(
    userId: string,
    query: GetDailyPlanQueryDto,
  ) {
    const rows = await this.prisma.$queryRaw<LearnerRow[]>`
      SELECT id, target_language, preferred_language, learning_level,
             daily_study_minutes, daily_goal, timezone
      FROM users
      WHERE id = ${userId}::uuid
      LIMIT 1
    `;
    const learner = rows[0];
    if (!learner) throw new NotFoundException('User not found');

    const timezone = normalizeTimezone(query.timezone ?? learner.timezone);
    const explicitDate = normalizeDate(query.date);
    if (query.date !== undefined && explicitDate === null) {
      throw new BadRequestException('date must be a valid YYYY-MM-DD date');
    }
    const date = explicitDate ?? localDateKey(new Date(), timezone);
    const language =
      normalizeLabel(query.language) ||
      normalizeLabel(learner.target_language) ||
      normalizeLabel(learner.preferred_language) ||
      'english';
    if (
      !SUPPORTED_LANGUAGES.includes(
        language as (typeof SUPPORTED_LANGUAGES)[number],
      )
    ) {
      throw new BadRequestException(`Unsupported daily-plan language: ${language}`);
    }
    const level =
      typeof query.level === 'string' && query.level.trim()
        ? query.level.trim().toUpperCase()
        : String(learner.learning_level ?? 'A1').trim().toUpperCase() || 'A1';
    const timeBudgetMinutes = boundedInt(
      query.timeBudgetMinutes ?? learner.daily_study_minutes,
      DEFAULT_TIME_BUDGET_MINUTES,
      1,
      MAX_TIME_BUDGET_MINUTES,
    );
    return {
      date,
      timezone,
      language,
      level,
      timeBudgetMinutes,
      dailyGoal: boundedInt(learner.daily_goal, 20, 1, 1000),
    };
  }

  private async buildCandidates(
    userId: string,
    input: Awaited<ReturnType<DailyPlanService['resolveInput']>>,
  ): Promise<PlanCandidate[]> {
    // Visibility guard mirrors SrsService.getDueCards: retired cards and decks
    // the learner cannot see must never enter a daily plan.
    const dueRows = await this.prisma.$queryRaw<DueCardRow[]>`
      SELECT p.card_id, c.deck_id, d.title AS deck_title, c.front_text,
             d.language, d.level, p.next_review_date, p.ease_factor, p.difficulty
      FROM user_card_progress p
      JOIN cards c ON c.id = p.card_id
      JOIN decks d ON d.id = c.deck_id
      WHERE p.user_id = ${userId}::uuid
        AND p.next_review_date <= CURRENT_TIMESTAMP
        AND c.retired_at IS NULL
        AND (d.creator_id = ${userId}::uuid OR d.is_public = TRUE)
      ORDER BY p.next_review_date ASC, p.card_id ASC
      LIMIT ${MAX_DUE_CARDS}::int
    `;

    // knowledge_items/mastery tables are optional in this slice; use the
    // measurable skill_proficiency rows plus recent completions as the weak
    // knowledge proxy (explicit graceful-degradation baseline: no AI call).
    const weakRows = await this.prisma.$queryRaw<WeakSkillRow[]>`
      SELECT language, skill, cefr_estimate, confidence, evidence_count
      FROM skill_proficiency
      WHERE user_id = ${userId}::uuid
        AND language = ${input.language}
      ORDER BY confidence ASC, evidence_count ASC, skill ASC
      LIMIT 20::int
    `.catch(() => [] as WeakSkillRow[]);

    const completionRows = await this.prisma.$queryRaw<CompletionRow[]>`
      SELECT activity_type, activity_id, language, completed_at
      FROM learning_completions
      WHERE user_id = ${userId}::uuid
        AND language = ${input.language}
      ORDER BY completed_at DESC
      LIMIT 20::int
    `;

    // content_items has no language column; accepted content is inferred from
    // the learner's level and the curated category/title language hint.
    const contentRows = await this.prisma.$queryRaw<ContentRow[]>`
      SELECT id, type, title, category, level, duration, sort_order
      FROM content_items
      WHERE published = TRUE
        AND (level = ${input.level})
      ORDER BY sort_order ASC, id ASC
      LIMIT ${MAX_CANDIDATES}::int
    `;

    return rankDailyPlanCandidates(
      {
        dueCards: dueRows.map((row) => ({
          cardId: row.card_id,
          deckId: row.deck_id,
          frontText: row.front_text ?? '',
          language: normalizeLabel(row.language) || input.language,
          level: String(row.level ?? input.level),
          nextReviewDate: iso(row.next_review_date),
          easeFactor: asNumber(row.ease_factor, 2.5),
          difficulty: asNumber(row.difficulty, 5),
        })),
        weakSkills: weakRows.map((row) => ({
          language: normalizeLabel(row.language),
          skill: normalizeLabel(row.skill),
          cefrEstimate: String(row.cefr_estimate),
          confidence: asNumber(row.confidence, 0.5),
          evidenceCount: asNumber(row.evidence_count),
        })),
        completions: completionRows.map((row) => ({
          activityType: normalizeLabel(row.activity_type),
          activityId: row.activity_id,
          language: normalizeLabel(row.language),
          completedAt: iso(row.completed_at),
        })),
        content: contentRows.map((row) => ({
          id: row.id,
          type: normalizeLabel(row.type),
          title: row.title,
          category: row.category ?? '',
          level: String(row.level ?? input.level),
          duration: row.duration ?? '',
          sortOrder: asNumber(row.sort_order),
        })),
        language: input.language,
        level: input.level,
        timeBudgetMinutes: input.timeBudgetMinutes,
      },
      Math.max(1, Math.min(12, input.dailyGoal)),
    );
  }

  private async readStoredPlan(
    userId: string,
    input: Awaited<ReturnType<DailyPlanService['resolveInput']>>,
    version = Number(DAILY_PLAN_VERSION),
  ): Promise<DailyPlanResult | null> {
    const plans = await this.prisma.$queryRaw<StoredPlanRow[]>`
      SELECT id, user_id, day, version, timezone, status, generated_at, updated_at
      FROM daily_plans
      WHERE user_id = ${userId}::uuid
        AND day = ${input.date}::date
        AND timezone = ${input.timezone}
        AND version = ${version}::int
      ORDER BY generated_at DESC, id DESC
      LIMIT 1
    `;
    const plan = plans[0];
    if (!plan) return null;
    const items = await this.prisma.$queryRaw<StoredItemRow[]>`
      SELECT id, order_index, activity_type, activity_id, estimated_minutes,
             reason, status, knowledge_tags
      FROM daily_plan_items
      WHERE plan_id = ${plan.id}::uuid
      ORDER BY order_index ASC
    `;
    return this.toResult(plan, items, input.timeBudgetMinutes);
  }

  private async persist(
    userId: string,
    input: Awaited<ReturnType<DailyPlanService['resolveInput']>>,
    version: number,
    candidates: PlanCandidate[],
    refresh = false,
  ): Promise<DailyPlanResult> {
    return this.prisma.$transaction(async (tx) => {
      // Advisory xact lock keyed by the idempotency identity; concurrent
      // generators serialize, then the unique key is the durable guard.
      const lockKey = `daily-plan:${userId}:${input.date}:${input.timezone}:${version}`;
      await tx.$queryRaw`SELECT 1 FROM pg_advisory_xact_lock(hashtextextended(${lockKey}, 0))`;

      const plans = await tx.$queryRaw<StoredPlanRow[]>`
        SELECT id, user_id, day, version, timezone, status, generated_at, updated_at
        FROM daily_plans
        WHERE user_id = ${userId}::uuid
          AND day = ${input.date}::date
          AND timezone = ${input.timezone}
          AND version = ${version}::int
        ORDER BY generated_at DESC, id DESC
        LIMIT 1
      `;
      let plan = plans[0];
      if (!plan) {
        const inserted = await tx.$queryRaw<StoredPlanRow[]>`
          INSERT INTO daily_plans (user_id, day, version, timezone, status)
          VALUES (${userId}::uuid, ${input.date}::date, ${version}::int,
                  ${input.timezone}, 'ACTIVE')
          ON CONFLICT (user_id, day, version) DO NOTHING
          RETURNING id, user_id, day, version, timezone, status,
                    generated_at, updated_at
        `;
        plan = inserted[0];
        if (!plan) {
          const winner = await tx.$queryRaw<StoredPlanRow[]>`
            SELECT id, user_id, day, version, timezone, status, generated_at, updated_at
            FROM daily_plans
            WHERE user_id = ${userId}::uuid
              AND day = ${input.date}::date
              AND timezone = ${input.timezone}
              AND version = ${version}::int
            ORDER BY generated_at DESC, id DESC
            LIMIT 1
          `;
          if (winner.length === 0)
            throw new Error('Daily plan insert conflicted without a winner');
          plan = winner[0];
        }
      }

      // A new algorithm version is a new plan row. Carry the learner's
      // COMPLETED/SKIPPED decisions over from the previous plan instead of
      // rewriting them in place; the old plan row stays intact.
      const preservedKeys = new Set<string>();
      if (refresh && version > Number(DAILY_PLAN_VERSION)) {
        const previous = await tx.$queryRaw<StoredPlanRow[]>`
          SELECT id, user_id, day, version, timezone, status, generated_at, updated_at
          FROM daily_plans
          WHERE user_id = ${userId}::uuid
            AND day = ${input.date}::date
            AND timezone = ${input.timezone}
            AND version = ${version - 1}::int
          ORDER BY generated_at DESC, id DESC
          LIMIT 1
        `;
        if (previous.length > 0) {
          const done = await tx.$queryRaw<StoredItemRow[]>`
            SELECT id, order_index, activity_type, activity_id,
                   estimated_minutes, reason, status, knowledge_tags
            FROM daily_plan_items
            WHERE plan_id = ${previous[0].id}::uuid
              AND status IN ('COMPLETED', 'SKIPPED')
            ORDER BY order_index ASC
          `;
          for (const item of done) {
            const key = dailyPlanItemKey({
              source: item.activity_type === 'review' ? 'srs' : 'curated',
              activityType: item.activity_type,
              activityId: item.activity_id,
            });
            if (preservedKeys.has(key)) continue;
            preservedKeys.add(key);
            await tx.$queryRaw`
              INSERT INTO daily_plan_items (
                plan_id, order_index, activity_type, activity_id,
                estimated_minutes, reason, status, knowledge_tags
              ) VALUES (
                ${plan.id}::uuid, ${asNumber(item.order_index)}::int,
                ${item.activity_type}, ${item.activity_id},
                ${asNumber(item.estimated_minutes)}::int,
                ${item.reason ?? ''}, ${item.status},
                ${JSON.stringify(
                  Array.isArray(item.knowledge_tags) ? item.knowledge_tags : [],
                )}::json
              )
              ON CONFLICT (plan_id, order_index) DO NOTHING
            `;
          }
        }
      }

      const keys = new Set<string>(preservedKeys);
      let position = 0;
      for (const candidate of candidates) {
        const key = dailyPlanItemKey(candidate);
        if (keys.has(key)) continue;
        position += 1;
        // Skip positions occupied by preserved COMPLETED/SKIPPED items so the
        // unique (plan_id, order_index) key is never used to overwrite them.
        while (
          await this.positionTaken(tx, plan.id, position)
        ) {
          position += 1;
        }
        keys.add(key);
        await tx.$queryRaw`
          INSERT INTO daily_plan_items (
            plan_id, order_index, activity_type, activity_id,
            estimated_minutes, reason, status, knowledge_tags
          ) VALUES (
            ${plan.id}::uuid, ${position}::int, ${candidate.activityType},
            ${candidate.activityId}, ${candidate.estimatedMinutes}::int,
            ${candidate.reason.slice(0, MAX_REASON_LENGTH)}, 'PLANNED',
            ${JSON.stringify(candidate.knowledgeTags)}::json
          )
          ON CONFLICT (plan_id, order_index) DO UPDATE SET
            activity_type = EXCLUDED.activity_type,
            activity_id = EXCLUDED.activity_id,
            estimated_minutes = EXCLUDED.estimated_minutes,
            reason = EXCLUDED.reason,
            knowledge_tags = EXCLUDED.knowledge_tags,
            updated_at = CURRENT_TIMESTAMP
          WHERE daily_plan_items.status NOT IN ('COMPLETED', 'SKIPPED')
        `;
      }

      const items = await tx.$queryRaw<StoredItemRow[]>`
        SELECT id, order_index, activity_type, activity_id, estimated_minutes,
               reason, status, knowledge_tags
        FROM daily_plan_items
        WHERE plan_id = ${plan.id}::uuid
        ORDER BY order_index ASC
      `;
      return this.toResult(plan, items, input.timeBudgetMinutes);
    });
  }

  private async positionTaken(
    tx: Prisma.TransactionClient,
    planId: string,
    position: number,
  ): Promise<boolean> {
    const rows = await tx.$queryRaw<Array<{ id: string }>>`
      SELECT id FROM daily_plan_items
      WHERE plan_id = ${planId}::uuid AND order_index = ${position}::int
      LIMIT 1
    `;
    return rows.length > 0;
  }

  private toResult(
    plan: StoredPlanRow,
    items: StoredItemRow[],
    timeBudgetMinutes: number,
  ): DailyPlanResult {
    return {
      id: plan.id,
      userId: plan.user_id,
      date: isoDate(plan.day),
      timezone: plan.timezone,
      version: asNumber(plan.version, 1),
      status: plan.status,
      timeBudgetMinutes,
      generatedAt: iso(plan.generated_at),
      updatedAt: iso(plan.updated_at),
      items: items.map((item) => ({
        id: item.id,
        position: asNumber(item.order_index),
        // The migration has no source column; SRS items are the only
        // activity type 'review', so the source is inferred on read.
        source: item.activity_type === 'review' ? 'srs' : 'curated',
        activityType: item.activity_type,
        activityId: item.activity_id,
        contentVersion: '1',
        estimatedMinutes: asNumber(
          item.estimated_minutes,
          DEFAULT_ITEM_MINUTES,
        ),
        reason: item.reason ?? '',
        status: item.status,
        knowledgeTags: Array.isArray(item.knowledge_tags)
          ? item.knowledge_tags.filter(
              (tag): tag is string => typeof tag === 'string',
            )
          : [],
      })),
    };
  }

  private isUniqueViolation(error: unknown): boolean {
    return (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === 'P2002'
    );
  }
}
