import { Provider } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PAYMENT_PROVIDER, PaymentProvider } from './payment-provider';
import { FakePaymentProvider } from './fake.provider';
import { CCBILL_DEFAULT_WEBHOOK_IPS, CcbillPaymentProvider } from './ccbill.provider';

/**
 * Payment provider selected by PAYMENT_PROVIDER: `ccbill`, or `fake` (the
 * local simulator, the default outside production)
 */
export function createPaymentProvider(config: ConfigService): PaymentProvider {
  const production = config.get('NODE_ENV') === 'production';
  const name = (config.get<string>('PAYMENT_PROVIDER') || (production ? 'ccbill' : 'fake')).toLowerCase();
  const webUrl = config.get<string>('WEB_URL', 'http://localhost:3000');

  switch (name) {
    case 'ccbill': {
      const ips = config.get<string>('CCBILL_WEBHOOK_ALLOWED_IPS');
      return new CcbillPaymentProvider({
        accountNumber: config.get('CCBILL_ACCOUNT_NUMBER', ''),
        subAccount: config.get('CCBILL_SUBACCOUNT', ''),
        flexFormId: config.get('CCBILL_FLEXFORM_ID', ''),
        salt: config.get('CCBILL_SALT', ''),
        datalinkUsername: config.get('CCBILL_DATALINK_USERNAME', ''),
        datalinkPassword: config.get('CCBILL_DATALINK_PASSWORD', ''),
        webhookToken: config.get('CCBILL_WEBHOOK_TOKEN', ''),
        allowedIps:
          ips === undefined
            ? CCBILL_DEFAULT_WEBHOOK_IPS
            : ips
                .split(',')
                .map((range) => range.trim())
                .filter(Boolean),
        currencyCode: config.get('CCBILL_CURRENCY_CODE', '978'),
        initialPeriodDays: Number(config.get('CCBILL_INITIAL_PERIOD_DAYS', 30)),
        flexFormBaseUrl: config.get('CCBILL_FLEXFORM_URL', 'https://api.ccbill.com/wap-frontflex/flexforms'),
        billingApiUrl: config.get('CCBILL_BILLING_API_URL', 'https://bill.ccbill.com/jpost/billingApi.cgi'),
        datalinkUrl: config.get('CCBILL_DATALINK_URL', 'https://datalink.ccbill.com/utils/subscriptionManagement.cgi'),
      });
    }
    case 'fake':
      return new FakePaymentProvider(webUrl, production);
    default:
      throw new Error(`Unknown PAYMENT_PROVIDER "${name}" (expected ccbill or fake)`);
  }
}

export const paymentProviderFactory: Provider = {
  provide: PAYMENT_PROVIDER,
  inject: [ConfigService],
  useFactory: createPaymentProvider,
};
