import {
  IsString,
  IsArray,
  IsOptional,
  ValidateNested,
  IsIn,
  ArrayMaxSize,
  MaxLength,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class ChatMessageDto {
  // 'system' is reserved for the server's tutor prompt; accepting it from
  // clients allows prompt injection through additional system messages.
  @ApiProperty({ enum: ['user', 'assistant'] })
  @IsIn(['user', 'assistant'])
  role: 'user' | 'assistant';

  @ApiProperty()
  @IsString()
  @MaxLength(8000)
  content: string;
}

export class SendChatDto {
  @ApiProperty({ type: [ChatMessageDto], maxItems: 50 })
  @IsArray()
  @ArrayMaxSize(50)
  @ValidateNested({ each: true })
  @Type(() => ChatMessageDto)
  messages: ChatMessageDto[];

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  conversationId?: string;

  @ApiPropertyOptional({ example: 'english' })
  @IsString()
  @IsOptional()
  language?: string;
}
