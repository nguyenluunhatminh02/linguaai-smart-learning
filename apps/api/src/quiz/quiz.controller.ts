import {
  Controller, Get, Post, Delete,
  Body, Param, Query, UseGuards, ParseUUIDPipe, Headers,
  ForbiddenException, NotFoundException,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags, ApiOperation, ApiQuery } from '@nestjs/swagger';
import { QuizService } from './quiz.service';
import { CreateQuizDto, SubmitQuizDto, AdaptiveNextDto, GenerateQuizDto } from './dto/quiz.dto';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { TokensService } from '../tokens/tokens.service';
import { PrismaService } from '../prisma/prisma.service';

@ApiTags('Quiz')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('quiz')
export class QuizController {
  constructor(
    private quizService: QuizService,
    private tokensService: TokensService,
    private prisma: PrismaService,
  ) {}

  @Post()
  @ApiOperation({ summary: 'Create a new quiz' })
  create(@CurrentUser('id') userId: string, @Body() dto: CreateQuizDto) {
    return this.quizService.create(userId, dto);
  }

  @Post('generate-from-topic')
  @ApiOperation({
    summary: 'Auto-generate a complete quiz from a topic using AI',
    description:
      'AI creates quiz questions with mixed types (MCQ, true/false, fill-blank) ' +
      'for a given topic and level. Quiz is saved to DB immediately.',
  })
  async generateFromTopic(
    @CurrentUser('id') userId: string,
    @Body() dto: GenerateQuizDto,
    @Headers('idempotency-key') idempotencyKey?: string,
  ) {
    await this.tokensService.consumeTokens(userId, 'quiz_generate', undefined, idempotencyKey);
    return this.quizService.generateFromTopic(userId, dto);
  }

  @Get()
  @ApiOperation({ summary: 'Get all quizzes' })
  @ApiQuery({ name: 'page', required: false })
  @ApiQuery({ name: 'limit', required: false })
  @ApiQuery({ name: 'language', required: false })
  findAll(
    @Query('page') page?: number,
    @Query('limit') limit?: number,
    @Query('language') language?: string,
  ) {
    return this.quizService.findAll(page || 1, limit || 20, language);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get quiz by ID with questions' })
  findById(@Param('id', ParseUUIDPipe) id: string) {
    return this.quizService.getQuiz(id);
  }

  @Post('submit')
  @ApiOperation({ summary: 'Submit quiz answers' })
  submit(@CurrentUser('id') userId: string, @Body() dto: SubmitQuizDto) {
    return this.quizService.submit(userId, dto);
  }

  @Post(':id/adaptive/next')
  @ApiOperation({
    summary: 'Get next adaptive question based on session performance',
    description: 'Uses correctRate to adjust question difficulty dynamically (IRT-lite).',
  })
  adaptiveNext(
    @Param('id', ParseUUIDPipe) quizId: string,
    @Body() dto: AdaptiveNextDto,
  ) {
    return this.quizService.adaptiveNext(quizId, dto);
  }

  @Get(':id/attempts')
  @ApiOperation({ summary: 'Get my attempts on a quiz' })
  getAttempts(
    @CurrentUser('id') userId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.quizService.getAttempts(userId, id);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Delete a quiz you created' })
  async remove(@Param('id', ParseUUIDPipe) id: string, @CurrentUser('id') userId: string) {
    const quiz = await this.prisma.quizzes.findUnique({
      where: { id },
      select: { creator_id: true },
    });
    if (!quiz) throw new NotFoundException('Quiz not found');
    if (quiz.creator_id !== userId) {
      throw new ForbiddenException('You can only delete quizzes you created');
    }
    return this.quizService.remove(id);
  }
}
