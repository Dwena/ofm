import { Injectable, Logger, BadRequestException, NotFoundException, ForbiddenException } from '@nestjs/common';
import { PrismaService } from '../common/database/prisma.service';
import { BillingService } from '../payments/billing.service';
import { PaymentFlowResult, PaymentFlowService } from '../payments/payment-flow.service';
import { SubscriptionSyncService } from '../payments/subscription-sync.service';
import type { PaymentRequestContext } from '../payments/payments.service';
import { CreateTierDto, UpdateTierDto } from './dto/subscription-tier.dto';
import { SubscribeDto, ChangeTierDto, RetryPaymentDto } from './dto/subscribe.dto';

const tierCreatorSelect = {
  select: {
    id: true,
    username: true,
  },
} as const;

const pendingTierSelect = {
  select: { id: true, name: true, price: true, interval: true },
} as const;

export const SUBSCRIPTION_STATUSES = ['ACTIVE', 'CANCELLED', 'EXPIRED', 'PAST_DUE', 'PAUSED'] as const;
export type SubscriptionStatusFilter = (typeof SUBSCRIPTION_STATUSES)[number];

@Injectable()
export class SubscriptionsService {
  private readonly logger = new Logger(SubscriptionsService.name);

  constructor(
    private prisma: PrismaService,
    private billing: BillingService,
    private paymentFlow: PaymentFlowService,
    private subscriptionSync: SubscriptionSyncService,
  ) {}

  async getCreatorTiers(creatorId: string) {
    return this.prisma.subscriptionTier.findMany({
      where: {
        creatorId,
        isActive: true,
      },
      orderBy: {
        price: 'asc',
      },
    });
  }

  async getUserSubscriptions(userId: string) {
    return this.prisma.subscription.findMany({
      where: {
        subscriberId: userId,
      },
      include: {
        tier: {
          include: {
            creator: {
              select: {
                id: true,
                username: true,
                displayName: true,
                avatar: true,
              },
            },
          },
        },
        pendingTier: pendingTierSelect,
      },
      orderBy: {
        createdAt: 'desc',
      },
    });
  }

  /**
   * Subscriptions to the creator's tiers (every status, so the creator can
   * filter on cancelled / expired ones too), each with what that subscriber
   * has spent on the creator overall (completed transactions, euros).
   */
  async getCreatorSubscribers(creatorId: string, status?: SubscriptionStatusFilter) {
    const subscriptions = await this.prisma.subscription.findMany({
      where: {
        tier: {
          creatorId,
        },
        ...(status && { status }),
      },
      include: {
        subscriber: {
          select: {
            id: true,
            username: true,
            displayName: true,
            avatar: true,
          },
        },
        tier: {
          select: { id: true, name: true, price: true, currency: true, interval: true, isActive: true },
        },
        pendingTier: pendingTierSelect,
      },
      orderBy: {
        createdAt: 'desc',
      },
    });

    const subscriberIds = [...new Set(subscriptions.map((s: any) => s.subscriberId))];
    const spent = subscriberIds.length
      ? await this.prisma.transaction.groupBy({
          by: ['fromUserId'],
          where: {
            toUserId: creatorId,
            fromUserId: { in: subscriberIds },
            status: 'COMPLETED',
          },
          _sum: { amount: true },
        })
      : [];
    const spentBySubscriber = new Map<string, number>(
      spent.map((row: any) => [row.fromUserId, Number(row._sum?.amount ?? 0)]),
    );

    return subscriptions.map((subscription: any) => ({
      ...subscription,
      totalSpent: spentBySubscriber.get(subscription.subscriberId) ?? 0,
    }));
  }

  // Tier Management
  async createTier(creatorId: string, dto: CreateTierDto) {
    // Verify user is a creator
    const user = await this.prisma.user.findUnique({
      where: { id: creatorId },
      select: { role: true },
    });

    if (user?.role !== 'CREATOR') {
      throw new ForbiddenException('Only creators can create subscription tiers');
    }

    // Create tier
    const tier = await this.prisma.subscriptionTier.create({
      data: {
        creatorId,
        name: dto.name,
        description: dto.description,
        price: dto.price,
        currency: dto.currency || 'EUR',
        interval: dto.interval || 'month',
        benefits: dto.benefits || [],
        isActive: dto.isActive !== undefined ? dto.isActive : true,
      },
    });

    this.logger.log(`Tier created: ${tier.id} by creator ${creatorId}`);
    return tier;
  }

