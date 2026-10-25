import { createHash, randomBytes, timingSafeEqual } from 'crypto';
import { Logger } from '@nestjs/common';
import {
  CardDetails,
  CheckoutSession,
  CheckoutSessionParams,
  PaymentEvent,
  PaymentProvider,
  PaymentProviderError,
  RefundParams,
  SavedCardChargeParams,
  SavedCardChargeResult,
  WebhookRequest,
} from './payment-provider';

/**
 * CCBill (https://ccbill.com), card processor accepting adult content.
 *
 * Integration used:
 * - first payment: FlexForms hosted payment form (single billing, dynamic
 *   price signed with the salt: formDigest), our transaction id passed through
 *   as `reference` and sent back in the webhooks
 * - saved card: the CCBill subscription id of the first sale, charged again
 *   with "Charge By Previous Transaction ID" (one-click), which also runs the
 *   renewals billed by the platform
 * - refunds: DataLink subscription management API (refundTransaction)
 * - webhooks: NewSaleSuccess, NewSaleFailure, Refund, Void, Chargeback
 *
 * TO VALIDATE WITH CCBILL BEFORE GOING LIVE (sandbox account): the exact
 * parameter and field names below come from CCBill's public documentation and
 * must be checked against the documentation of the account CCBill opens for
 * the platform: pass-through field name of `reference` in the webhooks
 * (X-reference / reference), approval / denial URLs configured in the FlexForm,
 * dynamic pricing and one-click enabled on the sub-account by CCBill support,
 * merchant-initiated renewals through one-click (CCBill may require its own
 * recurring billing instead), the response format of the billing API, and the
 * current webhook IP ranges.
 */

export interface CcbillConfig {
  /** clientAccnum */
  accountNumber: string;
  /** clientSubacc */
  subAccount: string;
  flexFormId: string;
  /** Salt of the sub-account, signs dynamic prices (formDigest) */
  salt: string;
  /** DataLink user (billing API and DataLink) */
  datalinkUsername: string;
  datalinkPassword: string;
  /** Secret added to the webhook URL configured at CCBill (?token=...) */
  webhookToken: string;
  /** Webhook source IP ranges (CIDR); empty disables the check */
  allowedIps: string[];
  /** ISO 4217 numeric currency code (978 = EUR) */
  currencyCode: string;
  /** Period (days) CCBill attaches to a single billing; access is managed by the platform */
  initialPeriodDays: number;
  flexFormBaseUrl: string;
  billingApiUrl: string;
  datalinkUrl: string;
}

/** CCBill webhook source ranges (to check against the current CCBill documentation) */
export const CCBILL_DEFAULT_WEBHOOK_IPS = ['64.38.212.0/24', '64.38.215.0/24', '64.38.240.0/24', '64.38.241.0/24'];

const CURRENCY_BY_NUMERIC: Record<string, string> = { '978': 'EUR', '840': 'USD', '826': 'GBP' };

type Fields = Record<string, string>;

export class CcbillPaymentProvider implements PaymentProvider {
  readonly name = 'ccbill';
  private readonly logger = new Logger(CcbillPaymentProvider.name);

