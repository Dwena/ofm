'use client'

import { useSearchParams, useRouter } from 'next/navigation'
import { useQueryClient } from '@tanstack/react-query'
import SubscriptionCheckout from '@/components/checkout/subscription-checkout'
import OneTimeCheckout, { type OneTimePaymentResult } from '@/components/checkout/one-time-checkout'
import { contentApi, liveApi, paymentsApi } from '@/lib/api'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { ArrowLeft } from 'lucide-react'

type CheckoutType = 'subscription' | 'ppv' | 'stream' | 'tip'

const CHECKOUT_TYPES: CheckoutType[] = ['subscription', 'ppv', 'stream', 'tip']

/**
 * /checkout?type=subscription|ppv|stream|tip&itemId=...&amount=9.99&description=...&returnUrl=...
 *
 * - amount is in euros (display only for subscriptions and PPV, the API charges its own price)
 * - itemId: tier id (subscription), content id (ppv), stream id (stream), creator id (tip)
 * - tip only: optional `message` and `streamId`
 */
export default function CheckoutPage() {
  const searchParams = useSearchParams()
  const router = useRouter()
  const queryClient = useQueryClient()

  // Get checkout params from URL
  const amount = Number(searchParams.get('amount') || '0')
  const description = searchParams.get('description') || 'Paiement'
  const rawType = searchParams.get('type') as CheckoutType | null
  const type = rawType && CHECKOUT_TYPES.includes(rawType) ? rawType : null
  const itemId = searchParams.get('itemId') || undefined
  const message = searchParams.get('message') || undefined
  const streamId = searchParams.get('streamId') || undefined
  const returnUrl = searchParams.get('returnUrl') || '/feed'
  // Subscription upgraded from a free tier (subscriptions only)
  const changeFrom = searchParams.get('changeFrom') || undefined

  if (!type || !itemId || !Number.isFinite(amount) || amount <= 0) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <Card className="max-w-md">
          <CardContent className="pt-6 text-center">
            <h2 className="text-xl font-semibold mb-2">Paramètres invalides</h2>
            <p className="text-muted-foreground mb-4">
              Les paramètres de paiement sont manquants ou invalides.
            </p>
            <Button onClick={() => router.back()}>
              Retour
            </Button>
          </CardContent>
        </Card>
      </div>
    )
  }

  const done = () => {
    // Content and streams just became accessible
    queryClient.invalidateQueries({ queryKey: ['feed'] })
    queryClient.invalidateQueries({ queryKey: ['creator-content'] })
    queryClient.invalidateQueries({ queryKey: ['live-stream'] })
    router.push(returnUrl)
  }

  const handlers: Record<
    Exclude<CheckoutType, 'subscription'>,
    {
      start: (paymentMethodId?: string) => Promise<OneTimePaymentResult>
      confirm: (paymentIntentId: string) => Promise<OneTimePaymentResult>
    }
  > = {
    ppv: {
      start: async (paymentMethodId) => (await contentApi.unlockPPV(itemId, paymentMethodId)).data,
      confirm: async (paymentIntentId) => (await contentApi.confirmUnlock(itemId, paymentIntentId)).data,
    },
    stream: {
      start: async (paymentMethodId) => (await liveApi.purchase(itemId, paymentMethodId)).data,
      confirm: async (paymentIntentId) => (await liveApi.confirmPurchase(itemId, paymentIntentId)).data,
    },
    tip: {
      start: async (paymentMethodId) =>
        (await paymentsApi.sendTip(itemId, { amount, message, streamId, paymentMethodId })).data,
      confirm: async (paymentIntentId) => (await paymentsApi.confirmTip(itemId, paymentIntentId)).data,
    },
  }

  return (
    <div className="max-w-2xl mx-auto py-8 space-y-6">
      <Button
        variant="ghost"
        onClick={() => router.back()}
        className="mb-4"
      >
        <ArrowLeft className="h-4 w-4 mr-2" />
        Retour
      </Button>

      <div className="text-center mb-8">
        <h1 className="text-3xl font-bold mb-2">Paiement Sécurisé</h1>
        <p className="text-muted-foreground">
          Complétez votre achat en toute sécurité avec Stripe
        </p>
      </div>

      {type === 'subscription' ? (
        <SubscriptionCheckout
          tierId={itemId}
          amount={amount}
          description={description}
          changeFromSubscriptionId={changeFrom}
          onSuccess={() => {
            router.push(returnUrl)
          }}
          onCancel={() => {
            router.back()
          }}
        />
      ) : (
        <OneTimeCheckout
          kind={type}
          amount={amount}
          description={description}
          start={handlers[type].start}
          confirm={handlers[type].confirm}
          onSuccess={done}
          onCancel={() => router.back()}
        />
      )}
    </div>
  )
}
