import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { CheckoutInfoService, MAXIMUM_TIP } from './checkout-info.service';
import { StripeService } from './stripe.service';
import { PrismaService } from '../common/database/prisma.service';
import { CheckoutItemType } from './dto/payments.dto';

describe('CheckoutInfoService', () => {
  let service: CheckoutInfoService;

  const mockPrismaService = {
    subscriptionTier: { findUnique: jest.fn() },
    subscription: { findFirst: jest.fn() },
    content: { findUnique: jest.fn() },
    contentUnlock: { findUnique: jest.fn() },
    liveStream: { findUnique: jest.fn() },
    transaction: { findFirst: jest.fn() },
    user: { findUnique: jest.fn() },
  };

  const mockStripeService = { isConfigured: jest.fn() };

  const creator = {
    id: 'creator-1',
    username: 'alice',
    displayName: 'Alice',
    avatar: null,
    stripeAccountId: 'acct_1',
    stripeOnboarded: true,
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CheckoutInfoService,
        { provide: PrismaService, useValue: mockPrismaService },
        { provide: StripeService, useValue: mockStripeService },
      ],
    }).compile();

    service = module.get(CheckoutInfoService);
    jest.resetAllMocks();
    mockStripeService.isConfigured.mockReturnValue(true);
  });

  describe('subscription', () => {
    const tier = {
      id: 'tier-1',
      name: 'Premium',
      price: new Prisma.Decimal('24.99'),
      interval: 'month',
      isActive: true,
      creator,
    };

    it('returns the server price of the tier, ignoring the URL amount', async () => {
      mockPrismaService.subscriptionTier.findUnique.mockResolvedValue(tier);
      mockPrismaService.subscription.findFirst.mockResolvedValue(null);

      const info = await service.getCheckoutInfo('fan-1', CheckoutItemType.SUBSCRIPTION, 'tier-1');

      expect(info).toEqual({
        type: 'subscription',
        itemId: 'tier-1',
        title: 'Premium',
        amount: 24.99,
        interval: 'month',
        creator: { id: 'creator-1', username: 'alice', displayName: 'Alice', avatar: null },
        available: true,
        alreadyOwned: false,
      });
    });

    it('reports a creator without Stripe account', async () => {
      mockPrismaService.subscriptionTier.findUnique.mockResolvedValue({
        ...tier,
        creator: { ...creator, stripeAccountId: null, stripeOnboarded: false },
      });

      const info = await service.getCheckoutInfo('fan-1', CheckoutItemType.SUBSCRIPTION, 'tier-1');

      expect(info.available).toBe(false);
      expect(info.unavailableReason).toBe('CREATOR_NOT_READY');
    });

    it('reports payments disabled when Stripe has no key', async () => {
      mockStripeService.isConfigured.mockReturnValue(false);
      mockPrismaService.subscriptionTier.findUnique.mockResolvedValue(tier);

      const info = await service.getCheckoutInfo('fan-1', CheckoutItemType.SUBSCRIPTION, 'tier-1');

      expect(info.unavailableReason).toBe('PAYMENTS_DISABLED');
    });

    it('throws for an inactive tier', async () => {
      mockPrismaService.subscriptionTier.findUnique.mockResolvedValue({ ...tier, isActive: false });

      await expect(
        service.getCheckoutInfo('fan-1', CheckoutItemType.SUBSCRIPTION, 'tier-1'),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('ppv', () => {
    const content = {
      id: 'content-1',
      title: null,
      status: 'PUBLISHED',
      deletedAt: null,
      isPpv: true,
      ppvPrice: new Prisma.Decimal('7.5'),
      creator,
    };

    it('flags content already unlocked', async () => {
      mockPrismaService.content.findUnique.mockResolvedValue(content);
      mockPrismaService.contentUnlock.findUnique.mockResolvedValue({ id: 'unlock-1' });

      const info = await service.getCheckoutInfo('fan-1', CheckoutItemType.PPV, 'content-1');

      expect(info).toEqual(
        expect.objectContaining({ amount: 7.5, title: 'Contenu exclusif', alreadyOwned: true, available: false }),
      );
      expect(info.unavailableReason).toBeUndefined();
    });

    it('refuses buying your own content', async () => {
      mockPrismaService.content.findUnique.mockResolvedValue(content);

      const info = await service.getCheckoutInfo('creator-1', CheckoutItemType.PPV, 'content-1');

      expect(info.unavailableReason).toBe('OWN_ITEM');
    });
  });

  describe('stream', () => {
    it('reports an ended stream', async () => {
      mockPrismaService.liveStream.findUnique.mockResolvedValue({
        id: 'stream-1',
        title: 'Live',
        creatorId: 'creator-1',
        status: 'ENDED',
        isPpv: true,
        ppvPrice: new Prisma.Decimal('5'),
        creator,
      });

      const info = await service.getCheckoutInfo('fan-1', CheckoutItemType.STREAM, 'stream-1');

      expect(mockPrismaService.transaction.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ contentId: 'stream-1', type: 'PPV_UNLOCK', status: 'COMPLETED' }),
        }),
      );
      expect(info.unavailableReason).toBe('ENDED');
    });
  });

  describe('tip', () => {
    it('returns the creator minimum tip', async () => {
      mockPrismaService.user.findUnique.mockResolvedValue({
        ...creator,
        role: 'CREATOR',
        creatorProfile: { allowTips: true, minimumTip: new Prisma.Decimal('2') },
      });

      const info = await service.getCheckoutInfo('fan-1', CheckoutItemType.TIP, 'creator-1');

      expect(info).toEqual(
        expect.objectContaining({ amount: null, minimumTip: 2, maximumTip: MAXIMUM_TIP, available: true }),
      );
    });

    it('reports a creator who does not accept tips', async () => {
      mockPrismaService.user.findUnique.mockResolvedValue({
        ...creator,
        role: 'CREATOR',
        creatorProfile: { allowTips: false, minimumTip: new Prisma.Decimal('5') },
      });

      const info = await service.getCheckoutInfo('fan-1', CheckoutItemType.TIP, 'creator-1');

      expect(info.unavailableReason).toBe('TIPS_DISABLED');
    });

    it('throws for a user who is not a creator', async () => {
      mockPrismaService.user.findUnique.mockResolvedValue({ ...creator, role: 'SUBSCRIBER', creatorProfile: null });

      await expect(service.getCheckoutInfo('fan-1', CheckoutItemType.TIP, 'creator-1')).rejects.toThrow(
        NotFoundException,
      );
    });
  });
});
