'use client';

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { paymentsApi } from '@/lib/api';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useToast } from '@/hooks/use-toast';
import { Loader2, Wallet, ArrowDownCircle, CreditCard, Clock, CheckCircle, XCircle, TrendingUp, DollarSign } from 'lucide-react';
import { format } from 'date-fns';
import { fr } from 'date-fns/locale';

export default function WalletPage() {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  // Fetch earnings
  const { data: earnings, isLoading } = useQuery({
    queryKey: ['earnings'],
    queryFn: async () => {
      const response = await paymentsApi.getEarnings();
      return response.data;
    },
  });

  // Fetch payouts
  const { data: payouts } = useQuery({
    queryKey: ['payouts'],
    queryFn: async () => {
      const response = await paymentsApi.getPayouts();
      return response.data;
    },
  });

  // Request payout mutation
  const requestPayoutMutation = useMutation({
    mutationFn: async (amount: number) => {
      const response = await paymentsApi.requestPayout(amount);
      return response.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['earnings'] });
      queryClient.invalidateQueries({ queryKey: ['payouts'] });
      toast({ title: 'Demande envoyée', description: 'Votre demande de retrait a été envoyée.' });
    },
    onError: (error: any) => {
      toast({
        title: 'Erreur',
        description: error.response?.data?.message || 'Impossible de traiter la demande',
        variant: 'destructive',
      });
    },
  });

  const handlePayoutRequest = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    const amount = parseFloat(formData.get('amount') as string);

    if (amount < 50) {
      toast({ title: 'Erreur', description: 'Le montant minimum de retrait est de 50€', variant: 'destructive' });
      return;
    }

    if (amount > (earnings?.available || 0)) {
      toast({ title: 'Erreur', description: 'Montant supérieur au solde disponible', variant: 'destructive' });
      return;
    }

    requestPayoutMutation.mutate(amount);
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <Loader2 className="h-8 w-8 animate-spin" />
      </div>
    );
  }

  const statusIcon = {
    COMPLETED: <CheckCircle className="h-4 w-4 text-green-500" />,
    PENDING: <Clock className="h-4 w-4 text-yellow-500" />,
    FAILED: <XCircle className="h-4 w-4 text-red-500" />,
  };

  return (
    <div className="container max-w-7xl py-8 space-y-6">
      <div>
        <h1 className="text-3xl font-bold flex items-center gap-2">
          <Wallet className="h-8 w-8" />
          Mon Portefeuille
        </h1>
        <p className="text-muted-foreground mt-2">Gérez vos revenus et vos retraits</p>
      </div>

      {/* Balance Cards */}
      <div className="grid md:grid-cols-3 gap-6">
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">Solde disponible</p>
                <p className="text-3xl font-bold text-green-600">
                  {new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR' }).format(earnings?.available || 0)}
                </p>
              </div>
              <div className="h-12 w-12 bg-green-100 rounded-full flex items-center justify-center">
                <DollarSign className="h-6 w-6 text-green-600" />
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">En attente</p>
                <p className="text-3xl font-bold text-yellow-600">
                  {new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR' }).format(earnings?.pending || 0)}
                </p>
              </div>
              <div className="h-12 w-12 bg-yellow-100 rounded-full flex items-center justify-center">
                <Clock className="h-6 w-6 text-yellow-600" />
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">Total des gains</p>
                <p className="text-3xl font-bold">
                  {new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR' }).format(earnings?.total || 0)}
                </p>
              </div>
              <div className="h-12 w-12 bg-primary/10 rounded-full flex items-center justify-center">
                <TrendingUp className="h-6 w-6 text-primary" />
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      <Tabs defaultValue="payout" className="space-y-6">
        <TabsList>
          <TabsTrigger value="payout">Demander un retrait</TabsTrigger>
          <TabsTrigger value="history">Historique des retraits</TabsTrigger>
          <TabsTrigger value="payment-method">Méthode de paiement</TabsTrigger>
        </TabsList>

        {/* Payout Request */}
        <TabsContent value="payout">
          <Card>
            <CardHeader>
              <CardTitle>Demander un retrait</CardTitle>
              <CardDescription>Transférez vos gains vers votre compte bancaire</CardDescription>
            </CardHeader>
            <CardContent>
              <form onSubmit={handlePayoutRequest} className="space-y-4">
                <div>
                  <Label htmlFor="amount">Montant à retirer (€)</Label>
                  <Input
                    id="amount"
                    name="amount"
                    type="number"
                    step="0.01"
                    min="50"
                    max={earnings?.available || 0}
                    placeholder="50.00"
                    required
                  />
                  <p className="text-sm text-muted-foreground mt-1">
                    Montant minimum : 50€ - Maximum disponible : {new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR' }).format(earnings?.available || 0)}
                  </p>
                </div>

                <div className="p-4 bg-muted rounded-lg space-y-2">
                  <p className="text-sm font-medium">Informations importantes :</p>
                  <ul className="text-sm text-muted-foreground space-y-1 list-disc list-inside">
                    <li>Les retraits sont traités sous 3-5 jours ouvrés</li>
                    <li>Aucun frais de retrait appliqué</li>
                    <li>Vous devez avoir un compte Stripe Connect configuré</li>
                  </ul>
                </div>

                <Button type="submit" disabled={requestPayoutMutation.isPending || (earnings?.available || 0) < 50}>
                  {requestPayoutMutation.isPending ? (
                    <>
                      <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                      Traitement...
                    </>
                  ) : (
                    <>
                      <ArrowDownCircle className="h-4 w-4 mr-2" />
                      Demander le retrait
                    </>
                  )}
                </Button>
              </form>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Payout History */}
        <TabsContent value="history">
          <Card>
            <CardHeader>
              <CardTitle>Historique des retraits</CardTitle>
              <CardDescription>Consultez tous vos retraits passés</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                {payouts && payouts.length > 0 ? (
                  payouts.map((payout: any) => (
                    <div key={payout.id} className="flex items-center justify-between p-4 border rounded-lg">
                      <div className="flex items-center gap-4">
                        {statusIcon[payout.status as keyof typeof statusIcon]}
                        <div>
                          <p className="font-medium">
                            {new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR' }).format(payout.amount)}
                          </p>
                          <p className="text-sm text-muted-foreground">
                            {format(new Date(payout.createdAt), 'PPP', { locale: fr })}
                          </p>
                        </div>
                      </div>
                      <Badge variant={payout.status === 'COMPLETED' ? 'default' : payout.status === 'PENDING' ? 'secondary' : 'destructive'}>
                        {payout.status === 'COMPLETED' ? 'Complété' : payout.status === 'PENDING' ? 'En attente' : 'Échoué'}
                      </Badge>
                    </div>
                  ))
                ) : (
                  <div className="text-center py-8">
                    <ArrowDownCircle className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
                    <p className="text-muted-foreground">Aucun retrait pour le moment</p>
                  </div>
                )}
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Payment Method */}
        <TabsContent value="payment-method">
          <Card>
            <CardHeader>
              <CardTitle>Méthode de paiement</CardTitle>
              <CardDescription>Configurez votre compte pour recevoir vos paiements</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="flex items-center justify-between p-4 border rounded-lg">
                <div className="flex items-center gap-3">
                  <CreditCard className="h-5 w-5 text-muted-foreground" />
                  <div>
                    <p className="font-medium">Compte Stripe Connect</p>
                    <p className="text-sm text-muted-foreground">
                      Connectez votre compte bancaire via Stripe
                    </p>
                  </div>
                </div>
                <Button variant="outline" onClick={() => window.open('/api/v1/payments/connect/onboarding-link', '_blank')}>
                  Configurer
                </Button>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
