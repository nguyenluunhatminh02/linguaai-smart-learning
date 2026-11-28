import { BadRequestException, Injectable, Logger, NotFoundException, Optional } from '@nestjs/common';
import { AnalyticsService } from '../analytics/analytics.service';
import { PrismaService } from '../prisma/prisma.service';
import { COMMUNICATION_SCENARIOS } from './communication-scenarios';
import { CompleteSkillActivityDto } from './learning.dto';

const PHRASE_COLLECTION = 'communication';
const BASE_XP = 5;
const XP_PER_CORRECT_ANSWER = 2;
const PERFECT_BONUS_XP = 5;
const MAX_XP_PER_COMPLETION = 50;

// The DTO handoff adds score/total/attemptNumber; this local type keeps the
// service independent of when that change lands.
type CompletionActivity = {
  activityType: string;
  activityId: string;
  language: string;
  score?: number;
  total?: number;
  durationSeconds?: number;
  attemptNumber?: number;
};

function boundedCount(value: number | undefined): number {
  return typeof value === 'number' && Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0;
}

function xpForCompletion(score?: number, total?: number): number {
  const correct = boundedCount(score);
  const totalCount = boundedCount(total);
  const perfect = totalCount > 0 && correct === totalCount ? PERFECT_BONUS_XP : 0;
  return Math.min(MAX_XP_PER_COMPLETION, BASE_XP + correct * XP_PER_CORRECT_ANSWER + perfect);
}

function minutesForCompletion(durationSeconds?: number): number {
  return Math.ceil(boundedCount(durationSeconds) / 60);
}

@Injectable()
export class LearningService {
  private static attemptColumnAvailable: boolean | undefined;
  private readonly logger = new Logger(LearningService.name);

  constructor(
    private readonly prisma: PrismaService,
    // LearningModule does not import AnalyticsModule yet. Optional keeps DI
    // working until that handoff lands; XP is credited only when it is present.
    @Optional() private readonly analytics?: AnalyticsService,
  ) {}

  listScenarios() {
    return COMMUNICATION_SCENARIOS.map(({ slug, level, title, objective, estimatedMinutes }) => ({
      slug, level, title, objective, estimatedMinutes,
    }));
  }

  getScenario(slug: string) {
    const scenario = this.findScenario(slug);
    return {
      ...scenario,
      audioUrl: `/communication-audio/${slug}.mp3`,
      questions: scenario.questions.map(({ question, options }) => ({ question, options })),
    };
  }

  getProgress(userId: string) {
    return this.prisma.learning_completions.findMany({
      where: { user_id: userId },
      orderBy: { completed_at: 'desc' },
      select: { activity_type: true, activity_id: true, language: true, completed_at: true, score: true, total: true, duration_seconds: true },
    });
  }

  async completeScenario(userId: string, slug: string, answers: number[]) {
    const scenario = this.findScenario(slug);
    if (answers.length !== scenario.questions.length || scenario.questions.some((question, i) => answers[i] >= question.options.length)) {
      throw new BadRequestException('Select one valid option for every question.');
    }

    const results = scenario.questions.map(({ correctAnswer, explanation }, index) => ({
      correctAnswer,
      explanation,
      isCorrect: answers[index] === correctAnswer,
    }));
    const total = results.length;
    const score = results.filter((result) => result.isCorrect).length;
    const isFirst = await this.isFirstCompletion(userId, 'scenario', slug);
    const completed = await this.saveCompletion(userId, {
      activityType: 'scenario', activityId: slug, language: 'english', score, total,
    });
    await this.creditCompletion(userId, score, total, undefined, isFirst);
    return { completedAt: completed.completed_at, results, score, total };
  }

  async completeSkillActivity(userId: string, dto: CompleteSkillActivityDto) {
    // The cast is removable once the DTO handoff lands and keeps this file
    // compilable in the meantime.
    const input = dto as CompleteSkillActivityDto & {
      score?: number; total?: number; attemptNumber?: number;
    };
    const isFirst = await this.isFirstCompletion(userId, input.activityType, input.activityId);
    const completed = await this.saveCompletion(userId, input);
    await this.creditCompletion(userId, input.score, input.total, input.durationSeconds, isFirst);
    return completed;
  }

