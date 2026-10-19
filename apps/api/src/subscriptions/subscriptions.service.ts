import { Injectable, Logger, BadRequestException, NotFoundException, ForbiddenException } from '@nestjs/common';
import Stripe from 'stripe';
import { PrismaService } from '../common/database/prisma.service';
import { PaymentsService } from '../payments/payments.service';
import { StripeService } from '../payments/stripe.service';
import {
  SubscriptionSyncService,
  CLEARED_DOWNGRADE_METADATA,
  REPLACES_SUBSCRIPTION_METADATA_KEY,
  buildDowngradeMetadata,
} from '../payments/subscription-sync.service';
import { CreateTierDto, UpdateTierDto } from './dto/subscription-tier.dto';
import { SubscribeDto, ChangeTierDto } from './dto/subscribe.dto';

const tierCreatorSelect = {
  select: {
    id: true,
    username: true,
    stripeAccountId: true,
    stripeOnboarded: true,
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
    private paymentsService: PaymentsService,
    private stripeService: StripeService,
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

    // A Stripe price is immutable: drop it when pricing changes so the next
    // subscription creates a new one (existing subscribers keep their price)
    const pricingChanged =
      (dto.price !== undefined && Number(dto.price) !== Number(tier.price)) ||
      (dto.currency !== undefined && dto.currency !== tier.currency) ||
      (dto.interval !== undefined && dto.interval !== tier.interval);

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
        ...(pricingChanged && { stripePriceId: null }),
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
   * Subscribe the user to a tier.
   * Free tiers are activated directly. Paid tiers create a Stripe subscription
   * transferred to the creator's connected account; unless a saved card was
   * charged successfully, the client must confirm the first payment with the
   * returned clientSecret and then call confirmSubscription.
   */
  async subscribe(userId: string, dto: SubscribeDto): Promise<SubscribeResult> {
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

    return this.createPaidSubscription(userId, tier, dto.paymentMethodId);
  }

  /**
   * Switch an active subscription to another tier of the same creator.
   *
   * - paid → paid upgrade (higher price, or another billing interval): the
   *   Stripe item price is swapped right away and the prorated difference is
   *   invoiced immediately (`always_invoice`). With `pending_if_incomplete` the
   *   change only applies once that invoice is paid; when it needs 3D Secure
   *   the clientSecret is returned and the client calls confirmSubscription.
   * - paid → paid downgrade (lower price, same interval): applied at the end of
   *   the paid period. The item price is swapped with `proration_behavior:
   *   none` (nothing charged or credited, next invoice bills the lower price)
   *   and the downgrade is recorded in the subscription metadata, so the sync
   *   keeps the current tier and exposes `pendingTierId` until the rollover.
   *   No subscription schedule is needed.
   * - paid → free: the paid subscription is cancelled at period end, then the
   *   free tier is activated when Stripe reports it ended.
   * - free → paid: goes through the regular paid subscription flow; the free
   *   subscription ends once the paid one is active.
   * - free → free: immediate.
   * Choosing the current tier again undoes a scheduled downgrade.
   */
  async changeTier(userId: string, subscriptionId: string, dto: ChangeTierDto): Promise<SubscribeResult> {
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

    const currentIsPaid = !!subscription.stripeSubscriptionId;
    const targetIsPaid = Number(target.price) > 0;

    if (target.id === subscription.tierId && !(currentIsPaid && subscription.pendingTierId)) {
      throw new BadRequestException('You are already subscribed to this tier');
    }

    if (!currentIsPaid) {
      if (targetIsPaid) {
        return this.createPaidSubscription(userId, target, dto.paymentMethodId, {
          [REPLACES_SUBSCRIPTION_METADATA_KEY]: subscription.id,
        });
      }

      await this.prisma.subscription.update({
        where: { id: subscription.id },
        data: { status: 'CANCELLED', cancelledAt: new Date(), cancelAtPeriodEnd: false },
      });

      this.logger.log(`Subscription ${subscription.id} switched to free tier ${target.id}`);
      return this.activateFreeSubscription(userId, target);
    }

    const stripeSubscriptionId = subscription.stripeSubscriptionId as string;
    let stripeSubscription = await this.stripeService.retrieveSubscription(stripeSubscriptionId);

    // Drop a scheduled downgrade or cancellation first, so the change starts
    // from the tier the fan currently has and paid for
    if (
      subscription.pendingTierId ||
      subscription.cancelAtPeriodEnd ||
      stripeSubscription.cancel_at_period_end
    ) {
      stripeSubscription = await this.stripeService.updateTierSubscription(
        stripeSubscriptionId,
        this.undoScheduledChangesParams(stripeSubscription),
      );

      if (target.id === subscription.tierId) {
        this.logger.log(`Scheduled tier change of subscription ${subscription.id} undone`);
        return {
          requiresPayment: false,
          subscription: await this.subscriptionSync.syncFromStripe(stripeSubscription),
        };
      }
    }

    const item = stripeSubscription.items.data[0];
    const downgradeMetadata = buildDowngradeMetadata({
      toTierId: target.id,
      fromTierId: subscription.tierId,
      fromPriceId: item.price.id,
      at: stripeSubscription.current_period_end,
    });

    if (!targetIsPaid) {
      const updated = await this.stripeService.updateTierSubscription(stripeSubscriptionId, {
        cancel_at_period_end: true,
        metadata: downgradeMetadata,
      });

      this.logger.log(
        `Subscription ${subscription.id} will switch to free tier ${target.id} at period end`,
      );
      return { requiresPayment: false, subscription: await this.subscriptionSync.syncFromStripe(updated) };
    }

    const priceId = await this.ensureStripePrice(target);
    const isDowngrade =
      target.interval === subscription.tier.interval &&
      Number(target.price) < Number(subscription.tier.price);

    if (isDowngrade) {
      const updated = await this.stripeService.updateTierSubscription(stripeSubscriptionId, {
        items: [{ id: item.id, price: priceId }],
        proration_behavior: 'none',
        metadata: downgradeMetadata,
      });

      this.logger.log(
        `Subscription ${subscription.id} will downgrade to tier ${target.id} at period end`,
      );
      return { requiresPayment: false, subscription: await this.subscriptionSync.syncFromStripe(updated) };
    }

    const updated = await this.stripeService.updateTierSubscription(stripeSubscriptionId, {
      items: [{ id: item.id, price: priceId }],
      proration_behavior: 'always_invoice',
      payment_behavior: 'pending_if_incomplete',
    });

    this.logger.log(
      `Subscription ${subscription.id} upgrade to tier ${target.id} requested` +
        (updated.pending_update ? ' (awaiting payment)' : ''),
    );
    return this.toSubscribeResult(updated);
  }

  /**
   * Sync a Stripe subscription right after the client confirmed its payment,
   * so access does not depend on webhook latency
   */
  async confirmSubscription(userId: string, stripeSubscriptionId: string): Promise<SubscribeResult> {
    const stripeSubscription = await this.stripeService
      .retrieveSubscription(stripeSubscriptionId)
      .catch(() => null);

    if (!stripeSubscription || stripeSubscription.metadata?.subscriberId !== userId) {
      throw new NotFoundException('Subscription not found');
    }

    return this.toSubscribeResult(stripeSubscription);
  }

  /**
   * Cancel a subscription. Paid subscriptions stay active until the end of the
   * paid period; free and past-due ones end immediately.
   */
  async cancelSubscription(userId: string, subscriptionId: string) {
    const subscription = await this.getOwnSubscription(userId, subscriptionId);

    if (subscription.status !== 'ACTIVE' && subscription.status !== 'PAST_DUE') {
      throw new BadRequestException('Subscription is not active');
    }

    // A scheduled switch to a free tier is also a cancellation at period end:
    // cancelling replaces it with a plain cancellation
    if (subscription.cancelAtPeriodEnd && !subscription.pendingTierId) {
      throw new BadRequestException('Subscription is already scheduled for cancellation');
    }

    if (subscription.stripeSubscriptionId) {
      let stripeSubscription: Stripe.Subscription;
      if (subscription.status === 'PAST_DUE') {
        stripeSubscription = await this.stripeService.cancelSubscription(subscription.stripeSubscriptionId);
      } else if (subscription.pendingTierId) {
        // Drop the scheduled downgrade (restoring the paid price) and cancel instead
        const current = await this.stripeService.retrieveSubscription(subscription.stripeSubscriptionId);
        stripeSubscription = await this.stripeService.updateTierSubscription(
          subscription.stripeSubscriptionId,
          { ...this.undoScheduledChangesParams(current), cancel_at_period_end: true },
        );
      } else {
        stripeSubscription = await this.stripeService.setCancelAtPeriodEnd(
          subscription.stripeSubscriptionId,
          true,
        );
      }

      this.logger.log(`Subscription ${subscriptionId} cancelled by user ${userId}`);
      return this.subscriptionSync.syncFromStripe(stripeSubscription);
    }

    const cancelled = await this.prisma.subscription.update({
      where: { id: subscriptionId },
      data: {
        status: 'CANCELLED',
        cancelledAt: new Date(),
        cancelAtPeriodEnd: false,
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
  async resumeSubscription(userId: string, subscriptionId: string): Promise<SubscribeResult> {
    const subscription = await this.getOwnSubscription(userId, subscriptionId);

    if (subscription.status === 'ACTIVE') {
      if (!subscription.cancelAtPeriodEnd) {
        throw new BadRequestException('Subscription is not scheduled for cancellation');
      }

      if (subscription.stripeSubscriptionId) {
        // Also drops a scheduled switch to a free tier
        const stripeSubscription = subscription.pendingTierId
          ? await this.stripeService.updateTierSubscription(
              subscription.stripeSubscriptionId,
              this.undoScheduledChangesParams(
                await this.stripeService.retrieveSubscription(subscription.stripeSubscriptionId),
              ),
            )
          : await this.stripeService.setCancelAtPeriodEnd(subscription.stripeSubscriptionId, false);

        this.logger.log(`Subscription ${subscriptionId} resumed by user ${userId}`);
        return {
          requiresPayment: false,
          subscription: await this.subscriptionSync.syncFromStripe(stripeSubscription),
        };
      }

      const resumed = await this.prisma.subscription.update({
        where: { id: subscriptionId },
        data: { cancelAtPeriodEnd: false, cancelledAt: null },
      });

      return { requiresPayment: false, subscription: resumed };
    }

    if (subscription.status === 'PAST_DUE') {
      throw new BadRequestException('Please update your payment method to resume this subscription');
    }

    // Ended subscription: start a new one on the same tier
    return this.subscribe(userId, { tierId: subscription.tierId });
  }

  /**
   * Pay the overdue invoice of a past-due subscription again, optionally with
   * another saved card (which then becomes the subscription's card for the
   * next renewals). Paid subscriptions save their card on the subscription, so
   * changing the customer's default card alone would not fix a failed renewal.
   * When the bank asks for 3D Secure, the clientSecret is returned and the
   * client confirms it, then calls confirmSubscription.
   */
  async retryPayment(userId: string, subscriptionId: string, paymentMethodId?: string): Promise<SubscribeResult> {
    const subscription = await this.getOwnSubscription(userId, subscriptionId);

    if (subscription.status !== 'PAST_DUE') {
      throw new BadRequestException('Only a past-due subscription can be paid again');
    }

    if (!subscription.stripeSubscriptionId) {
      throw new BadRequestException('This subscription has no payment to retry');
    }

    const stripeSubscriptionId = subscription.stripeSubscriptionId;

    if (paymentMethodId) {
      await this.paymentsService.assertPaymentMethodOwnership(userId, paymentMethodId);
      await this.stripeService.setSubscriptionPaymentMethod(stripeSubscriptionId, paymentMethodId);
    }

    const current = await this.stripeService.retrieveSubscription(stripeSubscriptionId);
    const invoice = current.latest_invoice as Stripe.Invoice | null;

    if (invoice?.id && invoice.status === 'open') {
      try {
        await this.stripeService.payInvoice(invoice.id, paymentMethodId);
      } catch (error) {
        // Declined, or 3D Secure needed: reported through the payment intent below
        this.logger.warn(`Retry payment of subscription ${subscriptionId} failed: ${(error as Error).message}`);
      }
    }

    const refreshed = await this.stripeService.retrieveSubscription(stripeSubscriptionId);
    const synced = await this.subscriptionSync.syncFromStripe(refreshed);

    if (refreshed.status === 'active' || refreshed.status === 'trialing') {
      this.logger.log(`Past-due subscription ${subscriptionId} paid by user ${userId}`);
      return { requiresPayment: false, subscription: synced };
    }

    const paymentIntent = (refreshed.latest_invoice as Stripe.Invoice | null)?.payment_intent as
      | Stripe.PaymentIntent
      | null;

    return {
      requiresPayment: true,
      subscription: synced,
      stripeSubscriptionId,
      clientSecret: paymentIntent?.client_secret ?? null,
      ...(paymentIntent?.status && { paymentStatus: paymentIntent.status }),
    };
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

  /**
   * Create the Stripe subscription for a paid tier. Earlier attempts left
   * `incomplete` for the same creator (checkout abandoned) are cancelled first,
   * so retrying does not pile up unpaid Stripe subscriptions.
   */
  private async createPaidSubscription(
    userId: string,
    tier: any,
    paymentMethodId?: string,
    extraMetadata: Record<string, string> = {},
  ): Promise<SubscribeResult> {
    if (!tier.creator.stripeAccountId || !tier.creator.stripeOnboarded) {
      throw new BadRequestException('Creator payment account is not ready');
    }

    const user = await this.prisma.user.findUnique({
      where: { id: userId },
    });

    if (!user) {
      throw new NotFoundException('User not found');
    }

    const customerId = await this.paymentsService.getOrCreateCustomerId(user);

    if (paymentMethodId) {
      await this.paymentsService.assertPaymentMethodOwnership(userId, paymentMethodId);
    }

    await this.cancelIncompleteAttempts(customerId, tier.creatorId);

    const priceId = await this.ensureStripePrice(tier);

    const stripeSubscription = await this.stripeService.createTierSubscription({
      customerId,
      priceId,
      connectedAccountId: tier.creator.stripeAccountId,
      paymentMethodId,
      metadata: {
        subscriberId: userId,
        tierId: tier.id,
        creatorId: tier.creatorId,
        ...extraMetadata,
      },
    });

    this.logger.log(
      `Stripe subscription ${stripeSubscription.id} created for user ${userId} on tier ${tier.id}`,
    );

    return this.toSubscribeResult(stripeSubscription);
  }

  private async cancelIncompleteAttempts(customerId: string, creatorId: string) {
    const attempts = await this.stripeService.listIncompleteSubscriptions({ customerId });

    for (const attempt of attempts) {
      if (attempt.metadata?.creatorId !== creatorId) continue;

      try {
        await this.stripeService.cancelSubscription(attempt.id);
        this.logger.log(`Abandoned incomplete subscription ${attempt.id} cancelled before retry`);
      } catch (error) {
        this.logger.warn(`Failed to cancel incomplete subscription ${attempt.id}: ${error.message}`);
      }
    }
  }

  /**
   * Update params dropping a scheduled downgrade or cancellation: restores the
   * price paid for the current period (without proration) and clears the
   * downgrade metadata
   */
  private undoScheduledChangesParams(
    stripeSubscription: Stripe.Subscription,
  ): Stripe.SubscriptionUpdateParams {
    const item = stripeSubscription.items.data[0];
    const paidPriceId = stripeSubscription.metadata?.downgradeFromPriceId;
    const restorePrice = !!paidPriceId && !!item && item.price.id !== paidPriceId;

    return {
      cancel_at_period_end: false,
      metadata: CLEARED_DOWNGRADE_METADATA,
      ...(restorePrice && {
        items: [{ id: item.id, price: paidPriceId }],
        proration_behavior: 'none' as const,
      }),
    };
  }

  /**
   * Lazily create the Stripe product and price backing a tier
   */
  private async ensureStripePrice(tier: any): Promise<string> {
    if (tier.stripePriceId) {
      return tier.stripePriceId;
    }

    const productId =
      tier.stripeProductId ||
      (
        await this.stripeService.createProduct(
          `${tier.creator.username} - ${tier.name}`,
          tier.description || tier.name,
          { tierId: tier.id, creatorId: tier.creatorId },
        )
      ).id;

    const price = await this.stripeService.createPrice(
      productId,
      Number(tier.price),
      (tier.currency || 'EUR').toLowerCase(),
      tier.interval === 'year' ? 'year' : 'month',
    );

    await this.prisma.subscriptionTier.update({
      where: { id: tier.id },
      data: {
        stripeProductId: productId,
        stripePriceId: price.id,
      },
    });

    return price.id;
  }

  private async toSubscribeResult(stripeSubscription: Stripe.Subscription): Promise<SubscribeResult> {
    const subscription = await this.subscriptionSync.syncFromStripe(stripeSubscription);

    const invoice = stripeSubscription.latest_invoice as Stripe.Invoice | null;
    const paymentIntent = invoice?.payment_intent as Stripe.PaymentIntent | null;

    // An upgrade with `pending_if_incomplete` waits for its proration invoice
    const awaitingPayment =
      stripeSubscription.status === 'incomplete' || !!stripeSubscription.pending_update;

    if (subscription && !awaitingPayment) {
      return { requiresPayment: false, subscription };
    }

    return {
      requiresPayment: true,
      stripeSubscriptionId: stripeSubscription.id,
      clientSecret: paymentIntent?.client_secret ?? null,
      // e.g. requires_action (3D Secure) or requires_payment_method (declined)
      ...(paymentIntent?.status && { paymentStatus: paymentIntent.status }),
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
  requiresPayment: boolean;
  subscription?: any;
  stripeSubscriptionId?: string;
  clientSecret?: string | null;
  paymentStatus?: Stripe.PaymentIntent.Status;
}
