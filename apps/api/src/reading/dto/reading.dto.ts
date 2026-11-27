import { IsString, IsOptional, IsNumber, Min, Max } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class GenerateReadingDto {
  @ApiProperty({ example: 'B1' })
  @IsString()
  level: string;

  @ApiProperty({ example: 'technology' })
  @IsString()
  topic: string;

  @ApiPropertyOptional({ example: 300 })
  @IsNumber()
  @IsOptional()
  @Min(100)
  @Max(1000)
  wordCount?: number;

  @ApiPropertyOptional({ example: 'english' })
  @IsString()
  @IsOptional()
  language?: string;
}

export class AnalyzeTextDto {
  @ApiProperty({ description: 'Text to analyze linguistically' })
  @IsString()
  @Min(1)
  @Max(10000)
  text: string;

  @ApiPropertyOptional({ example: 'english', description: 'Language of the text' })
  @IsString()
  @IsOptional()
  language?: string;
}
