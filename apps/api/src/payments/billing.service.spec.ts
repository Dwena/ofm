import { Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { BillingService, RENEWAL_RETRY_DELAYS_DAYS } from './billing.service';
import { PaymentKindHandler } from './payment-flow.service';
import { addInterval } from './subscription-sync.service';

const DAY = 24 * 60 * 60 * 1000;

describe('BillingService', () => {
  let service: BillingService;
  let prisma: any;
  let paymentFlow: { registerHandler: jest.Mock; startPayment: jest.Mock; findRenewalCard: jest.Mock };
  let subscriptionSync: {
    releaseTierSlot: jest.Mock;
    refreshCreatorSubscriberCount: jest.Mock;
    notifyNewSubscriber: jest.Mock;
    activatePendingFreeTier: jest.Mock;
  };
  let handler: PaymentKindHandler;

  const paidTier = { id: 'tier-paid', creatorId: 'creator-1', name: 'Premium', price: new Prisma.Decimal('9.99'), interval: 'month', isActive: true };
  const premiumTier = { ...paidTier, id: 'tier-premium', name: 'VIP', price: new Prisma.Decimal('19.99') };
  const basicTier = { ...paidTier, id: 'tier-basic', name: 'Basic', price: new Prisma.Decimal('4.99') };
  const freeTier = { ...paidTier, id: 'tier-free', name: 'Free', price: new Prisma.Decimal('0') };
  const creator = { role: 'CREATOR', kycStatus: 'VERIFIED', status: 'ACTIVE', deletedAt: null, username: 'alice' };

  beforeEach(() => {
    jest.spyOn(Logger.prototype, 'log').mockImplementation();
    jest.spyOn(Logger.prototype, 'error').mockImplementation();

    prisma = {
      subscriptionTier: { findUnique: jest.fn() },
      subscription: {
        upsert: jest.fn(async () => ({ id: 'sub-new' })),
        updateMany: jest.fn(async () => ({ count: 1 })),
        findUnique: jest.fn(),
        findMany: jest.fn(),
        update: jest.fn(),
      },
      transaction: { update: jest.fn(), findFirst: jest.fn(async () => null) },
      user: {
        findUnique: jest.fn(async ({ where }: any) => (where.id === 'creator-1' ? creator : { status: 'ACTIVE', deletedAt: null })),
      },
      notification: { create: jest.fn() },
    };

    paymentFlow = {
      registerHandler: jest.fn(),
      startPayment: jest.fn(async () => ({ status: 'completed', completed: true, transactionId: 'tx-1', redirectUrl: null })),
      findRenewalCard: jest.fn(async () => ({ id: 'card-1' })),
    };
    subscriptionSync = {
      releaseTierSlot: jest.fn(async () => true),
      refreshCreatorSubscriberCount: jest.fn(),
      notifyNewSubscriber: jest.fn(),
      activatePendingFreeTier: jest.fn(),
    };

    service = new BillingService(prisma, paymentFlow as any, subscriptionSync as any);
    service.onModuleInit();
    handler = paymentFlow.registerHandler.mock.calls[0][1];
  });

  afterEach(() => jest.restoreAllMocks());

  it('registers itself as the handler of subscription payments', () => {
    expect(paymentFlow.registerHandler).toHaveBeenCalledWith('subscription', expect.any(Object));
  });

  describe('upgradePrice', () => {
    const periodStart = new Date('2026-10-01T00:00:00Z');
    const periodEnd = new Date('2026-10-31T00:00:00Z');

    it('charges the new price minus the unused part of the current period', () => {
      const now = new Date('2026-10-16T00:00:00Z');
      expect(BillingService.upgradePrice({ currentPrice: 10, newPrice: 20, periodStart, periodEnd, now })).toBe(15);
      expect(BillingService.upgradePrice({ currentPrice: 12, newPrice: 30, periodStart, periodEnd, now })).toBe(24);
    });

    it('charges the full new price once the period is over, and never a negative amount', () => {
      expect(BillingService.upgradePrice({ currentPrice: 10, newPrice: 20, periodStart, periodEnd, now: new Date('2026-11-05T00:00:00Z') })).toBe(20);
      expect(BillingService.upgradePrice({ currentPrice: 30, newPrice: 20, periodStart, periodEnd, now: periodStart })).toBe(0);
      expect(BillingService.upgradePrice({ currentPrice: 10, newPrice: 20, periodStart, periodEnd: periodStart, now: periodStart })).toBe(20);
    });
  });

  it('starts a subscription payment with its metadata', async () => {
    await service.startSubscriptionPayment({
      userId: 'fan-1',
      tier: { ...paidTier, creator: { username: 'alice' } },
      action: 'new',
      amount: 9.99,
      replacesSubscriptionId: 'sub-free',
      paymentCardId: 'card-1',
      billingCountry: 'FR',
      withdrawalWaiver: true,
    });

    expect(paymentFlow.startPayment).toHaveBeenCalledWith(
      expect.objectContaining({
        payerId: 'fan-1',
        creatorId: 'creator-1',
        kind: 'subscription',
        amount: 9.99,
        paymentCardId: 'card-1',
        billingCountry: 'FR',
        withdrawalWaiver: true,
        description: 'Abonnement Premium – @alice',
        returnPath: '/alice',
        metadata: expect.objectContaining({ action: 'new', tierId: 'tier-paid', interval: 'month', replacesSubscriptionId: 'sub-free' }),
      }),
    );
  });

  describe('getRenewalPrice', () => {
    it('renews at the price last paid for the tier', async () => {
      prisma.transaction.findFirst.mockResolvedValue({ amount: new Prisma.Decimal('7.99'), metadata: { action: 'renewal' } });

      await expect(service.getRenewalPrice('sub-1', paidTier)).resolves.toBe(7.99);
      expect(prisma.transaction.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ subscriptionId: 'sub-1', metadata: { path: ['tierId'], equals: 'tier-paid' } }),
        }),
      );
    });

    it('uses the tier price after a prorated upgrade or without any payment', async () => {
      prisma.transaction.findFirst.mockResolvedValueOnce({ amount: new Prisma.Decimal('3.2'), metadata: { action: 'upgrade' } });
      await expect(service.getRenewalPrice('sub-1', paidTier)).resolves.toBe(9.99);

      await expect(service.getRenewalPrice('sub-1', paidTier)).resolves.toBe(9.99);
    });
  });

  describe('payment hooks', () => {
    const transaction = (overrides: Record<string, unknown> = {}): any => ({
      id: 'tx-1',
      fromUserId: 'fan-1',
      toUserId: 'creator-1',
      subscriptionId: null,
      paymentCardId: 'card-1',
      totalAmount: new Prisma.Decimal('11.99'),
      ...overrides,
    });

    it("'new' opens an ACTIVE subscription and ends the free one it replaces", async () => {
      prisma.subscriptionTier.findUnique.mockResolvedValue(paidTier);
      const before = new Date();

      await handler.onCompleted(prisma, transaction(), { action: 'new', tierId: 'tier-paid', replacesSubscriptionId: 'sub-free' });

      const upsert = prisma.subscription.upsert.mock.calls[0][0];
      expect(upsert.where).toEqual({ subscriberId_tierId: { subscriberId: 'fan-1', tierId: 'tier-paid' } });
      expect(upsert.create).toEqual(
        expect.objectContaining({ subscriberId: 'fan-1', tierId: 'tier-paid', status: 'ACTIVE', paymentCardId: 'card-1', cancelAtPeriodEnd: false }),
      );
      expect(upsert.update).toEqual(expect.objectContaining({ status: 'ACTIVE', renewalAttempts: 0, pendingTierId: null }));
      expect(upsert.create.currentPeriodStart.getTime()).toBeGreaterThanOrEqual(before.getTime());
      expect(upsert.create.currentPeriodEnd).toEqual(addInterval(upsert.create.currentPeriodStart, 'month'));

      expect(prisma.subscription.updateMany).toHaveBeenCalledWith({
        where: { id: 'sub-free', subscriberId: 'fan-1', status: 'ACTIVE' },
        data: expect.objectContaining({ status: 'CANCELLED', cancelAtPeriodEnd: false }),
      });
      expect(prisma.transaction.update).toHaveBeenCalledWith({ where: { id: 'tx-1' }, data: { subscriptionId: 'sub-new' } });
    });

    it("'renewal' extends the subscription from the end of the paid period", async () => {
      const periodEnd = new Date(Date.now() - 60 * 60 * 1000);
      prisma.subscriptionTier.findUnique.mockResolvedValue(paidTier);
      prisma.subscription.findUnique.mockResolvedValue({
        id: 'sub-1',
        subscriberId: 'fan-1',
        tierId: 'tier-paid',
        status: 'ACTIVE',
        currentPeriodEnd: periodEnd,
      });

      await handler.onCompleted(prisma, transaction({ subscriptionId: 'sub-1' }), { action: 'renewal', tierId: 'tier-paid', subscriptionId: 'sub-1' });

      expect(subscriptionSync.releaseTierSlot).not.toHaveBeenCalled();
      expect(prisma.subscription.update).toHaveBeenCalledWith({
        where: { id: 'sub-1' },
        data: expect.objectContaining({
          tierId: 'tier-paid',
          status: 'ACTIVE',
          renewalAttempts: 0,
          nextRenewalAttemptAt: null,
          currentPeriodStart: periodEnd,
          currentPeriodEnd: addInterval(periodEnd, 'month'),
          paymentCardId: 'card-1',
        }),
      });
      expect(prisma.transaction.update).not.toHaveBeenCalled();
    });

    it('a late payment of a past-due subscription starts a new period now', async () => {
      prisma.subscriptionTier.findUnique.mockResolvedValue(paidTier);
      prisma.subscription.findUnique.mockResolvedValue({
        id: 'sub-1',
        subscriberId: 'fan-1',
        tierId: 'tier-paid',
        status: 'PAST_DUE',
        currentPeriodEnd: new Date(Date.now() - 3 * DAY),
      });
      const before = Date.now();

      await handler.onCompleted(prisma, transaction({ subscriptionId: 'sub-1' }), { action: 'retry', tierId: 'tier-paid', subscriptionId: 'sub-1' });

      const data = prisma.subscription.update.mock.calls[0][0].data;
      expect(data.status).toBe('ACTIVE');
      expect(data.currentPeriodStart.getTime()).toBeGreaterThanOrEqual(before);
    });

    it("'upgrade' moves the subscription to the new tier with a new period", async () => {
      prisma.subscriptionTier.findUnique.mockResolvedValue(premiumTier);
      prisma.subscription.findUnique.mockResolvedValue({
        id: 'sub-1',
        subscriberId: 'fan-1',
        tierId: 'tier-paid',
        status: 'ACTIVE',
        currentPeriodEnd: new Date(Date.now() + 10 * DAY),
      });
      const before = Date.now();

      await handler.onCompleted(prisma, transaction({ subscriptionId: 'sub-1' }), { action: 'upgrade', tierId: 'tier-premium', subscriptionId: 'sub-1' });

      expect(subscriptionSync.releaseTierSlot).toHaveBeenCalledWith('fan-1', 'tier-premium', 'sub-1', prisma);
      const data = prisma.subscription.update.mock.calls[0][0].data;
      expect(data).toEqual(expect.objectContaining({ tierId: 'tier-premium', pendingTierId: null, status: 'ACTIVE' }));
      expect(data.currentPeriodStart.getTime()).toBeGreaterThanOrEqual(before);
    });

    it('does nothing without a valid tier', async () => {
      prisma.subscriptionTier.findUnique.mockResolvedValue(null);

      await handler.onCompleted(prisma, transaction(), { action: 'new', tierId: 'tier-gone' });

      expect(prisma.subscription.upsert).not.toHaveBeenCalled();
      expect(prisma.subscription.update).not.toHaveBeenCalled();
    });

    it('welcomes a new subscriber and confirms a renewal after commit', async () => {
      prisma.subscriptionTier.findUnique.mockResolvedValue({ name: 'Premium' });

      await handler.afterCompleted!(transaction(), { action: 'new', tierId: 'tier-paid' });
      expect(subscriptionSync.refreshCreatorSubscriberCount).toHaveBeenCalledWith('creator-1');
      expect(subscriptionSync.notifyNewSubscriber).toHaveBeenCalledWith('creator-1', 'fan-1', 'Premium');
      expect(prisma.notification.create).not.toHaveBeenCalled();

      await handler.afterCompleted!(transaction(), { action: 'renewal', tierId: 'tier-paid' });
      expect(prisma.notification.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ userId: 'fan-1', type: 'SUBSCRIPTION_RENEWAL', message: expect.stringContaining('11.99€ TTC') }),
      });
    });

    describe('failed renewal', () => {
      const failed = (attempts: number) => {
        prisma.subscription.findUnique.mockResolvedValue({
          id: 'sub-1',
          subscriberId: 'fan-1',
          status: attempts ? 'PAST_DUE' : 'ACTIVE',
          renewalAttempts: attempts,
          tier: paidTier,
        });
        return handler.onFailed!(transaction({ subscriptionId: 'sub-1' }), { action: 'renewal', initiator: 'merchant', subscriptionId: 'sub-1' }, 'Carte refusée');
      };

      it('puts the subscription PAST_DUE and schedules the next retry', async () => {
        for (let attempts = 0; attempts < RENEWAL_RETRY_DELAYS_DAYS.length; attempts++) {
          prisma.subscription.update.mockClear();
          const before = Date.now();

          await failed(attempts);

          const data = prisma.subscription.update.mock.calls[0][0].data;
          expect(data).toEqual(expect.objectContaining({ status: 'PAST_DUE', renewalAttempts: attempts + 1 }));
          expect(data.nextRenewalAttemptAt.getTime()).toBeGreaterThanOrEqual(before + RENEWAL_RETRY_DELAYS_DAYS[attempts] * DAY);
          expect(data.nextRenewalAttemptAt.getTime()).toBeLessThanOrEqual(Date.now() + RENEWAL_RETRY_DELAYS_DAYS[attempts] * DAY);
        }
        expect(prisma.notification.create).toHaveBeenLastCalledWith({
          data: expect.objectContaining({ userId: 'fan-1', title: 'Échec du renouvellement' }),
        });
      });

      it('cancels the subscription after the last retry', async () => {
        await failed(RENEWAL_RETRY_DELAYS_DAYS.length);

        expect(prisma.subscription.update).toHaveBeenCalledWith({
          where: { id: 'sub-1' },
          data: expect.objectContaining({ status: 'CANCELLED', renewalAttempts: RENEWAL_RETRY_DELAYS_DAYS.length + 1, nextRenewalAttemptAt: null }),
        });
        expect(subscriptionSync.refreshCreatorSubscriberCount).toHaveBeenCalledWith('creator-1');
        expect(prisma.notification.create).toHaveBeenCalledWith({ data: expect.objectContaining({ title: 'Abonnement annulé' }) });
      });

      it('ignores failures of payments made by the fan and of ended subscriptions', async () => {
        await handler.onFailed!(transaction(), { action: 'new', initiator: 'customer' }, 'x');
        await handler.onFailed!(transaction(), { action: 'retry', initiator: 'customer', subscriptionId: 'sub-1' }, 'x');
        prisma.subscription.findUnique.mockResolvedValue({ id: 'sub-1', status: 'CANCELLED', renewalAttempts: 0, tier: paidTier });
        await handler.onFailed!(transaction(), { action: 'renewal', initiator: 'merchant', subscriptionId: 'sub-1' }, 'x');

        expect(prisma.subscription.update).not.toHaveBeenCalled();
      });
    });
  });

  describe('processSubscriptionRenewals', () => {
    const due = (overrides: Record<string, unknown> = {}): any => ({
      id: 'sub-1',
      subscriberId: 'fan-1',
      tierId: 'tier-paid',
      tier: paidTier,
      pendingTierId: null,
      pendingTier: null,
      status: 'ACTIVE',
      cancelAtPeriodEnd: false,
      cancelledAt: null,
      paymentCardId: 'card-sub',
      currentPeriodEnd: new Date(Date.now() - 60 * 1000),
      nextRenewalAttemptAt: null,
      renewalAttempts: 0,
      ...overrides,
    });

    const run = (...subscriptions: any[]) => {
      prisma.subscription.findMany.mockResolvedValue(subscriptions);
      return service.processSubscriptionRenewals();
    };

    it('claims each subscription before processing it', async () => {
      const subscription = due();
      await run(subscription);

      expect(prisma.subscription.updateMany).toHaveBeenCalledWith({
        where: expect.objectContaining({ id: 'sub-1', status: 'ACTIVE', currentPeriodEnd: subscription.currentPeriodEnd }),
        data: { nextRenewalAttemptAt: expect.any(Date) },
      });
    });

    it('skips a subscription claimed by another instance (never charged twice)', async () => {
      prisma.subscription.updateMany.mockResolvedValue({ count: 0 });

      await expect(run(due())).resolves.toEqual({ renewed: 0, ended: 0, failed: 0 });
      expect(paymentFlow.startPayment).not.toHaveBeenCalled();
      expect(prisma.subscription.update).not.toHaveBeenCalled();
    });

    it('ends a subscription cancelled at period end', async () => {
      await expect(run(due({ cancelAtPeriodEnd: true }))).resolves.toEqual({ renewed: 0, ended: 1, failed: 0 });

      expect(prisma.subscription.update).toHaveBeenCalledWith({
        where: { id: 'sub-1' },
        data: expect.objectContaining({ status: 'CANCELLED', cancelAtPeriodEnd: false, pendingTierId: null }),
      });
      expect(paymentFlow.startPayment).not.toHaveBeenCalled();
      expect(subscriptionSync.activatePendingFreeTier).not.toHaveBeenCalled();
    });

    it('ends a paid subscription switching to a free tier and activates the free tier', async () => {
      await run(due({ cancelAtPeriodEnd: true, pendingTierId: 'tier-free', pendingTier: freeTier }));

      expect(prisma.subscription.update.mock.calls[0][0].data.status).toBe('CANCELLED');
      expect(subscriptionSync.activatePendingFreeTier).toHaveBeenCalledWith('fan-1', 'tier-free');
    });

    it('rolls a free subscription over', async () => {
      await expect(run(due({ tierId: 'tier-free', tier: freeTier }))).resolves.toEqual({ renewed: 1, ended: 0, failed: 0 });

      const data = prisma.subscription.update.mock.calls[0][0].data;
      expect(data.currentPeriodEnd).toEqual(addInterval(data.currentPeriodStart, 'month'));
      expect(data.nextRenewalAttemptAt).toBeNull();
      expect(paymentFlow.startPayment).not.toHaveBeenCalled();
    });

    it('stops billing when the creator can no longer sell', async () => {
      prisma.user.findUnique.mockImplementation(async ({ where }: any) =>
        where.id === 'creator-1' ? { ...creator, kycStatus: 'REJECTED' } : { status: 'ACTIVE', deletedAt: null },
      );

      await expect(run(due())).resolves.toEqual({ renewed: 0, ended: 1, failed: 0 });
      expect(prisma.subscription.update).toHaveBeenCalledWith({
        where: { id: 'sub-1' },
        data: expect.objectContaining({ status: 'CANCELLED' }),
      });
      expect(paymentFlow.startPayment).not.toHaveBeenCalled();
    });

    it('stops billing a banned fan', async () => {
      prisma.user.findUnique.mockImplementation(async ({ where }: any) => (where.id === 'creator-1' ? creator : { status: 'BANNED', deletedAt: null }));

      await expect(run(due())).resolves.toEqual({ renewed: 0, ended: 1, failed: 0 });
      expect(paymentFlow.startPayment).not.toHaveBeenCalled();
    });

    it('renews a paid subscription at its renewal price with the subscription card', async () => {
      prisma.transaction.findFirst.mockResolvedValue({ amount: new Prisma.Decimal('7.99'), metadata: { action: 'new' } });

      await expect(run(due())).resolves.toEqual({ renewed: 1, ended: 0, failed: 0 });

      expect(paymentFlow.findRenewalCard).toHaveBeenCalledWith('fan-1', 'card-sub');
      expect(paymentFlow.startPayment).toHaveBeenCalledWith(
        expect.objectContaining({
          payerId: 'fan-1',
          creatorId: 'creator-1',
          kind: 'subscription',
          amount: 7.99,
          subscriptionId: 'sub-1',
          paymentCardId: 'card-1',
          initiator: 'merchant',
          metadata: expect.objectContaining({ action: 'renewal', tierId: 'tier-paid', subscriptionId: 'sub-1' }),
        }),
      );
    });

    it('applies a scheduled downgrade at the renewal, at the price of the new tier', async () => {
      await run(due({ pendingTierId: 'tier-basic', pendingTier: basicTier }));

      expect(paymentFlow.startPayment).toHaveBeenCalledWith(
        expect.objectContaining({ amount: 4.99, metadata: expect.objectContaining({ action: 'renewal', tierId: 'tier-basic' }) }),
      );
      expect(prisma.transaction.findFirst).not.toHaveBeenCalled();
    });

    it('retries a past-due subscription when due', async () => {
      await run(due({ status: 'PAST_DUE', renewalAttempts: 1, nextRenewalAttemptAt: new Date(Date.now() - 1000) }));

      expect(prisma.subscription.updateMany.mock.calls[0][0].where.status).toBe('PAST_DUE');
      expect(paymentFlow.startPayment).toHaveBeenCalled();
    });

    it('counts failed renewals and keeps a pending charge from being charged again', async () => {
      paymentFlow.startPayment
        .mockResolvedValueOnce({ status: 'failed', completed: false })
        .mockResolvedValueOnce({ status: 'processing', completed: false })
        .mockRejectedValueOnce(new Error('boom'));

      await expect(run(due({ id: 'sub-1' }), due({ id: 'sub-2' }), due({ id: 'sub-3' }))).resolves.toEqual({ renewed: 0, ended: 0, failed: 2 });

      const before = Date.now();
      expect(prisma.subscription.update).toHaveBeenCalledTimes(1);
      const { where, data } = prisma.subscription.update.mock.calls[0][0];
      expect(where).toEqual({ id: 'sub-2' });
      expect(data.nextRenewalAttemptAt.getTime()).toBeGreaterThan(before + DAY - 60 * 1000);
    });
  });

  it('cancels hosted checkouts abandoned for a day', async () => {
    prisma.transaction.updateMany = jest.fn(async () => ({ count: 2 }));

    await expect(service.cancelAbandonedPayments()).resolves.toEqual({ cancelledCount: 2 });
    expect(prisma.transaction.updateMany).toHaveBeenCalledWith({
      where: expect.objectContaining({ status: 'PENDING', type: { in: ['SUBSCRIPTION', 'TIP', 'PPV_UNLOCK'] } }),
      data: { status: 'CANCELLED', failureReason: 'Paiement abandonné' },
    });
  });

  it('sends the annual renewal notice (L215-1) by notification and dedicated email', async () => {
    const mail = { sendMail: jest.fn(async () => true) };
    service = new BillingService(prisma, paymentFlow as any, subscriptionSync as any, mail as any);
    prisma.subscription.findMany.mockResolvedValue([
      {
        id: 'sub-year',
        subscriberId: 'fan-1',
        currentPeriodEnd: new Date('2026-12-01T10:00:00Z'),
        tier: { id: 'tier-year', name: 'Annuel', price: 99, interval: 'year', creator: { username: 'alice', displayName: 'Alice' } },
        subscriber: { id: 'fan-1', email: 'fan@example.com', username: 'fan', displayName: null, deletedAt: null },
      },
    ]);

    await expect(service.sendAnnualRenewalReminders()).resolves.toEqual({ sent: 1 });

    expect(prisma.subscription.findMany.mock.calls[0][0].where).toEqual(
      expect.objectContaining({ status: 'ACTIVE', cancelAtPeriodEnd: false, tier: { interval: 'year', price: { gt: 0 } } }),
    );
    expect(prisma.notification.create.mock.calls[0][0].data.message).toMatch(/renouvelé automatiquement le 01\/12\/2026 pour 99\.00 € HT/);
    expect(mail.sendMail).toHaveBeenCalledWith(expect.objectContaining({ to: 'fan@example.com' }));
  });
});
