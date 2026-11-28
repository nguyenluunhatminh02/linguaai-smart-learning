import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsIn,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

/** Evidence kinds accepted by the Beta mastery accumulator. */
export const MASTERY_EVIDENCE_TYPES = [
  'quiz_correct',
  'quiz_incorrect',
  'writing_feedback',
  'speaking_feedback',
] as const;

export type MasteryEvidenceType = (typeof MASTERY_EVIDENCE_TYPES)[number];

export class RecordMasteryEvidenceDto {
  @ApiProperty({ description: 'External/legacy attempt identifier', maxLength: 160 })
  @IsString()
  @MaxLength(160)
  attemptId: string;

  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  knowledgeId: string;

  @ApiProperty({ enum: MASTERY_EVIDENCE_TYPES, example: 'quiz_correct' })
  @IsIn(MASTERY_EVIDENCE_TYPES)
  evidenceType: MasteryEvidenceType;

  @ApiProperty({ minimum: 0, maximum: 1 })
  @IsNumber()
  @Min(0)
  @Max(1)
  score: number;

  @ApiPropertyOptional({
    description: 'Evidence weight; defaults to 1 and is clamped to 0.25..4',
    minimum: 0.25,
    maximum: 4,
    default: 1,
  })
  @IsOptional()
  @IsNumber()
  weight?: number;
}

export class RecordLearnerErrorDto {
  @ApiPropertyOptional({ maxLength: 160 })
  @IsOptional()
  @IsString()
  @MaxLength(160)
  attemptId?: string;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  knowledgeId?: string;

  @ApiProperty({ maxLength: 80 })
  @IsString()
  @MaxLength(80)
  errorType: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  excerpt?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  correction?: string;

  @ApiPropertyOptional({ minimum: 0, maximum: 1 })
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(1)
  confidence?: number;
}