  async getMyTiers(creatorId: string) {
    // Verify user is a creator
    const user = await this.prisma.user.findUnique({
      where: { id: creatorId },
      select: { role: true },
    });

    if (user?.role !== 'CREATOR') {
      throw new ForbiddenException('Only creators can view their tiers');
    }

    const tiers = await this.prisma.subscriptionTier.findMany({
      where: { creatorId },
      orderBy: { price: 'asc' },
    });

    // Subscription counts per tier and status, in one query
    const counts = tiers.length
      ? await this.prisma.subscription.groupBy({
          by: ['tierId', 'status'],
          where: { tierId: { in: tiers.map((tier: any) => tier.id) } },
          _count: { _all: true },
        })
      : [];

    return tiers.map((tier: any) => {
      const tierCounts = counts.filter((row: any) => row.tierId === tier.id);
      const subscribersCount = tierCounts
        .filter((row: any) => row.status === 'ACTIVE')
        .reduce((sum: number, row: any) => sum + row._count._all, 0);
      const totalSubscriptionsCount = tierCounts.reduce(
        (sum: number, row: any) => sum + row._count._all,
        0,
      );
      const price = Number(tier.price);
      const monthlyPrice = tier.interval === 'year' ? price / 12 : price;

      return {
        ...tier,
        subscribersCount,
        totalSubscriptionsCount,
        // Monthly recurring revenue of the active subscriptions (euros)
        monthlyRevenue: Math.round(monthlyPrice * subscribersCount * 100) / 100,
        // A tier referenced by subscriptions (even past ones) keeps the history:
        // it can only be deactivated
        canDelete: totalSubscriptionsCount === 0,
      };
    });
  }

  async updateTier(creatorId: string, tierId: string, dto: UpdateTierDto) {
    // Check ownership
    const tier = await this.prisma.subscriptionTier.findUnique({
      where: { id: tierId },
    });

    if (!tier) {
      throw new NotFoundException('Offre introuvable');
    }

    if (tier.creatorId !== creatorId) {
      throw new ForbiddenException('Vous ne pouvez modifier que vos propres offres');
    }

    // Existing subscribers keep renewing at the price they subscribed at
    // (BillingService.getRenewalPrice): a new price applies to new subscribers
    // Update tier
    const updatedTier = await this.prisma.subscriptionTier.update({
      where: { id: tierId },
      data: {
        name: dto.name,
        description: dto.description,
        price: dto.price,
        currency: dto.currency,
        interval: dto.interval,
        benefits: dto.benefits,
        isActive: dto.isActive,
      },
    });

    this.logger.log(`Tier updated: ${tierId} by creator ${creatorId}`);
    return updatedTier;
  }

  async deleteTier(creatorId: string, tierId: string) {
    // Check ownership
    const tier = await this.prisma.subscriptionTier.findUnique({
      where: { id: tierId },
    });

    if (!tier) {
      throw new NotFoundException('Offre introuvable');
    }

    if (tier.creatorId !== creatorId) {
      throw new ForbiddenException('Vous ne pouvez supprimer que vos propres offres');
    }

    // Check if tier has active subscriptions
    const activeSubscriptions = await this.prisma.subscription.count({
      where: {
        tierId,
        status: { in: ['ACTIVE', 'PAST_DUE'] },
      },
    });

    if (activeSubscriptions > 0) {
      throw new BadRequestException(
        `Impossible de supprimer l'offre « ${tier.name} » : elle compte ${activeSubscriptions} abonné(s) actif(s). Désactivez-la plutôt.`,
      );
    }

    // Past subscriptions reference the tier (history, renewals): keep it
    const pastSubscriptions = await this.prisma.subscription.count({
      where: { tierId },
    });

    if (pastSubscriptions > 0) {
      throw new BadRequestException(
        `Impossible de supprimer l'offre « ${tier.name} » : elle est liée à ${pastSubscriptions} ancien(s) abonnement(s). Désactivez-la pour la masquer de votre profil.`,
      );
    }

    // Delete tier
    await this.prisma.subscriptionTier.delete({
      where: { id: tierId },
    });

    this.logger.log(`Tier deleted: ${tierId} by creator ${creatorId}`);
    return { message: 'Offre supprimée' };
  }

  // Subscription lifecycle

