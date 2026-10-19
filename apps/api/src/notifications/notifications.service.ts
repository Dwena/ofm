import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../common/database/prisma.service';
import {
  NotificationCategory,
  categoryWhere,
  mergeNotificationPreferences,
  resolveNotificationPreferences,
} from './notification-preferences';

const DEFAULT_PAGE_SIZE = 20;
const MAX_PAGE_SIZE = 50;

export interface GetNotificationsOptions {
  unreadOnly?: boolean;
  category?: NotificationCategory;
  page?: number;
  limit?: number;
}

@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);

  constructor(private prisma: PrismaService) {}

  async getUserNotifications(userId: string, options: GetNotificationsOptions = {}) {
    const page = Math.max(1, Math.floor(options.page ?? 1));
    const limit = Math.min(MAX_PAGE_SIZE, Math.max(1, Math.floor(options.limit ?? DEFAULT_PAGE_SIZE)));
    const where: Prisma.NotificationWhereInput = {
      userId,
      ...(options.unreadOnly && { isRead: false }),
      ...(options.category && categoryWhere(options.category)),
    };

    const [items, total, unreadCount] = await Promise.all([
      this.prisma.notification.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.notification.count({ where }),
      this.prisma.notification.count({ where: { userId, isRead: false } }),
    ]);

    return {
      items,
      total,
      unreadCount,
      page,
      limit,
      hasMore: page * limit < total,
    };
  }

  async markAsRead(userId: string, notificationId: string) {
    const { count } = await this.prisma.notification.updateMany({
      where: { id: notificationId, userId },
      data: { isRead: true, readAt: new Date() },
    });

    if (count === 0) {
      throw new NotFoundException('Notification not found');
    }

    return { id: notificationId, isRead: true };
  }

  async markAllAsRead(userId: string) {
    return this.prisma.notification.updateMany({
      where: {
        userId,
        isRead: false,
      },
      data: {
        isRead: true,
        readAt: new Date(),
      },
    });
  }

  async deleteNotification(userId: string, notificationId: string) {
    const notification = await this.prisma.notification.findFirst({
      where: {
        id: notificationId,
        userId,
      },
    });

    if (!notification) {
      throw new NotFoundException('Notification not found');
    }

    await this.prisma.notification.delete({
      where: { id: notificationId },
    });

    return { message: 'Notification deleted' };
  }

  async getPreferences(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { notificationPreferences: true },
    });
    if (!user) {
      throw new NotFoundException('User not found');
    }
    return resolveNotificationPreferences(user.notificationPreferences);
  }

  async updatePreferences(userId: string, update: Record<string, any>) {
    const current = await this.getPreferences(userId);
    const preferences = mergeNotificationPreferences(current, update);
    await this.prisma.user.update({
      where: { id: userId },
      data: { notificationPreferences: preferences as unknown as Prisma.InputJsonValue },
    });
    return preferences;
  }

  async create(data: {
    userId: string;
    type: string;
    title: string;
    message: string;
    linkUrl?: string;
    metadata?: any;
  }) {
    return this.prisma.notification.create({
      data: {
        userId: data.userId,
        type: data.type as any,
        title: data.title,
        message: data.message,
        linkUrl: data.linkUrl,
        metadata: data.metadata,
      },
    });
  }
}
