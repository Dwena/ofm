import { BadRequestException, ForbiddenException, Logger, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { RefundsService, splitRefund } from './refunds.service';
import { CreatorBalanceService } from './creator-balance.service';
import { PaymentProvider, PaymentProviderError } from './providers/payment-provider';

const DAY = 24 * 60 * 60 * 1000;

describe('splitRefund', () => {
  const sale = { amount: 10, vatAmount: 2, totalAmount: 12, platformFee: 1.5, netAmount: 8.5 } as any;

  it('splits a full refund back into price, VAT, fee and creator share', () => {
    expect(splitRefund(sale, 12)).toEqual({ amount: 10, vatAmount: 2, totalAmount: 12, creatorShare: 8.5, platformFee: 1.5 });
  });

  it('splits a partial refund proportionally', () => {
    expect(splitRefund(sale, 6)).toEqual({ amount: 5, vatAmount: 1, totalAmount: 6, creatorShare: 4.25, platformFee: 0.75 });
    expect(splitRefund(sale, 1)).toEqual({ amount: 0.83, vatAmount: 0.17, totalAmount: 1, creatorShare: 0.71, platformFee: 0.12 });
  });

  it('uses the price for sales recorded without a total (no VAT)', () => {
    const legacy = { amount: 10, vatAmount: 0, totalAmount: 0, platformFee: 1.5, netAmount: 8.5 } as any;
    expect(splitRefund(legacy, 10)).toEqual({ amount: 10, vatAmount: 0, totalAmount: 10, creatorShare: 8.5, platformFee: 1.5 });
  });
});

describe('RefundsService', () => {
  let service: RefundsService;
  let prisma: any;
  let provider: jest.Mocked<PaymentProvider>;
  const earningAvailableAt = new Date(Date.now() + 5 * DAY);

  const sale = (overrides: Record<string, unknown> = {}): any => ({
    id: 'sale-1',
    type: 'PPV_UNLOCK',
    status: 'COMPLETED',
    fromUserId: 'fan-1',
    toUserId: 'creator-1',
    amount: new Prisma.Decimal('10'),
    vatRate: new Prisma.Decimal('20'),
    vatAmount: new Prisma.Decimal('2'),
    totalAmount: new Prisma.Decimal('12'),
    platformFee: new Prisma.Decimal('1.5'),
    netAmount: new Prisma.Decimal('8.5'),
    currency: 'EUR',
    taxCountry: 'FR',
    provider: 'ccbill',
    providerTransactionId: 'ccb_1',
    contentId: 'content-1',
    subscriptionId: null,
    metadata: { kind: 'content_unlock' },
    ...overrides,
  });

  beforeEach(() => {
    jest.spyOn(Logger.prototype, 'log').mockImplementation();
    jest.spyOn(Logger.prototype, 'warn').mockImplementation();
    jest.spyOn(Logger.prototype, 'error').mockImplementation();

    prisma = {
      transaction: { findUnique: jest.fn(), findFirst: jest.fn(), findMany: jest.fn(async () => []), create: jest.fn(), update: jest.fn() },
      creatorBalanceEntry: {
        findFirst: jest.fn(async () => ({ availableAt: earningAvailableAt })),
        create: jest.fn(async ({ data }: any) => data),
        aggregate: jest.fn(),
      },
      creatorProfile: { updateMany: jest.fn() },
      contentUnlock: { deleteMany: jest.fn() },
      message: { updateMany: jest.fn() },
      subscription: { updateMany: jest.fn() },
      dispute: { create: jest.fn(), findUnique: jest.fn(), update: jest.fn() },
      notification: { create: jest.fn() },
      user: { findMany: jest.fn(async () => [{ id: 'admin-1' }]) },
    };
    prisma.$transaction = jest.fn(async (fn: any) => fn(prisma));

    provider = {
      name: 'ccbill',
      isConfigured: jest.fn(() => true),
      createCheckout: jest.fn(),
      chargeSavedCard: jest.fn(),
      refund: jest.fn(async (_params: any) => ({ providerRefundId: 'refund-1' })),
      parseWebhook: jest.fn(),
    };

    service = new RefundsService(prisma, new CreatorBalanceService(prisma), provider);
  });

  afterEach(() => jest.restoreAllMocks());

  const ledgerEntries = () => prisma.creatorBalanceEntry.create.mock.calls.map(([{ data }]: any) => data);

  describe('refundTransaction permissions and checks', () => {
    const refund = (overrides: Record<string, unknown> = {}) =>
      service.refundTransaction({ requesterId: 'creator-1', requesterRole: 'CREATOR', transactionId: 'sale-1', ...overrides } as any);

    it('lets only the creator who received the payment (or an admin) refund it', async () => {
      prisma.transaction.findUnique.mockResolvedValue(sale());

      await expect(refund({ requesterId: 'creator-2' })).rejects.toThrow(ForbiddenException);
      await expect(refund({ requesterId: 'admin-1', requesterRole: 'ADMIN' })).resolves.toEqual(
        expect.objectContaining({ refundAmount: 12, originalTransactionId: 'sale-1' }),
      );
    });

    it('refuses unknown transactions and transactions that are not sales', async () => {
      prisma.transaction.findUnique.mockResolvedValueOnce(null).mockResolvedValueOnce(sale({ type: 'REFUND' }));

      await expect(refund()).rejects.toThrow(NotFoundException);
      await expect(refund()).rejects.toThrow(NotFoundException);
    });

    it('refuses refunded, pending or foreign-provider payments and out of range amounts', async () => {
      for (const [overrides, message] of [
        [{ status: 'REFUNDED' }, 'Transaction already refunded'],
        [{ status: 'PENDING' }, 'Can only refund completed transactions'],
        [{ provider: 'stripe' }, 'cannot be refunded automatically'],
        [{ providerTransactionId: null }, 'cannot be refunded automatically'],
      ] as const) {
        prisma.transaction.findUnique.mockResolvedValue(sale(overrides));
        await expect(refund()).rejects.toThrow(message);
      }

      prisma.transaction.findUnique.mockResolvedValue(sale({ status: 'PARTIALLY_REFUNDED', metadata: { refundedTotal: 10 } }));
      await expect(refund({ amount: 2.01 })).rejects.toThrow('Refund amount must be between 0.01 and 2.00 €');
      await expect(refund({ amount: 0 })).rejects.toThrow(BadRequestException);
      expect(provider.refund).not.toHaveBeenCalled();
    });

    it('records nothing when the provider refuses the refund', async () => {
      prisma.transaction.findUnique.mockResolvedValue(sale());
      provider.refund.mockRejectedValue(new PaymentProviderError('CCBill refund refused'));

      await expect(refund()).rejects.toThrow(ServiceUnavailableException);
      expect(prisma.transaction.create).not.toHaveBeenCalled();
      expect(prisma.creatorBalanceEntry.create).not.toHaveBeenCalled();
    });
  });

  describe('refunds', () => {
    it('full refund: REFUND transaction, REFUNDED sale, creator share debited, access revoked', async () => {
      prisma.transaction.findUnique.mockResolvedValue(sale());

      await service.refundTransaction({ requesterId: 'creator-1', requesterRole: 'CREATOR', transactionId: 'sale-1', reason: 'Erreur' });

      expect(provider.refund).toHaveBeenCalledWith({ providerTransactionId: 'ccb_1', amount: 12, full: true, reason: 'Erreur' });
      expect(prisma.transaction.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          type: 'REFUND',
          status: 'COMPLETED',
          fromUserId: 'creator-1',
          toUserId: 'fan-1',
          amount: 10,
          vatAmount: 2,
          totalAmount: 12,
          netAmount: 8.5,
          platformFee: 1.5,
          providerPaymentId: 'refund-1',
          metadata: expect.objectContaining({ originalTransactionId: 'sale-1', refundType: 'full', initiatedBy: 'creator-1' }),
        }),
      });
      expect(prisma.transaction.update).toHaveBeenCalledWith({
        where: { id: 'sale-1' },
        data: { status: 'REFUNDED', metadata: expect.objectContaining({ kind: 'content_unlock', refundedTotal: 12 }) },
      });
      // Debit lands when the earning itself becomes available
      expect(ledgerEntries()).toEqual([
        expect.objectContaining({ creatorId: 'creator-1', type: 'REFUND', amount: -8.5, transactionId: 'sale-1', availableAt: earningAvailableAt }),
      ]);
      expect(prisma.creatorProfile.updateMany).toHaveBeenCalledWith({
        where: { userId: 'creator-1' },
        data: { totalEarnings: { decrement: 8.5 } },
      });
      expect(prisma.contentUnlock.deleteMany).toHaveBeenCalledWith({ where: { contentId: 'content-1', userId: 'fan-1' } });
      expect(prisma.notification.create).toHaveBeenCalledTimes(2);
    });

    it('partial refund: PARTIALLY_REFUNDED, proportional debit, access kept', async () => {
      prisma.transaction.findUnique.mockResolvedValue(sale());

      await service.refundTransaction({ requesterId: 'creator-1', requesterRole: 'CREATOR', transactionId: 'sale-1', amount: 6 });

      expect(provider.refund).toHaveBeenCalledWith(expect.objectContaining({ amount: 6, full: false }));
      expect(prisma.transaction.update).toHaveBeenCalledWith({
        where: { id: 'sale-1' },
        data: { status: 'PARTIALLY_REFUNDED', metadata: expect.objectContaining({ refundedTotal: 6 }) },
      });
      expect(ledgerEntries()).toEqual([expect.objectContaining({ type: 'REFUND', amount: -4.25 })]);
      expect(prisma.contentUnlock.deleteMany).not.toHaveBeenCalled();
    });

    it('refunds the remaining part of a partially refunded payment and then revokes access', async () => {
      prisma.transaction.findUnique.mockResolvedValue(sale({ status: 'PARTIALLY_REFUNDED', metadata: { kind: 'content_unlock', refundedTotal: 6 } }));

      await service.refundTransaction({ requesterId: 'creator-1', requesterRole: 'CREATOR', transactionId: 'sale-1' });

      // Not the whole charge at the provider: a partial refund of what is left
      expect(provider.refund).toHaveBeenCalledWith(expect.objectContaining({ amount: 6, full: false }));
      expect(prisma.transaction.update.mock.calls[0][0].data).toEqual(
        expect.objectContaining({ status: 'REFUNDED', metadata: expect.objectContaining({ refundedTotal: 12 }) }),
      );
      expect(prisma.contentUnlock.deleteMany).toHaveBeenCalled();
    });

    it('debits immediately when the earning is already available', async () => {
      prisma.creatorBalanceEntry.findFirst.mockResolvedValue({ availableAt: new Date(Date.now() - DAY) });
      const before = Date.now();

      await service.recordRefund(sale(), 12, 'refund-1', null, null);

      expect(ledgerEntries()[0].availableAt.getTime()).toBeGreaterThanOrEqual(before);
    });

    it('ends the subscription paid by a fully refunded payment', async () => {
      await service.recordRefund(
        sale({ type: 'SUBSCRIPTION', subscriptionId: 'sub-1', contentId: null, metadata: { kind: 'subscription' } }),
        12,
        'refund-1',
        null,
        null,
      );

      expect(prisma.subscription.updateMany).toHaveBeenCalledWith({
        where: { id: 'sub-1', status: { in: ['ACTIVE', 'PAST_DUE'] } },
        data: expect.objectContaining({ status: 'CANCELLED', cancelAtPeriodEnd: false }),
      });
    });

    it('relocks a PPV message on full refund', async () => {
      await service.recordRefund(sale({ contentId: null, metadata: { kind: 'message_unlock', messageId: 'msg-1' } }), 12, 'refund-1', null, null);

      expect(prisma.message.updateMany).toHaveBeenCalledWith({
        where: { id: 'msg-1', receiverId: 'fan-1' },
        data: { isPurchased: false },
      });
    });

    it('records the same provider refund only once (unique refund id)', async () => {
      prisma.$transaction.mockRejectedValueOnce(
        new Prisma.PrismaClientKnownRequestError('Unique constraint failed', { code: 'P2002', clientVersion: 'test' }),
      );

      await expect(service.recordRefund(sale(), 12, 'refund-1', null, null)).resolves.toBeUndefined();
      expect(prisma.notification.create).not.toHaveBeenCalled();
    });

    it('rethrows other database errors', async () => {
      prisma.$transaction.mockRejectedValueOnce(new Error('connection lost'));

      await expect(service.recordRefund(sale(), 12, 'refund-1', null, null)).rejects.toThrow('connection lost');
    });

    it('applies a refund reported by the provider, capped at what is left', async () => {
      prisma.transaction.findFirst.mockResolvedValue(sale({ status: 'PARTIALLY_REFUNDED', metadata: { refundedTotal: 10 } }));

      await expect(
        service.handleProviderRefund({ providerRefundId: 'r-2', providerTransactionId: 'ccb_1', amount: 5 }),
      ).resolves.toBe(true);

      expect(prisma.transaction.create.mock.calls[0][0].data).toEqual(
        expect.objectContaining({ totalAmount: 2, providerPaymentId: 'r-2' }),
      );
      expect(prisma.transaction.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({ where: expect.objectContaining({ providerTransactionId: 'ccb_1', provider: 'ccbill' }) }),
      );
    });

    it('confirms, without recording it twice, a refund already made through our API', async () => {
      prisma.transaction.findFirst.mockResolvedValue(sale({ status: 'PARTIALLY_REFUNDED', metadata: { refundedTotal: 5 } }));
      prisma.transaction.findMany.mockResolvedValueOnce([
        { id: 'refund-ours', metadata: { initiatedBy: 'creator-1', originalTransactionId: 'tx-1' } },
      ]);

      await expect(
        service.handleProviderRefund({ providerRefundId: 'ccbill-r-9', providerTransactionId: 'ccb_1', amount: 5 }),
      ).resolves.toBe(true);

      expect(prisma.transaction.create).not.toHaveBeenCalled();
      expect(prisma.transaction.update).toHaveBeenCalledWith({
        where: { id: 'refund-ours' },
        data: { metadata: expect.objectContaining({ providerConfirmed: true, providerRefundEventId: 'ccbill-r-9' }) },
      });
    });

    it('ignores a provider refund of an unknown or fully refunded charge', async () => {
      prisma.transaction.findFirst.mockResolvedValueOnce(null).mockResolvedValueOnce(sale({ metadata: { refundedTotal: 12 } }));

      await expect(service.handleProviderRefund({ providerRefundId: 'r', providerTransactionId: 'x', amount: 1 })).resolves.toBe(false);
      await expect(service.handleProviderRefund({ providerRefundId: 'r', providerTransactionId: 'x', amount: 1 })).resolves.toBe(false);
      expect(prisma.transaction.create).not.toHaveBeenCalled();
    });
  });

  describe('chargebacks', () => {
    const chargeback = { providerDisputeId: 'cb-1', providerTransactionId: 'ccb_1', amount: 12, currency: 'EUR', reason: 'Fraud' };

    it('records the dispute, marks the sale DISPUTED, debits the creator share and revokes access', async () => {
      prisma.transaction.findFirst.mockResolvedValue(sale());

      await expect(service.handleChargeback(chargeback)).resolves.toBe(true);

      expect(prisma.dispute.create).toHaveBeenCalledWith({
        data: { providerDisputeId: 'cb-1', transactionId: 'sale-1', amount: 12, currency: 'EUR', reason: 'Fraud', status: 'lost' },
      });
      expect(prisma.transaction.update).toHaveBeenCalledWith({
        where: { id: 'sale-1' },
        data: { status: 'DISPUTED', metadata: expect.objectContaining({ disputeId: 'cb-1', disputeReason: 'Fraud' }) },
      });
      expect(ledgerEntries()).toEqual([expect.objectContaining({ type: 'CHARGEBACK', amount: -8.5, transactionId: 'sale-1' })]);
      expect(prisma.contentUnlock.deleteMany).toHaveBeenCalled();
      // Creator and admins warned
      expect(prisma.notification.create.mock.calls.map(([{ data }]: any) => data.userId)).toEqual(['creator-1', 'admin-1']);
    });

    it('debits the proportional share of a partial chargeback', async () => {
      prisma.transaction.findFirst.mockResolvedValue(sale());

      await service.handleChargeback({ ...chargeback, amount: 6 });

      expect(ledgerEntries()).toEqual([expect.objectContaining({ type: 'CHARGEBACK', amount: -4.25 })]);
    });

    it('ignores a chargeback already recorded or for an unknown charge', async () => {
      prisma.transaction.findFirst.mockResolvedValueOnce(null).mockResolvedValueOnce(sale());
      await expect(service.handleChargeback(chargeback)).resolves.toBe(false);

      prisma.$transaction.mockRejectedValueOnce(
        new Prisma.PrismaClientKnownRequestError('Unique constraint failed', { code: 'P2002', clientVersion: 'test' }),
      );
      await expect(service.handleChargeback(chargeback)).resolves.toBe(false);
      expect(prisma.notification.create).not.toHaveBeenCalled();
    });

    it('gives the amount back when the chargeback is reversed', async () => {
      prisma.dispute.findUnique.mockResolvedValue({ id: 'dispute-1', status: 'lost', transaction: sale({ status: 'DISPUTED' }) });
      prisma.creatorBalanceEntry.aggregate.mockResolvedValue({ _sum: { amount: new Prisma.Decimal('-8.5') } });

      await expect(service.handleChargebackReversed({ providerDisputeId: 'cb-1', providerTransactionId: 'ccb_1' })).resolves.toBe(true);

      expect(prisma.dispute.update).toHaveBeenCalledWith({ where: { id: 'dispute-1' }, data: { status: 'won', closedAt: expect.any(Date) } });
      expect(prisma.transaction.update).toHaveBeenCalledWith({ where: { id: 'sale-1' }, data: { status: 'COMPLETED' } });
      expect(ledgerEntries()).toEqual([expect.objectContaining({ type: 'CHARGEBACK_REVERSAL', amount: 8.5, transactionId: 'sale-1' })]);
      expect(prisma.creatorProfile.updateMany).toHaveBeenCalledWith({
        where: { userId: 'creator-1' },
        data: { totalEarnings: { increment: 8.5 } },
      });
    });

    it('reverses a dispute only once', async () => {
      prisma.dispute.findUnique.mockResolvedValueOnce({ id: 'dispute-1', status: 'won', transaction: sale() }).mockResolvedValueOnce(null);

      await expect(service.handleChargebackReversed({ providerDisputeId: 'cb-1', providerTransactionId: 'ccb_1' })).resolves.toBe(false);
      await expect(service.handleChargebackReversed({ providerDisputeId: 'cb-x', providerTransactionId: 'ccb_1' })).resolves.toBe(false);
      expect(prisma.creatorBalanceEntry.create).not.toHaveBeenCalled();
    });
  });
});
