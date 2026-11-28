import {
  IsString,
  IsOptional,
  MaxLength,
  Matches,
  IsIn,
  IsNumber,
  Min,
  Max,
  registerDecorator,
  ValidationArguments,
  ValidationOptions,
  ValidatorConstraint,
  ValidatorConstraintInterface,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/**
 * DB-09: Explicit writing score contract.
 *
 * FastAPI emits snake_case (score, score_scale, max_score, rubric_version).
 * NestJS maps to camelCase for the web. The contract requires:
 * - score: raw numeric overall score
 * - scoreScale: literal 1|10|100
 * - maxScore: numeric and must equal scoreScale
 * - rubricVersion: allowlisted string
 * - overallScore: normalized 0-100 value computed as round(score / maxScore * 100)
 *
 * All subscores in `scores` are validated against the same maxScore.
 * Legacy submissions lacking scale metadata are flagged rather than silently guessed.
 */

/** Allowed score scales for writing assessments. */
export const WRITING_SCORE_SCALES = [1, 10, 100] as const;
export type WritingScoreScale = (typeof WRITING_SCORE_SCALES)[number];

/** Allowlisted rubric versions. FastAPI must emit one of these. */
export const WRITING_RUBRIC_VERSIONS = ['writing-rubric-v1'] as const;
export type WritingRubricVersion = (typeof WRITING_RUBRIC_VERSIONS)[number];

/**
 * Validates that a raw score does not exceed its declared maxScore.
 * The check is scoped to score/maxScore so it stays independent of which
 * endpoint consumes the DTO.
 */
@ValidatorConstraint({ name: 'writingScoreWithinMax', async: false })
class WritingScoreWithinMaxConstraint implements ValidatorConstraintInterface {
  validate(score: unknown, args: ValidationArguments): boolean {
    const object = args.object as { score?: number; maxScore?: number };
    if (typeof score !== 'number' || !Number.isFinite(score)) return true;
    if (
      typeof object.maxScore !== 'number' ||
      !Number.isFinite(object.maxScore)
    ) {
      return true;
    }
    return score >= 0 && score <= object.maxScore;
  }

  defaultMessage(): string {
    return 'score must be between 0 and maxScore';
  }
}

function WritingScoreWithinMax(
  validationOptions?: ValidationOptions,
): PropertyDecorator {
  return (object: object, propertyName: string | symbol) => {
    registerDecorator({
      target: object.constructor,
      propertyName: propertyName as string,
      options: validationOptions,
      validator: WritingScoreWithinMaxConstraint,
    });
  };
}

/**
 * Validates that maxScore equals scoreScale. The contract requires these
 * to be identical so normalization is unambiguous.
 */
@ValidatorConstraint({ name: 'writingMaxScoreMatchesScale', async: false })
class WritingMaxScoreMatchesScaleConstraint implements ValidatorConstraintInterface {
  validate(maxScore: unknown, args: ValidationArguments): boolean {
    const object = args.object as {
      maxScore?: number;
      scoreScale?: WritingScoreScale;
    };
    if (typeof maxScore !== 'number' || !Number.isFinite(maxScore)) return true;
    if (
      !WRITING_SCORE_SCALES.includes(object.scoreScale as WritingScoreScale)
    ) {
      return true;
    }
    return maxScore === object.scoreScale;
  }

  defaultMessage(): string {
    return 'maxScore must equal scoreScale';
  }
}

function WritingMaxScoreMatchesScale(
  validationOptions?: ValidationOptions,
): PropertyDecorator {
  return (object: object, propertyName: string | symbol) => {
    registerDecorator({
      target: object.constructor,
      propertyName: propertyName as string,
      options: validationOptions,
      validator: WritingMaxScoreMatchesScaleConstraint,
    });
  };
}

/**
 * Input DTO for submitting writing text for AI assessment.
 * Kept free of client-supplied score fields; the AI service emits the score contract.
 */
export class AssessWritingDto {
  @ApiProperty({ description: 'User-written text to assess' })
  @IsString()
  @MaxLength(10000)
  userText: string;

  @ApiPropertyOptional({ example: 'english' })
  @IsString()
  @Matches(/^[a-zA-Z ]{2,30}$/, {
    message: 'language must be 2-30 letters or spaces',
  })
  @MaxLength(30)
  @IsOptional()
  language?: string;

  @ApiPropertyOptional({ example: 'B1' })
  @IsIn(['A1', 'A2', 'B1', 'B2', 'C1', 'C2'])
  @IsOptional()
  targetLevel?: string;

  @ApiPropertyOptional({ description: 'Optional writing prompt' })
  @IsString()
  @MaxLength(2000)
  @IsOptional()
  promptText?: string;
}

/** A detected writing error with its correction and explanation. */
export class WritingErrorDto {
  @ApiProperty({ description: 'Original erroneous text' })
  @IsString()
  original: string;

  @ApiPropertyOptional({ description: 'Corrected text' })
  @IsOptional()
  @IsString()
  correction?: string;

  @ApiProperty({ description: 'Explanation of the error' })
  @IsString()
  explanation: string;

  @ApiPropertyOptional({ description: 'Error category' })
  @IsOptional()
  @IsString()
  type?: string;
}

/**
 * Subscore breakdown for writing assessment. Each subscore is validated
 * against the same maxScore as the overall score by the service's
 * normalizeWritingScore helper before constructing the response DTO.
 */
export class WritingSubscoresDto {
  @ApiPropertyOptional({
    minimum: 0,
    description: 'Grammar subscore in declared scale',
  })
  @IsOptional()
  @IsNumber()
  @Min(0)
  grammar?: number;

  @ApiPropertyOptional({
    minimum: 0,
    description: 'Vocabulary subscore in declared scale',
  })
  @IsOptional()
  @IsNumber()
  @Min(0)
  vocabulary?: number;

  @ApiPropertyOptional({
    minimum: 0,
    description: 'Coherence subscore in declared scale',
  })
  @IsOptional()
  @IsNumber()
  @Min(0)
  coherence?: number;

  @ApiPropertyOptional({
    minimum: 0,
    description: 'Task achievement subscore in declared scale',
  })
  @IsOptional()
  @IsNumber()
  @Min(0)
  taskAchievement?: number;
}

/**
 * Response DTO for writing assessment with explicit score contract.
 * FastAPI emits snake_case; NestJS maps to this camelCase shape.
 *
 * - score: raw numeric overall score
 * - scoreScale: literal 1|10|100
 * - maxScore: numeric and must equal scoreScale
 * - rubricVersion: allowlisted string
 * - overallScore: normalized 0-100 value (computed by service)
 * - scoreStatus: 'trusted' when scale metadata is present, 'legacy' when missing
 */
export class WritingAssessmentResponseDto {
  @ApiProperty({ description: 'Unique submission identifier' })
  id: string;

  @ApiProperty({
    minimum: 0,
    description: 'Raw numeric overall score in declared scale',
  })
  @IsNumber()
  @Min(0)
  @WritingScoreWithinMax()
  score: number;

  @ApiProperty({
    enum: WRITING_SCORE_SCALES,
    description: 'Maximum possible raw score; never inferred from the score',
  })
  @IsIn(WRITING_SCORE_SCALES)
  scoreScale: WritingScoreScale;

  @ApiProperty({
    minimum: 0,
    description: 'Must equal scoreScale for unambiguous normalization',
  })
  @IsNumber()
  @Min(0)
  @WritingMaxScoreMatchesScale()
  maxScore: number;

  @ApiProperty({
    enum: WRITING_RUBRIC_VERSIONS,
    description: 'Rubric version used for assessment',
  })
  @IsIn(WRITING_RUBRIC_VERSIONS)
  rubricVersion: WritingRubricVersion;

  @ApiProperty({
    minimum: 0,
    maximum: 100,
    description:
      'Normalized 0-100 score computed as round(score / maxScore * 100)',
  })
  @IsNumber()
  @Min(0)
  @Max(100)
  overallScore: number;

  @ApiProperty({
    enum: ['trusted', 'legacy'],
    description:
      "'trusted' when scale metadata is present, 'legacy' when submission predates explicit scale contract",
  })
  @IsIn(['trusted', 'legacy'])
  scoreStatus: 'trusted' | 'legacy';

  @ApiProperty({ description: 'AI-generated feedback text' })
  feedback: string;

  @ApiPropertyOptional({
    description: 'List of detected errors with corrections',
  })
  @IsOptional()
  errors?: WritingErrorDto[];

  @ApiPropertyOptional({ description: 'Improvement suggestions' })
  @IsOptional()
  suggestions?: string[];

  @ApiPropertyOptional({ description: 'AI-rewritten text' })
  @IsOptional()
  rewrittenText?: string | null;

  @ApiPropertyOptional({ description: 'Subscore breakdown' })
  @IsOptional()
  scores?: WritingSubscoresDto;

  @ApiProperty({ description: 'Language of the submission' })
  language: string;

  @ApiPropertyOptional({ description: 'Target CEFR level' })
  @IsOptional()
  targetLevel?: string;

  @ApiProperty({ description: 'Submission timestamp' })
  createdAt: Date;

  @ApiProperty({ description: 'Original user text' })
  userText: string;
}

/**
 * Normalize a raw score to a 0-100 scale using one canonical formula.
 * Throws if the score is outside the declared scale or the scale is unsupported.
 */
export function normalizeWritingScore(score: number, maxScore: number): number {
  if (!Number.isFinite(score) || !Number.isFinite(maxScore)) {
    throw new RangeError('Writing score and maxScore must be finite numbers');
  }
  if (maxScore <= 0) {
    throw new RangeError('maxScore must be positive');
  }
  if (score < 0 || score > maxScore) {
    throw new RangeError('Writing score is outside the declared scale');
  }
  return Math.round((score / maxScore) * 100);
}
