'use client'

import { useEffect, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { paymentsApi } from '@/lib/api'
import { formatEuros } from '@/lib/utils'
import StripePaymentElement, { getStripe } from '@/components/checkout/stripe-payment-element'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { CreditCard, CheckCircle, AlertCircle, Loader2, Lock, Plus } from 'lucide-react'

/** Response of the start / confirm endpoints of one-off payments (tips, PPV) */
export interface OneTimePaymentResult {
  status?: 'completed' | 'processing' | 'requires_action' | 'requires_payment_method' | 'failed'
  completed?: boolean
  paymentIntentId?: string | null
  clientSecret?: string | null
  // Already bought: nothing was charged
  alreadyUnlocked?: boolean
  alreadyPurchased?: boolean
}

export type OneTimePaymentKind = 'ppv' | 'tip' | 'stream'

interface OneTimeCheckoutProps {
  kind: OneTimePaymentKind
  // Amount in euros, for display (the API charges its own price for PPV)
  amount: number
  description: string
  // Start the payment, with a saved card or without one (Stripe Elements)
  start: (paymentMethodId?: string) => Promise<OneTimePaymentResult>
  // Ask the API to re-check the payment with Stripe (idempotent)
  confirm: (paymentIntentId: string) => Promise<OneTimePaymentResult>
  onSuccess?: () => void
  onCancel?: () => void
  // Delay before onSuccess, to show the confirmation (ms)
  successDelay?: number
  // Render without the summary card (modals)
  compact?: boolean
}

const NEW_CARD = 'new'

const LABELS: Record<OneTimePaymentKind, { item: string; success: string; done: string }> = {
  ppv: { item: 'Contenu pay-per-view', success: 'Contenu débloqué !', done: 'Le contenu est maintenant accessible.' },
  stream: { item: 'Accès au live', success: 'Accès au live acheté !', done: 'Vous pouvez maintenant regarder le live.' },
  tip: { item: 'Pourboire', success: 'Pourboire envoyé !', done: 'Merci pour votre soutien.' },
}

const getErrorMessage = (error: any) =>
  error?.response?.data?.message || error?.message || 'Une erreur est survenue lors du paiement.'

const isDone = (result: OneTimePaymentResult) =>
  !!(result.completed || result.alreadyUnlocked || result.alreadyPurchased)

/**
 * Checkout for one-off payments (PPV content, PPV live, tips) with a saved
 * card or a new card through Stripe Elements. Access is only considered
 * granted once the API confirms the payment with Stripe.
 */
export default function OneTimeCheckout({
  kind,
  amount,
  description,
  start,
  confirm,
  onSuccess,
  onCancel,
  successDelay = 2000,
  compact = false,
}: OneTimeCheckoutProps) {
  const [step, setStep] = useState<'review' | 'card' | 'processing' | 'success' | 'error'>('review')
  const [selectedMethod, setSelectedMethod] = useState<string | null>(null)
  const [pending, setPending] = useState<{ clientSecret: string; paymentIntentId: string } | null>(null)
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

  const labels = LABELS[kind]
  const formattedAmount = formatEuros(amount)

  const succeed = () => {
    setStep('success')
    successTimer.current = setTimeout(() => onSuccess?.(), successDelay)
  }

  const fail = (err: any) => {
    setError(getErrorMessage(err))
    setStep('error')
  }

  // Stripe may report the payment a moment after the client-side confirmation
  const waitForConfirmation = async (paymentIntentId: string) => {
    for (let attempt = 0; attempt < 5; attempt++) {
      const result = await confirm(paymentIntentId)
      if (isDone(result)) return
      if (result.status === 'failed' || result.status === 'requires_payment_method') {
        throw new Error('Le paiement a été refusé.')
      }
      await new Promise((resolve) => setTimeout(resolve, 1500))
    }
    throw new Error('Le paiement est en cours de traitement. Vous serez notifié dès sa validation.')
  }

  const handlePay = async () => {
    setStep('processing')
    setError(null)

    try {
      const savedCard = method === NEW_CARD ? undefined : method
      const result = await start(savedCard)

      if (isDone(result)) {
        succeed()
        return
      }

      if (!result.paymentIntentId) {
        throw new Error('Impossible d\'initialiser le paiement.')
      }

      if (result.status === 'processing') {
        await waitForConfirmation(result.paymentIntentId)
        succeed()
        return
      }

      if (!result.clientSecret) {
        throw new Error('Le paiement a été refusé.')
      }

      if (!savedCard) {
        setPending({ clientSecret: result.clientSecret, paymentIntentId: result.paymentIntentId })
        setStep('card')
        return
      }

      // Saved card needing authentication (3D Secure)
      const stripe = await getStripe()
      if (!stripe) throw new Error('Le paiement est indisponible : clé Stripe manquante.')

      const { error: stripeError } = await stripe.confirmCardPayment(result.clientSecret, {
        payment_method: savedCard,
      })
      if (stripeError) throw stripeError

      await waitForConfirmation(result.paymentIntentId)
      succeed()
    } catch (err) {
      fail(err)
    }
  }

  const handleCardConfirmed = async () => {
    if (!pending) return
    setStep('processing')
    try {
      await waitForConfirmation(pending.paymentIntentId)
      succeed()
    } catch (err) {
      fail(err)
    }
  }

  if (step === 'success') {
    return (
      <Card className="max-w-md mx-auto w-full">
        <CardContent className="pt-6 text-center">
          <div className="h-16 w-16 rounded-full bg-green-100 mx-auto mb-4 flex items-center justify-center">
            <CheckCircle className="h-8 w-8 text-green-600" />
          </div>
          <h3 className="text-xl font-bold mb-2">{labels.success}</h3>
          <p className="text-muted-foreground">
            Votre paiement de {formattedAmount} a été effectué avec succès. {labels.done}
          </p>
        </CardContent>
      </Card>
    )
  }

  if (step === 'error') {
    return (
      <Card className="max-w-md mx-auto w-full">
        <CardContent className="pt-6 text-center">
          <div className="h-16 w-16 rounded-full bg-red-100 mx-auto mb-4 flex items-center justify-center">
            <AlertCircle className="h-8 w-8 text-red-600" />
          </div>
          <h3 className="text-xl font-bold mb-2">Paiement échoué</h3>
          <p className="text-muted-foreground mb-4">{error}</p>
          <div className="flex gap-2">
            {onCancel && (
              <Button variant="outline" onClick={onCancel} className="flex-1">
                Annuler
              </Button>
            )}
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
      <Card className="max-w-md mx-auto w-full">
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
    <div className="max-w-md mx-auto w-full space-y-4">
      {!compact && (
        <Card>
          <CardHeader>
            <CardTitle>Récapitulatif</CardTitle>
            <CardDescription>Paiement unique, sans abonnement</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex items-center justify-between p-4 border rounded-lg bg-muted/50">
              <div>
                <p className="font-medium">{labels.item}</p>
                <p className="text-sm text-muted-foreground">{description}</p>
              </div>
              <p className="text-2xl font-bold">{formattedAmount}</p>
            </div>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Méthode de paiement</CardTitle>
          {compact && (
            <CardDescription>
              {labels.item} · {formattedAmount}
            </CardDescription>
          )}
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
                    name="one-time-payment-method"
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
                  name="one-time-payment-method"
                  checked={method === NEW_CARD}
                  onChange={() => setSelectedMethod(NEW_CARD)}
                />
                <Plus className="h-5 w-5 text-muted-foreground" />
                <span className="text-sm">Nouvelle carte</span>
              </label>
              <Alert>
                <Lock className="h-4 w-4" />
                <AlertDescription className="text-sm">Paiement sécurisé par Stripe.</AlertDescription>
              </Alert>
            </>
          )}
        </CardContent>
      </Card>

      {step === 'review' && (
        <div className="flex gap-3">
          {onCancel && (
            <Button variant="outline" onClick={onCancel} className="flex-1">
              Annuler
            </Button>
          )}
          <Button onClick={handlePay} className="flex-1" disabled={loadingMethods}>
            <Lock className="h-4 w-4 mr-2" />
            {method === NEW_CARD ? 'Continuer' : `Payer ${formattedAmount}`}
          </Button>
        </div>
      )}
    </div>
  )
}
