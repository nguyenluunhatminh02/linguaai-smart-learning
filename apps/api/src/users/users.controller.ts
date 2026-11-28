import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Put,
  Query,
  Req,
  Res,
  ParseIntPipe,
  DefaultValuePipe,
  ForbiddenException,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation, ApiQuery } from '@nestjs/swagger';
import { Request, Response } from 'express';
import { UsersService } from './users.service';
import { TokensService } from '../tokens/tokens.service';
import { SessionService } from '../auth/services/session.service';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { User } from './entities/user.entity';
import { mapToUserResponse } from '../common/mappers/user.mapper';
import { UpdateProfileDto } from './dto/update-profile.dto';
import { UpdateLearningPreferencesDto } from './dto/update-learning-preferences.dto';
import { UpdateNotificationPreferencesDto, UpdatePrivacySettingsDto } from './dto/update-settings.dto';
import { UpdateFcmTokenDto } from './dto/update-fcm-token.dto';
import { SetupSecurityQuestionsDto } from './dto/security-questions.dto';
import { ConsumeTokensDto } from './dto/consume-tokens.dto';
import { DateUtil } from '../common/utils/date.util';
import { HttpException } from '@nestjs/common';

@ApiTags('users')
@ApiBearerAuth()
@Controller('users/me')
export class UsersController {
  constructor(
    private usersService: UsersService,
    private sessionService: SessionService,
    private tokensService: TokensService,
  ) {}

  // ── Profile ────────────────────────────────────────────────────────────────

  @Get()
  @ApiOperation({ summary: 'Get current user profile' })
  getMe(@CurrentUser() user: User) {
    return mapToUserResponse(user);
  }

  @Put()
  @Patch()
  @ApiOperation({ summary: 'Update profile' })
  async updateProfile(
    @CurrentUser() user: User,
    @Body() dto: UpdateProfileDto,
  ) {
    const updated = await this.usersService.updateProfile(user.id, {
      ...dto,
      dateOfBirth: dto.dateOfBirth ? DateUtil.toDate(dto.dateOfBirth) : undefined,
    });
    return mapToUserResponse(updated);
  }

  @Get('learning-preferences')
  @ApiOperation({ summary: 'Get account learning preferences and daily goals' })
  getLearningPreferences(@CurrentUser('id') userId: string) {
    return this.usersService.getLearningPreferences(userId);
  }

  @Patch('learning-preferences')
  @ApiOperation({ summary: 'Update account learning preferences and daily goals' })
  updateLearningPreferences(
    @CurrentUser('id') userId: string,
    @Body() dto: UpdateLearningPreferencesDto,
  ) {
    return this.usersService.updateLearningPreferences(userId, dto);
  }

  // ── Delete account ────────────────────────────────────────────────────────────

  @Delete()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Request account deletion (30-day grace period)' })
  async deleteMe(
    @CurrentUser() user: User & { accessToken: string },
    @Req() req: Request,
  ) {
    await this.sessionService.deleteAccount(user, user.accessToken, req);
    return { message: 'Account deletion requested. You have 30 days to cancel.' };
  }

