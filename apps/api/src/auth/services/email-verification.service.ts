import { Injectable, BadRequestException } from '@nestjs/common';
import * as crypto from 'crypto';
import { PrismaService } from '../../prisma/prisma.service';
import { EmailService } from '../../email/email.service';
import { RateLimiterService } from '../../common/services/rate-limiter.service';
import { EMAIL_VERIFICATION_EXPIRY_MS } from '../../common/constants/auth.constants';
import { DateUtil } from '../../common/utils/date.util';

/** Hash the email so no PII appears in Redis keys or log lines. */
function emailKeyPart(email: string): string {
  return crypto
    .createHash('sha256')
    .update(email.trim().toLowerCase())
    .digest('hex')
    .slice(0, 24);
}

@Injectable()
export class EmailVerificationService {
  constructor(
    private prisma: PrismaService,
    private emailService: EmailService,
    private readonly rateLimiter: RateLimiterService,
  ) {}

  async verifyEmail(token: string): Promise<{ message: string }> {
    if (typeof token !== 'string' || !/^[0-9a-f]{64}$/.test(token)) {
      throw new BadRequestException('Invalid verification token');
    }

    const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
    const now = new Date();
    const result = await this.prisma.users.updateMany({
      where: {
        email_verification_token: tokenHash,
        email_verification_expiry: { gt: now },
        email_verified: false,
        is_active: true,
      },
      data: {
        email_verified: true,
        email_verified_at: now,
        email_verification_token: null,
        email_verification_expiry: null,
      },
    });
    if (!result.count)
      throw new BadRequestException('Invalid or expired verification token');

    return { message: 'Email verified successfully' };
  }

  async resendVerificationEmail(email: string): Promise<{ message: string }> {
    // Always return the same response: whether an account exists or is already
    // verified must not be observable to an unauthenticated caller.
    const response = {
      message:
        'If that email needs verification, a verification link was sent.',
    };
    const normalizedEmail = email.trim();

    // Per-email limits (the controller's @Throttle covers per-IP). Apply the
    // short-window check before any DB lookup so repeated calls for an unknown
    // address cannot be used to enumerate accounts at unlimited speed.
    // Fail-closed via RateLimiterService: when Redis is unavailable no token is
    // generated, so mail-bombing cannot degrade to an unthrottled path.
    const key = emailKeyPart(normalizedEmail);
    await this.rateLimiter.checkRateLimit(`resend:min:${key}`, {
      limit: 1,
      window: 60,
      keyPrefix: 'email_verify',
    });
    await this.rateLimiter.checkRateLimit(`resend:hour:${key}`, {
      limit: 5,
      window: 3600,
      keyPrefix: 'email_verify',
    });

    const user = await this.prisma.users.findUnique({
      where: { email: normalizedEmail },
    });
    if (!user || user.email_verified || !user.is_active) return response;

    const token = crypto.randomBytes(32).toString('hex');
    const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
    const updated = await this.prisma.users.updateMany({
      where: { id: user.id, email_verified: false, is_active: true },
      data: {
        email_verification_token: tokenHash,
        email_verification_expiry: DateUtil.addMs(EMAIL_VERIFICATION_EXPIRY_MS),
      },
    });
    if (updated.count) {
      await this.emailService.sendVerificationEmail(
        user.email,
        user.first_name,
        token,
      );
    }
    return response;
  }
}
