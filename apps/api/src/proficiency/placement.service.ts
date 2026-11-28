import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '../generated/prisma';
import { PrismaService } from '../prisma/prisma.service';
import {
  PROFICIENCY_LANGUAGES,
  PROFICIENCY_SKILLS,
  ProficiencyLanguage,
  ProficiencySkill,
} from './dto/proficiency.dto';
import {
  MIN_EVIDENCE_FOR_CONFIDENT,
  ProficiencyItem,
  ProficiencyService,
  SkillEvidence,
} from './proficiency.service';

/** CEFR bands are declared here and reused by the proficiency module's scale. */
export const PLACEMENT_CEFR_LEVELS = [
  'A1',
  'A2',
  'B1',
  'B2',
  'C1',
  'C2',
] as const;
type CefrBand = (typeof PLACEMENT_CEFR_LEVELS)[number];
const CEFR_BANDS: readonly CefrBand[] = PLACEMENT_CEFR_LEVELS;

/** Same thresholds as ProficiencyService; never invent a second CEFR scale. */
function cefrOrdinalForRatio(score: number, total: number): number {
  const ratio = total > 0 ? score / total : 0;
  if (ratio < 0.4) return 0;
  if (ratio < 0.55) return 1;
  if (ratio < 0.7) return 2;
  if (ratio < 0.82) return 3;
  if (ratio < 0.92) return 4;
  return 5;
}

/** One session draws at most this many moderated questions. */
export const PLACEMENT_QUESTION_COUNT = 10;
const QUESTIONS_PER_LEVEL = 2;
const MAX_CONFIDENCE = 0.95;

/** Transport DTO shapes are declared here so this file owns its own contracts. */
export interface StartPlacementInput {
  language: ProficiencyLanguage;
  skill: ProficiencySkill;
}

export interface SubmitPlacementResponseInput {
  questionId: string;
  answer: string;
}

export interface PlacementQuestion {
  id: string;
  language: string;
  skill: string;
  cefrLevel: string;
  questionText: string;
  questionType: string;
  /** MCQ options are exposed as a safe record; never returned as raw JSON strings. */
  options: Record<string, string> | null;
  difficulty: number;
}

export interface PlacementAnswerRecord {
  questionId: string;
  correct: boolean;
  expectedAnswer: string;
  answer: string;
}

export interface PlacementResult {
  sessionId: string;
  userId: string;
  language: string;
  skill: string;
  status: 'completed';
  score: number;
  total: number;
  cefrEstimate: string;
  confidence: number;
  needsMoreEvidence: boolean;
  answers: PlacementAnswerRecord[];
  proficiency: ProficiencyItem;
}

export interface PlacementSessionView extends PlacementResult {
  startedAt: string;
  completedAt: string;
}

interface QuestionRow {
  id: string;
  language: string;
  skill: string;
  cefr_level: string;
  question_text: string;
  question_type: string;
  options: Prisma.JsonValue | string | null;
  expected_answer: string;
  difficulty: number | bigint | string;
}

interface SessionRow {
  id: string;
  user_id: string;
  language: string;
  skill: string;
  status: 'in_progress' | 'completed' | 'abandoned';
  question_ids: string[];
  responses: Prisma.JsonValue | string | null;
  score: number | bigint | string | null;
  total: number | bigint | string;
  cefr_estimate: string | null;
  confidence: number | bigint | string | null;
  started_at: Date | string;
  completed_at: Date | string | null;
}

interface ScoredAnswer extends PlacementAnswerRecord {}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function normalizeChoice<T extends string>(
  value: string,
  allowed: readonly T[],
  label: string,
): T {
  if (typeof value !== 'string') {
    throw new BadRequestException(`Unsupported ${label}: ${String(value)}`);
  }
  const normalized = value.trim().toLowerCase();
  if (!allowed.includes(normalized as T)) {
    throw new BadRequestException(`Unsupported ${label}: ${value}`);
  }
  return normalized as T;
}

function isValidUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    value,
  );
}

function parseOptions(raw: QuestionRow['options']): Record<string, string> | null {
  if (raw === null || raw === undefined) return null;
  let parsed: unknown = raw;
  if (typeof raw === 'string') {
    try {
      parsed = JSON.parse(raw);
    } catch {
      return null;
    }
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return null;
  }
  const options: Record<string, string> = {};
  for (const [key, value] of Object.entries(parsed)) {
    if (typeof value === 'string') options[key] = value;
  }
  return Object.keys(options).length > 0 ? options : null;
}

