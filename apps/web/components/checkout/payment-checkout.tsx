'use client'

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { paymentsApi, type PurchaseOptions } from '@/lib/api'
import { formatEuros } from '@/lib/utils'
import { getPaymentErrorMessage } from '@/lib/payment-errors'
import { getStoredBillingCountry, priceWithVat, storeBillingCountry } from '@/lib/vat'
import PaymentMethodPicker, {
  NEW_CARD,
  resolvePaymentMethod,
  usePaymentMethods,
} from '@/components/checkout/payment-method-picker'
import BillingCountrySelect from '@/components/checkout/billing-country-select'
import PriceBreakdown from '@/components/checkout/price-breakdown'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { CheckCircle, AlertCircle, Loader2, Lock } from 'lucide-react'

export type CheckoutKind = 'ppv' | 'tip' | 'stream' | 'message' | 'subscription'

/**
 * Raw response of a payment start / confirm endpoint: a payment result
 * (tips, PPV) or a subscription result ({ requiresPayment, payment, ... })
 */
export type CheckoutApiResult = Record<string, any>

interface NormalizedResult {
  done: boolean
  status: 'completed' | 'processing' | 'requires_redirect' | 'failed'
  transactionId: string | null
  redirectUrl: string | null
  failureReason: string | null
  totalAmount: number | null
}

export function normalizeCheckoutResult(raw: CheckoutApiResult): NormalizedResult {
  const payment = raw?.payment ?? raw ?? {}
  const done =
    !!(raw?.alreadyUnlocked || raw?.alreadyPurchased || raw?.completed || payment.completed) ||
    (raw?.requiresPayment === false && !!raw?.subscription)
  return {
    done,
    status: done ? 'completed' : (payment.status ?? raw?.paymentStatus ?? 'processing'),
    transactionId: payment.transactionId ?? raw?.transactionId ?? null,
    redirectUrl: payment.redirectUrl ?? raw?.redirectUrl ?? null,
    failureReason: payment.failureReason ?? null,
    totalAmount: typeof payment.totalAmount === 'number' ? payment.totalAmount : null,
  }
}

const LABELS: Record<CheckoutKind, { item: string; success: string; done: string }> = {
  ppv: { item: 'Contenu pay-per-view', success: 'Contenu débloqué !', done: 'Le contenu est maintenant accessible.' },
  stream: { item: 'Accès au live', success: 'Accès au live acheté !', done: 'Vous pouvez maintenant regarder le live.' },
  message: { item: 'Message privé payant', success: 'Message débloqué !', done: 'Le message est maintenant accessible.' },
  tip: { item: 'Pourboire', success: 'Pourboire envoyé !', done: 'Merci pour votre soutien.' },
  subscription: { item: 'Abonnement', success: 'Abonnement activé !', done: 'Profitez du contenu.' },
}

/** Wait for the payment provider's confirmation (webhook) of a payment */
export async function waitForPayment(
  transactionId: string,
  confirm?: (transactionId: string) => Promise<CheckoutApiResult>,
  attempts = 8,
): Promise<NormalizedResult> {
  let last: NormalizedResult | null = null
  for (let attempt = 0; attempt < attempts; attempt++) {
    const raw = confirm ? await confirm(transactionId) : (await paymentsApi.getPaymentStatus(transactionId)).data
    last = normalizeCheckoutResult(raw)
    if (last.done || last.status === 'failed') return last
    await new Promise((resolve) => setTimeout(resolve, 1500))
  }
  return last ?? { done: false, status: 'processing', transactionId, redirectUrl: null, failureReason: null, totalAmount: null }
}

