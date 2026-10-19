import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { BadRequestException, ServiceUnavailableException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PaymentsService } from './payments.service';
import { StripeService } from './stripe.service';
import { StripeWebhookService } from './stripe-webhook.service';
import { SettingsService } from '../settings/settings.service';
import { OneTimePaymentService } from './one-time-payment.service';
import { SubscriptionSyncService } from './subscription-sync.service';
import { PrismaService } from '../common/database/prisma.service';
import { StatsInterval } from './dto/payments.dto';

const config = (values: Record<string, string> = {}) => ({
  get: jest.fn((key: string, fallback?: string) => values[key] ?? fallback),
});

describe('PaymentsService (money units)', () => {
  let service: PaymentsService;

  const mockPrismaService = {
    user: { findUnique: jest.fn(), update: jest.fn() },
    transaction: { aggregate: jest.fn(), findMany: jest.fn(), count: jest.fn() },
    payout: { aggregate: jest.fn(), create: jest.fn(), findMany: jest.fn() },
    liveStream: { findUnique: jest.fn() },
  };

  const mockStripeService = {
    isConfigured: jest.fn(() => true),
    getAccountBalance: jest.fn(),
    createPayout: jest.fn(),
    getAccount: jest.fn(),
    createConnectAccount: jest.fn(),
  };

  const mockOneTimePayments = {
    startPayment: jest.fn(),
    confirmPayment: jest.fn(),
    getOrCreateCustomerId: jest.fn(),
  };

  const creatorUser = { id: 'creator-1', role: 'CREATOR', stripeAccountId: 'acct_1', stripeOnboarded: true };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PaymentsService,
        { provide: PrismaService, useValue: mockPrismaService },
        { provide: StripeService, useValue: mockStripeService },
        { provide: ConfigService, useValue: config() },
        { provide: StripeWebhookService, useValue: {} },
        { provide: OneTimePaymentService, useValue: mockOneTimePayments },
        {
          provide: SettingsService,
          useValue: { getPlatformFeePercentage: jest.fn(async () => 15), getMinimumPayoutAmount: jest.fn(async () => 50) },
        },
      ],
    }).compile();

    service = module.get(PaymentsService);
    jest.clearAllMocks();
  });

  describe('requestPayout', () => {
    beforeEach(() => {
      mockPrismaService.user.findUnique.mockResolvedValue(creatorUser);
      mockStripeService.getAccountBalance.mockResolvedValue({
        available: [{ amount: 12050, currency: 'eur' }],
        pending: [],
      });
    });

    it('compares euros with the Stripe balance and pays out in cents', async () => {
      mockStripeService.createPayout.mockResolvedValue({ id: 'po_1', arrival_date: 1760000000 });
      mockPrismaService.payout.create.mockResolvedValue({ id: 'payout-1' });

      await service.requestPayout('creator-1', 100.5);

      expect(mockStripeService.createPayout).toHaveBeenCalledWith('acct_1', 10050);
      expect(mockPrismaService.payout.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ amount: 100.5, currency: 'EUR' }),
      });
    });

    it('refuses more than the available balance', async () => {
      await expect(service.requestPayout('creator-1', 120.51)).rejects.toThrow(BadRequestException);
      expect(mockStripeService.createPayout).not.toHaveBeenCalled();
    });

    it('enforces the minimum payout platform setting', async () => {
      await expect(service.requestPayout('creator-1', 49.99)).rejects.toThrow('Minimum payout amount is 50.00€');
      expect(mockStripeService.createPayout).not.toHaveBeenCalled();
    });

    it('refuses when Stripe is not configured', async () => {
      mockStripeService.isConfigured.mockReturnValueOnce(false);
      await expect(service.requestPayout('creator-1', 100)).rejects.toThrow(ServiceUnavailableException);
    });
  });

  describe('Stripe Connect onboarding', () => {
    it('reports the last known status without calling Stripe when it is not configured', async () => {
      mockStripeService.isConfigured.mockReturnValue(false);
      mockPrismaService.user.findUnique.mockResolvedValue({ ...creatorUser, stripeOnboarded: false });

      const status = await service.getOnboardingStatus('creator-1');

      expect(status).toEqual(
        expect.objectContaining({ stripeConfigured: false, hasAccount: true, isOnboarded: false }),
      );
      expect(mockStripeService.getAccount).not.toHaveBeenCalled();
      mockStripeService.isConfigured.mockReturnValue(true);
    });

    it('reads the account once and syncs the onboarding flag', async () => {
      mockPrismaService.user.findUnique.mockResolvedValue({ ...creatorUser, stripeOnboarded: false });
      mockStripeService.getAccount.mockResolvedValue({
        charges_enabled: true,
        payouts_enabled: true,
        details_submitted: true,
      });

      const status = await service.getOnboardingStatus('creator-1');

      expect(status).toEqual(expect.objectContaining({ stripeConfigured: true, isOnboarded: true, payoutsEnabled: true }));
      expect(mockStripeService.getAccount).toHaveBeenCalledTimes(1);
      expect(mockPrismaService.user.update).toHaveBeenCalledWith({
        where: { id: 'creator-1' },
        data: { stripeOnboarded: true },
      });
    });

    it('does not reach Stripe to create an account when it is not configured', async () => {
      mockStripeService.isConfigured.mockReturnValueOnce(false);
      mockPrismaService.user.findUnique.mockResolvedValue({ ...creatorUser, stripeAccountId: null });

      await expect(service.createConnectAccount('creator-1')).rejects.toThrow(ServiceUnavailableException);
      expect(mockStripeService.createConnectAccount).not.toHaveBeenCalled();
    });
  });

  describe('getRevenueStats', () => {
    it('returns one rounded bucket per period, empty ones included', async () => {
      mockPrismaService.user.findUnique.mockResolvedValue(creatorUser);
      mockPrismaService.transaction.findMany.mockResolvedValue([
        { type: 'SUBSCRIPTION', netAmount: new Prisma.Decimal('8.49'), createdAt: new Date() },
        { type: 'SUBSCRIPTION', netAmount: new Prisma.Decimal('0.1'), createdAt: new Date() },
        { type: 'TIP', netAmount: new Prisma.Decimal('0.2'), createdAt: new Date() },
      ]);

      const stats = await service.getRevenueStats('creator-1', { interval: StatsInterval.DAY, periods: 7 });

      expect(stats.periods).toHaveLength(7);
      expect(stats.periods[6]).toEqual(
        expect.objectContaining({ totalRevenue: 8.79, subscriptionRevenue: 8.59, tipRevenue: 0.2, transactionCount: 3 }),
      );
      expect(stats.periods[0].totalRevenue).toBe(0);
      expect(stats.totals.totalRevenue).toBe(8.79);
    });
  });

  describe('getPayouts', () => {
    it('returns amounts as numbers', async () => {
      mockPrismaService.payout.findMany.mockResolvedValue([{ id: 'p1', amount: new Prisma.Decimal('249'), status: 'COMPLETED' }]);
      expect(await service.getPayouts('creator-1')).toEqual([{ id: 'p1', amount: 249, status: 'COMPLETED' }]);
    });
  });

  describe('getEarnings', () => {
    it('returns every amount in euros as numbers', async () => {
      mockPrismaService.user.findUnique.mockResolvedValue(creatorUser);
      mockPrismaService.transaction.aggregate
        .mockResolvedValueOnce({ _sum: { netAmount: new Prisma.Decimal('850.25') } })
        .mockResolvedValueOnce({ _sum: { netAmount: new Prisma.Decimal('42.5') } });
      mockPrismaService.payout.aggregate.mockResolvedValue({ _sum: { amount: new Prisma.Decimal('300') } });
      mockStripeService.getAccountBalance.mockResolvedValue({
        available: [{ amount: 12345, currency: 'eur' }],
        pending: [{ amount: 999, currency: 'eur' }],
      });
      mockPrismaService.transaction.findMany.mockResolvedValue([
        { id: 'tx-1', type: 'TIP', status: 'COMPLETED', amount: new Prisma.Decimal('10'), netAmount: new Prisma.Decimal('8.5') },
      ]);

      const earnings = await service.getEarnings('creator-1');

      expect(earnings).toEqual(
        expect.objectContaining({
          currency: 'EUR',
          totalEarnings: 850.25,
          monthlyEarnings: 42.5,
          availableBalance: 123.45,
          pendingBalance: 9.99,
          availableForPayout: 123.45,
          totalPayouts: 300,
          minimumPayoutAmount: 50,
        }),
      );
      expect(earnings.recentTransactions[0]).toEqual(expect.objectContaining({ amount: 10, netAmount: 8.5 }));
    });
  });

  describe('sendTip', () => {
    const creator = {
      id: 'creator-1',
      role: 'CREATOR',
      username: 'creator',
      creatorProfile: { allowTips: true, minimumTip: new Prisma.Decimal('5') },
    };

    it('starts a pending tip instead of crediting the creator', async () => {
      mockPrismaService.user.findUnique.mockResolvedValue(creator);
      mockPrismaService.liveStream.findUnique.mockResolvedValue({ creatorId: 'creator-1', status: 'LIVE' });
      mockOneTimePayments.startPayment.mockResolvedValue({ status: 'requires_payment_method', completed: false });

      const result = await service.sendTip('fan-1', 'creator-1', {
        amount: 10,
        message: ' Bravo ',
        streamId: 'stream-1',
        paymentMethodId: 'pm_1',
      });

      expect(mockOneTimePayments.startPayment).toHaveBeenCalledWith(
        expect.objectContaining({
          payerId: 'fan-1',
          creatorId: 'creator-1',
          kind: 'tip',
          amount: 10,
          paymentMethodId: 'pm_1',
          metadata: { message: 'Bravo', streamId: 'stream-1' },
        }),
      );
      expect(result.completed).toBe(false);
    });

    it('enforces the minimum tip and refuses self tips', async () => {
      mockPrismaService.user.findUnique.mockResolvedValue(creator);

      await expect(service.sendTip('fan-1', 'creator-1', { amount: 2 })).rejects.toThrow(BadRequestException);
      await expect(service.sendTip('creator-1', 'creator-1', { amount: 10 })).rejects.toThrow(BadRequestException);
      expect(mockOneTimePayments.startPayment).not.toHaveBeenCalled();
    });

    it("refuses a stream that is not the creator's", async () => {
      mockPrismaService.user.findUnique.mockResolvedValue(creator);
      mockPrismaService.liveStream.findUnique.mockResolvedValue({ creatorId: 'someone-else', status: 'LIVE' });

      await expect(
        service.sendTip('fan-1', 'creator-1', { amount: 10, streamId: 'stream-1' }),
      ).rejects.toThrow(BadRequestException);
    });

    it('confirms through the one-time payment flow', async () => {
      await service.confirmTip('fan-1', 'creator-1', 'pi_1');
      expect(mockOneTimePayments.confirmPayment).toHaveBeenCalledWith('fan-1', 'pi_1', {
        kind: 'tip',
        creatorId: 'creator-1',
      });
    });
  });
});

