import { Sm2Algorithm } from './sm2.algorithm';

describe('Sm2Algorithm', () => {
  // ─── quality < 3 (failed) ────────────────────────────────────────────────
  describe('when quality < 3 (failed review)', () => {
    it('should reset repetition to 0 and interval to 0', () => {
      const result = Sm2Algorithm.calculate(2, 2.5, 10, 5);
      expect(result.repetition).toBe(0);
      expect(result.interval).toBe(0);
    });

    it('should still update ease factor downwards', () => {
      // EF = 2.5 + 0.1 - (5-2)*(0.08 + (5-2)*0.02)
      //    = 2.5 + 0.1 - 3*(0.08 + 0.06) = 2.6 - 3*0.14 = 2.6 - 0.42 = 2.18
      const result = Sm2Algorithm.calculate(2, 2.5, 10, 5);
      expect(result.easeFactor).toBe(2.18);
    });

    it('should not let ease factor fall below 1.3', () => {
      const result = Sm2Algorithm.calculate(0, 1.3, 10, 5);
      expect(result.easeFactor).toBeGreaterThanOrEqual(1.3);
    });
  });

  // ─── first successful review (rep=0 → interval=1) ────────────────────────
  describe('first successful review (rep=0)', () => {
    it('should set interval to 1 day', () => {
      const result = Sm2Algorithm.calculate(4, 2.5, 0, 0);
      expect(result.interval).toBe(1);
      expect(result.repetition).toBe(1);
    });
  });

  // ─── second successful review (rep=1 → interval=3) ────────────────────────
  describe('second successful review (rep=1)', () => {
    it('should set interval to 3 days', () => {
      const result = Sm2Algorithm.calculate(4, 2.5, 1, 1);
      expect(result.interval).toBe(3);
      expect(result.repetition).toBe(2);
    });
  });

  // ─── subsequent reviews ──────────────────────────────────────────────────
  describe('subsequent reviews (rep>=2)', () => {
    it('should multiply previous interval by ease factor', () => {
      // interval = round(10 * 2.5) = 25
      const result = Sm2Algorithm.calculate(4, 2.5, 10, 2);
      expect(result.interval).toBe(25);
      expect(result.repetition).toBe(3);
    });

    it('should round to nearest integer', () => {
      // interval = round(7 * 2.18) = 15
      const result = Sm2Algorithm.calculate(4, 2.18, 7, 3);
      expect(result.interval).toBe(15);
    });
  });

  // ─── ease factor updates ─────────────────────────────────────────────────
  describe('ease factor calculation', () => {
    it('should increase ease factor for perfect (5) reviews', () => {
      // EF = 2.5 + 0.1 - 0 = 2.6
      const result = Sm2Algorithm.calculate(5, 2.5, 10, 3);
      expect(result.easeFactor).toBe(2.6);
    });

    it('should decrease ease factor for borderline (3) reviews', () => {
      // EF = 2.5 + 0.1 - 2*(0.08+2*0.02) = 2.6 - 2*0.12 = 2.6 - 0.24 = 2.36
      const result = Sm2Algorithm.calculate(3, 2.5, 10, 3);
      expect(result.easeFactor).toBe(2.36);
    });

    it('should not drop ease factor below 1.3 even with worst quality', () => {
      // EF would be negative without clamp
      const result = Sm2Algorithm.calculate(0, 1.3, 10, 5);
      expect(result.easeFactor).toBe(1.3);
    });

    it('should round ease factor to 2 decimal places', () => {
      // EF = 2.555 + 0.1 - (5-3)*(0.08+2*0.02) = 2.655 - 0.24 = 2.415 -> 2.42
      const result = Sm2Algorithm.calculate(3, 2.555, 1, 0);
      expect(result.easeFactor).toBe(2.42);
    });
  });

  // ─── edge cases ─────────────────────────────────────────────────────────
  describe('edge cases', () => {
    it('should handle zero interval gracefully', () => {
      const result = Sm2Algorithm.calculate(4, 2.5, 0, 0);
      expect(result.interval).toBe(1);
      expect(result.repetition).toBe(1);
    });

    it('should handle large intervals', () => {
      const result = Sm2Algorithm.calculate(4, 2.5, 365, 5);
      const expected = Math.round(365 * 2.5);
      expect(result.interval).toBe(expected);
    });
  });

  // ─── getNextReviewDate ──────────────────────────────────────────────────
  describe('getNextReviewDate', () => {
    // Scheduling is normalized to UTC midnight so the due date never depends
    // on the review hour or on a local DST transition.
    it('returns UTC midnight plus the interval', () => {
      jest.useFakeTimers().setSystemTime(new Date('2026-03-08T12:34:56.000Z'));
      try {
        expect(Sm2Algorithm.getNextReviewDate(7).toISOString()).toBe(
          '2026-03-15T00:00:00.000Z',
        );
      } finally {
        jest.useRealTimers();
      }
    });

    it('returns today at UTC midnight for zero interval', () => {
      jest.useFakeTimers().setSystemTime(new Date('2026-03-08T12:00:00.000Z'));
      try {
        expect(Sm2Algorithm.getNextReviewDate(0).toISOString()).toBe(
          '2026-03-08T00:00:00.000Z',
        );
      } finally {
        jest.useRealTimers();
      }
    });

    it('stays on UTC midnight across a DST boundary', () => {
      jest.useFakeTimers().setSystemTime(new Date('2026-03-07T17:00:00.000Z'));
      try {
        const result = Sm2Algorithm.getNextReviewDate(1);
        expect(result.toISOString()).toBe('2026-03-08T00:00:00.000Z');
        expect(result.getUTCHours()).toBe(0);
      } finally {
        jest.useRealTimers();
      }
    });
  });
});
