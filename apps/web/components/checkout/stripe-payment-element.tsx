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

// Load Stripe.js once for the whole app
export function getStripe() {
  if (!stripePromise) {
    const key = process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY
    stripePromise = key ? loadStripe(key) : Promise.resolve(null)
  }
  return stripePromise
}

interface StripePaymentElementProps {
  clientSecret: string
  // 'payment' confirms a PaymentIntent, 'setup' saves a card through a SetupIntent
  mode: 'payment' | 'setup'
  submitLabel: string
  onSuccess: () => void
  onCancel?: () => void
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
}: StripePaymentElementProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const stripeRef = useRef<Stripe | null>(null)
  const elementsRef = useRef<StripeElements | null>(null)
  const [ready, setReady] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let destroyed = false
    let element: PaymentElement | null = null

    getStripe().then((stripe) => {
      if (destroyed || !containerRef.current) return
      if (!stripe) {
        setError('Le paiement est indisponible : clé Stripe manquante.')
        return
      }

      const elements = stripe.elements({ clientSecret, appearance: { theme: 'stripe' } })
      const paymentElement = elements.create('payment')
      paymentElement.on('ready', () => setReady(true))
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

    const confirmParams = { return_url: window.location.href }
    const result =
      mode === 'setup'
        ? await stripe.confirmSetup({ elements, confirmParams, redirect: 'if_required' })
        : await stripe.confirmPayment({ elements, confirmParams, redirect: 'if_required' })

    setSubmitting(false)

    if (result.error) {
      setError(result.error.message || 'Le paiement a échoué.')
      return
    }

    onSuccess()
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

      <div className="flex gap-3">
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
