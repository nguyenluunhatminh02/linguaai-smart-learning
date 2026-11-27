import { IsIn, IsInt, Max, Min, ValidateIf } from 'class-validator';

export class UpdateLearningPreferencesDto {
  @ValidateIf((_, value) => value !== undefined)
  @IsIn(['A1', 'A2'])
  level?: 'A1' | 'A2';

  @ValidateIf((_, value) => value !== undefined)
  @IsIn([5, 10, 15])
  dailyStudyMinutes?: 5 | 10 | 15;

  @ValidateIf((_, value) => value !== undefined)
  @IsInt()
  @Min(1)
  @Max(500)
  dailyWordGoal?: number;

  @ValidateIf((_, value) => value !== undefined)
  @IsInt()
  @Min(1)
  @Max(500)
  dailyReviewGoal?: number;
}
