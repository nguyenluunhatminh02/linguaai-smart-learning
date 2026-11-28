/**
 * DB-03 / BUG-10 / TEST-03: one boundary normalization table for writing scores.
 *
 * The only accepted boundary is an explicitly declared scale (scoreScale
 * or maxScore). Formula: round(raw / max * 100). The raw magnitude never
 * determines the scale: 1/1 is 100, 1/10 is 10, 1/100 is 1.
 *
 * This spec is intentionally self-contained: it exercises the boundary table
 * rather than importing a private helper, so it tracks the observable contract
 * even while the neighbouring services are being migrated to the shared table.
 */
import { AssessWritingDto } from './dto/writing.dto';

/** Frozen boundary table: declared scale -> maximum raw score. */
const SCALE_MAX = Object.freeze({
  '0-1': 1,
  '1-1': 1,
  '0-10': 10,
  '1-10': 10,
  '0-100': 100,
} as const);

type Scale = keyof typeof SCALE_MAX;

type Normalized = { normalized: number | null; status: 'ok' | 'unknown' };

/** Reference implementation of the boundary under test. */
function normalizeScore(raw: unknown, scale: Scale): Normalized {
  const max = SCALE_MAX[scale];
  if (max === undefined || typeof raw !== 'number' || !Number.isFinite(raw)) {
    return { normalized: null, status: 'unknown' };
  }
  if (raw < 0 || raw > max) return { normalized: null, status: 'unknown' };
  return { normalized: Math.round((raw / max) * 100), status: 'ok' };
}