describe('StripeService.createOneTimePaymentIntent', () => {
  it('sends cents to Stripe, with the platform fee as application fee', async () => {
    const stripeService = new StripeService(config({ STRIPE_SECRET_KEY: 'sk_test_x' }) as any, {} as any, { getPlatformFeePercentage: jest.fn(async () => 15), getMinimumPayoutAmount: jest.fn(async () => 50) } as any);
    const create = jest.fn().mockResolvedValue({ id: 'pi_1' });
    (stripeService as any).stripe = { paymentIntents: { create } };

    await stripeService.createOneTimePaymentIntent({
      amount: 9.99,
      platformFee: 1.5,
      customerId: 'cus_1',
      connectedAccountId: 'acct_1',
      metadata: { transactionId: 'tx-1' },
    });

    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        amount: 999,
        currency: 'eur',
        customer: 'cus_1',
        application_fee_amount: 150,
        transfer_data: { destination: 'acct_1' },
        setup_future_usage: 'on_session',
        metadata: { transactionId: 'tx-1', platform: 'ofm' },
      }),
    );
  });

  it('confirms immediately with a saved card', async () => {
    const stripeService = new StripeService(config({ STRIPE_SECRET_KEY: 'sk_test_x' }) as any, {} as any, { getPlatformFeePercentage: jest.fn(async () => 15), getMinimumPayoutAmount: jest.fn(async () => 50) } as any);
    const create = jest.fn().mockResolvedValue({ id: 'pi_1' });
    (stripeService as any).stripe = { paymentIntents: { create } };

    await stripeService.createOneTimePaymentIntent({
      amount: 10,
      platformFee: 1.5,
      customerId: 'cus_1',
      connectedAccountId: 'acct_1',
      paymentMethodId: 'pm_1',
      metadata: {},
    });

    expect(create.mock.calls[0][0]).toEqual(expect.objectContaining({ payment_method: 'pm_1', confirm: true }));
    expect(create.mock.calls[0][0].setup_future_usage).toBeUndefined();
  });
});

