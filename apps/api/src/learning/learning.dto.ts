import { ArrayMaxSize, IsArray, IsIn, IsInt, IsOptional, Matches, Max, Min } from 'class-validator';

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

  @IsIn(['english', 'chinese', 'japanese', 'korean', 'french', 'spanish', 'german', 'vietnamese'])
  language: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(86400)
  durationSeconds?: number;
}
