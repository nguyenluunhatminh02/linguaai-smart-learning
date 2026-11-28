import { Type } from 'class-transformer';
import {
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

/** Wire values for the teacher content-review queue. */
export const REVIEW_STATUSES = ['PENDING', 'APPROVED', 'REJECTED'] as const;
export type ReviewStatus = (typeof REVIEW_STATUSES)[number];

export class ListSubmissionsQueryDto {
  @IsOptional()
  @IsIn(REVIEW_STATUSES)
  status?: ReviewStatus;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number = 20;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  offset?: number = 0;
}

export class SubmitContentDto {
  @IsUUID('4')
  contentItemId: string;
}

export class ReviewSubmissionDto {
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  reviewNotes?: string;

  /**
   * Optimistic concurrency token returned by list/get. When supplied the
   * review only commits if the submission is still at this version.
   */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(1000000)
  version?: number;
}

/** Internal shape used by the service when a reviewer submits a decision. */
export class RejectSubmissionDto extends ReviewSubmissionDto {
  // Narrow the optional base field to required for rejections without emitting
  // a duplicate class field (TS2612); validators still enforce non-empty notes.
  @IsString()
  @MinLength(1)
  @MaxLength(2000)
  declare reviewNotes: string;
}