function toQuestion(row: QuestionRow): PlacementQuestion {
  return {
    id: row.id,
    language: row.language,
    skill: row.skill,
    cefrLevel: String(row.cefr_level).toUpperCase(),
    questionText: row.question_text,
    questionType: String(row.question_type).toLowerCase(),
    options: parseOptions(row.options),
    difficulty: Number(row.difficulty),
  };
}

function parseAnswers(raw: SessionRow['responses']): ScoredAnswer[] {
  if (raw === null || raw === undefined) return [];
  let parsed: unknown = raw;
  if (typeof raw === 'string') {
    try {
      parsed = JSON.parse(raw);
    } catch {
      return [];
    }
  }
  if (!Array.isArray(parsed)) return [];
  return parsed.filter(
    (item): item is ScoredAnswer =>
      typeof item === 'object' &&
      item !== null &&
      typeof (item as ScoredAnswer).questionId === 'string' &&
      typeof (item as ScoredAnswer).correct === 'boolean',
  );
}

/**
 * Explicit confidence for one placement session. Unlike a CEFR estimate, it
 * accounts for both how much of the bank was answered and how spread out the
 * sampled difficulties were. The score share (0.6) dominates but never fully
 * determines confidence, so a perfect short test cannot look certain.
 */
export function placementConfidence(
  score: number,
  total: number,
  difficulties: number[],
): number {
  if (total <= 0) return 0;
  const ratio = clamp(score / total, 0, 1);
  const coverage = Math.min(1, total / PLACEMENT_QUESTION_COUNT);
  let difficultyVariance = 0;
  if (difficulties.length > 1) {
    const mean =
      difficulties.reduce((sum, value) => sum + value, 0) / difficulties.length;
    difficultyVariance =
      difficulties.reduce((sum, value) => sum + (value - mean) ** 2, 0) /
      difficulties.length;
  }
  const spread = Math.min(1, difficultyVariance / 2);
  return clamp(
    0.6 * ratio + 0.25 * coverage + 0.15 * spread,
    0,
    MAX_CONFIDENCE,
  );
}

/** Map an explicit confidence onto the weight range accepted by recordEvidence. */
export function confidenceToEvidenceWeight(confidence: number): number {
  return clamp(confidence * 2, 0.25, 2);
}

/**
 * Deterministic answer scoring. MCQ compares against the option key;
 * fill_blank is case-insensitive after trimming; short_answer is an exact
 * match. Rubric/AI scoring is deliberately out of scope for this MVP.
 */
function isCorrect(question: QuestionRow, answer: string): boolean {
  if (typeof answer !== 'string') return false;
  const expected = String(question.expected_answer);
  switch (String(question.question_type).toLowerCase()) {
    case 'mcq':
    case 'multiple_choice':
      return answer.trim() === expected.trim();
    case 'fill_blank':
    case 'fill-in-blank':
      return answer.trim().toLowerCase() === expected.trim().toLowerCase();
    case 'short_answer':
    case 'short-answer':
      return answer.trim() === expected.trim();
    default:
      return false;
  }
}

/**
 * Curated, moderated question bank placement. No LLM-generated question ever
 * enters the scoring path: only rows in placement_questions are served.
 *
 * The tables are intentionally absent from schema.prisma (peer-owned); all
 * access goes through tagged raw queries with bound values and ::uuid casts.
 */
