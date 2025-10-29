# 💳 Payment Features Documentation

## Overview

This document describes all payment-related features implemented in the OFM platform, including Stripe integration, webhooks, refunds, disputes, and automatic billing.

---

## 🎯 Features Implemented

### 1. Stripe Webhooks Handler

**File:** `src/payments/stripe-webhook.service.ts`

Complete webhook integration for all Stripe events:

#### Payment Events
- `payment_intent.succeeded` - Payment completed successfully
- `payment_intent.payment_failed` - Payment failed
- `payment_intent.canceled` - Payment canceled

#### Refund & Dispute Events
- `charge.refunded` - Charge was refunded (full or partial)
- `charge.dispute.created` - Dispute opened
- `charge.dispute.updated` - Dispute updated
- `charge.dispute.closed` - Dispute closed (won/lost)

#### Subscription Events
- `customer.subscription.created` - New subscription
- `customer.subscription.updated` - Subscription updated
- `customer.subscription.deleted` - Subscription canceled
- `customer.subscription.trial_will_end` - Trial ending soon

#### Invoice Events
- `invoice.created` - Invoice created
- `invoice.finalized` - Invoice finalized
- `invoice.paid` - Invoice paid
- `invoice.payment_failed` - Invoice payment failed

#### Connect Account Events
- `account.updated` - Creator account updated
- `account.external_account.created` - Bank account added

#### Payout Events
- `payout.paid` - Payout successfully sent
- `payout.failed` - Payout failed

---

### 2. Refund Management

**Methods:**
- `createRefund()` in `payments.service.ts` (line 507)
- Full and partial refunds supported
- Automatic transaction reversal
- Notifications to both parties

**Example Usage:**
```typescript
await paymentsService.createRefund(
  userId,
  transactionId,
  amount, // Optional - defaults to full refund
  reason  // Optional - reason for refund
);
```

**Features:**
- ✅ Full refunds (100% of original amount)
- ✅ Partial refunds (specify amount)
- ✅ Creates reverse transaction
- ✅ Updates original transaction status
- ✅ Stripe integration
- ✅ User notifications

---

### 3. Dispute & Chargeback Management

**Model:** `Dispute` in `prisma/schema.prisma` (line 528)

**Fields:**
- `stripeDisputeId` - Unique Stripe dispute ID
- `transactionId` - Related transaction
- `amount` - Disputed amount
- `reason` - Dispute reason
- `status` - needs_response, under_review, won, lost
- `evidence` - Evidence submitted (JSON)
- `evidenceDueBy` - Deadline for evidence

**Webhook Handlers:**
- `handleDisputeCreated()` - Records dispute, notifies creator
- `handleDisputeUpdated()` - Updates evidence/status
- `handleDisputeClosed()` - Resolves dispute (won/lost)

**Transaction Status Changes:**
- Disputed transaction → `DISPUTED` status
- Won dispute → Back to `COMPLETED`
- Lost dispute → `REFUNDED` status

---

### 4. Automatic Billing System

**File:** `src/payments/billing.service.ts`

Complete automated billing with cron jobs:

#### 🔄 Subscription Renewals
**Cron:** Daily at 2 AM
**Method:** `processSubscriptionRenewals()`

- Finds subscriptions ending today or before
- Processes renewal payments via Stripe
- Creates transaction records
- Handles payment failures (marks as PAST_DUE)
- Sends notifications

#### ❌ Cancel Expired Subscriptions
**Cron:** Daily at 3 AM
**Method:** `cancelExpiredSubscriptions()`

- Grace period: 3 days after failed payment
- Cancels subscriptions in PAST_DUE status
- Cancels in Stripe
- Sends cancellation notifications

#### 💰 Process Pending Payouts
**Cron:** Monday-Friday at 9 AM
**Method:** `processPendingPayouts()`

- Minimum payout: €50 (5000 cents)
- Calculates creator balance
- Creates Stripe payouts
- Updates database records
- Sends processing notifications

#### 📧 Payment Reminders
**Cron:** Daily at 10 AM
**Method:** `sendPaymentReminders()`

- Sends reminders for PAST_DUE subscriptions
- Encourages payment method updates
- Prevents subscription cancellation

#### 🧹 Cleanup Old Data
**Cron:** Monthly on 1st at 4 AM
**Method:** `cleanupOldSubscriptions()`

- Deletes cancelled subscriptions older than 6 months
- Keeps database clean

---

## 📊 Database Models

### Transaction Statuses

```prisma
enum TransactionStatus {
  PENDING            // Initial state
  PROCESSING         // Being processed
  COMPLETED          // Successfully completed
  FAILED             // Payment failed
  CANCELLED          // Canceled by user
  REFUNDED           // Fully refunded
  PARTIALLY_REFUNDED // Partially refunded
  DISPUTED           // Under dispute
}
```

### Dispute Model

```prisma
model Dispute {
  id              String    @id @default(uuid())
  stripeDisputeId String    @unique
  transactionId   String
  transaction     Transaction @relation(fields: [transactionId], references: [id])

  amount          Int       // Amount in cents
  currency        String
  reason          String
  status          String    // needs_response, under_review, won, lost

  evidence        Json?
  evidenceDueBy   DateTime?

  createdAt       DateTime  @default(now())
  updatedAt       DateTime  @updatedAt
  closedAt        DateTime?
}
```

### Payout Model (Enhanced)

```prisma
model Payout {
  id              String       @id @default(uuid())
  creatorId       String       // Changed from userId
  creator         User         @relation(fields: [creatorId], references: [id])

  status          PayoutStatus @default(PENDING)
  amount          Decimal      @db.Decimal(10, 2)
  currency        String       @default("EUR")

  stripePayoutId  String?      @unique
  destinationType String
  destination     String?

  requestedAt     DateTime     @default(now())
  processedAt     DateTime?
  paidAt          DateTime?    // Changed from completedAt
  failedAt        DateTime?
  failureReason   String?
}
```

