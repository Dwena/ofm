# Payment features

Stripe has been removed. Payments go through a provider abstraction (CCBill in production, a local simulator with `PAYMENT_PROVIDER=fake` in development). Prices are set excluding VAT, VAT is added on top, creators are credited on an internal balance ledger (7-day hold) and paid by weekly SEPA transfers exported by admins.

Full reference (model, VAT, subscriptions, refunds, simulator, CCBill go-live checklist): [docs/PAIEMENTS.md](../../docs/PAIEMENTS.md).

## Module layout (`src/payments`)

- `providers/payment-provider.ts`: the single provider interface.
- `providers/ccbill.provider.ts`: CCBill implementation (hosted FlexForm, one-click charges, webhooks, DataLink).
- `providers/fake.provider.ts`: local simulator (refuses to run in production).
- `providers/payment-provider.factory.ts`: picks the provider from `PAYMENT_PROVIDER`.
- `payment-flow.service.ts`: payment lifecycle (pending transaction, charge or redirect, confirmation, saved cards).
- `creator-balance.service.ts`: creator balance ledger (credits, holds, debits).
- `refunds.service.ts`: refunds and chargebacks, with the matching balance debits.
- `payouts.service.ts`: weekly payouts, KYC and tax profile checks, paid/rejected handling.
- `sepa.ts`: SEPA pain.001 file generation.
- `billing.service.ts`: subscription renewals, retries and plan changes.
- `checkout-info.service.ts`: price breakdown including VAT shown before payment.
- `payment-webhook.controller.ts`: `POST /api/v1/webhooks/payments/:provider?token=...`.
- `payment-simulator.controller.ts`: simulator endpoints (`/payments/simulator/*`).
- `admin-payouts.controller.ts`: admin endpoints behind `/admin/payouts`.

## Configuration

See `.env.example` / `.env.production.example`: `PAYMENT_PROVIDER`, `PLATFORM_FEE_PERCENTAGE`, `EARNINGS_HOLD_DAYS`, `MINIMUM_PAYOUT_AMOUNT`, `CCBILL_*`, `PAYOUT_DEBTOR_*`, `DATA_ENCRYPTION_KEY`.
