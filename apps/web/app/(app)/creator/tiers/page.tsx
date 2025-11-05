'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { subscriptionsApi } from '@/lib/api';
import { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Badge } from '@/components/ui/badge';
import { useToast } from '@/hooks/use-toast';
import { Loader2, Plus, Edit, Trash2, Users, DollarSign, Check } from 'lucide-react';

export default function SubscriptionTiersPage() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [editingTier, setEditingTier] = useState<any>(null);

  const { data: tiers, isLoading } = useQuery({
    queryKey: ['subscription-tiers'],
    queryFn: async () => {
      const response = await subscriptionsApi.getCreatorTiers();
      return response.data;
    },
  });

  const createTierMutation = useMutation({
    mutationFn: async (data: any) => {
      const response = await subscriptionsApi.createTier(data);
      return response.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['subscription-tiers'] });
      setIsDialogOpen(false);
      toast({ title: 'Palier créé', description: 'Le palier a été créé avec succès.' });
    },
  });

  const updateTierMutation = useMutation({
    mutationFn: async ({ id, data }: any) => {
      const response = await subscriptionsApi.updateTier(id, data);
      return response.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['subscription-tiers'] });
      setIsDialogOpen(false);
      setEditingTier(null);
      toast({ title: 'Palier mis à jour', description: 'Les modifications ont été enregistrées.' });
    },
  });

  const deleteTierMutation = useMutation({
    mutationFn: async (id: string) => {
      const response = await subscriptionsApi.deleteTier(id);
      return response.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['subscription-tiers'] });
      toast({ title: 'Palier supprimé', description: 'Le palier a été supprimé avec succès.' });
    },
  });

  const handleSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);

    const data = {
      name: formData.get('name'),
      description: formData.get('description'),
      price: parseFloat(formData.get('price') as string),
      interval: formData.get('interval'),
      benefits: (formData.get('benefits') as string).split('\n').filter(Boolean),
    };

    if (editingTier) {
      updateTierMutation.mutate({ id: editingTier.id, data });
    } else {
      createTierMutation.mutate(data);
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <Loader2 className="h-8 w-8 animate-spin" />
      </div>
    );
  }

  return (
    <div className="container max-w-7xl py-8 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">Paliers d'abonnement</h1>
          <p className="text-muted-foreground mt-2">Gérez vos offres d'abonnement</p>
        </div>
        <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
          <DialogTrigger asChild>
            <Button onClick={() => setEditingTier(null)}>
              <Plus className="h-4 w-4 mr-2" />
              Nouveau palier
            </Button>
          </DialogTrigger>
          <DialogContent className="sm:max-w-[500px]">
            <form onSubmit={handleSubmit}>
              <DialogHeader>
                <DialogTitle>{editingTier ? 'Modifier le palier' : 'Créer un palier'}</DialogTitle>
                <DialogDescription>
                  Définissez les détails de votre palier d'abonnement
                </DialogDescription>
              </DialogHeader>
              <div className="space-y-4 py-4">
                <div>
                  <Label htmlFor="name">Nom du palier *</Label>
                  <Input
                    id="name"
                    name="name"
                    defaultValue={editingTier?.name}
                    placeholder="Bronze, Silver, Gold..."
                    required
                  />
                </div>

                <div>
                  <Label htmlFor="description">Description</Label>
                  <Textarea
                    id="description"
                    name="description"
                    defaultValue={editingTier?.description}
                    placeholder="Décrivez ce que les abonnés obtiendront..."
                    rows={3}
                  />
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <Label htmlFor="price">Prix (€) *</Label>
                    <Input
                      id="price"
                      name="price"
                      type="number"
                      step="0.01"
                      min="0"
                      defaultValue={editingTier?.price}
                      placeholder="9.99"
                      required
                    />
                  </div>

                  <div>
                    <Label htmlFor="interval">Intervalle</Label>
                    <Select name="interval" defaultValue={editingTier?.interval || 'MONTH'}>
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="MONTH">Mensuel</SelectItem>
                        <SelectItem value="YEAR">Annuel</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>

                <div>
                  <Label htmlFor="benefits">Avantages (un par ligne)</Label>
                  <Textarea
                    id="benefits"
                    name="benefits"
                    defaultValue={editingTier?.benefits?.join('\n')}
                    placeholder="Accès à tout le contenu&#10;Messages privés illimités&#10;Badge exclusif"
                    rows={5}
                  />
                </div>
              </div>
              <DialogFooter>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => {
                    setIsDialogOpen(false);
                    setEditingTier(null);
                  }}
                >
                  Annuler
                </Button>
                <Button
                  type="submit"
                  disabled={createTierMutation.isPending || updateTierMutation.isPending}
                >
                  {(createTierMutation.isPending || updateTierMutation.isPending) && (
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  )}
                  {editingTier ? 'Mettre à jour' : 'Créer'}
                </Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
      </div>

      {/* Tiers Grid */}
      <div className="grid md:grid-cols-3 gap-6">
        {tiers && tiers.length > 0 ? (
          tiers.map((tier: any) => (
            <Card key={tier.id} className={tier.isActive ? '' : 'opacity-60'}>
              <CardHeader>
                <div className="flex items-start justify-between">
                  <div>
                    <CardTitle className="flex items-center gap-2">
                      {tier.name}
                      {tier.isDefault && <Badge variant="secondary">Défaut</Badge>}
                    </CardTitle>
                    <CardDescription className="mt-2">
                      {tier.description || 'Aucune description'}
                    </CardDescription>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="flex items-baseline gap-1">
                  <span className="text-4xl font-bold">
                    {new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR' }).format(tier.price)}
                  </span>
                  <span className="text-muted-foreground">/{tier.interval === 'MONTH' ? 'mois' : 'an'}</span>
                </div>

                <div className="flex items-center gap-4 text-sm text-muted-foreground">
                  <div className="flex items-center gap-1">
                    <Users className="h-4 w-4" />
                    <span>{tier.subscriberCount || 0} abonnés</span>
                  </div>
                  <div className="flex items-center gap-1">
                    <DollarSign className="h-4 w-4" />
                    <span>{tier.monthlyRevenue || 0}€/mois</span>
                  </div>
                </div>

                {tier.benefits && tier.benefits.length > 0 && (
                  <div className="space-y-2 pt-4 border-t">
                    {tier.benefits.map((benefit: string, index: number) => (
                      <div key={index} className="flex items-start gap-2 text-sm">
                        <Check className="h-4 w-4 text-green-500 mt-0.5 flex-shrink-0" />
                        <span>{benefit}</span>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
              <CardFooter className="flex gap-2">
                <Button
                  variant="outline"
                  className="flex-1"
                  onClick={() => {
                    setEditingTier(tier);
                    setIsDialogOpen(true);
                  }}
                >
                  <Edit className="h-4 w-4 mr-2" />
                  Modifier
                </Button>
                <Button
                  variant="destructive"
                  onClick={() => {
                    if (confirm('Êtes-vous sûr de vouloir supprimer ce palier ?')) {
                      deleteTierMutation.mutate(tier.id);
                    }
                  }}
                  disabled={deleteTierMutation.isPending}
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </CardFooter>
            </Card>
          ))
        ) : (
          <Card className="col-span-full">
            <CardContent className="flex flex-col items-center justify-center py-12">
              <Users className="h-12 w-12 text-muted-foreground mb-4" />
              <p className="text-lg font-medium">Aucun palier d'abonnement</p>
              <p className="text-sm text-muted-foreground mt-2 mb-4">
                Créez votre premier palier pour commencer à monétiser votre contenu
              </p>
              <Button onClick={() => setIsDialogOpen(true)}>
                <Plus className="h-4 w-4 mr-2" />
                Créer un palier
              </Button>
            </CardContent>
          </Card>
        )}
      </div>

      {/* Tips Section */}
      <Card>
        <CardHeader>
          <CardTitle>Conseils pour optimiser vos paliers</CardTitle>
        </CardHeader>
        <CardContent>
          <ul className="space-y-2 text-sm text-muted-foreground">
            <li>• Offrez au moins 3 paliers différents pour couvrir différents budgets</li>
            <li>• Décrivez clairement les avantages de chaque palier</li>
            <li>• Proposez des avantages exclusifs pour les paliers premium</li>
            <li>• Mettez à jour régulièrement vos offres en fonction des retours</li>
            <li>• Considérez une réduction pour les abonnements annuels</li>
          </ul>
        </CardContent>
      </Card>
    </div>
  );
}
