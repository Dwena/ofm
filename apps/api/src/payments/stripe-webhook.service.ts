import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Stripe from 'stripe';
import { PrismaService } from '../common/database/prisma.service';
import { StripeService } from './stripe.service';

@Injectable()
export class StripeWebhookService {
  private readonly logger = new Logger(StripeWebhookService.name);
  private readonly stripe: Stripe;
  private readonly webhookSecret: string;

  constructor(
    private prisma: PrismaService,
    private stripeService: StripeService,
    private configService: ConfigService,
  ) {
    const stripeKey = this.configService.get<string>('STRIPE_SECRET_KEY');
    if (!stripeKey) {
      throw new Error('STRIPE_SECRET_KEY is not configured');
    }
    this.stripe = new Stripe(stripeKey, {
      apiVersion: '2023-10-16',
    });

    const webhookSecret = this.configService.get<string>('STRIPE_WEBHOOK_SECRET');
    if (!webhookSecret) {
      throw new Error('STRIPE_WEBHOOK_SECRET is not configured');
    }
    this.webhookSecret = webhookSecret;
  }

  /**
   * Handle incoming Stripe webhook
   */
  async handleWebhook(rawBody: Buffer, signature: string) {
    let event: Stripe.Event;

    try {
      // Verify webhook signature
      event = this.stripe.webhooks.constructEvent(
        rawBody,
        signature,
        this.webhookSecret,
      );
    } catch (err) {
      this.logger.error(`Webhook signature verification failed: ${err.message}`);
      throw new Error(`Webhook signature verification failed: ${err.message}`);
    }

    this.logger.log(`Processing webhook event: ${event.type}`);

    // Route to appropriate handler
    try {
      switch (event.type) {
        // Payment Intents
        case 'payment_intent.succeeded':
          await this.handlePaymentIntentSucceeded(event.data.object as Stripe.PaymentIntent);
          break;
        case 'payment_intent.payment_failed':
          await this.handlePaymentIntentFailed(event.data.object as Stripe.PaymentIntent);
          break;
        case 'payment_intent.canceled':
          await this.handlePaymentIntentCanceled(event.data.object as Stripe.PaymentIntent);
          break;

        // Charges (for refunds and disputes)
        case 'charge.refunded':
          await this.handleChargeRefunded(event.data.object as Stripe.Charge);
          break;
        case 'charge.dispute.created':
          await this.handleDisputeCreated(event.data.object as Stripe.Dispute);
          break;
        case 'charge.dispute.updated':
          await this.handleDisputeUpdated(event.data.object as Stripe.Dispute);
          break;
        case 'charge.dispute.closed':
          await this.handleDisputeClosed(event.data.object as Stripe.Dispute);
          break;

        // Subscriptions
        case 'customer.subscription.created':
          await this.handleSubscriptionCreated(event.data.object as Stripe.Subscription);
          break;
        case 'customer.subscription.updated':
          await this.handleSubscriptionUpdated(event.data.object as Stripe.Subscription);
          break;
        case 'customer.subscription.deleted':
          await this.handleSubscriptionDeleted(event.data.object as Stripe.Subscription);
          break;
        case 'customer.subscription.trial_will_end':
          await this.handleSubscriptionTrialWillEnd(event.data.object as Stripe.Subscription);
          break;

        // Invoices
        case 'invoice.created':
          await this.handleInvoiceCreated(event.data.object as Stripe.Invoice);
          break;
        case 'invoice.finalized':
          await this.handleInvoiceFinalized(event.data.object as Stripe.Invoice);
          break;
        case 'invoice.paid':
          await this.handleInvoicePaid(event.data.object as Stripe.Invoice);
          break;
        case 'invoice.payment_failed':
          await this.handleInvoicePaymentFailed(event.data.object as Stripe.Invoice);
          break;

        // Connect Account
        case 'account.updated':
          await this.handleAccountUpdated(event.data.object as Stripe.Account);
          break;
        case 'account.external_account.created':
          await this.handleExternalAccountCreated(event.data.object as Stripe.BankAccount);
          break;

        // Transfers & Payouts
        case 'transfer.created':
          await this.handleTransferCreated(event.data.object as Stripe.Transfer);
          break;
        case 'payout.paid':
          await this.handlePayoutPaid(event.data.object as Stripe.Payout);
          break;
        case 'payout.failed':
          await this.handlePayoutFailed(event.data.object as Stripe.Payout);
          break;

        default:
          this.logger.warn(`Unhandled webhook event type: ${event.type}`);
      }

      return { type: event.type, handled: true };
    } catch (error) {
      this.logger.error(`Error handling webhook ${event.type}: ${error.message}`, error.stack);
      throw error;
    }
  }

