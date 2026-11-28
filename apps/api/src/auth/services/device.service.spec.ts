import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import * as crypto from 'crypto';
import { Request } from 'express';
import { DeviceService } from './device.service';
import { PrismaService } from '../../prisma/prisma.service';
import { RedisService } from '../../common/services/redis.service';
import { TokenService } from './token.service';

describe('DeviceService (SEC-03 device revocation)', () => {
  let service: DeviceService;
  const USER = 'user-123';
  const DEVICE = 'dev-1';

  const mockPrisma = {
    user_devices: {
      findUnique: jest.fn(),
      findFirst: jest.fn(),
      count: jest.fn(),
      findMany: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
    },
    users: { findUnique: jest.fn() },
  };
  const mockRedis = {};
  const mockTokenService = { revokeDeviceSession: jest.fn() };

  const req = (userAgent = 'Mozilla/5.0') =>
    ({
      headers: { 'user-agent': userAgent },
      ip: '127.0.0.1',
      socket: {},
    }) as unknown as Request;

  beforeEach(async () => {
    jest.clearAllMocks();
    mockPrisma.users.findUnique.mockResolvedValue({ max_devices: 3 });
    mockPrisma.user_devices.count.mockResolvedValue(0);
    mockPrisma.user_devices.findUnique.mockResolvedValue(null);
    mockPrisma.user_devices.findFirst.mockResolvedValue(null);
    mockPrisma.user_devices.create.mockImplementation(
      async ({ data }: any) => data,
    );
    mockPrisma.user_devices.update.mockImplementation(
      async ({ data }: any) => data,
    );
    mockPrisma.user_devices.updateMany.mockResolvedValue({ count: 1 });
    mockTokenService.revokeDeviceSession.mockResolvedValue(undefined);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        DeviceService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: RedisService, useValue: mockRedis },
        { provide: TokenService, useValue: mockTokenService },
      ],
    }).compile();
    service = module.get<DeviceService>(DeviceService);
  });

  const hash = (secret: string) =>
    crypto.createHash('sha256').update(secret).digest('hex');

  describe('registerDevice', () => {
    it('returns an existing device without mutating it when no secret is supplied', async () => {
      const existing = {
        id: 'row-1',
        user_id: USER,
        device_id: DEVICE,
        fingerprint: hash('correct-secret'),
        last_active_at: new Date('2024-01-01'),
      };
      mockPrisma.user_devices.findUnique.mockResolvedValue(existing);

      const result = await service.registerDevice(USER, req(), DEVICE);

      expect(result).toBe(existing);
      expect(mockPrisma.user_devices.update).not.toHaveBeenCalled();
    });

    it('updates the device only when the secret matches its stored hash', async () => {
      mockPrisma.user_devices.findUnique.mockResolvedValue({
        user_id: USER,
        device_id: DEVICE,
        fingerprint: hash('correct-secret'),
      });

      await service.registerDevice(
        USER,
        req(),
        DEVICE,
        undefined,
        undefined,
        'wrong-secret',
      );
      expect(mockPrisma.user_devices.update).not.toHaveBeenCalled();

      await service.registerDevice(
        USER,
        req(),
        DEVICE,
        undefined,
        undefined,
        'correct-secret',
      );
      expect(mockPrisma.user_devices.update).toHaveBeenCalledWith({
        where: { device_id: DEVICE },
        data: {
          last_active_at: expect.any(Date),
          ip_address: '127.0.0.1',
          active: true,
        },
      });
    });

    it('rejects a device ID owned by another user', async () => {
      mockPrisma.user_devices.findUnique.mockResolvedValue({
        user_id: 'other-user',
        device_id: DEVICE,
        fingerprint: hash('secret'),
      });
      await expect(
        service.registerDevice(
          USER,
          req(),
          DEVICE,
          undefined,
          undefined,
          'secret',
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('creates a new device with a hashed secret and returns the raw secret once', async () => {
      const result: any = await service.registerDevice(USER, req(), DEVICE);
      expect(result.device_id).toBe(DEVICE);
      expect(result.deviceSecret).toMatch(/^[0-9a-f]{64}$/);
      expect(result.fingerprint).toBe(hash(result.deviceSecret));
      expect(result.active).toBe(true);
      expect(result.trusted).toBe(false);
    });

    it('evicts the oldest devices, revoking their sessions through TokenService', async () => {
      mockPrisma.user_devices.count.mockResolvedValue(3);
      mockPrisma.user_devices.findMany.mockImplementation(
        async ({ take }: any) =>
          [
            { device_id: 'old-1' },
            { device_id: 'old-2' },
            { device_id: 'old-3' },
          ].slice(0, take),
      );

      await service.registerDevice(USER, req(), 'new-device');

      expect(mockPrisma.user_devices.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          take: 1,
          orderBy: { last_active_at: 'asc' },
        }),
      );
      expect(mockTokenService.revokeDeviceSession).toHaveBeenCalledTimes(1);
      expect(mockTokenService.revokeDeviceSession).toHaveBeenCalledWith(
        USER,
        'old-1',
      );
      expect(mockPrisma.user_devices.updateMany).toHaveBeenCalledWith({
        where: { user_id: USER, device_id: { in: ['old-1'] } },
        data: { active: false },
      });
    });

    it('still creates the device when a session revocation fails', async () => {
      mockPrisma.user_devices.count.mockResolvedValue(3);
      mockTokenService.revokeDeviceSession.mockRejectedValue(
        new Error('Redis down'),
      );

      await expect(
        service.registerDevice(USER, req(), 'new-device'),
      ).resolves.toMatchObject({
        device_id: 'new-device',
      });
      expect(mockPrisma.user_devices.create).toHaveBeenCalled();
    });

    it('evicts the oldest devices when the limit is lowered below the active count', async () => {
      mockPrisma.user_devices.count.mockResolvedValue(3);
      mockPrisma.users.findUnique.mockResolvedValue({ max_devices: 1 });

      await service.registerDevice(USER, req(), 'new-device');

      // activeCount=3, limit=1: all 3 old rows must go before the new one.
      expect(mockPrisma.user_devices.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ take: 3 }),
      );
      expect(mockTokenService.revokeDeviceSession).toHaveBeenCalledTimes(3);
      expect(mockTokenService.revokeDeviceSession).toHaveBeenNthCalledWith(
        1,
        USER,
        'old-1',
      );
      expect(mockTokenService.revokeDeviceSession).toHaveBeenNthCalledWith(
        2,
        USER,
        'old-2',
      );
      expect(mockTokenService.revokeDeviceSession).toHaveBeenNthCalledWith(
        3,
        USER,
        'old-3',
      );
      expect(mockPrisma.user_devices.updateMany).toHaveBeenCalledWith({
        where: {
          user_id: USER,
          device_id: { in: ['old-1', 'old-2', 'old-3'] },
        },
        data: { active: false },
      });
    });
  });

  describe('isDeviceTrusted', () => {
    it('requires both trusted status and possession of the device secret', async () => {
      mockPrisma.user_devices.findFirst.mockResolvedValue({
        trusted: true,
        fingerprint: hash('correct-secret'),
      });
      expect(await service.isDeviceTrusted(USER, DEVICE)).toBe(false);
      expect(await service.isDeviceTrusted(USER, DEVICE, 'wrong-secret')).toBe(
        false,
      );
      expect(
        await service.isDeviceTrusted(USER, DEVICE, 'correct-secret'),
      ).toBe(true);

      mockPrisma.user_devices.findFirst.mockResolvedValue({
        trusted: false,
        fingerprint: hash('correct-secret'),
      });
      expect(
        await service.isDeviceTrusted(USER, DEVICE, 'correct-secret'),
      ).toBe(false);
    });
  });

  describe('deactivation and ownership guards', () => {
    it('deactivates a device belonging to the user', async () => {
      mockPrisma.user_devices.findFirst.mockResolvedValue({
        device_id: DEVICE,
      });
      await service.deactivateDevice(USER, DEVICE);
      expect(mockPrisma.user_devices.updateMany).toHaveBeenCalledWith({
        where: { user_id: USER, device_id: DEVICE },
        data: { active: false },
      });
    });

    it('refuses to deactivate a device that is not owned by the user', async () => {
      mockPrisma.user_devices.findFirst.mockResolvedValue(null);
      await expect(service.deactivateDevice(USER, DEVICE)).rejects.toThrow(
        NotFoundException,
      );
      expect(mockPrisma.user_devices.updateMany).not.toHaveBeenCalled();
    });

    it('deactivates all devices, or all except the current one', async () => {
      await service.deactivateAllDevices(USER);
      expect(mockPrisma.user_devices.updateMany).toHaveBeenCalledWith({
        where: { user_id: USER },
        data: { active: false },
      });

      await service.deactivateOtherDevices(USER, DEVICE);
      expect(mockPrisma.user_devices.updateMany).toHaveBeenCalledWith({
        where: { user_id: USER, device_id: { not: DEVICE } },
        data: { active: false },
      });
    });

    it('guards trust changes with the same ownership check', async () => {
      mockPrisma.user_devices.findFirst.mockResolvedValue(null);
      await expect(service.trustDevice(USER, DEVICE)).rejects.toThrow(
        NotFoundException,
      );
      mockPrisma.user_devices.findFirst.mockResolvedValue({
        device_id: DEVICE,
      });
      await service.untrustDevice(USER, DEVICE);
      expect(mockPrisma.user_devices.updateMany).toHaveBeenCalledWith({
        where: { user_id: USER, device_id: DEVICE },
        data: { trusted: false },
      });
    });
  });
});