interface PaymentCheckoutProps {
  kind: CheckoutKind
  /** Price excluding VAT (euros), for display: the API charges its own price */
  amount: number
  /** Subscriptions: 'month' | 'year' */
  interval?: string
  description: string
  /** Start the payment with the options chosen by the fan */
  start: (options: PurchaseOptions) => Promise<CheckoutApiResult>
  /** State of the payment (defaults to GET /payments/status/:id) */
  confirm?: (transactionId: string) => Promise<CheckoutApiResult>
  onSuccess?: () => void
  onCancel?: () => void
  /** Delay before onSuccess, to show the confirmation (ms) */
  successDelay?: number
  /** Render without the summary card title (modals) */
  compact?: boolean
  /** Rendered in the summary card, e.g. the tip amount field */
  summaryExtra?: React.ReactNode
  /** Blocks the payment button (e.g. invalid tip amount) */
  disabled?: boolean
  /** Text under the summary (subscription renewal terms, prorated upgrade...) */
  note?: React.ReactNode
}

/**
 * Checkout of every fan payment: price excluding VAT + VAT of the billing
 * country = total, withdrawal waiver for digital content, saved card or the
 * payment provider's secure page (redirect). Access is only granted once the
 * API confirms the payment.
 */
export default function PaymentCheckout({
  kind,
  amount,
  interval,
  description,
  start,
  confirm,
  onSuccess,
  onCancel,
  successDelay = 2000,
  compact = false,
  summaryExtra,
  disabled = false,
  note,
}: PaymentCheckoutProps) {
  const [step, setStep] = useState<'review' | 'processing' | 'redirecting' | 'success' | 'error'>('review')
  const [selectedMethod, setSelectedMethod] = useState<string | null>(null)
  const [country, setCountry] = useState<string>('FR')
  const [waiver, setWaiver] = useState(false)
  const [showWaiverError, setShowWaiverError] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [paidTotal, setPaidTotal] = useState<number | null>(null)
  const successTimer = useRef<ReturnType<typeof setTimeout>>()

  useEffect(() => {
    const stored = getStoredBillingCountry()
    if (stored) setCountry(stored)
    return () => clearTimeout(successTimer.current)
  }, [])

  const { data: paymentMethods, isLoading: loadingMethods } = usePaymentMethods()
  const method = resolvePaymentMethod(selectedMethod, paymentMethods)

  const labels = LABELS[kind]
  const requiresWaiver = kind !== 'tip'
  const price = priceWithVat(amount, country)
  const period = interval === 'year' ? 'an' : 'mois'
  const formattedTotal = `${formatEuros(price.totalAmount)}${kind === 'subscription' ? `/${period}` : ''}`

  const succeed = (total: number | null) => {
    setPaidTotal(total)
    setStep('success')
    successTimer.current = setTimeout(() => onSuccess?.(), successDelay)
  }

  const fail = (err: any) => {
    setError(typeof err === 'string' ? err : getPaymentErrorMessage(err))
    setStep('error')
  }

  const handleCountryChange = (value: string) => {
    setCountry(value)
    storeBillingCountry(value)
  }

  const handlePay = async () => {
    if (requiresWaiver && !waiver) {
      setShowWaiverError(true)
      return
    }
    setStep('processing')
    setError(null)

    try {
      const raw = await start({
        paymentCardId: method === NEW_CARD ? undefined : method,
        billingCountry: country,
        ...(requiresWaiver && { withdrawalWaiver: true }),
      })
      let result = normalizeCheckoutResult(raw)

      if (result.status === 'requires_redirect' && result.redirectUrl) {
        setStep('redirecting')
        window.location.assign(result.redirectUrl)
        return
      }

      if (!result.done && result.status === 'processing' && result.transactionId) {
        result = await waitForPayment(result.transactionId, confirm)
      }

      if (result.done) {
        succeed(result.totalAmount ?? price.totalAmount)
      } else if (result.status === 'failed') {
        fail(result.failureReason || 'Le paiement a été refusé. Essayez avec une autre carte.')
      } else {
        fail('Le paiement est en cours de traitement. Vous serez notifié dès sa validation.')
      }
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
            {paidTotal ? `Votre paiement de ${formatEuros(paidTotal)} TTC a été effectué. ` : ''}
            {labels.done}
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

  if (step === 'processing' || step === 'redirecting') {
    return (
      <Card className="max-w-md mx-auto w-full">
        <CardContent className="pt-6 text-center">
          <Loader2 className="h-12 w-12 animate-spin mx-auto mb-4 text-primary" />
          <h3 className="text-xl font-bold mb-2">
            {step === 'redirecting' ? 'Redirection vers la page de paiement…' : 'Traitement en cours…'}
          </h3>
          <p className="text-muted-foreground">
            {step === 'redirecting'
              ? 'Vous allez saisir votre carte sur la page sécurisée de notre prestataire de paiement.'
              : 'Veuillez patienter pendant que nous traitons votre paiement.'}
          </p>
        </CardContent>
      </Card>
    )
  }

  return (
    <div className="max-w-md mx-auto w-full space-y-4">
      <Card>
        {!compact && (
          <CardHeader>
            <CardTitle>Récapitulatif</CardTitle>
            <CardDescription>
              {kind === 'subscription' ? 'Abonnement à renouvellement automatique' : 'Paiement unique, sans abonnement'}
            </CardDescription>
          </CardHeader>
        )}
        <CardContent className={compact ? 'pt-6 space-y-4' : 'space-y-4'}>
          <div className="min-w-0">
            <p className="font-medium">{labels.item}</p>
            <p className="text-sm text-muted-foreground break-words">{description}</p>
          </div>
          {summaryExtra}
          <BillingCountrySelect value={country} onChange={handleCountryChange} />
          <PriceBreakdown
            amount={price.amount}
            vatRate={price.vatRate}
            vatAmount={price.vatAmount}
            totalAmount={price.totalAmount}
            country={country}
            suffix={kind === 'subscription' ? `/${period}` : undefined}
          />
          {note && <div className="text-xs text-muted-foreground">{note}</div>}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Méthode de paiement</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <PaymentMethodPicker
            name={`${kind}-payment-method`}
            methods={paymentMethods}
            loading={loadingMethods}
            value={method}
            onChange={setSelectedMethod}
          />
          {!loadingMethods && (
            <Alert>
              <Lock className="h-4 w-4" />
              <AlertDescription className="text-sm">
                {method === NEW_CARD
                  ? 'Vous allez être redirigé vers la page de paiement sécurisée de notre prestataire. Nous ne conservons jamais votre numéro de carte.'
                  : 'Paiement sécurisé. Votre carte enregistrée sera débitée.'}
                {kind === 'subscription' && ' La carte utilisée sera enregistrée pour les renouvellements.'}
              </AlertDescription>
            </Alert>
          )}
        </CardContent>
      </Card>

      {requiresWaiver && (
        <div className="space-y-1">
          <label className="flex items-start gap-3 text-sm cursor-pointer">
            <input
              type="checkbox"
              className="mt-1 h-4 w-4 shrink-0"
              checked={waiver}
              onChange={(e) => {
                setWaiver(e.target.checked)
                setShowWaiverError(false)
              }}
            />
            <span>
              Je demande l’accès immédiat au contenu numérique et je reconnais perdre mon droit de rétractation de 14
              jours dès le début de cet accès (article L221-28 13° du Code de la consommation). J’accepte les{' '}
              <Link href="/legal/cgv" target="_blank" className="underline">
                conditions générales de vente
              </Link>
              .
            </span>
          </label>
          {showWaiverError && (
            <p className="text-sm text-destructive">Cochez cette case pour accéder immédiatement au contenu.</p>
          )}
        </div>
      )}

      <div className="flex flex-col-reverse gap-3 sm:flex-row">
        {onCancel && (
          <Button variant="outline" onClick={onCancel} className="flex-1">
            Annuler
          </Button>
        )}
        <Button onClick={handlePay} className="flex-1" disabled={loadingMethods || disabled}>
          <Lock className="h-4 w-4 mr-2" />
          {kind === 'subscription' ? `S’abonner – ${formattedTotal}` : `Payer ${formattedTotal}`}
        </Button>
      </div>
      <p className="text-xs text-center text-muted-foreground">Prix TTC, TVA de votre pays de résidence incluse.</p>
    </div>
  )
}
