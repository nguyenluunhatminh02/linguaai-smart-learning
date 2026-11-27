import { IsString, IsOptional, MaxLength, Matches, IsIn } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class AssessWritingDto {
  @ApiProperty({ description: 'User-written text to assess' })
  @IsString()
  @MaxLength(10000)
  userText: string;

  @ApiPropertyOptional({ example: 'english' })
  @IsString()
  @Matches(/^[a-zA-Z ]{2,30}$/, {
    message: 'language must be 2-30 letters or spaces',
  })
  @MaxLength(30)
  @IsOptional()
  language?: string;

  @ApiPropertyOptional({ example: 'B1' })
  @IsIn(['A1', 'A2', 'B1', 'B2', 'C1', 'C2'])
  @IsOptional()
  targetLevel?: string;

  @ApiPropertyOptional({ description: 'Optional writing prompt' })
  @IsString()
  @MaxLength(2000)
  @IsOptional()
  promptText?: string;
}
