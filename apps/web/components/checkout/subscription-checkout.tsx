'use client'

import { useEffect, useRef, useState } from 'react'
import { subscriptionsApi } from '@/lib/api'
import { formatEuros } from '@/lib/utils'
import { getPaymentErrorMessage } from '@/lib/payment-errors'
import StripePaymentElement, {
  getStripe,
  STRIPE_NOT_CONFIGURED_MESSAGE,
} from '@/components/checkout/stripe-payment-element'
import PaymentMethodPicker, {
  NEW_CARD,
  resolvePaymentMethod,
  usePaymentMethods,
} from '@/components/checkout/payment-method-picker'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { CheckCircle, AlertCircle, Loader2, Lock } from 'lucide-react'

interface SubscribeResult {
  requiresPayment: boolean
  subscription?: any
  stripeSubscriptionId?: string
  clientSecret?: string | null
  paymentStatus?: string
}

/** Back from a Stripe redirect (3D Secure page) with the subscription being paid */
export interface SubscriptionRedirectResume {
  stripeSubscriptionId: string
  status: string | null // redirect_status: succeeded | processing | failed
}

interface SubscriptionCheckoutProps {
  tierId: string
  // Amount in euros, for display (the API charges the tier price)
  amount: number
  // 'month' | 'year'
  interval?: string
  description: string
  // Free subscription being upgraded to this paid tier: it ends once the paid one is active
  changeFromSubscriptionId?: string
  resume?: SubscriptionRedirectResume
  onSuccess?: () => void
  onCancel?: () => void
}

// Query param carrying the Stripe subscription through a redirect
export const PENDING_SUBSCRIPTION_PARAM = 'pendingSubscription'