  /**
   * Subscribe the user to a tier. Free tiers are activated directly; paid
   * tiers are paid first (saved card, or the provider's payment page) and the
   * subscription starts once the payment completes.
   */
  async subscribe(userId: string, dto: SubscribeDto, context: PaymentRequestContext = {}): Promise<SubscribeResult> {
    const tier = await this.prisma.subscriptionTier.findUnique({
      where: { id: dto.tierId },
      include: { creator: tierCreatorSelect },
    });

    if (!tier || !tier.isActive) {
      throw new NotFoundException('Tier not found');
    }

    if (tier.creatorId === userId) {
      throw new BadRequestException('You cannot subscribe to yourself');
    }

    // One live subscription per creator
    const existing = await this.prisma.subscription.findFirst({
      where: {
        subscriberId: userId,
        tier: { creatorId: tier.creatorId },
        status: { in: ['ACTIVE', 'PAST_DUE'] },
      },
    });

    if (existing) {
      throw new BadRequestException(
        existing.tierId === tier.id
          ? existing.cancelAtPeriodEnd
            ? 'Subscription is scheduled for cancellation, resume it instead'
            : 'You are already subscribed to this tier'
          : 'You are already subscribed to another tier of this creator',
      );
    }

    if (Number(tier.price) <= 0) {
      return this.activateFreeSubscription(userId, tier);
    }

    const payment = await this.billing.startSubscriptionPayment({
      userId,
      tier,
      action: 'new',
      amount: Number(tier.price),
      paymentCardId: dto.paymentCardId,
      billingCountry: dto.billingCountry,
      withdrawalWaiver: dto.withdrawalWaiver,
      ...context,
    });

    return this.toSubscribeResult(payment, userId, tier.id);
  }

  /**
   * Switch an active subscription to another tier of the same creator.
   *
   * - paid → paid upgrade (higher price, or another billing interval): paid
   *   now, prorated (new price minus the unused part of the current period),
   *   and a new period starts at the new tier once paid.
   * - paid → paid downgrade (lower price, same interval): applied at the next
   *   renewal (pendingTierId), which bills the lower price.
   * - paid → free: the paid subscription ends at period end, then the free
   *   tier is activated.
   * - free → paid: goes through the regular paid subscription flow; the free
   *   subscription ends once the paid one is active.
   * - free → free: immediate.
   * Choosing the current tier again undoes a scheduled change.
   */
  async changeTier(
    userId: string,
    subscriptionId: string,
    dto: ChangeTierDto,
    context: PaymentRequestContext = {},
  ): Promise<SubscribeResult> {
    const subscription = await this.getOwnSubscription(userId, subscriptionId);

    if (subscription.status !== 'ACTIVE') {
      throw new BadRequestException('Only an active subscription can change tier');
    }

    const target = await this.prisma.subscriptionTier.findUnique({
      where: { id: dto.tierId },
      include: { creator: tierCreatorSelect },
    });

    if (!target || !target.isActive) {
      throw new NotFoundException('Tier not found');
    }

    if (target.creatorId !== subscription.tier.creatorId) {
      throw new BadRequestException('This tier belongs to another creator');
    }

    const currentIsPaid = Number(subscription.tier.price) > 0;
    const targetIsPaid = Number(target.price) > 0;
    const hasScheduledChange = !!subscription.pendingTierId || subscription.cancelAtPeriodEnd;

    if (target.id === subscription.tierId) {
      if (!(currentIsPaid && hasScheduledChange)) {
        throw new BadRequestException('You are already subscribed to this tier');
      }
      const restored = await this.prisma.subscription.update({
        where: { id: subscription.id },
        data: { pendingTierId: null, cancelAtPeriodEnd: false, cancelledAt: null },
      });
      this.logger.log(`Scheduled tier change of subscription ${subscription.id} undone`);
      return { requiresPayment: false, subscription: restored };
    }

    if (!currentIsPaid) {
      if (targetIsPaid) {
        const payment = await this.billing.startSubscriptionPayment({
          userId,
          tier: target,
          action: 'new',
          amount: Number(target.price),
          replacesSubscriptionId: subscription.id,
          paymentCardId: dto.paymentCardId,
          billingCountry: dto.billingCountry,
          withdrawalWaiver: dto.withdrawalWaiver,
          ...context,
        });
        return this.toSubscribeResult(payment, userId, target.id);
      }

      await this.prisma.subscription.update({
        where: { id: subscription.id },
        data: { status: 'CANCELLED', cancelledAt: new Date(), cancelAtPeriodEnd: false },
      });

      this.logger.log(`Subscription ${subscription.id} switched to free tier ${target.id}`);
      return this.activateFreeSubscription(userId, target);
    }

    if (!targetIsPaid) {
      const updated = await this.prisma.subscription.update({
        where: { id: subscription.id },
        data: { pendingTierId: target.id, cancelAtPeriodEnd: true },
      });
      this.logger.log(`Subscription ${subscription.id} will switch to free tier ${target.id} at period end`);
      return { requiresPayment: false, subscription: updated };
    }

    const isDowngrade =
      target.interval === subscription.tier.interval && Number(target.price) < Number(subscription.tier.price);

    if (isDowngrade) {
      const updated = await this.prisma.subscription.update({
        where: { id: subscription.id },
        data: { pendingTierId: target.id, cancelAtPeriodEnd: false, cancelledAt: null },
      });
      this.logger.log(`Subscription ${subscription.id} will downgrade to tier ${target.id} at period end`);
      return { requiresPayment: false, subscription: updated };
    }

    const currentPrice = await this.billing.getRenewalPrice(subscription.id, subscription.tier);
    const amount = BillingService.upgradePrice({
      currentPrice,
      newPrice: Number(target.price),
      periodStart: subscription.currentPeriodStart,
      periodEnd: subscription.currentPeriodEnd,
    });

    const payment = await this.billing.startSubscriptionPayment({
      userId,
      tier: target,
      action: 'upgrade',
      // Payment providers refuse tiny amounts
      amount: Math.max(amount, 0.5),
      subscriptionId: subscription.id,
      paymentCardId: dto.paymentCardId ?? subscription.paymentCardId ?? undefined,
      billingCountry: dto.billingCountry,
      withdrawalWaiver: dto.withdrawalWaiver,
      ...context,
    });

    this.logger.log(`Subscription ${subscription.id} upgrade to tier ${target.id} requested (${payment.status})`);
    return this.toSubscribeResult(payment, userId, target.id);
  }