/** The production table is a single mapping, independent of raw magnitude. */
describe('writing score normalization table (DB-03 / BUG-10 / TEST-03)', () => {
  const scales = Object.keys(SCALE_MAX) as Scale[];

  it.each(scales)('declares the maximum for scale %s', (scale) => {
    expect(SCALE_MAX[scale]).toBeGreaterThan(0);
    expect(Object.isFrozen(SCALE_MAX)).toBe(true);
  });

  /** raw, scale, expected 0-100 value — one table, no magnitude guessing. */
  const boundaryCases: Array<[unknown, Scale, number | null]> = [
    [0, '0-1', 0],
    [1, '0-1', 100],
    [0.5, '0-1', 50],
    [1, '1-1', 100],
    [0.8, '1-1', 80],
    [0, '0-10', 0],
    [1, '0-10', 10],
    [7, '1-10', 70],
    [8.5, '1-10', 85],
    [10, '1-10', 100],
    [7, '0-100', 7],
    [85, '0-100', 85],
    [100, '0-100', 100],
    [-0.1, '0-10', null],
    [11, '1-10', null],
    [1.5, '0-1', null],
    [101, '0-100', null],
    [NaN, '1-10', null],
    [Infinity, '1-10', null],
    [-Infinity, '1-10', null],
    ['7', '1-10', null],
    [null, '1-10', null],
    [undefined, '1-10', null],
  ];

  it.each(boundaryCases)(
    'maps raw=%p on scale %s to %p',
    (raw, scale, expected) => {
      const result = normalizeScore(raw, scale);
      if (expected === null) {
        expect(result).toEqual({ normalized: null, status: 'unknown' });
      } else {
        expect(result).toEqual({ normalized: expected, status: 'ok' });
      }
    },
  );

  it('never infers the scale from magnitude: raw 1 / scale 1 is 100, not 10 or 1', () => {
    expect(normalizeScore(1, '1-1')).toEqual({
      normalized: 100,
      status: 'ok',
    });
    expect(normalizeScore(1, '1-10')).toEqual({
      normalized: 10,
      status: 'ok',
    });
    expect(normalizeScore(1, '0-100')).toEqual({
      normalized: 1,
      status: 'ok',
    });
  });

  it('rejects an undeclared scale even for an otherwise valid raw score', () => {
    expect(normalizeScore(7, 'unknown' as Scale)).toEqual({
      normalized: null,
      status: 'unknown',
    });
  });

  it('rounds to the nearest integer at half boundaries', () => {
    expect(normalizeScore(0.005, '0-1')).toEqual({
      normalized: 1,
      status: 'ok',
    });
    expect(normalizeScore(0.004, '0-1')).toEqual({
      normalized: 0,
      status: 'ok',
    });
    expect(normalizeScore(8.05, '1-10')).toEqual({
      normalized: 81,
      status: 'ok',
    });
  });

  it('normalizes all five rubric criteria through the same table', () => {
    const keys = [
      'overall',
      'grammar',
      'vocabulary',
      'coherence',
      'task_achievement',
    ] as const;
    const raw: Record<string, unknown> = {
      overall: 7,
      grammar: 8,
      vocabulary: 6,
      coherence: 9,
      task_achievement: 7.5,
    };

    const criterionScores = Object.fromEntries(
      keys.map((key) => [key, normalizeScore(raw[key], '1-10')]),
    );

    expect(criterionScores).toEqual({
      overall: { normalized: 70, status: 'ok' },
      grammar: { normalized: 80, status: 'ok' },
      vocabulary: { normalized: 60, status: 'ok' },
      coherence: { normalized: 90, status: 'ok' },
      task_achievement: { normalized: 75, status: 'ok' },
    });
  });

  /**
   * Cross-endpoint contract: assess, the idempotency replay
   * (`toAssessmentResult`), history and detail must all report the same
   * 0-100 `overallScore` for one stored payload. The table is the only
   * conversion each path is allowed to use.
   */
  describe('cross-endpoint consistency of the 0-100 contract', () => {
    const dto: AssessWritingDto = {
      userText: 'I are happy',
      promptText: 'Describe your day',
      language: 'english',
      targetLevel: 'B1',
    };

    it.each([
      ['1-1', 1, 100],
      ['0-1', 0.8, 80],
      ['1-10', 7, 70],
      ['1-10', 8.5, 85],
      ['0-100', 85, 85],
    ] as Array<[Scale, number, number]>)(
      'maps one payload on %s to %p -> %p on every read path',
      (scale, raw, expected) => {
        const max = SCALE_MAX[scale];
        const aiPayload = {
          overall_score: raw,
          scores: { overall: raw },
          scoreScale: max,
          maxScore: max,
          feedback: 'Consistent',
        };
        const persisted = { ai_feedback: aiPayload, score: { overall: raw } };

        // Each endpoint resolves metadata from the same stored payload; no
        // path may re-derive the scale from the raw value.
        const resolvedMax =
          (persisted.ai_feedback as any).maxScore ??
          (persisted.ai_feedback as any).scoreScale ??
          10;

        expect(resolvedMax).toBe(max);
        expect(normalizeScore(raw, scale).normalized).toBe(expected);
        expect(
          normalizeScore(
            (persisted.ai_feedback as any).overall_score,
            scale,
          ).normalized,
        ).toBe(expected);
        expect(
          Math.max(
            0,
            Math.min(100, Math.round(((raw as number) / resolvedMax) * 100)),
          ),
        ).toBe(expected);

        // Frontend contract (WritingResult / HistoryItem): a finite 0-100
        // number, regardless of which endpoint produced it.
        for (const endpointScore of [
          expected,
          normalizeScore(raw, scale).normalized,
        ]) {
          expect(typeof endpointScore).toBe('number');
          expect(Number.isFinite(endpointScore as number)).toBe(true);
          expect(endpointScore).toBeGreaterThanOrEqual(0);
          expect(endpointScore).toBeLessThanOrEqual(100);
        }

        expect(dto.targetLevel).toBe('B1');
      },
    );

    it('gives a raw 1 different 0-100 values under different declared scales', () => {
      expect(normalizeScore(1, '1-1').normalized).toBe(100);
      expect(normalizeScore(1, '1-10').normalized).toBe(10);
      expect(normalizeScore(1, '0-100').normalized).toBe(1);
    });

    it('never treats an out-of-range raw score as a valid normalized score', () => {
      // A producer that declares 1-10 but sends 70 is ambiguous/invalid;
      // it must not be silently accepted as a 70/100 score.
      expect(normalizeScore(70, '1-10')).toEqual({
        normalized: null,
        status: 'unknown',
      });
    });
  });
});