export default function SubscriptionCheckout({
  tierId,
  amount,
  interval,
  description,
  changeFromSubscriptionId,
  resume,
  onSuccess,
  onCancel,
}: SubscriptionCheckoutProps) {
  const [step, setStep] = useState<'review' | 'card' | 'processing' | 'success' | 'error'>(
    resume ? 'processing' : 'review',
  )
  const [selectedMethod, setSelectedMethod] = useState<string | null>(null)
  const [pending, setPending] = useState<{ clientSecret: string; stripeSubscriptionId: string } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const successTimer = useRef<ReturnType<typeof setTimeout>>()
  const resumed = useRef(false)

  useEffect(() => () => clearTimeout(successTimer.current), [])

  const { data: paymentMethods, isLoading: loadingMethods } = usePaymentMethods()
  const method = resolvePaymentMethod(selectedMethod, paymentMethods)

  const succeed = () => {
    setStep('success')
    successTimer.current = setTimeout(() => onSuccess?.(), 2000)
  }

  const fail = (err: any) => {
    setError(getPaymentErrorMessage(err))
    setStep('error')
  }

  // Sync the subscription once Stripe confirmed the first payment.
  // Stripe may take a moment to flip the subscription to active.
  const confirmSubscription = async (stripeSubscriptionId: string) => {
    for (let attempt = 0; attempt < 5; attempt++) {
      const response = await subscriptionsApi.confirm(stripeSubscriptionId)
      const result = response.data as SubscribeResult
      if (!result.requiresPayment) return
      if (result.paymentStatus === 'requires_payment_method') {
        throw new Error('Le paiement a été refusé. Essayez avec une autre carte.')
      }
      await new Promise((resolve) => setTimeout(resolve, 1500))
    }
    throw new Error('Le paiement est en cours de traitement. Votre abonnement sera activé sous peu.')
  }

  // Back from a Stripe redirect: check the payment instead of starting over
  useEffect(() => {
    if (!resume || resumed.current) return
    resumed.current = true
    if (resume.status === 'failed') {
      fail(new Error('Le paiement n’a pas été validé par votre banque. Veuillez réessayer.'))
      return
    }
    confirmSubscription(resume.stripeSubscriptionId).then(succeed, fail)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resume])

  const handlePay = async () => {
    setStep('processing')
    setError(null)

    try {
      const data = {
        tierId,
        paymentMethodId: method === NEW_CARD ? undefined : method,
      }
      const response = changeFromSubscriptionId
        ? await subscriptionsApi.changeTier(changeFromSubscriptionId, data)
        : await subscriptionsApi.subscribe(data)
      const result = response.data as SubscribeResult

      if (!result.requiresPayment) {
        succeed()
        return
      }

      if (!result.clientSecret || !result.stripeSubscriptionId) {
        throw new Error('Impossible d\'initialiser le paiement.')
      }

      if (method === NEW_CARD) {
        setPending({ clientSecret: result.clientSecret, stripeSubscriptionId: result.stripeSubscriptionId })
        setStep('card')
        return
      }

      // Saved card declined, or needing authentication (3D Secure)
      if (result.paymentStatus === 'requires_payment_method') {
        throw new Error('Le paiement a été refusé. Essayez avec une autre carte.')
      }

      const stripe = await getStripe()
      if (!stripe) throw new Error(STRIPE_NOT_CONFIGURED_MESSAGE)

      const { error: stripeError } = await stripe.confirmCardPayment(result.clientSecret, {
        payment_method: method,
      })
      if (stripeError) throw stripeError

      await confirmSubscription(result.stripeSubscriptionId)
      succeed()
    } catch (err) {
      fail(err)
    }
  }

  const handleCardConfirmed = async () => {
    if (!pending) return
    setStep('processing')
    try {
      await confirmSubscription(pending.stripeSubscriptionId)
      succeed()
    } catch (err) {
      fail(err)
    }
  }

  const formattedAmount = formatEuros(amount)
  const period = interval === 'year' ? 'an' : 'mois'

  if (step === 'success') {
    return (
      <Card className="max-w-md mx-auto">
        <CardContent className="pt-6 text-center">
          <div className="h-16 w-16 rounded-full bg-green-100 mx-auto mb-4 flex items-center justify-center">
            <CheckCircle className="h-8 w-8 text-green-600" />
          </div>
          <h3 className="text-xl font-bold mb-2">Abonnement activé !</h3>
          <p className="text-muted-foreground">
            Votre paiement de {formattedAmount} a été effectué avec succès.
          </p>
          <p className="text-sm text-muted-foreground mt-2">Vous allez être redirigé...</p>
          <Button
            className="mt-4 w-full"
            onClick={() => {
              clearTimeout(successTimer.current)
              onSuccess?.()
            }}
          >
            Continuer
          </Button>
        </CardContent>
      </Card>
    )
  }

  if (step === 'error') {
    return (
      <Card className="max-w-md mx-auto">
        <CardContent className="pt-6 text-center">
          <div className="h-16 w-16 rounded-full bg-red-100 mx-auto mb-4 flex items-center justify-center">
            <AlertCircle className="h-8 w-8 text-red-600" />
          </div>
          <h3 className="text-xl font-bold mb-2">Paiement échoué</h3>
          <p className="text-muted-foreground mb-4">{error}</p>
          <div className="flex flex-col-reverse gap-2 sm:flex-row">
            <Button variant="outline" onClick={onCancel} className="flex-1">
              Annuler
            </Button>
            <Button onClick={() => setStep('review')} className="flex-1">
              Réessayer
            </Button>
          </div>
        </CardContent>
      </Card>
    )
  }

  if (step === 'processing') {
    return (
      <Card className="max-w-md mx-auto">
        <CardContent className="pt-6 text-center">
          <Loader2 className="h-12 w-12 animate-spin mx-auto mb-4 text-primary" />
          <h3 className="text-xl font-bold mb-2">Traitement en cours...</h3>
          <p className="text-muted-foreground">
            Veuillez patienter pendant que nous traitons votre paiement.
          </p>
        </CardContent>
      </Card>
    )
  }

  return (
    <div className="max-w-md mx-auto space-y-4">
      {/* Order Summary */}
      <Card>
        <CardHeader>
          <CardTitle>Récapitulatif</CardTitle>
          <CardDescription>Abonnement renouvelé automatiquement, résiliable à tout moment</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex items-center justify-between gap-4 p-4 border rounded-lg bg-muted/50">
            <div className="min-w-0">
              <p className="font-medium">Abonnement</p>
              <p className="text-sm text-muted-foreground break-words">{description}</p>
            </div>
            <p className="text-2xl font-bold whitespace-nowrap">
              {formattedAmount}
              <span className="text-sm font-normal text-muted-foreground">/{period}</span>
            </p>
          </div>
        </CardContent>
      </Card>

      {/* Payment Method */}
      <Card>
        <CardHeader>
          <CardTitle>Méthode de paiement</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {step === 'card' && pending ? (
            <StripePaymentElement
              clientSecret={pending.clientSecret}
              mode="payment"
              submitLabel={`Payer ${formattedAmount}`}
              returnParams={{ [PENDING_SUBSCRIPTION_PARAM]: pending.stripeSubscriptionId }}
              onSuccess={handleCardConfirmed}
              onCancel={() => setStep('review')}
            />
          ) : (
            <>
              <PaymentMethodPicker
                name="payment-method"
                methods={paymentMethods}
                loading={loadingMethods}
                value={method}
                onChange={setSelectedMethod}
              />
              {!loadingMethods && (
                <Alert>
                  <Lock className="h-4 w-4" />
                  <AlertDescription className="text-sm">
                    Paiement sécurisé par Stripe. La carte utilisée sera enregistrée pour les renouvellements.
                  </AlertDescription>
                </Alert>
              )}
            </>
          )}
        </CardContent>
      </Card>

      {/* Actions */}
      {step === 'review' && (
        <div className="flex flex-col-reverse gap-3 sm:flex-row">
          <Button variant="outline" onClick={onCancel} className="flex-1">
            Annuler
          </Button>
          <Button onClick={handlePay} className="flex-1" disabled={loadingMethods}>
            <Lock className="h-4 w-4 mr-2" />
            {method === NEW_CARD ? 'Continuer' : `Payer ${formattedAmount}`}
          </Button>
        </div>
      )}
    </div>
  )
}
