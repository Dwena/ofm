import { Injectable, Logger, BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron, CronExpression } from '@nestjs/schedule';

import { PrismaService } from '../common/database/prisma.service';
import { StripeService } from './stripe.service';
import { FilterTransactionsDto, GetStatsDto, StatsInterval } from './dto/payments.dto';

@Injectable()
export class PaymentsService {
  private readonly logger = new Logger(PaymentsService.name);

  constructor(
    private prisma: PrismaService,
    private stripeService: StripeService,
    private configService: ConfigService,
  ) {}

  /**
   * Create Stripe Connect account for creator
   */
  async createConnectAccount(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
    });

    if (!user) {
      throw new BadRequestException('User not found');
    }

    if (user.role !== 'CREATOR') {
      throw new BadRequestException('Only creators can create Connect accounts');
    }

    if (user.stripeAccountId) {
      throw new BadRequestException('Connect account already exists');
    }

    // Create Stripe Connect account
    const account = await this.stripeService.createConnectAccount(user.email, userId);

    // Update user
    await this.prisma.user.update({
      where: { id: userId },
      data: {
        stripeAccountId: account.id,
        stripeOnboarded: false,
      },
    });

    this.logger.log(`Created Connect account for user ${userId}: ${account.id}`);

    return {
      accountId: account.id,
      message: 'Connect account created successfully',
    };
  }

  /**
   * Get onboarding link for creator
   */
  async getOnboardingLink(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
    });

    if (!user) {
      throw new BadRequestException('User not found');
    }

    if (!user.stripeAccountId) {
      throw new BadRequestException('No Connect account found. Please create one first.');
    }

    const webUrl = this.configService.get('WEB_URL', 'http://localhost:3000');
    const returnUrl = `${webUrl}/creator/onboarding/complete`;
    const refreshUrl = `${webUrl}/creator/onboarding/refresh`;

    const accountLink = await this.stripeService.createAccountLink(
      user.stripeAccountId,
      refreshUrl,
      returnUrl,
    );

    return {
      url: accountLink.url,
      expiresAt: accountLink.expires_at,
    };
  }

  /**
   * Check onboarding status
   */
  async getOnboardingStatus(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
    });

    if (!user) {
      throw new BadRequestException('User not found');
    }

    if (!user.stripeAccountId) {
      return {
        hasAccount: false,
        isOnboarded: false,
      };
    }

    const isOnboarded = await this.stripeService.isAccountOnboarded(user.stripeAccountId);
    const account = await this.stripeService.getAccount(user.stripeAccountId);

    // Update user onboarding status if changed
    if (user.stripeOnboarded !== isOnboarded) {
      await this.prisma.user.update({
        where: { id: userId },
        data: { stripeOnboarded: isOnboarded },
      });
    }

    return {
      hasAccount: true,
      isOnboarded,
      chargesEnabled: account.charges_enabled,
      payoutsEnabled: account.payouts_enabled,
      detailsSubmitted: account.details_submitted,
    };
  }

  /**
   * Request manual payout for creator
   */
  async requestPayout(userId: string, amount: number) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
    });

    if (!user) {
      throw new BadRequestException('User not found');
    }

    if (!user.stripeAccountId || !user.stripeOnboarded) {
      throw new BadRequestException('Stripe account not fully onboarded');
    }

    // Get available balance
    const balance = await this.stripeService.getAccountBalance(user.stripeAccountId);
    const availableBalance = balance.available[0]?.amount || 0;

    if (amount * 100 > availableBalance) {
      throw new BadRequestException(
        `Insufficient balance. Available: ${availableBalance / 100}`,
      );
    }

    // Create payout
    const payout = await this.stripeService.createPayout(
      user.stripeAccountId,
      amount,
    );

    // Save payout record
    const payoutRecord = await this.prisma.payout.create({
      data: {
        userId,
        amount,
        currency: 'EUR',
        status: 'PROCESSING',
        stripePayoutId: payout.id,
        destinationType: 'bank_account',
      },
    });

    this.logger.log(`Payout requested: ${payoutRecord.id}`);

    return {
      payout: payoutRecord,
      estimatedArrival: new Date(payout.arrival_date * 1000),
    };
  }

  /**
   * Get creator earnings summary
   */
  async getEarnings(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
    });

    if (!user || user.role !== 'CREATOR') {
      throw new ForbiddenException('Only creators can view earnings');
    }

    // Total earnings (all time)
    const totalEarnings = await this.prisma.transaction.aggregate({
      where: {
        toUserId: userId,
        status: 'COMPLETED',
      },
      _sum: {
        netAmount: true,
      },
    });

    // This month earnings
    const startOfMonth = new Date();
    startOfMonth.setDate(1);
    startOfMonth.setHours(0, 0, 0, 0);

    const monthlyEarnings = await this.prisma.transaction.aggregate({
      where: {
        toUserId: userId,
        status: 'COMPLETED',
        createdAt: {
          gte: startOfMonth,
        },
      },
      _sum: {
        netAmount: true,
      },
    });

    // Pending balance (to be paid out)
    const pendingBalance = user.stripeAccountId
      ? await this.stripeService.getAccountBalance(user.stripeAccountId)
      : null;

    // Total payouts
    const totalPayouts = await this.prisma.payout.aggregate({
      where: {
        userId,
        status: 'COMPLETED',
      },
      _sum: {
        amount: true,
      },
    });

    return {
      totalEarnings: totalEarnings._sum.netAmount || 0,
      monthlyEarnings: monthlyEarnings._sum.netAmount || 0,
      pendingBalance: pendingBalance?.available[0]?.amount || 0,
      totalPayouts: totalPayouts._sum.amount || 0,
      availableForPayout:
        (pendingBalance?.available[0]?.amount || 0) / 100,
    };
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
      transactions,
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
    return this.prisma.payout.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
  }

  /**
   * Automated payout job (runs daily)
   * Pays out creators with balance > threshold
   */
  @Cron(CronExpression.EVERY_DAY_AT_2AM)
  async processAutomatedPayouts() {
    this.logger.log('Running automated payouts...');

    const minPayoutAmount = 50; // Minimum 50 EUR for payout

    // Get all creators with Stripe accounts
    const creators = await this.prisma.user.findMany({
      where: {
        role: 'CREATOR',
        stripeAccountId: { not: null },
        stripeOnboarded: true,
      },
    });

    let processedCount = 0;
    let failedCount = 0;

    for (const creator of creators) {
      try {
        // Get balance
        const balance = await this.stripeService.getAccountBalance(
          creator.stripeAccountId!,
        );
        const availableAmount = balance.available[0]?.amount || 0;

        // Check if balance exceeds minimum
        if (availableAmount >= minPayoutAmount * 100) {
          const amount = availableAmount / 100;

          // Create payout
          const payout = await this.stripeService.createPayout(
            creator.stripeAccountId!,
            amount,
          );

          // Save record
          await this.prisma.payout.create({
            data: {
              userId: creator.id,
              amount,
              currency: 'EUR',
              status: 'PROCESSING',
              stripePayoutId: payout.id,
              destinationType: 'bank_account',
            },
          });

          processedCount++;
          this.logger.log(`Automated payout for ${creator.id}: €${amount}`);
        }
      } catch (error) {
        failedCount++;
        this.logger.error(
          `Failed to process payout for ${creator.id}: ${error.message}`,
        );
      }
    }

    this.logger.log(
      `Automated payouts completed: ${processedCount} processed, ${failedCount} failed`,
    );
  }

  /**
   * Create payment intent
   */
  async createPaymentIntent(userId: string, amount: number, currency: string = 'eur') {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
    });

    if (!user) {
      throw new Error('User not found');
    }

    // Create or get Stripe customer
    let customerId = user.stripeCustomerId;
    if (!customerId) {
      const customer = await this.stripeService.createCustomer(user.email, user.username);
      customerId = customer.id;

      await this.prisma.user.update({
        where: { id: userId },
        data: { stripeCustomerId: customerId },
      });
    }

    // Create payment intent
    const paymentIntent = await this.stripeService.createPaymentIntent(
      amount,
      currency,
      customerId,
    );

    return {
      clientSecret: paymentIntent.client_secret,
      paymentIntentId: paymentIntent.id,
    };
  }

  /**
   * Handle webhook
   */
  async handleWebhook(signature: string, payload: Buffer) {
    return this.stripeService.handleWebhook(signature, payload);
  }

  /**
   * Get filtered transaction history
   */
  async getFilteredTransactions(userId: string, filters: FilterTransactionsDto) {
    const { type, status, startDate, endDate, page = 1, limit = 20 } = filters;
    const skip = (page - 1) * limit;

    const where: any = {
      OR: [
        { fromUserId: userId },
        { toUserId: userId },
      ],
    };

    if (type) {
      where.type = type;
    }

    if (status) {
      where.status = status;
    }

    if (startDate || endDate) {
      where.createdAt = {};
      if (startDate) {
        where.createdAt.gte = new Date(startDate);
      }
      if (endDate) {
        where.createdAt.lte = new Date(endDate);
      }
    }

    const [transactions, total] = await Promise.all([
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
   * Create refund for a transaction
   */
  async createRefund(userId: string, transactionId: string, amount?: number, reason?: string) {
    // Get the transaction
    const transaction = await this.prisma.transaction.findUnique({
      where: { id: transactionId },
      include: {
        toUser: true,
      },
    });

    if (!transaction) {
      throw new NotFoundException('Transaction not found');
    }

    // Check if user is the creator who received the payment
    if (transaction.toUserId !== userId) {
      throw new ForbiddenException('You can only refund transactions where you are the recipient');
    }

    if (transaction.status === 'REFUNDED') {
      throw new BadRequestException('Transaction already refunded');
    }

    if (transaction.status !== 'COMPLETED') {
      throw new BadRequestException('Can only refund completed transactions');
    }

    // Calculate refund amount
    const refundAmount = amount || Number(transaction.amount);

    if (refundAmount > Number(transaction.amount)) {
      throw new BadRequestException('Refund amount cannot exceed transaction amount');
    }

    // Create refund via Stripe
    let stripeRefund;
    if (transaction.stripePaymentIntentId) {
      try {
        stripeRefund = await this.stripeService.createRefund(
          transaction.stripePaymentIntentId,
          Math.round(refundAmount * 100),
          reason,
        );
      } catch (error) {
        this.logger.error(`Stripe refund failed: ${error.message}`);
        throw new BadRequestException(`Failed to process refund: ${error.message}`);
      }
    }

    // Update transaction status
    await this.prisma.transaction.update({
      where: { id: transactionId },
      data: {
        status: 'REFUNDED',
        metadata: {
          ...(transaction.metadata as any),
          refundedAt: new Date().toISOString(),
          refundAmount,
          refundReason: reason,
          stripeRefundId: stripeRefund?.id,
        },
      },
    });

    // Create a reverse transaction for the refund
    await this.prisma.transaction.create({
      data: {
        fromUserId: transaction.toUserId,
        toUserId: transaction.fromUserId,
        type: 'REFUND',
        amount: refundAmount,
        currency: transaction.currency,
        status: 'COMPLETED',
        platformFee: 0,
        netAmount: refundAmount,
        description: `Refund for transaction ${transactionId}`,
        metadata: {
          originalTransactionId: transactionId,
          reason,
        },
      },
    });

    this.logger.log(`Refund processed: ${transactionId}, amount: ${refundAmount}`);

    return {
      message: 'Refund processed successfully',
      refundAmount,
      originalTransactionId: transactionId,
    };
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

    // Calculate date range
    const end = endDate ? new Date(endDate) : new Date();
    let start: Date;

    if (startDate) {
      start = new Date(startDate);
    } else {
      start = new Date(end);
      switch (interval) {
        case StatsInterval.DAY:
          start.setDate(start.getDate() - periods);
          break;
        case StatsInterval.WEEK:
          start.setDate(start.getDate() - (periods * 7));
          break;
        case StatsInterval.MONTH:
          start.setMonth(start.getMonth() - periods);
          break;
        case StatsInterval.YEAR:
          start.setFullYear(start.getFullYear() - periods);
          break;
      }
    }

    // Get all transactions in date range
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

    // Group transactions by period
    const stats: any[] = [];
    const periodMap = new Map<string, any>();

    transactions.forEach((tx) => {
      const periodKey = this.getPeriodKey(tx.createdAt, interval);

      if (!periodMap.has(periodKey)) {
        periodMap.set(periodKey, {
          period: periodKey,
          totalRevenue: 0,
          subscriptionRevenue: 0,
          ppvRevenue: 0,
          tipRevenue: 0,
          transactionCount: 0,
          refundAmount: 0,
          netRevenue: 0,
        });
      }

      const periodData = periodMap.get(periodKey);
      const amount = Number(tx.netAmount);

      periodData.totalRevenue += amount;
      periodData.transactionCount++;

      switch (tx.type) {
        case 'SUBSCRIPTION':
          periodData.subscriptionRevenue += amount;
          break;
        case 'PPV':
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

    // Convert map to array and calculate net revenue
    periodMap.forEach((data) => {
      data.netRevenue = data.totalRevenue - data.refundAmount;
      stats.push(data);
    });

    // Sort by period
    stats.sort((a, b) => a.period.localeCompare(b.period));

    // Calculate totals
    const totals = {
      totalRevenue: stats.reduce((sum, s) => sum + s.totalRevenue, 0),
      subscriptionRevenue: stats.reduce((sum, s) => sum + s.subscriptionRevenue, 0),
      ppvRevenue: stats.reduce((sum, s) => sum + s.ppvRevenue, 0),
      tipRevenue: stats.reduce((sum, s) => sum + s.tipRevenue, 0),
      refundAmount: stats.reduce((sum, s) => sum + s.refundAmount, 0),
      netRevenue: stats.reduce((sum, s) => sum + s.netRevenue, 0),
      transactionCount: stats.reduce((sum, s) => sum + s.transactionCount, 0),
    };

    // Calculate average per period
    const averages = {
      avgRevenuePerPeriod: stats.length > 0 ? totals.totalRevenue / stats.length : 0,
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
   * Get period key for grouping
   */
  private getPeriodKey(date: Date, interval: StatsInterval): string {
    const d = new Date(date);

    switch (interval) {
      case StatsInterval.DAY:
        return d.toISOString().split('T')[0]; // YYYY-MM-DD

      case StatsInterval.WEEK:
        const weekStart = new Date(d);
        weekStart.setDate(d.getDate() - d.getDay()); // Start of week (Sunday)
        return weekStart.toISOString().split('T')[0];

      case StatsInterval.MONTH:
        return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`; // YYYY-MM

      case StatsInterval.YEAR:
        return String(d.getFullYear()); // YYYY

      default:
        return d.toISOString().split('T')[0];
    }
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
}