  @Get('export')
  @ApiOperation({ summary: 'Export all personal data owned by the current user (SEC-11)' })
  async exportMe(@CurrentUser('id') userId: string, @Res() res: Response) {
    const data = await this.usersService.exportUserData(userId);
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store, private');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="linguaai-data-export-${userId}.json"`,
    );
    return res.send(JSON.stringify(data, null, 2));
  }

  @Post('cancel-delete')
  @ApiOperation({ summary: 'Cancel account deletion' })
  async cancelDelete(@CurrentUser() user: User, @Req() req: Request) {
    await this.sessionService.cancelDeleteAccount(user, req);
    return { message: 'Account deletion cancelled' };
  }

  // ── Notification preferences ───────────────────────────────────────────────

  @Get('notification-preferences')
  @ApiOperation({ summary: 'Get notification preferences' })
  getNotificationPreferences(@CurrentUser() user: User) {
    return this.usersService.getNotificationPreferences(user.id);
  }

  @Put('notification-preferences')
  @ApiOperation({ summary: 'Update notification preferences' })
  updateNotificationPreferences(
    @CurrentUser() user: User,
    @Body() dto: UpdateNotificationPreferencesDto,
  ) {
    return this.usersService.updateNotificationPreferences(user.id, dto);
  }

  // ── Privacy settings ───────────────────────────────────────────────────────

  @Get('privacy')
  @ApiOperation({ summary: 'Get privacy settings' })
  getPrivacySettings(@CurrentUser() user: User) {
    return this.usersService.getPrivacySettings(user.id);
  }

  @Put('privacy')
  @ApiOperation({ summary: 'Update privacy settings' })
  updatePrivacySettings(
    @CurrentUser() user: User,
    @Body() dto: UpdatePrivacySettingsDto,
  ) {
    return this.usersService.updatePrivacySettings(user.id, dto);
  }

  // ── FCM token ────────────────────────────────────────────────────────────────

  @Post('fcm-token')
  @ApiOperation({ summary: 'Register FCM token for push notifications' })
  async updateFcmToken(
    @CurrentUser() user: User,
    @Body() dto: UpdateFcmTokenDto,
  ) {
    await this.usersService.updateFcmToken(user.id, dto.fcmToken);
    return { message: 'FCM token updated' };
  }

  // ── Device fingerprints ───────────────────────────────────────────────────────

  @Get('devices')
  @ApiOperation({ summary: 'Get registered devices' })
  getDevices(@CurrentUser() user: User) {
    return this.usersService.getDevices(user.id);
  }

  @Post('devices/:id/trust')
  @ApiOperation({ summary: 'Trust a device' })
  async trustDevice(@CurrentUser() user: User, @Param('id') deviceId: string) {
    await this.usersService.trustDevice(user.id, deviceId);
    return { message: 'Device trusted' };
  }

  @Post('devices/:id/untrust')
  @ApiOperation({ summary: 'Untrust a device' })
  async untrustDevice(@CurrentUser() user: User, @Param('id') deviceId: string) {
    await this.usersService.untrustDevice(user.id, deviceId);
    return { message: 'Device untrusted' };
  }

  @Delete('devices/:id')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Remove a device' })
  async removeDevice(@CurrentUser() user: User, @Param('id') deviceId: string) {
    await this.usersService.removeDevice(user.id, deviceId);
    return { message: 'Device removed' };
  }

  // ── Security questions ────────────────────────────────────────────────────────

  @Post('security-questions')
  @ApiOperation({ summary: 'Set up security questions (1-3)' })
  async setupSecurityQuestions(
    @CurrentUser() user: User,
    @Body() dto: SetupSecurityQuestionsDto,
  ) {
    await this.usersService.setupSecurityQuestions(user.id, dto.questions);
    return { message: 'Security questions set up' };
  }

  @Get('security-questions')
  @ApiOperation({ summary: 'Get security questions (without answers)' })
  getSecurityQuestions(@CurrentUser() user: User) {
    return this.usersService.getSecurityQuestions(user.id);
  }

  // ── Sessions ──────────────────────────────────────────────────────────────────

  @Get('sessions')
  @ApiOperation({ summary: 'List active sessions' })
  getSessions(@CurrentUser() user: User & { accessToken: string }) {
    return this.usersService.getActiveSessions(user.id, user.accessToken);
  }

  @Delete('sessions/:id')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Logout a specific session' })
  async deleteSession(
    @Param('id') sessionId: string,
    @CurrentUser() user: User & { accessToken: string },
    @Req() req: Request,
  ) {
    // Killing another session must not log out the caller. SessionService
    // resolves this refresh_tokens.id and revokes its device/token row; pass
    // no caller access token so its blacklist step is a no-op.
    await this.sessionService.logoutSession('', sessionId, user, req);
    return { message: 'Session logged out' };
  }

  // ── AI feature tokens ─────────────────────────────────────────────────────────

  @Get('tokens')
  @ApiOperation({ summary: 'Get current AI-token balance and today usage' })
  async getTokens(@CurrentUser() user: User) {
    return this.tokensService.getBalance(user.id);
  }

  @Post('tokens/consume')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Consume AI tokens for a feature' })
  async consumeTokens(
    @CurrentUser() user: User,
    @Body() dto: ConsumeTokensDto,
    @Req() req: Request,
  ) {
    const rawKey = req.headers['idempotency-key'];
    // Reject missing/malformed keys instead of silently skipping the debit.
    // A global key namespace would let one user replay another user's
    // transaction (or an internal `daily_topup` grant) for free tokens.
    if (
      typeof rawKey !== 'string' ||
      !/^[0-9a-zA-Z._:-]{8,128}$/.test(rawKey)
    ) {
      throw new ForbiddenException('A valid idempotency-key header is required');
    }
    const idempotencyKey = `${user.id}:${dto.feature}:${rawKey}`.slice(0, 128);
    try {
      const result = await this.tokensService.consumeTokens(
        user.id,
        dto.feature,
        dto.cost,
        idempotencyKey,
      );
      return result;
    } catch (err: any) {
      if (err instanceof ForbiddenException || err.status === 403) {
        throw new HttpException('Insufficient tokens', HttpStatus.PAYMENT_REQUIRED);
      }
      throw err;
    }
  }

  @Post('tokens/daily-checkin')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Claim daily check-in token reward (once per day)' })
  async dailyCheckin(@CurrentUser() user: User) {
    return this.tokensService.dailyCheckIn(user.id);
  }

  // ── Login history ─────────────────────────────────────────────────────────────

  @Get('login-history')
  @ApiOperation({ summary: 'Get paginated login history' })
  @ApiQuery({ name: 'page', required: false, type: Number })
  @ApiQuery({ name: 'size', required: false, type: Number })
  getLoginHistory(
    @CurrentUser() user: User,
    @Query('page', new DefaultValuePipe(0), ParseIntPipe) page: number,
    @Query('size', new DefaultValuePipe(20), ParseIntPipe) size: number,
  ) {
    // Cap size to prevent unbounded queries that exhaust memory / DB resources
    const cappedSize = Math.min(Math.max(1, size), 100);
    return this.usersService.getLoginHistory(user.id, page, cappedSize);
  }
}

