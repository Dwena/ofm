'use client'

import { Suspense, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import { useQuery } from '@tanstack/react-query'
import { paymentsApi } from '@/lib/api'
import { formatEuros } from '@/lib/utils'
import { getPaymentErrorMessage } from '@/lib/payment-errors'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { FlaskConical, Loader2 } from 'lucide-react'

const TEST_CARDS = [
  { last4: '4242', label: '4242 — paiement accepté' },
  { last4: '0002', label: '0002 — paiement refusé' },
  { last4: '3220', label: '3220 — accepté (puis authentification demandée aux achats suivants)' },
]

// Only URLs of this site (the API builds them from WEB_URL)
const sameSite = (value: string | null, fallback: string) => {
  if (!value) return fallback
  try {
    const url = new URL(value, window.location.origin)
    return url.origin === window.location.origin ? url.pathname + url.search : fallback
  } catch {
    return fallback
  }
}

/**
 * Hosted payment page of the payment simulator (PAYMENT_PROVIDER=fake, local
 * development only): stands in for the provider's secure card page.
 */
export default function PaymentSimulatorPage() {
  return (
    <Suspense fallback={<Loader2 className="h-8 w-8 animate-spin mx-auto mt-16 text-muted-foreground" />}>
      <PaymentSimulator />
    </Suspense>
  )
}

function PaymentSimulator() {
  const searchParams = useSearchParams()
  const sessionId = searchParams.get('session') || ''
  const authentication = searchParams.get('authentication') === '1'
  const [last4, setLast4] = useState('4242')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const { data: session, isLoading, error: loadError } = useQuery({
    queryKey: ['payment-simulator', sessionId],
    queryFn: async () => (await paymentsApi.getSimulatorSession(sessionId)).data,
    enabled: !!sessionId,
    retry: false,
  })

  const fallbackReturn = session ? `/checkout/retour?transaction=${session.transactionId}&next=%2Ffeed` : '/feed'

  const finish = async (approve: boolean) => {
    setSubmitting(true)
    setError(null)
    try {
      if (approve) {
        await paymentsApi.approveSimulatorSession(sessionId, authentication ? '4242' : last4)
        window.location.assign(sameSite(searchParams.get('return'), fallbackReturn))
      } else {
        await paymentsApi.cancelSimulatorSession(sessionId)
        window.location.assign(sameSite(searchParams.get('cancel'), `${fallbackReturn}&annule=1`))
      }
    } catch (err) {
      setError(getPaymentErrorMessage(err))
      setSubmitting(false)
    }
  }

  if (isLoading) {
    return <Loader2 className="h-8 w-8 animate-spin mx-auto mt-16 text-muted-foreground" />
  }

  if (!session || loadError) {
    return (
      <Alert variant="destructive" className="max-w-md mx-auto mt-8">
        <AlertDescription>Session de paiement introuvable (le simulateur n’est disponible qu’en développement).</AlertDescription>
      </Alert>
    )
  }

  return (
    <div className="max-w-md mx-auto py-8 space-y-4">
      <Alert>
        <FlaskConical className="h-4 w-4" />
        <AlertDescription>
          Simulateur de paiement (développement) : aucune carte réelle n’est débitée. En production, cette page est
          celle du prestataire de paiement.
        </AlertDescription>
      </Alert>
      <Card>
        <CardHeader>
          <CardTitle>{authentication ? 'Authentification bancaire' : 'Paiement par carte'}</CardTitle>
          <CardDescription>{String(session.description)}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="rounded-lg border bg-muted/50 p-4 text-sm space-y-1">
            <div className="flex justify-between"><span>Prix HT</span><span>{formatEuros(session.amount)}</span></div>
            <div className="flex justify-between"><span>TVA {session.vatRate} %</span><span>{formatEuros(session.vatAmount)}</span></div>
            <div className="flex justify-between font-bold border-t pt-1"><span>Total</span><span>{formatEuros(session.totalAmount)}</span></div>
          </div>
          {!authentication && (
            <div className="space-y-2" role="radiogroup">
              {TEST_CARDS.map((card) => (
                <label key={card.last4} className="flex items-center gap-3 text-sm cursor-pointer">
                  <input type="radio" name="test-card" checked={last4 === card.last4} onChange={() => setLast4(card.last4)} />
                  Carte test •••• {card.label}
                </label>
              ))}
            </div>
          )}
          {error && <p className="text-sm text-destructive">{error}</p>}
          <div className="flex gap-2">
            <Button variant="outline" className="flex-1" disabled={submitting} onClick={() => finish(false)}>
              Annuler
            </Button>
            <Button className="flex-1" disabled={submitting || session.status === 'COMPLETED'} onClick={() => finish(true)}>
              {submitting && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              {authentication ? 'Valider' : `Payer ${formatEuros(session.totalAmount)}`}
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
