import {
  Controller,
  Post,
  Get,
  Body,
  Param,
  Query,
  UseGuards,
  ParseUUIDPipe,
  ParseIntPipe,
  Headers,
  ConflictException,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiTags,
  ApiOperation,
  ApiQuery,
} from '@nestjs/swagger';
import { createHash, randomUUID } from 'crypto';
import { WritingService } from './writing.service';
import { AssessWritingDto } from './dto/writing.dto';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { TokensService } from '../tokens/tokens.service';
import { PrismaService } from '../prisma/prisma.service';

const MAX_HISTORY_LIMIT = 100;
const MAX_ERROR_ANALYSIS_LIMIT = 20;
const ERROR_ANALYSIS_COST = 10; // matches TokensService.COSTS.speaking_feedback
const ERROR_ANALYSIS_CACHE_TTL_MS = 5 * 60 * 1000;
const ERROR_ANALYSIS_CACHE_MAX = 200;

@ApiTags('Writing')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('writing')
export class WritingController {
  private readonly analysisCache = new Map<
    string,
    { expiresAt: number; result: unknown }
  >();

  constructor(
    private writingService: WritingService,
    private tokensService: TokensService,
    private prisma: PrismaService,
  ) {}

  /** Scope a client key to this user and this exact request so replays cannot be reused across users/payloads. */
  private buildAssessKey(
    userId: string,
    dto: AssessWritingDto,
    clientKey: string,
  ): string {
    const digest = createHash('sha256')
      .update(
        JSON.stringify([
          userId,
          clientKey,
          dto.userText,
          dto.language ?? '',
          dto.promptText ?? '',
          dto.targetLevel ?? '',
        ]),
      )
      .digest('hex');
    // token_transactions.idempotency_key is VarChar(128).
    return `writing-assess:${userId}:${digest}`;
  }

  private clampLimit(
    value: number | undefined,
    fallback: number,
    max: number,
  ): number {
    if (value === undefined || !Number.isFinite(value)) return fallback;
    return Math.min(max, Math.max(1, Math.trunc(value)));
  }

  @Post('assess')
  @ApiOperation({ summary: 'Submit writing for AI assessment' })
  async assess(
    @CurrentUser('id') userId: string,
    @Body() dto: AssessWritingDto,
    @Headers('idempotency-key') clientKey?: string,
  ) {
    // A missing client key still gets a stable per-request key so retries of
    // the same submission cannot double-charge or double-run the AI call.
    const key = this.buildAssessKey(userId, dto, clientKey || randomUUID());
    await this.tokensService.consumeTokens(
      userId,
      'writing_feedback',
      undefined,
      key,
    );

    // TokensService returns a hit without debiting: verify the charged key is
    // actually a transaction belonging to this user before doing any AI work.
    const transaction = await this.prisma.token_transactions.findUnique({
      where: { idempotency_key: key },
      select: { user_id: true, feature: true, amount: true },
    });
    if (
      !transaction ||
      transaction.user_id !== userId ||
      transaction.feature !== 'writing_feedback' ||
      transaction.amount >= 0
    ) {
      throw new ConflictException(
        'Duplicate or invalid idempotency key for this user.',
      );
    }

    // A true replay must not run a fresh paid assessment. Reuse an identical
    // prior submission by this user (the AI payload is persisted with it).
    const submission = await this.prisma.writing_submissions.findFirst({
      where: {
        user_id: userId,
        user_text: dto.userText,
        prompt_text: dto.promptText ?? null,
        language: (dto.language || 'english').toLowerCase(),
      },
      orderBy: { created_at: 'desc' },
      select: {
        id: true,
        user_text: true,
        language: true,
        created_at: true,
        ai_feedback: true,
        score: true,
      },
    });
    if (submission) {
      return this.toAssessmentResult(submission, dto);
    }

    return this.writingService.assess(userId, dto);
  }

  /** Rebuild the frontend response from a stored submission (ai_feedback holds the raw AI payload). */
  private toAssessmentResult(
    submission: {
      id: string;
      user_text: string;
      language: string;
      created_at: Date;
      ai_feedback: unknown;
      score: unknown;
    },
    dto: AssessWritingDto,
  ) {
    const ai = (submission.ai_feedback || {}) as Record<string, any>;
    const scores = ai.scores || {};
    const rawScore = ai.overall_score ?? scores.overall ?? 5;
    const normalized =
      rawScore <= 1
        ? rawScore * 100
        : rawScore <= 10
          ? rawScore * 10
          : rawScore;
    return {
      id: submission.id,
      overallScore: Math.max(0, Math.min(100, Math.round(normalized))),
      feedback: ai.feedback || '',
      errors: (ai.errors || []).map((e: any) => ({
        original: e.original,
        correction: e.correction ?? e.corrected ?? '',
        explanation: e.explanation,
        type: e.type || 'error',
      })),
      suggestions: ai.tips || ai.suggestions || [],
      rewrittenText: ai.corrected_text || null,
      scores: {
        grammar: scores.grammar,
        vocabulary: scores.vocabulary,
        coherence: scores.coherence,
        taskAchievement: scores.task_achievement,
        overall: scores.overall,
      },
      language: submission.language,
      targetLevel: dto.targetLevel || 'B1',
      createdAt: submission.created_at,
      userText: submission.user_text,
    };
  }

