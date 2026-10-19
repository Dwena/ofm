import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { PaymentsService } from './payments.service';
import { PaymentsController } from './payments.controller';
import { StripeService } from './stripe.service';
import { StripeWebhookController } from './stripe-webhook.controller';
import { StripeWebhookService } from './stripe-webhook.service';
import { BillingService } from './billing.service';
import { SubscriptionSyncService } from './subscription-sync.service';
import { OneTimePaymentService } from './one-time-payment.service';

@Module({
  imports: [ConfigModule],
  controllers: [PaymentsController, StripeWebhookController],
  providers: [
    PaymentsService,
    StripeService,
    StripeWebhookService,
    BillingService,
    SubscriptionSyncService,
    OneTimePaymentService,
  ],
  exports: [
    PaymentsService,
    StripeService,
    BillingService,
    SubscriptionSyncService,
    OneTimePaymentService,
  ],
})
export class PaymentsModule {}
