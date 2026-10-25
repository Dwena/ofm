import {
  Injectable,
  Logger,
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, TransactionStatus, TransactionType } from '@prisma/client';

import { PrismaService } from '../common/database/prisma.service';
import { CreatorBalanceService } from './creator-balance.service';
import { PayoutsService } from './payouts.service';
import { PaymentFlowService, PaymentFlowResult } from './payment-flow.service';
import { RefundsService } from './refunds.service';
import {
  FilterTransactionsDto,
  GetStatsDto,
  SendTipDto,
  StatsInterval,
  TransactionDirection,
} from './dto/payments.dto';
import { roundMoney } from '../common/utils/money';
import { createPeriodMap, getPeriodKey, resolvePeriodRange } from '../common/utils/periods';
import { SettingsService } from '../settings/settings.service';

/** Context of the request starting a payment (VAT evidence, fraud checks) */
export interface PaymentRequestContext {
  ipCountry?: string | null;
  clientIp?: string | null;
}

@Injectable()
export class PaymentsService {
  private readonly logger = new Logger(PaymentsService.name);

  constructor(
    private prisma: PrismaService,
    private paymentFlow: PaymentFlowService,
    private balance: CreatorBalanceService,
    private payouts: PayoutsService,
    private refunds: RefundsService,
    private settingsService: SettingsService,
  ) {}

