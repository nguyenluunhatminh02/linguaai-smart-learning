import { Controller, Get, Post, Body, Param, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags, ApiOperation, ApiQuery, ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsBase64, IsIn, IsOptional, IsString, MaxLength } from 'class-validator';
import { SpeakingService } from './speaking.service';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { MAX_UPLOAD_BYTES, TRANSCRIBE_MIME_TYPES } from '../files/file-validation';

/** Languages accepted by the Whisper language codes used by SpeakingService. */
const TRANSCRIBE_LANGUAGES = [
  'english',
  'vietnamese',
  'japanese',
  'chinese',
  'korean',
  'spanish',
  'french',
  'german',
] as const;

/**
 * DTO class (not an inline type) so the global ValidationPipe validates,
 * whitelists and transforms the request body before it reaches the service.
 */
class TranscribeDto {
  @ApiProperty({
    description: 'Base64-encoded audio payload (max 10 MiB decoded)',
    maxLength: Math.ceil(MAX_UPLOAD_BYTES / 3) * 4,
  })
  @IsString()
  @IsBase64()
  // Base64 is ~4/3 of decoded size; the shared validator enforces the exact
  // decoded-byte budget and signature before any billable provider call.
  @MaxLength(Math.ceil(MAX_UPLOAD_BYTES / 3) * 4)
  audio!: string;

  @ApiPropertyOptional({ required: false, example: 'audio/webm', enum: [...TRANSCRIBE_MIME_TYPES] })
  @IsOptional()
  @IsString()
  @IsIn([...TRANSCRIBE_MIME_TYPES])
  @MaxLength(100)
  mimeType?: string;

  @ApiPropertyOptional({ required: false, enum: TRANSCRIBE_LANGUAGES })
  @IsOptional()
  @IsIn(TRANSCRIBE_LANGUAGES)
  language?: string;
}

/**
 * S6: HTTP controller for Speaking session history.
 * Real-time STT + feedback streaming lives in SpeakingGateway (WebSocket).
 * This controller only serves CRUD on persisted submissions.
 */
@ApiTags('Speaking')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('speaking')
export class SpeakingController {
  constructor(private readonly speakingService: SpeakingService) {}

  @Post('transcribe')
  @ApiOperation({ summary: 'Transcribe user speaking audio file using Whisper' })
  transcribe(
    @CurrentUser('id') userId: string,
    @Body() body: TranscribeDto,
  ) {
    return this.speakingService.transcribe(userId, body.audio, body.mimeType, body.language);
  }

  @Get('history')
  @ApiOperation({ summary: 'List my speaking session history' })
  @ApiQuery({ name: 'page', required: false })
  @ApiQuery({ name: 'limit', required: false })
  getHistory(
    @CurrentUser('id') userId: string,
    @Query('page') page?: number,
    @Query('limit') limit?: number,
  ) {
    return this.speakingService.getHistory(userId, Number(page) || 1, Number(limit) || 10);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get one speaking submission by id' })
  getOne(@CurrentUser('id') userId: string, @Param('id') id: string) {
    return this.speakingService.getOne(userId, id);
  }
}
