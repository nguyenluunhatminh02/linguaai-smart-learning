import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { LoginAction } from '../../users/enums/login-action.enum';
import { RequestContext } from '../../common/utils/request-context.util';

// Keep client-supplied values inside the VARCHAR bounds of the audit tables so a
// single oversized header can never cause an INSERT to fail (and erase the event).
const USER_AGENT_MAX = 512;
const ACTION_MAX = 100;
const RESOURCE_MAX = 100;
const RESOURCE_ID_MAX = 255;
const DEVICE_ID_MAX = 255;
const IP_ADDRESS_MAX = 50;

function truncate(value: string | null | undefined, maxLength: number): string | null {
  if (value === null || value === undefined) return null;
  return value.length > maxLength ? value.slice(0, maxLength) : value;
}

@Injectable()
export class AuditLogService {
  private readonly logger = new Logger(AuditLogService.name);

  constructor(private prisma: PrismaService) {}

  async recordLoginHistory(
    user: { id: string },
    action: LoginAction,
    ctx: RequestContext,
    success: boolean,
    failureReason: string | null = null,
  ): Promise<void> {
    try {
      await this.prisma.login_history.create({
        data: {
          user_id: user.id,
          action,
          ip_address: truncate(ctx.ip, IP_ADDRESS_MAX),
          user_agent: truncate(ctx.ua, USER_AGENT_MAX),
          device_info: truncate(ctx.device, USER_AGENT_MAX),
          success,
          failure_reason: truncate(failureReason, USER_AGENT_MAX),
        },
      });
    } catch (err) {
      // Auditing is best-effort by design (callers deliberately keep working
      // when Redis/DB logging is unavailable), but a dropped security event
      // must be loud enough for operators/monitoring to detect the gap.
      this.logger.error(`Failed to record login history for user ${user.id}: ${err.message}`);
      throw err;
    }
  }

  /** Ghi vào bảng audit_logs mới (ticket-booking-nestjs compat) */
  async recordAuditLog(
    userId: string | null,
    action: string,
    ipAddress?: string,
    options?: {
      resource?: string;
      resourceType?: string;
      resourceId?: string;
      details?: string;
      userAgent?: string;
      deviceId?: string;
      success?: boolean;
    },
  ): Promise<void> {
    try {
      await this.prisma.audit_logs.create({
        data: {
          user_id: userId,
          action: truncate(action, ACTION_MAX)!,
          ip_address: truncate(ipAddress, IP_ADDRESS_MAX),
          resource: truncate(options?.resource, RESOURCE_MAX),
          resource_type: truncate(options?.resourceType, RESOURCE_MAX),
          resource_id: truncate(options?.resourceId, RESOURCE_ID_MAX),
          details: truncate(options?.details, USER_AGENT_MAX),
          user_agent: truncate(options?.userAgent, USER_AGENT_MAX),
          device_id: truncate(options?.deviceId, DEVICE_ID_MAX),
          success: options?.success ?? true,
        },
      });
    } catch (err) {
      this.logger.error(`Failed to record audit log for user ${userId ?? 'unknown'}: ${err.message}`);
      throw err;
    }
  }

  /** Lấy audit logs paginated */
  async getAuditLogs(
    userId: string,
    page = 1,
    size = 20,
  ): Promise<{ data: any[]; total: number; page: number; size: number }> {
    // The controller forwards raw `+page`/`+size` query values; reject anything
    // that is not a small positive integer before it reaches Prisma.
    if (
      !Number.isSafeInteger(page) || !Number.isSafeInteger(size) ||
      page < 1 || size < 1 || size > 100 ||
      !Number.isSafeInteger((page - 1) * size)
    ) {
      throw new BadRequestException('Invalid pagination: page must be >= 1 and size must be between 1 and 100');
    }

    const skip = (page - 1) * size;
    const [data, total] = await Promise.all([
      this.prisma.audit_logs.findMany({
        where: { user_id: userId },
        orderBy: { created_at: 'desc' },
        skip,
        take: size,
      }),
      this.prisma.audit_logs.count({ where: { user_id: userId } }),
    ]);
    return { data, total, page, size };
  }
}
