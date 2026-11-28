import {
  IsString,
  IsEnum,
  IsOptional,
  IsBoolean,
  IsNumber,
  IsObject,
  IsNotEmpty,
  IsArray,
  IsIn,
  IsInt,
  Min,
  Max,
} from 'class-validator';

export enum ContentType {
  READING = 'reading',
  GRAMMAR = 'grammar',
  LISTENING = 'listening',
  VOCABULARY = 'vocabulary',
  TRANSLATION = 'translation',
}

export class CreateContentDto {
  @IsEnum(ContentType)
  @IsNotEmpty()
  type: ContentType;

  @IsString()
  @IsNotEmpty()
  title: string;

  @IsString()
  @IsOptional()
  titleVi?: string;

  @IsString()
  @IsOptional()
  level?: string;

  @IsString()
  @IsOptional()
  category?: string;

  @IsString()
  @IsOptional()
  content?: string;

  @IsString()
  @IsOptional()
  audioUrl?: string;

  @IsString()
  @IsOptional()
  duration?: string;

  @IsNumber()
  @IsOptional()
  wordCount?: number;

  @IsBoolean()
  @IsOptional()
  published?: boolean;

  @IsObject()
  @IsOptional()
  data?: Record<string, any>;

  @IsArray()
  @IsOptional()
  questions?: Record<string, any>[];

  @IsNumber()
  @IsOptional()
  sortOrder?: number;
}

export class UpdateContentDto {
  @IsEnum(ContentType)
  @IsOptional()
  type?: ContentType;

  @IsString()
  @IsOptional()
  title?: string;

  @IsString()
  @IsOptional()
  titleVi?: string;

  @IsString()
  @IsOptional()
  level?: string;

  @IsString()
  @IsOptional()
  category?: string;

  @IsString()
  @IsOptional()
  content?: string;

  @IsString()
  @IsOptional()
  audioUrl?: string;

  @IsString()
  @IsOptional()
  duration?: string;

  @IsNumber()
  @IsOptional()
  wordCount?: number;

  @IsBoolean()
  @IsOptional()
  published?: boolean;

  @IsObject()
  @IsOptional()
  data?: Record<string, any>;

  @IsArray()
  @IsOptional()
  questions?: Record<string, any>[];

  @IsNumber()
  @IsOptional()
  sortOrder?: number;
}

export class UpdateUserRoleDto {
  @IsIn(['USER', 'ADMIN', 'user', 'admin'])
  @IsNotEmpty()
  role: 'USER' | 'ADMIN' | 'user' | 'admin';
}

export class GrantTokensDto {
  // Grants are positive integer credits only: a negative amount would debit
  // the target user, and an unbounded amount can inflate the paid token
  // economy. TokensService.addTokens enforces the same invariant defensively.
  @IsInt()
  @Min(1)
  @Max(100000)
  @IsNotEmpty()
  amount: number;

  @IsString()
  @IsOptional()
  reason?: string;
}
