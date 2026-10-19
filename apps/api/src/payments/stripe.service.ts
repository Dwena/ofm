import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Stripe from 'stripe';
import { PrismaService } from '../common/database/prisma.service';
import { toCents } from '../common/utils/money';

@Injectable()
export class StripeService {
  private readonly logger = new Logger(StripeService.name);
  private stripe: Stripe;
  private platformFeePercentage: number;

  constructor(
    private configService: ConfigService,
    private prisma: PrismaService,
  ) {
    this.stripe = new Stripe(this.configService.get('STRIPE_SECRET_KEY')!, {
      apiVersion: '2023-10-16',
    });
    this.platformFeePercentage = parseFloat(
      this.configService.get('STRIPE_PLATFORM_FEE_PERCENTAGE', '15'),
    );
  }

  /**
   * Create Stripe customer
   */
  async createCustomer(email: string, name: string) {
    return this.stripe.customers.create({
      email,
      name,
      metadata: {
        source: 'ofm',
      },
    });
  }

  /**
   * Create payment intent
   */
  async createPaymentIntent(
    amount: number,
    currency: string,
    customerId?: string,
    connectedAccountId?: string,
  ) {
    const paymentIntentData: Stripe.PaymentIntentCreateParams = {
      amount: Math.round(amount * 100), // Convert to cents
      currency,
      ...(customerId && { customer: customerId }),
      automatic_payment_methods: {
        enabled: true,
      },
      metadata: {
        platform: 'ofm',
      },
    };

    // If connected account, add application fee
    if (connectedAccountId) {
      const platformFee = Math.round((amount * this.platformFeePercentage) / 100 * 100);
      paymentIntentData.application_fee_amount = platformFee;
      paymentIntentData.transfer_data = {
        destination: connectedAccountId,
      };
    }

    return this.stripe.paymentIntents.create(paymentIntentData);
  }

  /**
   * Create a one-off card payment (tip, PPV) as a destination charge on the
   * creator's connected account. Amounts are in euros and converted to cents
   * here. With a saved card the intent is confirmed immediately (it may still
   * require 3D Secure); otherwise the client confirms it with Stripe Elements.
   */
  async createOneTimePaymentIntent(params: {
    amount: number;
    platformFee: number;
    customerId: string;
    connectedAccountId: string;
    paymentMethodId?: string;
    description?: string;
    metadata: Record<string, string>;
  }) {
    return this.stripe.paymentIntents.create({
      amount: toCents(params.amount),
      currency: 'eur',
      customer: params.customerId,
      payment_method_types: ['card'],
      application_fee_amount: toCents(params.platformFee),
      transfer_data: {
        destination: params.connectedAccountId,
      },
      ...(params.description && { description: params.description }),
      ...(params.paymentMethodId
        ? { payment_method: params.paymentMethodId, confirm: true }
        : { setup_future_usage: 'on_session' as const }),
      metadata: {
        ...params.metadata,
        platform: 'ofm',
      },
    });
  }

  /**
   * Retrieve a payment intent
   */
  async retrievePaymentIntent(paymentIntentId: string) {
    return this.stripe.paymentIntents.retrieve(paymentIntentId);
  }

  /**
   * Create Stripe Connect account for creator
   */
  async createConnectAccount(email: string, userId: string) {
    return this.stripe.accounts.create({
      type: 'express',
      email,
      capabilities: {
        card_payments: { requested: true },
        transfers: { requested: true },
      },
      business_type: 'individual',
      metadata: {
        userId,
        platform: 'ofm',
      },
    });
  }

  /**
   * Create account link for onboarding
   */
  async createAccountLink(accountId: string, refreshUrl: string, returnUrl: string) {
    return this.stripe.accountLinks.create({
      account: accountId,
      refresh_url: refreshUrl,
      return_url: returnUrl,
      type: 'account_onboarding',
    });
  }

  /**
   * Get account status
   */
  async getAccount(accountId: string): Promise<Stripe.Account> {
    return this.stripe.accounts.retrieve(accountId);
  }

  /**
   * Check if account is fully onboarded
   */
  async isAccountOnboarded(accountId: string): Promise<boolean> {
    const account = await this.getAccount(accountId);
    return (
      account.charges_enabled &&
      account.payouts_enabled &&
      account.details_submitted
    );
  }

  /**
   * Create subscription
   */
  async createSubscription(
    customerId: string,
    priceId: string,
    connectedAccountId: string,
  ) {
    const platformFee = this.platformFeePercentage;

    return this.stripe.subscriptions.create({
      customer: customerId,
      items: [{ price: priceId }],
      application_fee_percent: platformFee,
      transfer_data: {
        destination: connectedAccountId,
      },
      metadata: {
        platform: 'ofm',
      },
    });
  }

