import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AiClientService } from '../common/services/ai-client.service';
import { AssessWritingDto } from './dto/writing.dto';

export interface WritingError {
  original: string;
  correction?: string;
  corrected?: string;
  explanation: string;
  type?: string;
}

export interface AiAssessmentResult {
  overall_score?: number;
  scopes?: {
    overall?: number;
    grammar?: number;
    vocabulary?: number;
    coherence?: number;
    task_achievement?: number;
  };
  scores?: {
    overall?: number;
    grammar?: number;
    vocabulary?: number;
    coherence?: number;
    task_achievement?: number;
  };
  feedback?: string;
  errors?: WritingError[];
  tips?: string[];
  suggestions?: string[];
  corrected_text?: string;
  /** Explicit max score from AI (e.g., 10, 100). Prefer over prompt-default. */
  maxScore?: number;
  /** Explicit score scale from AI (e.g., 10, 100). Prefer over prompt-default. */
  scoreScale?: number;
}

/**
 * DB-10: Single normalization boundary.
 * Converts any raw score to a 0-100 integer using an explicit maxScore.
 * Rejects non-finite values; clamps to [0, maxScore] before scaling.
 * Never guesses the scale from magnitude.
 */
function normalizeScore(raw: unknown, maxScore: number): number {
  if (typeof raw !== 'number' || !Number.isFinite(raw)) return 0;
  if (!Number.isFinite(maxScore) || maxScore <= 0) return 0;
  const clamped = Math.max(0, Math.min(maxScore, raw));
  return Math.round((clamped / maxScore) * 100);
}

/**
 * Normalize a score only if it's defined; otherwise return undefined.
 * Preserves existing behavior for missing rubric scores.
 */
function normalizeOptional(raw: unknown, maxScore: number): number | undefined {
  if (raw === undefined || raw === null) return undefined;
  return normalizeScore(raw, maxScore);
}

/**
 * Resolve the score envelope from an AI payload.
 * Prefers explicit maxScore/scoreScale metadata; otherwise defaults to the
 * documented writing prompt scale (1-10). Returns the maxScore and a
 * source tag so callers can mark legacy rows as prompt-default.
 */
function resolveScoreEnvelope(ai: Record<string, any>): {
  maxScore: number;
  scaleSource: 'explicit' | 'prompt-default';
} {
  if (typeof ai.maxScore === 'number' && ai.maxScore > 0) {
    return { maxScore: ai.maxScore, scaleSource: 'explicit' };
  }
  if (typeof ai.scoreScale === 'number' && ai.scoreScale > 0) {
    return { maxScore: ai.scoreScale, scaleSource: 'explicit' };
  }
  // Current writing prompt requests 1-10. Legacy rows without metadata
  // are assumed to use this scale; callers must not reinterpret silently.
  return { maxScore: 10, scaleSource: 'prompt-default' };
}

@Injectable()
export class WritingService {
  constructor(
    private prisma: PrismaService,
    private aiClient: AiClientService,
  ) {}

  async assess(userId: string, dto: AssessWritingDto) {
    const aiResult = await this.aiClient.post<AiAssessmentResult>(
      '/ai/writing/assess',
      {
        user_text: dto.userText,
        language: dto.language || 'english',
        target_level: dto.targetLevel || 'B1',
      },
    );

    const envelope = resolveScoreEnvelope(aiResult as any);
    const maxScore = envelope.maxScore;
    const rawScore = aiResult.overall_score ?? aiResult.scores?.overall ?? 5;
    const overallScore = normalizeScore(rawScore, maxScore);

    // Persist the raw AI payload plus explicit scale metadata so reads replay
    // the same boundary. Legacy rows without metadata use the prompt-default
    // scale recorded via resolveScoreEnvelope.
    const persistedAiFeedback = {
      ...aiResult,
      maxScore: aiResult.maxScore ?? aiResult.scoreScale ?? maxScore,
      scoreScale: aiResult.scoreScale ?? aiResult.maxScore ?? maxScore,
      scoreScaleSource: envelope.scaleSource,
    };

    const submission = await this.prisma.writing_submissions.create({
      data: {
        user_id: userId,
        prompt_text: dto.promptText,
        user_text: dto.userText,
        ai_feedback: persistedAiFeedback as any,
        score: {
          ...(aiResult.scores || {}),
          overall: normalizeOptional(rawScore, maxScore) ?? 0,
        } as any,
        language: (dto.language || 'english').toLowerCase(),
      },
    });

    return {
      id: submission.id,
      overallScore,
      feedback: aiResult.feedback || '',
      errors: (aiResult.errors || []).map((e: WritingError) => ({
        original: e.original,
        correction: e.correction ?? e.corrected ?? '',
        explanation: e.explanation,
        type: e.type || 'error',
      })),
      suggestions: aiResult.tips || aiResult.suggestions || [],
      rewrittenText: aiResult.corrected_text || null,
      scores: {
        grammar: normalizeOptional(aiResult.scores?.grammar, maxScore),
        vocabulary: normalizeOptional(aiResult.scores?.vocabulary, maxScore),
        coherence: normalizeOptional(aiResult.scores?.coherence, maxScore),
        taskAchievement: normalizeOptional(
          aiResult.scores?.task_achievement,
          maxScore,
        ),
        overall: normalizeOptional(aiResult.scores?.overall, maxScore),
      },
      language: dto.language || 'english',
      targetLevel: dto.targetLevel || 'B1',
      createdAt: submission.created_at,
      userText: dto.userText,
    };
  }

