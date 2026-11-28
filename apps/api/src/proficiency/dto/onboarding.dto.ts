import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsIn, IsInt, IsOptional, Max, Min } from 'class-validator';

import {
  PROFICIENCY_LANGUAGES,
  ProficiencyLanguage,
} from './proficiency.dto';

/** Reasons a learner starts the product; deliberately distinct from CEFR levels. */
export const ONBOARDING_GOALS = [
  'conversation',
  'travel',
  'work/study',
  'exam',
] as const;

/**
 * Descriptive self-assessment bands, not CEFR codes. These are learner input,
 * not a measured proficiency estimate: a few answers (or an LLM judgement)
 * must never be presented as a CEFR result.
 */
export const SELF_LEVELS = [
  'beginner',
  'elementary',
  'intermediate',
  'upper-intermediate',
  'advanced',
] as const;

export type OnboardingGoal = (typeof ONBOARDING_GOALS)[number];
export type SelfLevel = (typeof SELF_LEVELS)[number];

export class CreateOnboardingDto {
  @ApiProperty({ enum: PROFICIENCY_LANGUAGES, example: 'english' })
  @IsIn(PROFICIENCY_LANGUAGES)
  targetLanguage: ProficiencyLanguage;

  @ApiProperty({ enum: ONBOARDING_GOALS, example: 'conversation' })
  @IsIn(ONBOARDING_GOALS)
  goal: OnboardingGoal;

  /**
   * Self-reported only. Store/map as self-assessed; never seed
   * skill_proficiency.cefr_estimate or a placement score from this value.
   * Measured CEFR estimates come solely from ProficiencyService placement
   * attempts and recorded evidence; placement stays optional and is handled
   * by SubmitPlacementDto -> ProficiencyService.submitPlacement.
   */
  @ApiProperty({ enum: SELF_LEVELS, example: 'elementary' })
  @IsIn(SELF_LEVELS)
  selfLevel: SelfLevel;

  @ApiProperty({ minimum: 5, maximum: 180, example: 15 })
  @IsInt()
  @Min(5)
  @Max(180)
  dailyMinutes: number;

  @ApiPropertyOptional({
    description: 'Optional placement test; false unless the learner opts in',
    default: false,
  })
  @IsOptional()
  @IsBoolean()
  placementOptIn?: boolean;
}

/**
 * Transport shape for onboarding responses. `cefrClaim` is always null:
 * onboarding data alone cannot justify a CEFR claim, and this type exists so
 * consumers cannot accidentally present self-assessment as a measured result.
 */
export type OnboardingResult = {
  levelSource: 'self-reported';
  cefrClaim: null;
};
