import { Injectable, Logger, OnModuleInit, Optional } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { Prisma, Subscription, SubscriptionTier, Transaction } from '@prisma/client';
import { PrismaService } from '../common/database/prisma.service';
import { MailService } from '../common/mail/mail.service';
import { escapeHtml } from '../common/mail/mail.templates';
import { roundMoney } from '../common/utils/money';
import { PaymentFlowResult, PaymentFlowService } from './payment-flow.service';
import { addInterval, LIVE_STATUSES, SubscriptionSyncService } from './subscription-sync.service';

/** What a subscription payment is for (transaction metadata.action) */
export type SubscriptionPaymentAction = 'new' | 'upgrade' | 'renewal' | 'retry';

/** Days between the automatic retries of a failed renewal; the subscription ends after the last one */
export const RENEWAL_RETRY_DELAYS_DAYS = [1, 3, 5];

/** Grace given to a claimed renewal before another run may retry it (multi-instance safety) */
const RENEWAL_CLAIM_MINUTES = 30;

export interface StartSubscriptionPaymentParams {
  userId: string;
  tier: Pick<SubscriptionTier, 'id' | 'creatorId' | 'name' | 'interval'> & { creator?: { username: string } | null };
  action: SubscriptionPaymentAction;
  /** Price excluding VAT (euros) */
  amount: number;
  subscriptionId?: string;
  replacesSubscriptionId?: string;
  paymentCardId?: string;
  billingCountry?: string;
  withdrawalWaiver?: boolean;
  initiator?: 'customer' | 'merchant';
  ipCountry?: string | null;
  clientIp?: string | null;
}

type SubscriptionWithTiers = Subscription & { tier: SubscriptionTier; pendingTier: SubscriptionTier | null };

/**
 * Billing of paid subscriptions, run by the platform: a subscription period is
 * opened when its payment completes (first payment, upgrade, renewal) and
 * renewed every period by charging the fan's saved card. Failed renewals put
 * the subscription PAST_DUE and are retried (RENEWAL_RETRY_DELAYS_DAYS)
 * before the subscription ends.
 */
@Injectable()
export class BillingService implements OnModuleInit {
  private readonly logger = new Logger(BillingService.name);

  constructor(
    private prisma: PrismaService,
    private paymentFlow: PaymentFlowService,
    private subscriptionSync: SubscriptionSyncService,
    @Optional() private mail?: MailService,
  ) {}

  onModuleInit() {
    this.paymentFlow.registerHandler('subscription', {
      onCompleted: (tx, transaction, metadata) => this.onPaymentCompleted(tx, transaction, metadata),
      afterCompleted: (transaction, metadata) => this.afterPaymentCompleted(transaction, metadata),
      onFailed: (transaction, metadata, reason) => this.onPaymentFailed(transaction, metadata, reason),
    });
  }

  /**
   * Start the payment of a subscription period (first payment, upgrade, renewal, retry)
   */
  async startSubscriptionPayment(params: StartSubscriptionPaymentParams): Promise<PaymentFlowResult> {
    const creatorName = params.tier.creator?.username;
    return this.paymentFlow.startPayment({
      payerId: params.userId,
      creatorId: params.tier.creatorId,
      kind: 'subscription',
      amount: params.amount,
      subscriptionId: params.subscriptionId,
      paymentCardId: params.paymentCardId,
      billingCountry: params.billingCountry,
      withdrawalWaiver: params.withdrawalWaiver,
      initiator: params.initiator,
      description: `Abonnement ${params.tier.name}${creatorName ? ` – @${creatorName}` : ''}`,
      returnPath: creatorName ? `/${creatorName}` : '/subscriptions',
      ipCountry: params.ipCountry,
      clientIp: params.clientIp,
      metadata: {
        action: params.action,
        tierId: params.tier.id,
        interval: params.tier.interval,
        subscriptionId: params.subscriptionId,
        replacesSubscriptionId: params.replacesSubscriptionId,
      },
    });
  }

  /**
   * Price (excluding VAT) a subscription renews at: what the fan paid for this
   * tier last time (a creator's price change applies to new subscribers only),
   * the tier's current price otherwise
   */
  async getRenewalPrice(subscriptionId: string, tier: Pick<SubscriptionTier, 'id' | 'price'>): Promise<number> {
    const last = await this.prisma.transaction.findFirst({
      where: {
        subscriptionId,
        type: 'SUBSCRIPTION',
        status: { in: ['COMPLETED', 'PARTIALLY_REFUNDED'] },
        metadata: { path: ['tierId'], equals: tier.id },
      },
      orderBy: { processedAt: 'desc' },
      select: { amount: true, metadata: true },
    });
    const action = (last?.metadata as Record<string, unknown> | null)?.action;
    // An upgrade only paid the prorated difference: not a reference price
    return last && action !== 'upgrade' ? Number(last.amount) : Number(tier.price);
  }