  /**
   * State of a subscription payment after the provider's payment page
   */
  async confirmSubscription(userId: string, transactionId: string): Promise<SubscribeResult> {
    const payment = await this.paymentFlow.confirmPayment(userId, transactionId, { kind: 'subscription' });
    const transaction = await this.prisma.transaction.findUnique({ where: { id: transactionId }, select: { metadata: true } });
    const tierId = (transaction?.metadata as Record<string, unknown> | null)?.tierId;
    return this.toSubscribeResult(payment, userId, typeof tierId === 'string' ? tierId : null);
  }

  /**
   * Cancel a subscription. Paid subscriptions stay active until the end of the
   * paid period (no further renewal); free and past-due ones end immediately.
   */
  async cancelSubscription(userId: string, subscriptionId: string) {
    const subscription = await this.getOwnSubscription(userId, subscriptionId);

    if (subscription.status !== 'ACTIVE' && subscription.status !== 'PAST_DUE') {
      throw new BadRequestException('Subscription is not active');
    }

    const isPaid = Number(subscription.tier.price) > 0;

    // A scheduled switch to a free tier is also a cancellation at period end:
    // cancelling replaces it with a plain cancellation
    if (subscription.cancelAtPeriodEnd && !subscription.pendingTierId) {
      throw new BadRequestException('Subscription is already scheduled for cancellation');
    }

    if (isPaid && subscription.status === 'ACTIVE') {
      const updated = await this.prisma.subscription.update({
        where: { id: subscriptionId },
        data: { cancelAtPeriodEnd: true, cancelledAt: new Date(), pendingTierId: null },
      });
      this.logger.log(`Subscription ${subscriptionId} cancelled at period end by user ${userId}`);
      return updated;
    }

    const cancelled = await this.prisma.subscription.update({
      where: { id: subscriptionId },
      data: {
        status: 'CANCELLED',
        cancelledAt: new Date(),
        cancelAtPeriodEnd: false,
        nextRenewalAttemptAt: null,
      },
    });

    await this.subscriptionSync.refreshCreatorSubscriberCount(subscription.tier.creatorId);

    this.logger.log(`Subscription ${subscriptionId} cancelled by user ${userId}`);
    return cancelled;
  }

  /**
   * Resume a subscription: undo a scheduled cancellation, or subscribe again
   * to the same tier once it has ended
   */
  async resumeSubscription(
    userId: string,
    subscriptionId: string,
    dto: RetryPaymentDto = {},
    context: PaymentRequestContext = {},
  ): Promise<SubscribeResult> {
    const subscription = await this.getOwnSubscription(userId, subscriptionId);

    if (subscription.status === 'ACTIVE') {
      if (!subscription.cancelAtPeriodEnd) {
        throw new BadRequestException('Subscription is not scheduled for cancellation');
      }

      // Also drops a scheduled switch to a free tier
      const resumed = await this.prisma.subscription.update({
        where: { id: subscriptionId },
        data: { cancelAtPeriodEnd: false, cancelledAt: null, pendingTierId: null },
      });

      this.logger.log(`Subscription ${subscriptionId} resumed by user ${userId}`);
      return { requiresPayment: false, subscription: resumed };
    }

    if (subscription.status === 'PAST_DUE') {
      throw new BadRequestException('Please update your payment method to resume this subscription');
    }

    // Ended subscription: start a new one on the same tier
    return this.subscribe(
      userId,
      {
        tierId: subscription.tierId,
        paymentCardId: dto.paymentCardId,
        billingCountry: dto.billingCountry,
        withdrawalWaiver: dto.withdrawalWaiver,
      },
      context,
    );
  }

