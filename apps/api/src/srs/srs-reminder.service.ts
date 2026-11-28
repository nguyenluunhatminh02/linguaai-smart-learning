import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service';
import { EmailService } from '../email/email.service';

@Injectable()
export class SrsReminderService {
  private readonly logger = new Logger(SrsReminderService.name);

  constructor(
    private prisma: PrismaService,
    private emailService: EmailService,
  ) {}

  /**
   * Runs every day at 8:00 AM server time.
   * Finds all users with at least one due card and sends a reminder email.
   */
  @Cron('0 8 * * *', { name: 'srs-daily-email-reminder' })
  async sendDailyReminders(): Promise<void> {
    this.logger.log('Running SRS daily reminder job…');

    const now = new Date();

    // Find users who have at least one due card and have a verified email
    const usersWithDue = await this.prisma.user_card_progress.groupBy({
      by: ['user_id'],
      where: { next_review_date: { lte: now } },
    });

    if (usersWithDue.length === 0) {
      this.logger.log('No users with due cards — skipping reminder emails');
      return;
    }

    const userIds = usersWithDue.map((u) => u.user_id);

    // Load user details (only email-verified active users who have not opted out of email notifications)
    const users = await this.prisma.users.findMany({
      where: {
        id: { in: userIds },
        email_verified: true,
        is_active: true,
        is_deleted: false,
        notification_email_enabled: true,
      },
      select: { id: true, email: true, first_name: true },
    });

    // Count due cards per user
    const dueCounts = await this.prisma.user_card_progress.groupBy({
      by: ['user_id'],
      where: {
        user_id: { in: users.map((u) => u.id) },
        next_review_date: { lte: now },
      },
      _count: { user_id: true },
    });

    const dueMap = new Map(dueCounts.map((d) => [d.user_id, d._count.user_id]));

    let sent = 0;
    for (const user of users) {
      const dueCount = dueMap.get(user.id) ?? 0;
      if (dueCount === 0) continue;
      const firstName = user.first_name || user.email.split('@')[0];
      try {
        await this.emailService.sendSrsReminderEmail(
          user.email,
          firstName,
          dueCount,
        );
        sent++;
      } catch (err: unknown) {
        this.logger.warn(
          `Failed to send reminder to ${user.email}: ${(err as Error).message}`,
        );
      }
    }

    this.logger.log(`SRS reminder job complete — sent ${sent} emails`);
  }
}
