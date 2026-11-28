import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { Prisma, quiz_attempts, quiz_questions } from '../generated/prisma';
import { AiClientService } from '../common/services/ai-client.service';
import { AnalyticsService } from '../analytics/analytics.service';
import {
  CreateQuizDto,
  SubmitQuizDto,
  AdaptiveNextDto,
  GenerateQuizDto,
} from './dto/quiz.dto';

function normalizeAnswer(value: string) {
  return value
    .normalize('NFC')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .replace(/[.!?,;:]+$/, '');
}

function questionOptions(
  question: Pick<quiz_questions, 'options' | 'question_type'>,
): string[] {
  if (
    Array.isArray(question.options) &&
    question.options.every((option) => typeof option === 'string') &&
    question.options.length
  ) {
    return question.options;
  }
  return question.question_type === 'true_false' ? ['True', 'False'] : [];
}

export function correctOptionIndex(
  options: string[],
  answer: string,
): number | null {
  const normalized = normalizeAnswer(answer);
  const matches = options.flatMap((option, index) =>
    [option, option.replace(/^\s*[a-z][.)]\s+/i, '')].some(
      (text) => normalizeAnswer(text) === normalized,
    )
      ? [index]
      : [],
  );
  if (matches.length) return matches.length === 1 ? matches[0] : null;
  const marker = answer.trim().match(/^([a-z])(?:[.)](?:\s.*)?)?$/i);
  const index = marker
    ? marker[1].toUpperCase().charCodeAt(0) - 65
    : /^\d+$/.test(answer.trim())
      ? Number(answer)
      : -1;
  return index >= 0 && index < options.length ? index : null;
}

export interface GradedAnswer {
  questionId: string;
  answer: string;
  optionIndex?: number;
  isCorrect: boolean;
}

interface StoredAnswer extends GradedAnswer {
  // Answer-key data stays on the server; never returned to clients.
  correctAnswer: string;
  correctOptionIndex: number | null;
  explanation: string;
}

const QUIZ_QUESTION_TYPES = new Set(['mcq', 'true_false', 'fill_blank']);

// Activity rewards are computed server-side from persisted attempt data so a
// client cannot inflate XP by submitting a forged score or duration.
const QUIZ_BASE_XP = 10;
const XP_PER_CORRECT_ANSWER = 10;
const DEFAULT_QUIZ_TIME_LIMIT_MINUTES = 15;
const MAX_ABS_MINUTES = 24 * 60;

/**
 * Validate a single AI-generated question before it is persisted. Throws for
 * malformed items so a bad AI response cannot create an ungradeable quiz.
 */
function validateGeneratedQuestion(q: any, index: number) {
  if (!q || typeof q !== 'object') {
    throw new BadRequestException(`Generated question ${index + 1} is invalid`);
  }
  const questionText =
    typeof q.questionText === 'string' ? q.questionText.trim() : '';
  if (!questionText) {
    throw new BadRequestException(
      `Generated question ${index + 1} has no text`,
    );
  }
  const questionType =
    typeof q.questionType === 'string' && q.questionType
      ? q.questionType.toLowerCase()
      : 'mcq';
  if (!QUIZ_QUESTION_TYPES.has(questionType)) {
    throw new BadRequestException(
      `Generated question ${index + 1} has an invalid type`,
    );
  }
  const difficulty = Number.isInteger(q.difficulty) ? q.difficulty : 3;
  if (difficulty < 1 || difficulty > 5) {
    throw new BadRequestException(
      `Generated question ${index + 1} has an invalid difficulty`,
    );
  }
  const correctAnswer =
    typeof q.correctAnswer === 'string' ? q.correctAnswer.trim() : '';
  if (!correctAnswer) {
    throw new BadRequestException(
      `Generated question ${index + 1} has no correct answer`,
    );
  }
  const options = Array.isArray(q.options) ? q.options : [];
  if (!options.every((option: unknown) => typeof option === 'string')) {
    throw new BadRequestException(
      `Generated question ${index + 1} has invalid options`,
    );
  }
  const stringOptions = options as string[];
  if (questionType === 'true_false' && stringOptions.length === 0) {
    stringOptions.push('True', 'False');
  }
  if (questionType === 'mcq' && stringOptions.length === 0) {
    throw new BadRequestException(`Generated MCQ ${index + 1} has no options`);
  }
  if (stringOptions.length > 5) {
    throw new BadRequestException(
      `Generated question ${index + 1} has too many options`,
    );
  }
  if (
    stringOptions.length > 0 &&
    correctOptionIndex(stringOptions, correctAnswer) === null
  ) {
    throw new BadRequestException(
      `Generated question ${index + 1} has an answer outside its options`,
    );
  }
  return {
    question_text: questionText,
    question_type: questionType,
    options: stringOptions,
    correct_answer: correctAnswer,
    explanation: typeof q.explanation === 'string' ? q.explanation : '',
    difficulty,
  };
}

