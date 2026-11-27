import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { COMMUNICATION_SCENARIOS } from './communication-scenarios';
import { CompleteSkillActivityDto } from './learning.dto';

const PHRASE_COLLECTION = 'communication';

@Injectable()
export class LearningService {
  constructor(private readonly prisma: PrismaService) {}

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
    const completed = await this.saveCompletion(userId, {
      activityType: 'scenario', activityId: slug, language: 'english', score, total,
    });
    return { completedAt: completed.completed_at, results, score, total };
  }

  completeSkillActivity(userId: string, dto: CompleteSkillActivityDto) {
    return this.saveCompletion(userId, dto);
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

  private saveCompletion(
    userId: string,
    activity: { activityType: string; activityId: string; language: string; score?: number; total?: number; durationSeconds?: number },
  ) {
    const key = { user_id: userId, activity_type: activity.activityType, activity_id: activity.activityId };
    const duration = activity.durationSeconds === undefined ? {} : { duration_seconds: activity.durationSeconds };
    return this.prisma.learning_completions.upsert({
      where: { user_id_activity_type_activity_id: key },
      create: { ...key, language: activity.language, score: activity.score, total: activity.total, ...duration },
      update: duration,
    });
  }
}