  constructor(
    private readonly config: CcbillConfig,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  isConfigured(): boolean {
    const c = this.config;
    return !!(c.accountNumber && c.subAccount && c.flexFormId && c.salt && c.datalinkUsername && c.datalinkPassword && c.webhookToken);
  }

  async createCheckout(params: CheckoutSessionParams): Promise<CheckoutSession> {
    this.assertConfigured();
    const initialPrice = params.amount.toFixed(2);
    const initialPeriod = String(this.config.initialPeriodDays);
    const currencyCode = this.config.currencyCode;

    const query = new URLSearchParams({
      clientSubacc: this.config.subAccount,
      initialPrice,
      initialPeriod,
      currencyCode,
      formDigest: md5(initialPrice + initialPeriod + currencyCode + this.config.salt),
      email: params.customer.email,
      ...(params.customer.country && { country: params.customer.country }),
      // Pass-through values, sent back in the webhooks
      reference: params.reference,
      customerId: params.customer.id,
    });

    return {
      id: `ccbill_ff_${params.reference}`,
      redirectUrl: `${this.config.flexFormBaseUrl}/${encodeURIComponent(this.config.flexFormId)}?${query.toString()}`,
    };
  }

  async chargeSavedCard(params: SavedCardChargeParams): Promise<SavedCardChargeResult> {
    this.assertConfigured();
    const query = new URLSearchParams({
      clientAccnum: this.config.accountNumber,
      username: this.config.datalinkUsername,
      password: this.config.datalinkPassword,
      action: 'chargeByPreviousTransactionId',
      newClientAccnum: this.config.accountNumber,
      newClientSubacc: this.config.subAccount,
      sharedAuthentication: '1',
      initialPrice: params.amount.toFixed(2),
      initialPeriod: String(this.config.initialPeriodDays),
      rebills: '0',
      currencyCode: this.config.currencyCode,
      subscriptionId: params.cardToken,
    });

    const response = await this.request(`${this.config.billingApiUrl}?${query.toString()}`);
    const fields = parseCsvResponse(response);
    const approved = (fields.approved ?? fields.results ?? '').trim() === '1';
    const subscriptionId = fields.subscriptionId?.trim();

    if (approved && subscriptionId) {
      return { status: 'approved', providerPaymentId: subscriptionId, providerTransactionId: subscriptionId, amount: params.amount };
    }

    const code = fields.declineCode || fields.denialId || fields.results;
    const reason = fields.declineText || fields.errorMessage || 'Paiement refusé';
    this.logger.warn(`CCBill one-click charge declined for ${params.reference}: ${code ?? ''} ${reason}`);
    return { status: 'declined', reason, code };
  }

  async refund(params: RefundParams): Promise<{ providerRefundId: string }> {
    this.assertConfigured();
    const query = new URLSearchParams({
      clientAccnum: this.config.accountNumber,
      clientSubacc: this.config.subAccount,
      username: this.config.datalinkUsername,
      password: this.config.datalinkPassword,
      action: 'refundTransaction',
      subscriptionId: params.providerTransactionId,
      ...(!params.full && { amount: params.amount.toFixed(2) }),
    });

    const response = await this.request(`${this.config.datalinkUrl}?${query.toString()}`);
    const fields = parseCsvResponse(response);
    const result = (fields.results ?? response.trim().split(/\s+/).pop() ?? '').replace(/"/g, '');

    if (result !== '1') {
      throw new PaymentProviderError(`CCBill refund refused (code ${result || 'unknown'})`, result);
    }

    // Unique per refund: it is stored as the (unique) providerPaymentId of the
    // REFUND transaction, and a charge can be refunded in several parts
    return { providerRefundId: `ccbill_refund_${params.providerTransactionId}_${randomBytes(6).toString('hex')}` };
  }

  async parseWebhook(request: WebhookRequest): Promise<PaymentEvent[]> {
    this.assertConfigured();
    this.authenticate(request);

    const eventType = String(request.query.eventType ?? '');
    const fields = toFields(request.body);
    const subscriptionId = fields.subscriptionId;
    const reference = fields['X-reference'] ?? fields.reference ?? fields['X-Reference'] ?? '';

    switch (eventType) {
      case 'NewSaleSuccess':
      case 'UpSaleSuccess':
      case 'CrossSaleSuccess': {
        if (!subscriptionId) return [];
        return [
          {
            type: 'payment.succeeded',
            reference,
            providerTransactionId: subscriptionId,
            amount: toAmount(fields.billedInitialPrice ?? fields.accountingInitialPrice ?? fields.initialPrice),
            currency: CURRENCY_BY_NUMERIC[fields.billedCurrencyCode] ?? fields.billedCurrency ?? 'EUR',
            card: this.cardFromFields(subscriptionId, fields),
          },
        ];
      }
      case 'NewSaleFailure':
        return reference
          ? [{ type: 'payment.failed', reference, reason: fields.failureReason || fields.failureCode || 'Paiement refusé' }]
          : [];
      case 'Refund':
      case 'Void':
        if (!subscriptionId) return [];
        return [
          {
            type: 'refund',
            providerRefundId: fields.transactionId || `${eventType}_${subscriptionId}_${fields.timestamp ?? ''}`,
            providerTransactionId: subscriptionId,
            amount: toAmount(fields.amount ?? fields.accountingAmount),
          },
        ];
      case 'Chargeback':
        if (!subscriptionId) return [];
        return [
          {
            type: 'chargeback',
            providerDisputeId: fields.transactionId || `chargeback_${subscriptionId}`,
            providerTransactionId: subscriptionId,
            amount: toAmount(fields.amount ?? fields.accountingAmount),
            currency: CURRENCY_BY_NUMERIC[fields.currencyCode] ?? 'EUR',
            reason: fields.reason || 'Chargeback',
          },
        ];
      default:
        // Recurring events (renewals, cancellations...) are not used: billing is run by the platform
        this.logger.log(`CCBill webhook ${eventType || '(no eventType)'} ignored`);
        return [];
    }
  }

  private cardFromFields(subscriptionId: string, fields: Fields): CardDetails {
    const exp = fields.expDate?.replace(/\D/g, '');
    return {
      token: subscriptionId,
      brand: fields.cardType || null,
      last4: fields.last4 || null,
      expMonth: exp && exp.length === 4 ? Number(exp.slice(0, 2)) : null,
      expYear: exp && exp.length === 4 ? 2000 + Number(exp.slice(2)) : null,
      country: fields.country || null,
    };
  }

  private authenticate(request: WebhookRequest) {
    const token = String(request.query.token ?? '');
    const expected = this.config.webhookToken;
    if (!token || token.length !== expected.length || !timingSafeEqual(Buffer.from(token), Buffer.from(expected))) {
      throw new PaymentProviderError('Invalid webhook token');
    }

    if (this.config.allowedIps.length > 0) {
      const ip = (request.ip ?? '').replace(/^::ffff:/, '');
      if (!this.config.allowedIps.some((range) => ipInCidr(ip, range))) {
        throw new PaymentProviderError(`Webhook from unexpected IP ${ip || 'unknown'}`);
      }
    }
  }

  private async request(url: string): Promise<string> {
    let response: Response;
    try {
      response = await this.fetchImpl(url, { method: 'GET', signal: AbortSignal.timeout(20000) });
    } catch (error) {
      throw new PaymentProviderError(`CCBill unreachable: ${(error as Error).message}`);
    }
    const text = await response.text();
    if (!response.ok) {
      throw new PaymentProviderError(`CCBill HTTP ${response.status}`);
    }
    return text;
  }

  private assertConfigured() {
    if (!this.isConfigured()) {
      throw new PaymentProviderError('CCBill is not configured');
    }
  }
}

function md5(value: string) {
  return createHash('md5').update(value).digest('hex');
}

function toAmount(value: string | undefined) {
  const amount = Number(value);
  return Number.isFinite(amount) ? Math.round(amount * 100) / 100 : 0;
}

/** Webhook body (JSON object or url-encoded form) as string fields */
function toFields(body: unknown): Fields {
  if (typeof body === 'string') {
    return Object.fromEntries(new URLSearchParams(body));
  }
  if (body && typeof body === 'object') {
    return Object.fromEntries(
      Object.entries(body as Record<string, unknown>)
        .filter(([, value]) => value !== null && value !== undefined)
        .map(([key, value]) => [key, String(value)]),
    );
  }
  return {};
}

/**
 * CCBill APIs answer with a CSV header line and a values line, e.g.
 *   "approved","subscriptionId","denialId","declineCode","declineText"
 *   "1","0123456789","","",""
 */
export function parseCsvResponse(text: string): Fields {
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  if (lines.length < 2) return {};
  const split = (line: string) => line.split(',').map((cell) => cell.trim().replace(/^"|"$/g, ''));
  const header = split(lines[0]);
  const values = split(lines[1]);
  return Object.fromEntries(header.map((key, index) => [key, values[index] ?? '']));
}

/** IPv4 address in a CIDR range */
export function ipInCidr(ip: string, cidr: string): boolean {
  const [range, bitsText] = cidr.split('/');
  const bits = bitsText === undefined ? 32 : Number(bitsText);
  const toInt = (address: string) => {
    const parts = address.split('.').map(Number);
    if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return null;
    return ((parts[0] << 24) | (parts[1] << 16) | (parts[2] << 8) | parts[3]) >>> 0;
  };
  const ipInt = toInt(ip);
  const rangeInt = toInt(range);
  if (ipInt === null || rangeInt === null || !(bits >= 0 && bits <= 32)) return false;
  const mask = bits === 0 ? 0 : (~0 << (32 - bits)) >>> 0;
  return (ipInt & mask) === (rangeInt & mask);
}
