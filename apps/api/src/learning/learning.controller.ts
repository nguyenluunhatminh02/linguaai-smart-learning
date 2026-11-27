import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { CompleteScenarioDto, CompleteSkillActivityDto } from './learning.dto';
import { LearningService } from './learning.service';

@ApiTags('Learning')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('learning')
export class LearningController {
  constructor(private readonly learning: LearningService) {}

  @Get('scenarios')
  listScenarios() {
    return this.learning.listScenarios();
  }

  @Get('scenarios/:slug')
  getScenario(@Param('slug') slug: string) {
    return this.learning.getScenario(slug);
  }

  @Post('scenarios/:slug/complete')
  completeScenario(
    @CurrentUser('id') userId: string,
    @Param('slug') slug: string,
    @Body() body: CompleteScenarioDto,
  ) {
    return this.learning.completeScenario(userId, slug, body.answers);
  }

  @Post('scenarios/:slug/save-phrase')
  savePhrase(@CurrentUser('id') userId: string, @Param('slug') slug: string) {
    return this.learning.savePhrase(userId, slug);
  }

  @Get('progress')
  getProgress(@CurrentUser('id') userId: string) {
    return this.learning.getProgress(userId);
  }

  @Post('progress')
  completeSkillActivity(@CurrentUser('id') userId: string, @Body() body: CompleteSkillActivityDto) {
    return this.learning.completeSkillActivity(userId, body);
  }
}
