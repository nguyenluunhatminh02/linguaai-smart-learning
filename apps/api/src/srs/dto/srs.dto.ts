import { IsInt, IsOptional, IsUUID, Min, Max } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class ReviewCardDto {
  @ApiProperty({ description: 'Card ID' })
  @IsUUID()
  cardId: string;

  @ApiProperty({
    description: 'FSRS review grade: 1=Again (forgot), 2=Hard, 3=Good, 4=Easy',
    minimum: 1,
    maximum: 4,
    enum: [1, 2, 3, 4],
  })
  @IsInt()
  @Min(1)
  @Max(4)
  grade: number;

  @ApiPropertyOptional({
    description: 'Stable ID for safely retrying this review',
  })
  @IsOptional()
  @IsUUID()
  operationId?: string;
}

export class StartSessionDto {
  @ApiProperty()
  @IsUUID()
  deckId: string;

  @ApiPropertyOptional({
    description: 'Stable ID for safely retrying session creation',
  })
  @IsOptional()
  @IsUUID()
  sessionId?: string;
}

export class FinishSessionDto {
  @ApiProperty()
  @IsUUID()
  sessionId: string;

  @ApiProperty()
  @IsInt()
  @Min(0)
  cardsReviewed: number;

  @ApiProperty()
  @IsInt()
  @Min(0)
  cardsCorrect: number;

  @ApiProperty()
  @IsInt()
  @Min(0)
  durationSeconds: number;
}
