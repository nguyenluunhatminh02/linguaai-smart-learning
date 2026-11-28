import { Body, Controller, Get, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { GetDailyPlanQueryDto } from './daily-plan.service';
import { CreateOnboardingDto } from './dto/onboarding.dto';
import {
  PROFICIENCY_LANGUAGES,
  PROFICIENCY_SKILLS,
  ProficiencyLanguage,
  ProficiencySkill,
  SubmitPlacementDto,
} from './dto/proficiency.dto';
import { ProficiencyService } from './proficiency.service';

/**
 * Transport contracts for the adaptive-learning endpoints. The dedicated DTO
 * files are peer-owned in this slice, so the controller declares the shapes it
 * accepts here instead of importing files that may not exist yet. Only
 * user-provided values are accepted: user ids always come from @CurrentUser.
 */
/** CEFR filters use the same vocabulary as the measured proficiency summary. */
export const MASTERY_CEFR_LEVELS = [
  'A1',
  'A2',
  'B1',
  'B2',
  'C1',
  'C2',
] as const;

export const LEARNER_ERROR_STATUSES = ['open', 'resolved', 'dismissed'] as const;

export type MasteryCefrLevel = (typeof MASTERY_CEFR_LEVELS)[number];
export type LearnerErrorStatus = (typeof LEARNER_ERROR_STATUSES)[number];

export class MasteryQueryDto {
  @IsOptional()
  @IsIn(PROFICIENCY_LANGUAGES)
  language?: ProficiencyLanguage;

  @IsOptional()
  @IsIn(PROFICIENCY_SKILLS)
  skill?: ProficiencySkill;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  code?: string;

  @IsOptional()
  @IsIn(MASTERY_CEFR_LEVELS)
  level?: MasteryCefrLevel;
}

export class ErrorsQueryDto {
  @IsOptional()
  @IsIn(PROFICIENCY_LANGUAGES)
  language?: ProficiencyLanguage;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  code?: string;

  @IsOptional()
  @IsIn(LEARNER_ERROR_STATUSES)
  status?: LearnerErrorStatus;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(50)
  limit?: number;
}

/** Query contract for reading/creating the current learner's daily plan. */
export class DailyPlanQueryDto implements GetDailyPlanQueryDto {
  @IsOptional()
  @IsString()
  @MaxLength(10)
  date?: string;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  timezone?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(1440)
  timeBudgetMinutes?: number;

  @IsOptional()
  @IsIn(PROFICIENCY_LANGUAGES)
  language?: string;

  @IsOptional()
  @IsIn(['A1', 'A2', 'B1', 'B2', 'C1', 'C2'])
  level?: string;
}

interface OnboardingServicePort {
  getOnboarding(userId: string): Promise<unknown>;
  submitOnboarding(userId: string, dto: CreateOnboardingDto): Promise<unknown>;
}

interface MasteryServicePort {
  getMastery(userId: string, filters: MasteryQueryDto): Promise<unknown>;
  getErrors(userId: string, filters: ErrorsQueryDto): Promise<unknown>;
}

/**
 * The learning-side service methods and plan DTOs are peer-owned in this slice.
 * Narrow, optional ports let this controller stay independently compilable and
 * testable while still delegating once those implementations land. An
 * unimplemented adapter fails explicitly instead of silently exposing routes
 * that cannot serve a request.
 */
interface DailyPlanServicePort {
  generate(userId: string, query: GetDailyPlanQueryDto): Promise<unknown>;
}

type AdaptiveService = ProficiencyService &
  Partial<OnboardingServicePort & MasteryServicePort & DailyPlanServicePort>;

function requireMethod<T extends (...args: never[]) => unknown>(
  method: T | undefined,
  property: string,
): T {
  if (typeof method !== 'function') {
    throw new Error(`ProficiencyService.${property} is not available`);
  }
  return method;
}

@ApiTags('Proficiency')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('proficiency')
export class ProficiencyController {
  constructor(private readonly proficiency: AdaptiveService) {}

  @Get('summary')
  @ApiOperation({
    summary: 'Get measurable per-skill CEFR estimates for the current learner',
  })
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
    return this.proficiency.getPlacementAttempts(userId, {
      language,
      skill,
      limit,
    });
  }

  @Post('placement')
  @ApiOperation({
    summary: 'Record one placement attempt and update the skill estimate',
  })
  submitPlacement(
    @CurrentUser('id') userId: string,
    @Body() dto: SubmitPlacementDto,
  ) {
    return this.proficiency.submitPlacement(userId, dto);
  }

  @Get('onboarding')
  @ApiOperation({
    summary: 'Get the current learner onboarding profile (self-reported only)',
  })
  getOnboarding(@CurrentUser('id') userId: string) {
    return requireMethod(
      this.proficiency.getOnboarding,
      'getOnboarding',
    ).call(this.proficiency, userId);
  }

  @Post('onboarding')
  @ApiOperation({
    summary:
      'Create or update the current learner onboarding profile; never produces a CEFR claim',
  })
  submitOnboarding(
    @CurrentUser('id') userId: string,
    @Body() dto: CreateOnboardingDto,
  ) {
    return requireMethod(
      this.proficiency.submitOnboarding,
      'submitOnboarding',
    ).call(this.proficiency, userId, dto);
  }

  @Get('mastery')
  @ApiOperation({
    summary: "List the current learner's rule-based knowledge mastery",
  })
  getMastery(
    @CurrentUser('id') userId: string,
    @Query() filters: MasteryQueryDto,
  ) {
    return requireMethod(this.proficiency.getMastery, 'getMastery').call(
      this.proficiency,
      userId,
      filters,
    );
  }

  @Get('mastery/detail')
  @ApiOperation({
    summary: 'Get one knowledge mastery detail for the current learner',
  })
  getMasteryDetail(
    @CurrentUser('id') userId: string,
    @Query('code') code: string,
  ) {
    return requireMethod(this.proficiency.getMastery, 'getMastery').call(
      this.proficiency,
      userId,
      { code },
    );
  }

  @Post('plan')
  @ApiOperation({
    summary: 'Generate the current learner daily plan from onboarding inputs',
  })
  generatePlan(
    @CurrentUser('id') userId: string,
    @Body() dto: DailyPlanQueryDto,
  ) {
    const query: GetDailyPlanQueryDto = {
      date: dto?.date,
      timezone: dto?.timezone,
      timeBudgetMinutes: dto?.timeBudgetMinutes,
      language: dto?.language,
      level: dto?.level,
    };
    return requireMethod(this.proficiency.generate, 'generate').call(
      this.proficiency,
      userId,
      query,
    );
  }

  @Get('errors')
  @ApiOperation({ summary: "List the current learner's classified errors" })
  getErrors(
    @CurrentUser('id') userId: string,
    @Query() filters: ErrorsQueryDto,
  ) {
    return requireMethod(this.proficiency.getErrors, 'getErrors').call(
      this.proficiency,
      userId,
      filters,
    );
  }
}
