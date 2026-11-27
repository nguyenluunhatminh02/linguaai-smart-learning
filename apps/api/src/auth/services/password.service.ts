import {
  Injectable,
  Logger,
  BadRequestException,
  Inject,
  Optional,
} from "@nestjs/common";
import { REQUEST } from "@nestjs/core";
import * as bcrypt from "bcrypt";
import * as crypto from "crypto";
import { Request } from "express";
import { PrismaService } from "../../prisma/prisma.service";
import { EmailService } from "../../email/email.service";
import { PasswordHistoryService } from "./password-history.service";
import { TokenService } from "./token.service";
import { AuditLogService } from "../../common/services/audit-log.service";
import { RateLimiterService } from "../../common/services/rate-limiter.service";
import {
  BCRYPT_ROUNDS,
  PASSWORD_RESET_EXPIRY_MS,
} from "../../common/constants/auth.constants";
import { extractRequestContext } from "../../common/utils/request-context.util";
import { LoginAction } from "../../users/enums/login-action.enum";
import { User } from "../../users/entities/user.entity";
import { DateUtil } from "../../common/utils/date.util";

/** Reset requests are throttled per account and per client IP. */
const FORGOT_PASSWORD_LIMIT = 3;
const FORGOT_PASSWORD_WINDOW_SEC = 15 * 60;
/** A new link is only issued once per account per cooldown window. */
const FORGOT_PASSWORD_COOLDOWN_MS = 15 * 60 * 1000;
const GENERIC_FORGOT_PASSWORD_MESSAGE =
  "If that email exists, a reset link was sent.";

@Injectable()
export class PasswordService {
  private readonly logger = new Logger(PasswordService.name);

  constructor(
    private prisma: PrismaService,
    private emailService: EmailService,
    private passwordHistoryService: PasswordHistoryService,
    private tokenService: TokenService,
    private auditLogService: AuditLogService,
    private readonly rateLimiterService: RateLimiterService,
    // Injected by Nest for HTTP requests so unauthenticated flows can record
    // the real client context. Optional keeps direct instantiation in unit
    // tests working.
    @Optional() @Inject(REQUEST) private readonly request?: Request,
  ) {}

  private get ip(): string {
    return this.request ? extractRequestContext(this.request).ip : "unknown";
  }

  async forgotPassword(dto: { email: string }): Promise<{ message: string }> {
    const emailKey = dto.email.trim().toLowerCase();

    // Throttle BEFORE looking up the account: a 429 for an unknown address
    // must be indistinguishable from one for a real address, otherwise the
    // limiter itself becomes an account-enumeration oracle.
    await this.rateLimiterService.checkRateLimit(`email:${emailKey}`, {
      limit: FORGOT_PASSWORD_LIMIT,
      window: FORGOT_PASSWORD_WINDOW_SEC,
      keyPrefix: "forgot_password",
    });
    await this.rateLimiterService.checkRateLimit(`ip:${this.ip}`, {
      limit: FORGOT_PASSWORD_LIMIT,
      window: FORGOT_PASSWORD_WINDOW_SEC,
      keyPrefix: "forgot_password",
    });

    const user = await this.prisma.users.findFirst({
      where: { email: dto.email, is_deleted: false },
    });
    if (!user) return { message: GENERIC_FORGOT_PASSWORD_MESSAGE };

    // The expiry is the only issued-at information we persist. A token whose
    // remaining lifetime is close to the full TTL was issued inside the
    // cooldown window, so keep it valid and avoid a second email (and avoid
    // invalidating the link the user already received).
    if (user.password_reset_token && user.password_reset_expiry) {
      const remainingMs =
        new Date(user.password_reset_expiry).getTime() - Date.now();
      if (remainingMs > PASSWORD_RESET_EXPIRY_MS - FORGOT_PASSWORD_COOLDOWN_MS) {
        return { message: GENERIC_FORGOT_PASSWORD_MESSAGE };
      }
    }

    const token = crypto.randomBytes(32).toString("hex");
    const tokenHash = crypto.createHash("sha256").update(token).digest("hex");
    await this.prisma.users.update({
      where: { id: user.id },
      data: {
        password_reset_token: tokenHash,
        password_reset_expiry: DateUtil.addMs(PASSWORD_RESET_EXPIRY_MS),
      },
    });
    try {
      await this.emailService.sendPasswordResetEmail(
        user.email,
        user.first_name,
        token,
      );
    } catch (e: any) {
      // Never turn a mail failure into a different response: that would reveal
      // whether the address exists and whether a token was stored for it.
      this.logger.warn(`Password reset email failed: ${e.message}`);
    }
    return { message: GENERIC_FORGOT_PASSWORD_MESSAGE };
  }

