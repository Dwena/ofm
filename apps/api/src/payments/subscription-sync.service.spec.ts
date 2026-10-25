import { Test, TestingModule } from '@nestjs/testing';
import { Logger } from '@nestjs/common';
import { addInterval, SubscriptionSyncService } from './subscription-sync.service';
import { PrismaService } from '../common/database/prisma.service';

describe('addInterval', () => {
  it('adds one month or one year', () => {
    const start = new Date('2026-01-15T10:00:00Z');
    expect(addInterval(start, 'month')).toEqual(new Date('2026-02-15T10:00:00Z'));
    expect(addInterval(start, 'year')).toEqual(new Date('2027-01-15T10:00:00Z'));
    // Unknown interval: monthly
    expect(addInterval(start, 'week')).toEqual(new Date('2026-02-15T10:00:00Z'));
    // The start date is not modified
    expect(start).toEqual(new Date('2026-01-15T10:00:00Z'));
  });
});

describe('SubscriptionSyncService', () => {
  let service: SubscriptionSyncService;

  const mockPrismaService = {
    subscription: {
      findUnique: jest.fn(),
      findFirst: jest.fn(),
      findMany: jest.fn(),
      upsert: jest.fn(),
      delete: jest.fn(),
    },
    subscriptionTier: { findUnique: jest.fn() },
    creatorProfile: { updateMany: jest.fn(), findUnique: jest.fn() },
    message: { findFirst: jest.fn(), create: jest.fn() },
    conversation: { findFirst: jest.fn(), create: jest.fn(), update: jest.fn() },
    user: { findUnique: jest.fn() },
    notification: { create: jest.fn() },
  };

  const freeTier = { id: 'tier-free', creatorId: 'creator-1', name: 'Fan', price: 0, interval: 'month', isActive: true };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [SubscriptionSyncService, { provide: PrismaService, useValue: mockPrismaService }],
    }).compile();

    service = module.get<SubscriptionSyncService>(SubscriptionSyncService);

    jest.resetAllMocks();
    jest.spyOn(Logger.prototype, 'log').mockImplementation();
    jest.spyOn(Logger.prototype, 'warn').mockImplementation();
    mockPrismaService.subscription.findMany.mockResolvedValue([]);
    mockPrismaService.creatorProfile.findUnique.mockResolvedValue({ welcomeMessage: null });
  });

  describe('activateFreeSubscription', () => {
    it('activates (or reactivates) the free tier for one period, without card nor scheduled change', async () => {
      mockPrismaService.subscription.upsert.mockResolvedValue({ id: 'sub-free' });
      mockPrismaService.subscription.findMany.mockResolvedValue([{ subscriberId: 'fan-1' }, { subscriberId: 'fan-2' }]);
      mockPrismaService.user.findUnique.mockResolvedValue({ username: 'bob', displayName: null });

      const subscription = await service.activateFreeSubscription('fan-1', freeTier);

      expect(subscription).toEqual({ id: 'sub-free' });
      const { where, create, update } = mockPrismaService.subscription.upsert.mock.calls[0][0];
      expect(where).toEqual({ subscriberId_tierId: { subscriberId: 'fan-1', tierId: 'tier-free' } });
      expect(create).toEqual(expect.objectContaining({ subscriberId: 'fan-1', tierId: 'tier-free', status: 'ACTIVE' }));
      expect(update).toEqual(
        expect.objectContaining({
          status: 'ACTIVE',
          paymentCardId: null,
          renewalAttempts: 0,
          nextRenewalAttemptAt: null,
          pendingTierId: null,
          cancelAtPeriodEnd: false,
          cancelledAt: null,
        }),
      );
      expect(update.currentPeriodEnd).toEqual(addInterval(update.currentPeriodStart, 'month'));

      // Subscriber counter and creator notification
      expect(mockPrismaService.creatorProfile.updateMany).toHaveBeenCalledWith({
        where: { userId: 'creator-1' },
        data: { totalSubscribers: 2 },
      });
      expect(mockPrismaService.notification.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          userId: 'creator-1',
          type: 'NEW_SUBSCRIBER',
          message: "bob s'est abonné à votre offre Fan",
          metadata: { subscriberId: 'fan-1' },
        }),
      });
    });
  });

  describe('releaseTierSlot', () => {
    it('is free when no row holds the tier, or the moving row holds it', async () => {
      mockPrismaService.subscription.findUnique.mockResolvedValueOnce(null).mockResolvedValueOnce({ id: 'sub-1', status: 'ACTIVE' });

      await expect(service.releaseTierSlot('fan-1', 'tier-2', 'sub-1')).resolves.toBe(true);
      await expect(service.releaseTierSlot('fan-1', 'tier-2', 'sub-1')).resolves.toBe(true);
      expect(mockPrismaService.subscription.delete).not.toHaveBeenCalled();
    });

    it('removes an ended row holding the target tier', async () => {
      mockPrismaService.subscription.findUnique.mockResolvedValue({ id: 'sub-old', status: 'CANCELLED' });

      await expect(service.releaseTierSlot('fan-1', 'tier-2', 'sub-1')).resolves.toBe(true);
      expect(mockPrismaService.subscription.findUnique).toHaveBeenCalledWith({
        where: { subscriberId_tierId: { subscriberId: 'fan-1', tierId: 'tier-2' } },
      });
      expect(mockPrismaService.subscription.delete).toHaveBeenCalledWith({ where: { id: 'sub-old' } });
    });

    it('never removes a live subscription', async () => {
      for (const status of ['ACTIVE', 'PAST_DUE']) {
        mockPrismaService.subscription.findUnique.mockResolvedValue({ id: 'sub-other', status });
        await expect(service.releaseTierSlot('fan-1', 'tier-2', 'sub-1')).resolves.toBe(false);
      }
      expect(mockPrismaService.subscription.delete).not.toHaveBeenCalled();
    });

    it('works inside the transaction of the caller', async () => {
      const tx = { subscription: { findUnique: jest.fn(async () => ({ id: 'sub-old', status: 'EXPIRED' })), delete: jest.fn() } };

      await service.releaseTierSlot('fan-1', 'tier-2', 'sub-1', tx as any);

      expect(tx.subscription.delete).toHaveBeenCalledWith({ where: { id: 'sub-old' } });
      expect(mockPrismaService.subscription.findUnique).not.toHaveBeenCalled();
    });
  });

  describe('activatePendingFreeTier', () => {
    it('activates the free tier a paid subscription was downgraded to', async () => {
      mockPrismaService.subscriptionTier.findUnique.mockResolvedValue(freeTier);
      mockPrismaService.subscription.findFirst.mockResolvedValue(null);
      mockPrismaService.subscription.upsert.mockResolvedValue({ id: 'sub-free' });

      await service.activatePendingFreeTier('fan-1', 'tier-free');

      expect(mockPrismaService.subscription.findFirst).toHaveBeenCalledWith({
        where: { subscriberId: 'fan-1', tier: { creatorId: 'creator-1' }, status: { in: ['ACTIVE', 'PAST_DUE'] } },
      });
      expect(mockPrismaService.subscription.upsert).toHaveBeenCalledWith(
        expect.objectContaining({ where: { subscriberId_tierId: { subscriberId: 'fan-1', tierId: 'tier-free' } } }),
      );
    });

    it('does nothing when the fan subscribed to something else meanwhile', async () => {
      mockPrismaService.subscriptionTier.findUnique.mockResolvedValue(freeTier);
      mockPrismaService.subscription.findFirst.mockResolvedValue({ id: 'sub-paid', status: 'ACTIVE' });

      await service.activatePendingFreeTier('fan-1', 'tier-free');

      expect(mockPrismaService.subscription.upsert).not.toHaveBeenCalled();
    });

    it('does nothing for a deactivated, paid or deleted tier', async () => {
      for (const tier of [{ ...freeTier, isActive: false }, { ...freeTier, price: 4.99 }, null]) {
        mockPrismaService.subscriptionTier.findUnique.mockResolvedValue(tier);
        await service.activatePendingFreeTier('fan-1', 'tier-free');
      }

      expect(mockPrismaService.subscription.upsert).not.toHaveBeenCalled();
    });
  });

  it('counts each active subscriber of the creator once', async () => {
    mockPrismaService.subscription.findMany.mockResolvedValue([{ subscriberId: 'fan-1' }]);

    await service.refreshCreatorSubscriberCount('creator-1');

    expect(mockPrismaService.subscription.findMany).toHaveBeenCalledWith({
      where: { tier: { creatorId: 'creator-1' }, status: 'ACTIVE' },
      distinct: ['subscriberId'],
      select: { subscriberId: true },
    });
    expect(mockPrismaService.creatorProfile.updateMany).toHaveBeenCalledWith({
      where: { userId: 'creator-1' },
      data: { totalSubscribers: 1 },
    });
  });

  describe('sendWelcomeMessage', () => {
    it('sends the creator welcome message and opens the conversation', async () => {
      mockPrismaService.creatorProfile.findUnique.mockResolvedValue({ welcomeMessage: ' Bienvenue ! ' });
      mockPrismaService.message.findFirst.mockResolvedValue(null);
      mockPrismaService.message.create.mockResolvedValue({ id: 'msg-1' });
      mockPrismaService.conversation.findFirst.mockResolvedValue(null);

      await service.sendWelcomeMessage('creator-1', 'fan-1');

      expect(mockPrismaService.message.create).toHaveBeenCalledWith({
        data: { senderId: 'creator-1', receiverId: 'fan-1', content: 'Bienvenue !', status: 'SENT' },
      });
      expect(mockPrismaService.conversation.create).toHaveBeenCalledWith({
        data: { participant1Id: 'creator-1', participant2Id: 'fan-1', lastMessageId: 'msg-1' },
      });
    });

    it('updates an existing conversation', async () => {
      mockPrismaService.creatorProfile.findUnique.mockResolvedValue({ welcomeMessage: 'Bienvenue !' });
      mockPrismaService.message.findFirst.mockResolvedValue(null);
      mockPrismaService.message.create.mockResolvedValue({ id: 'msg-2' });
      mockPrismaService.conversation.findFirst.mockResolvedValue({ id: 'conv-1' });

      await service.sendWelcomeMessage('creator-1', 'fan-1');

      expect(mockPrismaService.conversation.update).toHaveBeenCalledWith({
        where: { id: 'conv-1' },
        data: expect.objectContaining({ lastMessageId: 'msg-2' }),
      });
      expect(mockPrismaService.conversation.create).not.toHaveBeenCalled();
    });

    it('does nothing without a welcome message', async () => {
      mockPrismaService.creatorProfile.findUnique.mockResolvedValue({ welcomeMessage: '   ' });

      await service.sendWelcomeMessage('creator-1', 'fan-1');

      expect(mockPrismaService.message.create).not.toHaveBeenCalled();
    });

    it('does not send the same welcome message twice', async () => {
      mockPrismaService.creatorProfile.findUnique.mockResolvedValue({ welcomeMessage: 'Bienvenue !' });
      mockPrismaService.message.findFirst.mockResolvedValue({ id: 'msg-old' });

      await service.sendWelcomeMessage('creator-1', 'fan-1');

      expect(mockPrismaService.message.create).not.toHaveBeenCalled();
    });

    it('is sent when a free subscription is activated', async () => {
      mockPrismaService.subscription.upsert.mockResolvedValue({ id: 'sub-free' });
      mockPrismaService.creatorProfile.findUnique.mockResolvedValue({ welcomeMessage: 'Bienvenue !' });
      mockPrismaService.message.findFirst.mockResolvedValue(null);
      mockPrismaService.message.create.mockResolvedValue({ id: 'msg-3' });
      mockPrismaService.conversation.findFirst.mockResolvedValue(null);

      await service.activateFreeSubscription('fan-1', freeTier);

      expect(mockPrismaService.message.create).toHaveBeenCalled();
    });

    it('is sent to a new paid subscriber too', async () => {
      mockPrismaService.creatorProfile.findUnique.mockResolvedValue({ welcomeMessage: 'Bienvenue !' });
      mockPrismaService.message.findFirst.mockResolvedValue(null);
      mockPrismaService.message.create.mockResolvedValue({ id: 'msg-4' });
      mockPrismaService.conversation.findFirst.mockResolvedValue({ id: 'conv-1' });

      await service.notifyNewSubscriber('creator-1', 'fan-1', 'Premium');

      expect(mockPrismaService.notification.create).toHaveBeenCalled();
      expect(mockPrismaService.message.create).toHaveBeenCalled();
    });
  });
});
