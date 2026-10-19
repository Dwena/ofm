import { Injectable, Logger } from '@nestjs/common';
import { SubscriptionStatus } from '@prisma/client';
import Stripe from 'stripe';
import { PrismaService } from '../common/database/prisma.service';

/**
 * Keeps local Subscription rows in sync with Stripe subscriptions.
 * Shared by the webhook handler and the subscriptions service (which syncs
 * right after the client confirms a payment, without waiting for the webhook).
 */
@Injectable()
export class SubscriptionSyncService {
  private readonly logger = new Logger(SubscriptionSyncService.name);

  constructor(private prisma: PrismaService) {}

  /**
   * Map a Stripe subscription status to ours.
   * Returns null for `incomplete`: the first payment is not done yet, so the
   * fan gets no access and no row is created.
   */
  mapStatus(stripeStatus: Stripe.Subscription.Status): SubscriptionStatus | null {
    switch (stripeStatus) {
      case 'active':
      case 'trialing':
        return 'ACTIVE';
      case 'past_due':
      case 'unpaid':
        return 'PAST_DUE';
      case 'canceled':
        return 'CANCELLED';
      case 'incomplete_expired':
        return 'EXPIRED';
      case 'paused':
        return 'PAUSED';
      default:
        return null;
    }
  }

  /**
   * Upsert the local subscription from a Stripe subscription object.
   * Rows are matched by stripeSubscriptionId, falling back to the
   * subscriberId/tierId metadata set when the subscription was created.
   */
  async syncFromStripe(stripeSubscription: Stripe.Subscription) {
    const status = this.mapStatus(stripeSubscription.status);

    const periodData = {
      currentPeriodStart: new Date(stripeSubscription.current_period_start * 1000),
      currentPeriodEnd: new Date(stripeSubscription.current_period_end * 1000),
      cancelAtPeriodEnd: stripeSubscription.cancel_at_period_end,
      cancelledAt: stripeSubscription.canceled_at
        ? new Date(stripeSubscription.canceled_at * 1000)
        : null,
    };

    const existing = await this.prisma.subscription.findUnique({
      where: { stripeSubscriptionId: stripeSubscription.id },
      include: { tier: true },
    });

    if (existing) {
      const nextStatus = status ?? existing.status;
      const updated = await this.prisma.subscription.update({
        where: { id: existing.id },
        data: { ...periodData, status: nextStatus },
      });

      if (nextStatus !== existing.status) {
        await this.refreshCreatorSubscriberCount(existing.tier.creatorId);
      }

      return updated;
    }

    // Only live subscriptions may create or take over a row; late events for
    // an old, replaced Stripe subscription must not overwrite the current one
    if (status !== 'ACTIVE' && status !== 'PAST_DUE') {
      return null;
    }

    const { subscriberId, tierId } = stripeSubscription.metadata || {};
    if (!subscriberId || !tierId) {
      this.logger.warn(`Stripe subscription ${stripeSubscription.id} has no OFM metadata`);
      return null;
    }

    const tier = await this.prisma.subscriptionTier.findUnique({
      where: { id: tierId },
    });

    if (!tier) {
      this.logger.warn(`Tier ${tierId} not found for Stripe subscription ${stripeSubscription.id}`);
      return null;
    }

    const subscription = await this.prisma.subscription.upsert({
      where: {
        subscriberId_tierId: { subscriberId, tierId },
      },
      create: {
        subscriberId,
        tierId,
        stripeSubscriptionId: stripeSubscription.id,
        status,
        ...periodData,
      },
      update: {
        stripeSubscriptionId: stripeSubscription.id,
        status,
        ...periodData,
      },
    });

    await this.refreshCreatorSubscriberCount(tier.creatorId);
    await this.notifyNewSubscriber(tier.creatorId, subscriberId, tier.name);

    this.logger.log(`Subscription ${subscription.id} synced from Stripe ${stripeSubscription.id}`);

    return subscription;
  }

  /**
   * Recompute the creator's subscriber counter from active subscriptions
   */
  async refreshCreatorSubscriberCount(creatorId: string) {
    const subscribers = await this.prisma.subscription.findMany({
      where: {
        tier: { creatorId },
        status: 'ACTIVE',
      },
      distinct: ['subscriberId'],
      select: { subscriberId: true },
    });

    await this.prisma.creatorProfile.updateMany({
      where: { userId: creatorId },
      data: { totalSubscribers: subscribers.length },
    });
  }

  /**
   * Notify the creator of a new subscriber
   */
  async notifyNewSubscriber(creatorId: string, subscriberId: string, tierName: string) {
    try {
      const subscriber = await this.prisma.user.findUnique({
        where: { id: subscriberId },
        select: { username: true, displayName: true },
      });

      await this.prisma.notification.create({
        data: {
          userId: creatorId,
          type: 'NEW_SUBSCRIBER',
          title: 'Nouvel abonné !',
          message: `${subscriber?.displayName || subscriber?.username || 'Un fan'} s'est abonné à votre offre ${tierName}`,
          metadata: { subscriberId },
        },
      });
    } catch (error) {
      this.logger.error(`Failed to create notification: ${error.message}`);
    }
  }
}
