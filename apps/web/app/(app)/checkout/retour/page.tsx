'use client'

import { Suspense, useEffect, useState } from 'react'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { useQueryClient } from '@tanstack/react-query'
import { paymentsApi } from '@/lib/api'
import { formatEuros } from '@/lib/utils'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { AlertCircle, CheckCircle, Clock, Loader2 } from 'lucide-react'

interface PaymentStatus {
  status: 'completed' | 'processing' | 'requires_redirect' | 'failed'
  completed: boolean
  totalAmount: number
  failureReason: string | null
  kind: string | null
}

// Only same-site paths: never redirect to another origin after paying
const safePath = (value: string | null) =>
  value && value.startsWith('/') && !value.startsWith('//') && !value.startsWith('/\\') ? value : '/feed'

const SUCCESS_TEXT: Record<string, string> = {
  subscription: 'Votre abonnement est actif.',
  content_unlock: 'Le contenu est maintenant accessible.',
  message_unlock: 'Le message est maintenant accessible.',
  stream_access: 'Vous pouvez maintenant regarder le live.',
  tip: 'Merci pour votre soutien !',
}

/**
 * Page the payment provider sends the fan back to:
 * /checkout/retour?transaction=<id>&next=<path>[&annule=1]
 * Waits for the provider's confirmation (webhook), then goes back to `next`.
 */
export default function CheckoutReturnPage() {
  return (
    <Suspense
      fallback={
        <div className="flex justify-center py-16">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </div>
      }
    >
      <CheckoutReturn />
    </Suspense>
  )
}

function CheckoutReturn() {
  const searchParams = useSearchParams()
  const router = useRouter()
  const queryClient = useQueryClient()
  const transactionId = searchParams.get('transaction')
  const next = safePath(searchParams.get('next'))
  const cancelled = searchParams.get('annule') === '1'
  const [payment, setPayment] = useState<PaymentStatus | null>(null)
  const [timedOut, setTimedOut] = useState(false)
  const [error, setError] = useState(false)

  useEffect(() => {
    if (!transactionId || cancelled) return
    let stopped = false

    const poll = async () => {
      for (let attempt = 0; attempt < 20 && !stopped; attempt++) {
        try {
          const { data } = await paymentsApi.getPaymentStatus(transactionId)
          if (stopped) return
          setPayment(data)
          if (data.completed || data.status === 'failed') {
            if (data.completed) {
              // Content, subscriptions and cards changed
              for (const key of ['feed', 'content', 'creator-content', 'live-stream', 'my-subscriptions', 'subscription-status', 'transactions', 'payment-methods', 'messages']) {
                queryClient.invalidateQueries({ queryKey: [key] })
              }
            }
            return
          }
        } catch {
          setError(true)
          return
        }
        await new Promise((resolve) => setTimeout(resolve, 2000))
      }
      if (!stopped) setTimedOut(true)
    }

    poll()
    return () => {
      stopped = true
    }
  }, [transactionId, cancelled, queryClient])

  if (!transactionId || error) {
    return (
      <Status icon="error" title="Paiement introuvable" description="Ce paiement n’existe pas ou ne vous appartient pas.">
        <Button asChild className="flex-1">
          <Link href="/feed">Retour</Link>
        </Button>
      </Status>
    )
  }

  if (cancelled) {
    return (
      <Status icon="error" title="Paiement annulé" description="Aucun montant n’a été débité.">
        <Button asChild className="flex-1">
          <Link href={next}>Retour</Link>
        </Button>
      </Status>
    )
  }

  if (payment?.completed) {
    return (
      <Status
        icon="success"
        title="Paiement effectué"
        description={`${formatEuros(payment.totalAmount)} TTC. ${SUCCESS_TEXT[payment.kind ?? ''] ?? ''}`}
      >
        <Button className="flex-1" onClick={() => router.push(next)}>
          Continuer
        </Button>
      </Status>
    )
  }

  if (payment?.status === 'failed') {
    return (
      <Status
        icon="error"
        title="Paiement refusé"
        description={payment.failureReason || 'Le paiement n’a pas été accepté. Aucun montant n’a été débité.'}
      >
        <Button asChild className="flex-1">
          <Link href={next}>Retour</Link>
        </Button>
      </Status>
    )
  }

  if (timedOut) {
    return (
      <Status
        icon="pending"
        title="Paiement en cours de validation"
        description="Votre banque n’a pas encore confirmé le paiement. Vous recevrez une notification dès qu’il sera validé."
      >
        <Button asChild className="flex-1">
          <Link href={next}>Continuer</Link>
        </Button>
      </Status>
    )
  }

  return (
    <div className="flex flex-col items-center justify-center min-h-[60vh] gap-4 text-center">
      <Loader2 className="h-10 w-10 animate-spin text-primary" />
      <p className="text-muted-foreground">Confirmation de votre paiement…</p>
    </div>
  )
}

function Status({
  icon,
  title,
  description,
  children,
}: {
  icon: 'success' | 'error' | 'pending'
  title: string
  description: string
  children: React.ReactNode
}) {
  const Icon = icon === 'success' ? CheckCircle : icon === 'error' ? AlertCircle : Clock
  const color = icon === 'success' ? 'bg-green-100 text-green-600' : icon === 'error' ? 'bg-red-100 text-red-600' : 'bg-amber-100 text-amber-600'
  return (
    <div className="flex items-center justify-center min-h-[60vh]">
      <Card className="max-w-md w-full">
        <CardContent className="pt-6 text-center">
          <div className={`h-16 w-16 rounded-full mx-auto mb-4 flex items-center justify-center ${color}`}>
            <Icon className="h-8 w-8" />
          </div>
          <h2 className="text-xl font-semibold mb-2">{title}</h2>
          <p className="text-muted-foreground mb-4">{description}</p>
          <div className="flex gap-2">{children}</div>
        </CardContent>
      </Card>
    </div>
  )
}
