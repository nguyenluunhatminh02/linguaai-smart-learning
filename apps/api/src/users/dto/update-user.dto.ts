import { IsString, IsOptional, IsNumber, Min, Max } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class UpdateUserDto {
  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  displayName?: string;

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  avatarUrl?: string;

  @ApiPropertyOptional()
  @IsNumber()
  @IsOptional()
  @Min(1)
  @Max(100)
  dailyGoal?: number;

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  preferredLanguage?: string;

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  nativeLanguage?: string;

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  targetLanguage?: string;
}
