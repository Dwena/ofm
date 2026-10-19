import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Notification, Prisma } from '@prisma/client';
import * as webpush from 'web-push';

import { PrismaService } from '../common/database/prisma.service';
import { CreatePushSubscriptionDto } from './dto/push-subscription.dto';

export interface PushPayload {
  title: string;
  body: string;
  url?: string;
  tag?: string;
  icon?: string;
  badge?: string;
  data?: Record<string, unknown>;
}

@Injectable()
export class PushNotificationsService implements OnModuleInit {
  private readonly logger = new Logger(PushNotificationsService.name);
  private readonly publicKey: string | null;
  private readonly enabled: boolean;

  constructor(
    private prisma: PrismaService,
    private configService: ConfigService,
  ) {
    const publicKey = this.configService.get<string>('VAPID_PUBLIC_KEY');
    const privateKey = this.configService.get<string>('VAPID_PRIVATE_KEY');
    const subject = this.configService.get<string>('VAPID_SUBJECT', 'mailto:admin@ofm.com');

    this.publicKey = publicKey || null;
    this.enabled = false;

    if (publicKey && privateKey) {
      try {
        webpush.setVapidDetails(subject, publicKey, privateKey);
        this.enabled = true;
      } catch (error: any) {
        this.logger.error(`Invalid VAPID configuration: ${error?.message ?? error}`);
      }
    } else {
      this.logger.warn('VAPID keys not configured: web push notifications are disabled');
    }
  }

  /**
   * Every Notification row created anywhere in the app (NotificationsService.create
   * or direct prisma.notification.create calls) is also delivered as a web push.
   */
  onModuleInit() {
    const prisma = this.prisma as any;
    if (typeof prisma.$use !== 'function') {
      return;
    }
    prisma.$use(async (params: Prisma.MiddlewareParams, next: (p: Prisma.MiddlewareParams) => Promise<any>) => {
      const result = await next(params);
      if (params.model === 'Notification' && params.action === 'create' && result?.userId) {
        void this.sendForNotification(result as Notification);
      }
      return result;
    });
  }

  get isEnabled(): boolean {
    return this.enabled;
  }

  getVapidPublicKey() {
    return { publicKey: this.publicKey, enabled: this.enabled };
  }

  async subscribe(userId: string, dto: CreatePushSubscriptionDto, userAgent?: string) {
    const data = {
      userId,
      p256dh: dto.keys.p256dh,
      auth: dto.keys.auth,
      userAgent: userAgent?.slice(0, 512) ?? null,
    };

    const subscription = await this.prisma.pushSubscription.upsert({
      where: { endpoint: dto.endpoint },
      create: { endpoint: dto.endpoint, ...data },
      update: data,
      select: { id: true, endpoint: true, createdAt: true },
    });

    return { subscribed: true, subscription };
  }

  async unsubscribe(userId: string, endpoint: string) {
    const { count } = await this.prisma.pushSubscription.deleteMany({
      where: { userId, endpoint },
    });
    return { unsubscribed: count > 0 };
  }

  async sendForNotification(notification: Pick<Notification, 'id' | 'userId' | 'title' | 'message' | 'linkUrl' | 'type'>) {
    try {
      await this.sendToUser(notification.userId, {
        title: notification.title,
        body: notification.message,
        url: notification.linkUrl || '/notifications',
        tag: notification.id,
        data: { notificationId: notification.id, type: notification.type },
      });
    } catch (error: any) {
      this.logger.error(`Failed to deliver push for notification ${notification.id}: ${error?.message ?? error}`);
    }
  }

  /**
   * Send a payload to every registered device of a user.
   * Expired subscriptions (404/410) are removed. Returns the number of successful deliveries.
   */
  async sendToUser(userId: string, payload: PushPayload): Promise<number> {
    if (!this.enabled) {
      return 0;
    }

    const subscriptions = await this.prisma.pushSubscription.findMany({
      where: { userId },
    });
    if (subscriptions.length === 0) {
      return 0;
    }

    const body = JSON.stringify({
      icon: '/icon-192x192.png',
      badge: '/icon-72x72.png',
      ...payload,
    });

    const results = await Promise.all(
      subscriptions.map(async (sub) => {
        try {
          await webpush.sendNotification(
            { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
            body,
            { TTL: 24 * 60 * 60 },
          );
          return true;
        } catch (error: any) {
          if (error?.statusCode === 404 || error?.statusCode === 410) {
            await this.prisma.pushSubscription
              .delete({ where: { id: sub.id } })
              .catch(() => undefined);
          } else {
            this.logger.warn(`Web push to ${sub.id} failed: ${error?.statusCode ?? ''} ${error?.message ?? error}`);
          }
          return false;
        }
      }),
    );

    return results.filter(Boolean).length;
  }
}