@Injectable()
export class QuizService {
  private readonly logger = new Logger(QuizService.name);

  constructor(
    private prisma: PrismaService,
    private aiClient: AiClientService,
    // Optional so quiz completions stay functional before QuizModule registers AnalyticsModule.
    @Optional() private analytics?: AnalyticsService,
  ) {}

  private xpForAttempt(score: number, total: number): number {
    if (!Number.isFinite(score) || !Number.isFinite(total) || total <= 0)
      return QUIZ_BASE_XP;
    const bounded = Math.min(Math.max(0, Math.floor(score)), Math.floor(total));
    return QUIZ_BASE_XP + bounded * XP_PER_CORRECT_ANSWER;
  }

  private minutesForAttempt(
    durationSeconds: number,
    timeLimitMinutes?: number | null,
  ): number {
    const seconds =
      Number.isFinite(durationSeconds) && durationSeconds > 0
        ? Math.floor(durationSeconds)
        : 0;
    const configured =
      Number(timeLimitMinutes) || DEFAULT_QUIZ_TIME_LIMIT_MINUTES;
    const cap = Math.min(Math.max(1, configured), MAX_ABS_MINUTES);
    return Math.min(Math.max(1, Math.ceil(seconds / 60)), cap);
  }

  private async awardActivity(
    userId: string,
    xp: number,
    minutes: number,
  ): Promise<void> {
    if (!this.analytics) return;
    try {
      await this.analytics.recordActivity(userId, xp, minutes, 0);
    } catch (error) {
      // A failed analytics write must not turn a committed submission into a 500
      // or fall through into the P2002 replay handler below.
      this.logger.warn(
        `Quiz activity recording failed for user ${userId}: ${String(error)}`,
      );
    }
  }

  async create(userId: string, dto: CreateQuizDto) {
    const quiz = await this.prisma.quizzes.create({
      data: {
        title: dto.title,
        description: dto.description,
        deck_id: dto.deckId,
        language: dto.language?.trim().toLowerCase(),
        creator_id: userId,
        time_limit_minutes: dto.timeLimitMinutes || 15,
      },
    });

    const questions = await Promise.all(
      dto.questions.map((q) =>
        this.prisma.quiz_questions.create({
          data: {
            quiz_id: quiz.id,
            question_text: q.questionText,
            question_type: q.questionType,
            options: q.options as any,
            correct_answer: q.correctAnswer,
            explanation: q.explanation,
            difficulty: q.difficulty ?? 3,
          },
        }),
      ),
    );

    return { ...quiz, questions };
  }

  async findAll(page = 1, limit = 20, language?: string) {
    const skip = (page - 1) * limit;
    const where: Prisma.quizzesWhereInput = language
      ? {
          OR: [{ language }, { language: null, decks: { language } }],
        }
      : {};

    const [items, total] = await Promise.all([
      this.prisma.quizzes.findMany({
        where,
        skip,
        take: limit,
        orderBy: { created_at: 'desc' },
        include: {
          _count: { select: { quiz_questions: true } },
          decks: { select: { language: true } },
        },
      }),
      this.prisma.quizzes.count({ where }),
    ]);

    return {
      items: items.map((q) => ({
        ...q,
        language: q.language ?? q.decks?.language ?? null,
        questionCount: q._count.quiz_questions,
      })),
      total,
      page,
      pageSize: limit,
      totalPages: Math.ceil(total / limit),
    };
  }

  async findById(id: string) {
    const quiz = await this.prisma.quizzes.findUnique({
      where: { id },
      include: { quiz_questions: true },
    });
    if (!quiz) throw new NotFoundException('Quiz not found');
    return quiz;
  }

  async getQuiz(id: string) {
    const quiz = await this.findById(id);
    return {
      ...quiz,
      quiz_questions: quiz.quiz_questions.map((q) => ({
        id: q.id,
        question_text: q.question_text,
        question_type: q.question_type,
        options: questionOptions(q),
        difficulty: q.difficulty,
      })),
    };
  }