  // ==================== PAYMENT INTENTS ====================

  private async handlePaymentIntentSucceeded(paymentIntent: Stripe.PaymentIntent) {
    this.logger.log(`Payment succeeded: ${paymentIntent.id}`);

    const transaction = await this.prisma.transaction.findFirst({
      where: { stripePaymentIntentId: paymentIntent.id },
    });

    if (!transaction) {
      this.logger.warn(`Transaction not found for payment intent: ${paymentIntent.id}`);
      return;
    }

    // Update transaction status
    await this.prisma.transaction.update({
      where: { id: transaction.id },
      data: {
        status: 'COMPLETED',
        processedAt: new Date(),
      },
    });

    // Send notification to user
    await this.createNotification({
      userId: transaction.fromUserId,
      type: 'PAYMENT_SUCCESS',
      title: 'Paiement réussi',
      message: `Votre paiement de ${(Number(transaction.amount) / 100).toFixed(2)}€ a été traité avec succès`,
    });

    this.logger.log(`Transaction ${transaction.id} marked as COMPLETED`);
  }

  private async handlePaymentIntentFailed(paymentIntent: Stripe.PaymentIntent) {
    this.logger.error(`Payment failed: ${paymentIntent.id}`);

    const transaction = await this.prisma.transaction.findFirst({
      where: { stripePaymentIntentId: paymentIntent.id },
    });

    if (!transaction) return;

    await this.prisma.transaction.update({
      where: { id: transaction.id },
      data: {
        status: 'FAILED',
        failedAt: new Date(),
        failureReason: paymentIntent.last_payment_error?.message || 'Payment failed',
      },
    });

    // Notify user
    await this.createNotification({
      userId: transaction.fromUserId,
      type: 'PAYMENT_FAILED',
      title: 'Paiement échoué',
      message: `Votre paiement n'a pas pu être traité. ${paymentIntent.last_payment_error?.message || ''}`,
    });
  }

  private async handlePaymentIntentCanceled(paymentIntent: Stripe.PaymentIntent) {
    this.logger.log(`Payment canceled: ${paymentIntent.id}`);

    const transaction = await this.prisma.transaction.findFirst({
      where: { stripePaymentIntentId: paymentIntent.id },
    });

    if (!transaction) return;

    await this.prisma.transaction.update({
      where: { id: transaction.id },
      data: {
        status: 'CANCELLED',
        failedAt: new Date(),
        failureReason: 'Payment canceled by user',
      },
    });
  }

  // ==================== REFUNDS & DISPUTES ====================

  private async handleChargeRefunded(charge: Stripe.Charge) {
    this.logger.log(`Charge refunded: ${charge.id}`);

    const transaction = await this.prisma.transaction.findFirst({
      where: { stripeChargeId: charge.id },
    });

    if (!transaction) {
      this.logger.warn(`Transaction not found for charge: ${charge.id}`);
      return;
    }

    // Check if full or partial refund
    const refundAmount = charge.amount_refunded;
    const isFullRefund = refundAmount === charge.amount;

    // Create refund transaction
    await this.prisma.transaction.create({
      data: {
        fromUserId: transaction.toUserId || transaction.fromUserId,
        toUserId: transaction.fromUserId,
        type: 'REFUND',
        status: 'COMPLETED',
        amount: refundAmount,
        currency: transaction.currency,
        platformFee: 0,
        netAmount: refundAmount,
        stripeChargeId: charge.id,
        metadata: {
          originalTransactionId: transaction.id,
          refundType: isFullRefund ? 'full' : 'partial',
          refundReason: 'Stripe webhook refund',
        },
        processedAt: new Date(),
      },
    });

    // Update original transaction
    await this.prisma.transaction.update({
      where: { id: transaction.id },
      data: {
        status: isFullRefund ? 'REFUNDED' : 'PARTIALLY_REFUNDED',
        metadata: {
          ...(transaction.metadata as any),
          refundAmount,
          refundedAt: new Date().toISOString(),
        },
      },
    });

    // Notify both parties
    await this.createNotification({
      userId: transaction.fromUserId,
      type: 'REFUND_PROCESSED',
      title: 'Remboursement effectué',
      message: `Un remboursement de ${(refundAmount / 100).toFixed(2)}€ a été traité`,
    });

    if (transaction.toUserId) {
      await this.createNotification({
        userId: transaction.toUserId,
        type: 'REFUND_ISSUED',
        title: 'Remboursement émis',
        message: `Un remboursement de ${(refundAmount / 100).toFixed(2)}€ a été émis pour une transaction`,
      });
    }

    this.logger.log(`Refund processed for transaction: ${transaction.id}`);
  }

