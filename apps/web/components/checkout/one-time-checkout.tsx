'use client'

import PaymentCheckout, { type CheckoutApiResult } from '@/components/checkout/payment-checkout'
import type { PurchaseOptions } from '@/lib/api'

export type OneTimePaymentKind = 'ppv' | 'tip' | 'stream' | 'message'

/** Response of the start / confirm endpoints of one-off payments (tips, PPV) */
export type OneTimePaymentResult = CheckoutApiResult

interface OneTimeCheckoutProps {
  kind: OneTimePaymentKind
  /** Price excluding VAT (euros), for display: the API charges its own price for PPV */
  amount: number
  description: string
  start: (options: PurchaseOptions) => Promise<OneTimePaymentResult>
  confirm?: (transactionId: string) => Promise<OneTimePaymentResult>
  onSuccess?: () => void
  onCancel?: () => void
  successDelay?: number
  compact?: boolean
  summaryExtra?: React.ReactNode
  disabled?: boolean
}

/**
 * Checkout for one-off payments (PPV content / message / live, tips)
 */
export default function OneTimeCheckout(props: OneTimeCheckoutProps) {
  return <PaymentCheckout {...props} />
}
