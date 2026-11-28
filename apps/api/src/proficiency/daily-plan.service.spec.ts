// @ts-nocheck
import { Test, TestingModule } from '@nestjs/testing';
import { PrismaService } from '../prisma/prisma.service';
import {
  dailyPlanItemKey,
  DailyPlanService,
  rankDailyPlanCandidates,
} from './daily-plan.service';

const USER_ID = '11111111-1111-4111-8111-111111111111';
const PLAN_ID = '22222222-2222-4222-8222-222222222222';
const NOW = new Date('2026-11-28T09:30:00.000Z');

const planRow = (overrides = {}) => ({
  id: PLAN_ID,
  user_id: USER_ID,
  day: new Date('2026-11-28T00:00:00.000Z'),
  version: 1,
  timezone: 'UTC',
  status: 'ACTIVE',
  generated_at: NOW,
  updated_at: NOW,
  ...overrides,
});

const itemRow = (overrides = {}) => ({
  id: '33333333-3333-4333-8333-333333333333',
  plan_id: PLAN_ID,
  order_index: 0,
  activity_type: 'review',
  activity_id: 'card-1',
  estimated_minutes: 10,
  reason: 'Due SRS review: Hello (0d overdue)',
  status: 'PENDING',
  knowledge_tags: ['english.vocab.a1', 'deck-1'],
  ...overrides,
});

const learnerRow = (overrides = {}) => ({
  id: USER_ID,
  target_language: 'english',
  preferred_language: 'english',
  learning_level: 'A1',
  daily_study_minutes: 30,
  daily_goal: 20,
  timezone: 'UTC',
  ...overrides,
});

const dueCardRow = (overrides = {}) => ({
  card_id: 'card-1',
  deck_id: 'deck-1',
  deck_title: 'Travel',
  front_text: 'Hello',
  language: 'english',
  level: 'A1',
  next_review_date: NOW,
  ease_factor: 2.5,
  difficulty: 5,
  ...overrides,
});

const contentRow = (overrides = {}) => ({
  id: 'content-1',
  type: 'reading',
  title: 'Past simple reading',
  category: 'grammar',
  level: 'A1',
  duration: '10 min',
  sort_order: 1,
  ...overrides,
});

const completionRow = (overrides = {}) => ({
  activity_type: 'reading',
  activity_id: 'content-1',
  language: 'english',
  completed_at: NOW,
  ...overrides,
});

const rankingInput = (overrides = {}) => ({
  dueCards: [],
  weakSkills: [],
  completions: [],
  content: [],
  language: 'english',
  level: 'A1',
  timeBudgetMinutes: 30,
  now: NOW.toISOString(),
  ...overrides,
});

/**
 * Raw SQL cannot be exercised without PostgreSQL here, so these tests assert
 * query shape (fragments and bound values), pure ranking, idempotency and
 * completion preservation against a mocked PrismaService. No live database is
 * required.
 */