  /**
   * Creator earnings summary. Amounts are the creator's share (prices
   * excluding VAT minus the platform fee), in euros.
   */
  async getEarnings(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { role: true, kycStatus: true },
    });

    if (!user || user.role !== 'CREATOR') {
      throw new ForbiddenException('Only creators can view earnings');
    }

    const startOfMonth = new Date();
    startOfMonth.setDate(1);
    startOfMonth.setHours(0, 0, 0, 0);

    const earnedStatuses: TransactionStatus[] = ['COMPLETED', 'PARTIALLY_REFUNDED', 'REFUNDED', 'DISPUTED'];
    const [earned, monthly, balance, totalPayouts, recentTransactions, eligibility, minimumPayoutAmount, holdDays, feePercentage] =
      await Promise.all([
        // Ledger credits and debits of sales (refunds and chargebacks deducted)
        this.prisma.creatorBalanceEntry.aggregate({
          where: { creatorId: userId, type: { in: ['EARNING', 'REFUND', 'CHARGEBACK', 'CHARGEBACK_REVERSAL', 'ADJUSTMENT'] } },
          _sum: { amount: true },
        }),
        this.prisma.creatorBalanceEntry.aggregate({
          where: {
            creatorId: userId,
            type: { in: ['EARNING', 'REFUND', 'CHARGEBACK', 'CHARGEBACK_REVERSAL', 'ADJUSTMENT'] },
            createdAt: { gte: startOfMonth },
          },
          _sum: { amount: true },
        }),
        this.balance.getBalance(userId),
        this.prisma.payout.aggregate({
          where: { creatorId: userId, status: 'COMPLETED' },
          _sum: { amount: true },
        }),
        this.prisma.transaction.findMany({
          where: { toUserId: userId, type: { in: ['SUBSCRIPTION', 'TIP', 'PPV_UNLOCK'] }, status: { in: earnedStatuses } },
          orderBy: { createdAt: 'desc' },
          take: 5,
          select: {
            id: true,
            type: true,
            status: true,
            amount: true,
            platformFee: true,
            netAmount: true,
            currency: true,
            createdAt: true,
          },
        }),
        this.payouts.getEligibility(userId),
        this.settingsService.getMinimumPayoutAmount(),
        this.settingsService.getEarningsHoldDays(),
        this.settingsService.getPlatformFeePercentage(),
      ]);

    // Every amount is in euros
    return {
      currency: 'EUR',
      minimumPayoutAmount,
      earningsHoldDays: holdDays,
      platformFeePercentage: feePercentage,
      totalEarnings: roundMoney(Number(earned._sum.amount ?? 0)),
      monthlyEarnings: roundMoney(Number(monthly._sum.amount ?? 0)),
      availableBalance: balance.available,
      pendingBalance: balance.pending,
      availableForPayout: eligibility.eligible ? Math.max(0, balance.available) : 0,
      totalPayouts: Number(totalPayouts._sum?.amount ?? 0),
      // What is missing before payouts can be made
      payoutEligibility: eligibility,
      canSell: user.kycStatus === 'VERIFIED',
      recentTransactions: recentTransactions.map((transaction) => ({
        ...transaction,
        amount: Number(transaction.amount),
        platformFee: Number(transaction.platformFee),
        netAmount: Number(transaction.netAmount),
      })),
    };
  }

  /**
   * Movements of the creator balance (earnings, refunds, chargebacks, payouts)
   */
  async getBalanceHistory(userId: string, page = 1, limit = 20) {
    const [entries, total] = await Promise.all([
      this.prisma.creatorBalanceEntry.findMany({
        where: { creatorId: userId },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
        include: { transaction: { select: { id: true, type: true, amount: true, platformFee: true } } },
      }),
      this.prisma.creatorBalanceEntry.count({ where: { creatorId: userId } }),
    ]);

    const now = new Date();
    return {
      items: entries.map((entry) => ({
        id: entry.id,
        type: entry.type,
        amount: Number(entry.amount),
        description: entry.description,
        availableAt: entry.availableAt,
        available: entry.availableAt <= now,
        createdAt: entry.createdAt,
        transaction: entry.transaction
          ? {
              id: entry.transaction.id,
              type: entry.transaction.type,
              amount: Number(entry.transaction.amount),
              platformFee: Number(entry.transaction.platformFee),
            }
          : null,
      })),
      pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
    };
  }

  /**
   * Request a payout of the available balance
   * @param amount Euros, the whole available balance when omitted
   */
  async requestPayout(userId: string, amount?: number) {
    return this.payouts.requestPayout(userId, amount);
  }

  /**
   * Get transaction history
   */
  async getTransactions(userId: string, page: number = 1, limit: number = 20) {
    const skip = (page - 1) * limit;

    const [transactions, total] = await Promise.all([
      this.prisma.transaction.findMany({
        where: {
          OR: [
            { fromUserId: userId },
            { toUserId: userId },
          ],
        },
        orderBy: {
          createdAt: 'desc',
        },
        skip,
        take: limit,
        include: {
          fromUser: {
            select: {
              id: true,
              username: true,
              displayName: true,
              avatar: true,
            },
          },
          toUser: {
            select: {
              id: true,
              username: true,
              displayName: true,
              avatar: true,
            },
          },
        },
      }),
      this.prisma.transaction.count({
        where: {
          OR: [
            { fromUserId: userId },
            { toUserId: userId },
          ],
        },
      }),
    ]);

    return {
      items: transactions,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  /**
   * Get payout history
   */
  async getPayouts(userId: string) {
    return this.payouts.getPayouts(userId);
  }

  /**
   * Saved cards of the fan (saved at the payment provider during a payment)
   */
  async listPaymentMethods(userId: string) {
    const cards = await this.paymentFlow.listCards(userId);
    return cards.map((card) => ({
      id: card.id,
      type: 'card' as const,
      brand: card.brand,
      last4: card.last4,
      expMonth: card.expMonth,
      expYear: card.expYear,
      isDefault: card.isDefault,
      createdAt: card.createdAt.toISOString(),
    }));
  }

  /**
   * Set a saved card as the default one
   */
  async setDefaultPaymentMethod(userId: string, cardId: string) {
    await this.paymentFlow.getOwnCard(userId, cardId);

    await this.prisma.$transaction([
      this.prisma.paymentCard.updateMany({ where: { userId, isDefault: true }, data: { isDefault: false } }),
      this.prisma.paymentCard.update({ where: { id: cardId }, data: { isDefault: true } }),
    ]);

    return { message: 'Default payment method updated' };
  }

  /**
   * Remove a saved card. Subscriptions renewed with it fall back to the
   * default card at their next renewal.
   */
  async deletePaymentMethod(userId: string, cardId: string) {
    const card = await this.paymentFlow.getOwnCard(userId, cardId);

    await this.prisma.$transaction(async (tx) => {
      await tx.paymentCard.update({ where: { id: card.id }, data: { deletedAt: new Date(), isDefault: false } });
      await tx.subscription.updateMany({ where: { paymentCardId: card.id }, data: { paymentCardId: null } });

      if (card.isDefault) {
        const next = await tx.paymentCard.findFirst({
          where: { userId, deletedAt: null, id: { not: card.id } },
          orderBy: { createdAt: 'desc' },
        });
        if (next) {
          await tx.paymentCard.update({ where: { id: next.id }, data: { isDefault: true } });
        }
      }
    });

    this.logger.log(`Payment card ${cardId} removed by user ${userId}`);
    return { message: 'Payment method removed' };
  }

  /**
   * Fan's billing country, which decides the VAT rate charged
   */
  async setBillingCountry(userId: string, country: string) {
    await this.prisma.user.update({ where: { id: userId }, data: { billingCountry: country } });
    return { billingCountry: country };
  }

  /**
   * State of a payment after the provider's payment page (checkout return page)
   */
  async getPaymentStatus(userId: string, transactionId: string) {
    return this.paymentFlow.getPaymentStatus(userId, transactionId);
  }

  /**
   * Get filtered transaction history, with totals over all the user's
   * transactions (not only the current page)
   */
  async getFilteredTransactions(userId: string, filters: FilterTransactionsDto) {
    const { type, status, startDate, endDate, direction, search, page = 1, limit = 20 } = filters;
    const skip = (page - 1) * limit;

    const and: Prisma.TransactionWhereInput[] = [
      direction === TransactionDirection.SENT
        ? { fromUserId: userId }
        : direction === TransactionDirection.RECEIVED
          ? { toUserId: userId }
          : { OR: [{ fromUserId: userId }, { toUserId: userId }] },
    ];

    if (type) {
      and.push({ type: type as TransactionType });
    }

    if (status) {
      and.push({ status: status as TransactionStatus });
    }

    if (startDate || endDate) {
      const createdAt: Prisma.DateTimeFilter = {};
      if (startDate) {
        createdAt.gte = new Date(startDate);
      }
      if (endDate) {
        // A bare date (YYYY-MM-DD) includes the whole day
        const end = new Date(endDate);
        if (/^\d{4}-\d{2}-\d{2}$/.test(endDate)) {
          end.setUTCHours(23, 59, 59, 999);
        }
        createdAt.lte = end;
      }
      and.push({ createdAt });
    }

    const term = search?.trim();
    if (term) {
      // The other party of the transaction
      const userMatch: Prisma.UserWhereInput = {
        OR: [
          { username: { contains: term, mode: 'insensitive' } },
          { displayName: { contains: term, mode: 'insensitive' } },
        ],
      };
      and.push({
        OR: [
          { fromUserId: userId, toUser: userMatch },
          { toUserId: userId, fromUser: userMatch },
        ],
      });
    }

    const where: Prisma.TransactionWhereInput = { AND: and };
    const paidStatuses: TransactionStatus[] = ['COMPLETED', 'PARTIALLY_REFUNDED', 'REFUNDED', 'DISPUTED'];

    const [transactions, total, spent, refunded, received] = await Promise.all([
      this.prisma.transaction.findMany({
        where,
        orderBy: {
          createdAt: 'desc',
        },
        skip,
        take: limit,
        include: {
          fromUser: {
            select: {
              id: true,
              username: true,
              displayName: true,
              avatar: true,
            },
          },
          toUser: {
            select: {
              id: true,
              username: true,
              displayName: true,
              avatar: true,
            },
          },
        },
      }),
      this.prisma.transaction.count({ where }),
      // Paid by the fan (VAT included)
      this.prisma.transaction.aggregate({
        where: {
          fromUserId: userId,
          type: { in: ['SUBSCRIPTION', 'TIP', 'PPV_UNLOCK'] },
          status: { in: paidStatuses },
        },
        _sum: { totalAmount: true },
      }),
      // Refunds received back (VAT included)
      this.prisma.transaction.aggregate({
        where: { toUserId: userId, type: 'REFUND', status: 'COMPLETED' },
        _sum: { totalAmount: true },
      }),
      // Earnings (creators), net of the platform fee
      this.prisma.transaction.aggregate({
        where: {
          toUserId: userId,
          type: { in: ['SUBSCRIPTION', 'TIP', 'PPV_UNLOCK'] },
          status: { in: paidStatuses },
        },
        _sum: { netAmount: true },
      }),
    ]);

    return {
      items: transactions.map((transaction) => ({
        ...transaction,
        amount: Number(transaction.amount),
        platformFee: Number(transaction.platformFee),
        netAmount: Number(transaction.netAmount),
        vatRate: Number(transaction.vatRate),
        vatAmount: Number(transaction.vatAmount),
        totalAmount: Number(transaction.totalAmount),
      })),
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
      // Euros
      summary: {
        totalSpent: roundMoney(Number(spent._sum.totalAmount ?? 0)),
        totalRefunded: roundMoney(Number(refunded._sum.totalAmount ?? 0)),
        totalReceived: roundMoney(Number(received._sum.netAmount ?? 0)),
      },
    };
  }

  /**
   * Refund (part of) a payment received by the creator, or any payment for an admin
   * @param amount Euros VAT included; the whole remaining amount when omitted
   */
  async createRefund(userId: string, role: string, transactionId: string, amount?: number, reason?: string) {
    return this.refunds.refundTransaction({
      requesterId: userId,
      requesterRole: role,
      transactionId,
      amount,
      reason,
    });
  }

  /**
   * Get detailed revenue statistics by period
   */
  async getRevenueStats(userId: string, filters: GetStatsDto) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
    });

    if (!user || user.role !== 'CREATOR') {
      throw new ForbiddenException('Only creators can view revenue statistics');
    }

    const { interval = StatsInterval.MONTH, periods = 12, startDate, endDate } = filters;
    const { start, end } = resolvePeriodRange(interval, periods, startDate, endDate);

    // Creator income (net of the platform fee) in the date range
    const transactions = await this.prisma.transaction.findMany({
      where: {
        toUserId: userId,
        status: 'COMPLETED',
        createdAt: {
          gte: start,
          lte: end,
        },
      },
      orderBy: {
        createdAt: 'asc',
      },
    });

    // One bucket per period, empty ones included
    const periodMap = createPeriodMap(start, end, interval, (period) => ({
      period,
      totalRevenue: 0,
      subscriptionRevenue: 0,
      ppvRevenue: 0,
      tipRevenue: 0,
      transactionCount: 0,
      refundAmount: 0,
      netRevenue: 0,
    }));

    transactions.forEach((tx: any) => {
      const periodData = periodMap.get(getPeriodKey(tx.createdAt, interval));
      if (!periodData) return;
      const amount = Number(tx.netAmount);

      periodData.totalRevenue += amount;
      periodData.transactionCount++;

      switch (tx.type) {
        case 'SUBSCRIPTION':
          periodData.subscriptionRevenue += amount;
          break;
        case 'PPV_UNLOCK':
          periodData.ppvRevenue += amount;
          break;
        case 'TIP':
          periodData.tipRevenue += amount;
          break;
        case 'REFUND':
          periodData.refundAmount += amount;
          break;
      }
    });

    const moneyKeys = [
      'totalRevenue',
      'subscriptionRevenue',
      'ppvRevenue',
      'tipRevenue',
      'refundAmount',
      'netRevenue',
    ] as const;

    const stats = Array.from(periodMap.values()).map((data) => {
      const row = { ...data, netRevenue: data.totalRevenue - data.refundAmount };
      moneyKeys.forEach((key) => (row[key] = roundMoney(row[key])));
      return row;
    });

    const sum = (key: (typeof moneyKeys)[number] | 'transactionCount') =>
      stats.reduce((total, s) => total + s[key], 0);

    const totals = {
      totalRevenue: roundMoney(sum('totalRevenue')),
      subscriptionRevenue: roundMoney(sum('subscriptionRevenue')),
      ppvRevenue: roundMoney(sum('ppvRevenue')),
      tipRevenue: roundMoney(sum('tipRevenue')),
      refundAmount: roundMoney(sum('refundAmount')),
      netRevenue: roundMoney(sum('netRevenue')),
      transactionCount: sum('transactionCount'),
    };

    const averages = {
      avgRevenuePerPeriod: stats.length > 0 ? roundMoney(totals.totalRevenue / stats.length) : 0,
      avgTransactionsPerPeriod: stats.length > 0 ? totals.transactionCount / stats.length : 0,
    };

    return {
      interval,
      dateRange: {
        start: start.toISOString(),
        end: end.toISOString(),
      },
      periods: stats,
      totals,
      averages,
    };
  }

  /**
   * Get refund history
   */
  async getRefunds(userId: string, page: number = 1, limit: number = 20) {
    const skip = (page - 1) * limit;

    const [refunds, total] = await Promise.all([
      this.prisma.transaction.findMany({
        where: {
          OR: [
            { fromUserId: userId, type: 'REFUND' },
            { toUserId: userId, status: 'REFUNDED' },
          ],
        },
        orderBy: {
          createdAt: 'desc',
        },
        skip,
        take: limit,
        include: {
          fromUser: {
            select: {
              id: true,
              username: true,
              displayName: true,
            },
          },
          toUser: {
            select: {
              id: true,
              username: true,
              displayName: true,
            },
          },
        },
      }),
      this.prisma.transaction.count({
        where: {
          OR: [
            { fromUserId: userId, type: 'REFUND' },
            { toUserId: userId, status: 'REFUNDED' },
          ],
        },
      }),
    ]);

    return {
      items: refunds,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  /**
   * Send a tip to a creator (amount excluding VAT, VAT added on top). The tip
   * stays PENDING until the payment provider confirms it, only then is the
   * creator credited.
   */
  async sendTip(userId: string, creatorId: string, dto: SendTipDto, context: PaymentRequestContext = {}): Promise<PaymentFlowResult> {
    const amount = roundMoney(dto.amount);

    // Cannot tip yourself
    if (userId === creatorId) {
      throw new BadRequestException('You cannot tip yourself');
    }

    const creator = await this.prisma.user.findUnique({
      where: { id: creatorId },
      include: { creatorProfile: true },
    });

    if (!creator || creator.role !== 'CREATOR') {
      throw new NotFoundException('Creator not found');
    }

    if (!creator.creatorProfile) {
      throw new BadRequestException('Creator profile not found');
    }

    // Check if tips are allowed
    if (!creator.creatorProfile.allowTips) {
      throw new BadRequestException('This creator does not accept tips');
    }

    // Check minimum tip amount (euros)
    const minimumTip = Number(creator.creatorProfile.minimumTip);
    if (amount < minimumTip) {
      throw new BadRequestException(`Minimum tip amount is €${minimumTip.toFixed(2)}`);
    }

    // Tips sent from a live stream are announced in its chat once paid
    if (dto.streamId) {
      const stream = await this.prisma.liveStream.findUnique({
        where: { id: dto.streamId },
        select: { creatorId: true, status: true },
      });
      if (!stream || stream.creatorId !== creatorId) {
        throw new BadRequestException('Invalid stream');
      }
      if (stream.status !== 'LIVE') {
        throw new BadRequestException('This live stream is not in progress');
      }
    }

    // Item of the creator's tip menu (the fan may pay more than its amount)
    let menuItem: { id: string; label: string } | null = null;
    if (dto.menuItemId) {
      if (!dto.streamId) {
        throw new BadRequestException('A tip menu item can only be chosen during a live');
      }
      const item = await this.prisma.liveTipMenuItem.findUnique({
        where: { id: dto.menuItemId },
        select: { id: true, creatorId: true, label: true, amount: true, isActive: true },
      });
      if (!item || item.creatorId !== creatorId || !item.isActive) {
        throw new BadRequestException('Tip menu item not found');
      }
      if (amount < Number(item.amount)) {
        throw new BadRequestException(`This tip menu item costs at least €${Number(item.amount).toFixed(2)}`);
      }
      menuItem = { id: item.id, label: item.label };
    }

    const result = await this.paymentFlow.startPayment({
      payerId: userId,
      creatorId,
      kind: 'tip',
      amount,
      paymentCardId: dto.paymentCardId,
      billingCountry: dto.billingCountry,
      description: `Pourboire pour @${creator.username}`,
      returnPath: dto.streamId ? `/live/${dto.streamId}` : `/${creator.username}`,
      ipCountry: context.ipCountry,
      clientIp: context.clientIp,
      metadata: {
        message: dto.message?.trim() || null,
        streamId: dto.streamId,
        menuItemId: menuItem?.id,
        menuItemLabel: menuItem?.label,
      },
    });

    this.logger.log(`Tip started: €${amount} from ${userId} to ${creatorId} (${result.status})`);

    return result;
  }

  /**
   * State of a tip payment (after the provider's payment page)
   */
  async confirmTip(userId: string, creatorId: string, transactionId: string) {
    return this.paymentFlow.confirmPayment(userId, transactionId, {
      kind: 'tip',
      creatorId,
    });
  }
}
