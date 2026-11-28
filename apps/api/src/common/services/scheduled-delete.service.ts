import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { DeleteStatus } from '../../users/enums/delete-status.enum';
import { DELETE_GRACE_PERIOD_MS } from '../constants/auth.constants';
import { PrismaService } from '../../prisma/prisma.service';
import { DateUtil } from '../utils/date.util';

@Injectable()
export class ScheduledDeleteService {
  private readonly logger = new Logger(ScheduledDeleteService.name);

  constructor(private prisma: PrismaService) {}

  @Cron(CronExpression.EVERY_DAY_AT_2AM)
  async permanentlyDeleteExpiredAccounts() {
    const thirtyDaysAgo = DateUtil.subtractMs(DELETE_GRACE_PERIOD_MS);

    const users = await this.prisma.users.findMany({
      where: {
        delete_status: DeleteStatus.DELETE_REQUESTED,
        delete_requested_at: { lt: thirtyDaysAgo },
      },
    });

    let successCount = 0;
    let failureCount = 0;

    for (const user of users) {
      try {
        await this.prisma.$transaction(async (tx) => {
          await tx.oauth_accounts.deleteMany({ where: { user_id: user.id } });
          await tx.verification_tokens.deleteMany({
            where: { user_id: user.id },
          });
          await tx.mfa_secrets.deleteMany({ where: { user_id: user.id } });
          await tx.user_devices.deleteMany({ where: { user_id: user.id } });
          await tx.login_attempts.deleteMany({ where: { user_id: user.id } });
          await tx.refresh_tokens.deleteMany({ where: { user_id: user.id } });
          await tx.password_history.deleteMany({ where: { user_id: user.id } });
          await tx.security_questions.deleteMany({
            where: { user_id: user.id },
          });
          await tx.login_history.deleteMany({ where: { user_id: user.id } });

          await tx.users.update({
            where: { id: user.id },
            data: {
              delete_status: DeleteStatus.PERMANENTLY_DELETED,
              is_deleted: true,
              is_active: false,
              email: `deleted_${user.id}@deleted.local`,
              first_name: 'Deleted',
              last_name: 'User',
              phone: null,
              avatar_url: null,
              password: null,
              two_factor_enabled: false,
            },
          });
        });
        successCount++;
      } catch (error) {
        failureCount++;
        this.logger.error(
          `Failed to permanently delete user ${user.id}: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }

    if (successCount > 0) {
      this.logger.log(`Permanently deleted ${successCount} expired account(s)`);
    }
    if (failureCount > 0) {
      this.logger.warn(
        `Failed to permanently delete ${failureCount} expired account(s); they will be retried on the next run`,
      );
    }
  }
}
