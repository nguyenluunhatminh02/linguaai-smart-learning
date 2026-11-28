import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationsService } from './notifications.service';
import {
  notifications_type_enum,
  notifications_channel_enum,
} from '../generated/prisma';

@Injectable()
export class NotificationsCronService {
  private readonly logger = new Logger(NotificationsCronService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly notificationsService: NotificationsService,
  ) {}

  /**
   * Daily cron job running at 8:00 AM UTC (or 3:00 PM GMT+7)
   * to remind users about their due cards.
   */
  @Cron('0 8 * * *', { name: 'srs-daily-reminder', timeZone: 'UTC' })
  async handleDailySRSReminder() {
    this.logger.log('Starting daily SRS review reminder check...');
    const today = new Date();

    try {
      // Group cards due today by user_id
      const dueCards = await this.prisma.user_card_progress.groupBy({
        by: ['user_id'],
        where: {
          next_review_date: {
            lte: today,
          },
        },
        _count: {
          card_id: true,
        },
      });

      this.logger.log(
        `Found ${dueCards.length} users with cards due for review today.`,
      );

      for (const group of dueCards) {
        if (!group.user_id) continue;
        const count = group._count.card_id;

        // Skip if count is 0 (should not happen due to query)
        if (count === 0) continue;

        const title = 'Bài học đến hạn ôn tập';
        const message = `Bạn có ${count} từ vựng cần ôn tập hôm nay trong hệ thống SRS. Hãy duy trì chuỗi streak học tập nhé!`;

        await this.notificationsService.create(
          group.user_id,
          notifications_type_enum.SYSTEM,
          notifications_channel_enum.IN_APP,
          title,
          message,
          JSON.stringify({ dueCount: count }),
        );
      }

      this.logger.log('Daily SRS review reminder sent successfully.');
    } catch (err: any) {
      this.logger.error(
        `Failed to run daily SRS reminder: ${err.message}`,
        err.stack,
      );
    }
  }
}
