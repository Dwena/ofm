'use client'

import { Suspense, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { CreditCard, Plus, Trash2, AlertCircle, Shield, Loader2, ArrowLeft } from 'lucide-react'
import { paymentsApi } from '@/lib/api'
import { getPaymentErrorMessage } from '@/lib/payment-errors'
import { toast } from '@/hooks/use-toast'
import { useConfirm } from '@/hooks/use-confirm'
import StripePaymentElement, {
  isStripeConfigured,
  STRIPE_NOT_CONFIGURED_MESSAGE,
  STRIPE_REDIRECT_PARAMS,
} from '@/components/checkout/stripe-payment-element'
import { usePaymentMethods, type SavedPaymentMethod } from '@/components/checkout/payment-method-picker'

const BRAND_LABELS: Record<string, string> = {
  visa: 'Visa',
  mastercard: 'Mastercard',
  amex: 'American Express',
  discover: 'Discover',
  diners: 'Diners Club',
  jcb: 'JCB',
  unionpay: 'UnionPay',
  cartes_bancaires: 'Carte Bancaire',
}

const getBrandLabel = (brand?: string) => (brand && BRAND_LABELS[brand.toLowerCase()]) || 'Carte bancaire'

// Only same-site paths
const safeReturnUrl = (value: string | null) =>
  value && value.startsWith('/') && !value.startsWith('//') && !value.startsWith('/\\') ? value : null

const isExpired = (method: SavedPaymentMethod) => {
  if (!method.expMonth || !method.expYear) return false
  const now = new Date()
  return method.expYear < now.getFullYear() || (method.expYear === now.getFullYear() && method.expMonth < now.getMonth() + 1)
}

export default function PaymentMethodsPage() {
  return (
    <Suspense
      fallback={
        <div className="flex justify-center py-16">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </div>
      }
    >
      <PaymentMethods />
    </Suspense>
  )
}

function PaymentMethods() {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const queryClient = useQueryClient()
  const { confirm } = useConfirm()
  const stripeReady = isStripeConfigured()
  // e.g. /subscriptions, to pay a past-due subscription with the new card
  const returnUrl = safeReturnUrl(searchParams.get('returnUrl'))
  const [showAddForm, setShowAddForm] = useState(false)
  const handledParams = useRef(false)

  const { data: paymentMethods, isLoading, isError, refetch } = usePaymentMethods()

  const onError = (error: any) => {
    toast({
      title: 'Erreur',
      description: getPaymentErrorMessage(error, 'Une erreur est survenue'),
      variant: 'destructive',
    })
  }

  // Setup intent backing the Stripe Elements form
  const setupIntentMutation = useMutation({
    mutationFn: async () => {
      const response = await paymentsApi.createSetupIntent()
      return response.data as { clientSecret: string }
    },
  })

  const setDefaultMutation = useMutation({
    mutationFn: (paymentMethodId: string) => paymentsApi.setDefaultPaymentMethod(paymentMethodId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['payment-methods'] })
      toast({ title: 'Carte par défaut mise à jour' })
    },
    onError,
  })

  const deleteMutation = useMutation({
    mutationFn: (paymentMethodId: string) => paymentsApi.deletePaymentMethod(paymentMethodId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['payment-methods'] })
      toast({ title: 'Moyen de paiement supprimé' })
    },
    onError,
  })

  const openAddForm = () => {
    setShowAddForm(true)
    if (stripeReady) setupIntentMutation.mutate()
  }

  const closeAddForm = () => {
    setShowAddForm(false)
    setupIntentMutation.reset()
  }

  const cardSaved = () => {
    queryClient.invalidateQueries({ queryKey: ['payment-methods'] })
    toast({
      title: 'Carte ajoutée',
      description: returnUrl
        ? 'Votre carte a été enregistrée. Vous pouvez maintenant l’utiliser pour régler votre paiement.'
        : 'Votre carte a été enregistrée avec succès.',
    })
    if (returnUrl) router.push(returnUrl)
  }

  const handleCardSaved = () => {
    closeAddForm()
    cardSaved()
  }

  // ?add=1 opens the form; back from a Stripe redirect (3D Secure) after saving a card
  useEffect(() => {
    if (handledParams.current) return
    handledParams.current = true

    const redirectStatus = searchParams.get('redirect_status')
    if (searchParams.get('setup_intent') && redirectStatus) {
      const params = new URLSearchParams(searchParams.toString())
      STRIPE_REDIRECT_PARAMS.forEach((param) => params.delete(param))
      router.replace(params.toString() ? `${pathname}?${params.toString()}` : pathname)

      if (redirectStatus === 'succeeded' || redirectStatus === 'processing') {
        cardSaved()
      } else {
        toast({
          title: 'Carte non enregistrée',
          description: 'La vérification de la carte a échoué. Veuillez réessayer.',
          variant: 'destructive',
        })
      }
      return
    }

    if (searchParams.get('add') === '1') openAddForm()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const handleDelete = async (method: SavedPaymentMethod) => {
    const label = `${getBrandLabel(method.brand)} •••• ${method.last4}`
    const ok = await confirm({
      title: 'Supprimer ce moyen de paiement ?',
      description: method.isDefault
        ? `${label} est votre carte par défaut. Vos abonnements payés avec cette carte ne pourront plus être renouvelés tant que vous n'en aurez pas choisi une autre.`
        : `${label} sera retirée de votre compte. Les abonnements payés avec cette carte ne pourront plus être renouvelés avec elle.`,
      confirmText: 'Supprimer',
      variant: 'destructive',
    })
    if (ok) deleteMutation.mutate(method.id)
  }

  const isPendingFor = (mutation: { isPending: boolean; variables?: string }, id: string) =>
    mutation.isPending && mutation.variables === id

  return (
    <div className="space-y-6 max-w-4xl mx-auto">
      <div className="space-y-2">
        <Button asChild variant="ghost" size="sm" className="-ml-2">
          <Link href={returnUrl ?? '/settings'}>
            <ArrowLeft className="h-4 w-4 mr-2" />
            {returnUrl ? 'Retour' : 'Paramètres'}
          </Link>
        </Button>
        <h1 className="text-2xl sm:text-3xl font-bold">Moyens de paiement</h1>
        <p className="text-muted-foreground">Gérez vos cartes bancaires et votre carte par défaut</p>
      </div>

      {stripeReady ? (
        <Alert>
          <Shield className="h-4 w-4" />
          <AlertDescription>
            <p className="font-medium">Paiements sécurisés par Stripe</p>
            <p className="text-sm mt-1">
              Vos informations de paiement sont chiffrées et conservées par Stripe. Nous ne stockons jamais le
              numéro complet de votre carte.
            </p>
          </AlertDescription>
        </Alert>
      ) : (
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>{STRIPE_NOT_CONFIGURED_MESSAGE}</AlertDescription>
        </Alert>
      )}

      {/* Payment Methods List */}
      <div className="space-y-4">
        {isLoading ? (
          <div className="flex justify-center py-12">
            <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
          </div>
        ) : isError ? (
          <Card>
            <CardContent className="py-12 text-center space-y-4">
              <p className="text-muted-foreground">Impossible de charger vos moyens de paiement.</p>
              <Button variant="outline" onClick={() => refetch()}>
                Réessayer
              </Button>
            </CardContent>
          </Card>
        ) : paymentMethods && paymentMethods.length > 0 ? (
          paymentMethods.map((method) => (
            <Card key={method.id}>
              <CardContent className="pt-6">
                <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                  <div className="flex items-center gap-4 min-w-0">
                    <div className="h-12 w-12 shrink-0 rounded-lg bg-muted flex items-center justify-center">
                      <CreditCard className="h-6 w-6 text-muted-foreground" />
                    </div>

                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="font-medium">{getBrandLabel(method.brand)}</p>
                        {method.isDefault && <Badge variant="success">Par défaut</Badge>}
                        {isExpired(method) && <Badge variant="destructive">Expirée</Badge>}
                      </div>
                      <p className="text-sm text-muted-foreground mt-1">
                        •••• {method.last4}
                        {method.expMonth && method.expYear && (
                          <span className="ml-3">
                            Expire {method.expMonth.toString().padStart(2, '0')}/{method.expYear}
                          </span>
                        )}
                      </p>
                    </div>
                  </div>

                  <div className="flex gap-2 sm:justify-end">
                    {!method.isDefault && (
                      <Button
                        variant="outline"
                        size="sm"
                        className="flex-1 sm:flex-none"
                        onClick={() => setDefaultMutation.mutate(method.id)}
                        disabled={setDefaultMutation.isPending || isExpired(method)}
                      >
                        {isPendingFor(setDefaultMutation, method.id) && (
                          <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                        )}
                        Définir par défaut
                      </Button>
                    )}
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => handleDelete(method)}
                      disabled={isPendingFor(deleteMutation, method.id)}
                      aria-label={`Supprimer la carte se terminant par ${method.last4}`}
                    >
                      {isPendingFor(deleteMutation, method.id) ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <Trash2 className="h-4 w-4" />
                      )}
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))
        ) : (
          <Card>
            <CardContent className="py-12 text-center">
              <CreditCard className="h-12 w-12 mx-auto mb-4 text-muted-foreground opacity-50" />
              <p className="text-muted-foreground mb-4">Aucun moyen de paiement enregistré</p>
              {!showAddForm && (
                <Button onClick={openAddForm} disabled={!stripeReady}>
                  <Plus className="h-4 w-4 mr-2" />
                  Ajouter une carte
                </Button>
              )}
            </CardContent>
          </Card>
        )}

        {paymentMethods && paymentMethods.length > 0 && !showAddForm && (
          <Button onClick={openAddForm} className="w-full" disabled={!stripeReady}>
            <Plus className="h-4 w-4 mr-2" />
            Ajouter une carte
          </Button>
        )}
      </div>

      {/* Add Payment Method Form */}
      {showAddForm && (
        <Card>
          <CardHeader>
            <CardTitle>Ajouter une carte</CardTitle>
            <CardDescription>Votre carte est vérifiée et enregistrée par Stripe en toute sécurité</CardDescription>
          </CardHeader>
          <CardContent>
            {!stripeReady ? (
              <Alert variant="destructive">
                <AlertCircle className="h-4 w-4" />
                <AlertDescription>{STRIPE_NOT_CONFIGURED_MESSAGE}</AlertDescription>
              </Alert>
            ) : setupIntentMutation.data?.clientSecret ? (
              <StripePaymentElement
                clientSecret={setupIntentMutation.data.clientSecret}
                mode="setup"
                submitLabel="Enregistrer la carte"
                onSuccess={handleCardSaved}
                onCancel={closeAddForm}
              />
            ) : setupIntentMutation.isError ? (
              <Alert variant="destructive">
                <AlertCircle className="h-4 w-4" />
                <AlertDescription>
                  {getPaymentErrorMessage(
                    setupIntentMutation.error,
                    'Impossible d’initialiser le formulaire de paiement. Veuillez réessayer.',
                  )}
                </AlertDescription>
              </Alert>
            ) : (
              <div className="flex justify-center py-6">
                <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
              </div>
            )}
          </CardContent>
          {(setupIntentMutation.isError || !stripeReady) && (
            <CardFooter className="flex justify-end gap-2">
              <Button variant="outline" onClick={closeAddForm}>
                Annuler
              </Button>
              {stripeReady && (
                <Button onClick={() => setupIntentMutation.mutate()} disabled={setupIntentMutation.isPending}>
                  Réessayer
                </Button>
              )}
            </CardFooter>
          )}
        </Card>
      )}

      {/* Billing History Link */}
      <Card>
        <CardHeader>
          <CardTitle>Historique des paiements</CardTitle>
          <CardDescription>Consultez vos abonnements, pourboires, achats et remboursements</CardDescription>
        </CardHeader>
        <CardFooter>
          <Button asChild variant="outline">
            <Link href="/payments">Voir l'historique complet</Link>
          </Button>
        </CardFooter>
      </Card>
    </div>
  )
}
