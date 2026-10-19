import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import { NotificationsService } from './notifications.service';
import { PrismaService } from '../common/database/prisma.service';

describe('NotificationsService', () => {
  let service: NotificationsService;

  const mockPrismaService = {
    notification: {
      findFirst: jest.fn(),
      findMany: jest.fn(),
      count: jest.fn(),
      updateMany: jest.fn(),
      delete: jest.fn(),
    },
    user: {
      findUnique: jest.fn(),
      update: jest.fn(),
    },
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        NotificationsService,
        {
          provide: PrismaService,
          useValue: mockPrismaService,
        },
      ],
    }).compile();

    service = module.get<NotificationsService>(NotificationsService);

    jest.clearAllMocks();
  });

  describe('deleteNotification', () => {
    const userId = 'user-123';
    const notificationId = 'notif-456';

    it('should delete a notification owned by the user', async () => {
      mockPrismaService.notification.findFirst.mockResolvedValue({ id: notificationId, userId });

      const result = await service.deleteNotification(userId, notificationId);

      expect(mockPrismaService.notification.findFirst).toHaveBeenCalledWith({
        where: { id: notificationId, userId },
      });
      expect(mockPrismaService.notification.delete).toHaveBeenCalledWith({
        where: { id: notificationId },
      });
      expect(result).toEqual({ message: 'Notification deleted' });
    });

    it('should throw NotFoundException for a missing or foreign notification', async () => {
      mockPrismaService.notification.findFirst.mockResolvedValue(null);

      await expect(service.deleteNotification(userId, notificationId)).rejects.toThrow(
        NotFoundException,
      );
      expect(mockPrismaService.notification.delete).not.toHaveBeenCalled();
    });
  });

  describe('getUserNotifications', () => {
    it('returns a page with totals and the global unread count', async () => {
      mockPrismaService.notification.findMany.mockResolvedValue([{ id: 'n-1' }]);
      mockPrismaService.notification.count.mockResolvedValueOnce(45).mockResolvedValueOnce(7);

      const result = await service.getUserNotifications('user-1', { page: 2, limit: 20 });

      expect(mockPrismaService.notification.findMany).toHaveBeenCalledWith({
        where: { userId: 'user-1' },
        orderBy: { createdAt: 'desc' },
        skip: 20,
        take: 20,
      });
      expect(mockPrismaService.notification.count).toHaveBeenLastCalledWith({
        where: { userId: 'user-1', isRead: false },
      });
      expect(result).toEqual({ items: [{ id: 'n-1' }], total: 45, unreadCount: 7, page: 2, limit: 20, hasMore: true });
    });

    it('filters unread notifications of a category and caps the page size', async () => {
      mockPrismaService.notification.findMany.mockResolvedValue([]);
      mockPrismaService.notification.count.mockResolvedValue(0);

      const result = await service.getUserNotifications('user-1', {
        unreadOnly: true,
        category: 'comments',
        limit: 500,
      });

      expect(mockPrismaService.notification.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { userId: 'user-1', isRead: false, type: 'NEW_COMMENT' },
          take: 50,
          skip: 0,
        }),
      );
      expect(result.hasMore).toBe(false);
    });
  });

  describe('markAsRead', () => {
    it('marks a notification of the user as read', async () => {
      mockPrismaService.notification.updateMany.mockResolvedValue({ count: 1 });

      await expect(service.markAsRead('user-1', 'n-1')).resolves.toEqual({ id: 'n-1', isRead: true });
      expect(mockPrismaService.notification.updateMany).toHaveBeenCalledWith({
        where: { id: 'n-1', userId: 'user-1' },
        data: { isRead: true, readAt: expect.any(Date) },
      });
    });

    it('throws NotFoundException for a foreign notification', async () => {
      mockPrismaService.notification.updateMany.mockResolvedValue({ count: 0 });

      await expect(service.markAsRead('user-1', 'n-1')).rejects.toThrow(NotFoundException);
    });
  });

  describe('preferences', () => {
    it('returns the stored preferences merged over the defaults', async () => {
      mockPrismaService.user.findUnique.mockResolvedValue({
        notificationPreferences: { comments: { push: false } },
      });

      const prefs = await service.getPreferences('user-1');

      expect(prefs.comments).toEqual({ inApp: true, push: false });
      expect(prefs.messages).toEqual({ inApp: true, push: true });
    });

    it('stores a partial update', async () => {
      mockPrismaService.user.findUnique.mockResolvedValue({ notificationPreferences: null });

      const prefs = await service.updatePreferences('user-1', { followers: { inApp: false } });

      expect(prefs.followers).toEqual({ inApp: false, push: true });
      expect(mockPrismaService.user.update).toHaveBeenCalledWith({
        where: { id: 'user-1' },
        data: { notificationPreferences: prefs },
      });
    });

    it('throws NotFoundException for an unknown user', async () => {
      mockPrismaService.user.findUnique.mockResolvedValue(null);

      await expect(service.getPreferences('ghost')).rejects.toThrow(NotFoundException);
    });
  });
});
