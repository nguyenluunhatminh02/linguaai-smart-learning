import {
  Controller,
  Post,
  Get,
  Body,
  Param,
  Query,
  UseGuards,
  ParseUUIDPipe,
  Headers,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiTags,
  ApiOperation,
  ApiQuery,
} from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { ReadingService } from './reading.service';
import { GenerateReadingDto, AnalyzeTextDto } from './dto/reading.dto';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { TokensService } from '../tokens/tokens.service';

@ApiTags('Reading')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('reading')
export class ReadingController {
  constructor(
    private readingService: ReadingService,
    private tokensService: TokensService,
  ) {}

  @Post('generate')
  @ApiOperation({ summary: 'Generate a reading passage with AI' })
  async generate(
    @CurrentUser('id') userId: string,
    @Body() dto: GenerateReadingDto,
    @Headers('idempotency-key') idempotencyKey?: string,
  ) {
    // Namespace the idempotency key per user so one user cannot suppress
    // another's token charge by replaying a known/guessed key.
    const namespacedKey = idempotencyKey
      ? `${userId}:${idempotencyKey}`
      : undefined;
    await this.tokensService.consumeTokens(
      userId,
      'reading_generate',
      undefined,
      namespacedKey,
    );
    return this.readingService.generate(userId, dto);
  }

  @Post('analyze-text')
  @Throttle({ default: { ttl: 60000, limit: 10 } })
  @ApiOperation({
    summary: 'NLP analysis of a text passage',
    description:
      'Returns linguistic features: readability score, CEFR level estimate, keywords, ' +
      'vocabulary complexity, grammar patterns. Useful before creating study materials.',
  })
  async analyzeText(
    @CurrentUser('id') userId: string,
    @Body() dto: AnalyzeTextDto,
  ) {
    // Charge tokens to prevent unlimited free AI spend.
    await this.tokensService.consumeTokens(userId, 'translation_ai');
    return this.readingService.analyzeText(dto.text, dto.language || 'english');
  }

  @Get('recommendations')
  @ApiOperation({
    summary: 'Get personalized reading topic recommendations',
    description:
      'Returns ranked topic suggestions based on reading history. Excludes recently read topics.',
  })
  @ApiQuery({ name: 'language', required: false, example: 'english' })
  @ApiQuery({
    name: 'limit',
    required: false,
    description: 'Number of topics to return (default 5)',
  })
  getRecommendations(
    @CurrentUser('id') userId: string,
    @Query('language') language?: string,
    @Query('limit') limit?: number,
  ) {
    // Clamp limit to a safe range to prevent resource abuse.
    const safeLimit = Math.min(Math.max(Number(limit) || 5, 1), 50);
    return this.readingService.getRecommendations(
      userId,
      language || 'english',
      safeLimit,
    );
  }

  @Get('history')
  @ApiOperation({ summary: 'Get reading passage history' })
  @ApiQuery({ name: 'page', required: false })
  @ApiQuery({ name: 'limit', required: false })
  getHistory(
    @CurrentUser('id') userId: string,
    @Query('page') page?: number,
    @Query('limit') limit?: number,
  ) {
    // Clamp pagination params to safe ranges to prevent DoS via huge/negative values.
    const safePage = Math.min(Math.max(Number(page) || 1, 1), 10000);
    const safeLimit = Math.min(Math.max(Number(limit) || 10, 1), 100);
    return this.readingService.getHistory(userId, safePage, safeLimit);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get a reading passage by ID' })
  getById(
    @CurrentUser('id') userId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.readingService.getById(userId, id);
  }
}