  /**
   * Create a fan subscription to a creator tier.
   * Uses destination charges like one-off payments: the subscription lives on
   * the platform account and each invoice is transferred to the creator minus
   * the platform fee. The first invoice is left incomplete until the fan
   * confirms the payment client-side, unless a saved card is provided.
   */
  async createTierSubscription(params: {
    customerId: string;
    priceId: string;
    connectedAccountId: string;
    paymentMethodId?: string;
    metadata: Record<string, string>;
  }) {
    return this.stripe.subscriptions.create({
      customer: params.customerId,
      items: [{ price: params.priceId }],
      application_fee_percent: this.platformFeePercentage,
      transfer_data: {
        destination: params.connectedAccountId,
      },
      ...(params.paymentMethodId
        ? {
            default_payment_method: params.paymentMethodId,
            payment_behavior: 'allow_incomplete' as const,
          }
        : {
            payment_behavior: 'default_incomplete' as const,
          }),
      payment_settings: {
        payment_method_types: ['card'],
        save_default_payment_method: 'on_subscription',
      },
      expand: ['latest_invoice.payment_intent'],
      metadata: {
        ...params.metadata,
        platform: 'ofm',
      },
    });
  }

  /**
   * Retrieve subscription (with latest invoice payment intent)
   */
  async retrieveSubscription(subscriptionId: string) {
    return this.stripe.subscriptions.retrieve(subscriptionId, {
      expand: ['latest_invoice.payment_intent'],
    });
  }

  /**
   * Schedule (or unschedule) cancellation at the end of the current period
   */
  async setCancelAtPeriodEnd(subscriptionId: string, cancelAtPeriodEnd: boolean) {
    return this.stripe.subscriptions.update(subscriptionId, {
      cancel_at_period_end: cancelAtPeriodEnd,
    });
  }

  /**
   * Update a fan subscription (tier change, metadata), returning it with the
   * latest invoice payment intent so a payment needing action can be confirmed
   */
  async updateTierSubscription(subscriptionId: string, params: Stripe.SubscriptionUpdateParams) {
    return this.stripe.subscriptions.update(subscriptionId, {
      ...params,
      expand: ['latest_invoice.payment_intent'],
    });
  }

  /**
   * List `incomplete` subscriptions (first payment never completed), for a
   * customer and/or created before a date (unix seconds)
   */
  async listIncompleteSubscriptions(params: { customerId?: string; createdBefore?: number }) {
    return this.stripe.subscriptions
      .list({
        status: 'incomplete',
        limit: 100,
        ...(params.customerId && { customer: params.customerId }),
        ...(params.createdBefore && { created: { lt: params.createdBefore } }),
      })
      .autoPagingToArray({ limit: 1000 });
  }

  /**
   * Retrieve customer
   */
  async getCustomer(customerId: string) {
    return this.stripe.customers.retrieve(customerId);
  }

  /**
   * List saved cards of a customer
   */
  async listPaymentMethods(customerId: string) {
    return this.stripe.paymentMethods.list({
      customer: customerId,
      type: 'card',
    });
  }

  /**
   * Retrieve a payment method
   */
  async retrievePaymentMethod(paymentMethodId: string) {
    return this.stripe.paymentMethods.retrieve(paymentMethodId);
  }

  /**
   * Create setup intent to save a card for future payments
   */
  async createSetupIntent(customerId: string) {
    return this.stripe.setupIntents.create({
      customer: customerId,
      payment_method_types: ['card'],
      usage: 'off_session',
      metadata: {
        platform: 'ofm',
      },
    });
  }

  /**
   * Set customer's default payment method for invoices
   */
  async setDefaultPaymentMethod(customerId: string, paymentMethodId: string) {
    return this.stripe.customers.update(customerId, {
      invoice_settings: {
        default_payment_method: paymentMethodId,
      },
    });
  }

  /**
   * Detach payment method from its customer
   */
  async detachPaymentMethod(paymentMethodId: string) {
    return this.stripe.paymentMethods.detach(paymentMethodId);
  }

  /**
   * Cancel subscription
   */
  async cancelSubscription(subscriptionId: string) {
    return this.stripe.subscriptions.cancel(subscriptionId);
  }

  /**
   * Update subscription
   */
  async updateSubscription(
    subscriptionId: string,
    priceId: string,
  ) {
    const subscription = await this.stripe.subscriptions.retrieve(subscriptionId);

    return this.stripe.subscriptions.update(subscriptionId, {
      items: [
        {
          id: subscription.items.data[0].id,
          price: priceId,
        },
      ],
      proration_behavior: 'create_prorations',
    });
  }

