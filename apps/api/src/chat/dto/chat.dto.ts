import {
  IsString,
  IsArray,
  IsNotEmpty,
  IsOptional,
  ValidateNested,
  IsIn,
  IsUUID,
  ArrayMaxSize,
  ArrayMinSize,
  MaxLength,
  MinLength,
} from 'class-validator';
import { Transform, Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/** Languages that may be interpolated into the tutor system prompt. */
export const CHAT_LANGUAGES = [
  'english',
  'vietnamese',
  'japanese',
  'korean',
  'french',
  'spanish',
  'german',
  'chinese',
  'italian',
  'portuguese',
  'russian',
] as const;

/** Matches the transport cap applied by normalizeUserInput in chat.controller.ts. */
export const MAX_STREAM_MESSAGE_LENGTH = 2000;

/** Bounds a client-supplied idempotency key before it is scoped per user. */
export const MAX_CHAT_IDEMPOTENCY_KEY_LENGTH = 64;

const trimToLowerCase = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim().toLowerCase() : value;

/** Accept an explicit JSON null as "no conversation yet" before UUID validation. */
const nullToUndefined = ({ value }: { value: unknown }) =>
  value === null ? undefined : value;

export class ChatMessageDto {
  // 'system' is reserved for the server's tutor prompt; accepting it from
  // clients allows prompt injection through additional system messages.
  @ApiProperty({ enum: ['user', 'assistant'] })
  @IsIn(['user', 'assistant'])
  role: 'user' | 'assistant';

  @ApiProperty({ minLength: 1, maxLength: MAX_STREAM_MESSAGE_LENGTH })
  @IsString()
  @IsNotEmpty()
  @MaxLength(MAX_STREAM_MESSAGE_LENGTH)
  content: string;
}

export class SendChatDto {
  @ApiProperty({ type: [ChatMessageDto], minItems: 1, maxItems: 50 })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(50)
  @ValidateNested({ each: true })
  @Type(() => ChatMessageDto)
  messages: ChatMessageDto[];

  @ApiPropertyOptional({ format: 'uuid' })
  @Transform(nullToUndefined)
  @IsOptional()
  @IsUUID('4')
  conversationId?: string;

  @ApiPropertyOptional({ enum: CHAT_LANGUAGES, example: 'english' })
  @Transform(trimToLowerCase)
  @IsOptional()
  @IsIn(CHAT_LANGUAGES)
  language?: string;
}

/**
 * Transport contract for POST /chat/stream. The client sends a single turn;
 * conversation history must be read from the DB by the orchestration layer.
 */
export class StreamChatDto {
  @ApiPropertyOptional({
    format: 'uuid',
    nullable: true,
    description: 'Omit or send null to start a new conversation',
  })
  @Transform(nullToUndefined)
  @IsOptional()
  @IsUUID('4')
  conversationId?: string | null;

  @ApiPropertyOptional({ enum: CHAT_LANGUAGES, example: 'english' })
  @Transform(trimToLowerCase)
  @IsOptional()
  @IsIn(CHAT_LANGUAGES)
  language?: string;

  @ApiProperty({ minLength: 1, maxLength: MAX_STREAM_MESSAGE_LENGTH })
  @IsString()
  @MinLength(1)
  @MaxLength(MAX_STREAM_MESSAGE_LENGTH)
  message: string;

  @ApiPropertyOptional({
    maxLength: MAX_CHAT_IDEMPOTENCY_KEY_LENGTH,
    description: 'Client-generated key for replay-safe turns',
  })
  @IsOptional()
  @IsString()
  @MaxLength(MAX_CHAT_IDEMPOTENCY_KEY_LENGTH)
  idempotencyKey?: string;
}
