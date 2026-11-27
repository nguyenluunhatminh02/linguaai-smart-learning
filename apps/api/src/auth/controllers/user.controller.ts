import {
  Controller,
  Get,
  Put,
  Post,
  Delete,
  Body,
  Req,
  UseInterceptors,
  UploadedFile,
  ParseFilePipe,
  MaxFileSizeValidator,
  FileTypeValidator,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation, ApiConsumes } from '@nestjs/swagger';
import { FileInterceptor } from '@nestjs/platform-express';
import { Request } from 'express';
import { UsersService } from '../../users/users.service';
import { TokenService } from '../services/token.service';
import { RedisService } from '../../common/services/redis.service';
import { CurrentUser } from '../decorators/current-user.decorator';
import { User } from '../../users/entities/user.entity';
import { UpdateProfileDto } from '../dto/auth.dto';

@ApiTags('Users')
@ApiBearerAuth()
@Controller('users')
export class UserController {
  constructor(
    private readonly usersService: UsersService,
    private readonly tokenService: TokenService,
    private readonly redis: RedisService,
  ) {}

  // ─── Get own profile ──────────────────────────────────────────────────────
  @Get('me')
  @ApiOperation({ summary: 'Get current user profile' })
  getMe(@CurrentUser() user: User) {
    return this.usersService.getProfile(user.id);
  }

  // ─── Update profile ───────────────────────────────────────────────────────
  @Put('me')
  @ApiOperation({ summary: 'Update current user profile' })
  updateMe(@CurrentUser() user: User, @Body() dto: UpdateProfileDto) {
    return this.usersService.updateProfile(user.id, dto);
  }

  // ─── Deactivate account ───────────────────────────────────────────────────
  @Post('me/deactivate')
  @ApiOperation({ summary: 'Deactivate account and revoke all sessions' })
  async deactivate(@CurrentUser() user: User & { accessToken: string }) {
    // Revoke sessions before disabling so a failure in revocation cannot leave
    // a disabled account with live refresh tokens. Unlike deleteAccount(),
    // this only deactivates: it does not schedule the account for deletion.
    await this.tokenService.revokeAllSessions(user.id);
    if (user.accessToken) {
      await this.tokenService.blacklistToken(user.accessToken);
    }
    await this.usersService.deactivateAccount(user.id);
    // JwtStrategy caches the user (including is_active) for 60s; evict it so
    // the deactivation takes effect on the very next request.
    await this.redis.del(`cache:user:${user.id}`);
    return { message: 'Account deactivated' };
  }

  // ─── Upload avatar ────────────────────────────────────────────────────────
  @Post('me/avatar')
  @ApiOperation({ summary: 'Upload profile picture' })
  @ApiConsumes('multipart/form-data')
  @UseInterceptors(FileInterceptor('file'))
  uploadAvatar(
    @CurrentUser() user: User,
    @UploadedFile(
      new ParseFilePipe({
        validators: [
          new MaxFileSizeValidator({ maxSize: 5 * 1024 * 1024 }), // 5MB
          new FileTypeValidator({ fileType: /image\/(jpeg|png|gif|webp)/ }),
        ],
      }),
    )
    file: Express.Multer.File,
  ) {
    return this.usersService.uploadAvatar(user.id, file);
  }

  // ─── Delete avatar ────────────────────────────────────────────────────────
  @Delete('me/avatar')
  @ApiOperation({ summary: 'Delete profile picture' })
  deleteAvatar(@CurrentUser() user: User) {
    return this.usersService.deleteAvatar(user.id);
  }
}
