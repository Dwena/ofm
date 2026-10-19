'use client'

import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Alert, AlertDescription } from '@/components/ui/alert'
import {
  CreditCard,
  Plus,
  Trash2,
  AlertCircle,
  Shield,
  Loader2
} from 'lucide-react'
import { paymentsApi } from '@/lib/api'
import { toast } from '@/hooks/use-toast'
import StripePaymentElement from '@/components/checkout/stripe-payment-element'

interface PaymentMethod {
  id: string
  type: 'card' | 'bank_account'
  brand?: string
  last4: string
  expMonth?: number
  expYear?: number
  isDefault: boolean
  createdAt: string
}

export default function PaymentMethodsPage() {
  const [showAddForm, setShowAddForm] = useState(false)
  const queryClient = useQueryClient()

  const { data: paymentMethods, isLoading } = useQuery({
    queryKey: ['payment-methods'],
    queryFn: async () => {
      const response = await paymentsApi.getPaymentMethods()
      return response.data as PaymentMethod[]
    },
  })

  const onError = (error: any) => {
    toast({
      title: 'Erreur',
      description: error.response?.data?.message || 'Une erreur est survenue',
      variant: 'destructive',
    })
  }

  // Setup intent backing the Stripe Elements form
  const setupIntentMutation = useMutation({
    mutationFn: async () => {
      const response = await paymentsApi.createSetupIntent()
      return response.data as { clientSecret: string }
    },
    onError,
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
    setupIntentMutation.mutate()
  }

  const closeAddForm = () => {
    setShowAddForm(false)
    setupIntentMutation.reset()
  }

  const handleCardSaved = () => {
    closeAddForm()
    queryClient.invalidateQueries({ queryKey: ['payment-methods'] })
    toast({ title: 'Carte ajoutée', description: 'Votre carte a été enregistrée avec succès.' })
  }

  const handleDelete = (paymentMethodId: string) => {
    if (window.confirm('Supprimer ce moyen de paiement ?')) {
      deleteMutation.mutate(paymentMethodId)
    }
  }

  const getCardIcon = (brand?: string) => {
    switch (brand?.toLowerCase()) {
      case 'visa':
        return '💳 Visa'
      case 'mastercard':
        return '💳 Mastercard'
      case 'amex':
        return '💳 American Express'
      default:
        return '💳 Carte'
    }
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary mx-auto"></div>
          <p className="mt-4 text-muted-foreground">Chargement...</p>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-6 max-w-4xl mx-auto">
      <div>
        <h1 className="text-3xl font-bold">Moyens de Paiement</h1>
        <p className="text-muted-foreground mt-2">
          Gérez vos cartes bancaires et méthodes de paiement
        </p>
      </div>

      {/* Security Notice */}
      <Alert>
        <Shield className="h-4 w-4" />
        <AlertDescription>
          <p className="font-medium">Paiements sécurisés par Stripe</p>
          <p className="text-sm mt-1">
            Toutes vos informations de paiement sont cryptées et stockées de manière sécurisée.
            Nous ne stockons jamais les détails complets de votre carte.
          </p>
        </AlertDescription>
      </Alert>

      {/* Payment Methods List */}
      <div className="space-y-4">
        {paymentMethods && paymentMethods.length > 0 ? (
          paymentMethods.map((method) => (
            <Card key={method.id}>
              <CardContent className="pt-6">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-4">
                    <div className="h-12 w-12 rounded-lg bg-muted flex items-center justify-center text-2xl">
                      <CreditCard className="h-6 w-6 text-muted-foreground" />
                    </div>

                    <div>
                      <div className="flex items-center gap-2">
                        <p className="font-medium">
                          {method.type === 'card' ? getCardIcon(method.brand) : 'Compte bancaire'}
                        </p>
                        {method.isDefault && (
                          <Badge variant="default" className="bg-green-600">
                            Par défaut
                          </Badge>
                        )}
                      </div>

                      <p className="text-sm text-muted-foreground mt-1">
                        {method.type === 'card' ? (
                          <>
                            •••• •••• •••• {method.last4}
                            {method.expMonth && method.expYear && (
                              <span className="ml-3">
                                Expire: {method.expMonth.toString().padStart(2, '0')}/{method.expYear}
                              </span>
                            )}
                          </>
                        ) : (
                          `•••• •••• •••• ${method.last4}`
                        )}
                      </p>
                    </div>
                  </div>

                  <div className="flex gap-2">
                    {!method.isDefault && (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setDefaultMutation.mutate(method.id)}
                        disabled={setDefaultMutation.isPending}
                      >
                        Définir par défaut
                      </Button>
                    )}
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => handleDelete(method.id)}
                      disabled={deleteMutation.isPending}
                    >
                      <Trash2 className="h-4 w-4" />
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
              <p className="text-muted-foreground mb-4">
                Aucun moyen de paiement enregistré
              </p>
              <Button onClick={openAddForm}>
                <Plus className="h-4 w-4 mr-2" />
                Ajouter un moyen de paiement
              </Button>
            </CardContent>
          </Card>
        )}

        {paymentMethods && paymentMethods.length > 0 && (
          <Button onClick={openAddForm} className="w-full">
            <Plus className="h-4 w-4 mr-2" />
            Ajouter un Nouveau Moyen de Paiement
          </Button>
        )}
      </div>

      {/* Add Payment Method Form */}
      {showAddForm && (
        <Card>
          <CardHeader>
            <CardTitle>Ajouter un Moyen de Paiement</CardTitle>
            <CardDescription>
              Utilisez Stripe pour ajouter une carte bancaire en toute sécurité
            </CardDescription>
          </CardHeader>
          <CardContent>
            {setupIntentMutation.data?.clientSecret ? (
              <StripePaymentElement
                clientSecret={setupIntentMutation.data.clientSecret}
                mode="setup"
                submitLabel="Ajouter la Carte"
                onSuccess={handleCardSaved}
                onCancel={closeAddForm}
              />
            ) : setupIntentMutation.isError ? (
              <Alert variant="destructive">
                <AlertCircle className="h-4 w-4" />
                <AlertDescription>
                  Impossible d'initialiser le formulaire de paiement. Veuillez réessayer.
                </AlertDescription>
              </Alert>
            ) : (
              <div className="flex justify-center py-6">
                <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
              </div>
            )}
          </CardContent>
          {setupIntentMutation.isError && (
            <CardFooter className="flex justify-end gap-2">
              <Button variant="outline" onClick={closeAddForm}>
                Annuler
              </Button>
              <Button onClick={() => setupIntentMutation.mutate()}>
                Réessayer
              </Button>
            </CardFooter>
          )}
        </Card>
      )}

      {/* Billing History Link */}
      <Card>
        <CardHeader>
          <CardTitle>Historique de Facturation</CardTitle>
          <CardDescription>
            Consultez toutes vos transactions et factures
          </CardDescription>
        </CardHeader>
        <CardFooter>
          <Button variant="outline" onClick={() => window.location.href = '/payments'}>
            Voir l'Historique Complet
          </Button>
        </CardFooter>
      </Card>
    </div>
  )
}