  async analyzeErrors(userId: string, language = 'english', limit = 20) {
    const submissions = await this.prisma.writing_submissions.findMany({
      where: {
        user_id: userId,
        language: language.toLowerCase(),
      },
      orderBy: { created_at: 'desc' },
      take: limit,
    });

    // Aggregate all raw errors from stored AI feedback
    const allErrors: Array<{
      type: string;
      original: string;
      correction: string;
      explanation: string;
    }> = [];

    let detectedLanguage = language;
    for (const s of submissions) {
      const ai = (s.ai_feedback as any) || {};
      if (ai.errors && Array.isArray(ai.errors)) {
        for (const e of ai.errors) {
          allErrors.push({
            type: e.type || 'grammar',
            original: e.original || '',
            correction: e.correction ?? e.corrected ?? '',
            explanation: e.explanation || '',
          });
        }
      }
      if (s.language) detectedLanguage = s.language;
    }

    if (allErrors.length === 0) {
      // W1 fix: include all fields frontend expects to avoid `undefined` renders.
      return {
        message:
          'Not enough writing history for analysis. Submit at least one writing for assessment first.',
        analyzedSubmissions: submissions.length,
        totalErrors: 0,
        level: 'B1',
        summary:
          submissions.length === 0
            ? 'Chưa có bài viết nào. Hãy gửi bài viết đầu tiên ở tab Write để hệ thống có thể phân tích lỗi và đề xuất bài tập.'
            : 'Bài viết của bạn không có lỗi đáng kể. Hãy thử bài viết khó hơn hoặc với target level cao hơn.',
        priority_focus: 'No errors yet',
        patterns: [],
        exercises: [],
        errors: [],
      };
    }

    // Estimate level from the most recent submission using the same 0-100
    // normalization boundary as assess/history/detail.
    const latestAi = (submissions[0]?.ai_feedback as any) || {};
    const latestEnvelope = resolveScoreEnvelope(latestAi);
    const latestRaw = latestAi.scores?.overall ?? latestAi.overall_score ?? 5;
    const normalizedScore = normalizeScore(latestRaw, latestEnvelope.maxScore);
    const level =
      normalizedScore >= 80
        ? 'C1'
        : normalizedScore >= 60
          ? 'B2'
          : normalizedScore >= 40
            ? 'B1'
            : 'A2';

    const analysis = await this.aiClient.post<Record<string, unknown>>(
      '/ai/errors/analyze',
      {
        errors: allErrors,
        language: detectedLanguage,
        level,
      },
    );

    return {
      analyzedSubmissions: submissions.length,
      totalErrors: allErrors.length,
      level,
      ...analysis,
    };
  }

  async getHistory(userId: string, page = 1, limit = 10, language?: string) {
    const skip = (page - 1) * limit;
    const where: any = { user_id: userId };
    if (language) {
      where.language = language.toLowerCase();
    }
    const [items, total] = await Promise.all([
      this.prisma.writing_submissions.findMany({
        where,
        skip,
        take: limit,
        orderBy: { created_at: 'desc' },
      }),
      this.prisma.writing_submissions.count({ where }),
    ]);
    const mapped = items.map((item) => {
      const ai = (item.ai_feedback as any) || {};
      const envelope = resolveScoreEnvelope(ai);
      const rawScore = ai.overall_score ?? ai.scores?.overall ?? 0;
      return {
        id: item.id,
        userText: item.user_text,
        language: item.language,
        createdAt: item.created_at,
        overallScore: normalizeScore(rawScore, envelope.maxScore),
        errorCount: ai.errors?.length ?? 0,
        feedback: ai.feedback ?? '',
        rewrittenText: ai.corrected_text ?? null,
        suggestions: ai.tips ?? ai.suggestions ?? [],
        errors: (ai.errors ?? []).map((e: WritingError) => ({
          original: e.original,
          correction: e.correction ?? e.corrected ?? '',
          explanation: e.explanation,
          type: e.type || 'error',
        })),
        scores: {
          grammar: normalizeOptional(ai.scores?.grammar, envelope.maxScore),
          vocabulary: normalizeOptional(
            ai.scores?.vocabulary,
            envelope.maxScore,
          ),
          coherence: normalizeOptional(ai.scores?.coherence, envelope.maxScore),
          taskAchievement: normalizeOptional(
            ai.scores?.task_achievement,
            envelope.maxScore,
          ),
        },
      };
    });
    return {
      items: mapped,
      total,
      page,
      pageSize: limit,
      totalPages: Math.ceil(total / limit),
    };
  }

  /** Read a single submission only when it belongs to the authenticated user. */
  async getById(userId: string, id: string) {
    const item = await this.prisma.writing_submissions.findFirst({
      where: { id, user_id: userId },
    });
    if (!item) throw new NotFoundException('Writing submission not found');
    const ai = (item.ai_feedback as any) || {};
    const envelope = resolveScoreEnvelope(ai);
    const rawScore = ai.overall_score ?? ai.scores?.overall ?? 0;
    return {
      id: item.id,
      userText: item.user_text,
      language: item.language,
      createdAt: item.created_at,
      overallScore: normalizeScore(rawScore, envelope.maxScore),
      feedback: ai.feedback ?? '',
      rewrittenText: ai.corrected_text ?? null,
      suggestions: ai.tips ?? ai.suggestions ?? [],
      errors: (ai.errors ?? []).map((e: WritingError) => ({
        original: e.original,
        correction: e.correction ?? e.corrected ?? '',
        explanation: e.explanation,
        type: e.type || 'error',
      })),
      scores: {
        grammar: ai.scores?.grammar,
        vocabulary: ai.scores?.vocabulary,
        coherence: ai.scores?.coherence,
        taskAchievement: ai.scores?.task_achievement,
      },
    };
  }
}
