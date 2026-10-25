'use client'

import { subscriptionsApi } from '@/lib/api'
import PaymentCheckout from '@/components/checkout/payment-checkout'

interface SubscriptionCheckoutProps {
  tierId: string
  /** Price excluding VAT (euros), for display: the API charges the tier price */
  amount: number
  /** 'month' | 'year' */
  interval?: string
  description: string
  /** Free subscription being upgraded to this paid tier: it ends once the paid one is active */
  changeFromSubscriptionId?: string
  onSuccess?: () => void
  onCancel?: () => void
}

export default function SubscriptionCheckout({
  tierId,
  amount,
  interval,
  description,
  changeFromSubscriptionId,
  onSuccess,
  onCancel,
}: SubscriptionCheckoutProps) {
  const period = interval === 'year' ? 'an' : 'mois'

  return (
    <PaymentCheckout
      kind="subscription"
      amount={amount}
      interval={interval}
      description={description}
      start={async (options) =>
        (changeFromSubscriptionId
          ? await subscriptionsApi.changeTier(changeFromSubscriptionId, { tierId, ...options })
          : await subscriptionsApi.subscribe({ tierId, ...options })
        ).data
      }
      confirm={async (transactionId) => (await subscriptionsApi.confirm(transactionId)).data}
      onSuccess={onSuccess}
      onCancel={onCancel}
      note={
        <>
          Renouvelé automatiquement chaque {period} au même prix, sur la carte utilisée, jusqu’à résiliation.
          Résiliable à tout moment en quelques clics depuis « Mes abonnements » : l’accès reste ouvert jusqu’à la fin
          de la période payée.
        </>
      }
    />
  )
}
