// ---------------------------------------------------------------------------
// Seed data – Badge catalog
// ---------------------------------------------------------------------------

export interface SeedBadge {
  name: string;
  description: string;
  condition: Record<string, unknown>;
}

export const BADGE_CATALOG: SeedBadge[] = [
  // ── Review milestones ────────────────────────────────────────────────────
  {
    name: 'First Step',
    description: 'Complete your very first flashcard review.',
    condition: { type: 'review_count', threshold: 1 },
  },
  {
    name: 'Getting Started',
    description: 'Complete 10 flashcard reviews.',
    condition: { type: 'review_count', threshold: 10 },
  },
  {
    name: 'Dedicated Learner',
    description: 'Complete 50 flashcard reviews.',
    condition: { type: 'review_count', threshold: 50 },
  },
  {
    name: 'Century Reviewer',
    description: 'Complete 100 flashcard reviews.',
    condition: { type: 'review_count', threshold: 100 },
  },
  {
    name: 'Review Enthusiast',
    description: 'Complete 500 flashcard reviews.',
    condition: { type: 'review_count', threshold: 500 },
  },
  {
    name: 'Review Master',
    description: 'Complete 1,000 flashcard reviews. True dedication!',
    condition: { type: 'review_count', threshold: 1000 },
  },

  // ── Streak achievements ──────────────────────────────────────────────────
  {
    name: 'Three-Day Spark',
    description: 'Maintain a 3-day study streak.',
    condition: { type: 'streak_days', threshold: 3 },
  },
  {
    name: 'Weekly Warrior',
    description: 'Maintain a 7-day study streak.',
    condition: { type: 'streak_days', threshold: 7 },
  },
  {
    name: 'Fortnight Focus',
    description: 'Maintain a 14-day study streak.',
    condition: { type: 'streak_days', threshold: 14 },
  },
  {
    name: 'Monthly Champion',
    description: 'Maintain a 30-day study streak.',
    condition: { type: 'streak_days', threshold: 30 },
  },
  {
    name: 'Iron Will',
    description: 'Maintain a 60-day study streak.',
    condition: { type: 'streak_days', threshold: 60 },
  },
  {
    name: 'Unstoppable',
    description: 'Maintain a 100-day study streak.',
    condition: { type: 'streak_days', threshold: 100 },
  },
  {
    name: 'Year-Long Legend',
    description: 'Maintain a 365-day study streak. Absolutely legendary!',
    condition: { type: 'streak_days', threshold: 365 },
  },

  // ── Quiz achievements ────────────────────────────────────────────────────
  {
    name: 'Quiz Beginner',
    description: 'Complete your first quiz.',
    condition: { type: 'quiz_count', threshold: 1 },
  },
  {
    name: 'Perfect Score',
    description: 'Score 100% on any quiz.',
    condition: { type: 'quiz_perfect_score', threshold: 1 },
  },
  {
    name: 'Quiz Regular',
    description: 'Complete 10 quizzes.',
    condition: { type: 'quiz_count', threshold: 10 },
  },
  {
    name: 'Quiz Enthusiast',
    description: 'Complete 50 quizzes.',
    condition: { type: 'quiz_count', threshold: 50 },
  },
  {
    name: 'Quiz Ace',
    description: 'Achieve 5 perfect scores on quizzes.',
    condition: { type: 'quiz_perfect_score', threshold: 5 },
  },

  // ── Language diversity ───────────────────────────────────────────────────
  {
    name: 'Bilingual',
    description: 'Study cards in 2 different languages.',
    condition: { type: 'language_count', threshold: 2 },
  },
  {
    name: 'Trilingual',
    description: 'Study cards in 3 different languages.',
    condition: { type: 'language_count', threshold: 3 },
  },
  {
    name: 'Polyglot',
    description: 'Study cards in 4 different languages.',
    condition: { type: 'language_count', threshold: 4 },
  },
  {
    name: 'Language Collector',
    description: 'Study cards in 5 different languages. A true polyglot!',
    condition: { type: 'language_count', threshold: 5 },
  },

  // ── Time-based achievements ──────────────────────────────────────────────
  {
    name: 'Early Bird',
    description: 'Complete a study session before 7:00 AM.',
    condition: { type: 'time_of_day', before: '07:00' },
  },
  {
    name: 'Night Owl',
    description: 'Complete a study session after 10:00 PM.',
    condition: { type: 'time_of_day', after: '22:00' },
  },
  {
    name: 'Weekend Warrior',
    description: 'Study on both Saturday and Sunday in the same weekend.',
    condition: { type: 'weekend_study', days: ['saturday', 'sunday'] },
  },

  // ── XP milestones ───────────────────────────────────────────────────────
  {
    name: 'XP Starter',
    description: 'Earn 100 XP.',
    condition: { type: 'xp_total', threshold: 100 },
  },
  {
    name: 'XP Climber',
    description: 'Earn 500 XP.',
    condition: { type: 'xp_total', threshold: 500 },
  },
  {
    name: 'XP Adventurer',
    description: 'Earn 1,000 XP.',
    condition: { type: 'xp_total', threshold: 1000 },
  },
  {
    name: 'XP Champion',
    description: 'Earn 5,000 XP.',
    condition: { type: 'xp_total', threshold: 5000 },
  },
  {
    name: 'XP Legendary',
    description: 'Earn 10,000 XP. You are a language learning legend!',
    condition: { type: 'xp_total', threshold: 10000 },
  },

  // ── Special achievements ─────────────────────────────────────────────────
  {
    name: 'Deck Creator',
    description: 'Create your first flashcard deck.',
    condition: { type: 'deck_created', threshold: 1 },
  },
  {
    name: 'Speed Demon',
    description: 'Complete a flashcard review in under 5 seconds.',
    condition: { type: 'review_speed', maxSeconds: 5 },
  },
  {
    name: 'Marathon Runner',
    description: 'Study for 2 hours in a single session.',
    condition: { type: 'session_duration', minMinutes: 120 },
  },
  {
    name: 'Deck Architect',
    description: 'Create 5 flashcard decks.',
    condition: { type: 'deck_created', threshold: 5 },
  },
  {
    name: 'Social Learner',
    description: 'Share a deck with another user.',
    condition: { type: 'deck_shared', threshold: 1 },
  },
  {
    name: 'Comeback Kid',
    description: 'Return to studying after a 7-day absence.',
    condition: { type: 'return_after_absence', minDays: 7 },
  },
];
