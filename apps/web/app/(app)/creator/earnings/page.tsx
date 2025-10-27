'use client'

import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { paymentsApi } from '@/lib/api'
import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Alert, AlertDescription } from '@/components/ui/alert'
import {
  DollarSign,
  TrendingUp,
  Clock,
  CheckCircle,
  AlertCircle,
  ExternalLink,
  Loader2,
  Wallet,
  ArrowDownToLine
} from 'lucide-react'
import { formatCurrency, formatDateTime } from '@/lib/utils'
import { useRouter } from 'next/navigation'

export default function CreatorEarningsPage() {
  const [payoutAmount, setPayoutAmount] = useState('')
  const [showPayoutForm, setShowPayoutForm] = useState(false)
  const queryClient = useQueryClient()
  const router = useRouter()

  // Fetch earnings
  const { data: earnings, isLoading: loadingEarnings } = useQuery({
    queryKey: ['creator-earnings'],
    queryFn: async () => {
      const response = await paymentsApi.getCreatorEarnings()
      return response.data
    },
  })

  // Fetch Stripe Connect status
  const { data: connectStatus, isLoading: loadingConnect } = useQuery({
    queryKey: ['stripe-connect-status'],
    queryFn: async () => {
      const response = await paymentsApi.getOnboardingStatus()
      return response.data
    },
  })

  // Fetch payout history
  const { data: payouts, isLoading: loadingPayouts } = useQuery({
    queryKey: ['payouts'],
    queryFn: async () => {
      const response = await paymentsApi.getPayouts()
      return response.data
    },
  })

  // Request payout mutation
  const requestPayoutMutation = useMutation({
    mutationFn: async (amount: number) => {
      const response = await paymentsApi.requestPayout(amount)
      return response.data
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['creator-earnings'] })
      queryClient.invalidateQueries({ queryKey: ['payouts'] })
      setPayoutAmount('')
      setShowPayoutForm(false)
    },
  })

  // Create Stripe Connect account
  const createConnectMutation = useMutation({
    mutationFn: async () => {
      const response = await paymentsApi.createConnectAccount()
      return response.data
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['stripe-connect-status'] })
    },
  })

  // Get onboarding link
  const getOnboardingLinkMutation = useMutation({
    mutationFn: async () => {
      const response = await paymentsApi.getOnboardingLink()
      return response.data
    },
    onSuccess: (data) => {
      if (data.url) {
        window.location.href = data.url
      }
    },
  })

  const handleRequestPayout = () => {
    const amount = parseFloat(payoutAmount)

    if (isNaN(amount) || amount <= 0) {
      alert('Veuillez entrer un montant valide')
      return
    }

    if (earnings && amount > earnings.availableBalance) {
      alert('Le montant demandé dépasse votre solde disponible')
      return
    }

    if (amount < 10) {
      alert('Le montant minimum de retrait est de 10€')
      return
    }

    requestPayoutMutation.mutate(Math.round(amount * 100)) // Convert to cents
  }

  const handleSetupStripe = async () => {
    if (!connectStatus?.accountId) {
      // Create account first
      await createConnectMutation.mutateAsync()
    }
    // Then get onboarding link
    getOnboardingLinkMutation.mutate()
  }

  if (loadingEarnings || loadingConnect) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary mx-auto"></div>
          <p className="mt-4 text-muted-foreground">Chargement...</p>
        </div>
      </div>
    )
  }

  const isStripeConnected = connectStatus?.detailsSubmitted && connectStatus?.chargesEnabled

  return (
    <div className="space-y-6 max-w-5xl mx-auto">
      <div>
        <h1 className="text-3xl font-bold">Revenus & Retraits</h1>
        <p className="text-muted-foreground mt-2">
          Gérez vos revenus et effectuez des retraits
        </p>
      </div>

      {/* Stripe Connect Status */}
      {!isStripeConnected && (
        <Alert>
          <AlertCircle className="h-4 w-4" />
          <AlertDescription className="flex items-center justify-between">
            <div>
              <p className="font-medium mb-1">Configuration requise</p>
              <p className="text-sm">
                Vous devez connecter votre compte Stripe pour recevoir des paiements et effectuer des retraits.
              </p>
            </div>
            <Button
              onClick={handleSetupStripe}
              disabled={createConnectMutation.isPending || getOnboardingLinkMutation.isPending}
            >
              {(createConnectMutation.isPending || getOnboardingLinkMutation.isPending) ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Chargement...
                </>
              ) : (
                <>
                  <ExternalLink className="h-4 w-4 mr-2" />
                  Configurer Stripe
                </>
              )}
            </Button>
          </AlertDescription>
        </Alert>
      )}

      {isStripeConnected && connectStatus?.payoutsEnabled === false && (
        <Alert>
          <Clock className="h-4 w-4" />
          <AlertDescription>
            <p className="font-medium">Compte Stripe en cours de vérification</p>
            <p className="text-sm mt-1">
              Vos retraits seront disponibles une fois votre compte vérifié par Stripe.
            </p>
          </AlertDescription>
        </Alert>
      )}

      {/* Balance Cards */}
      <div className="grid gap-4 md:grid-cols-3">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">
              Solde Disponible
            </CardTitle>
            <Wallet className="h-4 w-4 text-green-600" />
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold text-green-600">
              {formatCurrency(earnings?.availableBalance || 0, 'EUR')}
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              Prêt à être retiré
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">
              En Attente
            </CardTitle>
            <Clock className="h-4 w-4 text-yellow-600" />
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold text-yellow-600">
              {formatCurrency(earnings?.pendingBalance || 0, 'EUR')}
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              En cours de traitement
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">
              Revenus Totaux
            </CardTitle>
            <TrendingUp className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold">
              {formatCurrency(earnings?.totalEarnings || 0, 'EUR')}
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              Depuis le début
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Payout Request */}
      {isStripeConnected && connectStatus?.payoutsEnabled && (
        <Card>
          <CardHeader>
            <CardTitle>Demander un Retrait</CardTitle>
            <CardDescription>
              Retirez vos revenus vers votre compte bancaire
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {!showPayoutForm ? (
              <Button
                onClick={() => setShowPayoutForm(true)}
                disabled={!earnings || earnings.availableBalance < 1000} // Min 10€
                size="lg"
                className="w-full"
              >
                <ArrowDownToLine className="h-4 w-4 mr-2" />
                Demander un Retrait
              </Button>
            ) : (
              <div className="space-y-4">
                <div className="space-y-2">
                  <label className="text-sm font-medium">
                    Montant (€) <span className="text-red-500">*</span>
                  </label>
                  <Input
                    type="number"
                    step="0.01"
                    min="10"
                    max={(earnings?.availableBalance || 0) / 100}
                    placeholder="100.00"
                    value={payoutAmount}
                    onChange={(e) => setPayoutAmount(e.target.value)}
                  />
                  <p className="text-xs text-muted-foreground">
                    Montant minimum: 10€ • Disponible: {formatCurrency(earnings?.availableBalance || 0, 'EUR')}
                  </p>
                </div>

                {requestPayoutMutation.isError && (
                  <Alert variant="destructive">
                    <AlertCircle className="h-4 w-4" />
                    <AlertDescription>
                      {(requestPayoutMutation.error as any)?.response?.data?.message || 'Une erreur est survenue'}
                    </AlertDescription>
                  </Alert>
                )}

                {requestPayoutMutation.isSuccess && (
                  <Alert>
                    <CheckCircle className="h-4 w-4" />
                    <AlertDescription>
                      Votre demande de retrait a été envoyée avec succès. Le virement sera effectué sous 2-5 jours ouvrables.
                    </AlertDescription>
                  </Alert>
                )}

                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    onClick={() => {
                      setShowPayoutForm(false)
                      setPayoutAmount('')
                    }}
                    className="flex-1"
                  >
                    Annuler
                  </Button>
                  <Button
                    onClick={handleRequestPayout}
                    disabled={requestPayoutMutation.isPending}
                    className="flex-1"
                  >
                    {requestPayoutMutation.isPending ? (
                      <>
                        <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                        Traitement...
                      </>
                    ) : (
                      'Confirmer le Retrait'
                    )}
                  </Button>
                </div>
              </div>
            )}

            <div className="text-xs text-muted-foreground space-y-1 pt-2 border-t">
              <p>• Les retraits sont traités sous 2-5 jours ouvrables</p>
              <p>• Aucun frais supplémentaire n'est prélevé</p>
              <p>• Vous recevrez une notification une fois le virement effectué</p>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Payout History */}
      <Card>
        <CardHeader>
          <CardTitle>Historique des Retraits</CardTitle>
          <CardDescription>
            Liste de tous vos retraits effectués
          </CardDescription>
        </CardHeader>
        <CardContent>
          {loadingPayouts ? (
            <div className="text-center py-8">
              <Loader2 className="h-8 w-8 animate-spin mx-auto text-muted-foreground" />
            </div>
          ) : payouts && payouts.length > 0 ? (
            <div className="space-y-2">
              {payouts.map((payout: any) => (
                <div
                  key={payout.id}
                  className="flex items-center justify-between p-4 border rounded-lg"
                >
                  <div className="flex items-center gap-4">
                    <div className="h-10 w-10 rounded-full bg-muted flex items-center justify-center">
                      <ArrowDownToLine className="h-5 w-5 text-muted-foreground" />
                    </div>

                    <div>
                      <p className="font-medium">
                        Retrait #{payout.id.substring(0, 8)}
                      </p>
                      <p className="text-sm text-muted-foreground">
                        {formatDateTime(new Date(payout.createdAt))}
                      </p>
                    </div>
                  </div>

                  <div className="text-right">
                    <p className="text-lg font-bold">
                      -{formatCurrency(Number(payout.amount), payout.currency || 'EUR')}
                    </p>
                    <Badge
                      variant={payout.status === 'COMPLETED' ? 'default' : 'secondary'}
                      className={payout.status === 'COMPLETED' ? 'bg-green-600' : ''}
                    >
                      {payout.status}
                    </Badge>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="text-center py-12">
              <DollarSign className="h-12 w-12 mx-auto mb-4 text-muted-foreground opacity-50" />
              <p className="text-muted-foreground">
                Aucun retrait effectué pour le moment
              </p>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