  async submit(userId: string, dto: SubmitQuizDto) {
    if (dto.attemptId) {
      const existing = await this.prisma.quiz_attempts.findUnique({
        where: { id: dto.attemptId },
      });
      if (existing) return this.submissionResult(existing, userId, dto.quizId);
    }

    const quiz = await this.findById(dto.quizId);
    const questions = quiz.quiz_questions;
    if (questions.length === 0)
      throw new BadRequestException('Quiz has no questions');
    const byId = new Map(questions.map((question) => [question.id, question]));
    const submitted = new Set<string>();
    const gradedAnswers = dto.answers.map((answer): StoredAnswer => {
      const question = byId.get(answer.questionId);
      if (!question || submitted.has(answer.questionId)) {
        throw new BadRequestException('Invalid or duplicate quiz question');
      }
      submitted.add(answer.questionId);
      const options = questionOptions(question);
      const expected = options.length
        ? correctOptionIndex(options, question.correct_answer)
        : null;
      if (options.length && expected === null) {
        throw new BadRequestException('Quiz has an invalid answer key');
      }
      const selected =
        answer.optionIndex ??
        (options.length ? correctOptionIndex(options, answer.answer) : null);
      if (
        answer.optionIndex !== undefined &&
        answer.optionIndex >= options.length
      ) {
        throw new BadRequestException('Invalid quiz choice');
      }
      return {
        ...answer,
        isCorrect: options.length
          ? selected === expected
          : normalizeAnswer(question.correct_answer) ===
            normalizeAnswer(answer.answer),
        correctAnswer:
          expected === null ? question.correct_answer : options[expected],
        correctOptionIndex: expected,
        explanation: question.explanation,
      };
    });
    try {
      const attempt = await this.prisma.quiz_attempts.create({
        data: {
          id: dto.attemptId,
          quiz_id: dto.quizId,
          user_id: userId,
          score: gradedAnswers.filter((answer) => answer.isCorrect).length,
          total_questions: questions.length,
          answers: gradedAnswers.map((answer) => ({ ...answer })), // stored answer key is never returned by submissionResult
          duration_seconds: dto.durationSeconds,
        },
      });
      // Award only for a newly persisted attempt; the replay paths below must
      // never credit XP a second time.
      await this.awardActivity(
        userId,
        this.xpForAttempt(attempt.score, attempt.total_questions),
        this.minutesForAttempt(dto.durationSeconds, quiz.time_limit_minutes),
      );
      return this.submissionResult(attempt, userId, dto.quizId);
    } catch (error) {
      if (
        !dto.attemptId ||
        !(error instanceof Prisma.PrismaClientKnownRequestError) ||
        error.code !== 'P2002'
      )
        throw error;
      const existing = await this.prisma.quiz_attempts.findUnique({
        where: { id: dto.attemptId },
      });
      if (!existing) throw error;
      return this.submissionResult(existing, userId, dto.quizId);
    }
  }

  private submissionResult(
    attempt: quiz_attempts,
    userId: string,
    quizId: string,
  ) {
    if (attempt.user_id !== userId || attempt.quiz_id !== quizId)
      throw new ConflictException('Attempt operation already exists');
    const answers: unknown = attempt.answers;
    const results: GradedAnswer[] = Array.isArray(answers)
      ? answers.flatMap((item: any): GradedAnswer[] => {
          if (
            !item ||
            typeof item !== 'object' ||
            typeof item.questionId !== 'string'
          )
            return [];
          return [
            {
              questionId: item.questionId,
              answer: typeof item.answer === 'string' ? item.answer : '',
              optionIndex:
                typeof item.optionIndex === 'number'
                  ? item.optionIndex
                  : undefined,
              isCorrect: item.isCorrect === true,
            },
          ];
        })
      : [];
    return {
      attemptId: attempt.id,
      score: attempt.score,
      total: attempt.total_questions,
      percentage:
        attempt.total_questions > 0
          ? Math.round((attempt.score / attempt.total_questions) * 100)
          : 0,
      results,
    };
  }

  async getAttempts(userId: string, quizId: string) {
    const attempts = await this.prisma.quiz_attempts.findMany({
      where: { user_id: userId, quiz_id: quizId },
      orderBy: { completed_at: 'desc' },
    });
    // Strip stored answer-key fields before returning history to clients.
    return attempts.map((attempt) =>
      this.submissionResult(attempt, userId, quizId),
    );
  }

  async remove(id: string) {
    await this.findById(id);
    await this.prisma.quizzes.delete({ where: { id } });
  }

