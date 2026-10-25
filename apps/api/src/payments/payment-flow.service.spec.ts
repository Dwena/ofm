import { BadRequestException, Logger, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { PaymentFlowService, safeReturnPath, StartPaymentParams } from './payment-flow.service';
import { CreatorBalanceService } from './creator-balance.service';
import { PaymentProvider, PaymentProviderError } from './providers/payment-provider';

const TX_ID = '11111111-1111-4111-8111-111111111111';
const DAY = 24 * 60 * 60 * 1000;

describe('PaymentFlowService', () => {
  let transactions: Map<string, any>;
  let service: PaymentFlowService;
  let prisma: any;
  let provider: jest.Mocked<PaymentProvider>;
  let payer: any;
  let creator: any;

  const settings = {
    getPlatformFeePercentage: jest.fn(async () => 15),
    getEarningsHoldDays: jest.fn(async () => 7),
  };
  const config = { get: jest.fn((key: string, fallback?: string) => (key === 'WEB_URL' ? 'https://fanvip.test' : fallback)) };

  const matchesStatus = (row: any, where: any) => !where.status?.in || where.status.in.includes(row.status);

  beforeEach(() => {
    jest.spyOn(Logger.prototype, 'log').mockImplementation();
    jest.spyOn(Logger.prototype, 'warn').mockImplementation();
    jest.spyOn(Logger.prototype, 'error').mockImplementation();

    transactions = new Map();
    payer = { id: 'fan-1', email: 'fan@example.com', billingCountry: 'FR' };
    creator = { id: 'creator-1', role: 'CREATOR', kycStatus: 'VERIFIED', status: 'ACTIVE', deletedAt: null };

    prisma = {
      user: {
        findUnique: jest.fn(async ({ where }: any) => (where.id === payer.id ? payer : where.id === creator.id ? creator : null)),
        update: jest.fn(async () => ({})),
      },
      transaction: {
        create: jest.fn(async ({ data }: any) => {
          const row = { id: TX_ID, providerPaymentId: null, paymentCardId: null, failureReason: null, ...data };
          transactions.set(row.id, row);
          return { ...row };
        }),
        findUnique: jest.fn(async ({ where }: any) => {
          if (where.id) return transactions.has(where.id) ? { ...transactions.get(where.id) } : null;
          if (where.providerPaymentId) {
            return [...transactions.values()].find((row) => row.providerPaymentId === where.providerPaymentId) ?? null;
          }
          return null;
        }),
        findUniqueOrThrow: jest.fn(async ({ where }: any) => {
          const row = transactions.get(where.id);
          if (!row) throw new Error('not found');
          return { ...row };
        }),
        findFirst: jest.fn(async ({ where }: any) =>
          [...transactions.values()].find((row) => row.providerTransactionId === where.providerTransactionId) ?? null,
        ),
        update: jest.fn(async ({ where, data }: any) => {
          const row = Object.assign(transactions.get(where.id), data);
          return { ...row };
        }),
        updateMany: jest.fn(async ({ where, data }: any) => {
          const row = transactions.get(where.id);
          if (!row || !matchesStatus(row, where)) return { count: 0 };
          Object.assign(row, data);
          return { count: 1 };
        }),
      },
      paymentCard: {
        findFirst: jest.fn(),
        findUnique: jest.fn(async () => null),
        count: jest.fn(async () => 0),
        upsert: jest.fn(async () => ({ id: 'card-new' })),
        findMany: jest.fn(async () => []),
      },
      contentUnlock: { upsert: jest.fn() },
      message: { updateMany: jest.fn() },
      creatorBalanceEntry: { create: jest.fn() },
      creatorProfile: { updateMany: jest.fn() },
      subscriberProfile: { updateMany: jest.fn() },
      notification: { create: jest.fn() },
    };
    prisma.$transaction = jest.fn(async (fn: any) => fn(prisma));

    provider = {
      name: 'fake',
      isConfigured: jest.fn(() => true),
      createCheckout: jest.fn(async ({ reference }) => ({ id: `cs_${reference}`, redirectUrl: 'https://provider/pay' })),
      chargeSavedCard: jest.fn(),
      refund: jest.fn(),
      parseWebhook: jest.fn(),
    };

    service = new PaymentFlowService(
      prisma,
      settings as any,
      new CreatorBalanceService(prisma),
      config as any,
      provider,
    );
  });

  afterEach(() => jest.restoreAllMocks());

  const params = (overrides: Partial<StartPaymentParams> = {}): StartPaymentParams => ({
    payerId: 'fan-1',
    creatorId: 'creator-1',
    kind: 'content_unlock',
    amount: 10,
    contentId: 'content-1',
    withdrawalWaiver: true,
    description: 'Contenu',
    ...overrides,
  });

  const savedCard = { id: 'card-1', userId: 'fan-1', providerToken: 'tok_1', country: 'FR' };

  describe('startPayment checks', () => {
    it('requires the withdrawal waiver for digital content bought by the fan', async () => {
      const error = await service.startPayment(params({ withdrawalWaiver: false })).catch((e) => e);

      expect(error).toBeInstanceOf(BadRequestException);
      expect(error.getResponse()).toEqual(expect.objectContaining({ code: 'WITHDRAWAL_WAIVER_REQUIRED' }));
      expect(prisma.transaction.create).not.toHaveBeenCalled();
    });

    it('does not require the waiver for tips nor for renewals charged by the platform', async () => {
      await service.startPayment(params({ kind: 'tip', contentId: undefined, withdrawalWaiver: undefined }));
      expect(prisma.transaction.create).toHaveBeenCalledTimes(1);

      prisma.paymentCard.findFirst.mockResolvedValue(savedCard);
      provider.chargeSavedCard.mockResolvedValue({ status: 'approved', providerPaymentId: 'p', providerTransactionId: 'p', amount: 12 });
      await service.startPayment(
        params({ kind: 'subscription', initiator: 'merchant', withdrawalWaiver: undefined, paymentCardId: 'card-1' }),
      );
      expect(prisma.transaction.create).toHaveBeenCalledTimes(2);
    });

    it('requires a billing country and saves the declared one', async () => {
      payer.billingCountry = null;
      const error = await service.startPayment(params()).catch((e) => e);
      expect(error).toBeInstanceOf(BadRequestException);
      expect(error.getResponse()).toEqual(expect.objectContaining({ code: 'BILLING_COUNTRY_REQUIRED' }));

      await service.startPayment(params({ billingCountry: 'de' }));
      expect(prisma.user.update).toHaveBeenCalledWith({ where: { id: 'fan-1' }, data: { billingCountry: 'DE' } });
      expect(prisma.transaction.create.mock.calls[0][0].data).toEqual(
        expect.objectContaining({ vatRate: 19, vatAmount: 1.9, totalAmount: 11.9, taxCountry: 'DE' }),
      );
    });

    it('uses the saved billing country without rewriting it', async () => {
      await service.startPayment(params());

      expect(prisma.user.update).not.toHaveBeenCalled();
      expect(prisma.transaction.create.mock.calls[0][0].data).toEqual(
        expect.objectContaining({
          status: 'PENDING',
          type: 'PPV_UNLOCK',
          amount: 10,
          platformFee: 1.5,
          netAmount: 8.5,
          vatRate: 20,
          vatAmount: 2,
          totalAmount: 12,
          taxCountry: 'FR',
          withdrawalWaivedAt: expect.any(Date),
          metadata: expect.objectContaining({ kind: 'content_unlock', initiator: 'customer' }),
        }),
      );
    });

    it('refuses a creator who cannot sell (identity not verified, suspended, not a creator)', async () => {
      for (const override of [{ kycStatus: 'PENDING' }, { status: 'SUSPENDED' }, { role: 'SUBSCRIBER' }, { deletedAt: new Date() }]) {
        Object.assign(creator, { role: 'CREATOR', kycStatus: 'VERIFIED', status: 'ACTIVE', deletedAt: null }, override);
        const error = await service.startPayment(params()).catch((e) => e);
        expect(error).toBeInstanceOf(BadRequestException);
        expect(error.getResponse()).toEqual(expect.objectContaining({ code: 'CREATOR_NOT_READY' }));
      }
      expect(prisma.transaction.create).not.toHaveBeenCalled();
    });

    it('answers 503 when the payment provider is not configured', async () => {
      provider.isConfigured.mockReturnValue(false);

      await expect(service.startPayment(params())).rejects.toThrow(ServiceUnavailableException);
      expect(prisma.transaction.create).not.toHaveBeenCalled();
    });

    it('refuses an invalid amount and a card of another user', async () => {
      await expect(service.startPayment(params({ amount: 0 }))).rejects.toThrow(BadRequestException);

      prisma.paymentCard.findFirst.mockResolvedValue(null);
      await expect(service.startPayment(params({ paymentCardId: 'card-other' }))).rejects.toThrow(NotFoundException);
      expect(prisma.paymentCard.findFirst).toHaveBeenCalledWith({
        where: { id: 'card-other', userId: 'fan-1', deletedAt: null, provider: 'fake' },
      });
    });
  });

  describe('saved card', () => {
    beforeEach(() => prisma.paymentCard.findFirst.mockResolvedValue(savedCard));

    it('completes an approved charge: access granted and creator credited after the hold period', async () => {
      provider.chargeSavedCard.mockResolvedValue({
        status: 'approved',
        providerPaymentId: 'ch_1',
        providerTransactionId: 'ch_1',
        amount: 12,
      });

      const before = Date.now();
      const result = await service.startPayment(params({ paymentCardId: 'card-1', clientIp: '1.2.3.4' }));

      expect(provider.chargeSavedCard).toHaveBeenCalledWith(
        expect.objectContaining({
          reference: TX_ID,
          cardToken: 'tok_1',
          amount: 12,
          initiator: 'customer',
          customer: { id: 'fan-1', email: 'fan@example.com', ip: '1.2.3.4' },
        }),
      );
      expect(result).toEqual(
        expect.objectContaining({ status: 'completed', completed: true, transactionId: TX_ID, amount: 10, vatAmount: 2, totalAmount: 12 }),
      );
      expect(transactions.get(TX_ID)).toEqual(
        expect.objectContaining({ status: 'COMPLETED', providerTransactionId: 'ch_1', paymentCardId: 'card-1' }),
      );
      expect(prisma.contentUnlock.upsert).toHaveBeenCalledWith({
        where: { contentId_userId: { contentId: 'content-1', userId: 'fan-1' } },
        create: { contentId: 'content-1', userId: 'fan-1', paidAmount: 10 },
        update: {},
      });

      const entry = prisma.creatorBalanceEntry.create.mock.calls[0][0].data;
      expect(entry).toEqual(
        expect.objectContaining({ creatorId: 'creator-1', type: 'EARNING', amount: 8.5, currency: 'EUR', transactionId: TX_ID }),
      );
      expect(entry.availableAt.getTime()).toBeGreaterThanOrEqual(before + 7 * DAY);
      expect(entry.availableAt.getTime()).toBeLessThanOrEqual(Date.now() + 7 * DAY);
      expect(prisma.creatorProfile.updateMany).toHaveBeenCalledWith({
        where: { userId: 'creator-1' },
        data: { totalEarnings: { increment: 8.5 } },
      });
      expect(prisma.subscriberProfile.updateMany).toHaveBeenCalledWith({
        where: { userId: 'fan-1' },
        data: { totalSpent: { increment: 12 } },
      });
      // Creator notified
      expect(prisma.notification.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ userId: 'creator-1', title: 'Contenu débloqué' }),
      });
    });

    it('marks a declined charge as failed and calls the failure hook of its kind', async () => {
      const onFailed = jest.fn(async () => undefined);
      service.registerHandler('subscription', { onCompleted: jest.fn(), onFailed });
      provider.chargeSavedCard.mockResolvedValue({ status: 'declined', reason: 'Fonds insuffisants', code: '51' });

      const result = await service.startPayment(
        params({ kind: 'subscription', contentId: undefined, paymentCardId: 'card-1', metadata: { action: 'new' } }),
      );

      expect(result).toEqual(expect.objectContaining({ status: 'failed', completed: false, failureReason: 'Fonds insuffisants' }));
      expect(transactions.get(TX_ID).status).toBe('FAILED');
      expect(onFailed).toHaveBeenCalledWith(
        expect.objectContaining({ id: TX_ID }),
        expect.objectContaining({ action: 'new', kind: 'subscription' }),
        'Fonds insuffisants',
      );
      expect(prisma.creatorBalanceEntry.create).not.toHaveBeenCalled();
    });

    it('fails a renewal needing bank authentication (nobody can authenticate it)', async () => {
      provider.chargeSavedCard.mockResolvedValue({ status: 'requires_action', providerPaymentId: 'p', redirectUrl: 'https://3ds' });

      const result = await service.startPayment(
        params({ kind: 'subscription', contentId: undefined, paymentCardId: 'card-1', initiator: 'merchant' }),
      );

      expect(result.status).toBe('failed');
      expect(result.redirectUrl).toBeNull();
      expect(transactions.get(TX_ID)).toEqual(
        expect.objectContaining({ status: 'FAILED', failureReason: 'Authentification bancaire requise' }),
      );
    });

    it('sends the fan to the bank authentication page', async () => {
      provider.chargeSavedCard.mockResolvedValue({ status: 'requires_action', providerPaymentId: 'p_3ds', redirectUrl: 'https://3ds' });

      const result = await service.startPayment(params({ paymentCardId: 'card-1' }));

      expect(result).toEqual(expect.objectContaining({ status: 'requires_redirect', redirectUrl: 'https://3ds', completed: false }));
      expect(transactions.get(TX_ID)).toEqual(expect.objectContaining({ status: 'PENDING', providerPaymentId: 'p_3ds' }));
    });

    it('keeps a pending charge PROCESSING until the webhook', async () => {
      provider.chargeSavedCard.mockResolvedValue({ status: 'pending', providerPaymentId: 'p_1' });

      const result = await service.startPayment(params({ paymentCardId: 'card-1' }));

      expect(result.status).toBe('processing');
      expect(transactions.get(TX_ID).status).toBe('PROCESSING');
    });
  });

  describe('hosted checkout', () => {
    it('opens the provider page with a return URL carrying the transaction and a safe path', async () => {
      const result = await service.startPayment(params({ returnPath: '/alice?tab=media' }));

      expect(result).toEqual(
        expect.objectContaining({ status: 'requires_redirect', redirectUrl: 'https://provider/pay', transactionId: TX_ID }),
      );
      const checkout = provider.createCheckout.mock.calls[0][0];
      expect(checkout).toEqual(
        expect.objectContaining({ reference: TX_ID, amount: 12, customer: { id: 'fan-1', email: 'fan@example.com', country: 'FR' } }),
      );
      const returnUrl = new URL(checkout.returnUrl);
      expect(`${returnUrl.origin}${returnUrl.pathname}`).toBe('https://fanvip.test/checkout/retour');
      expect(returnUrl.searchParams.get('transaction')).toBe(TX_ID);
      expect(returnUrl.searchParams.get('next')).toBe('/alice?tab=media');
      expect(new URL(checkout.cancelUrl).searchParams.get('annule')).toBe('1');
      expect(transactions.get(TX_ID).providerPaymentId).toBe(`cs_${TX_ID}`);
    });

    it('never returns to another site', async () => {
      await service.startPayment(params({ returnPath: '//evil.example/steal' }));

      expect(new URL(provider.createCheckout.mock.calls[0][0].returnUrl).searchParams.get('next')).toBe('/');
    });

    it('fails a renewal without a saved card', async () => {
      const result = await service.startPayment(params({ kind: 'subscription', contentId: undefined, initiator: 'merchant' }));

      expect(result.status).toBe('failed');
      expect(provider.createCheckout).not.toHaveBeenCalled();
      expect(transactions.get(TX_ID).failureReason).toBe('Aucune carte enregistrée');
    });

    it('marks the payment failed and answers 503 when the provider is down', async () => {
      provider.createCheckout.mockRejectedValue(new PaymentProviderError('CCBill unreachable'));

      await expect(service.startPayment(params())).rejects.toThrow(ServiceUnavailableException);
      expect(transactions.get(TX_ID)).toEqual(expect.objectContaining({ status: 'FAILED', failureReason: 'CCBill unreachable' }));
    });
  });

  describe('completeTransaction', () => {
    beforeEach(async () => {
      await service.startPayment(params());
    });

    const payment = { providerTransactionId: 'ch_1', amountCharged: 12, currency: 'EUR' };

    it('completes once: a second confirmation (webhook + redirect) does nothing', async () => {
      await expect(service.completeTransaction(TX_ID, payment)).resolves.toBe(true);
      await expect(service.completeTransaction(TX_ID, payment)).resolves.toBe(false);

      expect(prisma.creatorBalanceEntry.create).toHaveBeenCalledTimes(1);
      expect(prisma.contentUnlock.upsert).toHaveBeenCalledTimes(1);
      expect(transactions.get(TX_ID).status).toBe('COMPLETED');
    });

    it('refuses a payment lower than the total VAT included, or in another currency', async () => {
      await expect(service.completeTransaction(TX_ID, { ...payment, amountCharged: 10 })).resolves.toBe(false);
      await expect(service.completeTransaction(TX_ID, { ...payment, currency: 'USD' })).resolves.toBe(false);

      expect(transactions.get(TX_ID).status).toBe('PENDING');
      expect(prisma.creatorBalanceEntry.create).not.toHaveBeenCalled();
    });

    it('completes a payment that failed earlier (retried at the provider)', async () => {
      await service.markFailed(TX_ID, 'Refusée');
      expect(transactions.get(TX_ID).status).toBe('FAILED');

      await expect(service.completeTransaction(TX_ID, payment)).resolves.toBe(true);
      expect(transactions.get(TX_ID)).toEqual(expect.objectContaining({ status: 'COMPLETED', failureReason: null }));
    });

    it('runs the hooks of the kind instead of the default notifications', async () => {
      const onCompleted = jest.fn(async () => undefined);
      const afterCompleted = jest.fn(async () => undefined);
      service.registerHandler('content_unlock', { onCompleted, afterCompleted });

      await service.completeTransaction(TX_ID, payment);

      expect(onCompleted).toHaveBeenCalledWith(prisma, expect.objectContaining({ id: TX_ID }), expect.objectContaining({ kind: 'content_unlock' }));
      expect(afterCompleted).toHaveBeenCalled();
      expect(prisma.notification.create).not.toHaveBeenCalled();
    });
  });

  describe('handlePaymentSucceeded', () => {
    const card = { token: 'ccb_sub_1', brand: 'VISA', last4: '4242', expMonth: 4, expYear: 2028, country: 'be' };
    const event = { reference: TX_ID, providerTransactionId: 'ccb_sub_1', amount: 12, currency: 'EUR', card };

    beforeEach(async () => {
      await service.startPayment(params());
    });

    it('saves the card used (first card becomes the default one) and completes the payment', async () => {
      await expect(service.handlePaymentSucceeded(event)).resolves.toBe(true);

      expect(prisma.paymentCard.upsert).toHaveBeenCalledWith({
        where: { provider_providerToken: { provider: 'fake', providerToken: 'ccb_sub_1' } },
        create: expect.objectContaining({ userId: 'fan-1', provider: 'fake', providerToken: 'ccb_sub_1', isDefault: true, country: 'BE', last4: '4242' }),
        update: expect.objectContaining({ deletedAt: null, last4: '4242' }),
      });
      expect(transactions.get(TX_ID)).toEqual(
        expect.objectContaining({
          status: 'COMPLETED',
          paymentCardId: 'card-new',
          taxEvidence: expect.objectContaining({ declaredCountry: 'FR', cardCountry: 'BE' }),
        }),
      );
    });

    it('does not make a second card the default one', async () => {
      prisma.paymentCard.count.mockResolvedValue(1);

      await service.handlePaymentSucceeded(event);

      expect(prisma.paymentCard.upsert.mock.calls[0][0].create.isDefault).toBe(false);
    });

    it("ignores a card token that belongs to another user", async () => {
      prisma.paymentCard.findUnique.mockResolvedValue({ id: 'card-x', userId: 'someone-else' });

      await expect(service.handlePaymentSucceeded(event)).resolves.toBe(true);

      expect(prisma.paymentCard.upsert).not.toHaveBeenCalled();
      expect(transactions.get(TX_ID).status).toBe('COMPLETED');
      expect(transactions.get(TX_ID).paymentCardId).toBeFalsy();
    });

    it('finds the payment by provider payment id when the reference is missing', async () => {
      transactions.get(TX_ID).providerPaymentId = `cs_${TX_ID}`;

      await expect(
        service.handlePaymentSucceeded({ ...event, reference: '', providerPaymentId: `cs_${TX_ID}`, card: undefined }),
      ).resolves.toBe(true);
      expect(transactions.get(TX_ID).status).toBe('COMPLETED');
    });

    it('returns false for an unknown payment', async () => {
      transactions.clear();
      await expect(service.handlePaymentSucceeded({ ...event, reference: 'not-a-uuid' })).resolves.toBe(false);
    });
  });

  describe('cards', () => {
    it('lists the saved cards of the current provider, default first', async () => {
      prisma.paymentCard.findMany.mockResolvedValue([
        { id: 'card-1', brand: 'VISA', last4: '4242', expMonth: 1, expYear: 2030, isDefault: true, createdAt: new Date(0), providerToken: 'secret' },
      ]);

      const cards = await service.listCards('fan-1');

      expect(prisma.paymentCard.findMany).toHaveBeenCalledWith({
        where: { userId: 'fan-1', deletedAt: null, provider: 'fake' },
        orderBy: [{ isDefault: 'desc' }, { createdAt: 'desc' }],
      });
      expect(cards).toEqual([{ id: 'card-1', brand: 'VISA', last4: '4242', expMonth: 1, expYear: 2030, isDefault: true, createdAt: new Date(0) }]);
    });

    it('renews with the subscription card, else the default one', async () => {
      prisma.paymentCard.findFirst.mockResolvedValueOnce(null).mockResolvedValueOnce({ id: 'card-default' });

      await expect(service.findRenewalCard('fan-1', 'card-deleted')).resolves.toEqual({ id: 'card-default' });
      expect(prisma.paymentCard.findFirst).toHaveBeenLastCalledWith({
        where: { userId: 'fan-1', deletedAt: null, provider: 'fake' },
        orderBy: [{ isDefault: 'desc' }, { createdAt: 'desc' }],
      });
    });
  });

  it('confirmPayment refuses the payment of another user or another purchase', async () => {
    await service.startPayment(params());

    await expect(service.confirmPayment('fan-1', TX_ID, { kind: 'content_unlock', contentId: 'content-1' })).resolves.toEqual(
      expect.objectContaining({ status: 'processing', transactionId: TX_ID }),
    );
    await expect(service.confirmPayment('fan-2', TX_ID)).rejects.toThrow(NotFoundException);
    await expect(service.confirmPayment('fan-1', TX_ID, { kind: 'tip' })).rejects.toThrow(NotFoundException);
    await expect(service.confirmPayment('fan-1', TX_ID, { contentId: 'content-2' })).rejects.toThrow(NotFoundException);
  });
});

describe('safeReturnPath', () => {
  it('keeps relative paths of the web app', () => {
    expect(safeReturnPath('/alice')).toBe('/alice');
    expect(safeReturnPath('/live/123?x=1')).toBe('/live/123?x=1');
  });

  it('replaces anything that could leave the site', () => {
    for (const path of ['//evil.com', 'https://evil.com', '/\\evil.com', 'evil', '/a b', '', null, undefined]) {
      expect(safeReturnPath(path)).toBe('/');
    }
  });
});
