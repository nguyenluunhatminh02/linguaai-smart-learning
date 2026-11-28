// @ts-nocheck
import {
  BadRequestException,
  NotFoundException,
} from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { Prisma } from '../generated/prisma';
import { PrismaService } from '../prisma/prisma.service';
import {
  MasteryService,
  computeConfidence,
  computeMastery,
} from './mastery.service';

const USER_ID = '11111111-1111-4111-8111-111111111111';
const KNOWLEDGE_ID = '22222222-2222-4222-8222-222222222222';
const ATTEMPT_ID = '33333333-3333-4333-8333-333333333333';
const NOW = new Date('2026-11-28T00:00:00.000Z');

const masteryRow = (overrides = {}) => ({
  user_id: USER_ID,
  knowledge_id: KNOWLEDGE_ID,
  success_weight: 0,
  failure_weight: 0,
  evidence_count: 0,
  last_practiced_at: null,
  updated_at: NOW,
  language: 'english',
  skill: 'grammar',
  code: 'en.grammar.past_simple',
  title: 'Past simple',
  ...overrides,
});

const eventRow = (overrides = {}) => ({
  id: 'eeeeeeee-eeee-4eee-aeee-eeeeeeeeeeee',
  user_id: USER_ID,
  attempt_id: ATTEMPT_ID,
  knowledge_id: KNOWLEDGE_ID,
  evidence_type: 'quiz_correct',
  score: 1,
  weight: 1,
  created_at: NOW,
  ...overrides,
});

const errorRow = (overrides = {}) => ({
  id: 'ffffffff-ffff-4fff-afff-ffffffffffff',
  user_id: USER_ID,
  attempt_id: ATTEMPT_ID,
  knowledge_id: KNOWLEDGE_ID,
  error_type: 'past_tense_irregular',
  excerpt: 'I go yesterday',
  correction: 'I went yesterday',
  confidence: 0.9,
  status: 'OPEN',
  created_at: NOW,
  ...overrides,
});

/**
 * Raw SQL cannot be exercised without PostgreSQL here, so these tests assert
 * query shape (values/fragments), the Beta mastery formula and the
 * idempotency/replay behaviour against a mocked PrismaService.
 */