  async resetPassword(dto: {
    token: string;
    newPassword: string;
  }): Promise<{ message: string }> {
    const tokenHash = crypto
      .createHash("sha256")
      .update(dto.token)
      .digest("hex");
    const user = await this.prisma.users.findFirst({
      where: { password_reset_token: tokenHash, is_deleted: false },
    });
    if (
      !user ||
      !user.password_reset_expiry ||
      DateUtil.isExpired(user.password_reset_expiry)
    )
      throw new BadRequestException("Invalid or expired reset token");

    const isReused = await this.passwordHistoryService.isPasswordReused(
      user.id,
      dto.newPassword,
    );
    if (isReused)
      throw new BadRequestException(
        "Cannot reuse a previous password. Please choose a different password.",
      );

    const hashed = await bcrypt.hash(dto.newPassword, BCRYPT_ROUNDS);

    if (user.password) {
      await this.passwordHistoryService.addPasswordToHistory(
        user.id,
        user.password,
      );
    } else {
      // OAuth-only/corrupted accounts have no prior hash to archive. Seed the
      // history with the first password so it can still be detected as a
      // reuse after a few later changes rotate the history window.
      await this.passwordHistoryService.addPasswordToHistory(user.id, hashed);
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.users.update({
        where: { id: user.id },
        data: {
          password: hashed,
          password_reset_token: null,
          password_reset_expiry: null,
        },
      });
      await tx.refresh_tokens.updateMany({
        where: { user_id: user.id },
        data: { is_revoked: true },
      });
    });

    // Refresh tokens are validated against Redis (the source of truth), not the
    // refresh_tokens table. Clear the Redis session keys so existing refresh
    // tokens are actually invalidated after a password reset.
    await this.tokenService.revokeAllSessions(user.id);

    await this.auditLogService.recordLoginHistory(
      { id: user.id, email: user.email, firstName: user.first_name } as any,
      LoginAction.PASSWORD_CHANGED,
      this.request
        ? extractRequestContext(this.request)
        : { ip: "", ua: "", device: "" },
      true,
    );

    return { message: "Password reset successful" };
  }

  async changePassword(
    dto: { currentPassword: string; newPassword: string },
    user: User,
    req: Request,
  ): Promise<{ message: string }> {
    const stored = await this.prisma.users.findUnique({
      where: { id: user.id },
      select: { password: true },
    });
    if (!(await bcrypt.compare(dto.currentPassword, stored?.password ?? "")))
      throw new BadRequestException("Current password incorrect");

    const isReused = await this.passwordHistoryService.isPasswordReused(
      user.id,
      dto.newPassword,
    );
    if (isReused)
      throw new BadRequestException(
        "Cannot reuse a previous password. Please choose a different password.",
      );

    const newPasswordHash = await bcrypt.hash(dto.newPassword, BCRYPT_ROUNDS);

    if (stored?.password) {
      await this.passwordHistoryService.addPasswordToHistory(
        user.id,
        stored.password,
      );
    }

    await this.prisma.users.update({
      where: { id: user.id },
      data: { password: newPasswordHash },
    });
    await this.tokenService.revokeAllSessions(user.id);
    const ctx = extractRequestContext(req);
    await this.auditLogService.recordLoginHistory(
      user,
      LoginAction.PASSWORD_CHANGED,
      ctx,
      true,
    );

    this.emailService
      .sendPasswordChangedEmail(user.email, user.firstName)
      .catch((e) =>
        this.logger.warn(`Password changed email failed: ${e.message}`),
      );
    return { message: "Password changed successfully. Please log in again." };
  }
}
