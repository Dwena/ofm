import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { SettingsService } from '../settings/settings.service';
import { Prisma, TransactionType } from '@prisma/client';
import { Subject } from 'rxjs';
import Stripe from 'stripe';
import { PrismaService } from '../common/database/prisma.service';
import { computeFees, roundMoney, toCents } from '../common/utils/money';
import { StripeService } from './stripe.service';

/** What a one-off payment pays for (stored in the transaction metadata) */
export type OneTimePaymentKind = 'content_unlock' | 'stream_access' | 'tip' | 'message_unlock';

export interface StartPaymentParams {
  payerId: string;
  creatorId: string;
  kind: OneTimePaymentKind;
  /** Amount in euros */
  amount: number;
  /** Content id (PPV content) or stream id (PPV live); PPV messages use metadata.messageId */
  contentId?: string;
  paymentMethodId?: string;
  description?: string;
  metadata?: Record<string, string | null | undefined>;
}

export type PaymentFlowStatus =
  | 'completed'
  | 'processing'
  | 'requires_action'
  | 'requires_payment_method'
  | 'failed';

export interface PaymentFlowResult {
  status: PaymentFlowStatus;
  /** True once the payment succeeded and access / earnings were granted */
  completed: boolean;
  transactionId: string;
  paymentIntentId: string | null;
  /** Client secret to confirm the payment with Stripe.js (new card or 3D Secure) */
  clientSecret: string | null;
  /** Amount in euros */
  amount: number;
}

export interface TipCompletedEvent {
  transactionId: string;
  streamId: string | null;
  creatorId: string;
  fromUser: { id: string; username: string; displayName: string | null; avatar: string | null };
  /** Amount in euros */
  amount: number;
  message: string | null;
  completedAt: Date;
}

/** Transaction statuses a successful payment may complete (a failed attempt can be retried) */
const COMPLETABLE_STATUSES = ['PENDING', 'PROCESSING', 'FAILED'] as const;

const TRANSACTION_TYPE: Record<OneTimePaymentKind, TransactionType> = {
  content_unlock: 'PPV_UNLOCK',
  stream_access: 'PPV_UNLOCK',
  tip: 'TIP',
  message_unlock: 'PPV_UNLOCK',
};

/**
 * One-off payments (PPV content, PPV live streams, PPV messages, tips).
 *
 * Flow: a PENDING transaction is created with a Stripe PaymentIntent. Access
 * and creator earnings are granted only once Stripe reports the intent as
 * succeeded, either from the `payment_intent.succeeded` webhook or from an
 * explicit confirm call that re-reads the intent from Stripe. Completion is
 * an atomic PENDING -> COMPLETED transition, so the webhook and the confirm
 * call never credit a payment twice.
 */
@Injectable()
export class OneTimePaymentService {
  private readonly logger = new Logger(OneTimePaymentService.name);

  /** Emits once per tip, when it is paid */
  readonly tipCompleted$ = new Subject<TipCompletedEvent>();

  constructor(
    private prisma: PrismaService,
    private stripeService: StripeService,
    private settingsService: SettingsService,
  ) {}