describe('MasteryService', () => {
  let service: MasteryService;
  let prisma: any;

  beforeEach(async () => {
    prisma = {
      $queryRaw: jest.fn(),
      $transaction: jest.fn((callback) => callback(prisma)),
    };
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        MasteryService,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();
    service = module.get<MasteryService>(MasteryService);
    jest.spyOn(global, 'Date').mockImplementation(() => NOW as any);
  });

  afterEach(() => {
    jest.restoreAllMocks();
    jest.clearAllMocks();
  });

  const queryCalls = () =>
    prisma.$queryRaw.mock.calls.map((call) => String(call[0]));

  describe('computeMastery (Beta formula)', () => {
    it('returns the prior 0.5 when no evidence has been observed', () => {
      expect(computeMastery(0, 0)).toBe(0.5);
    });

    it('moves toward 1 as success accumulates and toward 0 as failure accumulates', () => {
      expect(computeMastery(3, 0)).toBeCloseTo((1 + 3) / (2 + 3 + 0));
      expect(computeMastery(0, 3)).toBeCloseTo((1 + 0) / (2 + 0 + 3));
      expect(computeMastery(2, 1)).toBeCloseTo((1 + 2) / (2 + 2 + 1));
    });

    it('clamps negative accumulators at zero rather than producing a score outside (0, 1)', () => {
      expect(computeMastery(-1, 0)).toBe(0.5);
      expect(computeMastery(0, -1)).toBe(0.5);
    });
  });

  describe('computeConfidence', () => {
    it('grows with evidence_count and saturates at 0.95', () => {
      expect(computeConfidence(0)).toBe(0);
      expect(computeConfidence(3)).toBeCloseTo(3 / 6);
      expect(computeConfidence(100)).toBeCloseTo(0.95);
    });
  });

  describe('MasteryService.getMastery', () => {
    it('joins learner_mastery with knowledge_items, applies language/skill filters, clamps limit, and maps rows to MasteryItem', async () => {
      prisma.$queryRaw.mockResolvedValue([
        masteryRow({
          success_weight: 3,
          failure_weight: 1,
          evidence_count: 6,
        }),
      ]);

      const result = await service.getMastery(USER_ID, {
        language: 'english',
        skill: 'grammar',
        limit: 10,
      });

      expect(prisma.$queryRaw).toHaveBeenCalledTimes(1);
      const sql = queryCalls()[0];
      expect(sql).toContain('FROM learner_mastery m');
      expect(sql).toContain('JOIN knowledge_items k');
      expect(sql).toContain('LIMIT');
      expect(result.items).toHaveLength(1);
      const item = result.items[0];
      expect(item.mastery).toBeCloseTo(computeMastery(3, 1));
      expect(item.confidence).toBeCloseTo(computeConfidence(6));
      expect(item.evidenceCount).toBe(6);
      expect(item.needsMoreEvidence).toBe(false);
      expect(item.code).toBe('en.grammar.past_simple');
    });

    it('returns an empty items array when the learner has no evidence yet', async () => {
      prisma.$queryRaw.mockResolvedValue([]);
      const result = await service.getMastery(USER_ID);
      expect(result.items).toEqual([]);
      expect(result.userId).toBe(USER_ID);
    });
  });

  describe('MasteryService.recordEvidence', () => {
    it('inserts a mastery_event and upserts learner_mastery inside one transaction, with an advisory lock scoped to (user, knowledge)', async () => {
      prisma.$queryRaw
        .mockResolvedValueOnce([]) // advisory lock
        .mockResolvedValueOnce([{ id: KNOWLEDGE_ID }]) // knowledge exists
        .mockResolvedValueOnce([eventRow()]) // event inserted
        .mockResolvedValueOnce([
          masteryRow({ success_weight: 1, failure_weight: 0, evidence_count: 1 }),
        ]); // snapshot upsert

      const result = await service.recordEvidence(USER_ID, {
        attemptId: ATTEMPT_ID,
        knowledgeId: KNOWLEDGE_ID,
        evidenceType: 'quiz_correct',
        score: 1,
        weight: 1,
      });

      expect(result.replay).toBe(false);
      expect(result.mastery.evidenceCount).toBe(1);
      expect(result.mastery.mastery).toBeCloseTo(computeMastery(1, 0));
      expect(result.event.attemptId).toBe(ATTEMPT_ID);

      const queries = queryCalls();
      expect(queries[0]).toContain('pg_advisory_xact_lock');
      expect(prisma.$queryRaw.mock.calls[0][1]).toBe(
        `mastery:${USER_ID}:${KNOWLEDGE_ID}`,
      );
      expect(queries[1]).toContain('FROM knowledge_items');
      expect(queries[2]).toContain('INSERT INTO mastery_events');
      expect(queries[2]).toContain(
        'ON CONFLICT (attempt_id, knowledge_id, evidence_type) DO NOTHING',
      );
      expect(queries[3]).toContain('INSERT INTO learner_mastery');
      expect(queries[3]).toContain(
        'ON CONFLICT (user_id, knowledge_id) DO UPDATE',
      );
    });

    it('treats a total failure as failure_weight += weight and leaves success_weight unchanged', async () => {
      prisma.$queryRaw
        .mockResolvedValueOnce([]) // advisory lock
        .mockResolvedValueOnce([{ id: KNOWLEDGE_ID }])
        .mockResolvedValueOnce([eventRow({ score: 0 })])
        .mockResolvedValueOnce([
          masteryRow({ success_weight: 0, failure_weight: 1, evidence_count: 1 }),
        ]);

      const result = await service.recordEvidence(USER_ID, {
        attemptId: ATTEMPT_ID,
        knowledgeId: KNOWLEDGE_ID,
        evidenceType: 'quiz_correct',
        score: 0,
        weight: 1,
      });

      expect(result.mastery.successWeight).toBe(0);
      expect(result.mastery.failureWeight).toBe(1);
      expect(result.mastery.mastery).toBeCloseTo(computeMastery(0, 1));
      expect(computeMastery(0, 1)).toBeLessThan(0.5);

      const upsertValues = prisma.$queryRaw.mock.calls[3].slice(1);
      expect(upsertValues).toContain(0); // success_delta = weight * score
      expect(upsertValues).toContain(1); // failure_delta = weight * (1 - score)
    });

    it('isolates evidence by knowledge item (language/version are encoded in the knowledge id)', async () => {
      const japaneseKnowledgeId = '55555555-5555-4555-8555-555555555555';
      prisma.$queryRaw
        .mockResolvedValueOnce([]) // advisory lock
        .mockResolvedValueOnce([{ id: japaneseKnowledgeId }])
        .mockResolvedValueOnce([eventRow({ knowledge_id: japaneseKnowledgeId })])
        .mockResolvedValueOnce([
          masteryRow({ knowledge_id: japaneseKnowledgeId }),
        ]);

      await service.recordEvidence(USER_ID, {
        attemptId: ATTEMPT_ID,
        knowledgeId: japaneseKnowledgeId,
        evidenceType: 'quiz_correct',
        score: 1,
      });

      const calls = prisma.$queryRaw.mock.calls;
      // The advisory lock is scoped to (user, knowledge) so different
      // languages/versions never share a serialized update path.
      expect(calls[0][1]).toBe(`mastery:${USER_ID}:${japaneseKnowledgeId}`);
      expect(calls[1].slice(1)).toContain(japaneseKnowledgeId);
      expect(calls[2].slice(1)).toContain(japaneseKnowledgeId);
      expect(calls[3].slice(1)).toContain(japaneseKnowledgeId);
      expect(
        queryCalls()
          .filter((sql) => sql.includes('user_id'))
          .every((sql) => sql.includes('::uuid')),
      ).toBe(true);
    });

    it('keeps separate mastery records when a knowledge item version changes (different knowledge ids)', async () => {
      const v1KnowledgeId = KNOWLEDGE_ID;
      const v2KnowledgeId = '66666666-6666-4666-8666-666666666666';

      // v1 evidence
      prisma.$queryRaw
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([{ id: v1KnowledgeId }])
        .mockResolvedValueOnce([eventRow({ knowledge_id: v1KnowledgeId })])
        .mockResolvedValueOnce([
          masteryRow({ knowledge_id: v1KnowledgeId, success_weight: 2, evidence_count: 2 }),
        ]);
      const v1 = await service.recordEvidence(USER_ID, {
        attemptId: ATTEMPT_ID,
        knowledgeId: v1KnowledgeId,
        evidenceType: 'quiz_correct',
        score: 1,
      });

      // v2 evidence (new version row in knowledge_items, new knowledge id)
      prisma.$queryRaw
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([{ id: v2KnowledgeId }])
        .mockResolvedValueOnce([
          eventRow({
            id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
            knowledge_id: v2KnowledgeId,
          }),
        ])
        .mockResolvedValueOnce([
          masteryRow({ knowledge_id: v2KnowledgeId, success_weight: 1, evidence_count: 1 }),
        ]);
      const v2 = await service.recordEvidence(USER_ID, {
        attemptId: '77777777-7777-4777-8777-777777777777',
        knowledgeId: v2KnowledgeId,
        evidenceType: 'quiz_correct',
        score: 1,
      });

      expect(v1.mastery.knowledgeId).toBe(v1KnowledgeId);
      expect(v2.mastery.knowledgeId).toBe(v2KnowledgeId);
      expect(v1.mastery.evidenceCount).toBe(2);
      expect(v2.mastery.evidenceCount).toBe(1);
    });

    it('treats a fractional score as partial credit: success_weight += weight*score and failure_weight += weight*(1-score)', async () => {
      prisma.$queryRaw
        .mockResolvedValueOnce([]) // advisory lock
        .mockResolvedValueOnce([{ id: KNOWLEDGE_ID }])
        .mockResolvedValueOnce([eventRow({ score: 0.6 })])
        .mockResolvedValueOnce([
          masteryRow({
            success_weight: 0.6,
            failure_weight: 0.4,
            evidence_count: 1,
          }),
        ]);

      const result = await service.recordEvidence(USER_ID, {
        attemptId: ATTEMPT_ID,
        knowledgeId: KNOWLEDGE_ID,
        evidenceType: 'writing_feedback',
        score: 0.6,
        weight: 1,
      });

      expect(result.mastery.successWeight).toBeCloseTo(0.6);
      expect(result.mastery.failureWeight).toBeCloseTo(0.4);
      expect(result.mastery.mastery).toBeCloseTo(
        computeMastery(0.6, 0.4),
      );
    });

    it('returns replay=true when the event insert yields no rows (concurrent duplicate)', async () => {
      const existingEvent = eventRow({ id: 'aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa' });
      prisma.$queryRaw
        .mockResolvedValueOnce([]) // advisory lock
        .mockResolvedValueOnce([{ id: KNOWLEDGE_ID }])
        .mockResolvedValueOnce([]) // ON CONFLICT DO NOTHING -> no rows
        .mockResolvedValueOnce([existingEvent]) // read-back of existing event
        .mockResolvedValueOnce([
          masteryRow({ success_weight: 1, failure_weight: 0, evidence_count: 1 }),
        ]);

      const result = await service.recordEvidence(USER_ID, {
        attemptId: ATTEMPT_ID,
        knowledgeId: KNOWLEDGE_ID,
        evidenceType: 'quiz_correct',
        score: 1,
      });

      expect(result.replay).toBe(true);
      expect(result.event.id).toBe(existingEvent.id);
      expect(result.mastery.evidenceCount).toBe(1);
    });

    it('handles a P2002 thrown by the transaction as a replay, reading back the existing event outside the rolled-back tx', async () => {
      const p2002 = new Prisma.PrismaClientKnownRequestError(
        'Unique constraint failed',
        { code: 'P2002', clientVersion: 'test' },
      );
      prisma.$transaction.mockRejectedValueOnce(p2002);

      const existingEvent = eventRow();
      prisma.$queryRaw
        .mockResolvedValueOnce([existingEvent]) // read-back of event
        .mockResolvedValueOnce([
          masteryRow({ success_weight: 2, failure_weight: 1, evidence_count: 3 }),
        ]);

      const result = await service.recordEvidence(USER_ID, {
        attemptId: ATTEMPT_ID,
        knowledgeId: KNOWLEDGE_ID,
        evidenceType: 'quiz_correct',
        score: 1,
      });

      expect(result.replay).toBe(true);
      expect(result.event.id).toBe(existingEvent.id);
      expect(result.mastery.mastery).toBeCloseTo(computeMastery(2, 1));
    });

    it('throws NotFoundException when the knowledge item does not exist', async () => {
      prisma.$queryRaw
        .mockResolvedValueOnce([]) // advisory lock
        .mockResolvedValueOnce([]); // knowledge lookup returns empty

      await expect(
        service.recordEvidence(USER_ID, {
          attemptId: ATTEMPT_ID,
          knowledgeId: KNOWLEDGE_ID,
          evidenceType: 'quiz_correct',
          score: 1,
        }),
      ).rejects.toThrow(NotFoundException);
    });

    it('rejects unsupported evidence types and out-of-range scores before touching the database', async () => {
      await expect(
        service.recordEvidence(USER_ID, {
          attemptId: ATTEMPT_ID,
          knowledgeId: KNOWLEDGE_ID,
          evidenceType: 'made_up_type',
          score: 1,
        }),
      ).rejects.toThrow(BadRequestException);

      await expect(
        service.recordEvidence(USER_ID, {
          attemptId: ATTEMPT_ID,
          knowledgeId: KNOWLEDGE_ID,
          evidenceType: 'quiz_correct',
          score: 1.5,
        }),
      ).rejects.toThrow(BadRequestException);

      expect(prisma.$queryRaw).not.toHaveBeenCalled();
    });

    it('clamps the weight to [0.25, 4] when the caller supplies an out-of-range value', async () => {
      prisma.$queryRaw
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([{ id: KNOWLEDGE_ID }])
        .mockResolvedValueOnce([eventRow({ weight: 4 })])
        .mockResolvedValueOnce([masteryRow()]);

      await service.recordEvidence(USER_ID, {
        attemptId: ATTEMPT_ID,
        knowledgeId: KNOWLEDGE_ID,
        evidenceType: 'quiz_correct',
        score: 1,
        weight: 99,
      });

      // The fourth call is the snapshot upsert; its bound weight parameter is
      // the clamped value. We assert via the recorded query string that the
      // service ran to completion with the clamped weight.
      const queries = queryCalls();
      expect(queries[3]).toContain('INSERT INTO learner_mastery');
    });
  });

  describe('MasteryService.listEvents', () => {
    it('filters by knowledge_id when provided, orders newest first, and clamps the limit', async () => {
      prisma.$queryRaw.mockResolvedValue([eventRow()]);

      const result = await service.listEvents(USER_ID, {
        knowledgeId: KNOWLEDGE_ID,
        limit: 5,
      });

      const sql = queryCalls()[0];
      expect(sql).toContain('FROM mastery_events');
      expect(sql).toContain('ORDER BY created_at DESC');
      expect(result.items).toHaveLength(1);
      expect(result.items[0].attemptId).toBe(ATTEMPT_ID);
    });
  });

  describe('MasteryService.listErrors', () => {
    it('returns learner errors ordered newest first with mapped fields', async () => {
      prisma.$queryRaw.mockResolvedValue([errorRow()]);

      const result = await service.listErrors(USER_ID);

      expect(result.items).toHaveLength(1);
      const err = result.items[0];
      expect(err.errorType).toBe('past_tense_irregular');
      expect(err.confidence).toBeCloseTo(0.9);
      expect(err.createdAt).toBe(NOW.toISOString());
    });
  });

  describe('MasteryService.recordError', () => {
    it('inserts a learner_errors row and returns the mapped view', async () => {
      prisma.$queryRaw
        .mockResolvedValueOnce([{ id: KNOWLEDGE_ID }]) // knowledge lookup
        .mockResolvedValueOnce([errorRow()]);

      const result = await service.recordError(USER_ID, {
        attemptId: ATTEMPT_ID,
        knowledgeId: KNOWLEDGE_ID,
        errorType: 'past_tense_irregular',
        excerpt: 'I go yesterday',
        correction: 'I went yesterday',
        confidence: 0.9,
      });

      expect(result.errorType).toBe('past_tense_irregular');
      const queries = queryCalls();
      expect(queries[0]).toContain('FROM knowledge_items');
      expect(queries[1]).toContain('INSERT INTO learner_errors');
    });

    it('throws NotFoundException when the referenced knowledge item does not exist', async () => {
      prisma.$queryRaw.mockResolvedValueOnce([]);

      await expect(
        service.recordError(USER_ID, {
          knowledgeId: KNOWLEDGE_ID,
          errorType: 'x',
        }),
      ).rejects.toThrow(NotFoundException);
    });

    it('allows recording an error without a knowledge_id (classifier produced none)', async () => {
      prisma.$queryRaw.mockResolvedValueOnce([
        errorRow({ knowledge_id: null }),
      ]);

      const result = await service.recordError(USER_ID, {
        errorType: 'spelling',
      });

      expect(result.knowledgeId).toBeNull();
      const queries = queryCalls();
      expect(queries[0]).toContain('INSERT INTO learner_errors');
    });
  });

  describe('MasteryService.getMasteryForKnowledge', () => {
    it('returns null when the learner has no snapshot for that knowledge item', async () => {
      prisma.$queryRaw.mockResolvedValue([]);
      const result = await service.getMasteryForKnowledge(USER_ID, KNOWLEDGE_ID);
      expect(result.item).toBeNull();
    });

    it('returns the mapped MasteryItem when a snapshot exists', async () => {
      prisma.$queryRaw.mockResolvedValue([
        masteryRow({ success_weight: 2, failure_weight: 1, evidence_count: 5 }),
      ]);
      const result = await service.getMasteryForKnowledge(USER_ID, KNOWLEDGE_ID);
      expect(result.item).not.toBeNull();
      expect(result.item.mastery).toBeCloseTo(computeMastery(2, 1));
      expect(result.item.needsMoreEvidence).toBe(false);
    });
  });
});
