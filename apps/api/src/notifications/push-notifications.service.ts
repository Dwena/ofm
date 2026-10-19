import { Injectable, Logger, OnModuleInit, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Notification, Prisma } from '@prisma/client';
import * as webpush from 'web-push';

import { PrismaService } from '../common/database/prisma.service';
import { MessagingGateway } from '../messaging/messaging.gateway';
import { CreatePushSubscriptionDto } from './dto/push-subscription.dto';
import { normalizeNotificationData } from './notification-kind';
import { getNotificationCategory, isNotificationChannelEnabled } from './notification-preferences';

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
    @Optional() private messagingGateway?: MessagingGateway,
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
   * Single hook for every Notification row created anywhere in the app
   * (NotificationsService.create or direct prisma.notification.create calls):
   * - the data is normalized (valid enum type, `metadata.kind` marker);
   * - the recipient's preferences are applied: a category muted "in app" is
   *   stored as already read and not pushed on the socket, a category muted for
   *   "push" is not delivered as a web push;
   * - the created row is pushed in realtime (`notification:new` on the socket)
   *   and delivered as a web push.
   */
  onModuleInit() {
    const prisma = this.prisma as any;
    if (typeof prisma.$use !== 'function') {
      return;
    }
    prisma.$use(async (params: Prisma.MiddlewareParams, next: (p: Prisma.MiddlewareParams) => Promise<any>) => {
      const isNotificationCreate = params.model === 'Notification' && params.action === 'create';
      let channels = { inApp: true, push: true };
      if (isNotificationCreate && params.args?.data) {
        const data = normalizeNotificationData(params.args.data);
        channels = await this.getChannels(data);
        if (!channels.inApp && data.isRead === undefined) {
          data.isRead = true;
          data.readAt = new Date();
        }
      }
      const result = await next(params);
      if (isNotificationCreate && result?.userId) {
        if (channels.inApp) {
          this.emitRealtime(result as Notification);
        }
        if (channels.push) {
          void this.sendForNotification(result as Notification);
        }
      }
      return result;
    });
  }

  /** Channels enabled by the recipient for this notification (all on when unknown) */
  async getChannels(data: Record<string, any>): Promise<{ inApp: boolean; push: boolean }> {
    const enabled = { inApp: true, push: true };
    if (typeof data?.userId !== 'string' || !getNotificationCategory(data.type, data.metadata)) {
      return enabled;
    }
    try {
      const user = await this.prisma.user.findUnique({
        where: { id: data.userId },
        select: { notificationPreferences: true },
      });
      const preferences = user?.notificationPreferences;
      return {
        inApp: isNotificationChannelEnabled(preferences, data.type, data.metadata, 'inApp'),
        push: isNotificationChannelEnabled(preferences, data.type, data.metadata, 'push'),
      };
    } catch (error: any) {
      this.logger.warn(`Failed to load notification preferences of ${data.userId}: ${error?.message ?? error}`);
      return enabled;
    }
  }

  /** Push the notification to the recipient's socket room (no-op when offline) */
  emitRealtime(notification: Notification) {
    if (!this.messagingGateway) {
      return;
    }
    try {
      this.messagingGateway.sendNotificationToUser(notification.userId, notification);
    } catch (error: any) {
      this.logger.warn(`Failed to emit realtime notification ${notification.id}: ${error?.message ?? error}`);
    }
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