  private async handleDisputeCreated(dispute: Stripe.Dispute) {
    this.logger.warn(`Dispute created: ${dispute.id}`);

    const charge = await this.stripe.charges.retrieve(dispute.charge as string);
    const transaction = await this.prisma.transaction.findFirst({
      where: { stripeChargeId: charge.id },
    });

    if (!transaction) {
      this.logger.warn(`Transaction not found for disputed charge: ${charge.id}`);
      return;
    }

    // Create dispute record
    await this.prisma.dispute.create({
      data: {
        stripeDisputeId: dispute.id,
        transactionId: transaction.id,
        amount: dispute.amount,
        currency: dispute.currency,
        reason: dispute.reason,
        status: dispute.status,
        evidence: dispute.evidence as any,
        evidenceDueBy: dispute.evidence_details?.due_by
          ? new Date(dispute.evidence_details.due_by * 1000)
          : null,
      },
    });

    // Update transaction
    await this.prisma.transaction.update({
      where: { id: transaction.id },
      data: {
        status: 'DISPUTED',
        metadata: {
          ...(transaction.metadata as any),
          disputeId: dispute.id,
          disputeReason: dispute.reason,
          disputedAt: new Date().toISOString(),
        },
      },
    });

    // Notify creator
    if (transaction.toUserId) {
      await this.createNotification({
        userId: transaction.toUserId,
        type: 'DISPUTE_CREATED',
        title: 'Litige ouvert',
        message: `Un litige a été ouvert pour un paiement de ${(dispute.amount / 100).toFixed(2)}€. Raison: ${dispute.reason}`,
      });
    }

    this.logger.log(`Dispute ${dispute.id} recorded for transaction ${transaction.id}`);
  }

  private async handleDisputeUpdated(dispute: Stripe.Dispute) {
    this.logger.log(`Dispute updated: ${dispute.id}`);

    const disputeRecord = await this.prisma.dispute.findUnique({
      where: { stripeDisputeId: dispute.id },
    });

    if (!disputeRecord) return;

    await this.prisma.dispute.update({
      where: { id: disputeRecord.id },
      data: {
        status: dispute.status,
        evidence: dispute.evidence as any,
      },
    });
  }

  private async handleDisputeClosed(dispute: Stripe.Dispute) {
    this.logger.log(`Dispute closed: ${dispute.id} - Status: ${dispute.status}`);

    const disputeRecord = await this.prisma.dispute.findUnique({
      where: { stripeDisputeId: dispute.id },
      include: { transaction: true },
    });

    if (!disputeRecord) return;

    const won = dispute.status === 'won';

    await this.prisma.dispute.update({
      where: { id: disputeRecord.id },
      data: {
        status: dispute.status,
        closedAt: new Date(),
      },
    });

    // Update transaction
    await this.prisma.transaction.update({
      where: { id: disputeRecord.transactionId },
      data: {
        status: won ? 'COMPLETED' : 'REFUNDED',
        metadata: {
          ...(disputeRecord.transaction.metadata as any),
          disputeResolution: dispute.status,
          disputeClosedAt: new Date().toISOString(),
        },
      },
    });

    // Notify creator
    if (disputeRecord.transaction.toUserId) {
      await this.createNotification({
        userId: disputeRecord.transaction.toUserId,
        type: won ? 'DISPUTE_WON' : 'DISPUTE_LOST',
        title: won ? 'Litige gagné' : 'Litige perdu',
        message: won
          ? 'Vous avez gagné le litige. Les fonds sont sécurisés.'
          : 'Le litige a été résolu en faveur du client. Les fonds ont été remboursés.',
      });
    }
  }

  // ==================== SUBSCRIPTIONS ====================