  /**
   * Create the pending transaction and its PaymentIntent
   */
  async startPayment(params: StartPaymentParams): Promise<PaymentFlowResult> {
    const amount = roundMoney(params.amount);
    if (!(amount > 0)) {
      throw new BadRequestException('Invalid amount');
    }

    const [payer, creator] = await Promise.all([
      this.prisma.user.findUnique({ where: { id: params.payerId } }),
      this.prisma.user.findUnique({
        where: { id: params.creatorId },
        select: { id: true, stripeAccountId: true, stripeOnboarded: true },
      }),
    ]);

    if (!payer) {
      throw new NotFoundException('User not found');
    }

    if (!creator?.stripeAccountId || !creator.stripeOnboarded) {
      throw new BadRequestException('Creator payment account is not ready');
    }

    const customerId = await this.getOrCreateCustomerId(payer);

    if (params.paymentMethodId) {
      await this.assertPaymentMethodOwnership(customerId, params.paymentMethodId);
    }

    const { platformFee, netAmount } = computeFees(amount, await this.settingsService.getPlatformFeePercentage());
    const metadata = Object.fromEntries(
      Object.entries(params.metadata ?? {}).filter(([, value]) => value !== undefined),
    );

    // The transaction exists before the intent, so a webhook received right
    // after the intent is created always finds it (through metadata.transactionId)
    const transaction = await this.prisma.transaction.create({
      data: {
        fromUserId: params.payerId,
        toUserId: params.creatorId,
        type: TRANSACTION_TYPE[params.kind],
        status: 'PENDING',
        amount,
        currency: 'EUR',
        platformFee,
        netAmount,
        contentId: params.contentId,
        metadata: { ...metadata, kind: params.kind },
      },
    });

    let paymentIntent: Stripe.PaymentIntent;
    try {
      paymentIntent = await this.stripeService.createOneTimePaymentIntent({
        amount,
        platformFee,
        customerId,
        connectedAccountId: creator.stripeAccountId,
        paymentMethodId: params.paymentMethodId,
        description: params.description,
        metadata: {
          transactionId: transaction.id,
          kind: params.kind,
          payerId: params.payerId,
          creatorId: params.creatorId,
          ...(params.contentId && { contentId: params.contentId }),
          ...(typeof metadata.streamId === 'string' && { streamId: metadata.streamId }),
          ...(typeof metadata.messageId === 'string' && { messageId: metadata.messageId }),
        },
      });
    } catch (error) {
      // Card declined while confirming with a saved card, or Stripe unavailable
      const message = error?.message || 'Payment failed';
      await this.prisma.transaction.update({
        where: { id: transaction.id },
        data: { status: 'FAILED', failedAt: new Date(), failureReason: message },
      });
      this.logger.warn(`Payment intent creation failed for transaction ${transaction.id}: ${message}`);
      throw new BadRequestException(message);
    }

    await this.prisma.transaction.update({
      where: { id: transaction.id },
      data: { stripePaymentIntentId: paymentIntent.id },
    });

    // A saved card without 3D Secure succeeds right away
    return this.processPaymentIntent(paymentIntent);
  }

  /**
   * Re-read a payment intent from Stripe on behalf of the payer and grant
   * access if it succeeded (idempotent)
   */
  async confirmPayment(
    userId: string,
    paymentIntentId: string,
    expected: {
      kind: OneTimePaymentKind;
      contentId?: string;
      creatorId?: string;
      /** Metadata values the transaction must carry (e.g. messageId) */
      metadata?: Record<string, string>;
    },
  ): Promise<PaymentFlowResult> {
    const transaction = await this.prisma.transaction.findUnique({
      where: { stripePaymentIntentId: paymentIntentId },
    });

    const transactionMetadata = (transaction?.metadata as Record<string, unknown> | null) ?? {};
    const kind = transactionMetadata.kind;
    if (
      !transaction ||
      Object.entries(expected.metadata ?? {}).some(([key, value]) => transactionMetadata[key] !== value) ||
      transaction.fromUserId !== userId ||
      transaction.type !== TRANSACTION_TYPE[expected.kind] ||
      (kind && kind !== expected.kind) ||
      (expected.contentId && transaction.contentId !== expected.contentId) ||
      (expected.creatorId && transaction.toUserId !== expected.creatorId)
    ) {
      throw new NotFoundException('Payment not found');
    }

    if (transaction.status === 'COMPLETED') {
      return this.toResult(transaction, 'completed', null);
    }

    const paymentIntent = await this.stripeService.retrievePaymentIntent(paymentIntentId);
    return this.processPaymentIntent(paymentIntent);
  }

  /**
   * Webhook entry point for payment_intent.succeeded. Returns false when the
   * intent does not belong to a one-off payment.
   */
  async handlePaymentIntentSucceeded(paymentIntent: Stripe.PaymentIntent) {
    const transaction = await this.findTransaction(paymentIntent);
    if (!transaction || !this.isOneTimePayment(transaction)) {
      return false;
    }

    await this.processPaymentIntent(paymentIntent);
    return true;
  }

  /**
   * Map a payment intent state onto its transaction, completing it on success
   */
  async processPaymentIntent(paymentIntent: Stripe.PaymentIntent): Promise<PaymentFlowResult> {
    const transaction = await this.findTransaction(paymentIntent);
    if (!transaction) {
      throw new NotFoundException('Payment not found');
    }

    switch (paymentIntent.status) {
      case 'succeeded': {
        await this.completeTransaction(transaction.id, paymentIntent);
        const current = await this.prisma.transaction.findUnique({ where: { id: transaction.id } });
        const completed = current?.status === 'COMPLETED';
        return this.toResult(current ?? transaction, completed ? 'completed' : 'failed', null);
      }
      case 'processing':
        return this.toResult(transaction, 'processing', null);
      case 'requires_action':
      case 'requires_confirmation':
        return this.toResult(transaction, 'requires_action', paymentIntent.client_secret);
      case 'requires_payment_method':
        return this.toResult(transaction, 'requires_payment_method', paymentIntent.client_secret);
      default:
        return this.toResult(transaction, 'failed', null);
    }
  }

