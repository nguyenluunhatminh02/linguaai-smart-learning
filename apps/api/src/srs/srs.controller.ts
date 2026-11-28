import {
  Controller,
  DefaultValuePipe,
  Get,
  ParseIntPipe,
  ParseUUIDPipe,
  Post,
  Body,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiTags,
  ApiOperation,
  ApiQuery,
} from '@nestjs/swagger';
import { SrsService } from './srs.service';
import {
  ReviewCardDto,
  StartSessionDto,
  FinishSessionDto,
} from './dto/srs.dto';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';

@ApiTags('Spaced Repetition')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('srs')
export class SrsController {
  constructor(private srsService: SrsService) {}

  @Get('due-cards')
  @ApiOperation({ summary: 'Get due cards for review' })
  @ApiQuery({ name: 'deckId', required: true })
  @ApiQuery({ name: 'limit', required: false })
  getDueCards(
    @CurrentUser('id') userId: string,
    @Query('deckId', ParseUUIDPipe) deckId: string,
    @Query('limit', new DefaultValuePipe(20), ParseIntPipe) limit: number,
  ) {
    return this.srsService.getDueCards(
      userId,
      deckId,
      Math.min(100, Math.max(1, limit)),
    );
  }

  @Post('review')
  @ApiOperation({ summary: 'Submit a card review result' })
  reviewCard(@CurrentUser('id') userId: string, @Body() dto: ReviewCardDto) {
    return this.srsService.reviewCard(userId, dto);
  }

  @Post('session/start')
  @ApiOperation({ summary: 'Start a review session' })
  startSession(
    @CurrentUser('id') userId: string,
    @Body() dto: StartSessionDto,
  ) {
    return this.srsService.startSession(userId, dto);
  }

  @Post('session/finish')
  @ApiOperation({ summary: 'Finish a review session' })
  finishSession(
    @CurrentUser('id') userId: string,
    @Body() dto: FinishSessionDto,
  ) {
    return this.srsService.finishSession(userId, dto);
  }

  @Get('stats')
  @ApiOperation({ summary: 'Get SRS statistics' })
  getStats(@CurrentUser('id') userId: string) {
    return this.srsService.getStats(userId);
  }

  @Get('retention-dashboard')
  @ApiOperation({
    summary: 'Get FSRS retention dashboard',
    description:
      'Shows per-deck memory health: retrievability %, at-risk cards, stability/difficulty per card. ' +
      'Powered by FSRS-4.5 forgetting curve model.',
  })
  getRetentionDashboard(@CurrentUser('id') userId: string) {
    return this.srsService.getRetentionDashboard(userId);
  }

  @Get('forecast')
  @ApiOperation({ summary: 'Get review forecast for next 30 days' })
  @ApiQuery({ name: 'days', required: false })
  getForecast(
    @CurrentUser('id') userId: string,
    @Query('days', new DefaultValuePipe(30), ParseIntPipe) days: number,
  ) {
    return this.srsService.getForecast(
      userId,
      Math.min(365, Math.max(1, days)),
    );
  }
}
