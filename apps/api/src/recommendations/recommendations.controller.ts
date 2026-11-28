import { Controller, Get, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags, ApiOperation } from '@nestjs/swagger';
import { RecommendationsService } from './recommendations.service';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';

@ApiTags('Recommendations')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('recommendations')
export class RecommendationsController {
  constructor(private recommendationsService: RecommendationsService) {}

  @Get('next-activity')
  @ApiOperation({ summary: 'Get the next activity for the learner' })
  getNextActivity(
    @CurrentUser('id') userId: string,
    @Query('language') language?: string,
  ) {
    return this.recommendationsService.getNextActivity(userId, language);
  }

  @Get('learning-path')
  @ApiOperation({
    summary: 'Get personalized learning path',
    description:
      'Returns a ranked list of recommended learning activities based on FSRS retention data, ' +
      'writing error patterns, reading history, and quiz activity. Cached 30 minutes.',
  })
  getLearningPath(@CurrentUser('id') userId: string) {
    return this.recommendationsService.getLearningPath(userId);
  }

  @Post('invalidate-cache')
  @ApiOperation({
    summary: 'Invalidate learning path cache',
    description:
      'Call after completing an activity to get fresh recommendations.',
  })
  invalidateCache(@CurrentUser('id') userId: string) {
    return this.recommendationsService.invalidateCache(userId);
  }
}
