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
    updateTierSubscription: jest.fn(),
    listIncompleteSubscriptions: jest.fn(),
    setSubscriptionPaymentMethod: jest.fn(),
    payInvoice: jest.fn(),
  };

  const mockSubscriptionSync = {
    syncFromStripe: jest.fn(),
    refreshCreatorSubscriberCount: jest.fn(),
    notifyNewSubscriber: jest.fn(),
    activateFreeSubscription: jest.fn(),
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

    jest.resetAllMocks();
    mockStripeService.listIncompleteSubscriptions.mockResolvedValue([]);
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
      mockSubscriptionSync.activateFreeSubscription.mockResolvedValue(subscription);

      const result = await service.subscribe(userId, { tierId: freeTier.id });

      expect(result).toEqual({ requiresPayment: false, subscription });
      expect(mockSubscriptionSync.activateFreeSubscription).toHaveBeenCalledWith(userId, freeTier);
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
      mockSubscriptionSync.activateFreeSubscription.mockResolvedValue({ id: 'sub-1', status: 'ACTIVE' });

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

  describe('subscribe retry after an abandoned checkout', () => {
    it('should cancel incomplete attempts for the same creator before creating a new one', async () => {
      mockPrismaService.subscriptionTier.findUnique.mockResolvedValue({
        ...paidTier,
        stripePriceId: 'price_existing',
      });
      mockPrismaService.subscription.findFirst.mockResolvedValue(null);
      mockPrismaService.user.findUnique.mockResolvedValue({ id: userId });
      mockPaymentsService.getOrCreateCustomerId.mockResolvedValue('cus_123');
      mockStripeService.listIncompleteSubscriptions.mockResolvedValue([
        { id: 'sub_old', metadata: { creatorId } },
        { id: 'sub_other_creator', metadata: { creatorId: 'creator-2' } },
      ]);
      mockStripeService.createTierSubscription.mockResolvedValue({
        id: 'sub_new',
        status: 'incomplete',
        latest_invoice: { payment_intent: { client_secret: 'pi_secret', status: 'requires_payment_method' } },
      });
      mockSubscriptionSync.syncFromStripe.mockResolvedValue(null);

      const result = await service.subscribe(userId, { tierId: paidTier.id });

      expect(mockStripeService.listIncompleteSubscriptions).toHaveBeenCalledWith({ customerId: 'cus_123' });
      expect(mockStripeService.cancelSubscription).toHaveBeenCalledTimes(1);
      expect(mockStripeService.cancelSubscription).toHaveBeenCalledWith('sub_old');
      expect(result).toEqual(
        expect.objectContaining({ requiresPayment: true, stripeSubscriptionId: 'sub_new' }),
      );
    });
  });

  describe('changeTier', () => {
    const basicTier = {
      ...paidTier,
      id: 'tier-basic',
      name: 'Basic',
      price: 4.99,
      stripePriceId: 'price_basic',
      stripeProductId: 'prod_basic',
    };
    const premiumTier = {
      ...paidTier,
      id: 'tier-premium',
      name: 'Premium',
      price: 9.99,
      stripePriceId: 'price_premium',
      stripeProductId: 'prod_premium',
    };
    const periodEnd = 1702592000;

    const paidSubscription = (overrides: any = {}) => ({
      id: 'sub-1',
      subscriberId: userId,
      tierId: basicTier.id,
      status: 'ACTIVE',
      cancelAtPeriodEnd: false,
      pendingTierId: null,
      stripeSubscriptionId: 'sub_stripe',
      tier: basicTier,
      ...overrides,
    });

    const freeSubscription = (overrides: any = {}) => ({
      id: 'sub-free',
      subscriberId: userId,
      tierId: freeTier.id,
      status: 'ACTIVE',
      cancelAtPeriodEnd: false,
      pendingTierId: null,
      stripeSubscriptionId: null,
      tier: freeTier,
      ...overrides,
    });

    const stripeSub = (overrides: any = {}) => ({
      id: 'sub_stripe',
      status: 'active',
      cancel_at_period_end: false,
      current_period_end: periodEnd,
      pending_update: null,
      metadata: { subscriberId: userId },
      items: { data: [{ id: 'si_1', price: { id: 'price_basic' } }] },
      ...overrides,
    });

    it('should reject a subscription that is not active', async () => {
      mockPrismaService.subscription.findUnique.mockResolvedValue(
        paidSubscription({ status: 'PAST_DUE' }),
      );

      await expect(
        service.changeTier(userId, 'sub-1', { tierId: premiumTier.id }),
      ).rejects.toThrow('Only an active subscription can change tier');
    });

    it('should reject a tier of another creator', async () => {
      mockPrismaService.subscription.findUnique.mockResolvedValue(paidSubscription());
      mockPrismaService.subscriptionTier.findUnique.mockResolvedValue({
        ...premiumTier,
        creatorId: 'creator-2',
      });

      await expect(
        service.changeTier(userId, 'sub-1', { tierId: premiumTier.id }),
      ).rejects.toThrow(BadRequestException);
      expect(mockStripeService.updateTierSubscription).not.toHaveBeenCalled();
    });

    it('should reject switching to the current tier', async () => {
      mockPrismaService.subscription.findUnique.mockResolvedValue(paidSubscription());
      mockPrismaService.subscriptionTier.findUnique.mockResolvedValue(basicTier);

      await expect(
        service.changeTier(userId, 'sub-1', { tierId: basicTier.id }),
      ).rejects.toThrow('You are already subscribed to this tier');
    });

    it('should upgrade paid → paid immediately with an invoiced proration', async () => {
      const synced = { id: 'sub-1', tierId: premiumTier.id };
      mockPrismaService.subscription.findUnique.mockResolvedValue(paidSubscription());
      mockPrismaService.subscriptionTier.findUnique.mockResolvedValue(premiumTier);
      mockStripeService.retrieveSubscription.mockResolvedValue(stripeSub());
      mockStripeService.updateTierSubscription.mockResolvedValue(
        stripeSub({ items: { data: [{ id: 'si_1', price: { id: 'price_premium' } }] } }),
      );
      mockSubscriptionSync.syncFromStripe.mockResolvedValue(synced);

      const result = await service.changeTier(userId, 'sub-1', { tierId: premiumTier.id });

      expect(mockStripeService.updateTierSubscription).toHaveBeenCalledTimes(1);
      expect(mockStripeService.updateTierSubscription).toHaveBeenCalledWith('sub_stripe', {
        items: [{ id: 'si_1', price: 'price_premium' }],
        proration_behavior: 'always_invoice',
        payment_behavior: 'pending_if_incomplete',
      });
      expect(result).toEqual({ requiresPayment: false, subscription: synced });
    });

    it('should return the client secret when the upgrade payment needs action', async () => {
      mockPrismaService.subscription.findUnique.mockResolvedValue(paidSubscription());
      mockPrismaService.subscriptionTier.findUnique.mockResolvedValue(premiumTier);
      mockStripeService.retrieveSubscription.mockResolvedValue(stripeSub());
      mockStripeService.updateTierSubscription.mockResolvedValue(
        stripeSub({
          pending_update: { subscription_items: [] },
          latest_invoice: {
            payment_intent: { client_secret: 'pi_upgrade_secret', status: 'requires_action' },
          },
        }),
      );
      // Pending update: Stripe still bills the current tier
      mockSubscriptionSync.syncFromStripe.mockResolvedValue({ id: 'sub-1', tierId: basicTier.id });

      const result = await service.changeTier(userId, 'sub-1', { tierId: premiumTier.id });

      expect(result).toEqual({
        requiresPayment: true,
        stripeSubscriptionId: 'sub_stripe',
        clientSecret: 'pi_upgrade_secret',
        paymentStatus: 'requires_action',
      });
    });

    it('should create the Stripe price of the target tier lazily', async () => {
      mockPrismaService.subscription.findUnique.mockResolvedValue(paidSubscription());
      mockPrismaService.subscriptionTier.findUnique.mockResolvedValue({
        ...premiumTier,
        stripePriceId: null,
      });
      mockStripeService.retrieveSubscription.mockResolvedValue(stripeSub());
      mockStripeService.createPrice.mockResolvedValue({ id: 'price_new' });
      mockStripeService.updateTierSubscription.mockResolvedValue(stripeSub());
      mockSubscriptionSync.syncFromStripe.mockResolvedValue({ id: 'sub-1' });

      await service.changeTier(userId, 'sub-1', { tierId: premiumTier.id });

      expect(mockStripeService.createProduct).not.toHaveBeenCalled();
      expect(mockStripeService.createPrice).toHaveBeenCalledWith('prod_premium', 9.99, 'eur', 'month');
      expect(mockStripeService.updateTierSubscription).toHaveBeenCalledWith(
        'sub_stripe',
        expect.objectContaining({ items: [{ id: 'si_1', price: 'price_new' }] }),
      );
    });

    it('should schedule a paid → paid downgrade for the end of the period', async () => {
      const synced = { id: 'sub-1', tierId: premiumTier.id, pendingTierId: basicTier.id };
      mockPrismaService.subscription.findUnique.mockResolvedValue(
        paidSubscription({ tierId: premiumTier.id, tier: premiumTier }),
      );
      mockPrismaService.subscriptionTier.findUnique.mockResolvedValue(basicTier);
      mockStripeService.retrieveSubscription.mockResolvedValue(
        stripeSub({ items: { data: [{ id: 'si_1', price: { id: 'price_premium' } }] } }),
      );
      mockStripeService.updateTierSubscription.mockResolvedValue(stripeSub());
      mockSubscriptionSync.syncFromStripe.mockResolvedValue(synced);

      const result = await service.changeTier(userId, 'sub-1', { tierId: basicTier.id });

      expect(mockStripeService.updateTierSubscription).toHaveBeenCalledWith('sub_stripe', {
        items: [{ id: 'si_1', price: 'price_basic' }],
        proration_behavior: 'none',
        metadata: {
          downgradeTierId: basicTier.id,
          downgradeFromTierId: premiumTier.id,
          downgradeFromPriceId: 'price_premium',
          downgradeAt: String(periodEnd),
        },
      });
      expect(result).toEqual({ requiresPayment: false, subscription: synced });
    });

    it('should treat a change of billing interval as an immediate change', async () => {
      mockPrismaService.subscription.findUnique.mockResolvedValue(
        paidSubscription({ tierId: premiumTier.id, tier: { ...premiumTier, interval: 'year', price: 99 } }),
      );
      mockPrismaService.subscriptionTier.findUnique.mockResolvedValue(basicTier);
      mockStripeService.retrieveSubscription.mockResolvedValue(stripeSub());
      mockStripeService.updateTierSubscription.mockResolvedValue(stripeSub());
      mockSubscriptionSync.syncFromStripe.mockResolvedValue({ id: 'sub-1' });

      await service.changeTier(userId, 'sub-1', { tierId: basicTier.id });

      expect(mockStripeService.updateTierSubscription).toHaveBeenCalledWith(
        'sub_stripe',
        expect.objectContaining({ proration_behavior: 'always_invoice' }),
      );
    });

    it('should cancel at period end and schedule the free tier for paid → free', async () => {
      mockPrismaService.subscription.findUnique.mockResolvedValue(paidSubscription());
      mockPrismaService.subscriptionTier.findUnique.mockResolvedValue(freeTier);
      mockStripeService.retrieveSubscription.mockResolvedValue(stripeSub());
      mockStripeService.updateTierSubscription.mockResolvedValue(stripeSub({ cancel_at_period_end: true }));
      mockSubscriptionSync.syncFromStripe.mockResolvedValue({ id: 'sub-1', pendingTierId: freeTier.id });

      const result = await service.changeTier(userId, 'sub-1', { tierId: freeTier.id });

      expect(mockStripeService.updateTierSubscription).toHaveBeenCalledWith('sub_stripe', {
        cancel_at_period_end: true,
        metadata: expect.objectContaining({
          downgradeTierId: freeTier.id,
          downgradeFromTierId: basicTier.id,
          downgradeAt: String(periodEnd),
        }),
      });
      expect(mockStripeService.cancelSubscription).not.toHaveBeenCalled();
      expect(result.subscription).toEqual({ id: 'sub-1', pendingTierId: freeTier.id });
    });

    it('should undo a scheduled downgrade when choosing the current tier again', async () => {
      mockPrismaService.subscription.findUnique.mockResolvedValue(
        paidSubscription({ tierId: premiumTier.id, tier: premiumTier, pendingTierId: basicTier.id }),
      );
      mockPrismaService.subscriptionTier.findUnique.mockResolvedValue(premiumTier);
      mockStripeService.retrieveSubscription.mockResolvedValue(
        stripeSub({
          metadata: {
            subscriberId: userId,
            downgradeTierId: basicTier.id,
            downgradeFromTierId: premiumTier.id,
            downgradeFromPriceId: 'price_premium',
            downgradeAt: String(periodEnd),
          },
        }),
      );
      mockStripeService.updateTierSubscription.mockResolvedValue(stripeSub());
      mockSubscriptionSync.syncFromStripe.mockResolvedValue({ id: 'sub-1', pendingTierId: null });

      const result = await service.changeTier(userId, 'sub-1', { tierId: premiumTier.id });

      expect(mockStripeService.updateTierSubscription).toHaveBeenCalledTimes(1);
      expect(mockStripeService.updateTierSubscription).toHaveBeenCalledWith('sub_stripe', {
        cancel_at_period_end: false,
        metadata: {
          downgradeTierId: '',
          downgradeFromTierId: '',
          downgradeFromPriceId: '',
          downgradeAt: '',
        },
        items: [{ id: 'si_1', price: 'price_premium' }],
        proration_behavior: 'none',
      });
      expect(result).toEqual({ requiresPayment: false, subscription: { id: 'sub-1', pendingTierId: null } });
    });

    it('should go through the paid subscription flow for free → paid', async () => {
      mockPrismaService.subscription.findUnique.mockResolvedValue(freeSubscription());
      mockPrismaService.subscriptionTier.findUnique.mockResolvedValue(premiumTier);
      mockPrismaService.user.findUnique.mockResolvedValue({ id: userId });
      mockPaymentsService.getOrCreateCustomerId.mockResolvedValue('cus_123');
      mockStripeService.createTierSubscription.mockResolvedValue({
        id: 'sub_new',
        status: 'incomplete',
        latest_invoice: { payment_intent: { client_secret: 'pi_secret' } },
      });
      mockSubscriptionSync.syncFromStripe.mockResolvedValue(null);

      const result = await service.changeTier(userId, 'sub-free', { tierId: premiumTier.id });

      expect(mockStripeService.createTierSubscription).toHaveBeenCalledWith(
        expect.objectContaining({
          priceId: 'price_premium',
          metadata: {
            subscriberId: userId,
            tierId: premiumTier.id,
            creatorId,
            replacesSubscriptionId: 'sub-free',
          },
        }),
      );
      // The free subscription stays active until the paid one is
      expect(mockPrismaService.subscription.update).not.toHaveBeenCalled();
      expect(result).toEqual({
        requiresPayment: true,
        stripeSubscriptionId: 'sub_new',
        clientSecret: 'pi_secret',
      });
    });

    it('should switch free → free immediately', async () => {
      const otherFree = { ...freeTier, id: 'tier-free-2', name: 'Fans' };
      mockPrismaService.subscription.findUnique.mockResolvedValue(freeSubscription());
      mockPrismaService.subscriptionTier.findUnique.mockResolvedValue(otherFree);
      mockSubscriptionSync.activateFreeSubscription.mockResolvedValue({ id: 'sub-free-2' });

      const result = await service.changeTier(userId, 'sub-free', { tierId: otherFree.id });

      expect(mockPrismaService.subscription.update).toHaveBeenCalledWith({
        where: { id: 'sub-free' },
        data: expect.objectContaining({ status: 'CANCELLED' }),
      });
      expect(mockSubscriptionSync.activateFreeSubscription).toHaveBeenCalledWith(userId, otherFree);
      expect(result).toEqual({ requiresPayment: false, subscription: { id: 'sub-free-2' } });
    });
  });

  describe('cancelSubscription with a scheduled downgrade', () => {
    it('should restore the paid price and cancel at period end instead', async () => {
      mockPrismaService.subscription.findUnique.mockResolvedValue({
        id: 'sub-1',
        subscriberId: userId,
        status: 'ACTIVE',
        cancelAtPeriodEnd: true,
        pendingTierId: freeTier.id,
        stripeSubscriptionId: 'sub_stripe',
        tier: paidTier,
      });
      mockStripeService.retrieveSubscription.mockResolvedValue({
        id: 'sub_stripe',
        metadata: { downgradeTierId: freeTier.id, downgradeFromPriceId: 'price_paid' },
        items: { data: [{ id: 'si_1', price: { id: 'price_paid' } }] },
      });
      mockStripeService.updateTierSubscription.mockResolvedValue({ id: 'sub_stripe' });
      mockSubscriptionSync.syncFromStripe.mockResolvedValue({ id: 'sub-1', pendingTierId: null });

      await service.cancelSubscription(userId, 'sub-1');

      expect(mockStripeService.updateTierSubscription).toHaveBeenCalledWith(
        'sub_stripe',
        expect.objectContaining({
          cancel_at_period_end: true,
          metadata: expect.objectContaining({ downgradeTierId: '' }),
        }),
      );
      expect(mockStripeService.setCancelAtPeriodEnd).not.toHaveBeenCalled();
    });
  });

  describe('retryPayment', () => {
    const pastDue = {
      id: 'sub-1',
      subscriberId: userId,
      status: 'PAST_DUE',
      cancelAtPeriodEnd: false,
      stripeSubscriptionId: 'sub_stripe',
      tier: paidTier,
    };

    it('should reject a subscription that is not past due', async () => {
      mockPrismaService.subscription.findUnique.mockResolvedValue({ ...pastDue, status: 'ACTIVE' });

      await expect(service.retryPayment(userId, 'sub-1')).rejects.toThrow(BadRequestException);
      expect(mockStripeService.payInvoice).not.toHaveBeenCalled();
    });

    it('should reject a past-due subscription without Stripe subscription', async () => {
      mockPrismaService.subscription.findUnique.mockResolvedValue({ ...pastDue, stripeSubscriptionId: null });

      await expect(service.retryPayment(userId, 'sub-1')).rejects.toThrow(BadRequestException);
    });

    it('should switch the subscription card and pay the open invoice', async () => {
      mockPrismaService.subscription.findUnique.mockResolvedValue(pastDue);
      mockStripeService.retrieveSubscription
        .mockResolvedValueOnce({ id: 'sub_stripe', status: 'past_due', latest_invoice: { id: 'in_1', status: 'open' } })
        .mockResolvedValueOnce({ id: 'sub_stripe', status: 'active', latest_invoice: { id: 'in_1', status: 'paid' } });
      mockSubscriptionSync.syncFromStripe.mockResolvedValue({ id: 'sub-1', status: 'ACTIVE' });

      const result = await service.retryPayment(userId, 'sub-1', 'pm_new');

      expect(mockPaymentsService.assertPaymentMethodOwnership).toHaveBeenCalledWith(userId, 'pm_new');
      expect(mockStripeService.setSubscriptionPaymentMethod).toHaveBeenCalledWith('sub_stripe', 'pm_new');
      expect(mockStripeService.payInvoice).toHaveBeenCalledWith('in_1', 'pm_new');
      expect(result).toEqual({ requiresPayment: false, subscription: { id: 'sub-1', status: 'ACTIVE' } });
    });

    it('should return the client secret when the bank asks for 3D Secure', async () => {
      mockPrismaService.subscription.findUnique.mockResolvedValue(pastDue);
      const stillPastDue = {
        id: 'sub_stripe',
        status: 'past_due',
        latest_invoice: {
          id: 'in_1',
          status: 'open',
          payment_intent: { client_secret: 'pi_secret', status: 'requires_action' },
        },
      };
      mockStripeService.retrieveSubscription.mockResolvedValue(stillPastDue);
      mockStripeService.payInvoice.mockRejectedValue(new Error('invoice_payment_intent_requires_action'));
      mockSubscriptionSync.syncFromStripe.mockResolvedValue({ id: 'sub-1', status: 'PAST_DUE' });

      const result = await service.retryPayment(userId, 'sub-1');

      expect(mockStripeService.setSubscriptionPaymentMethod).not.toHaveBeenCalled();
      expect(mockStripeService.payInvoice).toHaveBeenCalledWith('in_1', undefined);
      expect(result).toEqual(
        expect.objectContaining({
          requiresPayment: true,
          stripeSubscriptionId: 'sub_stripe',
          clientSecret: 'pi_secret',
          paymentStatus: 'requires_action',
        }),
      );
    });
  });
});
