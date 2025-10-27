'use client'

import { useSearchParams, useRouter } from 'next/navigation'
import StripeCheckout from '@/components/checkout/stripe-checkout'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { ArrowLeft } from 'lucide-react'

export default function CheckoutPage() {
  const searchParams = useSearchParams()
  const router = useRouter()

  // Get checkout params from URL
  const amount = parseInt(searchParams.get('amount') || '0')
  const description = searchParams.get('description') || 'Paiement'
  const type = (searchParams.get('type') || 'tip') as 'subscription' | 'ppv' | 'tip'
  const itemId = searchParams.get('itemId') || undefined
  const returnUrl = searchParams.get('returnUrl') || '/feed'

  if (!amount || amount <= 0) {
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

      <StripeCheckout
        amount={amount}
        currency="EUR"
        description={description}
        itemType={type}
        itemId={itemId}
        onSuccess={() => {
          router.push(returnUrl)
        }}
        onCancel={() => {
          router.back()
        }}
      />
    </div>
  )
}
