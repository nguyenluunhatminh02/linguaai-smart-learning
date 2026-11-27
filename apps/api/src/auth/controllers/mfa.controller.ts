import {
  Controller,
  Post,
  Get,
  Body,
  Req,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { Request } from 'express';
import { MfaService } from '../services/mfa.service';
import { CurrentUser } from '../decorators/current-user.decorator';
import { User } from '../../users/entities/user.entity';
import { MfaSetupConfirmDto } from '../dto/auth.dto';
import { MfaSetupResponseDto } from '../dto/response.dto';

@ApiTags('MFA')
@ApiBearerAuth()
@Controller('mfa')
export class MfaController {
  constructor(private readonly mfaService: MfaService) {}

  // ─── MFA Status ───────────────────────────────────────────────────────────
  @Get('status')
  @ApiOperation({ summary: 'Check if MFA is enabled' })
  getStatus(@CurrentUser('id') userId: string) {
    return this.mfaService.getMfaStatus(userId);
  }

  // ─── Setup MFA ────────────────────────────────────────────────────────────
  @Post('setup')
  @Throttle({ default: { limit: 5, ttl: 300_000 } })
  @ApiOperation({ summary: 'Generate TOTP secret + QR code + backup codes' })
  setup(@CurrentUser() user: User): Promise<MfaSetupResponseDto> {
    return this.mfaService.setupMfa(user);
  }

  // ─── Confirm Setup ────────────────────────────────────────────────────────
  @Post('setup/confirm')
  @Throttle({ default: { limit: 5, ttl: 300_000 } })
  @ApiOperation({ summary: 'Confirm MFA setup with TOTP code' })
  confirmSetup(
    @Body() dto: MfaSetupConfirmDto,
    @CurrentUser() user: User,
    @Req() req: Request,
  ) {
    return this.mfaService.verifyAndEnableMfa({ code: dto.code }, user, req);
  }

  // ─── Disable MFA ──────────────────────────────────────────────────────────
  @Post('disable')
  @Throttle({ default: { limit: 5, ttl: 300_000 } })
  @ApiOperation({ summary: 'Disable MFA (requires TOTP code)' })
  disable(
    @Body() dto: MfaSetupConfirmDto,
    @CurrentUser() user: User,
    @Req() req: Request,
  ) {
    return this.mfaService.disableMfa({ code: dto.code }, user, req);
  }

  // ─── Regenerate backup codes ──────────────────────────────────────────────
  @Post('backup-codes/regenerate')
  @Throttle({ default: { limit: 5, ttl: 300_000 } })
  @ApiOperation({ summary: 'Regenerate 10 new backup codes (requires TOTP)' })
  regenerateBackupCodes(
    @Body() dto: MfaSetupConfirmDto,
    @CurrentUser('id') userId: string,
  ) {
    return this.mfaService.regenerateBackupCodes(userId, dto.code);
  }

  // ─── Backup codes count ───────────────────────────────────────────────────
  @Get('backup-codes/count')
  @ApiOperation({ summary: 'Get remaining backup codes count' })
  backupCodesCount(@CurrentUser('id') userId: string) {
    return this.mfaService.getBackupCodesCount(userId);
  }
}