  /**
   * PENDING -> COMPLETED, then grant access, credit the creator and notify.
   * Returns true only for the call that actually completed the transaction.
   */
  async completeTransaction(transactionId: string, paymentIntent: Stripe.PaymentIntent) {
    const transaction = await this.prisma.transaction.findUnique({ where: { id: transactionId } });
    if (!transaction) return false;

    // Never grant more than what was charged
    if (
      paymentIntent.amount_received < toCents(transaction.amount) ||
      paymentIntent.currency?.toLowerCase() !== transaction.currency.toLowerCase()
    ) {
      this.logger.error(
        `Payment intent ${paymentIntent.id} amount ${paymentIntent.amount_received} ${paymentIntent.currency} ` +
          `does not match transaction ${transaction.id} (${transaction.amount} ${transaction.currency})`,
      );
      return false;
    }

    const metadata = (transaction.metadata as Record<string, unknown> | null) ?? {};
    const kind = (metadata.kind as OneTimePaymentKind | undefined) ?? this.inferKind(transaction);
    const amount = Number(transaction.amount);
    const netAmount = Number(transaction.netAmount);
    const chargeId =
      typeof paymentIntent.latest_charge === 'string'
        ? paymentIntent.latest_charge
        : paymentIntent.latest_charge?.id;

    const completed = await this.prisma.$transaction(async (tx) => {
      const claimed = await tx.transaction.updateMany({
        where: { id: transaction.id, status: { in: [...COMPLETABLE_STATUSES] } },
        data: {
          status: 'COMPLETED',
          processedAt: new Date(),
          failedAt: null,
          failureReason: null,
          ...(chargeId && { stripeChargeId: chargeId }),
        },
      });

      // Already completed by the webhook or a confirm call (or refunded since)
      if (claimed.count === 0) return false;

      if (kind === 'content_unlock' && transaction.contentId) {
        await tx.contentUnlock.upsert({
          where: {
            contentId_userId: { contentId: transaction.contentId, userId: transaction.fromUserId },
          },
          create: {
            contentId: transaction.contentId,
            userId: transaction.fromUserId,
            paidAmount: amount,
          },
          update: {},
        });
      }

      if (kind === 'message_unlock' && typeof metadata.messageId === 'string') {
        await tx.message.updateMany({
          where: { id: metadata.messageId, receiverId: transaction.fromUserId },
          data: { isPurchased: true },
        });
      }

      if (transaction.toUserId) {
        await tx.creatorProfile.updateMany({
          where: { userId: transaction.toUserId },
          data: { totalEarnings: { increment: netAmount } },
        });
      }

      await tx.subscriberProfile.updateMany({
        where: { userId: transaction.fromUserId },
        data: { totalSpent: { increment: amount } },
      });

      return true;
    });

    if (!completed) return false;

    this.logger.log(`One-off payment completed: ${transaction.id} (${kind}, €${amount.toFixed(2)})`);
    await this.afterCompletion(transaction, kind, metadata);
    return true;
  }

