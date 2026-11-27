import {
  Controller,
  Post,
  Get,
  Body,
  Query,
  Param,
  Req,
  Res,
  Headers,
  HttpCode,
  HttpStatus,
  Header,
  Logger,
  UnauthorizedException,
} from "@nestjs/common";
import {
  ApiTags,
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiBody,
} from "@nestjs/swagger";
import { Request, Response } from "express";
import { JwtService } from "@nestjs/jwt";
import { Throttle } from "@nestjs/throttler";
import { RateLimit } from "../../common/decorators/rate-limit.decorator";
import { AuthService } from "../services/auth.service";
import { LoginAttemptService } from "../services/login-attempt.service";
import { AuditLogService } from "../../common/services/audit-log.service";
import { RegisterDto } from "../dto/register.dto";
import { LoginDto } from "../dto/login.dto";
import { ChangePasswordDto } from "../dto/change-password.dto";
import {
  ForgotPasswordDto,
  ResetPasswordDto,
  RefreshTokenDto,
  ResendVerificationDto,
  MfaVerifyDto,
} from "../dto/auth.dto";
import { Public } from "../decorators/public.decorator";
import { CurrentUser } from "../decorators/current-user.decorator";
import { User } from "../../users/entities/user.entity";

@ApiTags("Auth")
@Controller("auth")
export class AuthController {
  private readonly logger = new Logger(AuthController.name);
  private static readonly REFRESH_COOKIE = "refreshToken";

  constructor(
    private readonly authService: AuthService,
    private readonly loginAttemptService: LoginAttemptService,
    private readonly auditLogService: AuditLogService,
    private readonly jwtService: JwtService,
  ) {}

  // ─── Register ──────────────────────────────────────────────────────────────
  @Public()
  @Post("register")
  @RateLimit("REGISTER")
  @ApiOperation({ summary: "Register new account" })
  @ApiResponse({ status: 201, description: "User successfully registered" })
  @ApiResponse({ status: 400, description: "Validation failed" })
  @ApiResponse({ status: 409, description: "Email already exists" })
  register(@Body() dto: RegisterDto, @Req() req: Request) {
    return this.authService.register(dto, req);
  }

  // ─── Verify Email ─────────────────────────────────────────────────────────
  @Public()
  @Get("verify-email")
  @Header("Cache-Control", "no-store")
  @ApiOperation({ summary: "Verify email with token" })
  verifyEmail(@Query("token") token: string) {
    return this.authService.verifyEmail(token);
  }

