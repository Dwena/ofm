'use client'

import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { subscriptionsApi } from '@/lib/api'
import { Card, CardContent, CardHeader, CardTitle, CardDescription, CardFooter } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Plus, Edit, Trash2, Users, DollarSign } from 'lucide-react'

interface SubscriptionTier {
  id: string
  tier: 'FREE' | 'BASIC' | 'PREMIUM' | 'VIP'
  name: string
  description: string
  price: number
  benefits: string[]
  subscribersCount: number
  isActive: boolean
}

export default function CreatorSubscriptionsPage() {
  const [showCreateForm, setShowCreateForm] = useState(false)
  const [editingTier, setEditingTier] = useState<SubscriptionTier | null>(null)
  const queryClient = useQueryClient()

  // Fetch subscription tiers
  const { data: tiers, isLoading } = useQuery({
    queryKey: ['creator-subscription-tiers'],
    queryFn: async () => {
      // Mock data - replace with actual API call
      return [
        {
          id: '1',
          tier: 'FREE' as const,
          name: 'Gratuit',
          description: 'Accès au contenu de base',
          price: 0,
          benefits: ['Accès au contenu public', 'Notifications'],
          subscribersCount: 1250,
          isActive: true,
        },
        {
          id: '2',
          tier: 'BASIC' as const,
          name: 'Basic',
          description: 'Accès à la plupart du contenu',
          price: 999,
          benefits: ['Tout le contenu FREE', 'Contenu exclusif', 'Messages prioritaires'],
          subscribersCount: 342,
          isActive: true,
        },
        {
          id: '3',
          tier: 'PREMIUM' as const,
          name: 'Premium',
          description: 'Accès complet au contenu premium',
          price: 1999,
          benefits: ['Tout le contenu BASIC', 'Contenu premium', 'Accès anticipé', 'Badge premium'],
          subscribersCount: 156,
          isActive: true,
        },
        {
          id: '4',
          tier: 'VIP' as const,
          name: 'VIP',
          description: 'L\'expérience ultime',
          price: 4999,
          benefits: ['Tout le contenu PREMIUM', 'Contenu VIP exclusif', 'Appels personnalisés', 'Support prioritaire'],
          subscribersCount: 42,
          isActive: true,
        },
      ] as SubscriptionTier[]
    },
  })

  // Fetch subscribers
  const { data: subscribers } = useQuery({
    queryKey: ['creator-subscribers'],
    queryFn: async () => {
      const response = await subscriptionsApi.getMySubscribers()
      return response.data
    },
  })

  const tierColors = {
    FREE: 'bg-gray-500',
    BASIC: 'bg-blue-500',
    PREMIUM: 'bg-purple-500',
    VIP: 'bg-amber-500',
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

  const totalRevenue = tiers?.reduce((sum, tier) => sum + (tier.price * tier.subscribersCount), 0) || 0

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">Abonnements</h1>
          <p className="text-muted-foreground mt-2">
            Gérez vos tiers d'abonnement et vos abonnés
          </p>
        </div>
        <Button onClick={() => setShowCreateForm(true)}>
          <Plus className="h-4 w-4 mr-2" />
          Nouveau Tier
        </Button>
      </div>

      {/* Stats */}
      <div className="grid gap-4 md:grid-cols-3">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">
              Abonnés Totaux
            </CardTitle>
            <Users className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {tiers?.reduce((sum, tier) => sum + tier.subscribersCount, 0) || 0}
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              Tous tiers confondus
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">
              Revenus Mensuels
            </CardTitle>
            <DollarSign className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {(totalRevenue / 100).toFixed(2)}€
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              Revenus récurrents estimés
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">
              Tiers Actifs
            </CardTitle>
            <Badge className="ml-2">{tiers?.filter(t => t.isActive).length || 0}</Badge>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {tiers?.length || 0}
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              Tiers configurés
            </p>
          </CardContent>
        </Card>
      </div>

      <Tabs defaultValue="tiers">
        <TabsList>
          <TabsTrigger value="tiers">Tiers d'Abonnement</TabsTrigger>
          <TabsTrigger value="subscribers">Mes Abonnés</TabsTrigger>
        </TabsList>

        <TabsContent value="tiers" className="space-y-4">
          <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-4">
            {tiers?.map((tier) => (
              <Card key={tier.id} className="relative">
                <div className={`absolute top-0 left-0 right-0 h-1 ${tierColors[tier.tier]}`} />
                <CardHeader>
                  <div className="flex items-center justify-between">
                    <Badge variant="outline">{tier.tier}</Badge>
                    {tier.isActive && <Badge variant="success">Actif</Badge>}
                  </div>
                  <CardTitle className="mt-2">{tier.name}</CardTitle>
                  <CardDescription>{tier.description}</CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div>
                    <p className="text-3xl font-bold">
                      {tier.price === 0 ? 'Gratuit' : `${(tier.price / 100).toFixed(2)}€`}
                    </p>
                    {tier.price > 0 && (
                      <p className="text-sm text-muted-foreground">par mois</p>
                    )}
                  </div>

                  <div className="space-y-2">
                    <p className="text-sm font-medium">Avantages:</p>
                    <ul className="text-sm space-y-1">
                      {tier.benefits.map((benefit, index) => (
                        <li key={index} className="flex items-start">
                          <span className="text-green-500 mr-2">✓</span>
                          <span>{benefit}</span>
                        </li>
                      ))}
                    </ul>
                  </div>

                  <div className="pt-2 border-t">
                    <div className="flex items-center justify-between text-sm">
                      <span className="text-muted-foreground">Abonnés</span>
                      <span className="font-semibold">{tier.subscribersCount}</span>
                    </div>
                    {tier.price > 0 && (
                      <div className="flex items-center justify-between text-sm mt-1">
                        <span className="text-muted-foreground">Revenus/mois</span>
                        <span className="font-semibold">
                          {((tier.price * tier.subscribersCount) / 100).toFixed(2)}€
                        </span>
                      </div>
                    )}
                  </div>
                </CardContent>
                <CardFooter className="flex space-x-2">
                  <Button variant="outline" size="sm" className="flex-1" onClick={() => setEditingTier(tier)}>
                    <Edit className="h-3 w-3 mr-1" />
                    Modifier
                  </Button>
                  {tier.tier !== 'FREE' && (
                    <Button variant="ghost" size="sm">
                      <Trash2 className="h-3 w-3" />
                    </Button>
                  )}
                </CardFooter>
              </Card>
            ))}
          </div>
        </TabsContent>

        <TabsContent value="subscribers">
          <Card>
            <CardHeader>
              <CardTitle>Liste des Abonnés</CardTitle>
              <CardDescription>
                Tous vos abonnés actifs
              </CardDescription>
            </CardHeader>
            <CardContent>
              {subscribers && subscribers.length > 0 ? (
                <div className="space-y-4">
                  {subscribers.map((sub: any) => (
                    <div
                      key={sub.id}
                      className="flex items-center justify-between p-4 border rounded-lg"
                    >
                      <div className="flex items-center space-x-3">
                        <div className="h-10 w-10 rounded-full bg-muted flex items-center justify-center">
                          {sub.subscriber.username.substring(0, 2).toUpperCase()}
                        </div>
                        <div>
                          <p className="font-medium">{sub.subscriber.username}</p>
                          <p className="text-sm text-muted-foreground">
                            Abonné depuis {new Date(sub.createdAt).toLocaleDateString('fr-FR')}
                          </p>
                        </div>
                      </div>
                      <Badge variant="outline">{sub.tier}</Badge>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="text-center py-8 text-muted-foreground">
                  <Users className="h-12 w-12 mx-auto mb-4 opacity-50" />
                  <p>Aucun abonné pour le moment</p>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  )
}