  /**
   * Create price for subscription tier
   */
  async createPrice(
    productId: string,
    amount: number,
    currency: string,
    interval: 'month' | 'year',
  ) {
    return this.stripe.prices.create({
      product: productId,
      unit_amount: Math.round(amount * 100),
      currency,
      recurring: {
        interval,
      },
    });
  }

  /**
   * Create product for creator
   */
  async createProduct(name: string, description: string, metadata?: any) {
    return this.stripe.products.create({
      name,
      description,
      metadata: {
        ...metadata,
        platform: 'ofm',
      },
    });
  }

  /**
   * Create payout to connected account
   * @param accountId Stripe connected account ID
   * @param amountCents Amount in cents (use toCents() on euro amounts)
   * @param currency Currency code (default: eur)
   */
  async createPayout(accountId: string, amountCents: number, currency: string = 'eur') {
    return this.stripe.payouts.create(
      {
        amount: Math.round(amountCents),
        currency,
      },
      {
        stripeAccount: accountId,
      },
    );
  }

  /**
   * Get balance for connected account
   */
  async getAccountBalance(accountId: string) {
    return this.stripe.balance.retrieve({
      stripeAccount: accountId,
    });
  }

  /**
   * Create transfer to connected account
   */
  async createTransfer(amount: number, accountId: string, metadata?: any) {
    return this.stripe.transfers.create({
      amount: Math.round(amount * 100),
      currency: 'eur',
      destination: accountId,
      metadata: {
        ...metadata,
        platform: 'ofm',
      },
    });
  }

  /**
   * Create refund for a payment intent
   */
  async createRefund(paymentIntentId: string, amount?: number, reason?: string) {
    const refundData: Stripe.RefundCreateParams = {
      payment_intent: paymentIntentId,
    };

    if (amount) {
      refundData.amount = amount; // Already in cents
    }

    if (reason) {
      refundData.metadata = {
        reason,
        platform: 'ofm',
      };
    }

    return this.stripe.refunds.create(refundData);
  }

  /**
   * Handle Stripe webhooks
   */
  async handleWebhook(signature: string, payload: Buffer) {
    const webhookSecret = this.configService.get('STRIPE_WEBHOOK_SECRET');

    try {
      const event = this.stripe.webhooks.constructEvent(
        payload,
        signature,
        webhookSecret!,
      );

      this.logger.log(`Received webhook: ${event.type}`);

      switch (event.type) {
        // Payment Intents
        case 'payment_intent.succeeded':
          await this.handlePaymentIntentSucceeded(event.data.object);
          break;
        case 'payment_intent.payment_failed':
          await this.handlePaymentIntentFailed(event.data.object);
          break;

        // Subscriptions
        case 'customer.subscription.created':
          await this.handleSubscriptionCreated(event.data.object);
          break;
        case 'customer.subscription.updated':
          await this.handleSubscriptionUpdated(event.data.object);
          break;
        case 'customer.subscription.deleted':
          await this.handleSubscriptionDeleted(event.data.object);
          break;
        case 'invoice.payment_succeeded':
          await this.handleInvoicePaymentSucceeded(event.data.object);
          break;
        case 'invoice.payment_failed':
          await this.handleInvoicePaymentFailed(event.data.object);
          break;

        // Connect Account
        case 'account.updated':
          await this.handleAccountUpdated(event.data.object);
          break;

        // Payouts
        case 'payout.paid':
          await this.handlePayoutPaid(event.data.object);
          break;
        case 'payout.failed':
          await this.handlePayoutFailed(event.data.object);
          break;

        default:
          this.logger.log(`Unhandled event type: ${event.type}`);
      }

      return { received: true };
    } catch (err: any) {
      this.logger.error(`Webhook error: ${err.message}`);
      throw err;
    }
  }

  /**
   * Webhook handlers
   */
  private async handlePaymentIntentSucceeded(paymentIntent: any) {
    this.logger.log(`Payment succeeded: ${paymentIntent.id}`);

    // Update transaction
    await this.prisma.transaction.updateMany({
      where: { stripePaymentIntentId: paymentIntent.id },
      data: {
        status: 'COMPLETED',
        processedAt: new Date(),
      },
    });
  }

  private async handlePaymentIntentFailed(paymentIntent: any) {
    this.logger.log(`Payment failed: ${paymentIntent.id}`);

    await this.prisma.transaction.updateMany({
      where: { stripePaymentIntentId: paymentIntent.id },
      data: {
        status: 'FAILED',
        failedAt: new Date(),
        failureReason: paymentIntent.last_payment_error?.message || 'Payment failed',
      },
    });
  }