@Injectable()
export class PlacementService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly proficiency: ProficiencyService,
  ) {}

  /** Return public, validated questions for a session (never expected answers). */
  async getSessionQuestions(userId: string, sessionId: string): Promise<{
    sessionId: string;
    language: string;
    skill: string;
    questions: PlacementQuestion[];
  }> {
    const session = await this.ownedSession(userId, sessionId);
    const questions = await this.prisma.$queryRaw<QuestionRow[]>`
      SELECT id, language, skill, cefr_level, question_text, question_type,
             options, expected_answer, difficulty
      FROM placement_questions
      WHERE is_active = true AND id = ANY(${session.question_ids}::uuid[])
      ORDER BY cefr_level ASC, id ASC
    `;
    return {
      sessionId: session.id,
      language: session.language,
      skill: session.skill,
      questions: questions.map(toQuestion),
    };
  }

  /**
   * Start a stratified session: two active, moderated questions per CEFR band,
   * drawn from the bank with random ordering within each band.
   */
  async startSession(
    userId: string,
    dto: StartPlacementInput,
  ): Promise<{ sessionId: string; questions: PlacementQuestion[] }> {
    const language = normalizeChoice(
      dto.language,
      PROFICIENCY_LANGUAGES,
      'language',
    );
    const skill = normalizeChoice(dto.skill, PROFICIENCY_SKILLS, 'skill');

    return this.prisma.$transaction(async (tx) => {
      const candidates = await tx.$queryRaw<QuestionRow[]>`
        WITH ranked AS (
          SELECT q.*, ROW_NUMBER() OVER (
            PARTITION BY q.cefr_level ORDER BY random(), q.id
          ) AS rn
          FROM placement_questions q
          WHERE q.is_active = true
            AND q.language = ${language}
            AND q.skill = ${skill}
            AND q.cefr_level = ANY(${[...PLACEMENT_CEFR_LEVELS]}::varchar[])
        )
        SELECT id, language, skill, cefr_level, question_text, question_type,
               options, expected_answer, difficulty
        FROM ranked
        WHERE rn <= ${QUESTIONS_PER_LEVEL}
        ORDER BY cefr_level ASC, rn ASC
      `;

      const selected: QuestionRow[] = [];
      for (const band of PLACEMENT_CEFR_LEVELS) {
        const inBand = candidates.filter(
          (question) => question.cefr_level.toUpperCase() === band,
        );
        if (inBand.length === 0) {
          throw new BadRequestException(
            `No moderated placement questions available for ${language}/${skill} at ${band}`,
          );
        }
        selected.push(...inBand.slice(0, QUESTIONS_PER_LEVEL));
      }

      const questionIds = selected.map((question) => question.id);
      const rows = await tx.$queryRaw<Array<{ id: string }>>`
        INSERT INTO placement_sessions
          (user_id, language, skill, status, question_ids, responses)
        VALUES
          (${userId}::uuid, ${language}, ${skill}, 'in_progress',
           ${questionIds}::uuid[], '[]'::jsonb)
        RETURNING id
      `;
      return { sessionId: rows[0].id, questions: selected.map(toQuestion) };
    });
  }

  /** Record one deterministic answer. Scoring is never derived from an LLM. */
  async submitResponse(
    userId: string,
    sessionId: string,
    dto: SubmitPlacementResponseInput,
  ): Promise<{ sessionId: string; answered: number; total: number }> {
    if (!dto || typeof dto.questionId !== 'string' || !isValidUuid(dto.questionId)) {
      throw new BadRequestException('A valid questionId is required');
    }
    if (typeof dto.answer !== 'string' || dto.answer.length > 2000) {
      throw new BadRequestException('answer must be a string of at most 2000 characters');
    }

    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT 1 FROM pg_advisory_xact_lock(hashtextextended(${`placement:${sessionId}`}, 0))`;
      const session = await this.ownedSession(userId, sessionId, tx);
      if (session.status !== 'in_progress') {
        throw new ConflictException('Placement session is not in progress');
      }
      if (!session.question_ids.includes(dto.questionId)) {
        throw new BadRequestException('Question does not belong to this session');
      }

      const answers = parseAnswers(session.responses);
      if (answers.some((answer) => answer.questionId === dto.questionId)) {
        throw new ConflictException('Question already answered in this session');
      }
      const questions = await tx.$queryRaw<QuestionRow[]>`
        SELECT id, language, skill, cefr_level, question_text, question_type,
               options, expected_answer, difficulty
        FROM placement_questions
        WHERE is_active = true AND id = ${dto.questionId}::uuid
        LIMIT 1
      `;
      const question = questions[0];
      if (!question) {
        throw new NotFoundException('Placement question not found');
      }
      answers.push({
        questionId: dto.questionId,
        correct: isCorrect(question, dto.answer),
        expectedAnswer: String(question.expected_answer),
        answer: dto.answer,
      });

      await tx.$queryRaw`
        UPDATE placement_sessions
        SET responses = ${JSON.stringify(answers)}::jsonb
        WHERE id = ${sessionId}::uuid AND user_id = ${userId}::uuid
      `;
      return {
        sessionId: session.id,
        answered: answers.length,
        total: session.question_ids.length,
      };
    });
  }

  /**
   * Finish a session, persist score/total/CEFR/confidence, and feed exactly one
   * weighted evidence observation into ProficiencyService.
   */
  async completeSession(
    userId: string,
    sessionId: string,
  ): Promise<PlacementResult> {
    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT 1 FROM pg_advisory_xact_lock(hashtextextended(${`placement:${sessionId}`}, 0))`;
      const session = await this.ownedSession(userId, sessionId, tx);
      if (session.status === 'completed') {
        throw new ConflictException('Placement session already completed');
      }
      if (session.status !== 'in_progress') {
        throw new ConflictException('Placement session is not in progress');
      }

      const answers = parseAnswers(session.responses);
      if (answers.length === 0) {
        throw new BadRequestException('Cannot complete a session with no answers');
      }
      const questionRows = await tx.$queryRaw<QuestionRow[]>`
        SELECT id, language, skill, cefr_level, question_text, question_type,
               options, expected_answer, difficulty
        FROM placement_questions
        WHERE is_active = true AND id = ANY(${session.question_ids}::uuid[])
      `;
      const difficulties = questionRows
        .filter((question) => answers.some((answer) => answer.questionId === question.id))
        .map((question) => Number(question.difficulty))
        .filter((value) => Number.isFinite(value));

      const score = answers.filter((answer) => answer.correct).length;
      const total = answers.length;
      const cefrEstimate: CefrBand = CEFR_BANDS[cefrOrdinalForRatio(score, total)];
      const confidence = placementConfidence(score, total, difficulties);

      const updated = await tx.$queryRaw<SessionRow[]>`
        UPDATE placement_sessions
        SET status = 'completed',
            score = ${score},
            total = ${total},
            cefr_estimate = ${cefrEstimate},
            confidence = ${confidence},
            completed_at = CURRENT_TIMESTAMP
        WHERE id = ${sessionId}::uuid
          AND user_id = ${userId}::uuid
          AND status = 'in_progress'
        RETURNING id, user_id, language, skill, status, question_ids, responses,
                  score, total, cefr_estimate, confidence, started_at, completed_at
      `;
      const completed = updated[0];
      if (!completed) {
        throw new ConflictException('Placement session could not be completed');
      }

      const evidence: SkillEvidence = {
        language: completed.language,
        skill: completed.skill,
        score,
        total,
        weight: confidenceToEvidenceWeight(confidence),
      };
      const proficiency = await this.proficiency.recordEvidence(userId, evidence);

      return {
        sessionId: completed.id,
        userId,
        language: completed.language,
        skill: completed.skill,
        status: 'completed',
        score,
        total,
        cefrEstimate,
        confidence,
        needsMoreEvidence:
          proficiency.evidenceCount < MIN_EVIDENCE_FOR_CONFIDENT ||
          confidence < 0.7,
        answers,
        proficiency,
      };
    });
  }

  /** Read a session with ownership enforced by user_id, never a client id. */
  async getSession(userId: string, sessionId: string): Promise<PlacementSessionView> {
    const session = await this.ownedSession(userId, sessionId);
    if (session.status !== 'completed') {
      throw new ConflictException('Placement session is not completed');
    }
    const answers = parseAnswers(session.responses);
    const score = Number(session.score);
    const total = Number(session.total);
    const confidence = Number(session.confidence);
    const proficiency = await this.proficiency.getSummary(userId, session.language);
    const item =
      proficiency.items.find(
        (entry) =>
          entry.language === session.language && entry.skill === session.skill,
      ) ?? null;
    return {
      sessionId: session.id,
      userId,
      language: session.language,
      skill: session.skill,
      status: 'completed',
      score,
      total,
      cefrEstimate: String(session.cefr_estimate),
      confidence,
      needsMoreEvidence:
        item !== null
          ? item.needsMoreEvidence
          : confidence < 0.7,
      answers,
      proficiency: item ?? {
        language: session.language,
        skill: session.skill,
        cefrEstimate: CEFR_BANDS[cefrOrdinalForRatio(score, total)],
        cefrOrdinal: cefrOrdinalForRatio(score, total),
        confidence,
        evidenceCount: 0,
        needsMoreEvidence: true,
        updatedAt: new Date(session.completed_at as Date | string).toISOString(),
      },
      startedAt: new Date(session.started_at).toISOString(),
      completedAt: new Date(session.completed_at as Date | string).toISOString(),
    };
  }

  private async ownedSession(
    userId: string,
    sessionId: string,
    client: Prisma.TransactionClient | PrismaService = this.prisma,
  ): Promise<SessionRow> {
    if (!isValidUuid(sessionId)) {
      throw new BadRequestException('Invalid placement session id');
    }
    const rows = await client.$queryRaw<SessionRow[]>`
      SELECT id, user_id, language, skill, status, question_ids, responses,
             score, total, cefr_estimate, confidence, started_at, completed_at
      FROM placement_sessions
      WHERE id = ${sessionId}::uuid AND user_id = ${userId}::uuid
      LIMIT 1
    `;
    const session = rows[0];
    if (!session) throw new NotFoundException('Placement session not found');
    return session;
  }
}
