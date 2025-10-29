import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../common/database/prisma.service';
import { StripeService } from './stripe.service';

@Injectable()
export class BillingService {
  private readonly logger = new Logger(BillingService.name);

  constructor(
    private prisma: PrismaService,
    private stripeService: StripeService,
  ) {}

  /**
   * Automatic billing for active subscriptions
   * Runs daily at 2 AM
   */
  @Cron(CronExpression.EVERY_DAY_AT_2AM)
  async processSubscriptionRenewals() {
    this.logger.log('Starting automatic subscription renewals...');

    const now = new Date();

    // Find subscriptions that need renewal (current period ends today or before)
    const subscriptionsToRenew = await this.prisma.subscription.findMany({
      where: {
        status: 'ACTIVE',
        currentPeriodEnd: {
          lte: now,
        },
      },
      include: {
        subscriber: true,
        tier: {
          include: {
            creator: true,
          },
        },
      },
    });

    this.logger.log(`Found ${subscriptionsToRenew.length} subscriptions to renew`);

    let successCount = 0;
    let failureCount = 0;

    for (const subscription of subscriptionsToRenew) {
      try {
        await this.renewSubscription(subscription);
        successCount++;
      } catch (error) {
        this.logger.error(
          `Failed to renew subscription ${subscription.id}: ${error.message}`,
          error.stack,
        );
        failureCount++;
      }
    }

    this.logger.log(
      `Subscription renewals completed. Success: ${successCount}, Failed: ${failureCount}`,
    );

    return { successCount, failureCount };
  }

  /**
   * Renew a single subscription
   */
  private async renewSubscription(subscription: any) {
    this.logger.log(`Renewing subscription ${subscription.id}`);

    const { tier, subscriber } = subscription;

    if (!subscriber.stripeCustomerId) {
      throw new Error('Subscriber has no Stripe customer ID');
    }

    try {
      // Stripe subscriptions are handled automatically by Stripe
      // This is mainly for tracking and notification purposes

      // Calculate new period
      const currentPeriodStart = new Date();
      const currentPeriodEnd = new Date();

      switch (tier.billingPeriod) {
        case 'MONTHLY':
          currentPeriodEnd.setMonth(currentPeriodEnd.getMonth() + 1);
          break;
        case 'YEARLY':
          currentPeriodEnd.setFullYear(currentPeriodEnd.getFullYear() + 1);
          break;
        default:
          currentPeriodEnd.setMonth(currentPeriodEnd.getMonth() + 1);
      }

      // Update subscription
      await this.prisma.subscription.update({
        where: { id: subscription.id },
        data: {
          currentPeriodStart,
          currentPeriodEnd,
          updatedAt: new Date(),
        },
      });

      // Create transaction record
      await this.prisma.transaction.create({
        data: {
          fromUserId: subscriber.id,
          toUserId: tier.creatorId,
          type: 'SUBSCRIPTION',
          status: 'COMPLETED',
          amount: tier.price,
          currency: 'EUR',
          platformFee: Math.floor(Number(tier.price) * 0.1), // 10% platform fee
          netAmount: Math.floor(Number(tier.price) * 0.9),
          subscriptionId: subscription.id,
          processedAt: new Date(),
        },
      });

      // Notify creator
      await this.createNotification({
        userId: tier.creatorId,
        type: 'SUBSCRIPTION_RENEWAL',
        title: 'Renouvellement d\'abonnement',
        message: `L'abonnement de ${subscriber.username} a été renouvelé`,
      });

      this.logger.log(`Subscription ${subscription.id} renewed successfully`);
    } catch (error) {
      // If payment fails, mark subscription as past due
      await this.prisma.subscription.update({
        where: { id: subscription.id },
        data: {
          status: 'PAST_DUE',
        },
      });

      // Notify subscriber
      await this.createNotification({
        userId: subscriber.id,
        type: 'PAYMENT_FAILED',
        title: 'Échec du renouvellement',
        message: 'Le renouvellement de votre abonnement a échoué. Veuillez mettre à jour votre moyen de paiement.',
      });

      throw error;
    }
  }

  /**
   * Cancel expired subscriptions
   * Runs daily at 3 AM
   */
  @Cron(CronExpression.EVERY_DAY_AT_3AM)
  async cancelExpiredSubscriptions() {
    this.logger.log('Canceling expired subscriptions...');

    const gracePeriodDays = 3;
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - gracePeriodDays);

    const expiredSubscriptions = await this.prisma.subscription.findMany({
      where: {
        status: 'PAST_DUE',
        currentPeriodEnd: {
          lte: cutoffDate,
        },
      },
      include: {
        subscriber: true,
      },
    });

    this.logger.log(`Found ${expiredSubscriptions.length} expired subscriptions to cancel`);

    for (const subscription of expiredSubscriptions) {
      try {
        // Cancel in Stripe if exists
        if (subscription.stripeSubscriptionId) {
          await this.stripeService.cancelSubscription(subscription.stripeSubscriptionId);
        }

        // Update in database
        await this.prisma.subscription.update({
          where: { id: subscription.id },
          data: {
            status: 'CANCELLED',
            cancelledAt: new Date(),
          },
        });

        // Notify subscriber
        await this.createNotification({
          userId: subscription.subscriberId,
          type: 'SUBSCRIPTION_CANCELLED',
          title: 'Abonnement annulé',
          message: 'Votre abonnement a été annulé suite à des échecs de paiement répétés.',
        });

        this.logger.log(`Expired subscription ${subscription.id} cancelled`);
      } catch (error) {
        this.logger.error(
          `Failed to cancel subscription ${subscription.id}: ${error.message}`,
          error.stack,
        );
      }
    }

