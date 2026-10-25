/**
 * Payment provider abstraction
 *
 * The platform is the merchant of record: fans pay the platform through a
 * card processor accepting adult content (CCBill...), creators are credited
 * on an internal balance (CreatorBalanceEntry) and paid by SEPA transfer.
 * Recurring billing is run by the platform (BillingService): renewals charge
 * the card saved at the provider. A provider therefore only needs to:
 *
 * - host the card form of a first payment (redirect + webhook), saving the card
 * - charge a saved card (one-click purchase, or renewal)
 * - refund a charge
 * - turn its webhooks into the normalized events below
 *
 * Amounts crossing this boundary are in euros (VAT included: what the fan pays).
 */

export const PAYMENT_PROVIDER = Symbol('PAYMENT_PROVIDER');

export interface CheckoutSessionParams {
  /** Our transaction id, sent back in the webhooks */
  reference: string;
  /** Euros, VAT included */
  amount: number;
  currency: 'EUR';
  description: string;
  customer: { id: string; email: string; country: string | null };
  /** Where the provider sends the fan back after paying / cancelling */
  returnUrl: string;
  cancelUrl: string;
}

export interface CheckoutSession {
  /** Provider id of the checkout (stored as Transaction.providerPaymentId) */
  id: string;
  redirectUrl: string;
}

export interface SavedCardChargeParams {
  reference: string;
  /** PaymentCard.providerToken */
  cardToken: string;
  amount: number;
  currency: 'EUR';
  description: string;
  /** customer: the fan is clicking "pay" now; merchant: renewal run by the platform */
  initiator: 'customer' | 'merchant';
  customer: { id: string; email: string; ip?: string | null };
}

export type SavedCardChargeResult =
  | { status: 'approved'; providerPaymentId: string; providerTransactionId: string; amount: number }
  /** Accepted, the outcome comes later through a webhook */
  | { status: 'pending'; providerPaymentId: string }
  /** The bank asks for authentication (3-D Secure): send the fan to this page */
  | { status: 'requires_action'; providerPaymentId: string; redirectUrl: string }
  | { status: 'declined'; reason: string; code?: string };

export interface RefundParams {
  /** Transaction.providerTransactionId of the charge */
  providerTransactionId: string;
  /** Euros, VAT included */
  amount: number;
  /** Whole charge refunded */
  full: boolean;
  reason?: string;
}

export interface CardDetails {
  /** Reusable reference to charge the card again */
  token: string;
  brand?: string | null;
  last4?: string | null;
  expMonth?: number | null;
  expYear?: number | null;
  /** Issuing / billing country, ISO 3166-1 alpha-2 */
  country?: string | null;
}

export type PaymentEvent =
  | {
      type: 'payment.succeeded';
      /** Our transaction id */
      reference: string;
      providerPaymentId?: string;
      providerTransactionId: string;
      /** Euros actually charged */
      amount: number;
      currency: string;
      card?: CardDetails;
    }
  | { type: 'payment.failed'; reference: string; reason: string }
  | {
      type: 'refund';
      /** Provider id of the refund itself (idempotency) */
      providerRefundId: string;
      providerTransactionId: string;
      amount: number;
    }
  | {
      type: 'chargeback';
      providerDisputeId: string;
      providerTransactionId: string;
      amount: number;
      currency: string;
      reason: string;
    }
  | { type: 'chargeback.reversed'; providerDisputeId: string; providerTransactionId: string };

export interface WebhookRequest {
  headers: Record<string, string | string[] | undefined>;
  query: Record<string, unknown>;
  body: unknown;
  rawBody?: Buffer;
  /** Client IP, behind the proxy (see main.ts trust proxy) */
  ip?: string;
}

export interface PaymentProvider {
  /** Stored on transactions and cards (ccbill, fake...) */
  readonly name: string;

  /** Credentials are set: payments can go through */
  isConfigured(): boolean;

  createCheckout(params: CheckoutSessionParams): Promise<CheckoutSession>;

  chargeSavedCard(params: SavedCardChargeParams): Promise<SavedCardChargeResult>;

  refund(params: RefundParams): Promise<{ providerRefundId: string }>;

  /** Authenticate the webhook (throws when it cannot be trusted) and normalize it */
  parseWebhook(request: WebhookRequest): Promise<PaymentEvent[]>;
}

/** Thrown by providers on a configuration or communication problem */
export class PaymentProviderError extends Error {
  constructor(
    message: string,
    readonly code?: string,
  ) {
    super(message);
    this.name = 'PaymentProviderError';
  }
}
