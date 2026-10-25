import { BadRequestException, Logger, NotFoundException } from '@nestjs/common';
import { SubscriptionsService } from './subscriptions.service';
import { BillingService } from '../payments/billing.service';

describe('SubscriptionsService', () => {
  let service: SubscriptionsService;

  const mockPrismaService = {
    subscriptionTier: {
      findUnique: jest.fn(),
      findUniqueOrThrow: jest.fn(),
      findMany: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    },
    transaction: {
      groupBy: jest.fn(),
      findUnique: jest.fn(),
    },
    subscription: {
      count: jest.fn(),
      groupBy: jest.fn(),
      findFirst: jest.fn(),
      findUnique: jest.fn(),
      findMany: jest.fn(),
      update: jest.fn(),
    },
    user: {
      findUnique: jest.fn(),
    },
  };

  const mockBilling = {
    startSubscriptionPayment: jest.fn(),
    getRenewalPrice: jest.fn(),
  };

  const mockPaymentFlow = {
    confirmPayment: jest.fn(),
  };

  const mockSubscriptionSync = {
    refreshCreatorSubscriberCount: jest.fn(),
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
    creator: { id: creatorId, username: 'creator' },
  };
  const premiumTier = { ...paidTier, id: 'tier-vip', name: 'VIP', price: 19.99 };
  const basicTier = { ...paidTier, id: 'tier-basic', name: 'Basic', price: 4.99 };
  const freeTier = { ...paidTier, id: 'tier-free', name: 'Free', price: 0 };

  const payment = (overrides: Record<string, unknown> = {}): any => ({
    status: 'requires_redirect',
    completed: false,
    transactionId: 'tx-1',
    redirectUrl: 'https://provider/pay',
    amount: 9.99,
    vatRate: 20,
    vatAmount: 2,
    totalAmount: 11.99,
    failureReason: null,
    ...overrides,
  });
  const completed = () => payment({ status: 'completed', completed: true, redirectUrl: null });

  const periodStart = new Date('2026-10-01T00:00:00Z');
  const periodEnd = new Date('2026-10-31T00:00:00Z');

  const ownSubscription = (overrides: Record<string, unknown> = {}): any => ({
    id: 'sub-1',
    subscriberId: userId,
    tierId: paidTier.id,
    tier: paidTier,
    status: 'ACTIVE',
    cancelAtPeriodEnd: false,
    pendingTierId: null,
    paymentCardId: 'card-sub',
    currentPeriodStart: periodStart,
    currentPeriodEnd: periodEnd,
    ...overrides,
  });

  beforeEach(() => {
    jest.resetAllMocks();
    jest.restoreAllMocks();
    jest.spyOn(Logger.prototype, 'log').mockImplementation();
    mockPrismaService.subscription.update.mockImplementation(async ({ where, data }: any) => ({ id: where.id, ...data }));

    service = new SubscriptionsService(
      mockPrismaService as any,
      mockBilling as any,
      mockPaymentFlow as any,
      mockSubscriptionSync as any,
    );
  });

  describe('subscribe', () => {
    it('should throw NotFoundException when the tier does not exist or is inactive', async () => {
      mockPrismaService.subscriptionTier.findUnique.mockResolvedValueOnce(null).mockResolvedValueOnce({ ...paidTier, isActive: false });

      await expect(service.subscribe(userId, { tierId: 'missing' })).rejects.toThrow(NotFoundException);
      await expect(service.subscribe(userId, { tierId: paidTier.id })).rejects.toThrow(NotFoundException);
    });

    it('should reject subscribing to your own tier', async () => {
      mockPrismaService.subscriptionTier.findUnique.mockResolvedValue(paidTier);

      await expect(service.subscribe(creatorId, { tierId: paidTier.id })).rejects.toThrow(BadRequestException);
    });

    it('should reject when already subscribed to this creator', async () => {
      mockPrismaService.subscriptionTier.findUnique.mockResolvedValue(paidTier);
      mockPrismaService.subscription.findFirst
        .mockResolvedValueOnce({ id: 'sub-1', tierId: paidTier.id, status: 'ACTIVE', cancelAtPeriodEnd: false })
        .mockResolvedValueOnce({ id: 'sub-1', tierId: paidTier.id, status: 'ACTIVE', cancelAtPeriodEnd: true })
        .mockResolvedValueOnce({ id: 'sub-2', tierId: 'tier-other', status: 'PAST_DUE', cancelAtPeriodEnd: false });

      await expect(service.subscribe(userId, { tierId: paidTier.id })).rejects.toThrow('You are already subscribed to this tier');
      await expect(service.subscribe(userId, { tierId: paidTier.id })).rejects.toThrow('resume it instead');
      await expect(service.subscribe(userId, { tierId: paidTier.id })).rejects.toThrow('another tier of this creator');
      expect(mockPrismaService.subscription.findFirst).toHaveBeenCalledWith({
        where: { subscriberId: userId, tier: { creatorId }, status: { in: ['ACTIVE', 'PAST_DUE'] } },
      });
      expect(mockBilling.startSubscriptionPayment).not.toHaveBeenCalled();
    });

    it('should activate a free tier directly, without payment', async () => {
      const subscription = { id: 'sub-free', status: 'ACTIVE' };
      mockPrismaService.subscriptionTier.findUnique.mockResolvedValue(freeTier);
      mockPrismaService.subscription.findFirst.mockResolvedValue(null);
      mockSubscriptionSync.activateFreeSubscription.mockResolvedValue(subscription);

      const result = await service.subscribe(userId, { tierId: freeTier.id });

      expect(result).toEqual({ requiresPayment: false, subscription });
      expect(mockSubscriptionSync.activateFreeSubscription).toHaveBeenCalledWith(userId, freeTier);
      expect(mockBilling.startSubscriptionPayment).not.toHaveBeenCalled();
    });

    it('should start the payment of a paid tier and return the provider page to visit', async () => {
      mockPrismaService.subscriptionTier.findUnique.mockResolvedValue(paidTier);
      mockPrismaService.subscription.findFirst.mockResolvedValue(null);
      const started = payment();
      mockBilling.startSubscriptionPayment.mockResolvedValue(started);

      const result = await service.subscribe(
        userId,
        { tierId: paidTier.id, billingCountry: 'FR', withdrawalWaiver: true },
        { ipCountry: 'FR', clientIp: '1.2.3.4' },
      );

      expect(mockBilling.startSubscriptionPayment).toHaveBeenCalledWith({
        userId,
        tier: paidTier,
        action: 'new',
        amount: 9.99,
        paymentCardId: undefined,
        billingCountry: 'FR',
        withdrawalWaiver: true,
        ipCountry: 'FR',
        clientIp: '1.2.3.4',
      });
      expect(result).toEqual({
        requiresPayment: true,
        payment: started,
        transactionId: 'tx-1',
        redirectUrl: 'https://provider/pay',
        paymentStatus: 'requires_redirect',
      });
    });

    it('should return the active subscription when a saved card was charged', async () => {
      const subscription = { id: 'sub-1', status: 'ACTIVE' };
      mockPrismaService.subscriptionTier.findUnique.mockResolvedValue(paidTier);
      mockPrismaService.subscription.findFirst.mockResolvedValue(null);
      mockBilling.startSubscriptionPayment.mockResolvedValue(completed());
      mockPrismaService.subscription.findUnique.mockResolvedValue(subscription);

      const result = await service.subscribe(userId, { tierId: paidTier.id, paymentCardId: 'card-1', withdrawalWaiver: true });

      expect(mockBilling.startSubscriptionPayment).toHaveBeenCalledWith(expect.objectContaining({ paymentCardId: 'card-1' }));
      expect(mockPrismaService.subscription.findUnique).toHaveBeenCalledWith(
        expect.objectContaining({ where: { subscriberId_tierId: { subscriberId: userId, tierId: paidTier.id } } }),
      );
      expect(result).toEqual({ requiresPayment: false, subscription, payment: expect.objectContaining({ completed: true }) });
    });

    it('should report a declined payment', async () => {
      mockPrismaService.subscriptionTier.findUnique.mockResolvedValue(paidTier);
      mockPrismaService.subscription.findFirst.mockResolvedValue(null);
      mockBilling.startSubscriptionPayment.mockResolvedValue(payment({ status: 'failed', redirectUrl: null, failureReason: 'Refusée' }));

      const result = await service.subscribe(userId, { tierId: paidTier.id, paymentCardId: 'card-1' });

      expect(result).toEqual(expect.objectContaining({ requiresPayment: true, paymentStatus: 'failed', redirectUrl: null }));
      expect(mockPrismaService.subscription.findUnique).not.toHaveBeenCalled();
    });
  });

  describe('confirmSubscription', () => {
    it('should check the payment belongs to the user and is a subscription', async () => {
      mockPaymentFlow.confirmPayment.mockRejectedValue(new NotFoundException('Payment not found'));

      await expect(service.confirmSubscription(userId, 'tx-1')).rejects.toThrow(NotFoundException);
      expect(mockPaymentFlow.confirmPayment).toHaveBeenCalledWith(userId, 'tx-1', { kind: 'subscription' });
    });

    it('should return the subscription once paid', async () => {
      const subscription = { id: 'sub-1', status: 'ACTIVE' };
      mockPaymentFlow.confirmPayment.mockResolvedValue(completed());
      mockPrismaService.transaction.findUnique.mockResolvedValue({ metadata: { kind: 'subscription', tierId: paidTier.id } });
      mockPrismaService.subscription.findUnique.mockResolvedValue(subscription);

      const result = await service.confirmSubscription(userId, 'tx-1');

      expect(result).toEqual(expect.objectContaining({ requiresPayment: false, subscription }));
      expect(mockPrismaService.subscription.findUnique).toHaveBeenCalledWith(
        expect.objectContaining({ where: { subscriberId_tierId: { subscriberId: userId, tierId: paidTier.id } } }),
      );
    });

    it('should report a payment still processing', async () => {
      mockPaymentFlow.confirmPayment.mockResolvedValue(payment({ status: 'processing', redirectUrl: null }));
      mockPrismaService.transaction.findUnique.mockResolvedValue({ metadata: { tierId: paidTier.id } });

      await expect(service.confirmSubscription(userId, 'tx-1')).resolves.toEqual(
        expect.objectContaining({ requiresPayment: true, paymentStatus: 'processing', transactionId: 'tx-1' }),
      );
    });
  });

  describe('changeTier', () => {
    const targetTier = (tier: any) => mockPrismaService.subscriptionTier.findUnique.mockResolvedValue(tier);

    it('should throw for another user subscription', async () => {
      mockPrismaService.subscription.findUnique.mockResolvedValue(ownSubscription({ subscriberId: 'someone-else' }));

      await expect(service.changeTier(userId, 'sub-1', { tierId: premiumTier.id })).rejects.toThrow(NotFoundException);
    });

    it('should reject a subscription that is not active', async () => {
      mockPrismaService.subscription.findUnique.mockResolvedValue(ownSubscription({ status: 'PAST_DUE' }));

      await expect(service.changeTier(userId, 'sub-1', { tierId: premiumTier.id })).rejects.toThrow(
        'Only an active subscription can change tier',
      );
    });

    it('should reject a tier of another creator or an inactive tier', async () => {
      mockPrismaService.subscription.findUnique.mockResolvedValue(ownSubscription());
      mockPrismaService.subscriptionTier.findUnique
        .mockResolvedValueOnce({ ...premiumTier, creatorId: 'other' })
        .mockResolvedValueOnce({ ...premiumTier, isActive: false });

      await expect(service.changeTier(userId, 'sub-1', { tierId: premiumTier.id })).rejects.toThrow('This tier belongs to another creator');
      await expect(service.changeTier(userId, 'sub-1', { tierId: premiumTier.id })).rejects.toThrow(NotFoundException);
    });

    it('should reject switching to the current tier without a scheduled change', async () => {
      mockPrismaService.subscription.findUnique.mockResolvedValue(ownSubscription());
      targetTier(paidTier);

      await expect(service.changeTier(userId, 'sub-1', { tierId: paidTier.id })).rejects.toThrow('You are already subscribed to this tier');
    });

    it('should go through the paid subscription flow for free → paid, replacing the free subscription', async () => {
      mockPrismaService.subscription.findUnique.mockResolvedValue(ownSubscription({ tierId: freeTier.id, tier: freeTier, paymentCardId: null }));
      targetTier(premiumTier);
      mockBilling.startSubscriptionPayment.mockResolvedValue(payment());

      const result = await service.changeTier(userId, 'sub-1', { tierId: premiumTier.id, withdrawalWaiver: true });

      expect(mockBilling.startSubscriptionPayment).toHaveBeenCalledWith(
        expect.objectContaining({ userId, tier: premiumTier, action: 'new', amount: 19.99, replacesSubscriptionId: 'sub-1', withdrawalWaiver: true }),
      );
      expect(result).toEqual(expect.objectContaining({ requiresPayment: true, redirectUrl: 'https://provider/pay' }));
      // The free subscription ends only once the paid one is active (payment hook)
      expect(mockPrismaService.subscription.update).not.toHaveBeenCalled();
    });

    it('should switch free → free immediately', async () => {
      const otherFree = { ...freeTier, id: 'tier-free-2' };
      mockPrismaService.subscription.findUnique.mockResolvedValue(ownSubscription({ tierId: freeTier.id, tier: freeTier }));
      targetTier(otherFree);
      mockSubscriptionSync.activateFreeSubscription.mockResolvedValue({ id: 'sub-2' });

      const result = await service.changeTier(userId, 'sub-1', { tierId: otherFree.id });

      expect(mockPrismaService.subscription.update).toHaveBeenCalledWith({
        where: { id: 'sub-1' },
        data: expect.objectContaining({ status: 'CANCELLED', cancelAtPeriodEnd: false }),
      });
      expect(mockSubscriptionSync.activateFreeSubscription).toHaveBeenCalledWith(userId, otherFree);
      expect(result).toEqual({ requiresPayment: false, subscription: { id: 'sub-2' } });
    });

    it('should schedule paid → free for the end of the period', async () => {
      mockPrismaService.subscription.findUnique.mockResolvedValue(ownSubscription());
      targetTier(freeTier);

      const result = await service.changeTier(userId, 'sub-1', { tierId: freeTier.id });

      expect(mockPrismaService.subscription.update).toHaveBeenCalledWith({
        where: { id: 'sub-1' },
        data: { pendingTierId: freeTier.id, cancelAtPeriodEnd: true },
      });
      expect(result.requiresPayment).toBe(false);
      expect(mockBilling.startSubscriptionPayment).not.toHaveBeenCalled();
      expect(mockSubscriptionSync.activateFreeSubscription).not.toHaveBeenCalled();
    });

    it('should schedule a paid → paid downgrade for the next renewal', async () => {
      mockPrismaService.subscription.findUnique.mockResolvedValue(ownSubscription({ cancelAtPeriodEnd: true, pendingTierId: freeTier.id }));
      targetTier(basicTier);

      const result = await service.changeTier(userId, 'sub-1', { tierId: basicTier.id });

      expect(mockPrismaService.subscription.update).toHaveBeenCalledWith({
        where: { id: 'sub-1' },
        data: { pendingTierId: basicTier.id, cancelAtPeriodEnd: false, cancelledAt: null },
      });
      expect(result).toEqual({ requiresPayment: false, subscription: expect.objectContaining({ pendingTierId: basicTier.id }) });
      expect(mockBilling.startSubscriptionPayment).not.toHaveBeenCalled();
    });

    it('should charge an upgrade now, prorated from the price paid for the current period', async () => {
      const subscription = { id: 'sub-1', tierId: premiumTier.id, status: 'ACTIVE' };
      mockPrismaService.subscription.findUnique.mockResolvedValueOnce(ownSubscription()).mockResolvedValueOnce(subscription);
      targetTier(premiumTier);
      mockBilling.getRenewalPrice.mockResolvedValue(7.99);
      const upgradePrice = jest.spyOn(BillingService, 'upgradePrice').mockReturnValue(15.5);
      mockBilling.startSubscriptionPayment.mockResolvedValue(completed());

      const result = await service.changeTier(userId, 'sub-1', { tierId: premiumTier.id, withdrawalWaiver: true });

      expect(mockBilling.getRenewalPrice).toHaveBeenCalledWith('sub-1', paidTier);
      expect(upgradePrice).toHaveBeenCalledWith({ currentPrice: 7.99, newPrice: 19.99, periodStart, periodEnd });
      expect(mockBilling.startSubscriptionPayment).toHaveBeenCalledWith(
        expect.objectContaining({
          userId,
          tier: premiumTier,
          action: 'upgrade',
          amount: 15.5,
          subscriptionId: 'sub-1',
          // The card of the subscription by default
          paymentCardId: 'card-sub',
          withdrawalWaiver: true,
        }),
      );
      expect(mockPrismaService.subscription.findUnique).toHaveBeenLastCalledWith(
        expect.objectContaining({ where: { subscriberId_tierId: { subscriberId: userId, tierId: premiumTier.id } } }),
      );
      expect(result).toEqual(expect.objectContaining({ requiresPayment: false, subscription }));
    });

    it('should never charge less than the provider minimum for an upgrade', async () => {
      mockPrismaService.subscription.findUnique.mockResolvedValue(ownSubscription());
      targetTier(premiumTier);
      mockBilling.getRenewalPrice.mockResolvedValue(9.99);
      jest.spyOn(BillingService, 'upgradePrice').mockReturnValue(0.1);
      mockBilling.startSubscriptionPayment.mockResolvedValue(payment());

      await service.changeTier(userId, 'sub-1', { tierId: premiumTier.id, paymentCardId: 'card-2' });

      expect(mockBilling.startSubscriptionPayment).toHaveBeenCalledWith(expect.objectContaining({ amount: 0.5, paymentCardId: 'card-2' }));
    });

    it('should treat a change of billing interval as an upgrade, even at a lower price', async () => {
      mockPrismaService.subscription.findUnique.mockResolvedValue(ownSubscription());
      targetTier({ ...basicTier, interval: 'year' });
      mockBilling.getRenewalPrice.mockResolvedValue(9.99);
      mockBilling.startSubscriptionPayment.mockResolvedValue(payment());

      await service.changeTier(userId, 'sub-1', { tierId: basicTier.id });

      expect(mockBilling.startSubscriptionPayment).toHaveBeenCalledWith(expect.objectContaining({ action: 'upgrade' }));
      expect(mockPrismaService.subscription.update).not.toHaveBeenCalled();
    });

    it('should undo a scheduled change when choosing the current tier again', async () => {
      mockPrismaService.subscription.findUnique.mockResolvedValue(ownSubscription({ pendingTierId: basicTier.id }));
      targetTier(paidTier);

      const result = await service.changeTier(userId, 'sub-1', { tierId: paidTier.id });

      expect(mockPrismaService.subscription.update).toHaveBeenCalledWith({
        where: { id: 'sub-1' },
        data: { pendingTierId: null, cancelAtPeriodEnd: false, cancelledAt: null },
      });
      expect(result.requiresPayment).toBe(false);
      expect(mockBilling.startSubscriptionPayment).not.toHaveBeenCalled();
    });
  });

  describe('cancelSubscription', () => {
    it('should throw NotFoundException for another user subscription', async () => {
      mockPrismaService.subscription.findUnique.mockResolvedValue(ownSubscription({ subscriberId: 'someone-else' }));

      await expect(service.cancelSubscription(userId, 'sub-1')).rejects.toThrow(NotFoundException);
    });

    it('should keep a paid subscription until the end of the paid period', async () => {
      mockPrismaService.subscription.findUnique.mockResolvedValue(ownSubscription());

      const result = await service.cancelSubscription(userId, 'sub-1');

      expect(mockPrismaService.subscription.update).toHaveBeenCalledWith({
        where: { id: 'sub-1' },
        data: { cancelAtPeriodEnd: true, cancelledAt: expect.any(Date), pendingTierId: null },
      });
      expect(result).toEqual(expect.objectContaining({ cancelAtPeriodEnd: true }));
      expect(mockSubscriptionSync.refreshCreatorSubscriberCount).not.toHaveBeenCalled();
    });

    it('should replace a scheduled switch to a free tier by a plain cancellation', async () => {
      mockPrismaService.subscription.findUnique.mockResolvedValue(ownSubscription({ cancelAtPeriodEnd: true, pendingTierId: freeTier.id }));

      await service.cancelSubscription(userId, 'sub-1');

      expect(mockPrismaService.subscription.update.mock.calls[0][0].data).toEqual(
        expect.objectContaining({ cancelAtPeriodEnd: true, pendingTierId: null }),
      );
    });

    it('should end a free subscription immediately', async () => {
      mockPrismaService.subscription.findUnique.mockResolvedValue(ownSubscription({ tierId: freeTier.id, tier: freeTier }));

      await service.cancelSubscription(userId, 'sub-1');

      expect(mockPrismaService.subscription.update).toHaveBeenCalledWith({
        where: { id: 'sub-1' },
        data: { status: 'CANCELLED', cancelledAt: expect.any(Date), cancelAtPeriodEnd: false, nextRenewalAttemptAt: null },
      });
      expect(mockSubscriptionSync.refreshCreatorSubscriberCount).toHaveBeenCalledWith(creatorId);
    });

    it('should end a past-due subscription immediately (no paid period left)', async () => {
      mockPrismaService.subscription.findUnique.mockResolvedValue(ownSubscription({ status: 'PAST_DUE' }));

      await service.cancelSubscription(userId, 'sub-1');

      expect(mockPrismaService.subscription.update.mock.calls[0][0].data).toEqual(
        expect.objectContaining({ status: 'CANCELLED', nextRenewalAttemptAt: null }),
      );
    });

    it('should reject cancelling twice or an ended subscription', async () => {
      mockPrismaService.subscription.findUnique
        .mockResolvedValueOnce(ownSubscription({ cancelAtPeriodEnd: true }))
        .mockResolvedValueOnce(ownSubscription({ status: 'CANCELLED' }));

      await expect(service.cancelSubscription(userId, 'sub-1')).rejects.toThrow('already scheduled for cancellation');
      await expect(service.cancelSubscription(userId, 'sub-1')).rejects.toThrow('Subscription is not active');
      expect(mockPrismaService.subscription.update).not.toHaveBeenCalled();
    });
  });

  describe('resumeSubscription', () => {
    it('should undo a scheduled cancellation (and a scheduled switch to a free tier)', async () => {
      mockPrismaService.subscription.findUnique.mockResolvedValue(ownSubscription({ cancelAtPeriodEnd: true, pendingTierId: freeTier.id }));

      const result = await service.resumeSubscription(userId, 'sub-1');

      expect(mockPrismaService.subscription.update).toHaveBeenCalledWith({
        where: { id: 'sub-1' },
        data: { cancelAtPeriodEnd: false, cancelledAt: null, pendingTierId: null },
      });
      expect(result).toEqual({ requiresPayment: false, subscription: expect.objectContaining({ cancelAtPeriodEnd: false }) });
    });

    it('should reject resuming an active subscription that is not cancelled, or a past-due one', async () => {
      mockPrismaService.subscription.findUnique
        .mockResolvedValueOnce(ownSubscription())
        .mockResolvedValueOnce(ownSubscription({ status: 'PAST_DUE' }));

      await expect(service.resumeSubscription(userId, 'sub-1')).rejects.toThrow('not scheduled for cancellation');
      await expect(service.resumeSubscription(userId, 'sub-1')).rejects.toThrow('update your payment method');
    });

    it('should subscribe again to the same tier once the subscription has ended', async () => {
      mockPrismaService.subscription.findUnique.mockResolvedValue(ownSubscription({ status: 'CANCELLED' }));
      mockPrismaService.subscriptionTier.findUnique.mockResolvedValue(paidTier);
      mockPrismaService.subscription.findFirst.mockResolvedValue(null);
      mockBilling.startSubscriptionPayment.mockResolvedValue(payment());

      const result = await service.resumeSubscription(
        userId,
        'sub-1',
        { paymentCardId: 'card-1', billingCountry: 'BE', withdrawalWaiver: true },
        { ipCountry: 'BE' },
      );

      expect(mockBilling.startSubscriptionPayment).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'new', tier: paidTier, paymentCardId: 'card-1', billingCountry: 'BE', withdrawalWaiver: true, ipCountry: 'BE' }),
      );
      expect(result.requiresPayment).toBe(true);
    });
  });

  describe('retryPayment', () => {
    const pastDue = (overrides: Record<string, unknown> = {}) => ownSubscription({ status: 'PAST_DUE', ...overrides });

    it('should reject a subscription that is not past due', async () => {
      for (const status of ['ACTIVE', 'CANCELLED']) {
        mockPrismaService.subscription.findUnique.mockResolvedValue(ownSubscription({ status }));
        await expect(service.retryPayment(userId, 'sub-1')).rejects.toThrow('Only a past-due subscription can be paid again');
      }
      expect(mockBilling.startSubscriptionPayment).not.toHaveBeenCalled();
    });

    it('should pay the renewal price now with the subscription card', async () => {
      mockPrismaService.subscription.findUnique.mockResolvedValueOnce(pastDue()).mockResolvedValueOnce({ id: 'sub-1', status: 'ACTIVE' });
      mockPrismaService.subscriptionTier.findUniqueOrThrow.mockResolvedValue(paidTier);
      mockBilling.getRenewalPrice.mockResolvedValue(8.99);
      mockBilling.startSubscriptionPayment.mockResolvedValue(completed());

      const result = await service.retryPayment(userId, 'sub-1', { withdrawalWaiver: true });

      expect(mockBilling.getRenewalPrice).toHaveBeenCalledWith('sub-1', paidTier);
      expect(mockBilling.startSubscriptionPayment).toHaveBeenCalledWith(
        expect.objectContaining({ tier: paidTier, action: 'retry', amount: 8.99, subscriptionId: 'sub-1', paymentCardId: 'card-sub' }),
      );
      expect(result).toEqual(expect.objectContaining({ requiresPayment: false, subscription: { id: 'sub-1', status: 'ACTIVE' } }));
    });

    it('should pay with another saved card, or on the provider page', async () => {
      mockPrismaService.subscription.findUnique.mockResolvedValue(pastDue({ paymentCardId: null }));
      mockPrismaService.subscriptionTier.findUniqueOrThrow.mockResolvedValue(paidTier);
      mockBilling.getRenewalPrice.mockResolvedValue(9.99);
      mockBilling.startSubscriptionPayment.mockResolvedValue(payment());

      await service.retryPayment(userId, 'sub-1', { paymentCardId: 'card-new' });
      await service.retryPayment(userId, 'sub-1');

      expect(mockBilling.startSubscriptionPayment.mock.calls[0][0].paymentCardId).toBe('card-new');
      expect(mockBilling.startSubscriptionPayment.mock.calls[1][0].paymentCardId).toBeUndefined();
    });

    it('should bill the tier of a scheduled downgrade', async () => {
      mockPrismaService.subscription.findUnique.mockResolvedValue(pastDue({ pendingTierId: basicTier.id }));
      mockPrismaService.subscriptionTier.findUnique.mockResolvedValue(basicTier);
      mockBilling.startSubscriptionPayment.mockResolvedValue(payment());

      await service.retryPayment(userId, 'sub-1');

      expect(mockBilling.startSubscriptionPayment).toHaveBeenCalledWith(expect.objectContaining({ tier: basicTier, amount: 4.99 }));
      expect(mockBilling.getRenewalPrice).not.toHaveBeenCalled();
    });
  });

  describe('getSubscriptionStatus', () => {
    it('should prefer the live subscription over ended ones', async () => {
      const active = { id: 'sub-2', status: 'ACTIVE' };
      mockPrismaService.subscription.findMany.mockResolvedValue([{ id: 'sub-1', status: 'CANCELLED' }, active]);

      const result = await service.getSubscriptionStatus(userId, creatorId);

      expect(result).toEqual({ isSubscribed: true, subscription: active });
      expect(mockPrismaService.subscription.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { subscriberId: userId, tier: { creatorId } } }),
      );
    });

    it('should report a past-due subscription as not subscribed', async () => {
      mockPrismaService.subscription.findMany.mockResolvedValue([{ id: 'sub-1', status: 'PAST_DUE' }]);

      await expect(service.getSubscriptionStatus(userId, creatorId)).resolves.toEqual({
        isSubscribed: false,
        subscription: { id: 'sub-1', status: 'PAST_DUE' },
      });
    });

    it('should report not subscribed when there is no subscription', async () => {
      mockPrismaService.subscription.findMany.mockResolvedValue([]);

      await expect(service.getSubscriptionStatus(userId, creatorId)).resolves.toEqual({ isSubscribed: false, subscription: null });
    });
  });

  describe('tier management', () => {
    it('getMyTiers returns counts, monthly revenue and deletability per tier', async () => {
      mockPrismaService.user.findUnique.mockResolvedValue({ role: 'CREATOR' });
      mockPrismaService.subscriptionTier.findMany.mockResolvedValue([
        { id: 'tier-month', price: 10, interval: 'month' },
        { id: 'tier-year', price: 120, interval: 'year' },
        { id: 'tier-new', price: 5, interval: 'month' },
      ]);
      mockPrismaService.subscription.groupBy.mockResolvedValue([
        { tierId: 'tier-month', status: 'ACTIVE', _count: { _all: 3 } },
        { tierId: 'tier-month', status: 'CANCELLED', _count: { _all: 2 } },
        { tierId: 'tier-year', status: 'ACTIVE', _count: { _all: 2 } },
      ]);

      const tiers = await service.getMyTiers(creatorId);

      expect(tiers).toEqual([
        expect.objectContaining({ id: 'tier-month', subscribersCount: 3, totalSubscriptionsCount: 5, monthlyRevenue: 30, canDelete: false }),
        expect.objectContaining({ id: 'tier-year', subscribersCount: 2, totalSubscriptionsCount: 2, monthlyRevenue: 20, canDelete: false }),
        expect.objectContaining({ id: 'tier-new', subscribersCount: 0, totalSubscriptionsCount: 0, monthlyRevenue: 0, canDelete: true }),
      ]);
    });

    it('deleteTier refuses a tier with active subscribers', async () => {
      mockPrismaService.subscriptionTier.findUnique.mockResolvedValue({ id: 'tier-1', creatorId, name: 'Premium' });
      mockPrismaService.subscription.count.mockResolvedValueOnce(2);

      await expect(service.deleteTier(creatorId, 'tier-1')).rejects.toThrow(/2 abonné\(s\) actif\(s\)/);
      expect(mockPrismaService.subscriptionTier.delete).not.toHaveBeenCalled();
    });

    it('deleteTier refuses a tier referenced by past subscriptions', async () => {
      mockPrismaService.subscriptionTier.findUnique.mockResolvedValue({ id: 'tier-1', creatorId, name: 'Premium' });
      mockPrismaService.subscription.count.mockResolvedValueOnce(0).mockResolvedValueOnce(4);

      await expect(service.deleteTier(creatorId, 'tier-1')).rejects.toThrow(BadRequestException);
      expect(mockPrismaService.subscriptionTier.delete).not.toHaveBeenCalled();
    });

    it('deleteTier deletes an unused tier', async () => {
      mockPrismaService.subscriptionTier.findUnique.mockResolvedValue({ id: 'tier-1', creatorId, name: 'Ancienne offre' });
      mockPrismaService.subscription.count.mockResolvedValue(0);

      await service.deleteTier(creatorId, 'tier-1');

      expect(mockPrismaService.subscriptionTier.delete).toHaveBeenCalledWith({ where: { id: 'tier-1' } });
    });

    it("deleteTier refuses another creator's tier", async () => {
      mockPrismaService.subscriptionTier.findUnique.mockResolvedValue({ id: 'tier-1', creatorId: 'other' });

      await expect(service.deleteTier(creatorId, 'tier-1')).rejects.toThrow('Vous ne pouvez supprimer que vos propres offres');
    });
  });

  describe('getCreatorSubscribers', () => {
    it("returns every subscription with the subscriber's total spent on the creator", async () => {
      mockPrismaService.subscription.findMany.mockResolvedValue([
        { id: 'sub-1', subscriberId: 'fan-1', status: 'ACTIVE' },
        { id: 'sub-2', subscriberId: 'fan-2', status: 'CANCELLED' },
      ]);
      mockPrismaService.transaction.groupBy.mockResolvedValue([{ fromUserId: 'fan-1', _sum: { amount: 29.97 } }]);

      const result = await service.getCreatorSubscribers(creatorId);

      expect(mockPrismaService.subscription.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { tier: { creatorId } } }));
      expect(mockPrismaService.transaction.groupBy).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { toUserId: creatorId, fromUserId: { in: ['fan-1', 'fan-2'] }, status: 'COMPLETED' },
        }),
      );
      expect(result).toEqual([
        expect.objectContaining({ id: 'sub-1', totalSpent: 29.97 }),
        expect.objectContaining({ id: 'sub-2', totalSpent: 0 }),
      ]);
    });

    it('filters on a status', async () => {
      mockPrismaService.subscription.findMany.mockResolvedValue([]);

      await expect(service.getCreatorSubscribers(creatorId, 'ACTIVE')).resolves.toEqual([]);
      expect(mockPrismaService.subscription.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { tier: { creatorId }, status: 'ACTIVE' } }),
      );
      expect(mockPrismaService.transaction.groupBy).not.toHaveBeenCalled();
    });
  });
});