  private async handleSubscriptionCreated(subscription: Stripe.Subscription) {
    this.logger.log(`Subscription created: ${subscription.id}`);

    // Subscription should already be created in our DB when user subscribes
    // This webhook confirms it's active in Stripe
    const dbSubscription = await this.prisma.subscription.findUnique({
      where: { stripeSubscriptionId: subscription.id },
    });

    if (dbSubscription) {
      // Map Stripe status to our status
      let dbStatus: 'ACTIVE' | 'CANCELLED' | 'EXPIRED' | 'PAST_DUE' | 'PAUSED' = 'ACTIVE';
      if (subscription.status === 'active') dbStatus = 'ACTIVE';
      else if (subscription.status === 'canceled') dbStatus = 'CANCELLED';
      else if (subscription.status === 'past_due') dbStatus = 'PAST_DUE';
      else if (subscription.status === 'unpaid') dbStatus = 'PAST_DUE';
      else if (subscription.status === 'paused') dbStatus = 'PAUSED';

      await this.prisma.subscription.update({
        where: { id: dbSubscription.id },
        data: {
          status: dbStatus,
          currentPeriodStart: new Date(subscription.current_period_start * 1000),
          currentPeriodEnd: new Date(subscription.current_period_end * 1000),
        },
      });
    }
  }

  private async handleSubscriptionUpdated(subscription: Stripe.Subscription) {
    this.logger.log(`Subscription updated: ${subscription.id}`);

    const dbSubscription = await this.prisma.subscription.findUnique({
      where: { stripeSubscriptionId: subscription.id },
    });

    if (!dbSubscription) return;

    let status: 'ACTIVE' | 'CANCELLED' | 'EXPIRED' | 'PAST_DUE' | 'PAUSED';
    switch (subscription.status) {
      case 'active':
        status = 'ACTIVE';
        break;
      case 'canceled':
        status = 'CANCELLED';
        break;
      case 'past_due':
      case 'unpaid':
        status = 'PAST_DUE';
        break;
      case 'paused':
        status = 'PAUSED';
        break;
      default:
        status = dbSubscription.status;
    }

    await this.prisma.subscription.update({
      where: { id: dbSubscription.id },
      data: {
        status,
        currentPeriodStart: new Date(subscription.current_period_start * 1000),
        currentPeriodEnd: new Date(subscription.current_period_end * 1000),
        cancelAtPeriodEnd: subscription.cancel_at_period_end,
        cancelledAt: subscription.canceled_at ? new Date(subscription.canceled_at * 1000) : null,
      },
    });

    // Notify user of status change
    if (status === 'CANCELLED') {
      await this.createNotification({
        userId: dbSubscription.subscriberId,
        type: 'SUBSCRIPTION_CANCELLED',
        title: 'Abonnement annulé',
        message: 'Votre abonnement a été annulé',
      });
    }
  }

  private async handleSubscriptionDeleted(subscription: Stripe.Subscription) {
    this.logger.log(`Subscription deleted: ${subscription.id}`);

    const dbSubscription = await this.prisma.subscription.findUnique({
      where: { stripeSubscriptionId: subscription.id },
    });

    if (!dbSubscription) return;

    await this.prisma.subscription.update({
      where: { id: dbSubscription.id },
      data: {
        status: 'CANCELLED',
        cancelledAt: new Date(),
      },
    });
  }

  private async handleSubscriptionTrialWillEnd(subscription: Stripe.Subscription) {
    this.logger.log(`Subscription trial ending soon: ${subscription.id}`);

    const dbSubscription = await this.prisma.subscription.findUnique({
      where: { stripeSubscriptionId: subscription.id },
    });

    if (!dbSubscription) return;

    // Notify user that trial is ending
    await this.createNotification({
      userId: dbSubscription.subscriberId,
      type: 'TRIAL_ENDING',
      title: 'Fin de période d\'essai',
      message: 'Votre période d\'essai se termine bientôt. Assurez-vous que votre moyen de paiement est à jour.',
    });
  }

  // ==================== INVOICES ====================

  private async handleInvoiceCreated(invoice: Stripe.Invoice) {
    this.logger.log(`Invoice created: ${invoice.id}`);
    // Invoice creation is typically just notification
  }

  private async handleInvoiceFinalized(invoice: Stripe.Invoice) {
    this.logger.log(`Invoice finalized: ${invoice.id}`);
    // Could send invoice email here
  }

