import { Injectable, Logger } from '@nestjs/common';
import { Prisma, SubscriptionStatus } from '@prisma/client';
import { PrismaService } from '../common/database/prisma.service';

export const LIVE_STATUSES: SubscriptionStatus[] = ['ACTIVE', 'PAST_DUE'];

/** End of a billing period starting at `start` for a tier interval (month / year) */
export function addInterval(start: Date, interval: string): Date {
  const end = new Date(start);
  if (interval === 'year') {
    end.setFullYear(end.getFullYear() + 1);
  } else {
    end.setMonth(end.getMonth() + 1);
  }
  return end;
}

/**
 * Local subscription rows: free tier activation, tier slot management,
 * subscriber counters and the welcome message. Paid periods are opened by
 * SubscriptionBillingService when their payment completes.
 */
@Injectable()
export class SubscriptionSyncService {
  private readonly logger = new Logger(SubscriptionSyncService.name);

  constructor(private prisma: PrismaService) {}

  /**
   * Activate (or reactivate) a free tier subscription for one period
   */
  async activateFreeSubscription(subscriberId: string, tier: any) {
    const currentPeriodStart = new Date();
    const currentPeriodEnd = addInterval(currentPeriodStart, tier.interval);

    const data = {
      status: 'ACTIVE' as const,
      paymentCardId: null,
      renewalAttempts: 0,
      nextRenewalAttemptAt: null,
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
   * Make room for a subscription moving to another tier: (subscriberId, tierId)
   * is unique, so an ended row on the target tier is removed (transactions only
   * reference it by id and keep their history). Returns false when a live row
   * already holds the tier.
   */
  async releaseTierSlot(
    subscriberId: string,
    tierId: string,
    movingId: string,
    client: Prisma.TransactionClient | PrismaService = this.prisma,
  ) {
    const occupant = await client.subscription.findUnique({
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

    await client.subscription.delete({ where: { id: occupant.id } });
    return true;
  }

  /**
   * Activate the free tier a paid subscription was downgraded to
   */
  async activatePendingFreeTier(subscriberId: string, tierId: string) {
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