  private async handleSubscriptionCreated(subscription: any) {
    this.logger.log(`Subscription created: ${subscription.id}`);

    // Find subscription in database and update
    await this.prisma.subscription.updateMany({
      where: { stripeSubscriptionId: subscription.id },
      data: {
        status: 'ACTIVE',
        currentPeriodStart: new Date(subscription.current_period_start * 1000),
        currentPeriodEnd: new Date(subscription.current_period_end * 1000),
      },
    });
  }

  private async handleSubscriptionUpdated(subscription: any) {
    this.logger.log(`Subscription updated: ${subscription.id}`);

    const status = this.mapStripeSubscriptionStatus(subscription.status);

    await this.prisma.subscription.updateMany({
      where: { stripeSubscriptionId: subscription.id },
      data: {
        status,
        currentPeriodStart: new Date(subscription.current_period_start * 1000),
        currentPeriodEnd: new Date(subscription.current_period_end * 1000),
        cancelledAt: subscription.canceled_at ? new Date(subscription.canceled_at * 1000) : null,
        cancelAtPeriodEnd: subscription.cancel_at_period_end,
      },
    });
  }

  private async handleSubscriptionDeleted(subscription: any) {
    this.logger.log(`Subscription deleted: ${subscription.id}`);

    await this.prisma.subscription.updateMany({
      where: { stripeSubscriptionId: subscription.id },
      data: {
        status: 'CANCELLED',
        cancelledAt: new Date(),
      },
    });
  }

  private async handleInvoicePaymentSucceeded(invoice: any) {
    this.logger.log(`Invoice payment succeeded: ${invoice.id}`);

    // Create transaction for successful payment
    if (invoice.subscription) {
      const subscription = await this.prisma.subscription.findUnique({
        where: { stripeSubscriptionId: invoice.subscription },
        include: { tier: true },
      });

      if (subscription) {
        const platformFee = (invoice.amount_paid / 100) * (this.platformFeePercentage / 100);
        const netAmount = invoice.amount_paid / 100 - platformFee;

        await this.prisma.transaction.create({
          data: {
            fromUserId: subscription.subscriberId,
            toUserId: subscription.tier.creatorId,
            type: 'SUBSCRIPTION',
            status: 'COMPLETED',
            amount: invoice.amount_paid / 100,
            currency: invoice.currency.toUpperCase(),
            platformFee,
            netAmount,
            stripeChargeId: invoice.charge,
            subscriptionId: subscription.id,
            processedAt: new Date(),
          },
        });
      }
    }
  }

  private async handleInvoicePaymentFailed(invoice: any) {
    this.logger.log(`Invoice payment failed: ${invoice.id}`);

    if (invoice.subscription) {
      await this.prisma.subscription.updateMany({
        where: { stripeSubscriptionId: invoice.subscription },
        data: { status: 'PAST_DUE' },
      });
    }
  }

  private async handleAccountUpdated(account: any) {
    this.logger.log(`Account updated: ${account.id}`);

    const isOnboarded =
      account.charges_enabled &&
      account.payouts_enabled &&
      account.details_submitted;

    await this.prisma.user.updateMany({
      where: { stripeAccountId: account.id },
      data: { stripeOnboarded: isOnboarded },
    });
  }

  private async handlePayoutPaid(payout: any) {
    this.logger.log(`Payout paid: ${payout.id}`);

    await this.prisma.payout.updateMany({
      where: { stripePayoutId: payout.id },
      data: {
        status: 'COMPLETED',
        paidAt: new Date(payout.arrival_date * 1000),
      },
    });
  }

  private async handlePayoutFailed(payout: any) {
    this.logger.log(`Payout failed: ${payout.id}`);

    await this.prisma.payout.updateMany({
      where: { stripePayoutId: payout.id },
      data: {
        status: 'FAILED',
        failedAt: new Date(),
        failureReason: payout.failure_message || 'Payout failed',
      },
    });
  }

  /**
   * Helper methods
   */
  private mapStripeSubscriptionStatus(stripeStatus: string): any {
    const statusMap: Record<string, string> = {
      active: 'ACTIVE',
      past_due: 'PAST_DUE',
      canceled: 'CANCELLED',
      unpaid: 'PAST_DUE',
      incomplete: 'PENDING',
      incomplete_expired: 'EXPIRED',
      trialing: 'ACTIVE',
    };

    return statusMap[stripeStatus] || 'ACTIVE';
  }
}
