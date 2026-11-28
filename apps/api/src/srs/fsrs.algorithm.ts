/**
 * FSRS-4.5 (Free Spaced Repetition Scheduler)
 *
 * State-of-the-art spaced repetition algorithm replacing SM-2.
 * Predicts memory stability (S) and difficulty (D) per card.
 * Reference: https://github.com/open-spaced-repetition/fsrs4anki/wiki/The-Algorithm
 *
 * Grades: 1=Again, 2=Hard, 3=Good, 4=Easy
 *
 * Key insight: For 90% desired retention, next interval ≈ stability (S) in days.
 * R(t, S) = (1 + FACTOR * t / S)^DECAY
 */

export type FsrsGrade = 1 | 2 | 3 | 4;

export interface FsrsResult {
  stability: number; // S — days until 90% forgetting probability; stored in easeFactor column
  difficulty: number; // D — card difficulty [1–10]; stored in new difficulty column
  interval: number; // scheduled days until next review
  repetitions: number; // total successful reviews
}

// ── FSRS-4.5 default weight parameters ──────────────────────────────────────
// w[0-3]  : initial stability per grade (1=Again, 2=Hard, 3=Good, 4=Easy)
// w[4-7]  : difficulty initialisation + mean-reversion
// w[8-10] : recall stability multipliers
// w[11-14]: forgotten stability formula
// w[15-16]: hard / easy modifiers for recall stability
const W = [
  0.4072,
  1.1829,
  3.1262,
  15.4722, // initial stability by grade
  7.2102,
  0.5316,
  1.0651,
  0.0589, // difficulty parameters
  1.533,
  0.1544,
  1.007,
  1.9395, // recall stability formula
  0.11,
  0.29,
  2.27,
  0.29, // forgotten stability formula + hard/easy
  2.9898,
  0.51,
  0.34, // unused in this build (reserved)
] as const;

/** FSRS forgetting curve constants */
const DECAY = -0.5;
const FACTOR = Math.pow(0.9, 1 / DECAY) - 1; // ≈ 19/81 ≈ 0.2346
const DESIRED_RETENTION = 0.9;
const MAX_INTERVAL = 36500; // 100 years cap

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export class FsrsAlgorithm {
  /**
   * Retrievability R — probability of correctly recalling a card
   * after `elapsedDays` days with stability `s` days.
   */
  static retrievability(elapsedDays: number, s: number): number {
    if (s <= 0) return 0;
    return Math.pow(1 + (FACTOR * elapsedDays) / s, DECAY);
  }

  /** Initial stability on the very first review, based on grade. */
  static initialStability(grade: FsrsGrade): number {
    return Math.max(W[grade - 1], 0.1);
  }

  /** Initial difficulty on the very first review, based on grade. */
  static initialDifficulty(grade: FsrsGrade): number {
    const d = W[4] - Math.exp(W[5] * (grade - 1)) + 1;
    return clamp(d, 1, 10);
  }

  /** Difficulty update after any non-first review, with mean-reversion. */
  static nextDifficulty(D: number, grade: FsrsGrade): number {
    const adjusted = D - W[6] * (grade - 3);
    const d0Good = FsrsAlgorithm.initialDifficulty(3); // anchor = D0(Good)
    const reverted = W[7] * d0Good + (1 - W[7]) * adjusted;
    return clamp(reverted, 1, 10);
  }

  /**
   * Stability after a SUCCESSFUL recall (grade 2, 3, or 4).
   * S'_r = S * (1 + exp(w8)*(11-D)*S^(-w9)*(exp((1-R)*w10)-1) * hard_penalty * easy_bonus)
   */
  static stabilityAfterRecall(
    D: number,
    S: number,
    R: number,
    grade: FsrsGrade,
  ): number {
    const hardPenalty = grade === 2 ? W[15] : 1;
    const easyBonus = grade === 4 ? W[16] : 1;
    const newS =
      S *
      (1 +
        Math.exp(W[8]) *
          (11 - D) *
          Math.pow(S, -W[9]) *
          (Math.exp((1 - R) * W[10]) - 1) *
          hardPenalty *
          easyBonus);
    return Math.max(newS, 0.1);
  }

  /**
   * Stability after a FAILED recall (grade = 1 = Again).
   * S'_f = w11 * D^(-w12) * ((S+1)^w13 - 1) * exp((1-R)*w14)
   */
  static stabilityAfterForgetting(D: number, S: number, R: number): number {
    const newS =
      W[11] *
      Math.pow(D, -W[12]) *
      (Math.pow(S + 1, W[13]) - 1) *
      Math.exp((1 - R) * W[14]);
    return Math.max(newS, 0.1);
  }

  /**
   * Next scheduling interval in days (for 90% desired retention).
   * For DESIRED_RETENTION=0.9: interval ≈ S (exact derivation from forgetting curve).
   */
  static nextInterval(stability: number): number {
    const interval =
      (stability / FACTOR) * (Math.pow(DESIRED_RETENTION, 1 / DECAY) - 1);
    return clamp(Math.round(interval), 1, MAX_INTERVAL);
  }

  /**
   * Full FSRS-4.5 review calculation.
   *
   * @param grade        Review grade 1-4
   * @param prevStability  Previous S value (stored in easeFactor column)
   * @param prevDifficulty Previous D value (stored in difficulty column), or 0 if first review
   * @param prevRepetitions Consecutive successful reviews so far (0 after a lapse)
   * @param daysSinceLastReview Elapsed days since last review
   * @param hasPriorReview Whether the card has been rated before, including a lapse.
   *                       Defaults to true when a non-zero stability is stored,
   *                       so a lapsed card continues relearning from its
   *                       post-forgetting state instead of being treated as new.
   */
  static calculate(
    grade: FsrsGrade,
    prevStability: number,
    prevDifficulty: number,
    prevRepetitions: number,
    daysSinceLastReview: number,
    hasPriorReview = prevRepetitions > 0 || prevStability > 0,
  ): FsrsResult {
    let stability: number;
    let difficulty: number;
    let repetitions: number;

    if (!hasPriorReview) {
      stability = FsrsAlgorithm.initialStability(grade);
      difficulty = FsrsAlgorithm.initialDifficulty(grade);
      repetitions = grade === 1 ? 0 : 1; // Again on first card doesn't count
    } else {
      const elapsed = Math.max(daysSinceLastReview, 0);
      const R = FsrsAlgorithm.retrievability(elapsed, prevStability);

      difficulty = FsrsAlgorithm.nextDifficulty(prevDifficulty, grade);

      if (grade === 1) {
        // Forgotten — reset to relearning
        stability = Math.min(
          prevStability,
          FsrsAlgorithm.stabilityAfterForgetting(
            prevDifficulty,
            prevStability,
            R,
          ),
        );
        repetitions = 0;
      } else {
        stability = FsrsAlgorithm.stabilityAfterRecall(
          prevDifficulty,
          prevStability,
          R,
          grade,
        );
        repetitions = prevRepetitions + 1;
      }
    }

    const interval = grade === 1 ? 1 : FsrsAlgorithm.nextInterval(stability);

    return {
      stability: Math.round(stability * 1000) / 1000,
      difficulty: Math.round(difficulty * 1000) / 1000,
      interval,
      repetitions,
    };
  }

  static getNextReviewDate(intervalDays: number): Date {
    const date = new Date();
    date.setDate(date.getDate() + intervalDays);
    return date;
  }
}
