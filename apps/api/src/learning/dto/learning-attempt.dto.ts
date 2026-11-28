import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsIn,
  IsInt,
  IsOptional,
  IsUUID,
  Max,
  Min,
  registerDecorator,
  ValidationArguments,
  ValidationOptions,
  ValidatorConstraint,
  ValidatorConstraintInterface,
} from 'class-validator';

/** Maximum duration of a single learning attempt (24 hours), in seconds. */
export const MAX_LEARNING_ATTEMPT_DURATION_SECONDS = 86400;

/** Explicit score scales; the client must state the scale, never infer it. */
export const LEARNING_ATTEMPT_SCALES = [1, 10, 100] as const;
export type LearningAttemptScale = (typeof LEARNING_ATTEMPT_SCALES)[number];

/**
 * Validates that a raw score does not exceed its declared scale. The check is
 * scoped to score/scale so it stays independent of which endpoint consumes
 * the DTO.
 */
@ValidatorConstraint({ name: 'scoreWithinScale', async: false })
class ScoreWithinScaleConstraint implements ValidatorConstraintInterface {
  validate(score: unknown, args: ValidationArguments): boolean {
    const object = args.object as {
      score?: number;
      scale?: LearningAttemptScale;
    };
    if (typeof score !== 'number' || !Number.isFinite(score)) return true;
    if (
      !LEARNING_ATTEMPT_SCALES.includes(object.scale as LearningAttemptScale)
    ) {
      return true;
    }
    return score <= object.scale!;
  }

  defaultMessage(): string {
    return 'score must not exceed scale';
  }
}

function ScoreWithinScale(
  validationOptions?: ValidationOptions,
): PropertyDecorator {
  return (object: object, propertyName: string | symbol) => {
    registerDecorator({
      target: object.constructor,
      propertyName: String(propertyName),
      options: validationOptions,
      validator: ScoreWithinScaleConstraint,
    });
  };
}

/**
 * Transport contract for recording a scored learning attempt.
 *
 * `clientAttemptId` is a client-generated UUID scoped per user; replaying the
 * same key with the same payload must return the stored attempt rather than
 * creating a duplicate. `scale` is mandatory whenever `score` is supplied so
 * normalization is unambiguous: normalized = round(score / scale * 100).
 */
export class LearningAttemptDto {
  @ApiProperty({
    format: 'uuid',
    description: 'Client-generated UUID used as the per-user replay key',
  })
  @IsUUID()
  clientAttemptId: string;

  @ApiProperty({ minimum: 0, description: 'Raw score in the declared scale' })
  @IsInt()
  @Min(0)
  @Max(1000000)
  @ScoreWithinScale()
  score: number;

  @ApiProperty({
    enum: LEARNING_ATTEMPT_SCALES,
    description: 'Maximum possible raw score; never inferred from the score',
  })
  @IsIn(LEARNING_ATTEMPT_SCALES)
  scale: LearningAttemptScale;

  @ApiPropertyOptional({
    minimum: 0,
    maximum: MAX_LEARNING_ATTEMPT_DURATION_SECONDS,
  })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(MAX_LEARNING_ATTEMPT_DURATION_SECONDS)
  durationSeconds?: number;
}

/** Normalize a raw score to a 0-100 scale using one canonical formula. */
export function normalizeLearningAttemptScore(
  score: number,
  scale: LearningAttemptScale,
): number {
  if (!LEARNING_ATTEMPT_SCALES.includes(scale)) {
    throw new RangeError('Unsupported learning attempt scale');
  }
  if (!Number.isFinite(score) || score < 0 || score > scale) {
    throw new RangeError(
      'Learning attempt score is outside the declared scale',
    );
  }
  return Math.round((score / scale) * 100);
}
