import { Injectable, Logger } from '@nestjs/common';
import { SubscriptionStatus } from '@prisma/client';
import Stripe from 'stripe';
import { PrismaService } from '../common/database/prisma.service';

/**
 * Stripe subscription metadata describing a downgrade scheduled for the end of
 * the current period. While `current_period_start < downgradeAt` the fan keeps
 * `downgradeFromTierId` (already paid for) and `downgradeTierId` is pending:
 * - paid → paid: the item price is already swapped (proration_behavior: none),
 *   so the next invoice bills the lower tier and the period rollover applies it
 * - paid → free: the subscription is cancelled at period end and the free tier
 *   is activated once Stripe reports it cancelled
 * `downgradeFromPriceId` lets an undo restore the exact price that was paid.
 */
export const DOWNGRADE_METADATA_KEYS = [
  'downgradeTierId',
  'downgradeFromTierId',
  'downgradeFromPriceId',
  'downgradeAt',
] as const;

/**
 * Set on a paid subscription created to replace a free one (free → paid
 * upgrade): the free subscription ends once the paid one is live
 */
export const REPLACES_SUBSCRIPTION_METADATA_KEY = 'replacesSubscriptionId';

// Stripe deletes metadata keys set to an empty string
export const CLEARED_DOWNGRADE_METADATA: Record<string, string> = Object.fromEntries(
  DOWNGRADE_METADATA_KEYS.map((key) => [key, '']),
);

export function buildDowngradeMetadata(params: {
  toTierId: string;
  fromTierId: string;
  fromPriceId?: string;
  at: number;
}): Record<string, string> {
  return {
    downgradeTierId: params.toTierId,
    downgradeFromTierId: params.fromTierId,
    downgradeFromPriceId: params.fromPriceId || '',
    downgradeAt: String(params.at),
  };
}

