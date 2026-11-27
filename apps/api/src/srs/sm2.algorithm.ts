/**
 * SM-2 Spaced Repetition Algorithm
 *
 * Formulas:
 *   EF' = max(1.3, EF + 0.1 - (5 - q) * (0.08 + (5 - q) * 0.02))
 *   Interval:
 *     rep=1 → 1 day
 *     rep=2 → 3 days (if quality >= 3, adapted from 6)
 *     rep>2 → I(n-1) * EF'
 *   If quality < 3 → reset repetition to 0, interval to 0
 */
export class Sm2Algorithm {
  /** Valid SM-2 quality grades, matching QUIZ_GRADES (0 = blackout ... 5 = perfect). */
  private static readonly MIN_QUALITY = 0;
  private static readonly MAX_QUALITY = 5;
  private static readonly MIN_EASE_FACTOR = 1.3;

  static calculate(
    quality: number,
    prevEaseFactor: number,
    prevInterval: number,
    prevRepetition: number,
  ): { easeFactor: number; interval: number; repetition: number } {
    // Reject malformed input instead of silently persisting NaN or granting
    // unearned ease-factor increases for out-of-range grades.
    if (
      !Number.isInteger(quality) ||
      quality < Sm2Algorithm.MIN_QUALITY ||
      quality > Sm2Algorithm.MAX_QUALITY
    ) {
      throw new RangeError(
        `quality must be an integer in ${Sm2Algorithm.MIN_QUALITY}..${Sm2Algorithm.MAX_QUALITY}`,
      );
    }
    if (
      !Number.isFinite(prevEaseFactor) ||
      !Number.isFinite(prevInterval) ||
      !Number.isFinite(prevRepetition) ||
      prevEaseFactor < Sm2Algorithm.MIN_EASE_FACTOR ||
      prevInterval < 0 ||
      prevRepetition < 0 ||
      !Number.isInteger(prevRepetition)
    ) {
      throw new RangeError(
        'invalid prior review state: ease factor, interval and repetition must be finite and non-negative',
      );
    }

    // Compute the new ease factor first: the interval must use the value that
    // is persisted, not the pre-review one.
    let easeFactor =
      prevEaseFactor +
      (0.1 - (5 - quality) * (0.08 + (5 - quality) * 0.02));
    if (easeFactor < Sm2Algorithm.MIN_EASE_FACTOR) {
      easeFactor = Sm2Algorithm.MIN_EASE_FACTOR;
    }

    let interval: number;
    let repetition: number;

    if (quality < 3) {
      // Failed: reset
      repetition = 0;
      interval = 0;
    } else {
      // Successful review. A zero interval with an advanced repetition count
      // is inconsistent state (e.g. a failed review that reset only the
      // interval): restart the ladder so the card cannot get stuck due-now.
      const isRestart = prevRepetition >= 2 && prevInterval <= 0;
      if (prevRepetition === 0 || isRestart) {
        interval = 1;
        repetition = 1;
      } else if (prevRepetition === 1) {
        interval = 3;
        repetition = 2;
      } else {
        interval = Math.round(prevInterval * easeFactor);
        repetition = prevRepetition + 1;
      }
    }

    return {
      easeFactor: Math.round(easeFactor * 100) / 100,
      interval: Math.max(0, interval),
      repetition,
    };
  }

  static getNextReviewDate(intervalDays: number): Date {
    if (!Number.isFinite(intervalDays) || intervalDays < 0) {
      throw new RangeError('intervalDays must be a finite, non-negative number');
    }
    // Normalize to a fixed UTC time so elapsed time does not depend on the
    // hour of the review or on local DST transitions.
    const date = new Date();
    date.setUTCHours(0, 0, 0, 0);
    date.setUTCDate(date.getUTCDate() + intervalDays);
    return date;
  }
}
