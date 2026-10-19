'use client'

import { useState } from 'react'
import Link from 'next/link'
import { subscriptionsApi } from '@/lib/api'
import { formatEuros } from '@/lib/utils'
import { getPaymentErrorMessage } from '@/lib/payment-errors'
import {
  getStripe,
  isStripeConfigured,
  STRIPE_NOT_CONFIGURED_MESSAGE,
} from '@/components/checkout/stripe-payment-element'
import PaymentMethodPicker, {
  resolvePaymentMethod,
  usePaymentMethods,
} from '@/components/checkout/payment-method-picker'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { AlertCircle, Loader2, Plus } from 'lucide-react'
import { toast } from '@/hooks/use-toast'

export interface PastDueSubscription {
  id: string
  stripeSubscriptionId?: string | null
  tier: {
    name: string
    price: string | number
    creator: { username: string; displayName?: string }
  }
}

interface RetryResult {
  requiresPayment: boolean
  stripeSubscriptionId?: string
  clientSecret?: string | null
  paymentStatus?: string
}

interface RetryPaymentDialogProps {
  subscription: PastDueSubscription | null
  // Where /settings/payment-methods sends the user back after adding a card
  returnUrl: string
  onOpenChange: (open: boolean) => void
  onPaid: () => void
}

/**
 * Pay the overdue renewal of a past-due subscription, with a saved card
 * (which then becomes the card of the subscription)
 */
export default function RetryPaymentDialog({ subscription, returnUrl, onOpenChange, onPaid }: RetryPaymentDialogProps) {
  const [selected, setSelected] = useState<string | null>(null)
  const [isProcessing, setIsProcessing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const stripeReady = isStripeConfigured()

  const open = !!subscription
  const { data: methods, isLoading } = usePaymentMethods(open && stripeReady)
  const method = resolvePaymentMethod(selected, methods)
  const hasCards = !!methods && methods.length > 0

  const close = () => {
    if (isProcessing) return
    setError(null)
    setSelected(null)
    onOpenChange(false)
  }

  // Stripe may take a moment to flip the subscription back to active
  const waitForActivation = async (stripeSubscriptionId: string) => {
    for (let attempt = 0; attempt < 5; attempt++) {
      const response = await subscriptionsApi.confirm(stripeSubscriptionId)
      if ((response.data as any)?.subscription?.status === 'ACTIVE') return
      await new Promise((resolve) => setTimeout(resolve, 1500))
    }
    throw new Error('Le paiement est en cours de traitement. Votre abonnement sera réactivé sous peu.')
  }

  const handlePay = async () => {
    if (!subscription || !hasCards) return
    setIsProcessing(true)
    setError(null)

    try {
      const response = await subscriptionsApi.retryPayment(subscription.id, { paymentMethodId: method })
      const result = response.data as RetryResult

      if (result.requiresPayment) {
        if (!result.clientSecret || result.paymentStatus !== 'requires_action' || !result.stripeSubscriptionId) {
          throw new Error('Le paiement a été refusé. Essayez avec une autre carte.')
        }

        // 3D Secure
        const stripe = await getStripe()
        if (!stripe) throw new Error(STRIPE_NOT_CONFIGURED_MESSAGE)
        const { error: stripeError } = await stripe.confirmCardPayment(result.clientSecret, {
          payment_method: method,
        })
        if (stripeError) throw stripeError

        await waitForActivation(result.stripeSubscriptionId)
      }

      toast({ title: 'Paiement effectué', description: 'Votre abonnement est de nouveau actif.' })
      setIsProcessing(false)
      setSelected(null)
      onOpenChange(false)
      onPaid()
    } catch (err) {
      setError(getPaymentErrorMessage(err))
      setIsProcessing(false)
      // The card of the subscription may have changed even if the payment failed
      onPaid()
    }
  }

  const creatorName = subscription?.tier.creator.displayName || subscription?.tier.creator.username
  const addCardHref = `/settings/payment-methods?${new URLSearchParams({ add: '1', returnUrl }).toString()}`

  return (
    <Dialog open={open} onOpenChange={(next) => !next && close()}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        {subscription && (
          <>
            <DialogHeader>
              <DialogTitle>Régler le paiement en retard</DialogTitle>
              <DialogDescription>
                Le renouvellement de votre abonnement {subscription.tier.name} chez {creatorName} (
                {formatEuros(subscription.tier.price)}) a échoué. Choisissez la carte à débiter : elle sera
                utilisée pour les prochains renouvellements.
              </DialogDescription>
            </DialogHeader>

            {!stripeReady ? (
              <Alert variant="destructive">
                <AlertCircle className="h-4 w-4" />
                <AlertDescription>{STRIPE_NOT_CONFIGURED_MESSAGE}</AlertDescription>
              </Alert>
            ) : isLoading ? (
              <div className="flex justify-center py-4">
                <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
              </div>
            ) : hasCards ? (
              <PaymentMethodPicker
                name="retry-payment-method"
                methods={methods}
                value={method}
                onChange={setSelected}
                allowNewCard={false}
              />
            ) : (
              <p className="text-sm text-muted-foreground">
                Aucune carte enregistrée. Ajoutez une carte pour régler ce paiement.
              </p>
            )}

            {stripeReady && !isLoading && (
              <Button asChild variant="link" className="px-0 h-auto justify-start">
                <Link href={addCardHref}>
                  <Plus className="h-4 w-4 mr-1" />
                  Ajouter une nouvelle carte
                </Link>
              </Button>
            )}

            {error && (
              <Alert variant="destructive">
                <AlertCircle className="h-4 w-4" />
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}

            <DialogFooter className="gap-2">
              <Button variant="outline" onClick={close} disabled={isProcessing}>
                Annuler
              </Button>
              <Button onClick={handlePay} disabled={isProcessing || !stripeReady || !hasCards}>
                {isProcessing && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                Payer {formatEuros(subscription.tier.price)}
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  )
}
