import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import * as crypto from 'crypto';
import { Request } from 'express';
import { UAParser } from 'ua-parser-js';
import { v4 as uuidv4 } from 'uuid';
import { PrismaService } from '../../prisma/prisma.service';
import { RedisService } from '../../common/services/redis.service';
import { TokenService } from './token.service';
import { DateUtil } from '../../common/utils/date.util';

@Injectable()
export class DeviceService {
  private readonly logger = new Logger(DeviceService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly tokenService: TokenService,
  ) {}

  // ─── Register / update device ─────────────────────────────────────────────

  /**
   * Đăng ký device mới hoặc cập nhật lastActiveAt nếu đã tồn tại.
   * Trả về record user_devices.
   *
   * A raw deviceId is NOT proof of device possession: a caller who knows the
   * victim's password could otherwise replay a trusted device's ID and skip
   * MFA. Every login-derived registration therefore requires a matching
   * secret bound to that device at registration time (the DB
   * `user_devices.fingerprint` column). Legacy devices registered without a
   * secret must re-authenticate with MFA and re-register.
   */
  async registerDevice(
    userId: string,
    req: Request,
    deviceId?: string,
    deviceName?: string,
    deviceType?: string,
    deviceSecret?: string,
  ) {
    const ua = req.headers['user-agent'] || '';
    const ip = req.ip || req.socket?.remoteAddress || '';
    const parser = new UAParser(ua);
    const browser = parser.getBrowser();
    const os = parser.getOS();

    // Nếu đã có deviceId → chỉ cho phép cập nhật khi người gọi chứng minh được
    // đang giữ secret của thiết bị đó (fingerprint lưu lúc đăng ký).
    if (deviceId) {
      const existing = await this.prisma.user_devices.findUnique({
        where: { device_id: deviceId },
      });
      if (existing) {
        if (existing.user_id !== userId) {
          throw new BadRequestException('Device ID is not registered to this user');
        }
        const verified =
          !!deviceSecret &&
          !!existing.fingerprint &&
          this.matchesDeviceSecret(deviceSecret, existing.fingerprint);
        // Only mutate the record when possession is proven. Callers that do not
        // yet pass a secret (existing login flows) still get the record back so
        // they can issue tokens, but the device metadata cannot be overwritten
        // by anyone who merely knows the ID.
        if (!verified) return existing;
        return this.prisma.user_devices.update({
          where: { device_id: deviceId },
          data: { last_active_at: DateUtil.now(), ip_address: ip, active: true },
        });
      }
    }

    // Device mới → kiểm tra giới hạn
    const user = await this.prisma.users.findUnique({ where: { id: userId } });
    const limit = user?.max_devices ?? 3;
    const activeCount = await this.prisma.user_devices.count({
      where: { user_id: userId, active: true },
    });

    if (activeCount >= limit) {
      const excessCount = activeCount - limit + 1;
      const oldestActiveDevices = await this.prisma.user_devices.findMany({
        where: { user_id: userId, active: true },
        orderBy: { last_active_at: 'asc' },
        take: excessCount,
      });

      if (oldestActiveDevices.length > 0) {
        for (const dev of oldestActiveDevices) {
          try {
            // Revoke through TokenService so the exact Redis key written by
            // storeRefreshToken is removed and the device record is deactivated.
            await this.tokenService.revokeDeviceSession(userId, dev.device_id);
          } catch (revokeError: any) {
            this.logger.warn(
              `Failed to revoke evicted device session for ${dev.device_id}: ${revokeError.message}`,
            );
          }
        }

        const oldestIds = oldestActiveDevices.map(d => d.device_id);
        await this.prisma.user_devices.updateMany({
          where: { user_id: userId, device_id: { in: oldestIds } },
          data: { active: false },
        });

        this.logger.log(
          `Evicted ${oldestActiveDevices.length} oldest active device(s) for user ${userId} to maintain device limit of ${limit}`,
        );
      }
    }

    // Generate an unguessable secret for every new device. Its hash is stored
    // in the fingerprint column and it is returned alongside the device record
    // so the client can present it on subsequent logins.
    const newDeviceId = deviceId || uuidv4();
    const newDeviceSecret = crypto.randomBytes(32).toString('hex');
    const defaultName = [browser.name, 'on', os.name].filter(Boolean).join(' ') || 'Unknown Device';

    return this.prisma.user_devices.create({
      data: {
        user_id: userId,
        device_id: newDeviceId,
        device_name: deviceName || defaultName,
        device_type: deviceType || 'unknown',
        browser: browser.name || null,
        browser_version: browser.version || null,
        operating_system: os.name || null,
        os_version: os.version || null,
        ip_address: ip || null,
        user_agent: ua || null,
        active: true,
        trusted: false,
        fingerprint: this.hashDeviceSecret(newDeviceSecret),
        last_active_at: DateUtil.now(),
      },
    }).then((device) => ({ ...device, deviceSecret: newDeviceSecret }));
  }