  /**
   * Pay a past-due subscription now, with a saved card (which becomes the
   * subscription's card for the next renewals) or a new one on the provider's
   * page. A new period starts once paid.
   */
  async retryPayment(
    userId: string,
    subscriptionId: string,
    dto: RetryPaymentDto = {},
    context: PaymentRequestContext = {},
  ): Promise<SubscribeResult> {
    const subscription = await this.getOwnSubscription(userId, subscriptionId);

    if (subscription.status !== 'PAST_DUE') {
      throw new BadRequestException('Only a past-due subscription can be paid again');
    }

    const target = subscription.pendingTierId
      ? await this.prisma.subscriptionTier.findUnique({ where: { id: subscription.pendingTierId }, include: { creator: tierCreatorSelect } })
      : null;
    const tier = target ?? (await this.prisma.subscriptionTier.findUniqueOrThrow({
      where: { id: subscription.tierId },
      include: { creator: tierCreatorSelect },
    }));
    const amount = target ? Number(target.price) : await this.billing.getRenewalPrice(subscription.id, tier);

    const payment = await this.billing.startSubscriptionPayment({
      userId,
      tier,
      action: 'retry',
      amount,
      subscriptionId: subscription.id,
      paymentCardId: dto.paymentCardId ?? subscription.paymentCardId ?? undefined,
      billingCountry: dto.billingCountry,
      withdrawalWaiver: dto.withdrawalWaiver,
      ...context,
    });

    if (payment.completed) {
      this.logger.log(`Past-due subscription ${subscriptionId} paid by user ${userId}`);
    }
    return this.toSubscribeResult(payment, userId, tier.id);
  }

  /**
   * Current user's subscription to a creator, if any
   */
  async getSubscriptionStatus(userId: string, creatorId: string) {
    const subscriptions = await this.prisma.subscription.findMany({
      where: {
        subscriberId: userId,
        tier: { creatorId },
      },
      include: { tier: true, pendingTier: pendingTierSelect },
      orderBy: { updatedAt: 'desc' },
    });

    const subscription =
      subscriptions.find((sub: any) => sub.status === 'ACTIVE' || sub.status === 'PAST_DUE') ||
      subscriptions[0] ||
      null;

    return {
      isSubscribed: subscription?.status === 'ACTIVE',
      subscription,
    };
  }

  private async activateFreeSubscription(userId: string, tier: any): Promise<SubscribeResult> {
    const subscription = await this.subscriptionSync.activateFreeSubscription(userId, tier);
    return { requiresPayment: false, subscription };
  }

  /** Subscription result of a payment: the subscription once paid, the payment to finish otherwise */
  private async toSubscribeResult(payment: PaymentFlowResult, userId: string, tierId: string | null): Promise<SubscribeResult> {
    if (payment.completed && tierId) {
      const subscription = await this.prisma.subscription.findUnique({
        where: { subscriberId_tierId: { subscriberId: userId, tierId } },
        include: { tier: true, pendingTier: pendingTierSelect },
      });
      return { requiresPayment: false, subscription, payment };
    }

    return {
      requiresPayment: true,
      payment,
      transactionId: payment.transactionId,
      redirectUrl: payment.redirectUrl,
      paymentStatus: payment.status,
    };
  }

  private async getOwnSubscription(userId: string, subscriptionId: string) {
    const subscription = await this.prisma.subscription.findUnique({
      where: { id: subscriptionId },
      include: { tier: true },
    });

    if (!subscription || subscription.subscriberId !== userId) {
      throw new NotFoundException('Subscription not found');
    }

    return subscription;
  }
}

export interface SubscribeResult {
  /** The payment is not completed yet (provider page to visit, still processing or failed) */
  requiresPayment: boolean;
  subscription?: any;
  payment?: PaymentFlowResult;
  transactionId?: string;
  /** Provider page to send the fan to */
  redirectUrl?: string | null;
  paymentStatus?: PaymentFlowResult['status'];
}
