import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { TaxModule } from '../tax/tax.module';
import { PaymentsService } from './payments.service';
import { PaymentsController } from './payments.controller';
import { PaymentWebhookController } from './payment-webhook.controller';
import { PaymentSimulatorController } from './payment-simulator.controller';
import { AdminPayoutsController } from './admin-payouts.controller';
import { PaymentFlowService } from './payment-flow.service';
import { PaymentEventsService } from './payment-events.service';
import { CreatorBalanceService } from './creator-balance.service';
import { RefundsService } from './refunds.service';
import { PayoutsService } from './payouts.service';
import { BillingService } from './billing.service';
import { SubscriptionSyncService } from './subscription-sync.service';
import { CheckoutInfoService } from './checkout-info.service';
import { paymentProviderFactory } from './providers/payment-provider.factory';
import { PAYMENT_PROVIDER } from './providers/payment-provider';

@Module({
  imports: [ConfigModule, TaxModule],
  controllers: [PaymentsController, PaymentWebhookController, PaymentSimulatorController, AdminPayoutsController],
  providers: [
    paymentProviderFactory,
    PaymentsService,
    PaymentFlowService,
    PaymentEventsService,
    CreatorBalanceService,
    RefundsService,
    PayoutsService,
    BillingService,
    SubscriptionSyncService,
    CheckoutInfoService,
  ],
  exports: [
    PAYMENT_PROVIDER,
    PaymentsService,
    PaymentFlowService,
    CreatorBalanceService,
    BillingService,
    SubscriptionSyncService,
  ],
})
export class PaymentsModule {}