  @Get('error-analysis')
  @ApiOperation({
    summary: 'Analyze writing error patterns and get targeted exercises',
    description:
      'Aggregates errors from recent writing submissions and uses AI to identify weaknesses and generate exercises.',
  })
  @ApiQuery({ name: 'language', required: false, example: 'english' })
  @ApiQuery({
    name: 'limit',
    required: false,
    description: 'Number of recent submissions to analyze (default 20, max 20)',
  })
  async analyzeErrors(
    @CurrentUser('id') userId: string,
    @Query('language') language?: string,
    @Query('limit', new ParseIntPipe({ optional: true })) limit?: number,
    @Headers('idempotency-key') clientKey?: string,
  ) {
    const lang = language || 'english';
    const safeLimit = this.clampLimit(limit, 20, MAX_ERROR_ANALYSIS_LIMIT);

    // Error analysis is a paid LLM call. Derive a stable per-user/per-parameter
    // key so repeated polls within the TTL are charged once and never trigger
    // a new AI completion; callers can opt out by supplying their own key.
    const key = `writing-errors:${userId}:${createHash('sha256')
      .update(JSON.stringify([userId, lang, safeLimit, clientKey || 'cache']))
      .digest('hex')}`;
    const cacheKey = `${userId}:${lang.toLowerCase()}:${safeLimit}`;
    const cached = this.analysisCache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) {
      // Still verify the charge exists, so a cache entry can never bypass
      // token accounting (e.g. after a balance reset or process restart).
      const cachedTransaction = await this.prisma.token_transactions.findUnique(
        {
          where: { idempotency_key: key },
          select: { id: true },
        },
      );
      if (cachedTransaction) {
        return cached.result;
      }
      this.analysisCache.delete(cacheKey);
    }

    await this.tokensService.consumeTokens(
      // TokensService only knows features in its server-side COSTS map; the
      // existing speaking_feedback feature has the same 10-unit AI cost.
      userId,
      'speaking_feedback',
      undefined,
      key,
    );
    const transaction = await this.prisma.token_transactions.findUnique({
      where: { idempotency_key: key },
      select: { user_id: true, feature: true, amount: true },
    });
    if (
      !transaction ||
      transaction.user_id !== userId ||
      transaction.feature !== 'speaking_feedback' ||
      transaction.amount !== -ERROR_ANALYSIS_COST
    ) {
      throw new ConflictException(
        'Duplicate or invalid idempotency key for this user.',
      );
    }

    const result = await this.writingService.analyzeErrors(
      userId,
      lang,
      safeLimit,
    );
    if (this.analysisCache.size >= ERROR_ANALYSIS_CACHE_MAX) {
      const oldest = this.analysisCache.keys().next().value as
        | string
        | undefined;
      if (oldest) this.analysisCache.delete(oldest);
    }
    this.analysisCache.set(cacheKey, {
      expiresAt: Date.now() + ERROR_ANALYSIS_CACHE_TTL_MS,
      result,
    });
    return result;
  }

  @Get('history')
  @ApiOperation({ summary: 'Get writing submission history' })
  @ApiQuery({ name: 'page', required: false })
  @ApiQuery({
    name: 'limit',
    required: false,
    description: '1-100 (default 10)',
  })
  @ApiQuery({ name: 'language', required: false })
  getHistory(
    @CurrentUser('id') userId: string,
    @Query('page', new ParseIntPipe({ optional: true })) page?: number,
    @Query('limit', new ParseIntPipe({ optional: true })) limit?: number,
    @Query('language') language?: string,
  ) {
    const safePage = Math.max(1, Math.trunc(page ?? 1));
    const safeLimit = this.clampLimit(limit, 10, MAX_HISTORY_LIMIT);
    return this.writingService.getHistory(
      userId,
      safePage,
      safeLimit,
      language,
    );
  }

  @Get(':id')
  @ApiOperation({
    summary: 'Get a single writing submission owned by the caller',
  })
  getById(
    @CurrentUser('id') userId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    // The service scopes the lookup by owner, so another user's UUID is a 404
    // rather than a disclosure of their essay and AI feedback.
    return this.writingService.getById(userId, id);
  }
}