const LIVE_STATUSES: SubscriptionStatus[] = ['ACTIVE', 'PAST_DUE'];

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
   * The tier follows the subscription item's product/price (tier changes),
   * except during a scheduled downgrade (see DOWNGRADE_METADATA_KEYS).
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

    const billedTierId = await this.resolveBilledTierId(stripeSubscription);
    const { tierId: effectiveTierId, pendingTierId } = this.resolveTiers(
      stripeSubscription,
      billedTierId,
    );

    const existing = await this.prisma.subscription.findUnique({
      where: { stripeSubscriptionId: stripeSubscription.id },
      include: { tier: true },
    });

    if (existing) {
      const nextStatus = status ?? existing.status;
      const isLive = LIVE_STATUSES.includes(nextStatus);

      let nextTierId = existing.tierId;
      if (
        effectiveTierId &&
        effectiveTierId !== existing.tierId &&
        (await this.releaseTierSlot(existing.subscriberId, effectiveTierId, existing.id))
      ) {
        nextTierId = effectiveTierId;
      }

      const updated = await this.prisma.subscription.update({
        where: { id: existing.id },
        data: {
          ...periodData,
          status: nextStatus,
          tierId: nextTierId,
          pendingTierId: isLive ? pendingTierId : null,
        },
      });

      if (nextTierId !== existing.tierId) {
        this.logger.log(
          `Subscription ${existing.id} moved from tier ${existing.tierId} to ${nextTierId}`,
        );
      }

      if (nextStatus !== existing.status) {
        await this.refreshCreatorSubscriberCount(existing.tier.creatorId);

        // Paid → free downgrade: the paid subscription just ended at period end
        if (!isLive && LIVE_STATUSES.includes(existing.status) && pendingTierId) {
          await this.activatePendingFreeTier(existing.subscriberId, pendingTierId);
        }
      }

      return updated;
    }

    // Only live subscriptions may create or take over a row; late events for
    // an old, replaced Stripe subscription must not overwrite the current one
    if (status !== 'ACTIVE' && status !== 'PAST_DUE') {
      return null;
    }

    const metadata = stripeSubscription.metadata || {};
    const subscriberId = metadata.subscriberId;
    const tierId = effectiveTierId || metadata.tierId;
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
        pendingTierId,
        ...periodData,
      },
      update: {
        stripeSubscriptionId: stripeSubscription.id,
        status,
        pendingTierId,
        ...periodData,
      },
    });

    // Free → paid upgrade: end the free subscription now that the paid one is live
    const replacedId = metadata[REPLACES_SUBSCRIPTION_METADATA_KEY];
    if (replacedId && replacedId !== subscription.id) {
      await this.prisma.subscription.updateMany({
        where: {
          id: replacedId,
          subscriberId,
          stripeSubscriptionId: null,
          status: 'ACTIVE',
        },
        data: {
          status: 'CANCELLED',
          cancelledAt: new Date(),
          cancelAtPeriodEnd: false,
        },
      });
    }

    await this.refreshCreatorSubscriberCount(tier.creatorId);
    await this.notifyNewSubscriber(tier.creatorId, subscriberId, tier.name);

    this.logger.log(`Subscription ${subscription.id} synced from Stripe ${stripeSubscription.id}`);

    return subscription;
  }

  /**
   * Activate (or reactivate) a free tier subscription for one period
   */
  async activateFreeSubscription(subscriberId: string, tier: any) {
    const currentPeriodStart = new Date();
    const currentPeriodEnd = new Date(currentPeriodStart);
    if (tier.interval === 'year') {
      currentPeriodEnd.setFullYear(currentPeriodEnd.getFullYear() + 1);
    } else {
      currentPeriodEnd.setMonth(currentPeriodEnd.getMonth() + 1);
    }

    const data = {
      status: 'ACTIVE' as const,
      stripeSubscriptionId: null,
      pendingTierId: null,
      currentPeriodStart,
      currentPeriodEnd,
      cancelAtPeriodEnd: false,
      cancelledAt: null,
    };

    const subscription = await this.prisma.subscription.upsert({
      where: {
        subscriberId_tierId: { subscriberId, tierId: tier.id },
      },
      create: { subscriberId, tierId: tier.id, ...data },
      update: data,
    });

    await this.refreshCreatorSubscriberCount(tier.creatorId);
    await this.notifyNewSubscriber(tier.creatorId, subscriberId, tier.name);

    this.logger.log(`Free subscription ${subscription.id} activated for user ${subscriberId}`);

    return subscription;
  }

  /**
   * Tier currently billed by the Stripe subscription, from its item's price
   * or product (a tier keeps its product when its price changes)
   */
  private async resolveBilledTierId(stripeSubscription: Stripe.Subscription): Promise<string | null> {
    const price = stripeSubscription.items?.data?.[0]?.price;
    if (!price) {
      return null;
    }

    const productId = typeof price.product === 'string' ? price.product : price.product?.id;

    const tier = await this.prisma.subscriptionTier.findFirst({
      where: {
        OR: [{ stripePriceId: price.id }, ...(productId ? [{ stripeProductId: productId }] : [])],
      },
      select: { id: true },
    });

    return tier?.id ?? null;
  }

  /**
   * Tier the fan has access to now, and the one scheduled for the next period
   */
  private resolveTiers(
    stripeSubscription: Stripe.Subscription,
    billedTierId: string | null,
  ): { tierId: string | null; pendingTierId: string | null } {
    const metadata = stripeSubscription.metadata || {};
    const downgradeAt = Number(metadata.downgradeAt);
    const downgradePending =
      !!metadata.downgradeTierId &&
      downgradeAt > 0 &&
      stripeSubscription.current_period_start < downgradeAt;

    if (downgradePending) {
      return {
        tierId: metadata.downgradeFromTierId || billedTierId,
        pendingTierId: metadata.downgradeTierId,
      };
    }

    return { tierId: billedTierId, pendingTierId: null };
  }

  /**
   * Make room for a subscription moving to another tier: (subscriberId, tierId)
   * is unique, so an ended row on the target tier is removed (transactions only
   * reference it by id and keep their history). Returns false when a live row
   * already holds the tier.
   */
  private async releaseTierSlot(subscriberId: string, tierId: string, movingId: string) {
    const occupant = await this.prisma.subscription.findUnique({
      where: { subscriberId_tierId: { subscriberId, tierId } },
    });

    if (!occupant || occupant.id === movingId) {
      return true;
    }

    if (LIVE_STATUSES.includes(occupant.status)) {
      this.logger.warn(
        `Cannot move subscription ${movingId} to tier ${tierId}: live subscription ${occupant.id} exists`,
      );
      return false;
    }

    await this.prisma.subscription.delete({ where: { id: occupant.id } });
    return true;
  }

  /**
   * Activate the free tier a paid subscription was downgraded to
   */
  private async activatePendingFreeTier(subscriberId: string, tierId: string) {
    const tier = await this.prisma.subscriptionTier.findUnique({ where: { id: tierId } });
    if (!tier || !tier.isActive || Number(tier.price) > 0) {
      return;
    }

    // The fan may have subscribed to something else in the meantime
    const live = await this.prisma.subscription.findFirst({
      where: {
        subscriberId,
        tier: { creatorId: tier.creatorId },
        status: { in: LIVE_STATUSES },
      },
    });

    if (live) {
      return;
    }

    await this.activateFreeSubscription(subscriberId, tier);
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

    await this.sendWelcomeMessage(creatorId, subscriberId);
  }

  /**
   * Send the creator's welcome message (CreatorProfile.welcomeMessage) to a
   * new subscriber as a private message. Sent once: skipped when the
   * subscriber already received that exact message (renewals, tier changes,
   * webhook retries).
   */
  async sendWelcomeMessage(creatorId: string, subscriberId: string) {
    try {
      const profile = await this.prisma.creatorProfile.findUnique({
        where: { userId: creatorId },
        select: { welcomeMessage: true },
      });
      const content = profile?.welcomeMessage?.trim();
      if (!content) return;

      const alreadySent = await this.prisma.message.findFirst({
        where: { senderId: creatorId, receiverId: subscriberId, content },
        select: { id: true },
      });
      if (alreadySent) return;

      const message = await this.prisma.message.create({
        data: { senderId: creatorId, receiverId: subscriberId, content, status: 'SENT' },
      });

      const conversation = await this.prisma.conversation.findFirst({
        where: {
          OR: [
            { participant1Id: creatorId, participant2Id: subscriberId },
            { participant1Id: subscriberId, participant2Id: creatorId },
          ],
        },
        select: { id: true },
      });
      if (conversation) {
        await this.prisma.conversation.update({
          where: { id: conversation.id },
          data: { lastMessageId: message.id, updatedAt: new Date() },
        });
      } else {
        await this.prisma.conversation.create({
          data: { participant1Id: creatorId, participant2Id: subscriberId, lastMessageId: message.id },
        });
      }
    } catch (error) {
      this.logger.error(`Failed to send welcome message: ${error.message}`);
    }
  }
}
