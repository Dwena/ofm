import { BadRequestException, ForbiddenException, Logger, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PaymentsService } from './payments.service';
import { StatsInterval } from './dto/payments.dto';

describe('PaymentsService', () => {
  let service: PaymentsService;
  let prisma: any;
  let paymentFlow: { startPayment: jest.Mock; confirmPayment: jest.Mock; listCards: jest.Mock; getOwnCard: jest.Mock; getPaymentStatus: jest.Mock };
  let balance: { getBalance: jest.Mock };
  let payouts: { getEligibility: jest.Mock; requestPayout: jest.Mock; getPayouts: jest.Mock };
  let refunds: { refundTransaction: jest.Mock };

  const settings = {
    getPlatformFeePercentage: jest.fn(async () => 15),
    getMinimumPayoutAmount: jest.fn(async () => 50),
    getEarningsHoldDays: jest.fn(async () => 7),
  };

  const creatorUser = { id: 'creator-1', role: 'CREATOR', kycStatus: 'VERIFIED' };

  beforeEach(() => {
    jest.spyOn(Logger.prototype, 'log').mockImplementation();

    prisma = {
      user: { findUnique: jest.fn(), update: jest.fn() },
      transaction: { aggregate: jest.fn(), findMany: jest.fn(), count: jest.fn() },
      creatorBalanceEntry: { aggregate: jest.fn(), findMany: jest.fn(), count: jest.fn() },
      payout: { aggregate: jest.fn() },
      liveStream: { findUnique: jest.fn() },
      liveTipMenuItem: { findUnique: jest.fn() },
      paymentCard: { updateMany: jest.fn(), update: jest.fn(), findFirst: jest.fn() },
      subscription: { updateMany: jest.fn() },
    };
    prisma.$transaction = jest.fn(async (arg: any) => (typeof arg === 'function' ? arg(prisma) : Promise.all(arg)));

    paymentFlow = {
      startPayment: jest.fn(),
      confirmPayment: jest.fn(),
      listCards: jest.fn(),
      getOwnCard: jest.fn(),
      getPaymentStatus: jest.fn(),
    };
    balance = { getBalance: jest.fn(async () => ({ available: 123.45, pending: 9.99, total: 133.44 })) };
    payouts = {
      getEligibility: jest.fn(async () => ({ eligible: true, identityVerified: true, taxProfileComplete: true })),
      requestPayout: jest.fn(),
      getPayouts: jest.fn(),
    };
    refunds = { refundTransaction: jest.fn() };

    service = new PaymentsService(prisma, paymentFlow as any, balance as any, payouts as any, refunds as any, settings as any);
  });

  afterEach(() => jest.restoreAllMocks());

  describe('getEarnings', () => {
    beforeEach(() => {
      prisma.user.findUnique.mockResolvedValue(creatorUser);
      prisma.creatorBalanceEntry.aggregate
        .mockResolvedValueOnce({ _sum: { amount: new Prisma.Decimal('850.25') } })
        .mockResolvedValueOnce({ _sum: { amount: new Prisma.Decimal('42.5') } });
      prisma.payout.aggregate.mockResolvedValue({ _sum: { amount: new Prisma.Decimal('300') } });
      prisma.transaction.findMany.mockResolvedValue([
        {
          id: 'tx-1',
          type: 'TIP',
          status: 'COMPLETED',
          amount: new Prisma.Decimal('10'),
          platformFee: new Prisma.Decimal('1.5'),
          netAmount: new Prisma.Decimal('8.5'),
        },
      ]);
    });

    it('sums the creator ledger (refunds and chargebacks deducted) and reads the balance', async () => {
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
          earningsHoldDays: 7,
          platformFeePercentage: 15,
          canSell: true,
          payoutEligibility: { eligible: true, identityVerified: true, taxProfileComplete: true },
        }),
      );
      expect(earnings.recentTransactions[0]).toEqual(expect.objectContaining({ amount: 10, platformFee: 1.5, netAmount: 8.5 }));

      const [earned, monthly] = prisma.creatorBalanceEntry.aggregate.mock.calls.map(([args]: any) => args);
      expect(earned.where).toEqual({
        creatorId: 'creator-1',
        type: { in: ['EARNING', 'REFUND', 'CHARGEBACK', 'CHARGEBACK_REVERSAL', 'ADJUSTMENT'] },
      });
      expect(monthly.where.createdAt.gte.getDate()).toBe(1);
      expect(balance.getBalance).toHaveBeenCalledWith('creator-1');
      expect(prisma.payout.aggregate).toHaveBeenCalledWith({ where: { creatorId: 'creator-1', status: 'COMPLETED' }, _sum: { amount: true } });
    });

    it('offers no payout while the creator is not eligible', async () => {
      payouts.getEligibility.mockResolvedValue({ eligible: false, identityVerified: true, taxProfileComplete: false });

      const earnings = await service.getEarnings('creator-1');

      expect(earnings.availableForPayout).toBe(0);
      expect(earnings.availableBalance).toBe(123.45);
      expect(earnings.payoutEligibility.taxProfileComplete).toBe(false);
    });

    it('never offers a negative payout (balance in debt after chargebacks)', async () => {
      balance.getBalance.mockResolvedValue({ available: -20, pending: 0, total: -20 });

      expect((await service.getEarnings('creator-1')).availableForPayout).toBe(0);
    });

    it('is reserved to creators', async () => {
      prisma.user.findUnique.mockReset().mockResolvedValue({ role: 'SUBSCRIBER', kycStatus: 'NONE' });

      await expect(service.getEarnings('fan-1')).rejects.toThrow(ForbiddenException);
    });
  });

  it('lists the balance movements as numbers with their availability', async () => {
    const past = new Date(Date.now() - 1000);
    const future = new Date(Date.now() + 86400000);
    prisma.creatorBalanceEntry.findMany.mockResolvedValue([
      { id: 'e1', type: 'EARNING', amount: new Prisma.Decimal('8.5'), availableAt: future, createdAt: past, transaction: { id: 'tx-1', type: 'TIP', amount: new Prisma.Decimal('10'), platformFee: new Prisma.Decimal('1.5') } },
      { id: 'e2', type: 'PAYOUT', amount: new Prisma.Decimal('-50'), availableAt: past, createdAt: past, transaction: null },
    ]);
    prisma.creatorBalanceEntry.count.mockResolvedValue(2);

    const history = await service.getBalanceHistory('creator-1', 1, 20);

    expect(history.items).toEqual([
      expect.objectContaining({ id: 'e1', amount: 8.5, available: false, transaction: { id: 'tx-1', type: 'TIP', amount: 10, platformFee: 1.5 } }),
      expect.objectContaining({ id: 'e2', amount: -50, available: true, transaction: null }),
    ]);
    expect(history.pagination).toEqual({ page: 1, limit: 20, total: 2, totalPages: 1 });
  });

  it('delegates payouts and refunds', async () => {
    await service.requestPayout('creator-1', 100);
    expect(payouts.requestPayout).toHaveBeenCalledWith('creator-1', 100);

    payouts.getPayouts.mockResolvedValue([{ id: 'p1', amount: 249 }]);
    await expect(service.getPayouts('creator-1')).resolves.toEqual([{ id: 'p1', amount: 249 }]);

    await service.createRefund('creator-1', 'CREATOR', 'tx-1', 5, 'Erreur');
    expect(refunds.refundTransaction).toHaveBeenCalledWith({
      requesterId: 'creator-1',
      requesterRole: 'CREATOR',
      transactionId: 'tx-1',
      amount: 5,
      reason: 'Erreur',
    });
  });

  describe('getRevenueStats', () => {
    it('returns one rounded bucket per period, empty ones included', async () => {
      prisma.user.findUnique.mockResolvedValue(creatorUser);
      prisma.transaction.findMany.mockResolvedValue([
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

    it('is reserved to creators', async () => {
      prisma.user.findUnique.mockResolvedValue({ role: 'SUBSCRIBER' });

      await expect(service.getRevenueStats('fan-1', {})).rejects.toThrow(ForbiddenException);
    });
  });

  describe('sendTip', () => {
    const creator = {
      id: 'creator-1',
      role: 'CREATOR',
      username: 'creator',
      creatorProfile: { allowTips: true, minimumTip: new Prisma.Decimal('5') },
    };
    const started = { status: 'requires_redirect', completed: false, transactionId: 'tx-1', redirectUrl: 'https://provider/pay' };

    beforeEach(() => {
      prisma.user.findUnique.mockResolvedValue(creator);
      paymentFlow.startPayment.mockResolvedValue(started);
    });

    it('starts a tip payment with the saved card and billing country, without crediting the creator', async () => {
      prisma.liveStream.findUnique.mockResolvedValue({ creatorId: 'creator-1', status: 'LIVE' });

      const result = await service.sendTip(
        'fan-1',
        'creator-1',
        { amount: 10, message: ' Bravo ', streamId: 'stream-1', paymentCardId: 'card-1', billingCountry: 'FR' },
        { ipCountry: 'FR', clientIp: '1.2.3.4' },
      );

      expect(paymentFlow.startPayment).toHaveBeenCalledWith({
        payerId: 'fan-1',
        creatorId: 'creator-1',
        kind: 'tip',
        amount: 10,
        paymentCardId: 'card-1',
        billingCountry: 'FR',
        description: 'Pourboire pour @creator',
        returnPath: '/live/stream-1',
        ipCountry: 'FR',
        clientIp: '1.2.3.4',
        metadata: { message: 'Bravo', streamId: 'stream-1', menuItemId: undefined, menuItemLabel: undefined },
      });
      expect(result).toBe(started);
    });

    it('returns to the creator profile for a tip outside a live', async () => {
      await service.sendTip('fan-1', 'creator-1', { amount: 10.004 });

      expect(paymentFlow.startPayment).toHaveBeenCalledWith(
        expect.objectContaining({ amount: 10, returnPath: '/creator', metadata: expect.objectContaining({ message: null }) }),
      );
      expect(prisma.liveStream.findUnique).not.toHaveBeenCalled();
    });

    it('enforces the minimum tip and refuses self tips', async () => {
      await expect(service.sendTip('fan-1', 'creator-1', { amount: 2 })).rejects.toThrow('Minimum tip amount is €5.00');
      await expect(service.sendTip('creator-1', 'creator-1', { amount: 10 })).rejects.toThrow(BadRequestException);
      expect(paymentFlow.startPayment).not.toHaveBeenCalled();
    });

    it('refuses a creator who does not accept tips, and a user who is not a creator', async () => {
      prisma.user.findUnique.mockResolvedValueOnce({ ...creator, creatorProfile: { ...creator.creatorProfile, allowTips: false } });
      await expect(service.sendTip('fan-1', 'creator-1', { amount: 10 })).rejects.toThrow('This creator does not accept tips');

      prisma.user.findUnique.mockResolvedValueOnce({ ...creator, role: 'SUBSCRIBER' });
      await expect(service.sendTip('fan-1', 'creator-1', { amount: 10 })).rejects.toThrow(NotFoundException);
      expect(paymentFlow.startPayment).not.toHaveBeenCalled();
    });

    it("refuses a stream that is not the creator's", async () => {
      prisma.liveStream.findUnique.mockResolvedValue({ creatorId: 'someone-else', status: 'LIVE' });

      await expect(service.sendTip('fan-1', 'creator-1', { amount: 10, streamId: 'stream-1' })).rejects.toThrow('Invalid stream');
    });

    it('refuses a tip from a live that is not in progress', async () => {
      for (const status of ['SCHEDULED', 'ENDED', 'CANCELLED']) {
        prisma.liveStream.findUnique.mockResolvedValue({ creatorId: 'creator-1', status });
        await expect(service.sendTip('fan-1', 'creator-1', { amount: 10, streamId: 'stream-1' })).rejects.toThrow(
          'This live stream is not in progress',
        );
      }
      expect(paymentFlow.startPayment).not.toHaveBeenCalled();
    });

    describe('with a tip menu item', () => {
      const menuItem = {
        id: 'item-1',
        creatorId: 'creator-1',
        label: 'Chanter une chanson',
        amount: new Prisma.Decimal('20'),
        isActive: true,
      };

      beforeEach(() => {
        prisma.liveStream.findUnique.mockResolvedValue({ creatorId: 'creator-1', status: 'LIVE' });
      });

      it('stores the item and its label in the transaction metadata', async () => {
        prisma.liveTipMenuItem.findUnique.mockResolvedValue(menuItem);

        await service.sendTip('fan-1', 'creator-1', { amount: 25, streamId: 'stream-1', menuItemId: 'item-1' });

        expect(paymentFlow.startPayment).toHaveBeenCalledWith(
          expect.objectContaining({
            amount: 25,
            metadata: expect.objectContaining({ streamId: 'stream-1', menuItemId: 'item-1', menuItemLabel: 'Chanter une chanson' }),
          }),
        );
      });

      it('refuses an amount below the item amount', async () => {
        prisma.liveTipMenuItem.findUnique.mockResolvedValue(menuItem);

        await expect(
          service.sendTip('fan-1', 'creator-1', { amount: 19.99, streamId: 'stream-1', menuItemId: 'item-1' }),
        ).rejects.toThrow('This tip menu item costs at least €20.00');
        expect(paymentFlow.startPayment).not.toHaveBeenCalled();
      });

      it("refuses another creator's item, a hidden item or an unknown one", async () => {
        for (const item of [{ ...menuItem, creatorId: 'someone-else' }, { ...menuItem, isActive: false }, null]) {
          prisma.liveTipMenuItem.findUnique.mockResolvedValue(item);
          await expect(
            service.sendTip('fan-1', 'creator-1', { amount: 50, streamId: 'stream-1', menuItemId: 'item-1' }),
          ).rejects.toThrow('Tip menu item not found');
        }
        expect(paymentFlow.startPayment).not.toHaveBeenCalled();
      });

      it('requires the live the tip is sent from', async () => {
        await expect(service.sendTip('fan-1', 'creator-1', { amount: 50, menuItemId: 'item-1' })).rejects.toThrow(
          'A tip menu item can only be chosen during a live',
        );
        expect(prisma.liveTipMenuItem.findUnique).not.toHaveBeenCalled();
      });
    });

    it('confirms through the payment flow, checking it is a tip to this creator', async () => {
      await service.confirmTip('fan-1', 'creator-1', 'tx-1');

      expect(paymentFlow.confirmPayment).toHaveBeenCalledWith('fan-1', 'tx-1', { kind: 'tip', creatorId: 'creator-1' });
    });
  });

  describe('getFilteredTransactions', () => {
    beforeEach(() => {
      prisma.transaction.findMany.mockResolvedValue([
        {
          id: 'tx-1',
          amount: new Prisma.Decimal('9.99'),
          platformFee: new Prisma.Decimal('1.5'),
          netAmount: new Prisma.Decimal('8.49'),
          vatRate: new Prisma.Decimal('20'),
          vatAmount: new Prisma.Decimal('2'),
          totalAmount: new Prisma.Decimal('11.99'),
        },
      ]);
      prisma.transaction.count.mockResolvedValue(21);
      prisma.transaction.aggregate
        .mockResolvedValueOnce({ _sum: { totalAmount: new Prisma.Decimal('71.97') } })
        .mockResolvedValueOnce({ _sum: { totalAmount: new Prisma.Decimal('11.99') } })
        .mockResolvedValueOnce({ _sum: { netAmount: null } });
    });

    it('filters sent transactions by type, status, other party and whole end day', async () => {
      const result = await service.getFilteredTransactions('fan-1', {
        type: 'TIP' as any,
        status: 'COMPLETED' as any,
        direction: 'sent' as any,
        search: ' alice ',
        endDate: '2026-10-19',
        page: 2,
        limit: 20,
      });

      const { where, skip, take } = prisma.transaction.findMany.mock.calls[0][0];
      expect(skip).toBe(20);
      expect(take).toBe(20);
      expect(where.AND).toEqual(
        expect.arrayContaining([
          { fromUserId: 'fan-1' },
          { type: 'TIP' },
          { status: 'COMPLETED' },
          { createdAt: { lte: new Date('2026-10-19T23:59:59.999Z') } },
          expect.objectContaining({
            OR: [
              expect.objectContaining({ fromUserId: 'fan-1', toUser: expect.anything() }),
              expect.objectContaining({ toUserId: 'fan-1', fromUser: expect.anything() }),
            ],
          }),
        ]),
      );
      expect(JSON.stringify(where)).toContain('"contains":"alice"');
      expect(result.items[0]).toEqual(
        expect.objectContaining({ amount: 9.99, platformFee: 1.5, netAmount: 8.49, vatRate: 20, vatAmount: 2, totalAmount: 11.99 }),
      );
      expect(result.pagination).toEqual({ page: 2, limit: 20, total: 21, totalPages: 2 });
      expect(result.summary).toEqual({ totalSpent: 71.97, totalRefunded: 11.99, totalReceived: 0 });
    });

    it('sums what the fan paid and got back VAT included', async () => {
      await service.getFilteredTransactions('fan-1', {});

      const [spent, refunded, received] = prisma.transaction.aggregate.mock.calls.map(([args]: any) => args);
      expect(spent).toEqual({
        where: {
          fromUserId: 'fan-1',
          type: { in: ['SUBSCRIPTION', 'TIP', 'PPV_UNLOCK'] },
          status: { in: ['COMPLETED', 'PARTIALLY_REFUNDED', 'REFUNDED', 'DISPUTED'] },
        },
        _sum: { totalAmount: true },
      });
      expect(refunded).toEqual({ where: { toUserId: 'fan-1', type: 'REFUND', status: 'COMPLETED' }, _sum: { totalAmount: true } });
      expect(received._sum).toEqual({ netAmount: true });
    });

    it('includes both directions by default', async () => {
      await service.getFilteredTransactions('fan-1', {});

      const { where } = prisma.transaction.findMany.mock.calls[0][0];
      expect(where.AND).toEqual([{ OR: [{ fromUserId: 'fan-1' }, { toUserId: 'fan-1' }] }]);
    });
  });

  describe('saved cards', () => {
    const card = { id: 'card-1', userId: 'fan-1', isDefault: false };

    it('lists the saved cards', async () => {
      paymentFlow.listCards.mockResolvedValue([
        { id: 'card-1', brand: 'VISA', last4: '4242', expMonth: 4, expYear: 2028, isDefault: true, createdAt: new Date('2026-10-01T00:00:00Z') },
      ]);

      await expect(service.listPaymentMethods('fan-1')).resolves.toEqual([
        { id: 'card-1', type: 'card', brand: 'VISA', last4: '4242', expMonth: 4, expYear: 2028, isDefault: true, createdAt: '2026-10-01T00:00:00.000Z' },
      ]);
    });

    it('sets the default card', async () => {
      paymentFlow.getOwnCard.mockResolvedValue(card);

      await service.setDefaultPaymentMethod('fan-1', 'card-1');

      expect(paymentFlow.getOwnCard).toHaveBeenCalledWith('fan-1', 'card-1');
      expect(prisma.paymentCard.updateMany).toHaveBeenCalledWith({ where: { userId: 'fan-1', isDefault: true }, data: { isDefault: false } });
      expect(prisma.paymentCard.update).toHaveBeenCalledWith({ where: { id: 'card-1' }, data: { isDefault: true } });
      expect(prisma.$transaction).toHaveBeenCalled();
    });

    it("refuses another user's card", async () => {
      paymentFlow.getOwnCard.mockRejectedValue(new NotFoundException('Payment method not found'));

      await expect(service.setDefaultPaymentMethod('fan-1', 'card-x')).rejects.toThrow(NotFoundException);
      await expect(service.deletePaymentMethod('fan-1', 'card-x')).rejects.toThrow(NotFoundException);
      expect(prisma.paymentCard.update).not.toHaveBeenCalled();
    });

    it('deletes a card: soft delete and subscriptions fall back to the default card', async () => {
      paymentFlow.getOwnCard.mockResolvedValue(card);

      await service.deletePaymentMethod('fan-1', 'card-1');

      expect(prisma.paymentCard.update).toHaveBeenCalledWith({
        where: { id: 'card-1' },
        data: { deletedAt: expect.any(Date), isDefault: false },
      });
      expect(prisma.subscription.updateMany).toHaveBeenCalledWith({ where: { paymentCardId: 'card-1' }, data: { paymentCardId: null } });
      expect(prisma.paymentCard.findFirst).not.toHaveBeenCalled();
    });

    it('makes the most recent remaining card the default one when the default card is deleted', async () => {
      paymentFlow.getOwnCard.mockResolvedValue({ ...card, isDefault: true });
      prisma.paymentCard.findFirst.mockResolvedValue({ id: 'card-2' });

      await service.deletePaymentMethod('fan-1', 'card-1');

      expect(prisma.paymentCard.findFirst).toHaveBeenCalledWith({
        where: { userId: 'fan-1', deletedAt: null, id: { not: 'card-1' } },
        orderBy: { createdAt: 'desc' },
      });
      expect(prisma.paymentCard.update).toHaveBeenLastCalledWith({ where: { id: 'card-2' }, data: { isDefault: true } });
    });
  });

  it('saves the billing country', async () => {
    await expect(service.setBillingCountry('fan-1', 'BE')).resolves.toEqual({ billingCountry: 'BE' });
    expect(prisma.user.update).toHaveBeenCalledWith({ where: { id: 'fan-1' }, data: { billingCountry: 'BE' } });
  });
});
