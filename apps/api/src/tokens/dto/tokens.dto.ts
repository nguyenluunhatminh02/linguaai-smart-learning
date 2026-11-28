import {
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  Min,
} from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

/** Matches the bounded width of token_transactions.idempotency_key. */
export const MAX_OPERATION_KEY_LENGTH = 128;

export class ConsumeTokensDto {
  @IsString()
  feature: string;

  /** Client-supplied price is ignored; the server catalog is authoritative. */
  @IsOptional()
  @IsNumber()
  @Min(1)
  cost?: number;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  @MaxLength(MAX_OPERATION_KEY_LENGTH)
  operationKey?: string;
}
