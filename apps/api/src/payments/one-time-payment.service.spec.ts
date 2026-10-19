import { Test, TestingModule } from '@nestjs/testing';
import { SettingsService } from '../settings/settings.service';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { OneTimePaymentService, TipCompletedEvent } from './one-time-payment.service';
import { StripeService } from './stripe.service';
import { PrismaService } from '../common/database/prisma.service';

describe('OneTimePaymentService', () => {
  let service: OneTimePaymentService;

  // Single transaction row kept in memory so status transitions are realistic
  let row: any;

  const mockPrismaService: any = {
    user: {
      findUnique: jest.fn(),
      update: jest.fn(),
    },
    transaction: {
      create: jest.fn(async ({ data }: any) => {
        row = {
          id: 'tx-1',
          stripePaymentIntentId: null,
          stripeChargeId: null,
          ...data,
          amount: new Prisma.Decimal(data.amount),
          platformFee: new Prisma.Decimal(data.platformFee),
          netAmount: new Prisma.Decimal(data.netAmount),
        };
        return row;
      }),
      update: jest.fn(async ({ data }: any) => {
        row = { ...row, ...data };
        return row;
      }),
      updateMany: jest.fn(async ({ where, data }: any) => {
        if (!row || row.id !== where.id || !where.status.in.includes(row.status)) {
          return { count: 0 };
        }
        row = { ...row, ...data };
        return { count: 1 };
      }),
      findUnique: jest.fn(async ({ where }: any) => {
        if (!row) return null;
        if (where.id && where.id === row.id) return row;
        if (where.stripePaymentIntentId && where.stripePaymentIntentId === row.stripePaymentIntentId) return row;
        return null;
      }),
    },
    contentUnlock: {
      upsert: jest.fn(),
    },
    creatorProfile: {
      updateMany: jest.fn(),
    },
    subscriberProfile: {
      updateMany: jest.fn(),
    },
    notification: {
      create: jest.fn(),
    },
    $transaction: jest.fn(async (fn: any) => fn(mockPrismaService)),
  };

  const mockStripeService = {
    createCustomer: jest.fn(),
    createOneTimePaymentIntent: jest.fn(),
    retrievePaymentIntent: jest.fn(),
    retrievePaymentMethod: jest.fn(),
  };

  const fan = { id: 'fan-1', email: 'fan@example.com', username: 'fan', displayName: 'Fan', avatar: null, stripeCustomerId: 'cus_1' };
  const creator = { id: 'creator-1', stripeAccountId: 'acct_1', stripeOnboarded: true };

  const intent = (overrides: any = {}): any => ({
    id: 'pi_1',
    status: 'requires_payment_method',
    amount: 1000,
    amount_received: 0,
    currency: 'eur',
    client_secret: 'pi_1_secret',
    latest_charge: null,
    metadata: { transactionId: 'tx-1' },
    ...overrides,
  });

  const succeeded = (overrides: any = {}) =>
    intent({ status: 'succeeded', amount_received: 1000, latest_charge: 'ch_1', ...overrides });

  const ppvParams = {
    payerId: 'fan-1',
    creatorId: 'creator-1',
    kind: 'content_unlock' as const,
    amount: 10,
    contentId: 'content-1',
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        OneTimePaymentService,
        { provide: PrismaService, useValue: mockPrismaService },
        { provide: StripeService, useValue: mockStripeService },
        { provide: SettingsService, useValue: { getPlatformFeePercentage: jest.fn(async () => 15) } },
      ],
    }).compile();

    service = module.get(OneTimePaymentService);

    jest.clearAllMocks();
    row = null;
    mockPrismaService.user.findUnique.mockImplementation(async ({ where }: any) =>
      where.id === 'creator-1' ? creator : fan,
    );
  });

  describe('startPayment', () => {
    it('creates a PENDING transaction (euros) before the intent and grants nothing yet', async () => {
      mockStripeService.createOneTimePaymentIntent.mockResolvedValue(intent());

      const result = await service.startPayment(ppvParams);

      const created = mockPrismaService.transaction.create.mock.calls[0][0].data;
      expect(created).toEqual(
        expect.objectContaining({
          type: 'PPV_UNLOCK',
          status: 'PENDING',
          amount: 10,
          platformFee: 1.5,
          netAmount: 8.5,
          contentId: 'content-1',
          metadata: { kind: 'content_unlock' },
        }),
      );
      expect(mockStripeService.createOneTimePaymentIntent).toHaveBeenCalledWith(
        expect.objectContaining({
          amount: 10,
          platformFee: 1.5,
          customerId: 'cus_1',
          connectedAccountId: 'acct_1',
          metadata: expect.objectContaining({ transactionId: 'tx-1', kind: 'content_unlock' }),
        }),
      );
      expect(row.stripePaymentIntentId).toBe('pi_1');
      expect(row.status).toBe('PENDING');
      expect(mockPrismaService.contentUnlock.upsert).not.toHaveBeenCalled();
      expect(mockPrismaService.creatorProfile.updateMany).not.toHaveBeenCalled();
      expect(result).toEqual({
        status: 'requires_payment_method',
        completed: false,
        transactionId: 'tx-1',
        paymentIntentId: 'pi_1',
        clientSecret: 'pi_1_secret',
        amount: 10,
      });
    });

    it('completes immediately when a saved card succeeds', async () => {
      mockStripeService.retrievePaymentMethod.mockResolvedValue({ id: 'pm_1', customer: 'cus_1' });
      mockStripeService.createOneTimePaymentIntent.mockResolvedValue(succeeded());

      const result = await service.startPayment({ ...ppvParams, paymentMethodId: 'pm_1' });

      expect(result.completed).toBe(true);
      expect(row.status).toBe('COMPLETED');
      expect(row.stripeChargeId).toBe('ch_1');
      expect(mockPrismaService.contentUnlock.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          create: { contentId: 'content-1', userId: 'fan-1', paidAmount: 10 },
        }),
      );
      expect(mockPrismaService.creatorProfile.updateMany).toHaveBeenCalledWith({
        where: { userId: 'creator-1' },
        data: { totalEarnings: { increment: 8.5 } },
      });
      expect(mockPrismaService.notification.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ userId: 'creator-1', metadata: expect.objectContaining({ kind: 'PPV_PURCHASE' }) }),
      });
    });

    it('asks for 3D Secure with the client secret', async () => {
      mockStripeService.retrievePaymentMethod.mockResolvedValue({ id: 'pm_1', customer: 'cus_1' });
      mockStripeService.createOneTimePaymentIntent.mockResolvedValue(intent({ status: 'requires_action' }));

      const result = await service.startPayment({ ...ppvParams, paymentMethodId: 'pm_1' });

      expect(result).toEqual(expect.objectContaining({ status: 'requires_action', clientSecret: 'pi_1_secret', completed: false }));
      expect(row.status).toBe('PENDING');
    });

    it("refuses another customer's saved card", async () => {
      mockStripeService.retrievePaymentMethod.mockResolvedValue({ id: 'pm_1', customer: 'cus_other' });

      await expect(service.startPayment({ ...ppvParams, paymentMethodId: 'pm_1' })).rejects.toThrow(NotFoundException);
      expect(mockPrismaService.transaction.create).not.toHaveBeenCalled();
    });

    it('marks the transaction FAILED when Stripe declines the card', async () => {
      mockStripeService.retrievePaymentMethod.mockResolvedValue({ id: 'pm_1', customer: 'cus_1' });
      mockStripeService.createOneTimePaymentIntent.mockRejectedValue(new Error('Your card was declined.'));

      await expect(service.startPayment({ ...ppvParams, paymentMethodId: 'pm_1' })).rejects.toThrow(BadRequestException);
      expect(row.status).toBe('FAILED');
      expect(row.failureReason).toBe('Your card was declined.');
    });

    it('rejects creators that cannot receive payments', async () => {
      mockPrismaService.user.findUnique.mockImplementation(async ({ where }: any) =>
        where.id === 'creator-1' ? { ...creator, stripeOnboarded: false } : fan,
      );

      await expect(service.startPayment(ppvParams)).rejects.toThrow(BadRequestException);
      expect(mockStripeService.createOneTimePaymentIntent).not.toHaveBeenCalled();
    });

    it('creates the Stripe customer on first payment', async () => {
      mockPrismaService.user.findUnique.mockImplementation(async ({ where }: any) =>
        where.id === 'creator-1' ? creator : { ...fan, stripeCustomerId: null },
      );
      mockStripeService.createCustomer.mockResolvedValue({ id: 'cus_new' });
      mockStripeService.createOneTimePaymentIntent.mockResolvedValue(intent());

      await service.startPayment(ppvParams);

      expect(mockPrismaService.user.update).toHaveBeenCalledWith({
        where: { id: 'fan-1' },
        data: { stripeCustomerId: 'cus_new' },
      });
      expect(mockStripeService.createOneTimePaymentIntent).toHaveBeenCalledWith(
        expect.objectContaining({ customerId: 'cus_new' }),
      );
    });
  });

  describe('confirmPayment / webhook idempotency', () => {
    beforeEach(async () => {
      mockStripeService.createOneTimePaymentIntent.mockResolvedValue(intent());
      await service.startPayment(ppvParams);
      jest.clearAllMocks();
    });

    it('stays pending while Stripe has not confirmed the payment', async () => {
      mockStripeService.retrievePaymentIntent.mockResolvedValue(intent({ status: 'processing' }));

      const result = await service.confirmPayment('fan-1', 'pi_1', { kind: 'content_unlock', contentId: 'content-1' });

      expect(result.status).toBe('processing');
      expect(row.status).toBe('PENDING');
      expect(mockPrismaService.contentUnlock.upsert).not.toHaveBeenCalled();
    });

    it('grants access once, whether the webhook or the confirm call comes first', async () => {
      mockStripeService.retrievePaymentIntent.mockResolvedValue(succeeded());

      // Webhook first
      await expect(service.handlePaymentIntentSucceeded(succeeded())).resolves.toBe(true);
      // Then the client confirm, and a webhook retry
      const confirmed = await service.confirmPayment('fan-1', 'pi_1', { kind: 'content_unlock', contentId: 'content-1' });
      await service.handlePaymentIntentSucceeded(succeeded());

      expect(confirmed).toEqual(expect.objectContaining({ status: 'completed', completed: true }));
      expect(mockPrismaService.contentUnlock.upsert).toHaveBeenCalledTimes(1);
      expect(mockPrismaService.creatorProfile.updateMany).toHaveBeenCalledTimes(1);
      expect(mockPrismaService.notification.create).toHaveBeenCalledTimes(1);
    });

    it('completes from the confirm call and ignores the late webhook', async () => {
      mockStripeService.retrievePaymentIntent.mockResolvedValue(succeeded());

      await service.confirmPayment('fan-1', 'pi_1', { kind: 'content_unlock', contentId: 'content-1' });
      await service.handlePaymentIntentSucceeded(succeeded());

      expect(mockStripeService.retrievePaymentIntent).toHaveBeenCalledWith('pi_1');
      expect(mockPrismaService.creatorProfile.updateMany).toHaveBeenCalledTimes(1);
    });

    it('lets a failed attempt be retried and completed', async () => {
      row.status = 'FAILED';
      mockStripeService.retrievePaymentIntent.mockResolvedValue(succeeded());

      const result = await service.confirmPayment('fan-1', 'pi_1', { kind: 'content_unlock', contentId: 'content-1' });

      expect(result.completed).toBe(true);
      expect(row.failureReason).toBeNull();
    });

    it('never grants more than what was charged', async () => {
      mockStripeService.retrievePaymentIntent.mockResolvedValue(succeeded({ amount_received: 100 }));

      const result = await service.confirmPayment('fan-1', 'pi_1', { kind: 'content_unlock', contentId: 'content-1' });

      expect(result.completed).toBe(false);
      expect(row.status).toBe('PENDING');
      expect(mockPrismaService.contentUnlock.upsert).not.toHaveBeenCalled();
    });

    it("refuses to confirm someone else's payment or another content", async () => {
      await expect(
        service.confirmPayment('other-user', 'pi_1', { kind: 'content_unlock', contentId: 'content-1' }),
      ).rejects.toThrow(NotFoundException);
      await expect(
        service.confirmPayment('fan-1', 'pi_1', { kind: 'content_unlock', contentId: 'content-2' }),
      ).rejects.toThrow(NotFoundException);
      await expect(service.confirmPayment('fan-1', 'pi_1', { kind: 'tip' })).rejects.toThrow(NotFoundException);
      expect(mockStripeService.retrievePaymentIntent).not.toHaveBeenCalled();
    });

    it('finds the transaction from the intent metadata when the webhook beats the link update', async () => {
      row.stripePaymentIntentId = null;

      await expect(service.handlePaymentIntentSucceeded(succeeded())).resolves.toBe(true);

      expect(row.stripePaymentIntentId).toBe('pi_1');
      expect(row.status).toBe('COMPLETED');
    });
  });

  describe('tips', () => {
    it('credits the creator and emits one tip event with its stream', async () => {
      const events: TipCompletedEvent[] = [];
      service.tipCompleted$.subscribe((event) => events.push(event));
      mockStripeService.createOneTimePaymentIntent.mockResolvedValue(intent({ amount: 2000 }));

      await service.startPayment({
        payerId: 'fan-1',
        creatorId: 'creator-1',
        kind: 'tip',
        amount: 20,
        metadata: { message: 'Bravo', streamId: 'stream-1' },
      });
      expect(row.type).toBe('TIP');
      expect(events).toHaveLength(0);

      await service.handlePaymentIntentSucceeded(succeeded({ amount: 2000, amount_received: 2000 }));
      await service.handlePaymentIntentSucceeded(succeeded({ amount: 2000, amount_received: 2000 }));

      expect(mockPrismaService.contentUnlock.upsert).not.toHaveBeenCalled();
      expect(mockPrismaService.creatorProfile.updateMany).toHaveBeenCalledWith({
        where: { userId: 'creator-1' },
        data: { totalEarnings: { increment: 17 } },
      });
      expect(mockPrismaService.notification.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ type: 'NEW_TIP', userId: 'creator-1' }),
      });
      expect(events).toEqual([
        expect.objectContaining({ transactionId: 'tx-1', streamId: 'stream-1', amount: 20, message: 'Bravo' }),
      ]);
    });
  });

  it('leaves other payment intents (subscriptions) to the generic webhook handling', async () => {
    row = { id: 'tx-sub', type: 'SUBSCRIPTION', status: 'PENDING', stripePaymentIntentId: 'pi_1' };

    await expect(service.handlePaymentIntentSucceeded(succeeded())).resolves.toBe(false);
    expect(mockPrismaService.transaction.updateMany).not.toHaveBeenCalled();
  });
});
