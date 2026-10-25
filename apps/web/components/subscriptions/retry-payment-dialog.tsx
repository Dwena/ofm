'use client'

import { subscriptionsApi } from '@/lib/api'
import { formatEuros } from '@/lib/utils'
import PaymentCheckout from '@/components/checkout/payment-checkout'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { toast } from '@/hooks/use-toast'

export interface PastDueSubscription {
  id: string
  tier: {
    name: string
    price: string | number
    interval?: string
    creator: { username: string; displayName?: string }
  }
}

interface RetryPaymentDialogProps {
  subscription: PastDueSubscription | null
  // Kept for the callers; a new card is entered on the provider's page
  returnUrl?: string
  onOpenChange: (open: boolean) => void
  onPaid: () => void
}

/**
 * Pay a past-due subscription now, with a saved card (which then renews the
 * subscription) or a new card on the payment provider's page
 */
export default function RetryPaymentDialog({ subscription, onOpenChange, onPaid }: RetryPaymentDialogProps) {
  const creatorName = subscription?.tier.creator.displayName || subscription?.tier.creator.username

  return (
    <Dialog open={!!subscription} onOpenChange={(next) => !next && onOpenChange(false)}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        {subscription && (
          <>
            <DialogHeader>
              <DialogTitle>Régler le paiement en retard</DialogTitle>
              <DialogDescription>
                Le renouvellement de votre abonnement {subscription.tier.name} chez {creatorName} (
                {formatEuros(subscription.tier.price)} HT) a échoué. Une nouvelle période commence dès le paiement ;
                la carte utilisée servira aux prochains renouvellements.
              </DialogDescription>
            </DialogHeader>
            <PaymentCheckout
              key={subscription.id}
              kind="subscription"
              compact
              amount={Number(subscription.tier.price)}
              interval={subscription.tier.interval}
              description={`${subscription.tier.name} - @${subscription.tier.creator.username}`}
              start={async (options) => (await subscriptionsApi.retryPayment(subscription.id, options)).data}
              confirm={async (transactionId) => (await subscriptionsApi.confirm(transactionId)).data}
              successDelay={1200}
              onSuccess={() => {
                toast({ title: 'Paiement effectué', description: 'Votre abonnement est de nouveau actif.' })
                onOpenChange(false)
                onPaid()
              }}
              onCancel={() => onOpenChange(false)}
            />
          </>
        )}
      </DialogContent>
    </Dialog>
  )
}
