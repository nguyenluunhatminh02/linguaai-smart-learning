import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import { createHash } from 'crypto';
import { AnalyticsService } from '../analytics/analytics.service';
import { PrismaService } from '../prisma/prisma.service';
import { COMMUNICATION_SCENARIOS } from './communication-scenarios';
import { CompleteSkillActivityDto } from './learning.dto';

const PHRASE_COLLECTION = 'communication';
const BASE_XP = 5;
const XP_PER_CORRECT_ANSWER = 2;
const PERFECT_BONUS_XP = 5;
const MAX_XP_PER_COMPLETION = 50;

type CompletionActivity = {
  activityType: string;
  activityId: string;
  language: string;
  score?: number;
  total?: number;
  durationSeconds?: number;
  attemptNumber?: number;
  clientAttemptId?: string;
  contentVersion?: string;
  startedAt?: Date | string;
  completedAt?: Date | string;
};

type CompletionRow = {
  id: string;
  activity_type: string;
  activity_id: string;
  language: string;
  score: number | null;
  total: number | null;
  duration_seconds: number;
  completed_at: Date;
};

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function isUuid(value: unknown): value is string {
  return typeof value === 'string' && UUID_PATTERN.test(value);
}

function scenarioAttemptId(
  userId: string,
  slug: string,
  answers: number[],
): string {
  const hex = createHash('sha256')
    .update(JSON.stringify({ userId, slug, answers }))
    .digest('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-5${hex.slice(13, 16)}-a${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

function isDuplicateKeyError(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    (error as { code?: string }).code === 'P2002'
  );
}

function boundedCount(value: number | undefined): number {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.max(0, Math.floor(value))
    : 0;
}

function xpForCompletion(score?: number, total?: number): number {
  const correct = boundedCount(score);
  const totalCount = boundedCount(total);
  const perfect =
    totalCount > 0 && correct === totalCount ? PERFECT_BONUS_XP : 0;
  return Math.min(
    MAX_XP_PER_COMPLETION,
    BASE_XP + correct * XP_PER_CORRECT_ANSWER + perfect,
  );
}

function minutesForCompletion(durationSeconds?: number): number {
  return Math.ceil(boundedCount(durationSeconds) / 60);
}

function toDate(value: Date | string | undefined): Date | null {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function maxDate(a: Date | null | undefined, b: Date): Date {
  return a && a.getTime() > b.getTime() ? a : b;
}

function minDate(a: Date | null | undefined, b: Date): Date {
  return a && a.getTime() < b.getTime() ? a : b;
}

@Injectable()
export class LearningService {
  private readonly logger = new Logger(LearningService.name);

  // Memoized probe for the migration-added attempt_number column so the
  // legacy write path stays safe on databases that have not migrated yet.
  private static attemptColumnAvailable: boolean | undefined;

  constructor(
    private readonly prisma: PrismaService,
    @Optional() private readonly analytics?: AnalyticsService,
  ) {}

  listScenarios() {
    return COMMUNICATION_SCENARIOS.map(
      ({ slug, level, title, objective, estimatedMinutes }) => ({
        slug,
        level,
        title,
        objective,
        estimatedMinutes,
      }),
    );
  }

  getScenario(slug: string) {
    const scenario = this.findScenario(slug);
    return {
      ...scenario,
      audioUrl: `/communication-audio/${slug}.mp3`,
      questions: scenario.questions.map(({ question, options }) => ({
        question,
        options,
      })),
    };
  }

  getProgress(userId: string) {
    return this.prisma.learning_completions.findMany({
      where: { user_id: userId },
      orderBy: { completed_at: 'desc' },
      select: {
        activity_type: true,
        activity_id: true,
        language: true,
        completed_at: true,
        score: true,
        total: true,
        duration_seconds: true,
        first_completed_at: true,
        last_completed_at: true,
        attempt_count: true,
        best_score: true,
        latest_score: true,
        total_duration_seconds: true,
      },
    });
  }

  async completeScenario(userId: string, slug: string, answers: number[]) {
    const scenario = this.findScenario(slug);
    if (
      answers.length !== scenario.questions.length ||
      scenario.questions.some(
        (question, i) => answers[i] >= question.options.length,
      )
    ) {
      throw new BadRequestException(
        'Select one valid option for every question.',
      );
    }

    const results = scenario.questions.map(
      ({ correctAnswer, explanation }, index) => ({
        correctAnswer,
        explanation,
        isCorrect: answers[index] === correctAnswer,
      }),
    );
    const total = results.length;
    const score = results.filter((result) => result.isCorrect).length;
    const { completed, replay } = await this.recordAttempt(userId, {
      activityType: 'scenario',
      activityId: slug,
      language: 'english',
      score,
      total,
      clientAttemptId: scenarioAttemptId(userId, slug, answers),
    });
    if (!replay) {
      await this.creditCompletion(userId, score, total, undefined);
    }
    return { completedAt: completed.completed_at, results, score, total };
  }

  async completeSkillActivity(userId: string, dto: CompleteSkillActivityDto) {
    const input = dto as CompleteSkillActivityDto & CompletionActivity;
    if (isUuid(input.clientAttemptId)) {
      const { completed, replay } = await this.recordAttempt(userId, input);
      // A replay of the same client key never re-credits XP; every genuinely
      // new attempt is credited once, after the transaction commits.
      if (!replay) {
        await this.creditCompletion(
          userId,
          input.score,
          input.total,
          input.durationSeconds,
        );
      }
      return completed;
    }

    const completed = await this.saveCompletion(userId, input);
    await this.creditCompletion(
      userId,
      input.score,
      input.total,
      input.durationSeconds,
    );
    return completed;
  }

  async savePhrase(userId: string, slug: string) {
    const { phrase } = this.findScenario(slug);
    return this.prisma.$transaction(async (tx) => {
      // Serialize creation for this user's collection and keep the count update with card creation.
      await tx.$queryRaw`SELECT id FROM users WHERE id = ${userId}::uuid FOR UPDATE`;
      const deck = await tx.decks.upsert({
        where: {
          creator_id_learning_collection: {
            creator_id: userId,
            learning_collection: PHRASE_COLLECTION,
          },
        },
        create: {
          creator_id: userId,
          title: 'Tiếng Anh giao tiếp',
          description: 'Mẫu câu bạn chọn lưu từ các bài giao tiếp hằng ngày.',
          language: 'english',
          level: 'A1',
          is_public: false,
          learning_collection: PHRASE_COLLECTION,
        },
        update: {},
      });

      const phraseKey = phrase.text.trim().toLowerCase();
      const where = {
        deck_id_learning_phrase_key: {
          deck_id: deck.id,
          learning_phrase_key: phraseKey,
        },
      };
      const existing = await tx.cards.findUnique({
        where,
        select: { id: true },
      });
      if (existing)
        return { cardId: existing.id, deckId: deck.id, alreadySaved: true };

      const card = await tx.cards.create({
        data: {
          deck_id: deck.id,
          learning_phrase_key: phraseKey,
          front_text: phrase.text,
          back_text: phrase.meaning,
          example_sentence: phrase.context,
        },
        select: { id: true },
      });
      await tx.decks.update({
        where: { id: deck.id },
        data: { card_count: { increment: 1 } },
      });
      return { cardId: card.id, deckId: deck.id, alreadySaved: false };
    });
  }

  private findScenario(slug: string) {
    const scenario = COMMUNICATION_SCENARIOS.find((item) => item.slug === slug);
    if (!scenario) throw new NotFoundException('Bài giao tiếp không tồn tại.');
    return scenario;
  }

  /**
   * Legacy summary-only persistence for callers that do not send a
   * clientAttemptId. Score/total are written on both branches; duration is
   * preserved when omitted. attempt_number is applied through a guarded raw
   * update because older databases may not have the column yet.
   */
  private async saveCompletion(
    userId: string,
    activity: CompletionActivity,
  ): Promise<CompletionRow> {
    const key = {
      user_id: userId,
      activity_type: activity.activityType,
      activity_id: activity.activityId,
    };
    const duration =
      activity.durationSeconds === undefined
        ? {}
        : { duration_seconds: activity.durationSeconds };
    const row = await this.prisma.learning_completions.upsert({
      where: { user_id_activity_type_activity_id: key },
      create: {
        ...key,
        language: activity.language,
        score: activity.score ?? null,
        total: activity.total ?? null,
        ...duration,
      },
      update: {
        score: activity.score ?? null,
        total: activity.total ?? null,
        ...duration,
      },
    });
    if (activity.attemptNumber !== undefined) {
      await this.writeAttemptNumber(row.id, activity.attemptNumber);
    }
    return row as CompletionRow;
  }

  private async writeAttemptNumber(
    completionId: string,
    attemptNumber: number,
  ): Promise<void> {
    if (!(await this.hasAttemptNumberColumn())) return;
    await this.prisma.$executeRaw`
      UPDATE learning_completions
      SET attempt_number = ${attemptNumber}
      WHERE id = ${completionId}::uuid
    `;
  }

  private async hasAttemptNumberColumn(): Promise<boolean> {
    if (LearningService.attemptColumnAvailable !== undefined) {
      return LearningService.attemptColumnAvailable;
    }
    const rows = await this.prisma.$queryRaw<Array<{ present: boolean }>>`
      SELECT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'learning_completions'
          AND column_name = 'attempt_number'
      ) AS present
    `;
    LearningService.attemptColumnAvailable = Boolean(rows[0]?.present);
    return LearningService.attemptColumnAvailable;
  }

  private async creditCompletion(
    userId: string,
    score: number | undefined,
    total: number | undefined,
    durationSeconds: number | undefined,
  ): Promise<void> {
    if (!this.analytics) return;
    try {
      await this.analytics.recordActivity(
        userId,
        xpForCompletion(score, total),
        minutesForCompletion(durationSeconds),
      );
    } catch (error) {
      // A completed lesson must not be reported as failed just because XP
      // bookkeeping failed.
      this.logger.error(
        `Failed to record completion XP for user ${userId}`,
        error instanceof Error ? error.stack : String(error),
      );
    }
  }

  /**
   * DB-02/DB-08: append-only attempt history plus a monotonic summary.
   * The unique (user_id, client_attempt_id) key is the idempotency claim:
   * a concurrent retry receives P2002 and replays the committed state
   * instead of inflating attempt_count or re-crediting XP.
   */
  private async recordAttempt(
    userId: string,
    activity: CompletionActivity,
  ): Promise<{ completed: CompletionRow; replay: boolean }> {
    const clientAttemptId = activity.clientAttemptId as string;
    const completedAt =
      toDate(activity.completedAt) ?? toDate(activity.startedAt) ?? new Date();
    const duration = activity.durationSeconds ?? 0;

    return this.prisma.$transaction(async (tx) => {
      let attempt: {
        id: string;
        completed_at: Date;
        raw_score?: number | null;
        total?: number | null;
        duration_seconds?: number;
      };
      try {
        attempt = await tx.learning_attempts.create({
          data: {
            user_id: userId,
            language: activity.language,
            activity_type: activity.activityType,
            activity_id: activity.activityId,
            content_version: activity.contentVersion ?? null,
            client_attempt_id: clientAttemptId,
            raw_score: activity.score ?? null,
            total: activity.total ?? null,
            duration_seconds: duration,
            started_at: toDate(activity.startedAt),
            completed_at: completedAt,
          },
        });
      } catch (error) {
        if (!isDuplicateKeyError(error)) throw error;
        const summary = await tx.learning_completions.findUnique({
          where: {
            user_id_activity_type_activity_id: {
              user_id: userId,
              activity_type: activity.activityType,
              activity_id: activity.activityId,
            },
          },
        });
        if (summary) {
          return { completed: summary as CompletionRow, replay: true };
        }
        // The winning transaction may not have written its summary yet; the
        // attempt row itself is authoritative for the replayed result.
        const existing = await tx.learning_attempts.findUnique({
          where: {
            user_id_client_attempt_id: {
              user_id: userId,
              client_attempt_id: clientAttemptId,
            },
          },
        });
        if (!existing) {
          throw new Error(
            'Attempt exists but neither summary nor attempt row is readable',
          );
        }
        return {
          completed: {
            id: existing.id,
            activity_type: activity.activityType,
            activity_id: activity.activityId,
            language: activity.language,
            score: existing.raw_score ?? null,
            total: existing.total ?? null,
            duration_seconds: existing.duration_seconds ?? 0,
            completed_at: existing.completed_at,
          },
          replay: true,
        };
      }

      const where = {
        user_id_activity_type_activity_id: {
          user_id: userId,
          activity_type: activity.activityType,
          activity_id: activity.activityId,
        },
      };
      const existing = await tx.learning_completions.findUnique({ where });
      const score = activity.score ?? null;
      const latestScore =
        !existing?.last_completed_at ||
        completedAt.getTime() >= existing.last_completed_at.getTime()
          ? score
          : existing.latest_score;

      // When two distinct attempts race, the loser's pre-read may be stale;
      // omit the monotonic fields in that case so the winner's create values
      // are never rolled backwards by an update computed from null.
      const monotonic = existing
        ? {
            best_score:
              existing.best_score === null || score === null
                ? (existing.best_score ?? score)
                : Math.max(existing.best_score, score),
            first_completed_at: minDate(
              existing.first_completed_at,
              completedAt,
            ),
            last_completed_at: maxDate(
              existing.last_completed_at,
              completedAt,
            ),
          }
        : {};

      const summary = await tx.learning_completions.upsert({
        where,
        create: {
          user_id: userId,
          activity_type: activity.activityType,
          activity_id: activity.activityId,
          language: activity.language,
          score,
          total: activity.total ?? null,
          duration_seconds: duration,
          completed_at: attempt.completed_at,
          first_completed_at: attempt.completed_at,
          last_completed_at: attempt.completed_at,
          attempt_count: 1,
          best_score: score,
          latest_score: score,
          total_duration_seconds: duration,
        },
        update: {
          score,
          total: activity.total ?? null,
          ...(activity.durationSeconds === undefined
            ? {}
            : { duration_seconds: duration }),
          completed_at: maxDate(existing?.completed_at, attempt.completed_at),
          latest_score: latestScore,
          attempt_count: { increment: 1 },
          total_duration_seconds: { increment: duration },
          ...monotonic,
        },
      });

      return { completed: summary as CompletionRow, replay: false };
    });
  }
}