    return { cancelledCount: expiredSubscriptions.length };
  }

  /**
   * Process pending payouts to creators
   * Runs every Monday at 9 AM
   */
  @Cron(CronExpression.MONDAY_TO_FRIDAY_AT_9AM)
  async processPendingPayouts() {
    this.logger.log('Processing pending payouts...');

    const minimumPayoutAmount = 5000; // 50 EUR in cents

    // Get creators with completed transactions
    const creatorsWithBalance = await this.prisma.user.findMany({
      where: {
        role: 'CREATOR',
        stripeAccountId: { not: null },
        stripeOnboarded: true,
      },
    });

    let processedCount = 0;

    for (const creator of creatorsWithBalance) {
      try {
        // Calculate available balance
        const transactions = await this.prisma.transaction.findMany({
          where: {
            toUserId: creator.id,
            status: 'COMPLETED',
            type: { in: ['SUBSCRIPTION', 'TIP', 'PPV_UNLOCK'] },
          },
        });

        const payouts = await this.prisma.payout.findMany({
          where: {
            creatorId: creator.id,
            status: { in: ['PENDING', 'PROCESSING', 'PAID'] },
          },
        });

        const totalEarned = transactions.reduce(
          (sum: number, tx: any) => sum + Number(tx.netAmount),
          0,
        );
        const totalPaidOut = payouts.reduce(
          (sum: number, payout: any) => sum + Number(payout.amount),
          0,
        );

        const availableBalance = totalEarned - totalPaidOut;

        if (availableBalance >= minimumPayoutAmount) {
          await this.createPayout(creator.id, availableBalance);
          processedCount++;
        }
      } catch (error) {
        this.logger.error(
          `Failed to process payout for creator ${creator.id}: ${error.message}`,
          error.stack,
        );
      }
    }

    this.logger.log(`Processed ${processedCount} payouts`);

    return { processedCount };
  }

  /**
   * Create a payout for a creator
   */
  private async createPayout(creatorId: string, amount: number) {
    const creator = await this.prisma.user.findUnique({
      where: { id: creatorId },
    });

    if (!creator || !creator.stripeAccountId) {
      throw new Error('Creator does not have a Stripe account');
    }

    // Create payout in database
    const payout = await this.prisma.payout.create({
      data: {
        creatorId,
        amount,
        currency: 'EUR',
        status: 'PENDING',
        destinationType: 'bank_account',
      },
    });

    try {
      // Create payout in Stripe
      const stripePayout = await this.stripeService.createPayout(
        creator.stripeAccountId,
        amount,
      );

      // Update with Stripe payout ID
      await this.prisma.payout.update({
        where: { id: payout.id },
        data: {
          stripePayoutId: stripePayout.id,
          status: 'PROCESSING',
          processedAt: new Date(),
        },
      });

      this.logger.log(`Payout created for creator ${creatorId}: ${amount / 100} EUR`);

      // Notify creator
      await this.createNotification({
        userId: creatorId,
        type: 'PAYOUT_PROCESSING',
        title: 'Paiement en cours',
        message: `Votre paiement de ${(amount / 100).toFixed(2)}€ est en cours de traitement.`,
      });

      return payout;
    } catch (error) {
      // Mark payout as failed
      await this.prisma.payout.update({
        where: { id: payout.id },
        data: {
          status: 'FAILED',
          failedAt: new Date(),
          failureReason: error.message,
        },
      });

      throw error;
    }
  }

  /**
   * Send payment reminders for past due subscriptions
   * Runs daily at 10 AM
   */
  @Cron(CronExpression.EVERY_DAY_AT_10AM)
  async sendPaymentReminders() {
    this.logger.log('Sending payment reminders...');

    const pastDueSubscriptions = await this.prisma.subscription.findMany({
      where: {
        status: 'PAST_DUE',
      },
      include: {
        subscriber: true,
        tier: true,
      },
    });

    let sentCount = 0;

    for (const subscription of pastDueSubscriptions) {
      try {
        await this.createNotification({
          userId: subscription.subscriberId,
          type: 'PAYMENT_REMINDER',
          title: 'Rappel de paiement',
          message: `Votre abonnement est en attente de paiement. Veuillez mettre à jour votre moyen de paiement pour continuer à profiter du contenu.`,
        });

        sentCount++;
      } catch (error) {
        this.logger.error(
          `Failed to send reminder for subscription ${subscription.id}: ${error.message}`,
        );
      }
    }

    this.logger.log(`Sent ${sentCount} payment reminders`);

    return { sentCount };
  }

  /**
   * Clean up old cancelled subscriptions
   * Runs monthly on the 1st at 4 AM
   */
  @Cron('0 4 1 * *')
  async cleanupOldSubscriptions() {
    this.logger.log('Cleaning up old cancelled subscriptions...');

    const cutoffDate = new Date();
    cutoffDate.setMonth(cutoffDate.getMonth() - 6); // 6 months ago

    const result = await this.prisma.subscription.deleteMany({
      where: {
        status: 'CANCELLED',
        cancelledAt: {
          lte: cutoffDate,
        },
      },
    });

    this.logger.log(`Cleaned up ${result.count} old cancelled subscriptions`);

    return { cleanedUp: result.count };
  }

  /**
   * Helper: Create notification
   */
  private async createNotification(data: {
    userId: string;
    type: string;
    title: string;
    message: string;
  }) {
    try {
      await this.prisma.notification.create({
        data: {
          userId: data.userId,
          type: data.type as any,
          title: data.title,
          message: data.message,
        },
      });
    } catch (error) {
      this.logger.error(`Failed to create notification: ${error.message}`);
    }
  }
}
