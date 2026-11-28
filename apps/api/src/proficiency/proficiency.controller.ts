import { Body, Controller, Get, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { SubmitPlacementDto } from './dto/proficiency.dto';
import { ProficiencyService } from './proficiency.service';

@ApiTags('Proficiency')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('proficiency')
export class ProficiencyController {
  constructor(private readonly proficiency: ProficiencyService) {}

  @Get('summary')
  @ApiOperation({ summary: 'Get measurable per-skill CEFR estimates for the current learner' })
  getSummary(
    @CurrentUser('id') userId: string,
    @Query('language') language?: string,
  ) {
    return this.proficiency.getSummary(userId, language);
  }

  @Get('placement-attempts')
  @ApiOperation({ summary: "List the current learner's placement history" })
  getPlacementAttempts(
    @CurrentUser('id') userId: string,
    @Query('language') language?: string,
    @Query('skill') skill?: string,
    @Query('limit') limit?: number,
  ) {
    return this.proficiency.getPlacementAttempts(userId, { language, skill, limit });
  }

  @Post('placement')
  @ApiOperation({ summary: 'Record one placement attempt and update the skill estimate' })
  submitPlacement(
    @CurrentUser('id') userId: string,
    @Body() dto: SubmitPlacementDto,
  ) {
    return this.proficiency.submitPlacement(userId, dto);
  }
}
