import {
  Injectable,
  Logger,
  BadRequestException,
  ForbiddenException,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron, CronExpression } from '@nestjs/schedule';
import { Prisma, TransactionStatus, TransactionType } from '@prisma/client';

import { PrismaService } from '../common/database/prisma.service';
import { StripeService } from './stripe.service';
import { StripeWebhookService } from './stripe-webhook.service';
import { OneTimePaymentService } from './one-time-payment.service';
import {
  FilterTransactionsDto,
  GetStatsDto,
  SendTipDto,
  StatsInterval,
  TransactionDirection,
} from './dto/payments.dto';
import { roundMoney, sumBalanceEntries, toCents } from '../common/utils/money';
import { SettingsService } from '../settings/settings.service';

@Injectable()
export class PaymentsService {
  private readonly logger = new Logger(PaymentsService.name);

  constructor(
    private prisma: PrismaService,
    private stripeService: StripeService,
    private configService: ConfigService,
    private stripeWebhookService: StripeWebhookService,
    private oneTimePayments: OneTimePaymentService,
    private settingsService: SettingsService,
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
   * @param amount Amount in euros
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

    amount = roundMoney(amount);

    // Get available balance (Stripe returns cents)
    const balance = await this.stripeService.getAccountBalance(user.stripeAccountId);
    const availableBalance = sumBalanceEntries(balance.available, 'eur');

    if (amount > availableBalance) {
      throw new BadRequestException(
        `Insufficient balance. Available: ${availableBalance.toFixed(2)}€`,
      );
    }

    // Create payout (Stripe expects cents)
    const payout = await this.stripeService.createPayout(
      user.stripeAccountId,
      toCents(amount),
    );

    // Save payout record
    const payoutRecord = await this.prisma.payout.create({
      data: {
        creatorId: userId,
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

    // Stripe balance of the connected account (cents, converted to euros below)
    const balance = user.stripeAccountId
      ? await this.stripeService.getAccountBalance(user.stripeAccountId).catch((error) => {
          this.logger.warn(`Unable to read Stripe balance for ${userId}: ${error.message}`);
          return null;
        })
      : null;
    const availableBalance = sumBalanceEntries(balance?.available, 'eur');
    const pendingBalance = sumBalanceEntries(balance?.pending, 'eur');

    const recentTransactions = await this.prisma.transaction.findMany({
      where: { toUserId: userId, type: { in: ['SUBSCRIPTION', 'TIP', 'PPV_UNLOCK'] } },
      orderBy: { createdAt: 'desc' },
      take: 5,
      select: {
        id: true,
        type: true,
        status: true,
        amount: true,
        netAmount: true,
        currency: true,
        createdAt: true,
      },
    });

    // Total payouts
    const totalPayouts = await this.prisma.payout.aggregate({
      where: {
        creatorId: userId,
        status: 'COMPLETED',
      },
      _sum: {
        amount: true,
      },
    });

    // Every amount is in euros
    return {
      currency: 'EUR',
      totalEarnings: Number(totalEarnings._sum.netAmount ?? 0),
      monthlyEarnings: Number(monthlyEarnings._sum.netAmount ?? 0),
      availableBalance,
      pendingBalance,
      availableForPayout: availableBalance,
      totalPayouts: Number(totalPayouts._sum?.amount ?? 0),
      recentTransactions: recentTransactions.map((transaction) => ({
        ...transaction,
        amount: Number(transaction.amount),
        netAmount: Number(transaction.netAmount),
      })),
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
    return this.prisma.payout.findMany({
      where: { creatorId: userId },
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

    const minPayoutAmount = await this.settingsService.getMinimumPayoutAmount(); // EUR, see /admin/settings

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
        const amount = sumBalanceEntries(balance.available, 'eur');

        // Check if balance exceeds minimum
        if (amount >= minPayoutAmount) {
          // Create payout (Stripe expects cents)
          const payout = await this.stripeService.createPayout(
            creator.stripeAccountId!,
            toCents(amount),
          );

          // Save record
          await this.prisma.payout.create({
            data: {
              creatorId: creator.id,
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
   * @param amount Amount in euros (converted to cents for Stripe)
   */
  async createPaymentIntent(userId: string, amount: number, currency: string = 'eur') {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
    });

    if (!user) {
      throw new Error('User not found');
    }

    // Create or get Stripe customer
    const customerId = await this.getOrCreateCustomerId(user);

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
   * Get the user's Stripe customer ID, creating the customer on first use
   */
  async getOrCreateCustomerId(user: {
    id: string;
    email: string;
    username: string;
    stripeCustomerId: string | null;
  }) {
    return this.oneTimePayments.getOrCreateCustomerId(user);
  }

  /**
   * List the user's saved cards
   */
  async listPaymentMethods(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { stripeCustomerId: true },
    });

    if (!user) {
      throw new NotFoundException('User not found');
    }

    // No saved card without Stripe (local stack with placeholder keys)
    if (!user.stripeCustomerId || !this.stripeService.isConfigured()) {
      return [];
    }

    const [methods, customer] = await Promise.all([
      this.stripeService.listPaymentMethods(user.stripeCustomerId),
      this.stripeService.getCustomer(user.stripeCustomerId),
    ]);

    const defaultPaymentMethod = customer.deleted
      ? null
      : customer.invoice_settings?.default_payment_method;
    const defaultId =
      typeof defaultPaymentMethod === 'string'
        ? defaultPaymentMethod
        : defaultPaymentMethod?.id;

    return methods.data.map((method) => ({
      id: method.id,
      type: 'card' as const,
      brand: method.card?.brand,
      last4: method.card?.last4,
      expMonth: method.card?.exp_month,
      expYear: method.card?.exp_year,
      isDefault: method.id === defaultId,
      createdAt: new Date(method.created * 1000).toISOString(),
    }));
  }

  /**
   * Create a setup intent so the client can save a new card with Stripe Elements
   */
  async createSetupIntent(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
    });

    if (!user) {
      throw new NotFoundException('User not found');
    }

    if (!this.stripeService.isConfigured()) {
      throw new ServiceUnavailableException('Payments are not configured');
    }

    const customerId = await this.getOrCreateCustomerId(user);
    const setupIntent = await this.stripeService.createSetupIntent(customerId);

    return {
      clientSecret: setupIntent.client_secret,
      setupIntentId: setupIntent.id,
    };
  }

  /**
   * Set a saved card as the default one
   */
  async setDefaultPaymentMethod(userId: string, paymentMethodId: string) {
    const customerId = await this.assertPaymentMethodOwnership(userId, paymentMethodId);

    await this.stripeService.setDefaultPaymentMethod(customerId, paymentMethodId);

    return { message: 'Default payment method updated' };
  }

  /**
   * Remove a saved card
   */
  async deletePaymentMethod(userId: string, paymentMethodId: string) {
    await this.assertPaymentMethodOwnership(userId, paymentMethodId);

    await this.stripeService.detachPaymentMethod(paymentMethodId);

    this.logger.log(`Payment method ${paymentMethodId} removed by user ${userId}`);

    return { message: 'Payment method removed' };
  }

  /**
   * Ensure the payment method belongs to the user's Stripe customer
   */
  async assertPaymentMethodOwnership(userId: string, paymentMethodId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { stripeCustomerId: true },
    });

    if (!user?.stripeCustomerId) {
      throw new NotFoundException('Payment method not found');
    }

    const method = await this.stripeService
      .retrievePaymentMethod(paymentMethodId)
      .catch(() => null);
    const owner = typeof method?.customer === 'string' ? method.customer : method?.customer?.id;

    if (!method || owner !== user.stripeCustomerId) {
      throw new NotFoundException('Payment method not found');
    }

    return user.stripeCustomerId;
  }

  /**
   * Handle webhook
   */
  async handleWebhook(signature: string, payload: Buffer) {
    // Same handling as /webhooks/stripe so both endpoints keep data consistent
    return this.stripeWebhookService.handleWebhook(payload, signature);
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
      // Paid to creators
      this.prisma.transaction.aggregate({
        where: {
          fromUserId: userId,
          type: { in: ['SUBSCRIPTION', 'TIP', 'PPV_UNLOCK'] },
          status: { in: paidStatuses },
        },
        _sum: { amount: true },
      }),
      // Refunds received back
      this.prisma.transaction.aggregate({
        where: { toUserId: userId, type: 'REFUND', status: 'COMPLETED' },
        _sum: { amount: true },
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
      })),
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
      // Euros
      summary: {
        totalSpent: roundMoney(Number(spent._sum.amount ?? 0)),
        totalRefunded: roundMoney(Number(refunded._sum.amount ?? 0)),
        totalReceived: roundMoney(Number(received._sum.netAmount ?? 0)),
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
        metadata: {
          originalTransactionId: transactionId,
          reason,
          description: `Refund for transaction ${transactionId}`,
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

    transactions.forEach((tx: any) => {
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

  /**
   * Send a tip to a creator. The tip stays PENDING until Stripe confirms the
   * payment (webhook or confirmTip), only then is the creator credited.
   */
  async sendTip(userId: string, creatorId: string, dto: SendTipDto) {
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
    }

    const result = await this.oneTimePayments.startPayment({
      payerId: userId,
      creatorId,
      kind: 'tip',
      amount,
      paymentMethodId: dto.paymentMethodId,
      description: `Pourboire pour @${creator.username}`,
      metadata: {
        message: dto.message?.trim() || null,
        streamId: dto.streamId,
      },
    });

    this.logger.log(`Tip started: €${amount} from ${userId} to ${creatorId} (${result.status})`);

    return result;
  }

  /**
   * Confirm a tip after the client-side Stripe confirmation (idempotent)
   */
  async confirmTip(userId: string, creatorId: string, paymentIntentId: string) {
    return this.oneTimePayments.confirmPayment(userId, paymentIntentId, {
      kind: 'tip',
      creatorId,
    });
  }
}
