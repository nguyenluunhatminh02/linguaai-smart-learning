import { Test, TestingModule } from '@nestjs/testing';
import { NotificationsService } from './notifications.service';
import { PrismaService } from '../prisma/prisma.service';
import { NotFoundException } from '@nestjs/common';
import {
  notifications_type_enum,
  notifications_channel_enum,
} from '../generated/prisma';

describe('NotificationsService', () => {
  let service: NotificationsService;

  const mockPrismaService = {
    notifications: {
      create: jest.fn(),
      findMany: jest.fn(),
      count: jest.fn(),
      findFirst: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
      delete: jest.fn(),
    },
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        NotificationsService,
        { provide: PrismaService, useValue: mockPrismaService },
      ],
    }).compile();

    service = module.get<NotificationsService>(NotificationsService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('create', () => {
    it('should call prisma.notifications.create with correct data', async () => {
      const mockResult = {
        id: 'uuid-1',
        user_id: 'user-1',
        title: 'Test title',
      };
      mockPrismaService.notifications.create.mockResolvedValueOnce(mockResult);

      const result = await service.create(
        'user-1',
        notifications_type_enum.SYSTEM,
        notifications_channel_enum.IN_APP,
        'Test title',
        'Test message',
        '{"test": true}',
      );

      expect(result).toEqual(mockResult);
      expect(mockPrismaService.notifications.create).toHaveBeenCalledWith({
        data: {
          user_id: 'user-1',
          type: notifications_type_enum.SYSTEM,
          channel: notifications_channel_enum.IN_APP,
          title: 'Test title',
          message: 'Test message',
          data: '{"test": true}',
          is_read: false,
        },
      });
    });
  });

  describe('findAll', () => {
    it('should return paginated list of notifications', async () => {
      const mockItems = [
        { id: 'uuid-1', user_id: 'user-1', title: 'N1' },
        { id: 'uuid-2', user_id: 'user-1', title: 'N2' },
      ];
      mockPrismaService.notifications.findMany.mockResolvedValueOnce(mockItems);
      mockPrismaService.notifications.count.mockResolvedValueOnce(10);

      const result = await service.findAll('user-1', 1, 2);

      expect(result).toEqual({
        items: mockItems,
        total: 10,
        page: 1,
        limit: 2,
        pages: 5,
      });
      expect(mockPrismaService.notifications.findMany).toHaveBeenCalledWith({
        where: { user_id: 'user-1' },
        orderBy: { created_at: 'desc' },
        skip: 0,
        take: 2,
      });
    });
  });

  describe('getUnreadCount', () => {
    it('should return count of unread notifications', async () => {
      mockPrismaService.notifications.count.mockResolvedValueOnce(5);

      const result = await service.getUnreadCount('user-1');

      expect(result).toBe(5);
      expect(mockPrismaService.notifications.count).toHaveBeenCalledWith({
        where: {
          user_id: 'user-1',
          is_read: false,
        },
      });
    });
  });

  describe('markAsRead', () => {
    it('should mark notification as read and set read_at date', async () => {
      const mockNotif = { id: 'uuid-1', user_id: 'user-1', is_read: false };
      mockPrismaService.notifications.findFirst.mockResolvedValueOnce(
        mockNotif,
      );
      mockPrismaService.notifications.update.mockResolvedValueOnce({
        ...mockNotif,
        is_read: true,
      });

      const result = await service.markAsRead('uuid-1', 'user-1');

      expect(result.is_read).toBe(true);
      expect(mockPrismaService.notifications.findFirst).toHaveBeenCalledWith({
        where: { id: 'uuid-1', user_id: 'user-1' },
      });
      expect(mockPrismaService.notifications.update).toHaveBeenCalledWith({
        where: { id: 'uuid-1' },
        data: {
          is_read: true,
          read_at: expect.any(Date),
        },
      });
    });

    it('should throw NotFoundException if notification is not found', async () => {
      mockPrismaService.notifications.findFirst.mockResolvedValueOnce(null);

      await expect(service.markAsRead('uuid-1', 'user-1')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('markAllAsRead', () => {
    it('should call prisma.notifications.updateMany to mark all as read', async () => {
      mockPrismaService.notifications.updateMany.mockResolvedValueOnce({
        count: 3,
      });

      await service.markAllAsRead('user-1');

      expect(mockPrismaService.notifications.updateMany).toHaveBeenCalledWith({
        where: {
          user_id: 'user-1',
          is_read: false,
        },
        data: {
          is_read: true,
          read_at: expect.any(Date),
        },
      });
    });
  });

  describe('delete', () => {
    it('should delete notification if it exists', async () => {
      const mockNotif = { id: 'uuid-1', user_id: 'user-1' };
      mockPrismaService.notifications.findFirst.mockResolvedValueOnce(
        mockNotif,
      );
      mockPrismaService.notifications.delete.mockResolvedValueOnce(mockNotif);

      await service.delete('uuid-1', 'user-1');

      expect(mockPrismaService.notifications.findFirst).toHaveBeenCalledWith({
        where: { id: 'uuid-1', user_id: 'user-1' },
      });
      expect(mockPrismaService.notifications.delete).toHaveBeenCalledWith({
        where: { id: 'uuid-1' },
      });
    });

    it('should throw NotFoundException if notification to delete is not found', async () => {
      mockPrismaService.notifications.findFirst.mockResolvedValueOnce(null);

      await expect(service.delete('uuid-1', 'user-1')).rejects.toThrow(
        NotFoundException,
      );
    });
  });
});