  private async handleInvoicePaid(invoice: Stripe.Invoice) {
    this.logger.log(`Invoice paid: ${invoice.id}`);

    if (!invoice.subscription) return;

    const subscription = await this.prisma.subscription.findUnique({
      where: { stripeSubscriptionId: invoice.subscription as string },
      include: { tier: true },
    });

    if (!subscription) return;

    // Create transaction for subscription payment
    await this.prisma.transaction.create({
      data: {
        fromUserId: subscription.subscriberId,
        toUserId: subscription.tier ? subscription.tier.creatorId : null,
        type: 'SUBSCRIPTION',
        status: 'COMPLETED',
        amount: invoice.amount_paid,
        currency: invoice.currency,
        platformFee: Math.floor(invoice.amount_paid * 0.1), // 10% platform fee
        netAmount: Math.floor(invoice.amount_paid * 0.9),
        stripeChargeId: invoice.charge as string,
        subscriptionId: subscription.id,
        processedAt: new Date(),
      },
    });

    // Notify creator of new payment
    if (subscription.tier && subscription.tier.creatorId) {
      await this.createNotification({
        userId: subscription.tier.creatorId,
        type: 'SUBSCRIPTION_RENEWAL',
        title: 'Renouvellement d\'abonnement',
        message: `Un abonnement a été renouvelé pour ${(invoice.amount_paid / 100).toFixed(2)}€`,
      });
    }
  }

  private async handleInvoicePaymentFailed(invoice: Stripe.Invoice) {
    this.logger.error(`Invoice payment failed: ${invoice.id}`);

    if (!invoice.subscription) return;

    const subscription = await this.prisma.subscription.findUnique({
      where: { stripeSubscriptionId: invoice.subscription as string },
    });

    if (!subscription) return;

    // Notify subscriber
    await this.createNotification({
      userId: subscription.subscriberId,
      type: 'PAYMENT_FAILED',
      title: 'Échec du paiement',
      message: 'Le paiement de votre abonnement a échoué. Veuillez mettre à jour votre moyen de paiement.',
    });
  }

  // ==================== CONNECT ACCOUNT ====================

  private async handleAccountUpdated(account: Stripe.Account) {
    this.logger.log(`Account updated: ${account.id}`);

    const user = await this.prisma.user.findFirst({
      where: { stripeAccountId: account.id },
    });

    if (!user) return;

    const onboarded = account.details_submitted && account.charges_enabled && account.payouts_enabled;

    await this.prisma.user.update({
      where: { id: user.id },
      data: {
        stripeOnboarded: onboarded,
      },
    });

    if (onboarded) {
      await this.createNotification({
        userId: user.id,
        type: 'ACCOUNT_VERIFIED',
        title: 'Compte vérifié',
        message: 'Votre compte Stripe a été vérifié. Vous pouvez maintenant recevoir des paiements.',
      });
    }
  }

  private async handleExternalAccountCreated(bankAccount: Stripe.BankAccount) {
    this.logger.log(`External account added: ${bankAccount.id}`);
  }

  // ==================== TRANSFERS & PAYOUTS ====================

  private async handleTransferCreated(transfer: Stripe.Transfer) {
    this.logger.log(`Transfer created: ${transfer.id}`);
  }

  private async handlePayoutPaid(payout: Stripe.Payout) {
    this.logger.log(`Payout paid: ${payout.id}`);

    const dbPayout = await this.prisma.payout.findFirst({
      where: { stripePayoutId: payout.id },
    });

    if (!dbPayout) return;

    await this.prisma.payout.update({
      where: { id: dbPayout.id },
      data: {
        status: 'COMPLETED',
        paidAt: new Date(payout.arrival_date * 1000),
      },
    });

    await this.createNotification({
      userId: dbPayout.creatorId,
      type: 'PAYOUT_COMPLETED',
      title: 'Paiement effectué',
      message: `Votre paiement de ${(Number(dbPayout.amount) / 100).toFixed(2)}€ a été transféré sur votre compte bancaire.`,
    });
  }

  private async handlePayoutFailed(payout: Stripe.Payout) {
    this.logger.error(`Payout failed: ${payout.id}`);

    const dbPayout = await this.prisma.payout.findFirst({
      where: { stripePayoutId: payout.id },
    });

    if (!dbPayout) return;

    await this.prisma.payout.update({
      where: { id: dbPayout.id },
      data: {
        status: 'FAILED',
        failureReason: payout.failure_message || 'Payout failed',
      },
    });

    await this.createNotification({
      userId: dbPayout.creatorId,
      type: 'PAYOUT_FAILED',
      title: 'Échec du paiement',
      message: `Le transfert de ${(Number(dbPayout.amount) / 100).toFixed(2)}€ a échoué. ${payout.failure_message || ''}`,
    });
  }

  // ==================== HELPERS ====================

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
