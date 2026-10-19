'use client'

import { useEffect, useRef, useState } from 'react'
import {
  loadStripe,
  type Stripe,
  type StripeElements,
  type StripePaymentElement as PaymentElement,
} from '@stripe/stripe-js'
import { Button } from '@/components/ui/button'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { AlertCircle, Loader2, Lock } from 'lucide-react'

let stripePromise: Promise<Stripe | null> | null = null

const publishableKey = process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY || ''

/**
 * Whether a real publishable key is set. The local stack ships with a
 * placeholder (pk_test_remplacez_moi) that Stripe.js would reject.
 */
export function isStripeConfigured() {
  return /^pk_(test|live)_[A-Za-z0-9]{20,}$/.test(publishableKey)
}

export const STRIPE_NOT_CONFIGURED_MESSAGE =
  'Les paiements ne sont pas encore configurés sur la plateforme (clé Stripe manquante).'

// Load Stripe.js once for the whole app
export function getStripe() {
  if (!stripePromise) {
    stripePromise = isStripeConfigured()
      ? loadStripe(publishableKey, { locale: 'fr' }).catch(() => null)
      : Promise.resolve(null)
  }
  return stripePromise
}

/**
 * Query params Stripe adds when it comes back from a redirect (3D Secure,
 * bank page) to the return_url, plus our own `returnParams`
 */
export const STRIPE_REDIRECT_PARAMS = [
  'payment_intent',
  'payment_intent_client_secret',
  'setup_intent',
  'setup_intent_client_secret',
  'redirect_status',
]

interface StripePaymentElementProps {
  clientSecret: string
  // 'payment' confirms a PaymentIntent, 'setup' saves a card through a SetupIntent
  mode: 'payment' | 'setup'
  submitLabel: string
  onSuccess: () => void
  onCancel?: () => void
  // Added to the current URL as return_url, to resume the flow after a redirect
  returnParams?: Record<string, string>
}

/**
 * Stripe Payment Element mounted with @stripe/stripe-js (cards only)
 */
export default function StripePaymentElement({
  clientSecret,
  mode,
  submitLabel,
  onSuccess,
  onCancel,
  returnParams,
}: StripePaymentElementProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const stripeRef = useRef<Stripe | null>(null)
  const elementsRef = useRef<StripeElements | null>(null)
  const [ready, setReady] = useState(false)
  const [unavailable, setUnavailable] = useState(!isStripeConfigured())
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let destroyed = false
    let element: PaymentElement | null = null

    getStripe().then((stripe) => {
      if (destroyed || !containerRef.current) return
      if (!stripe) {
        setUnavailable(true)
        return
      }

      const elements = stripe.elements({ clientSecret, appearance: { theme: 'stripe' }, locale: 'fr' })
      const paymentElement = elements.create('payment')
      paymentElement.on('ready', () => setReady(true))
      paymentElement.on('loaderror', (event) => {
        setError(event.error?.message || 'Impossible de charger le formulaire de paiement.')
      })
      paymentElement.mount(containerRef.current)
      element = paymentElement

      stripeRef.current = stripe
      elementsRef.current = elements
    })

    return () => {
      destroyed = true
      element?.destroy()
    }
  }, [clientSecret])

  const handleSubmit = async () => {
    const stripe = stripeRef.current
    const elements = elementsRef.current
    if (!stripe || !elements) return

    setSubmitting(true)
    setError(null)

    // Back to this page after a redirect, without the params of a previous one
    const url = new URL(window.location.href)
    STRIPE_REDIRECT_PARAMS.forEach((param) => url.searchParams.delete(param))
    Object.entries(returnParams ?? {}).forEach(([key, value]) => url.searchParams.set(key, value))
    const confirmParams = { return_url: url.toString() }

    try {
      const result =
        mode === 'setup'
          ? await stripe.confirmSetup({ elements, confirmParams, redirect: 'if_required' })
          : await stripe.confirmPayment({ elements, confirmParams, redirect: 'if_required' })

      if (result.error) {
        setError(result.error.message || 'Le paiement a échoué.')
        return
      }

      onSuccess()
    } catch {
      setError('Le paiement a échoué. Veuillez réessayer.')
    } finally {
      setSubmitting(false)
    }
  }

  if (unavailable) {
    return (
      <div className="space-y-4">
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>{STRIPE_NOT_CONFIGURED_MESSAGE}</AlertDescription>
        </Alert>
        {onCancel && (
          <Button variant="outline" onClick={onCancel} className="w-full">
            Retour
          </Button>
        )}
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <div ref={containerRef} />

      {!ready && !error && (
        <div className="flex justify-center py-6">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      )}

      {error && (
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      <div className="flex flex-col-reverse gap-3 sm:flex-row">
        {onCancel && (
          <Button variant="outline" onClick={onCancel} className="flex-1" disabled={submitting}>
            Annuler
          </Button>
        )}
        <Button onClick={handleSubmit} className="flex-1" disabled={!ready || submitting}>
          {submitting ? (
            <>
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              Traitement...
            </>
          ) : (
            <>
              <Lock className="h-4 w-4 mr-2" />
              {submitLabel}
            </>
          )}
        </Button>
      </div>
    </div>
  )
}