describe('StripeWebhookService (one-off payments)', () => {
  const mockPrismaService = {
    transaction: { findFirst: jest.fn(), update: jest.fn(), create: jest.fn() },
    notification: { create: jest.fn() },
  };
  const mockOneTimePayments = { handlePaymentIntentSucceeded: jest.fn() };

  const createService = () =>
    new StripeWebhookService(
      mockPrismaService as any,
      {} as any,
      config({ STRIPE_SECRET_KEY: 'sk_test_x', STRIPE_WEBHOOK_SECRET: 'whsec_x' }) as any,
      {} as SubscriptionSyncService,
      mockOneTimePayments as any,
      { getPlatformFeePercentage: jest.fn(async () => 15), getMinimumPayoutAmount: jest.fn(async () => 50) } as any,
    );

  beforeEach(() => jest.clearAllMocks());

  it('hands tips and PPV payments to the one-time payment flow', async () => {
    mockOneTimePayments.handlePaymentIntentSucceeded.mockResolvedValue(true);

    await (createService() as any).handlePaymentIntentSucceeded({ id: 'pi_1' });

    expect(mockOneTimePayments.handlePaymentIntentSucceeded).toHaveBeenCalledWith({ id: 'pi_1' });
    expect(mockPrismaService.transaction.update).not.toHaveBeenCalled();
  });

  it('formats euro amounts in notifications without dividing by 100', async () => {
    mockOneTimePayments.handlePaymentIntentSucceeded.mockResolvedValue(false);
    mockPrismaService.transaction.findFirst.mockResolvedValue({
      id: 'tx-1',
      status: 'PENDING',
      fromUserId: 'fan-1',
      amount: new Prisma.Decimal('19.99'),
    });

    await (createService() as any).handlePaymentIntentSucceeded({ id: 'pi_1' });

    expect(mockPrismaService.notification.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        // PAYMENT_SUCCESS is not a NotificationType: stored as SYSTEM
        type: 'SYSTEM',
        message: expect.stringContaining('19.99€'),
      }),
    });
  });

  it('records Stripe refunds (cents) in euros', async () => {
    mockPrismaService.transaction.findFirst.mockResolvedValue({
      id: 'tx-1',
      status: 'COMPLETED',
      fromUserId: 'fan-1',
      toUserId: 'creator-1',
      currency: 'EUR',
      metadata: {},
    });

    await (createService() as any).handleChargeRefunded({ id: 'ch_1', amount: 1000, amount_refunded: 250 });

    expect(mockPrismaService.transaction.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ type: 'REFUND', amount: 2.5, netAmount: 2.5 }),
    });
    expect(mockPrismaService.transaction.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: 'PARTIALLY_REFUNDED' }) }),
    );
  });
});
