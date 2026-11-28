import {
  IsBoolean,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  AI_OPERATION_FEATURES,
  AI_OPERATION_LANGUAGES,
} from '../ai-operations.policy';

export const MAX_CLIENT_OPERATION_ID_LENGTH = 128;
export const MAX_OPERATION_MESSAGE_LENGTH = 8000;

/** Reusable scope DTO: the unique key is scoped per user. */
export class AiOperationScopeDto {
  @ApiProperty({ enum: AI_OPERATION_FEATURES })
  @IsIn(AI_OPERATION_FEATURES)
  feature: string;

  @ApiProperty({ maxLength: MAX_CLIENT_OPERATION_ID_LENGTH })
  @IsString()
  @IsNotEmpty()
  @MaxLength(MAX_CLIENT_OPERATION_ID_LENGTH)
  clientOperationId: string;
}

export class CreateAiOperationDto extends AiOperationScopeDto {
  @ApiProperty({ enum: AI_OPERATION_LANGUAGES })
  @IsIn(AI_OPERATION_LANGUAGES)
  language: string;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  conversationId?: string;

  @ApiProperty({ maxLength: MAX_OPERATION_MESSAGE_LENGTH })
  @IsString()
  @IsNotEmpty()
  @MinLength(1)
  @MaxLength(MAX_OPERATION_MESSAGE_LENGTH)
  message: string;
}

export class ClaimAiOperationLeaseDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  operationId: string;

  @ApiProperty({ description: 'Fencing version read from the operation' })
  @IsInt()
  @Min(0)
  expectedVersion: number;

  @ApiPropertyOptional({ description: 'Lease duration in milliseconds' })
  @IsOptional()
  @IsInt()
  @Min(1000)
  leaseTtlMs?: number;
}

export class MarkAiOperationTerminalDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  operationId: string;

  @ApiProperty({
    enum: ['SUCCEEDED', 'FAILED', 'UNKNOWN', 'CANCELLED'],
  })
  @IsIn(['SUCCEEDED', 'FAILED', 'UNKNOWN', 'CANCELLED'])
  status: 'SUCCEEDED' | 'FAILED' | 'UNKNOWN' | 'CANCELLED';

  @ApiProperty({ description: 'Lease token returned by claimLease' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(128)
  leaseToken: string;

  @ApiProperty({ description: 'Fencing version read from the operation' })
  @IsInt()
  @Min(0)
  expectedVersion: number;

  @ApiPropertyOptional({ maxLength: 128 })
  @IsOptional()
  @IsString()
  @MaxLength(128)
  errorCode?: string;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  resultRef?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  forceRefund?: boolean;
}

export class RefundAiOperationDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  operationId: string;

  @ApiProperty({ description: 'Fencing version read from the operation' })
  @IsInt()
  @Min(0)
  expectedVersion: number;

  @ApiProperty({ description: 'Lease token returned by claimLease' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(128)
  leaseToken: string;

  @ApiPropertyOptional({ maxLength: 128 })
  @IsOptional()
  @IsString()
  @MaxLength(128)
  errorCode?: string;

  @ApiPropertyOptional({ description: 'Override the failure policy for a verified cancellation' })
  @IsOptional()
  @IsBoolean()
  forceRefund?: boolean;
}