  // ─── Queries ───────────────────────────────────────────────────────────────

  async getActiveDevices(userId: string) {
    return this.prisma.user_devices.findMany({
      where: { user_id: userId, active: true },
      orderBy: { last_active_at: 'desc' },
    });
  }

  async isDeviceTrusted(
    userId: string,
    deviceId: string,
    deviceSecret?: string,
  ): Promise<boolean> {
    const device = await this.prisma.user_devices.findFirst({
      where: { user_id: userId, device_id: deviceId, active: true },
    });
    // Trust only counts when the caller proves possession of the device secret.
    // Without this, knowing the ID alone would bypass MFA.
    return (
      (device?.trusted ?? false) &&
      !!deviceSecret &&
      !!device?.fingerprint &&
      this.matchesDeviceSecret(deviceSecret, device.fingerprint)
    );
  }

  // ─── Trust / Untrust ───────────────────────────────────────────────────────

  async trustDevice(userId: string, deviceId: string) {
    await this.ensureDeviceBelongsToUser(userId, deviceId);
    return this.prisma.user_devices.updateMany({
      where: { user_id: userId, device_id: deviceId },
      data: { trusted: true },
    });
  }

  async untrustDevice(userId: string, deviceId: string) {
    await this.ensureDeviceBelongsToUser(userId, deviceId);
    return this.prisma.user_devices.updateMany({
      where: { user_id: userId, device_id: deviceId },
      data: { trusted: false },
    });
  }

  // ─── Rename ────────────────────────────────────────────────────────────────

  async renameDevice(userId: string, deviceId: string, newName: string) {
    await this.ensureDeviceBelongsToUser(userId, deviceId);
    return this.prisma.user_devices.updateMany({
      where: { user_id: userId, device_id: deviceId },
      data: { device_name: newName },
    });
  }

  // ─── Deactivate ────────────────────────────────────────────────────────────

  async deactivateDevice(userId: string, deviceId: string) {
    await this.ensureDeviceBelongsToUser(userId, deviceId);
    return this.prisma.user_devices.updateMany({
      where: { user_id: userId, device_id: deviceId },
      data: { active: false },
    });
  }

  async deactivateAllDevices(userId: string) {
    return this.prisma.user_devices.updateMany({
      where: { user_id: userId },
      data: { active: false },
    });
  }

  async deactivateOtherDevices(userId: string, currentDeviceId: string) {
    return this.prisma.user_devices.updateMany({
      where: { user_id: userId, device_id: { not: currentDeviceId } },
      data: { active: false },
    });
  }

  // ─── Helper ────────────────────────────────────────────────────────────────

  private hashDeviceSecret(secret: string): string {
    return crypto.createHash('sha256').update(secret).digest('hex');
  }

  private matchesDeviceSecret(secret: string, hashedSecret: string): boolean {
    const candidate = this.hashDeviceSecret(secret);
    const stored = Buffer.from(hashedSecret, 'hex');
    const computed = Buffer.from(candidate, 'hex');
    // Reject malformed legacy fingerprints rather than comparing nonsense.
    if (stored.length !== computed.length || stored.length === 0) return false;
    return crypto.timingSafeEqual(stored, computed);
  }

  private async ensureDeviceBelongsToUser(userId: string, deviceId: string) {
    const device = await this.prisma.user_devices.findFirst({
      where: { device_id: deviceId, user_id: userId },
    });
    if (!device) {
      throw new NotFoundException('Device not found or does not belong to this user');
    }
    return device;
  }
}
