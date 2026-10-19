'use client'

import { useEffect, useRef, useState } from 'react'
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

/** Back from a Stripe redirect (3D Secure page) with the payment intent being paid */
export interface OneTimeRedirectResume {
  paymentIntentId: string
  status: string | null // redirect_status: succeeded | processing | failed
}

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
  // Rendered in the summary card, e.g. the tip amount field
  summaryExtra?: React.ReactNode
  // Blocks the payment button (e.g. invalid tip amount)
  disabled?: boolean
  resume?: OneTimeRedirectResume
}

const LABELS: Record<OneTimePaymentKind, { item: string; success: string; done: string }> = {
  ppv: { item: 'Contenu pay-per-view', success: 'Contenu débloqué !', done: 'Le contenu est maintenant accessible.' },
  stream: { item: 'Accès au live', success: 'Accès au live acheté !', done: 'Vous pouvez maintenant regarder le live.' },
  tip: { item: 'Pourboire', success: 'Pourboire envoyé !', done: 'Merci pour votre soutien.' },
}

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
  summaryExtra,
  disabled = false,
  resume,
}: OneTimeCheckoutProps) {
  const [step, setStep] = useState<'review' | 'card' | 'processing' | 'success' | 'error'>(
    resume ? 'processing' : 'review',
  )
  const [selectedMethod, setSelectedMethod] = useState<string | null>(null)
  const [pending, setPending] = useState<{ clientSecret: string; paymentIntentId: string } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const successTimer = useRef<ReturnType<typeof setTimeout>>()
  const resumed = useRef(false)

  useEffect(() => () => clearTimeout(successTimer.current), [])

  const { data: paymentMethods, isLoading: loadingMethods } = usePaymentMethods()
  const method = resolvePaymentMethod(selectedMethod, paymentMethods)

  const labels = LABELS[kind]
  const formattedAmount = formatEuros(amount)

  const succeed = () => {
    setStep('success')
    successTimer.current = setTimeout(() => onSuccess?.(), successDelay)
  }

  const fail = (err: any) => {
    setError(getPaymentErrorMessage(err))
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

  // Back from a Stripe redirect: check the payment instead of starting over
  useEffect(() => {
    if (!resume || resumed.current) return
    resumed.current = true
    if (resume.status === 'failed') {
      fail(new Error('Le paiement n’a pas été validé par votre banque. Veuillez réessayer.'))
      return
    }
    waitForConfirmation(resume.paymentIntentId).then(succeed, fail)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resume])

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
      if (!stripe) throw new Error(STRIPE_NOT_CONFIGURED_MESSAGE)

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
          {onSuccess && (
            <Button
              className="mt-4 w-full"
              onClick={() => {
                clearTimeout(successTimer.current)
                onSuccess()
              }}
            >
              Continuer
            </Button>
          )}
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
          <div className="flex flex-col-reverse gap-2 sm:flex-row">
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
          <CardContent className="space-y-4">
            <div className="flex items-center justify-between gap-4 p-4 border rounded-lg bg-muted/50">
              <div className="min-w-0">
                <p className="font-medium">{labels.item}</p>
                <p className="text-sm text-muted-foreground break-words">{description}</p>
              </div>
              <p className="text-2xl font-bold whitespace-nowrap">{formattedAmount}</p>
            </div>
            {step === 'review' && summaryExtra}
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
          ) : (
            <>
              <PaymentMethodPicker
                name="one-time-payment-method"
                methods={paymentMethods}
                loading={loadingMethods}
                value={method}
                onChange={setSelectedMethod}
              />
              {!loadingMethods && (
                <Alert>
                  <Lock className="h-4 w-4" />
                  <AlertDescription className="text-sm">Paiement sécurisé par Stripe.</AlertDescription>
                </Alert>
              )}
            </>
          )}
        </CardContent>
      </Card>

      {step === 'review' && (
        <div className="flex flex-col-reverse gap-3 sm:flex-row">
          {onCancel && (
            <Button variant="outline" onClick={onCancel} className="flex-1">
              Annuler
            </Button>
          )}
          <Button onClick={handlePay} className="flex-1" disabled={loadingMethods || disabled}>
            <Lock className="h-4 w-4 mr-2" />
            {method === NEW_CARD ? 'Continuer' : `Payer ${formattedAmount}`}
          </Button>
        </div>
      )}
    </div>
  )
}
