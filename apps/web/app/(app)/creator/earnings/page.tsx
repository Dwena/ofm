'use client'

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { paymentsApi } from '@/lib/api'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import {
  AlertCircle,
  ArrowDownToLine,
  ArrowRight,
  Calendar,
  CheckCircle,
  Clock,
  DollarSign,
  ExternalLink,
  Loader2,
  RefreshCw,
  TrendingUp,
  Wallet,
} from 'lucide-react'
import { formatDateTime, formatEuros } from '@/lib/utils'
import { useToast } from '@/hooks/use-toast'
import { useConfirm } from '@/hooks/use-confirm'

/** Fallback when the API does not send the platform setting */
const DEFAULT_MINIMUM_PAYOUT = 50

interface Earnings {
  totalEarnings: number
  monthlyEarnings: number
  availableBalance: number
  pendingBalance: number
  totalPayouts: number
  minimumPayoutAmount?: number
  recentTransactions: {
    id: string
    type: string
    status: string
    amount: number
    netAmount: number
    createdAt: string
  }[]
}

interface ConnectStatus {
  stripeConfigured?: boolean
  hasAccount: boolean
  isOnboarded: boolean
  chargesEnabled?: boolean
  payoutsEnabled?: boolean
  detailsSubmitted?: boolean
  error?: string
}

interface Payout {
  id: string
  amount: number
  status: 'PENDING' | 'PROCESSING' | 'COMPLETED' | 'FAILED' | 'CANCELLED'
  destination?: string | null
  failureReason?: string | null
  createdAt: string
  paidAt?: string | null
}

const PAYOUT_STATUS: Record<Payout['status'], { label: string; className: string }> = {
  PENDING: { label: 'En attente', className: 'bg-yellow-100 text-yellow-800 hover:bg-yellow-100' },
  PROCESSING: { label: 'En cours', className: 'bg-blue-100 text-blue-800 hover:bg-blue-100' },
  COMPLETED: { label: 'Versé', className: 'bg-green-600 text-white hover:bg-green-600' },
  FAILED: { label: 'Échoué', className: 'bg-red-100 text-red-800 hover:bg-red-100' },
  CANCELLED: { label: 'Annulé', className: 'bg-muted text-muted-foreground hover:bg-muted' },
}

const TRANSACTION_TYPE: Record<string, string> = {
  SUBSCRIPTION: 'Abonnement',
  TIP: 'Pourboire',
  PPV_UNLOCK: 'Contenu payant',
}

const TRANSACTION_STATUS: Record<string, string> = {
  PENDING: 'En attente',
  PROCESSING: 'En cours',
  COMPLETED: 'Reçu',
  FAILED: 'Échoué',
  REFUNDED: 'Remboursé',
  CANCELLED: 'Annulé',
}

/** Translate the API error (English) into a French message */
function paymentErrorMessage(error: any, fallback: string): string {
  const raw = error?.response?.data?.message
  const message = Array.isArray(raw) ? raw.join(', ') : String(raw ?? '')
  if (/not configured/i.test(message)) return "Les paiements Stripe ne sont pas configurés sur la plateforme."
  if (/insufficient balance/i.test(message)) return 'Solde insuffisant pour ce retrait.'
  if (/minimum payout/i.test(message)) {
    const amount = message.match(/([\d.]+)€/)?.[1]
    return amount ? `Le montant minimum de retrait est de ${formatEuros(amount)}.` : 'Montant inférieur au minimum de retrait.'
  }
  if (/not fully onboarded/i.test(message)) return 'Votre compte Stripe doit être entièrement configuré avant un retrait.'
  if (/already exists/i.test(message)) return 'Un compte Stripe existe déjà pour ce profil.'
  if (!error?.response) return 'Impossible de joindre le serveur. Vérifiez votre connexion.'
  return fallback
}