  // ==================== Payment hooks ====================

  /** Inside the transaction completing the payment: open the paid period */
  private async onPaymentCompleted(tx: Prisma.TransactionClient, transaction: Transaction, metadata: Record<string, unknown>) {
    const action = metadata.action as SubscriptionPaymentAction | undefined;
    const tierId = typeof metadata.tierId === 'string' ? metadata.tierId : null;
    const tier = tierId ? await tx.subscriptionTier.findUnique({ where: { id: tierId } }) : null;
    if (!tier) {
      this.logger.error(`Subscription payment ${transaction.id} has no valid tier`);
      return;
    }

    const now = new Date();
    const card = transaction.paymentCardId ? { paymentCardId: transaction.paymentCardId } : {};
    let subscriptionId: string;

    if (action === 'new') {
      const period = { currentPeriodStart: now, currentPeriodEnd: addInterval(now, tier.interval) };
      const data = {
        status: 'ACTIVE' as const,
        pendingTierId: null,
        renewalAttempts: 0,
        nextRenewalAttemptAt: null,
        cancelAtPeriodEnd: false,
        cancelledAt: null,
        ...period,
        ...card,
      };
      const subscription = await tx.subscription.upsert({
        where: { subscriberId_tierId: { subscriberId: transaction.fromUserId, tierId: tier.id } },
        create: { subscriberId: transaction.fromUserId, tierId: tier.id, ...data },
        update: data,
      });
      subscriptionId = subscription.id;

      // Free → paid upgrade: the free subscription ends now that the paid one is live
      const replacedId = metadata.replacesSubscriptionId;
      if (typeof replacedId === 'string' && replacedId !== subscription.id) {
        await tx.subscription.updateMany({
          where: { id: replacedId, subscriberId: transaction.fromUserId, status: 'ACTIVE' },
          data: { status: 'CANCELLED', cancelledAt: now, cancelAtPeriodEnd: false },
        });
      }
    } else {
      const id = typeof metadata.subscriptionId === 'string' ? metadata.subscriptionId : transaction.subscriptionId;
      const subscription = id ? await tx.subscription.findUnique({ where: { id } }) : null;
      if (!subscription) {
        this.logger.error(`Subscription payment ${transaction.id}: subscription ${id} not found`);
        return;
      }
      subscriptionId = subscription.id;

      if (subscription.tierId !== tier.id) {
        await this.subscriptionSync.releaseTierSlot(subscription.subscriberId, tier.id, subscription.id, tx);
      }

      // A renewal continues the period; an upgrade or a late payment starts a new one now
      const start =
        action === 'renewal' && subscription.status === 'ACTIVE' && subscription.currentPeriodEnd > new Date(now.getTime() - 24 * 60 * 60 * 1000)
          ? subscription.currentPeriodEnd
          : now;

      await tx.subscription.update({
        where: { id: subscription.id },
        data: {
          tierId: tier.id,
          status: 'ACTIVE',
          pendingTierId: null,
          renewalAttempts: 0,
          nextRenewalAttemptAt: null,
          cancelAtPeriodEnd: false,
          cancelledAt: null,
          currentPeriodStart: start,
          currentPeriodEnd: addInterval(start, tier.interval),
          ...card,
        },
      });
    }

    if (transaction.subscriptionId !== subscriptionId) {
      await tx.transaction.update({ where: { id: transaction.id }, data: { subscriptionId } });
    }
  }

  /** After commit: counters and notifications */
  private async afterPaymentCompleted(transaction: Transaction, metadata: Record<string, unknown>) {
    if (!transaction.toUserId) return;
    await this.subscriptionSync.refreshCreatorSubscriberCount(transaction.toUserId);

    const tier = typeof metadata.tierId === 'string'
      ? await this.prisma.subscriptionTier.findUnique({ where: { id: metadata.tierId }, select: { name: true } })
      : null;

    if (metadata.action === 'new') {
      await this.subscriptionSync.notifyNewSubscriber(transaction.toUserId, transaction.fromUserId, tier?.name ?? '');
      return;
    }

    if (metadata.action === 'renewal' || metadata.action === 'retry') {
      await this.notify(
        transaction.fromUserId,
        'Abonnement renouvelé',
        `Votre abonnement ${tier?.name ?? ''} a été renouvelé (${Number(transaction.totalAmount).toFixed(2)}€ TTC).`,
        'SUBSCRIPTION_RENEWAL',
        '/subscriptions',
      );
    }
  }