---

## 🔔 Notification Types

New notification types added:

```typescript
// Payment notifications
'PAYMENT_SUCCESS'
'PAYMENT_FAILED'
'PAYMENT_REMINDER'

// Refund notifications
'REFUND_PROCESSED'  // To customer
'REFUND_ISSUED'     // To creator

// Dispute notifications
'DISPUTE_CREATED'
'DISPUTE_WON'
'DISPUTE_LOST'

// Subscription notifications
'SUBSCRIPTION_CANCELLED'
'TRIAL_ENDING'

// Payout notifications
'PAYOUT_PROCESSING'
'PAYOUT_COMPLETED'
'PAYOUT_FAILED'

// Account notifications
'ACCOUNT_VERIFIED'
```

---

## 🚀 Setup Instructions

### 1. Environment Variables

Add to `.env`:

```bash
# Stripe
STRIPE_SECRET_KEY=sk_test_...
STRIPE_PUBLISHABLE_KEY=pk_test_...
STRIPE_WEBHOOK_SECRET=whsec_...
STRIPE_PLATFORM_FEE_PERCENTAGE=10

# URLs for Stripe Connect
STRIPE_CONNECT_REFRESH_URL=http://localhost:3000/creator/connect/refresh
STRIPE_CONNECT_RETURN_URL=http://localhost:3000/creator/connect/return
```

### 2. Stripe Webhook Configuration

1. Go to Stripe Dashboard → Developers → Webhooks
2. Add endpoint: `https://yourdomain.com/webhooks/stripe`
3. Select events:
   - All payment_intent events
   - All charge events (for refunds/disputes)
   - All subscription events
   - All invoice events
   - All payout events
   - account.updated
4. Copy webhook secret to `STRIPE_WEBHOOK_SECRET`

### 3. Database Migration

Run Prisma migration to add Dispute model:

```bash
npx prisma migrate dev --name add_dispute_and_enhance_payout
```

### 4. Test Webhooks Locally

Use Stripe CLI:

```bash
stripe listen --forward-to localhost:4000/webhooks/stripe
stripe trigger payment_intent.succeeded
stripe trigger charge.dispute.created
```

---

## 🧪 Testing Refunds

```bash
# Test full refund
curl -X POST http://localhost:4000/payments/refund \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "transactionId": "trans_123",
    "reason": "Customer requested"
  }'

# Test partial refund
curl -X POST http://localhost:4000/payments/refund \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "transactionId": "trans_123",
    "amount": 1000,
    "reason": "Partial refund"
  }'
```

---

## 📈 Monitoring

### Cron Job Logs

Monitor automatic billing:

```bash
# Subscription renewals (2 AM daily)
tail -f logs/billing.log | grep "processSubscriptionRenewals"

# Payout processing (9 AM weekdays)
tail -f logs/billing.log | grep "processPendingPayouts"

# Payment reminders (10 AM daily)
tail -f logs/billing.log | grep "sendPaymentReminders"
```

### Webhook Monitoring

```bash
# All webhook events
tail -f logs/stripe-webhook.log

# Only disputes
tail -f logs/stripe-webhook.log | grep "dispute"

# Only failed payments
tail -f logs/stripe-webhook.log | grep "payment.*failed"
```

---

## 🔒 Security Considerations

1. **Webhook Signature Verification**
   - All webhooks verify Stripe signature
   - Prevents unauthorized webhook calls
   - Rejects invalid signatures immediately

2. **Refund Authorization**
   - Only creator or admin can issue refunds
   - Validates transaction ownership
   - Checks Stripe payment intent status

3. **Payout Security**
   - Minimum payout amount enforced
   - Only onboarded creators can receive payouts
   - Stripe account verification required

4. **Dispute Handling**
   - Automatic transaction locking during dispute
   - Evidence deadlines tracked
   - Creator notifications for action required

---

## 💡 Best Practices

### Refund Policy

Recommended refund windows:
- Subscriptions: First 7 days
- PPV Content: 24 hours if not viewed
- Tips: Non-refundable (explain in terms)

### Dispute Prevention

1. Clear content descriptions
2. Visible pricing information
3. Email confirmations
4. Respond to customer inquiries quickly

### Payout Schedule

- Daily automatic processing (Monday-Friday)
- Minimum balance: €50
- Typical arrival: 2-5 business days
- Failed payouts: Automatic retry after 3 days

---

## 🐛 Troubleshooting

### Webhook Not Received

```bash
# Check webhook secret
echo $STRIPE_WEBHOOK_SECRET

# Test with Stripe CLI
stripe listen --forward-to localhost:4000/webhooks/stripe

# Check logs
tail -f logs/stripe-webhook.log
```

### Subscription Not Renewing

```bash
# Check cron job status
grep "processSubscriptionRenewals" logs/billing.log

# Manually trigger (in prod console)
await billingService.processSubscriptionRenewals()

# Check subscription status in Stripe Dashboard
```

### Payout Failing

```bash
# Check creator's Stripe account status
await stripeService.getAccount(creator.stripeAccountId)

# Verify onboarding complete
await stripeService.isAccountOnboarded(creator.stripeAccountId)

# Check balance
await stripeService.getAccountBalance(creator.stripeAccountId)
```

---

## 📞 Support

For issues or questions:
1. Check logs in `logs/` directory
2. Review Stripe Dashboard events
3. Test with Stripe CLI
4. Check database for transaction/dispute records

---

**Last Updated:** 2025-10-29
**Version:** 1.0.0
