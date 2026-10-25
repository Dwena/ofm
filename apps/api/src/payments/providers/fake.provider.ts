import { randomBytes } from 'crypto';
import {
  CheckoutSession,
  CheckoutSessionParams,
  PaymentEvent,
  PaymentProvider,
  PaymentProviderError,
  RefundParams,
  SavedCardChargeParams,
  SavedCardChargeResult,
} from './payment-provider';

/** Prefix of the fake checkout ids: fake_cs_<transaction id> */
export const FAKE_CHECKOUT_PREFIX = 'fake_cs_';

/** Test cards of the simulator (last 4 digits) */
export const FAKE_DECLINED_LAST4 = '0002';
export const FAKE_AUTHENTICATION_LAST4 = '3220';

const randomId = (prefix: string) => `${prefix}${randomBytes(8).toString('hex')}`;

/**
 * Payment simulator for local development and tests: no money moves.
 *
 * The hosted checkout is a page of the web app (/checkout/simulateur) that
 * approves or declines the payment through FakePaymentsController, which
 * feeds the same events a real provider's webhook would. Saved cards are
 * approved, except the test cards ending in 0002 (declined) and 3220
 * (authentication required). Refused in production.
 */
export class FakePaymentProvider implements PaymentProvider {
  readonly name = 'fake';

  constructor(
    private readonly webUrl: string,
    private readonly production: boolean,
  ) {}

  isConfigured(): boolean {
    return !this.production;
  }

  async createCheckout(params: CheckoutSessionParams): Promise<CheckoutSession> {
    this.assertAllowed();
    const id = `${FAKE_CHECKOUT_PREFIX}${params.reference}`;
    const query = new URLSearchParams({ session: id, return: params.returnUrl, cancel: params.cancelUrl });
    return { id, redirectUrl: `${this.webUrl}/checkout/simulateur?${query.toString()}` };
  }

  async chargeSavedCard(params: SavedCardChargeParams): Promise<SavedCardChargeResult> {
    this.assertAllowed();
    const last4 = params.cardToken.slice(-4);

    if (last4 === FAKE_DECLINED_LAST4) {
      return { status: 'declined', reason: 'Carte refusée par la banque (simulation)', code: 'card_declined' };
    }

    if (last4 === FAKE_AUTHENTICATION_LAST4 && params.initiator === 'customer') {
      const id = `${FAKE_CHECKOUT_PREFIX}${params.reference}`;
      const query = new URLSearchParams({ session: id, authentication: '1' });
      return {
        status: 'requires_action',
        providerPaymentId: id,
        redirectUrl: `${this.webUrl}/checkout/simulateur?${query.toString()}`,
      };
    }

    const providerPaymentId = randomId('fake_ch_');
    return { status: 'approved', providerPaymentId, providerTransactionId: providerPaymentId, amount: params.amount };
  }

  async refund(_params: RefundParams): Promise<{ providerRefundId: string }> {
    this.assertAllowed();
    return { providerRefundId: randomId('fake_re_') };
  }

  async parseWebhook(): Promise<PaymentEvent[]> {
    // The simulator calls FakePaymentsController directly
    throw new PaymentProviderError('The payment simulator has no webhook');
  }

  /** Card saved by the simulator's checkout page */
  static cardToken(last4: string) {
    return `fake_card_${randomBytes(6).toString('hex')}_${last4}`;
  }

  /** Charge id of a checkout approved by the simulator */
  static transactionId() {
    return randomId('fake_ch_');
  }

  private assertAllowed() {
    if (this.production) {
      throw new PaymentProviderError('The payment simulator cannot be used in production');
    }
  }
}