  /**
   * A renewal charge failed: PAST_DUE and schedule the next automatic retry,
   * or end the subscription after the last one
   */
  private async onPaymentFailed(transaction: Transaction, metadata: Record<string, unknown>, reason: string) {
    if (metadata.action !== 'renewal' || metadata.initiator !== 'merchant') return;

    const id = typeof metadata.subscriptionId === 'string' ? metadata.subscriptionId : transaction.subscriptionId;
    const subscription = id
      ? await this.prisma.subscription.findUnique({ where: { id }, include: { tier: true } })
      : null;
    if (!subscription || !LIVE_STATUSES.includes(subscription.status)) return;

    const attempts = subscription.renewalAttempts + 1;
    const delay = RENEWAL_RETRY_DELAYS_DAYS[attempts - 1];

    if (delay === undefined) {
      await this.prisma.subscription.update({
        where: { id: subscription.id },
        data: { status: 'CANCELLED', cancelledAt: new Date(), renewalAttempts: attempts, nextRenewalAttemptAt: null },
      });
      await this.subscriptionSync.refreshCreatorSubscriberCount(subscription.tier.creatorId);
      await this.notify(
        subscription.subscriberId,
        'Abonnement annulé',
        `Votre abonnement ${subscription.tier.name} a pris fin : le paiement a échoué plusieurs fois (${reason}).`,
        'SUBSCRIPTION_CANCELLED',
        '/subscriptions',
      );
      this.logger.log(`Subscription ${subscription.id} ended after ${attempts} failed renewals`);
      return;
    }

    await this.prisma.subscription.update({
      where: { id: subscription.id },
      data: {
        status: 'PAST_DUE',
        renewalAttempts: attempts,
        nextRenewalAttemptAt: new Date(Date.now() + delay * 24 * 60 * 60 * 1000),
      },
    });
    await this.subscriptionSync.refreshCreatorSubscriberCount(subscription.tier.creatorId);
    await this.notify(
      subscription.subscriberId,
      'Échec du renouvellement',
      `Le renouvellement de votre abonnement ${subscription.tier.name} a échoué (${reason}). Mettez à jour votre carte ou payez maintenant depuis « Mes abonnements ».`,
      'PAYMENT_FAILED',
      '/subscriptions',
    );
  }

  // ==================== Scheduled jobs ====================

  /**
   * Subscriptions whose period ended: renew paid ones, end the cancelled
   * ones, roll free ones over; retry failed renewals when due. Hourly.
   */
  @Cron(CronExpression.EVERY_HOUR)
  async processSubscriptionRenewals() {
    const now = new Date();
    const due = await this.prisma.subscription.findMany({
      where: {
        OR: [
          { status: 'ACTIVE', currentPeriodEnd: { lte: now } },
          { status: 'PAST_DUE', nextRenewalAttemptAt: { lte: now } },
        ],
      },
      include: { tier: true, pendingTier: true },
      take: 500,
    });

    let renewed = 0;
    let ended = 0;
    let failed = 0;

    for (const subscription of due) {
      try {
        const outcome = await this.processDueSubscription(subscription, now);
        if (outcome === 'renewed') renewed++;
        else if (outcome === 'ended') ended++;
        else if (outcome === 'failed') failed++;
      } catch (error) {
        failed++;
        this.logger.error(`Renewal of subscription ${subscription.id} failed: ${(error as Error).message}`);
      }
    }

    if (due.length) {
      this.logger.log(`Subscriptions due: ${due.length} (renewed ${renewed}, ended ${ended}, failed ${failed})`);
    }
    return { renewed, ended, failed };
  }

