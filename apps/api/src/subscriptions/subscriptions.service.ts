import { Injectable, Logger, BadRequestException, NotFoundException, ForbiddenException } from '@nestjs/common';
import Stripe from 'stripe';
import { PrismaService } from '../common/database/prisma.service';
import { PaymentsService } from '../payments/payments.service';
import { StripeService } from '../payments/stripe.service';
import { SubscriptionSyncService } from '../payments/subscription-sync.service';
import { CreateTierDto, UpdateTierDto } from './dto/subscription-tier.dto';
import { SubscribeDto } from './dto/subscribe.dto';

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
      },
      orderBy: {
        createdAt: 'desc',
      },
    });
  }

  async getCreatorSubscribers(creatorId: string) {
    return this.prisma.subscription.findMany({
      where: {
        tier: {
          creatorId,
        },
        status: 'ACTIVE',
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
        tier: true,
      },
      orderBy: {
        createdAt: 'desc',
      },
    });
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

    // Get subscriber counts for each tier
    const tiersWithCounts = await Promise.all(
      tiers.map(async (tier: any) => {
        const subscribersCount = await this.prisma.subscription.count({
          where: {
            tierId: tier.id,
            status: 'ACTIVE',
          },
        });

        return {
          ...tier,
          subscribersCount,
        };
      }),
    );

    return tiersWithCounts;
  }

  async updateTier(creatorId: string, tierId: string, dto: UpdateTierDto) {
    // Check ownership
    const tier = await this.prisma.subscriptionTier.findUnique({
      where: { id: tierId },
    });

    if (!tier) {
      throw new NotFoundException('Tier not found');
    }

    if (tier.creatorId !== creatorId) {
      throw new ForbiddenException('You can only update your own tiers');
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
      throw new NotFoundException('Tier not found');
    }

    if (tier.creatorId !== creatorId) {
      throw new ForbiddenException('You can only delete your own tiers');
    }

    // Check if tier has active subscriptions
    const activeSubscriptions = await this.prisma.subscription.count({
      where: {
        tierId,
        status: 'ACTIVE',
      },
    });

    if (activeSubscriptions > 0) {
      throw new BadRequestException(
        `Cannot delete tier with ${activeSubscriptions} active subscription(s). Please deactivate it instead.`,
      );
    }

    // Delete tier
    await this.prisma.subscriptionTier.delete({
      where: { id: tierId },
    });

    this.logger.log(`Tier deleted: ${tierId} by creator ${creatorId}`);
    return { message: 'Tier deleted successfully' };
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
      include: {
        creator: {
          select: {
            id: true,
            username: true,
            stripeAccountId: true,
            stripeOnboarded: true,
          },
        },
      },
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

    if (dto.paymentMethodId) {
      await this.paymentsService.assertPaymentMethodOwnership(userId, dto.paymentMethodId);
    }

    const priceId = await this.ensureStripePrice(tier);

    const stripeSubscription = await this.stripeService.createTierSubscription({
      customerId,
      priceId,
      connectedAccountId: tier.creator.stripeAccountId,
      paymentMethodId: dto.paymentMethodId,
      metadata: {
        subscriberId: userId,
        tierId: tier.id,
        creatorId: tier.creatorId,
      },
    });

    this.logger.log(
      `Stripe subscription ${stripeSubscription.id} created for user ${userId} on tier ${tier.id}`,
    );

    return this.toSubscribeResult(stripeSubscription);
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

    if (subscription.cancelAtPeriodEnd) {
      throw new BadRequestException('Subscription is already scheduled for cancellation');
    }

    if (subscription.stripeSubscriptionId) {
      const stripeSubscription =
        subscription.status === 'PAST_DUE'
          ? await this.stripeService.cancelSubscription(subscription.stripeSubscriptionId)
          : await this.stripeService.setCancelAtPeriodEnd(subscription.stripeSubscriptionId, true);

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
        const stripeSubscription = await this.stripeService.setCancelAtPeriodEnd(
          subscription.stripeSubscriptionId,
          false,
        );

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
   * Current user's subscription to a creator, if any
   */
  async getSubscriptionStatus(userId: string, creatorId: string) {
    const subscriptions = await this.prisma.subscription.findMany({
      where: {
        subscriberId: userId,
        tier: { creatorId },
      },
      include: { tier: true },
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
      currentPeriodStart,
      currentPeriodEnd,
      cancelAtPeriodEnd: false,
      cancelledAt: null,
    };

    const subscription = await this.prisma.subscription.upsert({
      where: {
        subscriberId_tierId: { subscriberId: userId, tierId: tier.id },
      },
      create: { subscriberId: userId, tierId: tier.id, ...data },
      update: data,
    });

    await this.subscriptionSync.refreshCreatorSubscriberCount(tier.creatorId);
    await this.subscriptionSync.notifyNewSubscriber(tier.creatorId, userId, tier.name);

    this.logger.log(`Free subscription ${subscription.id} activated for user ${userId}`);

    return { requiresPayment: false, subscription };
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

    if (subscription && stripeSubscription.status !== 'incomplete') {
      return { requiresPayment: false, subscription };
    }

    const invoice = stripeSubscription.latest_invoice as Stripe.Invoice | null;
    const paymentIntent = invoice?.payment_intent as Stripe.PaymentIntent | null;

    return {
      requiresPayment: true,
      stripeSubscriptionId: stripeSubscription.id,
      clientSecret: paymentIntent?.client_secret ?? null,
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
}
