import { Controller, Get, Query, UseGuards, Headers } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiTags,
  ApiOperation,
  ApiQuery,
} from '@nestjs/swagger';
import { AnalyticsService } from './analytics.service';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';

@ApiTags('Analytics')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('analytics')
export class AnalyticsController {
  constructor(private analyticsService: AnalyticsService) {}

  @Get('dashboard')
  @ApiOperation({ summary: 'Get dashboard stats' })
  getDashboard(
    @CurrentUser('id') userId: string,
    @Headers('x-timezone-offset') timezoneOffset?: string,
  ) {
    const raw = parseInt(timezoneOffset ?? '0', 10);
    const offset = Number.isFinite(raw) && Math.abs(raw) <= 840 ? raw : 0;
    return this.analyticsService.getDashboard(userId, offset);
  }

  @Get('leaderboard')
  @ApiOperation({ summary: 'Get XP leaderboard' })
  @ApiQuery({ name: 'limit', required: false })
  @ApiQuery({
    name: 'period',
    required: false,
    enum: ['thisWeek', 'thisMonth', 'allTime'],
  })
  getLeaderboard(
    @Query('limit') limit?: number,
    @Query('period') period?: 'thisWeek' | 'thisMonth' | 'allTime',
  ) {
    const rawLimit =
      typeof limit === 'number' && Number.isFinite(limit)
        ? Math.trunc(limit)
        : 10;
    const clampedLimit = Math.min(Math.max(1, rawLimit), 100);
    const validPeriods = ['thisWeek', 'thisMonth', 'allTime'] as const;
    const clampedPeriod =
      typeof period === 'string' &&
      validPeriods.includes(period as 'thisWeek' | 'thisMonth' | 'allTime')
        ? (period as 'thisWeek' | 'thisMonth' | 'allTime')
        : 'allTime';
    return this.analyticsService.getLeaderboard(clampedLimit, clampedPeriod);
  }

  @Get('sessions')
  @ApiOperation({ summary: 'Get recent review sessions' })
  getRecentSessions(@CurrentUser('id') userId: string) {
    return this.analyticsService.getRecentSessions(userId);
  }
}