  private async processDueSubscription(subscription: SubscriptionWithTiers, now: Date): Promise<'renewed' | 'ended' | 'failed' | 'skipped'> {
    // Claim the renewal so that two API instances never charge it twice
    const claimed = await this.prisma.subscription.updateMany({
      where: {
        id: subscription.id,
        status: subscription.status,
        currentPeriodEnd: subscription.currentPeriodEnd,
        OR: [{ nextRenewalAttemptAt: null }, { nextRenewalAttemptAt: { lte: now } }],
      },
      data: { nextRenewalAttemptAt: new Date(now.getTime() + RENEWAL_CLAIM_MINUTES * 60 * 1000) },
    });
    if (claimed.count === 0) return 'skipped';

    const target = subscription.pendingTier ?? subscription.tier;

    // Cancelled (or scheduled switch to a free tier): the period simply ends
    if (subscription.cancelAtPeriodEnd || (Number(target.price) <= 0 && Number(subscription.tier.price) > 0)) {
      await this.prisma.subscription.update({
        where: { id: subscription.id },
        data: {
          status: 'CANCELLED',
          cancelledAt: subscription.cancelledAt ?? now,
          cancelAtPeriodEnd: false,
          nextRenewalAttemptAt: null,
          pendingTierId: null,
        },
      });
      await this.subscriptionSync.refreshCreatorSubscriberCount(subscription.tier.creatorId);
      if (subscription.pendingTierId && Number(target.price) <= 0) {
        await this.subscriptionSync.activatePendingFreeTier(subscription.subscriberId, target.id);
      }
      return 'ended';
    }

    // Free tier: roll the period over
    if (Number(subscription.tier.price) <= 0) {
      await this.prisma.subscription.update({
        where: { id: subscription.id },
        data: {
          currentPeriodStart: now,
          currentPeriodEnd: addInterval(now, subscription.tier.interval),
          nextRenewalAttemptAt: null,
        },
      });
      return 'renewed';
    }

    // The creator can no longer sell (banned, identity revoked...): stop billing
    const creator = await this.prisma.user.findUnique({
      where: { id: subscription.tier.creatorId },
      select: { role: true, kycStatus: true, status: true, deletedAt: true, username: true },
    });
    const fan = await this.prisma.user.findUnique({ where: { id: subscription.subscriberId }, select: { status: true, deletedAt: true } });
    if (!PaymentFlowService.canSell(creator) || !fan || fan.deletedAt || fan.status === 'BANNED') {
      await this.prisma.subscription.update({
        where: { id: subscription.id },
        data: { status: 'CANCELLED', cancelledAt: now, nextRenewalAttemptAt: null },
      });
      await this.subscriptionSync.refreshCreatorSubscriberCount(subscription.tier.creatorId);
      return 'ended';
    }

    const card = await this.paymentFlow.findRenewalCard(subscription.subscriberId, subscription.paymentCardId);
    const amount = target.id === subscription.tierId
      ? await this.getRenewalPrice(subscription.id, subscription.tier)
      : Number(target.price);

    const result = await this.startSubscriptionPayment({
      userId: subscription.subscriberId,
      tier: { ...target, creator: creator ? { username: creator.username } : null },
      action: 'renewal',
      amount,
      subscriptionId: subscription.id,
      paymentCardId: card?.id,
      initiator: 'merchant',
    });

    if (result.status === 'processing') {
      // Outcome reported later by the provider: do not charge again meanwhile
      await this.prisma.subscription.update({
        where: { id: subscription.id },
        data: { nextRenewalAttemptAt: new Date(now.getTime() + 24 * 60 * 60 * 1000) },
      });
    }

    return result.completed ? 'renewed' : result.status === 'failed' ? 'failed' : 'skipped';
  }

  /**
   * Annual subscriptions renew tacitly: the fan must be told in writing, by a
   * dedicated email, between 3 months and 1 month before the renewal date that
   * they can cancel (art. L215-1 Code de la consommation). Sent once, about
   * 35 days before the end of the period (daily, 9:15).
   */
  @Cron('15 9 * * *')
  async sendAnnualRenewalReminders() {
    const from = new Date(Date.now() + 35 * 24 * 60 * 60 * 1000);
    const to = new Date(from.getTime() + 24 * 60 * 60 * 1000);
    const due = await this.prisma.subscription.findMany({
      where: {
        status: 'ACTIVE',
        cancelAtPeriodEnd: false,
        currentPeriodEnd: { gte: from, lt: to },
        tier: { interval: 'year', price: { gt: 0 } },
      },
      include: {
        tier: { include: { creator: { select: { username: true, displayName: true } } } },
        subscriber: { select: { id: true, email: true, username: true, displayName: true, deletedAt: true } },
      },
    });

    let sent = 0;
    for (const subscription of due) {
      if (subscription.subscriber.deletedAt) continue;
      const creatorName = subscription.tier.creator.displayName || subscription.tier.creator.username;
      const date = subscription.currentPeriodEnd.toLocaleDateString('fr-FR', { timeZone: 'Europe/Paris' });
      const price = (await this.getRenewalPrice(subscription.id, subscription.tier)).toFixed(2);
      const message =
        `Votre abonnement annuel ${subscription.tier.name} chez ${creatorName} sera renouvelé automatiquement le ${date} ` +
        `pour ${price} € HT par an (TVA en sus). Vous pouvez le résilier à tout moment avant cette date depuis « Mes abonnements » : ` +
        `l'accès restera ouvert jusqu'au ${date}.`;

      await this.notify(subscription.subscriberId, 'Renouvellement de votre abonnement annuel', message, 'ANNUAL_RENEWAL_NOTICE', '/subscriptions');
      if (this.mail) {
        const name = subscription.subscriber.displayName || subscription.subscriber.username;
        await this.mail
          .sendMail({
            to: subscription.subscriber.email,
            subject: 'Votre abonnement annuel va être renouvelé',
            html: `<p>Bonjour ${escapeHtml(name)},</p><p>${escapeHtml(message)}</p>`,
            text: `Bonjour ${name},\n\n${message}`,
          })
          .catch((error) => this.logger.error(`Renewal notice email failed: ${(error as Error).message}`));
      }
      sent++;
    }

    if (sent) this.logger.log(`Annual renewal notices sent: ${sent}`);
    return { sent };
  }