  // ─── Login ────────────────────────────────────────────────────────────────
  @Public()
  @Post("login")
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: "Login - returns tokens or mfaRequired" })
  @ApiResponse({
    status: 200,
    description: "Successful login (returns JWT) or MFA required",
  })
  @ApiResponse({ status: 401, description: "Unauthorized / Bad credentials" })
  @ApiResponse({ status: 403, description: "Account locked or disabled" })
  @ApiResponse({ status: 429, description: "Too many requests (Rate limit)" })
  async login(
    @Body() dto: LoginDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const result = await this.authService.login(dto, req);
    if ("refreshToken" in result && result.refreshToken) {
      this.setRefreshTokenCookie(res, result.refreshToken);
    }
    return result;
  }

  // ─── MFA Verify (complete login after MFA challenge) ─────────────────────
  @Public()
  @Post("verify-mfa")
  @HttpCode(HttpStatus.OK)
  @RateLimit("MFA")
  @ApiOperation({ summary: "Complete MFA login challenge" })
  @ApiResponse({
    status: 200,
    description: "Successful verification, returns JWT",
  })
  @ApiResponse({ status: 401, description: "Invalid MFA token or OTP code" })
  async verifyMfa(
    @Body() dto: MfaVerifyDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const result = await this.authService.validateMfaLogin(
      dto.mfaToken,
      dto.totpCode,
      req,
      dto.deviceId,
      dto.deviceName,
      dto.deviceType,
    );
    if (result.refreshToken) {
      this.setRefreshTokenCookie(res, result.refreshToken);
    }
    return result;
  }

  // ─── Refresh Token ────────────────────────────────────────────────────────
  @Public()
  @Post("refresh-token")
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: "Rotate refresh token" })
  @ApiResponse({ status: 200, description: "Tokens rotated successfully" })
  @ApiResponse({ status: 401, description: "Invalid or expired refresh token" })
  async refreshToken(
    @Body() dto: RefreshTokenDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const token = this.resolveRefreshToken(dto, req);
    const result = await this.authService.refreshToken(token, req);
    if (result.refreshToken) {
      this.setRefreshTokenCookie(res, result.refreshToken);
    }
    return result;
  }

  // ─── Logout ───────────────────────────────────────────────────────────────
  @Post("logout")
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiBearerAuth()
  @ApiOperation({ summary: "Logout current device session" })
  @ApiResponse({ status: 204, description: "Successfully logged out" })
  async logout(
    @CurrentUser() user: User,
    @Headers("authorization") authHeader: string,
    @Body("refreshToken") refreshToken: string,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const accessToken = authHeader?.replace("Bearer ", "") ?? "";
    const tokenToRevoke = refreshToken || req.cookies?.refreshToken || "";
    this.clearRefreshTokenCookie(res);
    return this.authService.logout(accessToken, tokenToRevoke, user, req);
  }

  // ─── Logout All ───────────────────────────────────────────────────────────
  @Post("logout-all")
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiBearerAuth()
  @ApiOperation({ summary: "Logout all device sessions" })
  async logoutAll(
    @CurrentUser() user: User,
    @Headers("authorization") authHeader: string,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const accessToken = authHeader?.replace("Bearer ", "") ?? "";
    this.clearRefreshTokenCookie(res);
    return this.authService.logoutAll(accessToken, user, req);
  }

  // ─── Logout specific device session ──────────────────────────────────────
  @Post("logout-session/:deviceId")
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiBearerAuth()
  @ApiOperation({ summary: "Logout a specific device session by deviceId" })
  async logoutSession(
    @CurrentUser() user: User,
    @Headers("authorization") authHeader: string,
    @Req() req: Request,
    @Param("deviceId") deviceId: string,
    @Res({ passthrough: true }) res: Response,
  ) {
    const accessToken = authHeader?.replace("Bearer ", "") ?? "";
    return this.authService.logoutSession(accessToken, deviceId, user, req);
  }

  // ─── Forgot Password ─────────────────────────────────────────────────────
  @Public()
  @Post("forgot-password")
  @ApiOperation({ summary: "Send password reset email" })
  forgotPassword(@Body() dto: ForgotPasswordDto) {
    return this.authService.forgotPassword(dto);
  }

  // ─── Reset Password ───────────────────────────────────────────────────────
  @Public()
  @Post("reset-password")
  @ApiOperation({ summary: "Reset password with token" })
  resetPassword(@Body() dto: ResetPasswordDto) {
    return this.authService.resetPassword({
      token: dto.token,
      newPassword: dto.newPassword,
    });
  }

  // ─── Change Password ──────────────────────────────────────────────────────
  @Post("change-password")
  @ApiBearerAuth()
  @ApiOperation({ summary: "Change password while logged in" })
  changePassword(
    @Body() dto: ChangePasswordDto,
    @CurrentUser() user: User,
    @Req() req: Request,
  ) {
    return this.authService.changePassword(dto, user, req);
  }

  // ─── Resend Verification ──────────────────────────────────────────────────
  @Public()
  @Post("resend-verification")
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @RateLimit("EMAIL_VERIFICATION")
  @ApiOperation({ summary: "Resend email verification" })
  resendVerification(@Body() dto: ResendVerificationDto) {
    return this.authService.resendVerificationEmail(dto.email);
  }

  // ─── Login History ────────────────────────────────────────────────────────
  @Get("login-history")
  @ApiBearerAuth()
  @ApiOperation({ summary: "Get login history (last 90 days)" })
  loginHistory(
    @CurrentUser("id") userId: string,
    @Query("page") page = 1,
    @Query("size") size = 20,
  ) {
    return this.loginAttemptService.getLoginHistory(userId, +page, +size);
  }

  // ─── Security Events (Audit Logs) ─────────────────────────────────────────
  @Get("security-events")
  @ApiBearerAuth()
  @ApiOperation({ summary: "Get audit log entries" })
  securityEvents(
    @CurrentUser("id") userId: string,
    @Query("page") page = 1,
    @Query("size") size = 20,
  ) {
    return this.auditLogService.getAuditLogs(userId, +page, +size);
  }

  /**
   * Prefer the HttpOnly cookie and require any body token to be identical to it.
   * A body-only token is accepted solely when no cookie is present (native
   * clients), and deviceId must agree with the access token and refresh JWT so
   * a stolen token cannot silently rotate another device's session.
   */
  private resolveRefreshToken(dto: RefreshTokenDto, req: Request): string {
    const bodyToken = dto.refreshToken;
    const cookieToken = req.cookies?.[AuthController.REFRESH_COOKIE];

    if (bodyToken && cookieToken && bodyToken !== cookieToken) {
      this.logger.warn("Refresh token body/cookie mismatch rejected");
      throw new UnauthorizedException("Refresh token does not match session cookie");
    }

    const token = bodyToken || cookieToken;
    if (!token) {
      throw new UnauthorizedException("Refresh token required");
    }

    const refreshPayload = this.jwtService.decode(token) as
      | { deviceId?: unknown; type?: unknown }
      | null;
    if (!refreshPayload || refreshPayload.type !== "REFRESH") {
      throw new UnauthorizedException("Refresh token invalid or expired");
    }

    const expectedDeviceId = this.getAuthenticatedDeviceId(req);
    if (dto.deviceId && dto.deviceId !== refreshPayload.deviceId) {
      this.logger.warn("Refresh token deviceId mismatch rejected");
      throw new UnauthorizedException("Refresh token device mismatch");
    }
    if (expectedDeviceId && expectedDeviceId !== refreshPayload.deviceId) {
      this.logger.warn("Refresh token does not match presenting access token device");
      throw new UnauthorizedException("Refresh token device mismatch");
    }

    return token;
  }

  private getAuthenticatedDeviceId(req: Request): string | undefined {
    const authHeader = req.headers.authorization;
    const accessToken =
      typeof authHeader === "string" && authHeader.startsWith("Bearer ")
        ? authHeader.slice(7).trim()
        : undefined;
    if (!accessToken) return undefined;

    const payload = this.jwtService.decode(accessToken) as
      | { deviceId?: unknown; type?: unknown }
      | null;
    if (
      !payload ||
      payload.type === "REFRESH" ||
      payload.deviceId === undefined ||
      payload.deviceId === null
    ) {
      throw new UnauthorizedException("Invalid access token");
    }
    return String(payload.deviceId);
  }

  private getCookieOptions(maxAge: number) {
    return {
      httpOnly: true,
      secure: true,
      sameSite: "lax" as const,
      maxAge,
      path: "/",
    };
  }

  private setRefreshTokenCookie(res: Response, refreshToken: string) {
    // The cookie TTL mirrors the issued JWT TTL; rememberMe may extend it to 28 days.
    let maxAge = 7 * 24 * 60 * 60 * 1000;
    try {
      const payload = this.jwtService.decode(refreshToken) as { exp?: number; iat?: number } | null;
      if (payload?.exp && payload?.iat && payload.exp > payload.iat) {
        maxAge = (payload.exp - payload.iat) * 1000;
      }
    } catch {
      // Keep the default lifetime if the token cannot be decoded here.
    }
    res.cookie(
      AuthController.REFRESH_COOKIE,
      refreshToken,
      this.getCookieOptions(maxAge),
    );
  }

  private clearRefreshTokenCookie(res: Response) {
    res.clearCookie(AuthController.REFRESH_COOKIE, this.getCookieOptions(0));
  }
}
