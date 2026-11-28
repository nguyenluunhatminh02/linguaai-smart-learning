// @ts-nocheck
import { BadRequestException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { PrismaService } from '../prisma/prisma.service';
import { ProficiencyService } from './proficiency.service';

const USER_ID = '11111111-1111-4111-8111-111111111111';
const NOW = new Date('2026-11-28T00:00:00.000Z');

const proficiencyRow = (overrides = {}) => ({
  user_id: USER_ID,
  language: 'english',
  skill: 'reading',
  cefr_estimate: 'A1',
  confidence: 0.3333,
  evidence_count: 1,
  updated_at: NOW,
  ...overrides,
});

const attemptRow = (overrides = {}) => ({
  language: 'english',
  skill: 'reading',
  score: 9,
  total: 10,
  cefr_estimate: 'C2',
  created_at: NOW,
  ...overrides,
});

/**
 * Raw SQL cannot be exercised without PostgreSQL here, so these tests assert
 * query shape (values/fragments), mapping and the CEFR update rule against a
 * mocked PrismaService. No live database is required.
 */
describe('ProficiencyService', () => {
  let service: ProficiencyService;
  let prisma: any;

  beforeEach(async () => {
    prisma = {
      $queryRaw: jest.fn(),
      $transaction: jest.fn((callback) => callback(prisma)),
    };
    const module: TestingModule = await Test.createTestingModule({
      providers: [ProficiencyService, { provide: PrismaService, useValue: prisma }],
    }).compile();
    service = module.get<ProficiencyService>(ProficiencyService);
    jest.spyOn(global, 'Date').mockImplementation(() => NOW as any);
  });

  afterEach(() => {
    jest.restoreAllMocks();
    jest.clearAllMocks();
  });

  const queryCalls = () =>
    prisma.$queryRaw.mock.calls.map((call) => String(call[0]));

  describe('ProficiencyService.getSummary', () => {
    it('returns all skills for the authenticated user with mapped CEFR ordinal, confidence, evidenceCount and needsMoreEvidence', async () => {
      prisma.$queryRaw.mockResolvedValue([
        proficiencyRow({ cefr_estimate: 'b2', confidence: '0.75', evidence_count: '6' }),
      ]);

      const result = await service.getSummary(USER_ID);

      expect(prisma.$queryRaw).toHaveBeenCalledTimes(1);
      expect(queryCalls()[0]).toContain('FROM skill_proficiency');
      // Template interpolation is rendered as a comma in the mocked raw call;
      // check the SQL fragment and the bound value separately.
      expect(queryCalls()[0]).toContain('user_id = ,::uuid');
      expect(prisma.$queryRaw.mock.calls[0][1]).toBe(USER_ID);
      expect(result).toEqual({
        userId: USER_ID,
        generatedAt: NOW.toISOString(),
        items: [
          {
            language: 'english',
            skill: 'reading',
            cefrEstimate: 'B2',
            cefrOrdinal: 3,
            confidence: 0.75,
            evidenceCount: 6,
            needsMoreEvidence: false,
            updatedAt: NOW.toISOString(),
          },
        ],
      });
    });

    it('filters by a supported language and rejects an unsupported language with BadRequestException', async () => {
      prisma.$queryRaw.mockResolvedValue([]);

      const filtered = await service.getSummary(USER_ID, ' Japanese ');
      const values = prisma.$queryRaw.mock.calls[0].slice(1);
      expect(values).toContain('japanese');

      prisma.$queryRaw.mockClear();
      await expect(service.getSummary(USER_ID, 'klingon')).rejects.toThrow(
        BadRequestException,
      );
      expect(prisma.$queryRaw).not.toHaveBeenCalled();
      expect(filtered.items).toEqual([]);
    });
  });

  describe('ProficiencyService.getPlacementAttempts', () => {
    it('scopes the raw query to the user, applies language/skill filters, clamps limit to 1..50, and maps created_at to ISO', async () => {
      prisma.$queryRaw.mockResolvedValue([attemptRow()]);

      const result = await service.getPlacementAttempts(USER_ID, {
        language: 'english',
        skill: 'reading',
        limit: 999,
      });

      expect(queryCalls()[0]).toContain('FROM placement_attempts');
      expect(queryCalls()[0]).toContain('user_id = ,::uuid');
      expect(queryCalls()[0]).toContain('LIMIT ,::int');
      const values = prisma.$queryRaw.mock.calls[0].slice(1);
      expect(values).toContain(USER_ID);
      expect(values).toContain('english');
      expect(values).toContain('reading');
      expect(values).toContain(50);
      expect(result.items[0]).toEqual({
        language: 'english',
        skill: 'reading',
        score: 9,
        total: 10,
        cefrEstimate: 'C2',
        createdAt: NOW.toISOString(),
      });

      prisma.$queryRaw.mockClear();
      await service.getPlacementAttempts(USER_ID, { limit: '7' });
      expect(prisma.$queryRaw.mock.calls[0].slice(1)).toContain(7);
    });
  });

  describe('ProficiencyService.submitPlacement', () => {
    it('inserts into placement_attempts and upserts skill_proficiency inside one transaction with ON CONFLICT (user_id, language, skill)', async () => {
      prisma.$queryRaw
        .mockResolvedValueOnce([attemptRow({ score: 2, total: 10, cefr_estimate: 'A1' })])
        .mockResolvedValueOnce([]) // advisory lock
        .mockResolvedValueOnce([]) // current row
        .mockResolvedValueOnce([proficiencyRow({ cefr_estimate: 'A2' })]);

      const result = await service.submitPlacement(USER_ID, {
        language: 'english',
        skill: 'reading',
        score: 2,
        total: 10,
      });

      expect(prisma.$transaction).toHaveBeenCalledTimes(1);
      expect(result.attempt).toMatchObject({
        score: 2,
        total: 10,
        cefrEstimate: 'A1',
      });
      expect(result.proficiency).toMatchObject({ cefrEstimate: 'A2', evidenceCount: 1 });
      const queries = queryCalls();
      expect(queries[0]).toContain('INSERT INTO placement_attempts');
      expect(queries.some((query) => query.includes('ON CONFLICT (user_id, language, skill) DO UPDATE'))).toBe(true);
    });

    it('rejects score > total, score < 0, total < 1, non-integers and unknown language/skill before touching the database', async () => {
      const invalid = [
        { language: 'english', skill: 'reading', score: 11, total: 10 },
        { language: 'english', skill: 'reading', score: -1, total: 10 },
        { language: 'english', skill: 'reading', score: 0, total: 0 },
        { language: 'english', skill: 'reading', score: 1.5, total: 10 },
        { language: 'klingon', skill: 'reading', score: 1, total: 10 },
        { language: 'english', skill: 'telepathy', score: 1, total: 10 },
      ];

      for (const dto of invalid) {
        await expect(service.submitPlacement(USER_ID, dto)).rejects.toThrow(
          BadRequestException,
        );
      }
      expect(prisma.$transaction).not.toHaveBeenCalled();
      expect(prisma.$queryRaw).not.toHaveBeenCalled();
    });
  });

  describe('ProficiencyService.recordEvidence', () => {
    // query order: advisory lock, current row, upsert
    const mockEvidenceQueries = (current: any[] = []) => {
      prisma.$queryRaw
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce(current)
        .mockResolvedValueOnce([
          proficiencyRow({
            cefr_estimate: 'A1',
            confidence: 1 / 3,
            evidence_count: 1,
          }),
        ]);
    };

    it('creates a first A1 row with evidenceCount 1, confidence 1/3 and needsMoreEvidence true', async () => {
      mockEvidenceQueries();

      const result = await service.recordEvidence(USER_ID, {
        language: 'english',
        skill: 'reading',
        score: 2,
        total: 10,
      });

      expect(result).toMatchObject({
        cefrEstimate: 'A1',
        cefrOrdinal: 0,
        evidenceCount: 1,
        confidence: 1 / 3,
        needsMoreEvidence: true,
      });
      const queries = queryCalls();
      expect(queries[0]).toContain('pg_advisory_xact_lock');
      expect(queries[2]).toContain('INSERT INTO skill_proficiency');
      const upsertValues = prisma.$queryRaw.mock.calls[2].slice(1);
      expect(upsertValues[3]).toBe('A1');
      expect(upsertValues).toContain(1 / 3);
      expect(upsertValues).toContain(1);
    });

    it('moves the estimate toward the observed CEFR band gradually and never jumps to C2 after one perfect attempt', async () => {
      mockEvidenceQueries();

      await service.recordEvidence(USER_ID, {
        language: 'english',
        skill: 'reading',
        score: 10,
        total: 10,
      });

      const upsertValues = prisma.$queryRaw.mock.calls[2].slice(1);
      // alpha = 1 / (0 + 1 + 6) = 1/7, so round(7 * 1/7) = 1 => A2, not C2.
      expect(upsertValues[3]).toBe('A2');
    });

    it('keeps languages isolated by using the supplied user/language/skill in both the lock key and all raw SQL', async () => {
      mockEvidenceQueries();

      await service.recordEvidence(USER_ID, {
        language: 'japanese',
        skill: 'listening',
        score: 4,
        total: 10,
      });

      const calls = prisma.$queryRaw.mock.calls;
      const lockKey = calls[0][1];
      expect(lockKey).toBe(`proficiency:${USER_ID}:japanese:listening`);
      expect(calls[1].slice(1)).toEqual(expect.arrayContaining([USER_ID, 'japanese', 'listening']));
      expect(calls[2].slice(1)).toEqual(expect.arrayContaining([USER_ID, 'japanese', 'listening']));
      expect(queryCalls().filter((query) => query.includes('skill_proficiency')).every(
        (query) => query.includes('::uuid'),
      )).toBe(true);
    });

    it('increments evidenceCount and reduces needsMoreEvidence only after enough observations', async () => {
      // Sixth observation: confidence = 6/8 = 0.75 and count >= 5.
      prisma.$queryRaw
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([proficiencyRow({ evidence_count: 5, cefr_estimate: 'B1' })])
        .mockResolvedValueOnce([
          proficiencyRow({ evidence_count: 6, confidence: 0.75, cefr_estimate: 'B1' }),
        ]);

      const result = await service.recordEvidence(USER_ID, {
        language: 'english',
        skill: 'reading',
        score: 7,
        total: 10,
      });

      expect(result.evidenceCount).toBe(6);
      expect(result.needsMoreEvidence).toBe(false);
      const upsertValues = prisma.$queryRaw.mock.calls[2].slice(1);
      expect(upsertValues).toContain(6);
      expect(upsertValues).toContain(0.75);
    });
  });

  it('propagates raw query and transaction errors instead of returning partial results', async () => {
    prisma.$queryRaw.mockRejectedValue(new Error('database unavailable'));
    await expect(service.getSummary(USER_ID)).rejects.toThrow('database unavailable');

    prisma.$queryRaw.mockReset();
    prisma.$transaction.mockRejectedValueOnce(new Error('transaction rolled back'));
    await expect(
      service.recordEvidence(USER_ID, {
        language: 'english',
        skill: 'reading',
        score: 1,
        total: 10,
      }),
    ).rejects.toThrow('transaction rolled back');
  });
});
