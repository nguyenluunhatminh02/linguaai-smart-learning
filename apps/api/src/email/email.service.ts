import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as nodemailer from 'nodemailer';
import { DateUtil } from '../common/utils/date.util';

@Injectable()
export class EmailService {
  private transporter: nodemailer.Transporter | null = null;
  private readonly logger = new Logger(EmailService.name);
  private readonly isDevMode: boolean;

  constructor(
    private config: ConfigService,
  ) {
    const host = config.get<string>('EMAIL_HOST');
    const port = config.get<number>('EMAIL_PORT') || 587;
    const user = config.get<string>('EMAIL_USER');
    const pass = config.get<string>('EMAIL_PASS');
    const isProduction = config.get<string>('NODE_ENV') === 'production';

    if (isProduction && (!host || !user || !pass)) {
      // Never fall back to an unauthenticated local relay in production:
      // verification and password-reset links must not leave an insecure host.
      throw new Error(
        'EMAIL_HOST, EMAIL_USER and EMAIL_PASS are required in production. ' +
        'Configure authenticated SMTP before starting the API.',
      );
    }

    this.isDevMode = !isProduction && !host;

    if (this.isDevMode) {
      this.logger.warn('Email service running in DEV mode — emails will be logged to console instead of sent');
    } else {
      this.transporter = nodemailer.createTransport({
        host: host!,
        port,
        secure: port === 465,
        requireTLS: true,
        tls: { rejectUnauthorized: true },
        auth: { user: user || '', pass: pass || '' },
      });
    }
  }

  async sendWelcomeEmail(to: string, firstName: string): Promise<void> {
    const frontendUrl = this.config.get<string>('FRONTEND_URL');
    const html = this.buildHtml({
      headerColor: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
      title: `Welcome, ${this.esc(firstName)}!`,
      body: `<p>Thank you for creating an account. We're excited to have you on board!</p>`,
      ctaText: 'Start Learning',
      ctaUrl: frontendUrl,
    });
    await this.send(to, 'Welcome to LinguaAI!', html);
  }

  async sendVerificationEmail(to: string, firstName: string, token: string): Promise<void> {
    const frontendUrl = this.config.get<string>('FRONTEND_URL');
    const link = `${frontendUrl}/verify-email?token=${token}`;
    const html = this.buildHtml({
      headerColor: 'linear-gradient(135deg, #43e97b 0%, #38f9d7 100%)',
      title: 'Verify Your Email',
      body: `<p>Hi ${this.esc(firstName)},</p><p>Please click the button below to verify your email address. This link expires in 24 hours.</p>`,
      ctaText: 'Verify Email',
      ctaUrl: link,
    });
    await this.send(to, 'Verify your email', html);
  }

  async sendPasswordResetEmail(to: string, firstName: string, token: string): Promise<void> {
    const frontendUrl = this.config.get<string>('FRONTEND_URL');
    const link = `${frontendUrl}/reset-password?token=${token}`;
    const html = this.buildHtml({
      headerColor: 'linear-gradient(135deg, #f093fb 0%, #f5576c 100%)',
      title: 'Reset Your Password',
      body: `<p>Hi ${this.esc(firstName)},</p><p>We received a request to reset your password. Click the button below to set a new password. This link expires in 60 minutes.</p><p style="color:#888;font-size:13px;">If you didn't request this, you can safely ignore this email.</p>`,
      ctaText: 'Reset Password',
      ctaUrl: link,
    });
    await this.send(to, 'Reset your password', html);
  }

  async sendAccountLockedEmail(to: string, firstName: string): Promise<void> {
    const html = this.buildHtml({
      headerColor: 'linear-gradient(135deg, #ff0844 0%, #ffb199 100%)',
      title: 'Account Locked',
      body: `<p>Hi ${this.esc(firstName)},</p><p>Your account has been temporarily locked due to multiple failed login attempts. It will be automatically unlocked after <strong>30 minutes</strong>.</p><p>If this wasn't you, we recommend changing your password immediately after your account is unlocked.</p>`,
    });
    await this.send(to, 'Account Locked - Security Alert', html);
  }

  async sendPasswordChangedEmail(to: string, firstName: string): Promise<void> {
    const html = this.buildHtml({
      headerColor: 'linear-gradient(135deg, #43e97b 0%, #38f9d7 100%)',
      title: 'Password Changed',
      body: `<p>Hi ${this.esc(firstName)},</p><p>Your password has been successfully changed. If you didn't make this change, please contact support immediately.</p>`,
    });
    await this.send(to, 'Password Changed Successfully', html);
  }

  async sendSrsReminderEmail(to: string, firstName: string, dueCount: number): Promise<void> {
    const frontendUrl = this.config.get<string>('FRONTEND_URL');
    const html = this.buildHtml({
      headerColor: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
      title: `${dueCount} card${dueCount > 1 ? 's' : ''} waiting for review!`,
      body: `<p>Hi ${this.esc(firstName)},</p><p>You have <strong>${dueCount} flashcard${dueCount > 1 ? 's' : ''}</strong> due for review today. Consistent practice is the key to mastery!</p><p style="color:#888;font-size:13px;">Keep your streak going — reviews only take a few minutes.</p>`,
      ctaText: 'Review Now',
      ctaUrl: `${frontendUrl}/flashcards`,
    });
    await this.send(to, `⏰ ${dueCount} flashcard${dueCount > 1 ? 's' : ''} due for review`, html);
  }

  // ─── HTML Builder ─────────────────────────────────────────────────────────────

  private buildHtml(opts: {
    headerColor: string;
    title: string;
    body: string;
    ctaText?: string;
    ctaUrl?: string;
  }): string {
    const cta = opts.ctaText && opts.ctaUrl
      ? `<div style="text-align:center;margin:28px 0"><a href="${this.esc(opts.ctaUrl)}" style="background:${opts.headerColor};color:#fff;padding:14px 32px;border-radius:8px;text-decoration:none;font-weight:600;font-size:16px;display:inline-block">${this.esc(opts.ctaText)}</a></div>`
      : '';
    return `<!DOCTYPE html><html><head><meta charset="utf-8"></head><body style="margin:0;padding:0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;background:#f5f5f5"><div style="max-width:560px;margin:0 auto;padding:20px"><div style="background:${opts.headerColor};color:#fff;padding:32px;border-radius:12px 12px 0 0;text-align:center"><h1 style="margin:0;font-size:24px">${opts.title}</h1></div><div style="background:#fff;padding:32px;border-radius:0 0 12px 12px;box-shadow:0 2px 8px rgba(0,0,0,0.06)">${opts.body}${cta}</div><p style="text-align:center;color:#999;font-size:12px;margin-top:20px">&copy; ${DateUtil.currentYear()} LinguaAI. All rights reserved.</p></div></body></html>`;
  }

  private esc(str: string): string {
    return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  private async send(to: string, subject: string, html: string): Promise<void> {
    if (this.isDevMode) {
      this.logger.log(`[DEV EMAIL] To: ${to} | Subject: ${subject}`);
      return;
    }
    try {
      await this.transporter!.sendMail({
        from: this.config.get<string>('EMAIL_FROM') || 'noreply@linguaai.com',
        to,
        subject,
        html,
      });
    } catch (err) {
      this.logger.error(`Failed to send email to ${to}: ${err.message}`);
      throw err;
    }
  }
}
