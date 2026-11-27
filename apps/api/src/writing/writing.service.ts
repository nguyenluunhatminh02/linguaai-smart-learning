import { Injectable } from '@nestjs/common';
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
}

@Injectable()
export class WritingService {
  constructor(
    private prisma: PrismaService,
    private aiClient: AiClientService,
  ) {}

  async assess(userId: string, dto: AssessWritingDto) {
    const aiResult = await this.aiClient.post<AiAssessmentResult>('/ai/writing/assess', {
      user_text: dto.userText,
      language: dto.language || 'english',
      target_level: dto.targetLevel || 'B1',
    });

    const submission = await this.prisma.writing_submissions.create({
      data: {
        user_id: userId,
        prompt_text: dto.promptText,
        user_text: dto.userText,
        ai_feedback: aiResult as any,
        score: aiResult.scores as any,
        language: (dto.language || 'english').toLowerCase(),
      },
    });

    const rawScore = aiResult.overall_score ?? aiResult.scores?.overall ?? 5;
    // W3: handle multiple scales — model may return 0-1, 1-10, or 0-100. Clamp to [0,100].
    const normalized =
      rawScore <= 1 ? rawScore * 100 : rawScore <= 10 ? rawScore * 10 : rawScore;
    const overallScore = Math.max(0, Math.min(100, Math.round(normalized)));
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
        grammar: aiResult.scores?.grammar,
        vocabulary: aiResult.scores?.vocabulary,
        coherence: aiResult.scores?.coherence,
        taskAchievement: aiResult.scores?.task_achievement,
        overall: aiResult.scores?.overall,
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
        message: 'Not enough writing history for analysis. Submit at least one writing for assessment first.',
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

    // Estimate level from most recent submission scores
    const latestAi = (submissions[0]?.ai_feedback as any) || {};
    const overallScore = latestAi.scores?.overall ?? latestAi.overall_score ?? 5;
    const level = overallScore >= 8 ? 'C1' : overallScore >= 6 ? 'B2' : overallScore >= 4 ? 'B1' : 'A2';

    const analysis = await this.aiClient.post<Record<string, unknown>>('/ai/errors/analyze', {
      errors: allErrors,
      language: detectedLanguage,
      level,
    });

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
      const rawScore = ai.overall_score ?? ai.scores?.overall ?? 0;
      return {
        id: item.id,
        userText: item.user_text,
        language: item.language,
        createdAt: item.created_at,
        overallScore: Math.round(rawScore * 10),
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
          grammar: ai.scores?.grammar,
          vocabulary: ai.scores?.vocabulary,
          coherence: ai.scores?.coherence,
          taskAchievement: ai.scores?.task_achievement,
        },
      };
    });
    return { items: mapped, total, page, pageSize: limit, totalPages: Math.ceil(total / limit) };
  }

  async getById(id: string) {
    const item = await this.prisma.writing_submissions.findUnique({ where: { id } });
    if (!item) return null;
    const ai = (item.ai_feedback as any) || {};
    const rawScore = ai.overall_score ?? ai.scores?.overall ?? 0;
    return {
      id: item.id,
      userText: item.user_text,
      language: item.language,
      createdAt: item.created_at,
      overallScore: Math.round(rawScore * 10),
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