  /**
   * Remind fans whose subscription is past due (daily, 10 AM)
   */
  @Cron(CronExpression.EVERY_DAY_AT_10AM)
  async sendPaymentReminders() {
    const pastDueSubscriptions = await this.prisma.subscription.findMany({
      where: { status: 'PAST_DUE' },
      include: { tier: true },
    });

    let sentCount = 0;
    for (const subscription of pastDueSubscriptions) {
      await this.notify(
        subscription.subscriberId,
        'Rappel de paiement',
        `Votre abonnement ${subscription.tier.name} est en attente de paiement. Mettez à jour votre carte ou payez maintenant pour continuer à profiter du contenu.`,
        'PAYMENT_REMINDER',
        '/subscriptions',
      );
      sentCount++;
    }

    this.logger.log(`Sent ${sentCount} payment reminders`);
    return { sentCount };
  }

  /**
   * Clean up old cancelled subscriptions (monthly on the 1st at 4 AM). Their
   * payments stay in the transactions (accounting records are kept 10 years).
   */
  @Cron('0 4 1 * *')
  async cleanupOldSubscriptions() {
    const cutoffDate = new Date();
    cutoffDate.setMonth(cutoffDate.getMonth() - 6);

    const result = await this.prisma.subscription.deleteMany({
      where: { status: 'CANCELLED', cancelledAt: { lte: cutoffDate } },
    });

    this.logger.log(`Cleaned up ${result.count} old cancelled subscriptions`);
    return { cleanedUp: result.count };
  }

  /**
   * Hosted checkouts abandoned by the fan stay PENDING: cancel them after a
   * day so they do not show as pending forever (hourly)
   */
  @Cron(CronExpression.EVERY_HOUR)
  async cancelAbandonedPayments() {
    const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const result = await this.prisma.transaction.updateMany({
      where: { status: 'PENDING', createdAt: { lte: cutoff }, type: { in: ['SUBSCRIPTION', 'TIP', 'PPV_UNLOCK'] } },
      data: { status: 'CANCELLED', failureReason: 'Paiement abandonné' },
    });
    if (result.count) {
      this.logger.log(`Abandoned payments cancelled: ${result.count}`);
    }
    return { cancelledCount: result.count };
  }

  /** Prorated price (excluding VAT) of an upgrade: new price minus the unused part of the current period */
  static upgradePrice(params: {
    currentPrice: number;
    newPrice: number;
    periodStart: Date;
    periodEnd: Date;
    now?: Date;
  }): number {
    const now = params.now ?? new Date();
    const length = params.periodEnd.getTime() - params.periodStart.getTime();
    const remaining = Math.max(0, params.periodEnd.getTime() - now.getTime());
    const credit = length > 0 ? (params.currentPrice * remaining) / length : 0;
    return roundMoney(Math.max(0, params.newPrice - credit));
  }

  private async notify(userId: string, title: string, message: string, kind: string, linkUrl?: string) {
    try {
      await this.prisma.notification.create({
        data: {
          userId,
          type: kind === 'SUBSCRIPTION_RENEWAL' ? 'SUBSCRIPTION_RENEWAL' : 'SYSTEM',
          title,
          message,
          linkUrl,
          metadata: { kind },
        },
      });
    } catch (error) {
      this.logger.error(`Failed to create notification: ${(error as Error).message}`);
    }
  }
}
