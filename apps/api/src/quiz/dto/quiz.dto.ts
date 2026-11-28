import {
  IsString,
  IsOptional,
  IsNumber,
  IsArray,
  IsInt,
  IsUUID,
  MaxLength,
  MinLength,
  ValidateNested,
  Min,
  Max,
  Matches,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

// Valid CEFR levels pattern
const CEFR_LEVEL_PATTERN =
  /^(A1|A2|B1|B2|C1|C2|beginner|intermediate|advanced|elementary|pre-intermediate|upper-intermediate|proficient)$/i;

export class CreateQuizQuestionDto {
  @ApiProperty()
  @IsString()
  questionText: string;

  @ApiProperty({ enum: ['mcq', 'true_false', 'fill_blank'] })
  @IsString()
  questionType: string;

  @ApiPropertyOptional({ type: [String] })
  @IsArray()
  @IsOptional()
  options?: string[];

  @ApiProperty()
  @IsString()
  correctAnswer: string;

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  explanation?: string;

  @ApiPropertyOptional({
    description: 'Difficulty 1(easy)–5(hard)',
    minimum: 1,
    maximum: 5,
    default: 3,
  })
  @IsNumber()
  @IsOptional()
  @Min(1)
  @Max(5)
  difficulty?: number;
}

export class CreateQuizDto {
  @ApiProperty({ example: 'IELTS Vocabulary Quiz' })
  @IsString()
  title: string;

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  description?: string;

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  deckId?: string;

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  @MaxLength(50)
  language?: string;

  @ApiPropertyOptional({ default: 15 })
  @IsNumber()
  @IsOptional()
  @Min(1)
  timeLimitMinutes?: number;

  @ApiProperty({ type: [CreateQuizQuestionDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CreateQuizQuestionDto)
  questions: CreateQuizQuestionDto[];
}

class QuizAnswerDto {
  @ApiProperty()
  @IsUUID()
  questionId: string;

  @ApiProperty()
  @IsString()
  @MaxLength(1000)
  answer: string;

  @ApiPropertyOptional({
    description: 'Zero-based choice index for multiple-choice answers',
  })
  @IsOptional()
  @IsInt()
  @Min(0)
  optionIndex?: number;
}

export class SubmitQuizDto {
  @ApiProperty()
  @IsUUID()
  quizId: string;

  @ApiProperty({ type: [QuizAnswerDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => QuizAnswerDto)
  answers: QuizAnswerDto[];

  @ApiProperty()
  @IsInt()
  @Min(0)
  durationSeconds: number;

  @ApiPropertyOptional({
    description: 'Stable ID for safely retrying this attempt',
  })
  @IsOptional()
  @IsUUID()
  attemptId?: string;
}

export class AdaptiveNextDto {
  @ApiProperty({
    description: 'Number of questions answered so far',
    minimum: 0,
  })
  @IsNumber()
  @Min(0)
  answeredCount: number;

  @ApiProperty({ description: 'Number of correct answers so far', minimum: 0 })
  @IsNumber()
  @Min(0)
  correctCount: number;

  @ApiPropertyOptional({
    description: 'IDs of questions already answered (to exclude)',
  })
  @IsArray()
  @IsOptional()
  answeredIds?: string[];
}

export class GenerateQuizDto {
  @ApiProperty({
    description: 'Topic to generate quiz about',
    example: 'climate change',
  })
  @IsString()
  // Validation runs before the controller charges tokens; an empty topic would
  // otherwise be rejected by the AI service after the charge with no refund.
  @MinLength(1)
  @MaxLength(200)
  topic: string;

  @ApiPropertyOptional({ example: 'english' })
  @IsString()
  @IsOptional()
  language?: string;

  @ApiPropertyOptional({
    example: 'B1',
    description: 'CEFR level for question difficulty (A1-C2)',
  })
  @IsString()
  @IsOptional()
  @Matches(CEFR_LEVEL_PATTERN, {
    message:
      'level must be a valid CEFR level (A1, A2, B1, B2, C1, C2) or common equivalents',
  })
  level?: string;

  @ApiPropertyOptional({
    description: 'Number of questions to generate (3-20)',
    default: 10,
    minimum: 3,
    maximum: 20,
  })
  @IsNumber()
  @IsOptional()
  @Min(3)
  @Max(20)
  count?: number;

  @ApiPropertyOptional({
    description: 'Custom quiz title (AI generates one if omitted)',
  })
  @IsString()
  @IsOptional()
  title?: string;
}