  /**
   * Notifications and realtime events, once per completed payment
   */
  private async afterCompletion(
    transaction: { id: string; fromUserId: string; toUserId: string | null; contentId: string | null; amount: Prisma.Decimal },
    kind: OneTimePaymentKind,
    metadata: Record<string, unknown>,
  ) {
    if (!transaction.toUserId) return;

    const amount = Number(transaction.amount);
    const fromUser = await this.prisma.user.findUnique({
      where: { id: transaction.fromUserId },
      select: { id: true, username: true, displayName: true, avatar: true },
    });
    const fanName = fromUser?.displayName || fromUser?.username || 'Un fan';
    const message = typeof metadata.message === 'string' && metadata.message ? metadata.message : null;
    const streamId = typeof metadata.streamId === 'string' ? metadata.streamId : null;

    try {
      if (kind === 'tip') {
        await this.prisma.notification.create({
          data: {
            userId: transaction.toUserId,
            type: 'NEW_TIP',
            title: 'Nouveau pourboire !',
            message: `${fanName} vous a envoyé un pourboire de ${amount.toFixed(2)}€${message ? ` : ${message}` : ''}`,
            metadata: {
              fromUserId: transaction.fromUserId,
              amount,
              transactionId: transaction.id,
              ...(streamId && { streamId }),
            },
          },
        });
      } else if (kind === 'message_unlock') {
        await this.prisma.notification.create({
          data: {
            userId: transaction.toUserId,
            type: 'SYSTEM',
            title: 'Message débloqué',
            message: `${fanName} a débloqué votre message payant pour ${amount.toFixed(2)}€`,
            linkUrl: fromUser ? `/messages?user=${fromUser.username}` : '/messages',
            metadata: {
              kind: 'PPV_PURCHASE',
              fromUserId: transaction.fromUserId,
              messageId: typeof metadata.messageId === 'string' ? metadata.messageId : null,
              amount,
              transactionId: transaction.id,
            },
          },
        });
      } else {
        const isStream = kind === 'stream_access';
        await this.prisma.notification.create({
          data: {
            userId: transaction.toUserId,
            type: 'SYSTEM',
            title: isStream ? 'Accès au live acheté' : 'Contenu débloqué',
            message: isStream
              ? `${fanName} a acheté l'accès à votre live pour ${amount.toFixed(2)}€`
              : `${fanName} a débloqué votre contenu pour ${amount.toFixed(2)}€`,
            linkUrl: isStream ? null : `/content/${transaction.contentId}`,
            metadata: {
              kind: 'PPV_PURCHASE',
              fromUserId: transaction.fromUserId,
              ...(isStream ? { streamId: transaction.contentId } : { contentId: transaction.contentId }),
              amount,
              transactionId: transaction.id,
            },
          },
        });
      }
    } catch (error) {
      this.logger.error(`Failed to notify creator for transaction ${transaction.id}: ${error.message}`);
    }

    if (kind === 'tip' && fromUser) {
      this.tipCompleted$.next({
        transactionId: transaction.id,
        streamId,
        creatorId: transaction.toUserId,
        fromUser,
        amount,
        message,
        completedAt: new Date(),
      });
    }
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
    if (user.stripeCustomerId) {
      return user.stripeCustomerId;
    }

    const customer = await this.stripeService.createCustomer(user.email, user.username);

    await this.prisma.user.update({
      where: { id: user.id },
      data: { stripeCustomerId: customer.id },
    });

    return customer.id;
  }

  /**
   * A saved card can only be charged by the customer it belongs to
   */
  async assertPaymentMethodOwnership(customerId: string, paymentMethodId: string) {
    const method = await this.stripeService.retrievePaymentMethod(paymentMethodId).catch(() => null);
    const owner = typeof method?.customer === 'string' ? method.customer : method?.customer?.id;

    if (!method || owner !== customerId) {
      throw new NotFoundException('Payment method not found');
    }
  }

  private async findTransaction(paymentIntent: Stripe.PaymentIntent) {
    const byIntent = await this.prisma.transaction.findUnique({
      where: { stripePaymentIntentId: paymentIntent.id },
    });
    if (byIntent) return byIntent;

    const transactionId = paymentIntent.metadata?.transactionId;
    if (!transactionId) return null;

    const byMetadata = await this.prisma.transaction.findUnique({ where: { id: transactionId } });
    if (!byMetadata || (byMetadata.stripePaymentIntentId && byMetadata.stripePaymentIntentId !== paymentIntent.id)) {
      return null;
    }

    // The webhook beat the update that links the intent to the transaction
    if (!byMetadata.stripePaymentIntentId) {
      await this.prisma.transaction.update({
        where: { id: byMetadata.id },
        data: { stripePaymentIntentId: paymentIntent.id },
      });
    }
    return { ...byMetadata, stripePaymentIntentId: paymentIntent.id };
  }

  private isOneTimePayment(transaction: { type: TransactionType }) {
    return transaction.type === 'TIP' || transaction.type === 'PPV_UNLOCK';
  }

  private inferKind(transaction: { type: TransactionType; contentId: string | null }): OneTimePaymentKind {
    return transaction.type === 'TIP' ? 'tip' : 'content_unlock';
  }

  private toResult(
    transaction: { id: string; stripePaymentIntentId: string | null; amount: Prisma.Decimal },
    status: PaymentFlowStatus,
    clientSecret: string | null,
  ): PaymentFlowResult {
    return {
      status,
      completed: status === 'completed',
      transactionId: transaction.id,
      paymentIntentId: transaction.stripePaymentIntentId,
      clientSecret,
      amount: Number(transaction.amount),
    };
  }
}