  /**
   * Auto Content Generation: generate a complete quiz from a topic using AI.
   * Saves quiz + questions to DB and returns the created quiz.
   */
  async generateFromTopic(userId: string, dto: GenerateQuizDto) {
    const aiResult = await this.aiClient.post<{
      title: string;
      questions: Array<{
        questionText: string;
        questionType: string;
        options: string[];
        correctAnswer: string;
        explanation: string;
        difficulty: number;
      }>;
    }>('/ai/content/generate-quiz-questions', {
      topic: dto.topic,
      language: dto.language || 'english',
      level: dto.level || 'B1',
      count: dto.count || 10,
    });

    const quiz = await this.prisma.quizzes.create({
      data: {
        title: dto.title || aiResult.title || `Quiz: ${dto.topic}`,
        description: `Auto-generated quiz about "${dto.topic}" for ${dto.level || 'B1'} level`,
        creator_id: userId,
        language: (dto.language || 'english').trim().toLowerCase(),
        time_limit_minutes: 15,
      },
    });

    if (!Array.isArray(aiResult.questions) || aiResult.questions.length === 0) {
      throw new BadRequestException('AI service returned no quiz questions');
    }
    // Validate before creating anything so a malformed AI response cannot leave
    // an empty or ungradeable quiz behind.
    const validated = aiResult.questions.map((q, index) =>
      validateGeneratedQuestion(q, index),
    );
    const questions = await Promise.all(
      validated.map((data) =>
        this.prisma.quiz_questions.create({
          data: { ...data, quiz_id: quiz.id, options: data.options as any },
        }),
      ),
    );

    return {
      ...quiz,
      questions,
      generated: questions.length,
      topic: dto.topic,
      language: dto.language || 'english',
    };
  }

  async adaptiveNext(quizId: string, dto: AdaptiveNextDto) {
    const quiz = await this.findById(quizId);
    const validIds = new Set(quiz.quiz_questions.map((q) => q.id));
    // Ignore unknown/forged IDs rather than treating them as answered questions.
    const answeredIds = (dto.answeredIds ?? []).filter((id) =>
      validIds.has(id),
    );
    const remaining = quiz.quiz_questions.filter(
      (q) => !answeredIds.includes(q.id),
    );

    if (remaining.length === 0) {
      return { done: true, message: 'All questions answered' };
    }

    // Determine target difficulty. The client supplies session progress for the
    // current (unsubmitted) attempt, so clamp it to the questions that actually
    // exist in this quiz; otherwise forged stats could steer difficulty.
    const answeredCount = Math.min(
      Math.max(0, Math.floor(dto.answeredCount || 0)),
      answeredIds.length,
    );
    const correctCount = Math.min(
      Math.max(0, Math.floor(dto.correctCount || 0)),
      answeredCount,
    );
    const correctRate = answeredCount > 0 ? correctCount / answeredCount : 0.5;

    // Infer current average difficulty from already-answered questions
    const answeredQuestions = quiz.quiz_questions.filter((q) =>
      answeredIds.includes(q.id),
    );
    const avgAnsweredDiff =
      answeredQuestions.length > 0
        ? answeredQuestions.reduce((s, q) => s + (q.difficulty || 3), 0) /
          answeredQuestions.length
        : 3;

    let targetDifficulty: number;
    if (answeredCount < 2) {
      targetDifficulty = 3; // Start at medium
    } else if (correctRate < 0.4) {
      targetDifficulty = Math.max(1, Math.round(avgAnsweredDiff) - 1);
    } else if (correctRate > 0.7) {
      targetDifficulty = Math.min(5, Math.round(avgAnsweredDiff) + 1);
    } else {
      targetDifficulty = Math.round(avgAnsweredDiff);
    }

    // Find a question at target difficulty; relax to ±1 if none available
    let candidates = remaining.filter(
      (q) => (q.difficulty || 3) === targetDifficulty,
    );
    if (candidates.length === 0) {
      candidates = remaining.filter(
        (q) => Math.abs((q.difficulty || 3) - targetDifficulty) <= 1,
      );
    }
    if (candidates.length === 0) candidates = remaining;

    const next = candidates[Math.floor(Math.random() * candidates.length)];

    return {
      done: false,
      question: {
        id: next.id,
        questionText: next.question_text,
        questionType: next.question_type,
        options: next.options,
        difficulty: next.difficulty || 3,
      },
      sessionStats: {
        answered: answeredCount,
        correct: correctCount,
        correctRate: Math.round(correctRate * 100),
        targetDifficulty,
        remaining: remaining.length,
      },
    };
  }
}
