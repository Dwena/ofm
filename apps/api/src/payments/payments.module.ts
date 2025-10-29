import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { PaymentsService } from './payments.service';
import { PaymentsController } from './payments.controller';
import { StripeService } from './stripe.service';
import { StripeWebhookController } from './stripe-webhook.controller';
import { StripeWebhookService } from './stripe-webhook.service';
import { BillingService } from './billing.service';

@Module({
  imports: [ConfigModule],
  controllers: [PaymentsController, StripeWebhookController],
  providers: [
    PaymentsService,
    StripeService,
    StripeWebhookService,
    BillingService,
  ],
  exports: [PaymentsService, StripeService, BillingService],
})
export class PaymentsModule {}
