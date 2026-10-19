'use client'

import { useEffect, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { paymentsApi, subscriptionsApi } from '@/lib/api'
import { formatEuros } from '@/lib/utils'
import StripePaymentElement, { getStripe } from '@/components/checkout/stripe-payment-element'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { CreditCard, CheckCircle, AlertCircle, Loader2, Lock, Plus } from 'lucide-react'

interface SubscribeResult {
  requiresPayment: boolean
  subscription?: any
  stripeSubscriptionId?: string
  clientSecret?: string | null
}

interface SubscriptionCheckoutProps {
  tierId: string
  // Amount in euros, for display
  amount: number
  description: string
  onSuccess?: () => void
  onCancel?: () => void
}

const NEW_CARD = 'new'

const getErrorMessage = (error: any) =>
  error?.response?.data?.message || error?.message || 'Une erreur est survenue lors du paiement.'

export default function SubscriptionCheckout({
  tierId,
  amount,
  description,
  onSuccess,
  onCancel,
}: SubscriptionCheckoutProps) {
  const [step, setStep] = useState<'review' | 'card' | 'processing' | 'success' | 'error'>('review')
  const [selectedMethod, setSelectedMethod] = useState<string | null>(null)
  const [pending, setPending] = useState<{ clientSecret: string; stripeSubscriptionId: string } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const successTimer = useRef<ReturnType<typeof setTimeout>>()

  useEffect(() => () => clearTimeout(successTimer.current), [])

  const { data: paymentMethods, isLoading: loadingMethods } = useQuery({
    queryKey: ['payment-methods'],
    queryFn: async () => {
      const response = await paymentsApi.getPaymentMethods()
      return response.data as { id: string; brand?: string; last4: string; expMonth?: number; expYear?: number; isDefault: boolean }[]
    },
  })

  // Preselect the default card, or a new card when none is saved
  const method =
    selectedMethod ?? (paymentMethods?.find((m) => m.isDefault)?.id || paymentMethods?.[0]?.id || NEW_CARD)

  const succeed = () => {
    setStep('success')
    successTimer.current = setTimeout(() => onSuccess?.(), 2000)
  }

  const fail = (err: any) => {
    setError(getErrorMessage(err))
    setStep('error')
  }

  // Sync the subscription once Stripe confirmed the first payment.
  // Stripe may take a moment to flip the subscription to active.
  const confirmSubscription = async (stripeSubscriptionId: string) => {
    for (let attempt = 0; attempt < 5; attempt++) {
      const response = await subscriptionsApi.confirm(stripeSubscriptionId)
      const result = response.data as SubscribeResult
      if (!result.requiresPayment) return
      await new Promise((resolve) => setTimeout(resolve, 1500))
    }
    throw new Error('Le paiement est en cours de traitement. Votre abonnement sera activé sous peu.')
  }

  const handlePay = async () => {
    setStep('processing')
    setError(null)

    try {
      const response = await subscriptionsApi.subscribe({
        tierId,
        paymentMethodId: method === NEW_CARD ? undefined : method,
      })
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

      // Saved card needing authentication (3D Secure)
      const stripe = await getStripe()
      if (!stripe) throw new Error('Le paiement est indisponible : clé Stripe manquante.')

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
          <h3 className="text-xl font-bold mb-2">Paiement Échoué</h3>
          <p className="text-muted-foreground mb-4">{error}</p>
          <div className="flex gap-2">
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
          <div className="flex items-center justify-between p-4 border rounded-lg bg-muted/50">
            <div>
              <p className="font-medium">Abonnement</p>
              <p className="text-sm text-muted-foreground">{description}</p>
            </div>
            <p className="text-2xl font-bold">{formattedAmount}</p>
          </div>
        </CardContent>
      </Card>

      {/* Payment Method */}
      <Card>
        <CardHeader>
          <CardTitle>Méthode de Paiement</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {step === 'card' && pending ? (
            <StripePaymentElement
              clientSecret={pending.clientSecret}
              mode="payment"
              submitLabel={`Payer ${formattedAmount}`}
              onSuccess={handleCardConfirmed}
              onCancel={() => setStep('review')}
            />
          ) : loadingMethods ? (
            <div className="flex justify-center py-4">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : (
            <>
              {paymentMethods?.map((pm) => (
                <label
                  key={pm.id}
                  className={`flex items-center gap-3 p-3 border rounded-lg cursor-pointer ${
                    method === pm.id ? 'ring-2 ring-primary' : ''
                  }`}
                >
                  <input
                    type="radio"
                    name="payment-method"
                    checked={method === pm.id}
                    onChange={() => setSelectedMethod(pm.id)}
                  />
                  <CreditCard className="h-5 w-5 text-muted-foreground" />
                  <span className="flex-1 text-sm">
                    <span className="capitalize">{pm.brand || 'Carte'}</span> •••• {pm.last4}
                  </span>
                  {pm.expMonth && pm.expYear && (
                    <span className="text-xs text-muted-foreground">
                      {pm.expMonth.toString().padStart(2, '0')}/{pm.expYear}
                    </span>
                  )}
                </label>
              ))}
              <label
                className={`flex items-center gap-3 p-3 border rounded-lg cursor-pointer ${
                  method === NEW_CARD ? 'ring-2 ring-primary' : ''
                }`}
              >
                <input
                  type="radio"
                  name="payment-method"
                  checked={method === NEW_CARD}
                  onChange={() => setSelectedMethod(NEW_CARD)}
                />
                <Plus className="h-5 w-5 text-muted-foreground" />
                <span className="text-sm">Nouvelle carte</span>
              </label>
              <Alert>
                <Lock className="h-4 w-4" />
                <AlertDescription className="text-sm">
                  Paiement sécurisé par Stripe. La carte utilisée sera enregistrée pour les renouvellements.
                </AlertDescription>
              </Alert>
            </>
          )}
        </CardContent>
      </Card>

      {/* Actions */}
      {step === 'review' && (
        <div className="flex gap-3">
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
