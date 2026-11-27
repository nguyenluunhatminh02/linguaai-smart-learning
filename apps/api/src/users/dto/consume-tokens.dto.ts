import { IsString, MaxLength } from 'class-validator';
import { Transform } from 'class-transformer';
import { ApiProperty } from '@nestjs/swagger';

export class ConsumeTokensDto {
  @ApiProperty({ example: 'ai_chat' })
  @IsString()
  @MaxLength(64)
  feature!: string;

  /**
   * Deprecated and ignored: the token price is always derived from the
   * server-side price table (TokensService.COSTS). Kept as an accepted input
   * for backward compatibility with clients that still send it; the transform
   * discards any client-supplied value so it can never override the real cost.
   */
  @ApiProperty({
    example: 5,
    deprecated: true,
    description: 'Ignored. The server determines the cost from the feature.',
  })
  @Transform(() => undefined)
  cost?: number;
}
