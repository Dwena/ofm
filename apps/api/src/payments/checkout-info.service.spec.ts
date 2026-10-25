import { NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { CheckoutInfoService, MAXIMUM_TIP } from './checkout-info.service';
import { CheckoutItemType } from './dto/payments.dto';

describe('CheckoutInfoService', () => {
  let service: CheckoutInfoService;
  let fanBillingCountry: string | null;
  let tipCreator: any;

  const mockPrismaService = {
    subscriptionTier: { findUnique: jest.fn() },
    subscription: { findFirst: jest.fn() },
    content: { findUnique: jest.fn() },
    contentUnlock: { findUnique: jest.fn() },
    liveStream: { findUnique: jest.fn() },
    transaction: { findFirst: jest.fn() },
    user: { findUnique: jest.fn() },
  };

  const mockPaymentFlow = { isConfigured: jest.fn() };
  const mockSettings = { getPlatformFeePercentage: jest.fn() };

  const creator = {
    id: 'creator-1',
    username: 'alice',
    displayName: 'Alice',
    avatar: null,
    role: 'CREATOR',
    kycStatus: 'VERIFIED',
    status: 'ACTIVE',
    deletedAt: null,
  };
  const publicCreator = { id: 'creator-1', username: 'alice', displayName: 'Alice', avatar: null };

  beforeEach(() => {
    jest.resetAllMocks();
    mockPaymentFlow.isConfigured.mockReturnValue(true);
    mockSettings.getPlatformFeePercentage.mockResolvedValue(15);
    fanBillingCountry = 'FR';
    tipCreator = null;
    // Creator of a tip checkout, or the fan's billing country
    mockPrismaService.user.findUnique.mockImplementation(async ({ where, select }: any) =>
      select?.billingCountry ? { billingCountry: fanBillingCountry } : where.id === 'creator-1' ? tipCreator : null,
    );

    service = new CheckoutInfoService(mockPrismaService as any, mockPaymentFlow as any, mockSettings as any);
  });

  describe('subscription', () => {
    const tier = {
      id: 'tier-1',
      name: 'Premium',
      price: new Prisma.Decimal('10'),
      interval: 'month',
      isActive: true,
      creator,
    };

    it('returns the server price of the tier with the VAT of the fan country on top', async () => {
      mockPrismaService.subscriptionTier.findUnique.mockResolvedValue(tier);
      mockPrismaService.subscription.findFirst.mockResolvedValue(null);

      const info = await service.getCheckoutInfo('fan-1', CheckoutItemType.SUBSCRIPTION, 'tier-1');

      expect(info).toEqual({
        type: 'subscription',
        itemId: 'tier-1',
        title: 'Premium',
        amount: 10,
        vatRate: 20,
        vatAmount: 2,
        totalAmount: 12,
        billingCountry: 'FR',
        requiresWithdrawalWaiver: true,
        interval: 'month',
        creator: publicCreator,
        available: true,
        alreadyOwned: false,
      });
    });

    it('computes the VAT for the country chosen at checkout', async () => {
      mockPrismaService.subscriptionTier.findUnique.mockResolvedValue(tier);

      const info = await service.getCheckoutInfo('fan-1', CheckoutItemType.SUBSCRIPTION, 'tier-1', 'de');

      expect(info).toEqual(expect.objectContaining({ billingCountry: 'DE', vatRate: 19, vatAmount: 1.9, totalAmount: 11.9 }));
    });

    it('charges no VAT while the billing country is unknown', async () => {
      fanBillingCountry = null;
      mockPrismaService.subscriptionTier.findUnique.mockResolvedValue(tier);

      const info = await service.getCheckoutInfo('fan-1', CheckoutItemType.SUBSCRIPTION, 'tier-1');

      expect(info).toEqual(expect.objectContaining({ billingCountry: null, vatRate: 0, vatAmount: 0, totalAmount: 10 }));
    });

    it('reports a creator who cannot sell yet (identity not verified, suspended, deleted)', async () => {
      for (const override of [{ kycStatus: 'PENDING' }, { status: 'SUSPENDED' }, { deletedAt: new Date() }, { role: 'SUBSCRIBER' }]) {
        mockPrismaService.subscriptionTier.findUnique.mockResolvedValue({ ...tier, creator: { ...creator, ...override } });

        const info = await service.getCheckoutInfo('fan-1', CheckoutItemType.SUBSCRIPTION, 'tier-1');

        expect(info.available).toBe(false);
        expect(info.unavailableReason).toBe('CREATOR_NOT_READY');
        // Private fields of the creator are not returned
        expect(info.creator).toEqual(publicCreator);
      }
    });

    it('reports payments disabled when the payment provider is not configured', async () => {
      mockPaymentFlow.isConfigured.mockReturnValue(false);
      mockPrismaService.subscriptionTier.findUnique.mockResolvedValue(tier);

      const info = await service.getCheckoutInfo('fan-1', CheckoutItemType.SUBSCRIPTION, 'tier-1');

      expect(info.available).toBe(false);
      expect(info.unavailableReason).toBe('PAYMENTS_DISABLED');
    });

    it('flags a tier already subscribed and a free tier', async () => {
      mockPrismaService.subscriptionTier.findUnique.mockResolvedValueOnce(tier).mockResolvedValueOnce({ ...tier, price: new Prisma.Decimal('0') });
      mockPrismaService.subscription.findFirst.mockResolvedValueOnce({ id: 'sub-1' }).mockResolvedValueOnce(null);

      const owned = await service.getCheckoutInfo('fan-1', CheckoutItemType.SUBSCRIPTION, 'tier-1');
      expect(owned).toEqual(expect.objectContaining({ alreadyOwned: true, available: false }));
      expect(owned.unavailableReason).toBeUndefined();
      expect(mockPrismaService.subscription.findFirst).toHaveBeenCalledWith({
        where: { subscriberId: 'fan-1', tierId: 'tier-1', status: { in: ['ACTIVE', 'PAST_DUE'] } },
        select: { id: true },
      });

      const free = await service.getCheckoutInfo('fan-1', CheckoutItemType.SUBSCRIPTION, 'tier-1');
      expect(free.unavailableReason).toBe('NOT_PAID');
    });

    it('throws for an inactive tier', async () => {
      mockPrismaService.subscriptionTier.findUnique.mockResolvedValue({ ...tier, isActive: false });

      await expect(service.getCheckoutInfo('fan-1', CheckoutItemType.SUBSCRIPTION, 'tier-1')).rejects.toThrow(NotFoundException);
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
        expect.objectContaining({
          amount: 7.5,
          vatAmount: 1.5,
          totalAmount: 9,
          title: 'Contenu exclusif',
          requiresWithdrawalWaiver: true,
          alreadyOwned: true,
          available: false,
        }),
      );
      expect(info.unavailableReason).toBeUndefined();
    });

    it('refuses buying your own content, even before the platform setup', async () => {
      mockPaymentFlow.isConfigured.mockReturnValue(false);
      mockPrismaService.content.findUnique.mockResolvedValue(content);

      const info = await service.getCheckoutInfo('creator-1', CheckoutItemType.PPV, 'content-1');

      expect(info.unavailableReason).toBe('OWN_ITEM');
    });

    it('reports content that is not pay-per-view and hides unpublished content', async () => {
      mockPrismaService.content.findUnique.mockResolvedValueOnce({ ...content, isPpv: false }).mockResolvedValueOnce({ ...content, status: 'DRAFT' });

      await expect(service.getCheckoutInfo('fan-1', CheckoutItemType.PPV, 'content-1')).resolves.toEqual(
        expect.objectContaining({ unavailableReason: 'NOT_PAID', available: false }),
      );
      await expect(service.getCheckoutInfo('fan-1', CheckoutItemType.PPV, 'content-1')).rejects.toThrow(NotFoundException);
    });
  });

  describe('stream', () => {
    const stream = {
      id: 'stream-1',
      title: 'Live',
      creatorId: 'creator-1',
      status: 'LIVE',
      isPpv: true,
      ppvPrice: new Prisma.Decimal('5'),
      creator,
    };

    it('reports an ended stream', async () => {
      mockPrismaService.liveStream.findUnique.mockResolvedValue({ ...stream, status: 'ENDED' });

      const info = await service.getCheckoutInfo('fan-1', CheckoutItemType.STREAM, 'stream-1');

      expect(mockPrismaService.transaction.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ contentId: 'stream-1', type: 'PPV_UNLOCK', status: 'COMPLETED' }),
        }),
      );
      expect(info.unavailableReason).toBe('ENDED');
    });

    it('flags a live already bought', async () => {
      mockPrismaService.liveStream.findUnique.mockResolvedValue(stream);
      mockPrismaService.transaction.findFirst.mockResolvedValue({ id: 'tx-1' });

      const info = await service.getCheckoutInfo('fan-1', CheckoutItemType.STREAM, 'stream-1');

      expect(info).toEqual(expect.objectContaining({ alreadyOwned: true, available: false, totalAmount: 6 }));
    });
  });

  describe('tip', () => {
    it('returns the tip limits, the VAT rate and no amount', async () => {
      tipCreator = { ...creator, creatorProfile: { allowTips: true, minimumTip: new Prisma.Decimal('2') } };

      const info = await service.getCheckoutInfo('fan-1', CheckoutItemType.TIP, 'creator-1');

      expect(info).toEqual(
        expect.objectContaining({
          amount: null,
          vatRate: 20,
          vatAmount: null,
          totalAmount: null,
          billingCountry: 'FR',
          minimumTip: 2,
          maximumTip: MAXIMUM_TIP,
          requiresWithdrawalWaiver: false,
          available: true,
          creator: publicCreator,
        }),
      );
    });

    it('reports a creator who does not accept tips', async () => {
      tipCreator = { ...creator, creatorProfile: { allowTips: false, minimumTip: new Prisma.Decimal('5') } };

      const info = await service.getCheckoutInfo('fan-1', CheckoutItemType.TIP, 'creator-1');

      expect(info.unavailableReason).toBe('TIPS_DISABLED');
    });

    it('reports a creator not verified yet', async () => {
      tipCreator = { ...creator, kycStatus: 'PENDING', creatorProfile: { allowTips: true, minimumTip: new Prisma.Decimal('5') } };

      const info = await service.getCheckoutInfo('fan-1', CheckoutItemType.TIP, 'creator-1');

      expect(info.unavailableReason).toBe('CREATOR_NOT_READY');
    });

    it('throws for a user who is not a creator', async () => {
      tipCreator = { ...creator, role: 'SUBSCRIBER', creatorProfile: null };

      await expect(service.getCheckoutInfo('fan-1', CheckoutItemType.TIP, 'creator-1')).rejects.toThrow(NotFoundException);
    });
  });
});