export default function CreatorEarningsPage() {
  const [payoutAmount, setPayoutAmount] = useState('')
  const [payoutError, setPayoutError] = useState<string | null>(null)
  const queryClient = useQueryClient()
  const router = useRouter()
  const { toast } = useToast()
  const { confirm } = useConfirm()

  const {
    data: earnings,
    isLoading: loadingEarnings,
    isError: earningsError,
    refetch: refetchEarnings,
  } = useQuery<Earnings>({
    queryKey: ['creator-earnings'],
    queryFn: async () => (await paymentsApi.getCreatorEarnings()).data,
  })

  const {
    data: connectStatus,
    isLoading: loadingConnect,
    isError: connectError,
  } = useQuery<ConnectStatus>({
    queryKey: ['stripe-connect-status'],
    queryFn: async () => (await paymentsApi.getOnboardingStatus()).data,
  })

  const {
    data: payouts,
    isLoading: loadingPayouts,
    isError: payoutsError,
  } = useQuery<Payout[]>({
    queryKey: ['payouts'],
    queryFn: async () => (await paymentsApi.getPayouts()).data,
  })

  // Back from Stripe onboarding (?stripe=return) or expired link (?stripe=refresh)
  const stripeReturnHandled = useRef(false)
  useEffect(() => {
    const stripeParam = new URLSearchParams(window.location.search).get('stripe')
    if (!stripeParam || stripeReturnHandled.current) return
    stripeReturnHandled.current = true
    queryClient.invalidateQueries({ queryKey: ['stripe-connect-status'] })
    queryClient.invalidateQueries({ queryKey: ['creator-earnings'] })
    toast(
      stripeParam === 'refresh'
        ? {
            title: 'Lien Stripe expiré',
            description: 'Cliquez à nouveau sur « Configurer mes paiements » pour reprendre la configuration.',
          }
        : { title: 'Retour de Stripe', description: 'Le statut de votre compte de paiement a été actualisé.' },
    )
    router.replace('/creator/earnings')
  }, [queryClient, router, toast])

  const requestPayoutMutation = useMutation({
    mutationFn: async (amount: number) => (await paymentsApi.requestPayout(amount)).data,
    onSuccess: (_data, amount) => {
      queryClient.invalidateQueries({ queryKey: ['creator-earnings'] })
      queryClient.invalidateQueries({ queryKey: ['payouts'] })
      setPayoutAmount('')
      setPayoutError(null)
      toast({
        title: 'Retrait demandé',
        description: `${formatEuros(amount)} seront virés sur votre compte bancaire sous 2 à 5 jours ouvrés.`,
      })
    },
    onError: (error: any) => {
      toast({
        title: 'Retrait impossible',
        description: paymentErrorMessage(error, 'Une erreur est survenue lors de la demande de retrait.'),
        variant: 'destructive',
      })
    },
  })

  // Creates the Connect account if needed, then sends the creator to Stripe
  const onboardingMutation = useMutation({
    mutationFn: async () => {
      if (!connectStatus?.hasAccount) {
        await paymentsApi.createConnectAccount()
      }
      return (await paymentsApi.getOnboardingLink()).data as { url?: string }
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['stripe-connect-status'] })
      if (data?.url) {
        window.location.href = data.url
      } else {
        toast({ title: 'Lien indisponible', description: "Stripe n'a pas renvoyé de lien de configuration.", variant: 'destructive' })
      }
    },
    onError: (error: any) => {
      queryClient.invalidateQueries({ queryKey: ['stripe-connect-status'] })
      toast({
        title: 'Configuration impossible',
        description: paymentErrorMessage(error, "Impossible d'ouvrir la configuration Stripe. Réessayez plus tard."),
        variant: 'destructive',
      })
    },
  })

  const minimumPayout = earnings?.minimumPayoutAmount ?? DEFAULT_MINIMUM_PAYOUT
  const availableBalance = earnings?.availableBalance ?? 0

  const validatePayout = (value: string): string | null => {
    const trimmed = value.trim()
    if (!/^\d+([.,]\d{1,2})?$/.test(trimmed)) return 'Veuillez entrer un montant valide (2 décimales maximum).'
    const amount = Number(trimmed.replace(',', '.'))
    if (amount <= 0) return 'Veuillez entrer un montant valide.'
    if (amount < minimumPayout) return `Le montant minimum de retrait est de ${formatEuros(minimumPayout)}.`
    if (amount > availableBalance) return `Le montant dépasse votre solde disponible (${formatEuros(availableBalance)}).`
    return null
  }

  const handleRequestPayout = async (event: React.FormEvent) => {
    event.preventDefault()
    const error = validatePayout(payoutAmount)
    setPayoutError(error)
    if (error) return

    const amount = Math.round(Number(payoutAmount.replace(',', '.')) * 100) / 100
    const confirmed = await confirm({
      title: 'Confirmer le retrait',
      description: `${formatEuros(amount)} seront virés depuis votre solde Stripe vers votre compte bancaire.`,
      confirmText: 'Retirer',
    })
    if (!confirmed) return
    requestPayoutMutation.mutate(amount)
  }

  if (loadingEarnings || loadingConnect) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <div className="text-center">
          <Loader2 className="h-12 w-12 animate-spin text-primary mx-auto" />
          <p className="mt-4 text-muted-foreground">Chargement...</p>
        </div>
      </div>
    )
  }

  if (earningsError || !earnings) {
    return (
      <div className="max-w-5xl mx-auto py-12 text-center space-y-4">
        <AlertCircle className="h-12 w-12 mx-auto text-destructive" />
        <p className="text-muted-foreground">Impossible de charger vos revenus.</p>
        <Button variant="outline" onClick={() => refetchEarnings()}>
          <RefreshCw className="h-4 w-4 mr-2" />
          Réessayer
        </Button>
      </div>
    )
  }

  const stripeConfigured = connectStatus?.stripeConfigured !== false
  const isOnboarded = !!connectStatus?.isOnboarded
  const canRequestPayout = stripeConfigured && isOnboarded && connectStatus?.payoutsEnabled !== false
  const canWithdraw = availableBalance >= minimumPayout

  const onboardingButton = (label: string, variant: 'default' | 'outline' = 'default') => (
    <Button
      variant={variant}
      onClick={() => onboardingMutation.mutate()}
      disabled={onboardingMutation.isPending}
      className="shrink-0"
    >
      {onboardingMutation.isPending ? (
        <Loader2 className="h-4 w-4 mr-2 animate-spin" />
      ) : (
        <ExternalLink className="h-4 w-4 mr-2" />
      )}
      {label}
    </Button>
  )

  return (
    <div className="space-y-6 max-w-5xl mx-auto">
      <div>
        <h1 className="text-3xl font-bold">Revenus & Retraits</h1>
        <p className="text-muted-foreground mt-2">Gérez vos revenus et effectuez des retraits</p>
      </div>

      {/* Stripe Connect status */}
      {connectError ? (
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertTitle>Statut Stripe indisponible</AlertTitle>
          <AlertDescription>Impossible de vérifier votre compte de paiement pour le moment.</AlertDescription>
        </Alert>
      ) : !stripeConfigured ? (
        <Alert>
          <AlertCircle className="h-4 w-4" />
          <AlertTitle>Paiements non disponibles</AlertTitle>
          <AlertDescription>
            Les paiements Stripe ne sont pas encore configurés sur la plateforme. Vos revenus restent
            comptabilisés ; les retraits seront possibles dès que l&apos;administrateur aura activé Stripe.
          </AlertDescription>
        </Alert>
      ) : !isOnboarded ? (
        <Alert>
          {connectStatus?.detailsSubmitted ? <Clock className="h-4 w-4" /> : <AlertCircle className="h-4 w-4" />}
          <AlertDescription className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="font-medium mb-1">
                {connectStatus?.detailsSubmitted
                  ? 'Compte Stripe en cours de vérification'
                  : connectStatus?.hasAccount
                    ? 'Configuration Stripe à terminer'
                    : 'Configuration requise'}
              </p>
              <p className="text-sm">
                {connectStatus?.detailsSubmitted
                  ? 'Stripe vérifie vos informations. Les retraits seront disponibles une fois le compte validé.'
                  : 'Connectez un compte Stripe pour recevoir vos paiements et effectuer des retraits.'}
              </p>
              {connectStatus?.error && (
                <p className="text-sm text-destructive mt-1">Stripe est momentanément injoignable, le statut affiché peut être ancien.</p>
              )}
            </div>
            {onboardingButton(connectStatus?.detailsSubmitted ? 'Compléter sur Stripe' : 'Configurer mes paiements')}
          </AlertDescription>
        </Alert>
      ) : (
        <Card>
          <CardContent className="pt-6 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-center gap-3">
              <CheckCircle className="h-5 w-5 text-green-600 shrink-0" />
              <div>
                <p className="font-medium">Compte Stripe connecté</p>
                <p className="text-sm text-muted-foreground">
                  {connectStatus?.payoutsEnabled === false
                    ? 'Les virements sont temporairement suspendus par Stripe.'
                    : 'Vous pouvez recevoir des paiements et demander des retraits.'}
                </p>
              </div>
            </div>
            {onboardingButton('Mettre à jour mes informations', 'outline')}
          </CardContent>
        </Card>
      )}

      {/* Balance cards */}
      <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Solde disponible</CardTitle>
            <Wallet className="h-4 w-4 text-green-600" />
          </CardHeader>
          <CardContent>
            <div className="text-xl sm:text-2xl font-bold text-green-600">{formatEuros(availableBalance)}</div>
            <p className="text-xs text-muted-foreground mt-1">
              {isOnboarded
                ? 'Prêt à être retiré'
                : stripeConfigured
                  ? 'Sur votre compte Stripe, une fois configuré'
                  : 'Disponible une fois Stripe activé'}
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">En attente</CardTitle>
            <Clock className="h-4 w-4 text-yellow-600" />
          </CardHeader>
          <CardContent>
            <div className="text-xl sm:text-2xl font-bold text-yellow-600">{formatEuros(earnings.pendingBalance)}</div>
            <p className="text-xs text-muted-foreground mt-1">En cours de traitement par Stripe</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Ce mois-ci</CardTitle>
            <Calendar className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-xl sm:text-2xl font-bold">{formatEuros(earnings.monthlyEarnings)}</div>
            <p className="text-xs text-muted-foreground mt-1">Revenus nets depuis le 1er du mois</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Revenus totaux</CardTitle>
            <TrendingUp className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-xl sm:text-2xl font-bold">{formatEuros(earnings.totalEarnings)}</div>
            <p className="text-xs text-muted-foreground mt-1">
              Depuis le début • {formatEuros(earnings.totalPayouts)} déjà versés
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Payout request */}
      {canRequestPayout && (
        <Card>
          <CardHeader>
            <CardTitle>Demander un retrait</CardTitle>
            <CardDescription>Retirez vos revenus vers votre compte bancaire</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {!canWithdraw && (
              <p className="text-sm text-muted-foreground">
                Votre solde disponible ({formatEuros(availableBalance)}) est inférieur au minimum de retrait (
                {formatEuros(minimumPayout)}).
              </p>
            )}
            <form onSubmit={handleRequestPayout} className="space-y-4" noValidate>
              <div className="space-y-2">
                <Label htmlFor="payout-amount">
                  Montant (€) <span className="text-red-500">*</span>
                </Label>
                <div className="flex gap-2">
                  <Input
                    id="payout-amount"
                    inputMode="decimal"
                    placeholder={minimumPayout.toFixed(2)}
                    value={payoutAmount}
                    disabled={!canWithdraw || requestPayoutMutation.isPending}
                    aria-invalid={!!payoutError}
                    aria-describedby="payout-amount-help"
                    className={payoutError ? 'border-destructive focus-visible:ring-destructive' : undefined}
                    onChange={(e) => {
                      setPayoutAmount(e.target.value)
                      if (payoutError) setPayoutError(validatePayout(e.target.value))
                    }}
                  />
                  <Button
                    type="button"
                    variant="outline"
                    disabled={!canWithdraw || requestPayoutMutation.isPending}
                    onClick={() => {
                      setPayoutAmount(availableBalance.toFixed(2))
                      setPayoutError(null)
                    }}
                  >
                    Tout retirer
                  </Button>
                </div>
                {payoutError ? (
                  <p id="payout-amount-help" className="text-sm text-destructive">
                    {payoutError}
                  </p>
                ) : (
                  <p id="payout-amount-help" className="text-xs text-muted-foreground">
                    Montant minimum : {formatEuros(minimumPayout)} • Disponible : {formatEuros(availableBalance)}
                  </p>
                )}
              </div>

              <Button
                type="submit"
                size="lg"
                className="w-full"
                disabled={!canWithdraw || requestPayoutMutation.isPending}
              >
                {requestPayoutMutation.isPending ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    Traitement...
                  </>
                ) : (
                  <>
                    <ArrowDownToLine className="h-4 w-4 mr-2" />
                    Demander le retrait
                  </>
                )}
              </Button>
            </form>

            <div className="text-xs text-muted-foreground space-y-1 pt-2 border-t">
              <p>• Les retraits sont traités sous 2 à 5 jours ouvrés</p>
              <p>• Aucun frais supplémentaire n&apos;est prélevé</p>
              <p>• Vous recevrez une notification une fois le virement effectué</p>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Recent income */}
      <Card>
        <CardHeader className="flex flex-row items-start justify-between space-y-0 gap-4">
          <div>
            <CardTitle>Derniers revenus</CardTitle>
            <CardDescription>Abonnements, pourboires et contenus payants</CardDescription>
          </div>
          <Button variant="ghost" size="sm" asChild>
            <Link href="/transactions">
              Tout voir
              <ArrowRight className="h-4 w-4 ml-1" />
            </Link>
          </Button>
        </CardHeader>
        <CardContent>
          {earnings.recentTransactions?.length ? (
            <div className="divide-y">
              {earnings.recentTransactions.map((transaction) => (
                <div key={transaction.id} className="flex items-center justify-between gap-4 py-3">
                  <div className="min-w-0">
                    <p className="font-medium">{TRANSACTION_TYPE[transaction.type] ?? transaction.type}</p>
                    <p className="text-sm text-muted-foreground">{formatDateTime(new Date(transaction.createdAt))}</p>
                  </div>
                  <div className="text-right shrink-0">
                    <p
                      className={
                        transaction.status === 'COMPLETED' ? 'font-semibold text-green-600' : 'font-semibold text-muted-foreground'
                      }
                    >
                      +{formatEuros(transaction.netAmount)}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {TRANSACTION_STATUS[transaction.status] ?? transaction.status} • brut {formatEuros(transaction.amount)}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-center text-muted-foreground py-8">Aucun revenu pour le moment</p>
          )}
        </CardContent>
      </Card>

      {/* Payout history */}
      <Card>
        <CardHeader>
          <CardTitle>Historique des retraits</CardTitle>
          <CardDescription>Vos 50 dernières demandes de retrait</CardDescription>
        </CardHeader>
        <CardContent>
          {loadingPayouts ? (
            <div className="text-center py-8">
              <Loader2 className="h-8 w-8 animate-spin mx-auto text-muted-foreground" />
            </div>
          ) : payoutsError ? (
            <p className="text-center text-destructive py-8">Impossible de charger l&apos;historique des retraits.</p>
          ) : payouts && payouts.length > 0 ? (
            <div className="space-y-2">
              {payouts.map((payout) => {
                const status = PAYOUT_STATUS[payout.status] ?? { label: payout.status, className: '' }
                return (
                  <div key={payout.id} className="flex items-center justify-between gap-3 p-3 sm:p-4 border rounded-lg">
                    <div className="flex items-center gap-3 sm:gap-4 min-w-0">
                      <div className="hidden sm:flex h-10 w-10 rounded-full bg-muted items-center justify-center shrink-0">
                        <ArrowDownToLine className="h-5 w-5 text-muted-foreground" />
                      </div>
                      <div className="min-w-0">
                        <p className="font-medium">
                          Retrait{payout.destination ? ` vers •••• ${payout.destination}` : ''}
                        </p>
                        <p className="text-sm text-muted-foreground">
                          Demandé le {formatDateTime(new Date(payout.createdAt))}
                        </p>
                        {payout.status === 'COMPLETED' && payout.paidAt && (
                          <p className="text-xs text-muted-foreground">Versé le {formatDateTime(new Date(payout.paidAt))}</p>
                        )}
                        {payout.status === 'FAILED' && payout.failureReason && (
                          <p className="text-xs text-destructive">{payout.failureReason}</p>
                        )}
                      </div>
                    </div>

                    <div className="text-right shrink-0 space-y-1">
                      <p className="text-lg font-bold">{formatEuros(payout.amount)}</p>
                      <Badge className={status.className}>{status.label}</Badge>
                    </div>
                  </div>
                )
              })}
            </div>
          ) : (
            <div className="text-center py-12">
              <DollarSign className="h-12 w-12 mx-auto mb-4 text-muted-foreground opacity-50" />
              <p className="text-muted-foreground">Aucun retrait effectué pour le moment</p>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
