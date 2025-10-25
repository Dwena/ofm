import { Injectable, Logger, BadRequestException, ForbiddenException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron, CronExpression } from '@nestjs/schedule';

import { PrismaService } from '../common/database/prisma.service';
import { StripeService } from './stripe.service';

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
}
