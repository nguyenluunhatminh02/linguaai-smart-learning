import { ApiProperty } from '@nestjs/swagger';
import { IsIn, IsInt, IsOptional, Max, Min } from 'class-validator';

export const PROFICIENCY_LANGUAGES = [
  'english',
  'chinese',
  'japanese',
  'korean',
  'french',
  'spanish',
  'german',
  'vietnamese',
] as const;

export const PROFICIENCY_SKILLS = [
  'reading',
  'listening',
  'speaking',
  'writing',
  'vocabulary',
  'grammar',
] as const;

export type ProficiencyLanguage = (typeof PROFICIENCY_LANGUAGES)[number];
export type ProficiencySkill = (typeof PROFICIENCY_SKILLS)[number];

export class SubmitPlacementDto {
  @ApiProperty({ enum: PROFICIENCY_LANGUAGES })
  @IsIn(PROFICIENCY_LANGUAGES)
  language: ProficiencyLanguage;

  @ApiProperty({ enum: PROFICIENCY_SKILLS })
  @IsIn(PROFICIENCY_SKILLS)
  skill: ProficiencySkill;

  @ApiProperty({ minimum: 0, maximum: 1000 })
  @IsInt()
  @Min(0)
  @Max(1000)
  score: number;

  @ApiProperty({ minimum: 1, maximum: 1000 })
  @IsInt()
  @Min(1)
  @Max(1000)
  total: number;
}

export class RecordEvidenceDto {
  @ApiProperty({ enum: PROFICIENCY_LANGUAGES })
  @IsIn(PROFICIENCY_LANGUAGES)
  language: ProficiencyLanguage;

  @ApiProperty({ enum: PROFICIENCY_SKILLS })
  @IsIn(PROFICIENCY_SKILLS)
  skill: ProficiencySkill;

  @ApiProperty({ minimum: 0, maximum: 1000 })
  @IsInt()
  @Min(0)
  @Max(1000)
  score: number;

  @ApiProperty({ minimum: 1, maximum: 1000 })
  @IsInt()
  @Min(1)
  @Max(1000)
  total: number;

  @ApiProperty({
    required: false,
    description: 'Evidence weight in 0.25..2; defaults to 1',
    minimum: 0.25,
    maximum: 2,
  })
  @IsOptional()
  weight?: number;
}
