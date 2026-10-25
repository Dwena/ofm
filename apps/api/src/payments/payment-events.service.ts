import { Injectable, Logger } from '@nestjs/common';
import { PaymentFlowService } from './payment-flow.service';
import { RefundsService } from './refunds.service';
import { PaymentEvent } from './providers/payment-provider';

/**
 * Applies the normalized events of the payment provider (webhooks, or the
 * payment simulator in development)
 */
@Injectable()
export class PaymentEventsService {
  private readonly logger = new Logger(PaymentEventsService.name);

  constructor(
    private paymentFlow: PaymentFlowService,
    private refunds: RefundsService,
  ) {}

  async dispatch(event: PaymentEvent) {
    this.logger.log(`Payment event ${event.type}`);
    switch (event.type) {
      case 'payment.succeeded':
        return this.paymentFlow.handlePaymentSucceeded(event);
      case 'payment.failed':
        return this.paymentFlow.handlePaymentFailed(event);
      case 'refund':
        return this.refunds.handleProviderRefund(event);
      case 'chargeback':
        return this.refunds.handleChargeback(event);
      case 'chargeback.reversed':
        return this.refunds.handleChargebackReversed(event);
    }
  }
}
