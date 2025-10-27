'use client'

import { useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import { paymentsApi } from '@/lib/api'
import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Alert, AlertDescription } from '@/components/ui/alert'
import {
  CreditCard,
  Lock,
  CheckCircle,
  AlertCircle,
  Loader2,
  Shield
} from 'lucide-react'

interface StripeCheckoutProps {
  amount: number
  currency?: string
  description: string
  itemType: 'subscription' | 'ppv' | 'tip'
  itemId?: string
  onSuccess?: () => void
  onCancel?: () => void
}

export default function StripeCheckout({
  amount,
  currency = 'EUR',
  description,
  itemType,
  itemId,
  onSuccess,
  onCancel,
}: StripeCheckoutProps) {
  const [step, setStep] = useState<'review' | 'processing' | 'success' | 'error'>('review')

  // Create payment intent
  const createPaymentMutation = useMutation({
    mutationFn: async () => {
      const response = await paymentsApi.createPaymentIntent({ amount, currency })
      return response.data
    },
    onSuccess: (data) => {
      // In production, this would redirect to Stripe Checkout or use Stripe Elements
      // For now, simulate successful payment
      setTimeout(() => {
        setStep('success')
        setTimeout(() => {
          onSuccess?.()
        }, 2000)
      }, 2000)
    },
    onError: () => {
      setStep('error')
    },
  })

  const handleProceedToPayment = () => {
    setStep('processing')
    createPaymentMutation.mutate()
  }

  const formatAmount = (cents: number) => {
    return (cents / 100).toFixed(2)
  }

  const getItemIcon = () => {
    switch (itemType) {
      case 'subscription':
        return '📅'
      case 'ppv':
        return '🔒'
      case 'tip':
        return '💰'
      default:
        return '💳'
    }
  }

  const getItemLabel = () => {
    switch (itemType) {
      case 'subscription':
        return 'Abonnement'
      case 'ppv':
        return 'Contenu Pay-Per-View'
      case 'tip':
        return 'Pourboire'
      default:
        return 'Paiement'
    }
  }

  if (step === 'success') {
    return (
      <Card className="max-w-md mx-auto">
        <CardContent className="pt-6 text-center">
          <div className="h-16 w-16 rounded-full bg-green-100 mx-auto mb-4 flex items-center justify-center">
            <CheckCircle className="h-8 w-8 text-green-600" />
          </div>
          <h3 className="text-xl font-bold mb-2">Paiement Réussi !</h3>
          <p className="text-muted-foreground">
            Votre paiement de {formatAmount(amount)}€ a été effectué avec succès.
          </p>
          <p className="text-sm text-muted-foreground mt-2">
            Vous allez être redirigé...
          </p>
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
          <p className="text-muted-foreground mb-4">
            Une erreur est survenue lors du traitement de votre paiement.
          </p>
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
          <p className="text-sm text-muted-foreground mt-2">
            Ne fermez pas cette fenêtre.
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
          <CardDescription>
            Vérifiez les détails avant de procéder au paiement
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between p-4 border rounded-lg bg-muted/50">
            <div className="flex items-center gap-3">
              <span className="text-2xl">{getItemIcon()}</span>
              <div>
                <p className="font-medium">{getItemLabel()}</p>
                <p className="text-sm text-muted-foreground">{description}</p>
              </div>
            </div>
            <div className="text-right">
              <p className="text-2xl font-bold">{formatAmount(amount)}€</p>
              <Badge variant="outline" className="text-xs">
                {currency}
              </Badge>
            </div>
          </div>

          <div className="space-y-2 pt-2 border-t">
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">Sous-total</span>
              <span>{formatAmount(amount)}€</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">Frais de traitement</span>
              <span>0.00€</span>
            </div>
            <div className="flex justify-between font-bold text-lg pt-2 border-t">
              <span>Total</span>
              <span>{formatAmount(amount)}€</span>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Payment Method */}
      <Card>
        <CardHeader>
          <CardTitle>Méthode de Paiement</CardTitle>
        </CardHeader>
        <CardContent>
          <Alert>
            <Shield className="h-4 w-4" />
            <AlertDescription>
              <p className="font-medium mb-2">Paiement sécurisé par Stripe</p>
              <p className="text-sm">
                Dans un environnement de production, cette section afficherait Stripe Elements
                pour saisir les informations de carte de manière sécurisée.
              </p>
              <div className="mt-4 p-4 border rounded-lg bg-muted/50">
                <div className="flex items-center gap-2 mb-3">
                  <CreditCard className="h-5 w-5" />
                  <span className="font-medium">Carte bancaire</span>
                </div>
                <div className="space-y-2 text-sm">
                  <div className="flex items-center gap-2 text-muted-foreground">
                    <Lock className="h-3 w-3" />
                    <span>Paiement sécurisé SSL</span>
                  </div>
                  <div className="flex gap-2">
                    <span>💳 Visa</span>
                    <span>💳 Mastercard</span>
                    <span>💳 Amex</span>
                  </div>
                </div>
              </div>
            </AlertDescription>
          </Alert>
        </CardContent>
      </Card>

      {/* Actions */}
      <div className="flex gap-3">
        <Button
          variant="outline"
          onClick={onCancel}
          className="flex-1"
          disabled={createPaymentMutation.isPending}
        >
          Annuler
        </Button>
        <Button
          onClick={handleProceedToPayment}
          className="flex-1"
          disabled={createPaymentMutation.isPending}
        >
          {createPaymentMutation.isPending ? (
            <>
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              Traitement...
            </>
          ) : (
            <>
              <Lock className="h-4 w-4 mr-2" />
              Payer {formatAmount(amount)}€
            </>
          )}
        </Button>
      </div>

      {/* Security Notice */}
      <p className="text-xs text-center text-muted-foreground">
        En cliquant sur "Payer", vous acceptez nos conditions d'utilisation et notre politique de confidentialité.
        Votre paiement est sécurisé et crypté.
      </p>
    </div>
  )
}