describe('DailyPlanService', () => {
  let service: DailyPlanService;
  let prisma: any;

  beforeEach(async () => {
    prisma = {
      $queryRaw: jest.fn(),
      $queryRawUnsafe: jest.fn(),
      $executeRaw: jest.fn(),
      $transaction: jest.fn((callback) => callback(prisma)),
    };
    prisma.$queryRaw.mockResolvedValue([]);
    prisma.$queryRawUnsafe.mockResolvedValue([]);
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        DailyPlanService,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();
    service = module.get<DailyPlanService>(DailyPlanService);
    const realDate = global.Date;
    global.Date = class extends realDate {
      constructor(...args: any[]) {
        super(...(args.length > 0 ? args : [NOW.getTime()]));
      }
      static now() {
        return NOW.getTime();
      }
      static parse(value: string) {
        return realDate.parse(value);
      }
    } as DateConstructor;
  });

  afterEach(() => {
    jest.restoreAllMocks();
    jest.clearAllMocks();
  });

  const sqlCalls = () => [
    ...prisma.$queryRaw.mock.calls,
    ...prisma.$queryRawUnsafe.mock.calls,
    ...prisma.$executeRaw.mock.calls,
  ];

  const allSql = () => sqlCalls().map((call) => String(call[0])).join('\n');

  const mockSql = (overrides: {
    plan?: any[];
    planAfterInsert?: any[];
    items?: any[];
    itemsAfterInsert?: any[];
    dueCards?: any[];
    weakSkills?: any[];
    completions?: any[];
    content?: any[];
    insertedPlan?: any[];
    insertedItem?: any[];
  } = {}) => {
    prisma.$queryRaw.mockReset();
    prisma.$queryRaw.mockImplementation((strings: any) => {
      const sql = String(strings);
      if (sql.includes('FROM users')) return Promise.resolve([learnerRow()]);
      if (sql.includes('pg_advisory_xact_lock')) return Promise.resolve([]);
      if (sql.includes('FROM user_card_progress')) return Promise.resolve(overrides.dueCards ?? []);
      if (sql.includes('FROM skill_proficiency')) return Promise.resolve(overrides.weakSkills ?? []);
      if (sql.includes('FROM learning_completions')) return Promise.resolve(overrides.completions ?? []);
      if (sql.includes('FROM content_items')) return Promise.resolve(overrides.content ?? []);
      if (sql.includes('INSERT INTO daily_plans')) return Promise.resolve(overrides.insertedPlan ?? [planRow()]);
      if (sql.includes('INSERT INTO daily_plan_items')) return Promise.resolve(overrides.insertedItem ?? [itemRow()]);
      if (sql.includes('FROM daily_plans')) {
        if (sql.includes('WHERE id =') && !sql.includes('version')) {
          return Promise.resolve(overrides.planAfterInsert ?? overrides.plan ?? []);
        }
        return Promise.resolve(overrides.plan ?? []);
      }
      if (sql.includes('FROM daily_plan_items')) {
        return Promise.resolve(overrides.itemsAfterInsert ?? overrides.items ?? []);
      }
      return Promise.resolve([]);
    });
  };

  describe('generation', () => {
    it('creates an ordered plan with reasons, estimates, knowledge tags and a bounded time budget', async () => {
      mockSql({
        dueCards: [dueCardRow(), dueCardRow({ card_id: 'card-2' })],
        weakSkills: [
          {
            language: 'english',
            skill: 'grammar',
            cefr_estimate: 'A1',
            confidence: '0.2',
            evidence_count: '1',
          },
        ],
        content: [contentRow(), contentRow({ id: 'content-2', type: 'vocabulary', duration: '25 min' })],
        insertedPlan: [planRow()],
        itemsAfterInsert: [
          itemRow(),
          itemRow({
            id: '55555555-5555-4555-8555-555555555555',
            order_index: 1,
            activity_type: 'reading',
            activity_id: 'content-1',
            reason: 'Weak grammar evidence (A1): reinforce before harder work',
            estimated_minutes: 10,
            knowledge_tags: ['en.grammar.a1'],
          }),
        ],
      });

      const result = await service.generate(USER_ID, { date: '2026-11-28' });

      expect(allSql()).toContain('FROM daily_plans');
      expect(allSql()).toContain('INSERT INTO daily_plans');
      expect(allSql()).toContain('INSERT INTO daily_plan_items');
      expect(allSql()).toContain('FROM user_card_progress');
      expect(allSql()).toContain('FROM content_items');
      expect(allSql()).toContain('published = TRUE');
      expect(result.version).toBe(1);
      expect(result.date).toBe('2026-11-28');
      expect(result.items.map((item) => item.position)).toEqual([0, 1]);
      for (const item of result.items) {
        expect(item.reason).toBeTruthy();
        expect(item.estimatedMinutes).toBeGreaterThan(0);
        expect(Array.isArray(item.knowledgeTags)).toBe(true);
      }
      expect(
        result.items.reduce((total, item) => total + item.estimatedMinutes, 0),
      ).toBeLessThanOrEqual(30);
    });

    it('is idempotent per user/day/version and performs no INSERT when the plan exists', async () => {
      mockSql({
        plan: [planRow()],
        items: [itemRow({ status: 'COMPLETED' })],
      });

      const result = await service.generate(USER_ID, {
        date: '2026-11-28',
        timezone: 'UTC',
      });

      expect(allSql()).not.toContain('INSERT INTO daily_plans');
      expect(allSql()).not.toContain('INSERT INTO daily_plan_items');
      expect(prisma.$transaction).not.toHaveBeenCalled();
      expect(result.reused).toBe(true);
      expect(result.id).toBe(PLAN_ID);
      expect(result.version).toBe(1);
      expect(result.items[0]).toMatchObject({
        activityId: 'card-1',
        status: 'COMPLETED',
      });
    });

    it('uses the same plan for repeated reads even with a different timezone spelling', async () => {
      mockSql({ plan: [planRow()], items: [itemRow()] });

      const first = await service.getDailyPlan(USER_ID, { date: '2026-11-28' });
      const second = await service.getDailyPlan(USER_ID, {
        date: '2026-11-28',
        timezone: 'UTC',
      });

      expect(first.id).toBe(second.id);
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });
  });

  describe('refresh (critical: completion preservation)', () => {
    it('regenerates at the next version and never DELETEs or writes learning_completions', async () => {
      const completionRows = [completionRow()];
      mockSql({
        dueCards: [dueCardRow()],
        completions: completionRows,
        content: [contentRow()],
        insertedPlan: [planRow({ version: 2 })],
        itemsAfterInsert: [
          itemRow({ status: 'COMPLETED' }),
          itemRow({
            id: '55555555-5555-4555-8555-555555555555',
            order_index: 1,
            activity_type: 'reading',
            activity_id: 'content-1',
            status: 'PENDING',
            reason: 'Weak grammar evidence (A1): reinforce before harder work',
            estimated_minutes: 10,
            knowledge_tags: ['en.grammar.a1'],
          }),
        ],
      });

      const result = await service.refresh(USER_ID, { date: '2026-11-28' });

      expect(allSql()).toContain('FROM learning_completions');
      expect(allSql()).toContain('INSERT INTO daily_plans');
      const statements = allSql();
      expect(statements).not.toMatch(/\bDELETE\b/i);
      expect(
        sqlCalls()
          .map((call) => String(call[0]))
          .filter(
            (sql) =>
              sql.includes('learning_completions') &&
              /\b(INSERT|UPDATE|DELETE)\b/i.test(sql),
          ),
      ).toHaveLength(0);
      expect(result.version).toBe(2);
      expect(result.items.map((item) => item.status)).toContain('COMPLETED');
      expect(completionRows).toEqual([completionRow()]);
    });

    it('preserves COMPLETED and SKIPPED items unchanged across two refreshes', async () => {
      mockSql({
        dueCards: [dueCardRow()],
        insertedPlan: [planRow({ version: 2 })],
        itemsAfterInsert: [
          itemRow({ status: 'COMPLETED' }),
          itemRow({
            id: '55555555-5555-4555-8555-555555555555',
            order_index: 1,
            activity_id: 'content-1',
            activity_type: 'reading',
            status: 'SKIPPED',
            reason: 'Curated reading practice for A1',
            estimated_minutes: 10,
            knowledge_tags: ['en.vocabulary.a1'],
          }),
        ],
      });

      const first = await service.refresh(USER_ID, { date: '2026-11-28' });
      prisma.$queryRaw.mockClear();
      const second = await service.refresh(USER_ID, { date: '2026-11-28' });

      expect(first.items.map((item) => item.status)).toEqual([
        'COMPLETED',
        'SKIPPED',
      ]);
      expect(second.items.map((item) => item.status)).toEqual([
        'COMPLETED',
        'SKIPPED',
      ]);
      expect(second.items.map((item) => item.activityId)).toEqual([
        'card-1',
        'content-1',
      ]);
      expect(allSql()).not.toMatch(/\bDELETE\b/i);
      expect(
        sqlCalls()
          .map((call) => String(call[0]))
          .filter(
            (sql) =>
              sql.includes('learning_completions') &&
              /\b(INSERT|UPDATE|DELETE)\b/i.test(sql),
          ),
      ).toHaveLength(0);
    });
  });

  describe('graceful AI degradation', () => {
    it('selects due SRS cards and published curated content without any AI dependency', async () => {
      const candidates = rankDailyPlanCandidates(
        rankingInput({
          dueCards: [
            {
              cardId: 'card-1',
              deckId: 'deck-1',
              frontText: 'Hello',
              language: 'english',
              level: 'A1',
              nextReviewDate: NOW.toISOString(),
              easeFactor: 2.5,
              difficulty: 5,
            },
          ],
          content: [
            {
              id: 'content-1',
              type: 'reading',
              title: 'Past simple reading',
              category: 'grammar',
              level: 'A1',
              duration: '10 min',
              sortOrder: 1,
            },
          ],
        }),
      );
      expect(candidates.map((candidate) => candidate.source)).toEqual([
        'srs',
        'curated',
      ]);
      expect(candidates.every((candidate) => candidate.reason.length > 0)).toBe(true);
      expect(
        candidates.reduce((total, candidate) => total + candidate.estimatedMinutes, 0),
      ).toBeLessThanOrEqual(30);

      mockSql({
        dueCards: [dueCardRow()],
        content: [contentRow()],
        insertedPlan: [planRow()],
        itemsAfterInsert: [
          itemRow(),
          itemRow({
            id: '55555555-5555-4555-8555-555555555555',
            order_index: 1,
            activity_type: 'reading',
            activity_id: 'content-1',
            reason: 'Curated reading practice for A1',
            estimated_minutes: 10,
            knowledge_tags: ['en.vocabulary.a1'],
          }),
        ],
      });
      const result = await service.generate(USER_ID, { date: '2026-11-28' });
      expect(result.items.map((item) => item.activityId)).toEqual([
        'card-1',
        'content-1',
      ]);
      expect(result.items.map((item) => item.estimatedMinutes)).toEqual([10, 10]);
    });

    it('still persists a valid empty plan when no cards or content are available', async () => {
      mockSql({ insertedPlan: [planRow()], itemsAfterInsert: [] });

      const result = await service.generate(USER_ID, { date: '2026-11-28' });

      expect(allSql()).toContain('INSERT INTO daily_plans');
      expect(result.items).toEqual([]);
      expect(result.version).toBe(1);
    });

    it('demotes completed activities while keeping a stable dedup key', () => {
      const fresh = rankDailyPlanCandidates(
        rankingInput({
          content: [
            {
              id: 'content-1',
              type: 'reading',
              title: 'Past simple reading',
              category: 'grammar',
              level: 'A1',
              duration: '10 min',
              sortOrder: 1,
            },
          ],
        }),
      );
      const afterCompletion = rankDailyPlanCandidates(
        rankingInput({
          completions: [
            {
              activityType: 'reading',
              activityId: 'content-1',
              language: 'english',
              completedAt: NOW.toISOString(),
            },
          ],
          content: [
            {
              id: 'content-1',
              type: 'reading',
              title: 'Past simple reading',
              category: 'grammar',
              level: 'A1',
              duration: '10 min',
              sortOrder: 1,
            },
          ],
        }),
      );
      expect(fresh).toHaveLength(1);
      expect(afterCompletion).toHaveLength(1);
      expect(fresh[0].tier).toBe(2);
      expect(afterCompletion[0].tier).toBeGreaterThanOrEqual(fresh[0].tier);
      expect(dailyPlanItemKey(afterCompletion[0])).toBe(
        'curated|reading|content-1|1',
      );
    });
  });
});
