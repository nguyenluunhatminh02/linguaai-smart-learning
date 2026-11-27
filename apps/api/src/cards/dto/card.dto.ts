import { IsString, IsOptional, IsNumber, Min, Max, MaxLength } from "class-validator";
import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";

export class CreateCardDto {
  @ApiProperty({ example: "Hello", maxLength: 500 })
  @IsString()
  @MaxLength(500)
  frontText: string;

  @ApiProperty({ example: "Xin chào", maxLength: 500 })
  @IsString()
  @MaxLength(500)
  backText: string;

  @ApiPropertyOptional({ maxLength: 255 })
  @IsString()
  @MaxLength(255)
  @IsOptional()
  ipaPronunciation?: string;

  @ApiPropertyOptional({ maxLength: 500 })
  @IsString()
  @MaxLength(500)
  @IsOptional()
  audioUrl?: string;

  @ApiPropertyOptional({ maxLength: 1000 })
  @IsString()
  @MaxLength(1000)
  @IsOptional()
  exampleSentence?: string;

  @ApiPropertyOptional({ maxLength: 500 })
  @IsString()
  @MaxLength(500)
  @IsOptional()
  imageUrl?: string;
}

export class UpdateCardDto {
  @ApiPropertyOptional({ maxLength: 500 })
  @IsString()
  @MaxLength(500)
  @IsOptional()
  frontText?: string;

  @ApiPropertyOptional({ maxLength: 500 })
  @IsString()
  @MaxLength(500)
  @IsOptional()
  backText?: string;

  @ApiPropertyOptional({ maxLength: 255 })
  @IsString()
  @MaxLength(255)
  @IsOptional()
  ipaPronunciation?: string;

  @ApiPropertyOptional({ maxLength: 1000 })
  @IsString()
  @MaxLength(1000)
  @IsOptional()
  exampleSentence?: string;

  @ApiPropertyOptional({ maxLength: 500 })
  @IsString()
  @MaxLength(500)
  @IsOptional()
  imageUrl?: string;

  @ApiPropertyOptional({ maxLength: 500 })
  @IsString()
  @MaxLength(500)
  @IsOptional()
  audioUrl?: string;
}

export class GenerateCardsDto {
  @ApiProperty({
    description:
      "Source text to extract vocabulary from (reading passage, article, etc.)",
  })
  @IsString()
  text: string;

  @ApiPropertyOptional({
    example: "english",
    description: "Language of the source text",
  })
  @IsString()
  @IsOptional()
  language?: string;

  @ApiPropertyOptional({
    description: "Number of cards to generate (3-20)",
    default: 10,
    minimum: 3,
    maximum: 20,
  })
  @IsNumber()
  @IsOptional()
  @Min(3)
  @Max(20)
  count?: number;
}
