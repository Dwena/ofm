import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { SubscriptionsService } from './subscriptions.service';
import { PrismaService } from '../common/database/prisma.service';
import { PaymentsService } from '../payments/payments.service';
import { StripeService } from '../payments/stripe.service';
import { SubscriptionSyncService } from '../payments/subscription-sync.service';

describe('SubscriptionsService', () => {
  let service: SubscriptionsService;

  const mockPrismaService = {
    subscriptionTier: {
      findUnique: jest.fn(),
      update: jest.fn(),
    },
    subscription: {
      findFirst: jest.fn(),
      findUnique: jest.fn(),
      findMany: jest.fn(),
      upsert: jest.fn(),
      update: jest.fn(),
    },
    user: {
      findUnique: jest.fn(),
    },
  };

  const mockPaymentsService = {
    getOrCreateCustomerId: jest.fn(),
    assertPaymentMethodOwnership: jest.fn(),
  };

  const mockStripeService = {
    createProduct: jest.fn(),
    createPrice: jest.fn(),
    createTierSubscription: jest.fn(),
    retrieveSubscription: jest.fn(),
    setCancelAtPeriodEnd: jest.fn(),
    cancelSubscription: jest.fn(),
  };

  const mockSubscriptionSync = {
    syncFromStripe: jest.fn(),
    refreshCreatorSubscriberCount: jest.fn(),
    notifyNewSubscriber: jest.fn(),
  };

  const userId = 'fan-1';
  const creatorId = 'creator-1';

  const paidTier = {
    id: 'tier-paid',
    creatorId,
    name: 'Premium',
    description: 'Tout le contenu',
    price: 9.99,
    currency: 'EUR',
    interval: 'month',
    isActive: true,
    stripePriceId: null,
    stripeProductId: null,
    creator: {
      id: creatorId,
      username: 'creator',
      stripeAccountId: 'acct_123',
      stripeOnboarded: true,
    },
  };

  const freeTier = { ...paidTier, id: 'tier-free', name: 'Free', price: 0 };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SubscriptionsService,
        { provide: PrismaService, useValue: mockPrismaService },
        { provide: PaymentsService, useValue: mockPaymentsService },
        { provide: StripeService, useValue: mockStripeService },
        { provide: SubscriptionSyncService, useValue: mockSubscriptionSync },
      ],
    }).compile();

    service = module.get<SubscriptionsService>(SubscriptionsService);

    jest.clearAllMocks();
  });

  describe('subscribe', () => {
    it('should throw NotFoundException when tier does not exist', async () => {
      mockPrismaService.subscriptionTier.findUnique.mockResolvedValue(null);

      await expect(service.subscribe(userId, { tierId: 'missing' })).rejects.toThrow(
        NotFoundException,
      );
    });

    it('should reject subscribing to your own tier', async () => {
      mockPrismaService.subscriptionTier.findUnique.mockResolvedValue(paidTier);

      await expect(service.subscribe(creatorId, { tierId: paidTier.id })).rejects.toThrow(
        BadRequestException,
      );
    });

    it('should reject when already subscribed to this creator', async () => {
      mockPrismaService.subscriptionTier.findUnique.mockResolvedValue(paidTier);
      mockPrismaService.subscription.findFirst.mockResolvedValue({
        id: 'sub-1',
        tierId: paidTier.id,
        status: 'ACTIVE',
        cancelAtPeriodEnd: false,
      });

      await expect(service.subscribe(userId, { tierId: paidTier.id })).rejects.toThrow(
        'You are already subscribed to this tier',
      );
      expect(mockStripeService.createTierSubscription).not.toHaveBeenCalled();
    });

    it('should activate a free tier directly without Stripe', async () => {
      const subscription = { id: 'sub-free', status: 'ACTIVE' };
      mockPrismaService.subscriptionTier.findUnique.mockResolvedValue(freeTier);
      mockPrismaService.subscription.findFirst.mockResolvedValue(null);
      mockPrismaService.subscription.upsert.mockResolvedValue(subscription);

      const result = await service.subscribe(userId, { tierId: freeTier.id });

      expect(result).toEqual({ requiresPayment: false, subscription });
      expect(mockPrismaService.subscription.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { subscriberId_tierId: { subscriberId: userId, tierId: freeTier.id } },
          create: expect.objectContaining({ status: 'ACTIVE', stripeSubscriptionId: null }),
        }),
      );
      expect(mockSubscriptionSync.refreshCreatorSubscriberCount).toHaveBeenCalledWith(creatorId);
      expect(mockStripeService.createTierSubscription).not.toHaveBeenCalled();
    });

    it('should reject a paid tier when the creator is not onboarded', async () => {
      mockPrismaService.subscriptionTier.findUnique.mockResolvedValue({
        ...paidTier,
        creator: { ...paidTier.creator, stripeOnboarded: false },
      });
      mockPrismaService.subscription.findFirst.mockResolvedValue(null);

      await expect(service.subscribe(userId, { tierId: paidTier.id })).rejects.toThrow(
        'Creator payment account is not ready',
      );
    });

    it('should create the Stripe price and return a client secret for a paid tier', async () => {
      mockPrismaService.subscriptionTier.findUnique.mockResolvedValue(paidTier);
      mockPrismaService.subscription.findFirst.mockResolvedValue(null);
      mockPrismaService.user.findUnique.mockResolvedValue({ id: userId });
      mockPaymentsService.getOrCreateCustomerId.mockResolvedValue('cus_123');
      mockStripeService.createProduct.mockResolvedValue({ id: 'prod_123' });
      mockStripeService.createPrice.mockResolvedValue({ id: 'price_123' });
      mockStripeService.createTierSubscription.mockResolvedValue({
        id: 'sub_stripe',
        status: 'incomplete',
        latest_invoice: { payment_intent: { client_secret: 'pi_secret' } },
      });
      mockSubscriptionSync.syncFromStripe.mockResolvedValue(null);

      const result = await service.subscribe(userId, { tierId: paidTier.id });

      expect(mockStripeService.createPrice).toHaveBeenCalledWith('prod_123', 9.99, 'eur', 'month');
      expect(mockPrismaService.subscriptionTier.update).toHaveBeenCalledWith({
        where: { id: paidTier.id },
        data: { stripeProductId: 'prod_123', stripePriceId: 'price_123' },
      });
      expect(mockStripeService.createTierSubscription).toHaveBeenCalledWith(
        expect.objectContaining({
          customerId: 'cus_123',
          priceId: 'price_123',
          connectedAccountId: 'acct_123',
          metadata: { subscriberId: userId, tierId: paidTier.id, creatorId },
        }),
      );
      expect(result).toEqual({
        requiresPayment: true,
        stripeSubscriptionId: 'sub_stripe',
        clientSecret: 'pi_secret',
      });
    });

    it('should return the active subscription when a saved card was charged', async () => {
      const subscription = { id: 'sub-1', status: 'ACTIVE' };
      mockPrismaService.subscriptionTier.findUnique.mockResolvedValue({
        ...paidTier,
        stripePriceId: 'price_existing',
      });
      mockPrismaService.subscription.findFirst.mockResolvedValue(null);
      mockPrismaService.user.findUnique.mockResolvedValue({ id: userId });
      mockPaymentsService.getOrCreateCustomerId.mockResolvedValue('cus_123');
      mockStripeService.createTierSubscription.mockResolvedValue({
        id: 'sub_stripe',
        status: 'active',
      });
      mockSubscriptionSync.syncFromStripe.mockResolvedValue(subscription);

      const result = await service.subscribe(userId, { tierId: paidTier.id, paymentMethodId: 'pm_1' });

      expect(mockPaymentsService.assertPaymentMethodOwnership).toHaveBeenCalledWith(userId, 'pm_1');
      expect(mockStripeService.createPrice).not.toHaveBeenCalled();
      expect(result).toEqual({ requiresPayment: false, subscription });
    });
  });

  describe('confirmSubscription', () => {
    it('should refuse a Stripe subscription that belongs to someone else', async () => {
      mockStripeService.retrieveSubscription.mockResolvedValue({
        id: 'sub_stripe',
        metadata: { subscriberId: 'someone-else' },
      });

      await expect(service.confirmSubscription(userId, 'sub_stripe')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('should sync and return the subscription once paid', async () => {
      const subscription = { id: 'sub-1', status: 'ACTIVE' };
      mockStripeService.retrieveSubscription.mockResolvedValue({
        id: 'sub_stripe',
        status: 'active',
        metadata: { subscriberId: userId },
      });
      mockSubscriptionSync.syncFromStripe.mockResolvedValue(subscription);

      const result = await service.confirmSubscription(userId, 'sub_stripe');

      expect(result).toEqual({ requiresPayment: false, subscription });
    });
  });

  describe('cancelSubscription', () => {
    it('should throw NotFoundException for another user subscription', async () => {
      mockPrismaService.subscription.findUnique.mockResolvedValue({
        id: 'sub-1',
        subscriberId: 'someone-else',
      });

      await expect(service.cancelSubscription(userId, 'sub-1')).rejects.toThrow(NotFoundException);
    });

    it('should schedule cancellation at period end on Stripe', async () => {
      const stripeSubscription = { id: 'sub_stripe', cancel_at_period_end: true };
      mockPrismaService.subscription.findUnique.mockResolvedValue({
        id: 'sub-1',
        subscriberId: userId,
        status: 'ACTIVE',
        cancelAtPeriodEnd: false,
        stripeSubscriptionId: 'sub_stripe',
        tier: paidTier,
      });
      mockStripeService.setCancelAtPeriodEnd.mockResolvedValue(stripeSubscription);
      mockSubscriptionSync.syncFromStripe.mockResolvedValue({ id: 'sub-1', cancelAtPeriodEnd: true });

      const result = await service.cancelSubscription(userId, 'sub-1');

      expect(mockStripeService.setCancelAtPeriodEnd).toHaveBeenCalledWith('sub_stripe', true);
      expect(mockSubscriptionSync.syncFromStripe).toHaveBeenCalledWith(stripeSubscription);
      expect(result).toEqual({ id: 'sub-1', cancelAtPeriodEnd: true });
    });

    it('should end a free subscription immediately', async () => {
      mockPrismaService.subscription.findUnique.mockResolvedValue({
        id: 'sub-1',
        subscriberId: userId,
        status: 'ACTIVE',
        cancelAtPeriodEnd: false,
        stripeSubscriptionId: null,
        tier: freeTier,
      });
      mockPrismaService.subscription.update.mockResolvedValue({ id: 'sub-1', status: 'CANCELLED' });

      await service.cancelSubscription(userId, 'sub-1');

      expect(mockPrismaService.subscription.update).toHaveBeenCalledWith({
        where: { id: 'sub-1' },
        data: expect.objectContaining({ status: 'CANCELLED', cancelAtPeriodEnd: false }),
      });
      expect(mockSubscriptionSync.refreshCreatorSubscriberCount).toHaveBeenCalledWith(creatorId);
      expect(mockStripeService.setCancelAtPeriodEnd).not.toHaveBeenCalled();
    });

    it('should reject cancelling twice', async () => {
      mockPrismaService.subscription.findUnique.mockResolvedValue({
        id: 'sub-1',
        subscriberId: userId,
        status: 'ACTIVE',
        cancelAtPeriodEnd: true,
        tier: paidTier,
      });

      await expect(service.cancelSubscription(userId, 'sub-1')).rejects.toThrow(
        BadRequestException,
      );
    });
  });

  describe('resumeSubscription', () => {
    it('should undo a scheduled cancellation on Stripe', async () => {
      const synced = { id: 'sub-1', cancelAtPeriodEnd: false };
      mockPrismaService.subscription.findUnique.mockResolvedValue({
        id: 'sub-1',
        subscriberId: userId,
        status: 'ACTIVE',
        cancelAtPeriodEnd: true,
        stripeSubscriptionId: 'sub_stripe',
        tier: paidTier,
      });
      mockStripeService.setCancelAtPeriodEnd.mockResolvedValue({ id: 'sub_stripe' });
      mockSubscriptionSync.syncFromStripe.mockResolvedValue(synced);

      const result = await service.resumeSubscription(userId, 'sub-1');

      expect(mockStripeService.setCancelAtPeriodEnd).toHaveBeenCalledWith('sub_stripe', false);
      expect(result).toEqual({ requiresPayment: false, subscription: synced });
    });

    it('should reject resuming an active subscription that is not cancelled', async () => {
      mockPrismaService.subscription.findUnique.mockResolvedValue({
        id: 'sub-1',
        subscriberId: userId,
        status: 'ACTIVE',
        cancelAtPeriodEnd: false,
        tier: paidTier,
      });

      await expect(service.resumeSubscription(userId, 'sub-1')).rejects.toThrow(
        BadRequestException,
      );
    });

    it('should resubscribe to the same tier once the subscription has ended', async () => {
      mockPrismaService.subscription.findUnique.mockResolvedValue({
        id: 'sub-1',
        subscriberId: userId,
        tierId: freeTier.id,
        status: 'CANCELLED',
        cancelAtPeriodEnd: false,
        tier: freeTier,
      });
      mockPrismaService.subscriptionTier.findUnique.mockResolvedValue(freeTier);
      mockPrismaService.subscription.findFirst.mockResolvedValue(null);
      mockPrismaService.subscription.upsert.mockResolvedValue({ id: 'sub-1', status: 'ACTIVE' });

      const result = await service.resumeSubscription(userId, 'sub-1');

      expect(result).toEqual({ requiresPayment: false, subscription: { id: 'sub-1', status: 'ACTIVE' } });
    });
  });

  describe('getSubscriptionStatus', () => {
    it('should prefer the live subscription over ended ones', async () => {
      const active = { id: 'sub-2', status: 'ACTIVE' };
      mockPrismaService.subscription.findMany.mockResolvedValue([
        { id: 'sub-1', status: 'CANCELLED' },
        active,
      ]);

      const result = await service.getSubscriptionStatus(userId, creatorId);

      expect(result).toEqual({ isSubscribed: true, subscription: active });
      expect(mockPrismaService.subscription.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { subscriberId: userId, tier: { creatorId } },
        }),
      );
    });

    it('should report not subscribed when there is no subscription', async () => {
      mockPrismaService.subscription.findMany.mockResolvedValue([]);

      const result = await service.getSubscriptionStatus(userId, creatorId);

      expect(result).toEqual({ isSubscribed: false, subscription: null });
    });
  });
});
