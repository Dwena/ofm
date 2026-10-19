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
      delete: jest.fn(),
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
});
