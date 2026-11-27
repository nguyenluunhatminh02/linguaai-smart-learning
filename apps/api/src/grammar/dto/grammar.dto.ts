import { IsString, IsOptional, MaxLength } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class ExplainGrammarDto {
  @ApiProperty({ example: 'Present Perfect Tense', maxLength: 500 })
  @IsString()
  @MaxLength(500)
  grammarPoint: string;

  @ApiPropertyOptional({ example: 'english' })
  @IsString()
  @IsOptional()
  language?: string;

  @ApiPropertyOptional({
    description: 'Additional user question about the grammar',
    maxLength: 1000,
  })
  @IsString()
  @IsOptional()
  @MaxLength(1000)
  userQuestion?: string;
}
