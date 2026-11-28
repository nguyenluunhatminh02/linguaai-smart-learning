import {
  ArrayMaxSize,
  IsArray,
  IsIn,
  IsInt,
  IsISO8601,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

export class CompleteScenarioDto {
  @IsArray()
  @ArrayMaxSize(20)
  @IsInt({ each: true })
  @Min(0, { each: true })
  @Max(9, { each: true })
  answers: number[];
}

export class CompleteSkillActivityDto {
  @IsIn(['reading', 'listening'])
  activityType: 'reading' | 'listening';

  @Matches(/^[a-z0-9][a-z0-9_:-]{0,159}$/i)
  activityId: string;

  @IsIn([
    'english',
    'chinese',
    'japanese',
    'korean',
    'french',
    'spanish',
    'german',
    'vietnamese',
  ])
  language: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(86400)
  durationSeconds?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(86400)
  score?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(86400)
  total?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(1000000)
  attemptNumber?: number;

  @IsOptional()
  @IsUUID()
  clientAttemptId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  contentVersion?: string;

  @IsOptional()
  @IsISO8601()
  startedAt?: string;

  @IsOptional()
  @IsISO8601()
  completedAt?: string;
}
