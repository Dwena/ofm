import { createHash } from 'crypto';
import { CcbillConfig, CcbillPaymentProvider, ipInCidr, parseCsvResponse } from './ccbill.provider';
import { PaymentProviderError } from './payment-provider';

const md5 = (value: string) => createHash('md5').update(value).digest('hex');

describe('CcbillPaymentProvider', () => {
  const config: CcbillConfig = {
    accountNumber: '900000',
    subAccount: '0001',
    flexFormId: 'ff-123',
    salt: 'salty',
    datalinkUsername: 'dl-user',
    datalinkPassword: 'dl-pass',
    webhookToken: 'secret-token',
    allowedIps: ['64.38.212.0/24'],
    currencyCode: '978',
    initialPeriodDays: 30,
    flexFormBaseUrl: 'https://api.ccbill.com/wap-frontflex/flexforms',
    billingApiUrl: 'https://bill.ccbill.com/jpost/billingApi.cgi',
    datalinkUrl: 'https://datalink.ccbill.com/utils/subscriptionManagement.cgi',
  };

  const response = (text: string, status = 200) =>
    ({ ok: status >= 200 && status < 300, status, text: async () => text }) as unknown as Response;

  let fetchMock: jest.Mock;
  let provider: CcbillPaymentProvider;

  beforeEach(() => {
    fetchMock = jest.fn();
    provider = new CcbillPaymentProvider(config, fetchMock as unknown as typeof fetch);
  });

  it('is configured only with every credential', () => {
    expect(provider.isConfigured()).toBe(true);
    expect(new CcbillPaymentProvider({ ...config, webhookToken: '' }).isConfigured()).toBe(false);
    expect(new CcbillPaymentProvider({ ...config, salt: '' }).isConfigured()).toBe(false);
  });

  describe('createCheckout', () => {
    it('builds the FlexForms URL with the dynamic price signed by the salt', async () => {
      const session = await provider.createCheckout({
        reference: 'tx-1',
        amount: 12,
        currency: 'EUR',
        description: 'Abonnement',
        customer: { id: 'fan-1', email: 'fan@example.com', country: 'FR' },
        returnUrl: 'https://web/checkout/retour',
        cancelUrl: 'https://web/checkout/retour?annule=1',
      });

      expect(session.id).toBe('ccbill_ff_tx-1');
      const url = new URL(session.redirectUrl);
      expect(`${url.origin}${url.pathname}`).toBe('https://api.ccbill.com/wap-frontflex/flexforms/ff-123');
      expect(Object.fromEntries(url.searchParams)).toEqual({
        clientSubacc: '0001',
        initialPrice: '12.00',
        initialPeriod: '30',
        currencyCode: '978',
        formDigest: md5('12.00' + '30' + '978' + 'salty'),
        email: 'fan@example.com',
        country: 'FR',
        reference: 'tx-1',
        customerId: 'fan-1',
      });
    });

    it('refuses when CCBill is not configured', async () => {
      const unconfigured = new CcbillPaymentProvider({ ...config, accountNumber: '' }, fetchMock as any);
      await expect(
        unconfigured.createCheckout({
          reference: 'tx-1',
          amount: 1,
          currency: 'EUR',
          description: '',
          customer: { id: 'fan-1', email: 'a@b.c', country: null },
          returnUrl: '',
          cancelUrl: '',
        }),
      ).rejects.toThrow(PaymentProviderError);
    });
  });

  describe('parseWebhook', () => {
    const webhook = (eventType: string, body: unknown, overrides: Record<string, unknown> = {}) => ({
      headers: {},
      query: { eventType, token: 'secret-token' },
      body,
      ip: '64.38.212.10',
      ...overrides,
    });

    it('rejects a missing or wrong token', async () => {
      await expect(provider.parseWebhook(webhook('NewSaleSuccess', {}, { query: { eventType: 'NewSaleSuccess' } }))).rejects.toThrow(
        'Invalid webhook token',
      );
      await expect(
        provider.parseWebhook(webhook('NewSaleSuccess', {}, { query: { eventType: 'NewSaleSuccess', token: 'secret-tokeX' } })),
      ).rejects.toThrow('Invalid webhook token');
    });

    it('rejects an IP outside the allowed ranges, accepts IPv4-mapped addresses', async () => {
      await expect(provider.parseWebhook(webhook('Unknown', {}, { ip: '1.2.3.4' }))).rejects.toThrow(/unexpected IP/);
      await expect(provider.parseWebhook(webhook('Unknown', {}, { ip: '::ffff:64.38.212.200' }))).resolves.toEqual([]);
    });

    it('skips the IP check when no range is configured', async () => {
      const open = new CcbillPaymentProvider({ ...config, allowedIps: [] }, fetchMock as any);
      await expect(open.parseWebhook(webhook('Unknown', {}, { ip: '1.2.3.4' }))).resolves.toEqual([]);
    });

    it('maps NewSaleSuccess to payment.succeeded with the saved card', async () => {
      const events = await provider.parseWebhook(
        webhook('NewSaleSuccess', {
          subscriptionId: '0123456789',
          'X-reference': 'tx-1',
          billedInitialPrice: '12.00',
          billedCurrencyCode: '978',
          cardType: 'VISA',
          last4: '4242',
          expDate: '0428',
          country: 'FR',
        }),
      );

      expect(events).toEqual([
        {
          type: 'payment.succeeded',
          reference: 'tx-1',
          providerTransactionId: '0123456789',
          amount: 12,
          currency: 'EUR',
          card: { token: '0123456789', brand: 'VISA', last4: '4242', expMonth: 4, expYear: 2028, country: 'FR' },
        },
      ]);
    });

    it('reads url-encoded bodies', async () => {
      const events = await provider.parseWebhook(
        webhook('NewSaleSuccess', 'subscriptionId=42&reference=tx-2&accountingInitialPrice=5.5'),
      );
      expect(events[0]).toEqual(expect.objectContaining({ reference: 'tx-2', providerTransactionId: '42', amount: 5.5 }));
    });

    it('maps NewSaleFailure to payment.failed', async () => {
      await expect(
        provider.parseWebhook(webhook('NewSaleFailure', { reference: 'tx-1', failureReason: 'Insufficient funds' })),
      ).resolves.toEqual([{ type: 'payment.failed', reference: 'tx-1', reason: 'Insufficient funds' }]);
      await expect(provider.parseWebhook(webhook('NewSaleFailure', { failureReason: 'x' }))).resolves.toEqual([]);
    });

    it('maps Refund (and Void) to refund', async () => {
      await expect(
        provider.parseWebhook(webhook('Refund', { subscriptionId: '42', transactionId: 'r-1', amount: '6.00' })),
      ).resolves.toEqual([{ type: 'refund', providerRefundId: 'r-1', providerTransactionId: '42', amount: 6 }]);

      const [voided] = await provider.parseWebhook(webhook('Void', { subscriptionId: '42', accountingAmount: '12', timestamp: 't' }));
      expect(voided).toEqual({ type: 'refund', providerRefundId: 'Void_42_t', providerTransactionId: '42', amount: 12 });
    });

    it('maps Chargeback to chargeback', async () => {
      await expect(
        provider.parseWebhook(
          webhook('Chargeback', { subscriptionId: '42', transactionId: 'cb-1', amount: '12.00', currencyCode: '978', reason: 'Fraud' }),
        ),
      ).resolves.toEqual([
        { type: 'chargeback', providerDisputeId: 'cb-1', providerTransactionId: '42', amount: 12, currency: 'EUR', reason: 'Fraud' },
      ]);
    });

    it('ignores unknown and recurring events', async () => {
      await expect(provider.parseWebhook(webhook('RenewalSuccess', { subscriptionId: '42' }))).resolves.toEqual([]);
      await expect(provider.parseWebhook(webhook('', {}))).resolves.toEqual([]);
    });
  });

  describe('chargeSavedCard (one-click)', () => {
    const params = {
      reference: 'tx-1',
      cardToken: '0123456789',
      amount: 12,
      currency: 'EUR' as const,
      description: 'Renouvellement',
      initiator: 'merchant' as const,
      customer: { id: 'fan-1', email: 'fan@example.com' },
    };

    it('returns approved with the new subscription id', async () => {
      fetchMock.mockResolvedValue(
        response('"approved","subscriptionId","denialId","declineCode","declineText"\n"1","0999","","",""\n'),
      );

      await expect(provider.chargeSavedCard(params)).resolves.toEqual({
        status: 'approved',
        providerPaymentId: '0999',
        providerTransactionId: '0999',
        amount: 12,
      });

      const url = new URL(fetchMock.mock.calls[0][0]);
      expect(`${url.origin}${url.pathname}`).toBe(config.billingApiUrl);
      expect(url.searchParams.get('action')).toBe('chargeByPreviousTransactionId');
      expect(url.searchParams.get('subscriptionId')).toBe('0123456789');
      expect(url.searchParams.get('initialPrice')).toBe('12.00');
      expect(url.searchParams.get('clientAccnum')).toBe('900000');
      expect(url.searchParams.get('newClientSubacc')).toBe('0001');
    });

    it('returns declined with the code and reason', async () => {
      fetchMock.mockResolvedValue(
        response('"approved","subscriptionId","denialId","declineCode","declineText"\n"0","","123","24","Insufficient funds"'),
      );

      await expect(provider.chargeSavedCard(params)).resolves.toEqual({
        status: 'declined',
        reason: 'Insufficient funds',
        code: '24',
      });
    });

    it('throws a provider error on HTTP or network failure', async () => {
      fetchMock.mockResolvedValueOnce(response('error', 500));
      await expect(provider.chargeSavedCard(params)).rejects.toThrow('CCBill HTTP 500');

      fetchMock.mockRejectedValueOnce(new Error('ECONNRESET'));
      await expect(provider.chargeSavedCard(params)).rejects.toThrow(PaymentProviderError);
    });
  });

  describe('refund (DataLink)', () => {
    it('refunds the whole charge without an amount', async () => {
      fetchMock.mockResolvedValue(response('"results"\n"1"'));

      await expect(
        provider.refund({ providerTransactionId: '0123456789', amount: 12, full: true }),
      ).resolves.toEqual({ providerRefundId: expect.stringMatching(/^ccbill_refund_0123456789_[0-9a-f]+$/) });

      const url = new URL(fetchMock.mock.calls[0][0]);
      expect(`${url.origin}${url.pathname}`).toBe(config.datalinkUrl);
      expect(url.searchParams.get('action')).toBe('refundTransaction');
      expect(url.searchParams.get('subscriptionId')).toBe('0123456789');
      expect(url.searchParams.has('amount')).toBe(false);
    });

    it('sends the amount of a partial refund', async () => {
      fetchMock.mockResolvedValue(response('"results"\n"1"'));

      const first = await provider.refund({ providerTransactionId: '42', amount: 4.5, full: false });
      const second = await provider.refund({ providerTransactionId: '42', amount: 2, full: false });

      expect(new URL(fetchMock.mock.calls[0][0]).searchParams.get('amount')).toBe('4.50');
      // Stored as a unique id: two partial refunds of one charge must not collide
      expect(first.providerRefundId).not.toBe(second.providerRefundId);
    });

    it('throws when CCBill refuses the refund', async () => {
      fetchMock.mockResolvedValue(response('"results"\n"-3"'));

      const error = await provider.refund({ providerTransactionId: '42', amount: 12, full: true }).catch((e) => e);
      expect(error).toBeInstanceOf(PaymentProviderError);
      expect(error.code).toBe('-3');
    });
  });
});

describe('ccbill helpers', () => {
  it('parses a CSV header + values response', () => {
    expect(parseCsvResponse('"a","b","c"\r\n"1","x",""\r\n')).toEqual({ a: '1', b: 'x', c: '' });
    expect(parseCsvResponse('"a","b"\n"1"')).toEqual({ a: '1', b: '' });
    expect(parseCsvResponse('single line')).toEqual({});
  });

  it('matches IPv4 addresses against CIDR ranges', () => {
    expect(ipInCidr('64.38.212.1', '64.38.212.0/24')).toBe(true);
    expect(ipInCidr('64.38.213.1', '64.38.212.0/24')).toBe(false);
    expect(ipInCidr('10.0.0.1', '10.0.0.1')).toBe(true);
    expect(ipInCidr('200.1.2.3', '0.0.0.0/0')).toBe(true);
    expect(ipInCidr('255.255.255.255', '255.255.255.0/24')).toBe(true);
    expect(ipInCidr('not-an-ip', '64.38.212.0/24')).toBe(false);
    expect(ipInCidr('64.38.212.1', '64.38.212.0/33')).toBe(false);
    expect(ipInCidr('2001:db8::1', '64.38.212.0/24')).toBe(false);
  });
});