  async savePhrase(userId: string, slug: string) {
    const { phrase } = this.findScenario(slug);
    return this.prisma.$transaction(async (tx) => {
      // Serialize creation for this user's collection and keep the count update with card creation.
      await tx.$queryRaw`SELECT id FROM users WHERE id = ${userId}::uuid FOR UPDATE`;
      const deck = await tx.decks.upsert({
        where: { creator_id_learning_collection: { creator_id: userId, learning_collection: PHRASE_COLLECTION } },
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
      const where = { deck_id_learning_phrase_key: { deck_id: deck.id, learning_phrase_key: phraseKey } };
      const existing = await tx.cards.findUnique({ where, select: { id: true } });
      if (existing) return { cardId: existing.id, deckId: deck.id, alreadySaved: true };

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
      await tx.decks.update({ where: { id: deck.id }, data: { card_count: { increment: 1 } } });
      return { cardId: card.id, deckId: deck.id, alreadySaved: false };
    });
  }

  private findScenario(slug: string) {
    const scenario = COMMUNICATION_SCENARIOS.find((item) => item.slug === slug);
    if (!scenario) throw new NotFoundException('Bài giao tiếp không tồn tại.');
    return scenario;
  }

  private async isFirstCompletion(userId: string, activityType: string, activityId: string) {
    const existing = await this.prisma.learning_completions.findUnique({
      where: { user_id_activity_type_activity_id: {
        user_id: userId, activity_type: activityType, activity_id: activityId,
      } },
      select: { id: true },
    });
    return !existing;
  }

  private async creditCompletion(
    userId: string,
    score: number | undefined,
    total: number | undefined,
    durationSeconds: number | undefined,
    isFirst: boolean,
  ): Promise<void> {
    if (!isFirst || !this.analytics) return;
    try {
      // Canonical signature unchanged; timezoneOffsetMinutes keeps its default of 0.
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

  private async saveCompletion(userId: string, activity: CompletionActivity) {
    const key = { user_id: userId, activity_type: activity.activityType, activity_id: activity.activityId };
    const scoreAndTotal = { score: activity.score ?? null, total: activity.total ?? null };
    // Omitting the key preserves the existing duration on update and uses the
    // database default on create.
    const duration = activity.durationSeconds === undefined
      ? {}
      : { duration_seconds: activity.durationSeconds };

    const completed = await this.prisma.learning_completions.upsert({
      where: { user_id_activity_type_activity_id: key },
      create: { ...key, language: activity.language, ...scoreAndTotal, ...duration },
      update: { ...scoreAndTotal, ...duration },
    });
    await this.persistAttemptNumber(userId, activity);
    return completed;
  }

  private async persistAttemptNumber(userId: string, activity: CompletionActivity): Promise<void> {
    const attempt = activity.attemptNumber;
    if (typeof attempt !== 'number' || !Number.isFinite(attempt)) return;
    // learning_completions has no attempt_number column in schema.prisma; the
    // raw write is gated on the column actually existing.
    if (!(await this.hasAttemptNumberColumn())) return;
    const bounded = Math.min(10000, Math.max(1, Math.floor(attempt)));
    try {
      await this.prisma.$executeRaw`
        UPDATE "learning_completions"
        SET "attempt_number" = ${bounded}
        WHERE "user_id" = ${userId}::uuid
          AND "activity_type" = ${activity.activityType}
          AND "activity_id" = ${activity.activityId}
      `;
    } catch (error) {
      this.logger.warn(
        'attempt_number column exists but update failed',
        error instanceof Error ? error.stack : String(error),
      );
    }
  }

  private async hasAttemptNumberColumn(): Promise<boolean> {
    if (LearningService.attemptColumnAvailable !== undefined) {
      return LearningService.attemptColumnAvailable;
    }
    try {
      const rows = await this.prisma.$queryRaw<Array<{ present: boolean }>>`
        SELECT EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_schema = current_schema()
            AND table_name = 'learning_completions'
            AND column_name = 'attempt_number'
        ) AS present
      `;
      LearningService.attemptColumnAvailable = rows[0]?.present === true;
    } catch {
      LearningService.attemptColumnAvailable = false;
    }
    return LearningService.attemptColumnAvailable;
  }
}
