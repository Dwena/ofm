import { ConfigService } from '@nestjs/config';
import * as webpush from 'web-push';

import { PushNotificationsService } from './push-notifications.service';
import { PrismaService } from '../common/database/prisma.service';
import { MessagingGateway } from '../messaging/messaging.gateway';

jest.mock('web-push', () => ({
  setVapidDetails: jest.fn(),
  sendNotification: jest.fn(),
}));

describe('PushNotificationsService', () => {
  const mockPrismaService = {
    pushSubscription: {
      upsert: jest.fn(),
      deleteMany: jest.fn(),
      findMany: jest.fn(),
      delete: jest.fn(),
    },
    $use: jest.fn(),
  };

  const buildService = (values: Record<string, string> = {}) =>
    new PushNotificationsService(
      mockPrismaService as unknown as PrismaService,
      {
        get: jest.fn((key: string, defaultValue?: any) => values[key] ?? defaultValue),
      } as unknown as ConfigService,
    );

  const vapid = {
    VAPID_PUBLIC_KEY: 'public-key',
    VAPID_PRIVATE_KEY: 'private-key',
    VAPID_SUBJECT: 'mailto:test@ofm.test',
  };

  beforeEach(() => {
    jest.clearAllMocks();
    mockPrismaService.pushSubscription.delete.mockResolvedValue({});
  });

  describe('configuration', () => {
    it('is disabled without VAPID keys', async () => {
      const service = buildService();

      expect(service.isEnabled).toBe(false);
      expect(service.getVapidPublicKey()).toEqual({ publicKey: null, enabled: false });
      await expect(service.sendToUser('user-1', { title: 't', body: 'b' })).resolves.toBe(0);
      expect(mockPrismaService.pushSubscription.findMany).not.toHaveBeenCalled();
    });

    it('configures web-push with VAPID details', () => {
      const service = buildService(vapid);

      expect(webpush.setVapidDetails).toHaveBeenCalledWith('mailto:test@ofm.test', 'public-key', 'private-key');
      expect(service.getVapidPublicKey()).toEqual({ publicKey: 'public-key', enabled: true });
    });
  });

  describe('subscribe / unsubscribe', () => {
    it('upserts the subscription by endpoint for the current user', async () => {
      mockPrismaService.pushSubscription.upsert.mockResolvedValue({ id: 'sub-1' });
      const service = buildService(vapid);

      const result = await service.subscribe(
        'user-1',
        { endpoint: 'https://push.example.com/abc', keys: { p256dh: 'p', auth: 'a' } },
        'Mozilla/5.0',
      );

      expect(mockPrismaService.pushSubscription.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { endpoint: 'https://push.example.com/abc' },
          create: {
            endpoint: 'https://push.example.com/abc',
            userId: 'user-1',
            p256dh: 'p',
            auth: 'a',
            userAgent: 'Mozilla/5.0',
          },
          update: { userId: 'user-1', p256dh: 'p', auth: 'a', userAgent: 'Mozilla/5.0' },
        }),
      );
      expect(result.subscribed).toBe(true);
    });

    it('only removes subscriptions owned by the user', async () => {
      mockPrismaService.pushSubscription.deleteMany.mockResolvedValue({ count: 1 });
      const service = buildService(vapid);

      await expect(service.unsubscribe('user-1', 'https://push.example.com/abc')).resolves.toEqual({
        unsubscribed: true,
      });
      expect(mockPrismaService.pushSubscription.deleteMany).toHaveBeenCalledWith({
        where: { userId: 'user-1', endpoint: 'https://push.example.com/abc' },
      });
    });
  });

  describe('sendToUser', () => {
    it('sends the payload to every device and prunes expired subscriptions', async () => {
      mockPrismaService.pushSubscription.findMany.mockResolvedValue([
        { id: 'sub-1', endpoint: 'https://push.example.com/1', p256dh: 'p1', auth: 'a1' },
        { id: 'sub-2', endpoint: 'https://push.example.com/2', p256dh: 'p2', auth: 'a2' },
      ]);
      (webpush.sendNotification as jest.Mock)
        .mockResolvedValueOnce({ statusCode: 201 })
        .mockRejectedValueOnce(Object.assign(new Error('Gone'), { statusCode: 410 }));
      const service = buildService(vapid);

      const delivered = await service.sendToUser('user-1', { title: 'Hello', body: 'World', url: '/x' });

      expect(delivered).toBe(1);
      expect(webpush.sendNotification).toHaveBeenCalledTimes(2);
      const [subscription, body] = (webpush.sendNotification as jest.Mock).mock.calls[0];
      expect(subscription).toEqual({
        endpoint: 'https://push.example.com/1',
        keys: { p256dh: 'p1', auth: 'a1' },
      });
      expect(JSON.parse(body)).toEqual(expect.objectContaining({ title: 'Hello', body: 'World', url: '/x' }));
      expect(mockPrismaService.pushSubscription.delete).toHaveBeenCalledWith({ where: { id: 'sub-2' } });
    });

    it('keeps subscriptions on transient errors', async () => {
      mockPrismaService.pushSubscription.findMany.mockResolvedValue([
        { id: 'sub-1', endpoint: 'https://push.example.com/1', p256dh: 'p1', auth: 'a1' },
      ]);
      (webpush.sendNotification as jest.Mock).mockRejectedValueOnce(
        Object.assign(new Error('Server error'), { statusCode: 500 }),
      );
      const service = buildService(vapid);

      await expect(service.sendToUser('user-1', { title: 't', body: 'b' })).resolves.toBe(0);
      expect(mockPrismaService.pushSubscription.delete).not.toHaveBeenCalled();
    });
  });

  describe('notification creation hook', () => {
    it('pushes every created Notification row', async () => {
      const service = buildService(vapid);
      const spy = jest.spyOn(service, 'sendForNotification').mockResolvedValue(undefined);

      service.onModuleInit();
      expect(mockPrismaService.$use).toHaveBeenCalledTimes(1);
      const middleware = mockPrismaService.$use.mock.calls[0][0];

      const notification = { id: 'n-1', userId: 'user-1', title: 'T', message: 'M', linkUrl: null, type: 'SYSTEM' };
      const result = await middleware(
        { model: 'Notification', action: 'create', args: {} },
        jest.fn().mockResolvedValue(notification),
      );

      expect(result).toBe(notification);
      expect(spy).toHaveBeenCalledWith(notification);
    });

    it('ignores other models and actions', async () => {
      const service = buildService(vapid);
      const spy = jest.spyOn(service, 'sendForNotification').mockResolvedValue(undefined);
      service.onModuleInit();
      const middleware = mockPrismaService.$use.mock.calls[0][0];

      await middleware({ model: 'User', action: 'create', args: {} }, jest.fn().mockResolvedValue({ userId: 'x' }));
      await middleware({ model: 'Notification', action: 'update', args: {} }, jest.fn().mockResolvedValue({ userId: 'x' }));

      expect(spy).not.toHaveBeenCalled();
    });

    it('emits notification:new to the recipient over the socket gateway', async () => {
      const gateway = { sendNotificationToUser: jest.fn() };
      const service = new PushNotificationsService(
        mockPrismaService as unknown as PrismaService,
        { get: jest.fn((_key: string, defaultValue?: any) => defaultValue) } as unknown as ConfigService,
        gateway as unknown as MessagingGateway,
      );
      service.onModuleInit();
      const middleware = mockPrismaService.$use.mock.calls[0][0];

      const notification = { id: 'n-2', userId: 'creator-1', title: 'T', message: 'M', type: 'NEW_TIP' };
      await middleware({ model: 'Notification', action: 'create', args: {} }, jest.fn().mockResolvedValue(notification));
      await middleware({ model: 'User', action: 'create', args: {} }, jest.fn().mockResolvedValue({ userId: 'x' }));

      expect(gateway.sendNotificationToUser).toHaveBeenCalledTimes(1);
      expect(gateway.sendNotificationToUser).toHaveBeenCalledWith('creator-1', notification);
    });

    it('does not fail the create when the socket emit throws', async () => {
      const gateway = {
        sendNotificationToUser: jest.fn(() => {
          throw new Error('socket down');
        }),
      };
      const service = new PushNotificationsService(
        mockPrismaService as unknown as PrismaService,
        { get: jest.fn((_key: string, defaultValue?: any) => defaultValue) } as unknown as ConfigService,
        gateway as unknown as MessagingGateway,
      );
      service.onModuleInit();
      const middleware = mockPrismaService.$use.mock.calls[0][0];

      const notification = { id: 'n-3', userId: 'u-1', title: 'T', message: 'M', type: 'SYSTEM' };
      await expect(
        middleware({ model: 'Notification', action: 'create', args: {} }, jest.fn().mockResolvedValue(notification)),
      ).resolves.toBe(notification);
    });

    it('normalizes the data (enum type, metadata.kind) before the create', async () => {
      const service = buildService();
      service.onModuleInit();
      const middleware = mockPrismaService.$use.mock.calls[0][0];

      const params = {
        model: 'Notification',
        action: 'create',
        args: { data: { userId: 'u-1', type: 'PAYMENT_SUCCESS', title: 'T', message: 'M' } },
      };
      const next = jest.fn().mockResolvedValue(null);
      await middleware(params, next);

      expect(next).toHaveBeenCalledWith(
        expect.objectContaining({
          args: { data: { userId: 'u-1', type: 'SYSTEM', title: 'T', message: 'M', metadata: { kind: 'PAYMENT_SUCCESS' } } },
        }),
      );
    });

    it('maps a notification to a push payload', async () => {
      const service = buildService(vapid);
      const spy = jest.spyOn(service, 'sendToUser').mockResolvedValue(1);

      await service.sendForNotification({
        id: 'n-1',
        userId: 'user-1',
        title: 'Nouvel abonné',
        message: 'Bob vous suit',
        linkUrl: null,
        type: 'NEW_SUBSCRIBER',
      });

      expect(spy).toHaveBeenCalledWith('user-1', {
        title: 'Nouvel abonné',
        body: 'Bob vous suit',
        url: '/notifications',
        tag: 'n-1',
        data: { notificationId: 'n-1', type: 'NEW_SUBSCRIBER' },
      });
    });
  });
});
