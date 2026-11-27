import { FsrsAlgorithm, FsrsGrade } from './fsrs.algorithm';

describe('FsrsAlgorithm', () => {
  it('continues relearning after a lapse instead of treating the card as new', () => {
    const first = FsrsAlgorithm.calculate(3, 0.4, 5, 0, 0);
    const forgotten = FsrsAlgorithm.calculate(1, first.stability, first.difficulty, first.repetitions, first.interval);
    const recalled = FsrsAlgorithm.calculate(3, forgotten.stability, forgotten.difficulty, forgotten.repetitions, 1, true);

    expect(forgotten.repetitions).toBe(0);
    expect(recalled.repetitions).toBe(1);
    expect(recalled.stability).not.toBe(first.stability);
  });
  // ─── retrievability ──────────────────────────────────────────────────────
  describe('retrievability', () => {
    it('should return 0 for zero stability', () => {
      expect(FsrsAlgorithm.retrievability(1, 0)).toBe(0);
    });

    it('should return ~0.9 at elapsedDays=0 (no forgetting)', () => {
      // R(0, S) = (1 + FACTOR * 0 / S)^DECAY = 1^DECAY = 1
      // But formula gives 1 when no time has passed
      const R = FsrsAlgorithm.retrievability(0, 10);
      expect(R).toBeCloseTo(1, 5);
    });

    it('should decrease as elapsed days increase', () => {
      const R0 = FsrsAlgorithm.retrievability(0, 10);
      const R1 = FsrsAlgorithm.retrievability(1, 10);
      const R10 = FsrsAlgorithm.retrievability(10, 10);
      expect(R1).toBeLessThan(R0);
      expect(R10).toBeLessThan(R1);
    });

    it('should be higher for higher stability at same interval', () => {
      const R_stable = FsrsAlgorithm.retrievability(10, 100);
      const R_unstable = FsrsAlgorithm.retrievability(10, 5);
      expect(R_stable).toBeGreaterThan(R_unstable);
    });
  });

  // ─── initialStability ────────────────────────────────────────────────────
  describe('initialStability', () => {
    const grades: [FsrsGrade, number][] = [
      [1, 0.4072],  // Again  → W[0]
      [2, 1.1829],  // Hard   → W[1]
      [3, 3.1262],  // Good   → W[2]
      [4, 15.4722], // Easy   → W[3]
    ];

    it.each(grades)('grade %s should return %.4f', (grade, expected) => {
      expect(FsrsAlgorithm.initialStability(grade)).toBeCloseTo(expected, 4);
    });
  });

  // ─── initialDifficulty ───────────────────────────────────────────────────
  describe('initialDifficulty', () => {
    it('should return values clamped to [1, 10]', () => {
      [1, 2, 3, 4].forEach((g) => {
        const D = FsrsAlgorithm.initialDifficulty(g as FsrsGrade);
        expect(D).toBeGreaterThanOrEqual(1);
        expect(D).toBeLessThanOrEqual(10);
      });
    });

    it('should give lower difficulty for better grades', () => {
      const d_again = FsrsAlgorithm.initialDifficulty(1);
      const d_easy = FsrsAlgorithm.initialDifficulty(4);
      expect(d_again).toBeGreaterThan(d_easy);
    });
  });

  // ─── nextDifficulty ──────────────────────────────────────────────────────
  describe('nextDifficulty', () => {
    it('should decrease difficulty for Easy (4) reviews', () => {
      const D = 5;
      const next = FsrsAlgorithm.nextDifficulty(D, 4);
      expect(next).toBeLessThan(D);
    });

    it('should increase difficulty for Again (1) reviews', () => {
      const D = 5;
      const next = FsrsAlgorithm.nextDifficulty(D, 1);
      expect(next).toBeGreaterThan(D);
    });

    it('should be clamped to [1, 10]', () => {
      const veryEasy = FsrsAlgorithm.nextDifficulty(1, 4);
      const veryHard = FsrsAlgorithm.nextDifficulty(10, 1);
      expect(veryEasy).toBeGreaterThanOrEqual(1);
      expect(veryHard).toBeLessThanOrEqual(10);
    });
  });

  // ─── stabilityAfterRecall ────────────────────────────────────────────────
  describe('stabilityAfterRecall', () => {
    it('should increase stability for successful recall', () => {
      const S = 10;
      const D = 5;
      const R = 0.9;
      const next = FsrsAlgorithm.stabilityAfterRecall(D, S, R, 3); // Good
      expect(next).toBeGreaterThan(S);
    });

    it('should apply hard penalty for grade 2', () => {
      const S = 10;
      const D = 5;
      const R = 0.9;
      const good = FsrsAlgorithm.stabilityAfterRecall(D, S, R, 3);
      const hard = FsrsAlgorithm.stabilityAfterRecall(D, S, R, 2);
      expect(hard).toBeLessThan(good);
    });

    it('should apply easy bonus for grade 4', () => {
      const S = 10;
      const D = 5;
      const R = 0.9;
      const good = FsrsAlgorithm.stabilityAfterRecall(D, S, R, 3);
      const easy = FsrsAlgorithm.stabilityAfterRecall(D, S, R, 4);
      expect(easy).toBeGreaterThan(good);
    });
  });

  // ─── calculate (full FSRS) ───────────────────────────────────────────────
  describe('calculate (full FSRS)', () => {
    describe('first review (prevRepetitions=0)', () => {
      it('should set initial stability and difficulty for Good (3)', () => {
        const result = FsrsAlgorithm.calculate(3, 0, 0, 0, 0);
        expect(result.repetitions).toBe(1);
        expect(result.stability).toBeCloseTo(3.1262, 2);
        expect(result.difficulty).toBeGreaterThan(1);
      });

      it('should reset repetitions for Again (1) on first review', () => {
        const result = FsrsAlgorithm.calculate(1, 0, 0, 0, 0);
        expect(result.repetitions).toBe(0);
        expect(result.interval).toBe(1);
      });

      it('should schedule higher interval for Easy (4)', () => {
        const good = FsrsAlgorithm.calculate(3, 0, 0, 0, 0);
        const easy = FsrsAlgorithm.calculate(4, 0, 0, 0, 0);
        expect(easy.interval).toBeGreaterThan(good.interval);
      });
    });

    describe('subsequent reviews', () => {
      it('should increase stability with repeated Good grades', () => {
        const r1 = FsrsAlgorithm.calculate(3, 0, 0, 0, 0);
        const r2 = FsrsAlgorithm.calculate(3, r1.stability, r1.difficulty, 1, r1.interval);
        const r3 = FsrsAlgorithm.calculate(3, r2.stability, r2.difficulty, 2, r2.interval);
        expect(r2.stability).toBeGreaterThan(r1.stability);
        expect(r3.stability).toBeGreaterThan(r2.stability);
      });

      it('should reset repetitions on Again (forgetting)', () => {
        const r1 = FsrsAlgorithm.calculate(3, 0, 0, 0, 0);
        const r2 = FsrsAlgorithm.calculate(1, r1.stability, r1.difficulty, 1, 5);
        expect(r2.repetitions).toBe(0);
        expect(r2.interval).toBe(1);
      });

      it('should stabilize difficulty towards D0(Good) over time', () => {
        const d0_good = FsrsAlgorithm.initialDifficulty(3);
        let D = FsrsAlgorithm.initialDifficulty(1); // very hard
        for (let i = 0; i < 20; i++) {
          D = FsrsAlgorithm.nextDifficulty(D, 3);
        }
        // Should converge towards D0(Good)
        expect(Math.abs(D - d0_good)).toBeLessThanOrEqual(Math.abs(
          FsrsAlgorithm.initialDifficulty(1) - d0_good
        ));
      });
    });

    describe('edge cases', () => {
      it('should handle zero prevStability gracefully', () => {
        const result = FsrsAlgorithm.calculate(3, 0, 0, 0, 0);
        expect(result.stability).toBeGreaterThan(0);
        expect(result.interval).toBeGreaterThan(0);
      });

      it('should cap interval at MAX_INTERVAL (36500 days)', () => {
        const result = FsrsAlgorithm.calculate(4, 50000, 3, 10, 1);
        expect(result.interval).toBeLessThanOrEqual(36500);
      });
    });
  });

  // ─── getNextReviewDate ──────────────────────────────────────────────────
  describe('getNextReviewDate', () => {
    it('should return a future date', () => {
      const now = new Date();
      const future = FsrsAlgorithm.getNextReviewDate(7);
      expect(future.getTime()).toBeGreaterThan(now.getTime());
    });
  });
});
