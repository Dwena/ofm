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
import { Plus, Edit, Trash2, Users, DollarSign, X, Save, CheckCircle, AlertCircle } from 'lucide-react'

interface SubscriptionTier {
  id: string
  name: string
  description: string
  price: number
  currency: string
  interval: string
  benefits: string[]
  subscribersCount?: number
  isActive: boolean
}

export default function CreatorSubscriptionsPage() {
  const [showForm, setShowForm] = useState(false)
  const [editingTier, setEditingTier] = useState<SubscriptionTier | null>(null)
  const [formData, setFormData] = useState({
    name: '',
    description: '',
    price: '',
    interval: 'month',
    benefits: [''],
    isActive: true,
  })

  const queryClient = useQueryClient()

  // Fetch subscription tiers
  const { data: tiers, isLoading } = useQuery({
    queryKey: ['creator-subscription-tiers'],
    queryFn: async () => {
      const response = await subscriptionsApi.getMyTiers()
      return response.data as SubscriptionTier[]
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

  // Create tier mutation
  const createTierMutation = useMutation({
    mutationFn: async (data: any) => {
      const response = await subscriptionsApi.createTier({
        name: data.name,
        description: data.description,
        price: Math.round(parseFloat(data.price) * 100), // Convert to cents
        currency: 'EUR',
        interval: data.interval,
        benefits: data.benefits.filter((b: string) => b.trim()),
        isActive: data.isActive,
      })
      return response.data
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['creator-subscription-tiers'] })
      resetForm()
    },
  })

  // Update tier mutation
  const updateTierMutation = useMutation({
    mutationFn: async ({ tierId, data }: { tierId: string; data: any }) => {
      const response = await subscriptionsApi.updateTier(tierId, {
        name: data.name,
        description: data.description,
        price: data.price ? Math.round(parseFloat(data.price) * 100) : undefined,
        interval: data.interval,
        benefits: data.benefits?.filter((b: string) => b.trim()),
        isActive: data.isActive,
      })
      return response.data
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['creator-subscription-tiers'] })
      resetForm()
    },
  })

  // Delete tier mutation
  const deleteTierMutation = useMutation({
    mutationFn: async (tierId: string) => {
      await subscriptionsApi.deleteTier(tierId)
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['creator-subscription-tiers'] })
    },
  })

  const resetForm = () => {
    setFormData({
      name: '',
      description: '',
      price: '',
      interval: 'month',
      benefits: [''],
      isActive: true,
    })
    setEditingTier(null)
    setShowForm(false)
  }

  const handleEdit = (tier: SubscriptionTier) => {
    setEditingTier(tier)
    setFormData({
      name: tier.name,
      description: tier.description || '',
      price: (tier.price / 100).toFixed(2),
      interval: tier.interval,
      benefits: tier.benefits.length > 0 ? tier.benefits : [''],
      isActive: tier.isActive,
    })
    setShowForm(true)
  }

  const handleSubmit = () => {
    if (!formData.name || !formData.price) {
      alert('Veuillez remplir tous les champs requis')
      return
    }

    if (editingTier) {
      updateTierMutation.mutate({ tierId: editingTier.id, data: formData })
    } else {
      createTierMutation.mutate(formData)
    }
  }

  const handleDelete = (tier: SubscriptionTier) => {
    if (confirm(`Êtes-vous sûr de vouloir supprimer le tier "${tier.name}" ?`)) {
      deleteTierMutation.mutate(tier.id)
    }
  }

  const addBenefit = () => {
    setFormData(prev => ({
      ...prev,
      benefits: [...prev.benefits, ''],
    }))
  }

  const removeBenefit = (index: number) => {
    setFormData(prev => ({
      ...prev,
      benefits: prev.benefits.filter((_, i) => i !== index),
    }))
  }

  const updateBenefit = (index: number, value: string) => {
    setFormData(prev => ({
      ...prev,
      benefits: prev.benefits.map((b, i) => (i === index ? value : b)),
    }))
  }

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

  const totalRevenue = tiers?.reduce((sum, tier) => sum + (tier.price * (tier.subscribersCount || 0)), 0) || 0

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">Abonnements</h1>
          <p className="text-muted-foreground mt-2">
            Gérez vos tiers d'abonnement et vos abonnés
          </p>
        </div>
        <Button
          onClick={() => setShowForm(true)}
          disabled={showForm}
        >
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
              {tiers?.reduce((sum, tier) => sum + (tier.subscribersCount || 0), 0) || 0}
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

      {/* Create/Edit Form */}
      {showForm && (
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <div>
                <CardTitle>{editingTier ? 'Modifier le Tier' : 'Nouveau Tier'}</CardTitle>
                <CardDescription>
                  Configurez les détails de votre tier d'abonnement
                </CardDescription>
              </div>
              <Button
                variant="ghost"
                size="sm"
                onClick={resetForm}
              >
                <X className="h-4 w-4" />
              </Button>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <label className="text-sm font-medium">
                  Nom du tier <span className="text-red-500">*</span>
                </label>
                <Input
                  placeholder="Basic, Premium, VIP..."
                  value={formData.name}
                  onChange={(e) => setFormData(prev => ({ ...prev, name: e.target.value }))}
                  maxLength={50}
                />
              </div>

              <div className="space-y-2">
                <label className="text-sm font-medium">
                  Prix (€) <span className="text-red-500">*</span>
                </label>
                <Input
                  type="number"
                  step="0.01"
                  min="0"
                  placeholder="9.99"
                  value={formData.price}
                  onChange={(e) => setFormData(prev => ({ ...prev, price: e.target.value }))}
                />
              </div>
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium">Description</label>
              <textarea
                placeholder="Décrivez ce qu'inclut ce tier..."
                value={formData.description}
                onChange={(e) => setFormData(prev => ({ ...prev, description: e.target.value }))}
                maxLength={200}
                className="w-full min-h-[80px] px-3 py-2 text-sm border rounded-md focus:outline-none focus:ring-2 focus:ring-ring resize-none"
              />
            </div>

            <div className="grid md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <label className="text-sm font-medium">Période</label>
                <Select
                  value={formData.interval}
                  onValueChange={(value) => setFormData(prev => ({ ...prev, interval: value }))}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="month">Mensuel</SelectItem>
                    <SelectItem value="year">Annuel</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <label className="text-sm font-medium">Statut</label>
                <Select
                  value={formData.isActive ? 'active' : 'inactive'}
                  onValueChange={(value) => setFormData(prev => ({ ...prev, isActive: value === 'active' }))}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="active">Actif</SelectItem>
                    <SelectItem value="inactive">Inactif</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <label className="text-sm font-medium">Avantages</label>
                <Button variant="outline" size="sm" onClick={addBenefit}>
                  <Plus className="h-3 w-3 mr-1" />
                  Ajouter
                </Button>
              </div>
              <div className="space-y-2">
                {formData.benefits.map((benefit, index) => (
                  <div key={index} className="flex gap-2">
                    <Input
                      placeholder={`Avantage ${index + 1}`}
                      value={benefit}
                      onChange={(e) => updateBenefit(index, e.target.value)}
                      maxLength={100}
                    />
                    {formData.benefits.length > 1 && (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => removeBenefit(index)}
                      >
                        <X className="h-4 w-4" />
                      </Button>
                    )}
                  </div>
                ))}
              </div>
            </div>

            {(createTierMutation.isError || updateTierMutation.isError) && (
              <div className="flex items-center gap-2 text-red-600 text-sm p-3 bg-red-50 rounded-lg">
                <AlertCircle className="h-4 w-4" />
                <span>
                  {(createTierMutation.error as any)?.response?.data?.message ||
                    (updateTierMutation.error as any)?.response?.data?.message ||
                    'Une erreur est survenue'}
                </span>
              </div>
            )}
          </CardContent>
          <CardFooter className="flex justify-end gap-2">
            <Button variant="outline" onClick={resetForm}>
              Annuler
            </Button>
            <Button
              onClick={handleSubmit}
              disabled={createTierMutation.isPending || updateTierMutation.isPending}
            >
              {(createTierMutation.isPending || updateTierMutation.isPending) ? (
                <>
                  <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white mr-2" />
                  Sauvegarde...
                </>
              ) : (
                <>
                  <Save className="h-4 w-4 mr-2" />
                  {editingTier ? 'Modifier' : 'Créer'}
                </>
              )}
            </Button>
          </CardFooter>
        </Card>
      )}

      <Tabs defaultValue="tiers">
        <TabsList>
          <TabsTrigger value="tiers">Tiers d'Abonnement</TabsTrigger>
          <TabsTrigger value="subscribers">Mes Abonnés</TabsTrigger>
        </TabsList>

        <TabsContent value="tiers" className="space-y-4">
          {tiers && tiers.length > 0 ? (
            <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
              {tiers.map((tier) => (
                <Card key={tier.id} className="relative">
                  <div className={`absolute top-0 left-0 right-0 h-1 ${tierColors[tier.name as keyof typeof tierColors] || 'bg-gray-500'}`} />
                  <CardHeader>
                    <div className="flex items-center justify-between">
                      <Badge variant="outline">{tier.name}</Badge>
                      {tier.isActive ? (
                        <Badge variant="default" className="bg-green-600">Actif</Badge>
                      ) : (
                        <Badge variant="secondary">Inactif</Badge>
                      )}
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
                        <p className="text-sm text-muted-foreground">
                          par {tier.interval === 'year' ? 'an' : 'mois'}
                        </p>
                      )}
                    </div>

                    {tier.benefits && tier.benefits.length > 0 && (
                      <div className="space-y-2">
                        <p className="text-sm font-medium">Avantages:</p>
                        <ul className="text-sm space-y-1">
                          {tier.benefits.map((benefit, index) => (
                            <li key={index} className="flex items-start">
                              <CheckCircle className="h-4 w-4 text-green-500 mr-2 flex-shrink-0 mt-0.5" />
                              <span>{benefit}</span>
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}

                    <div className="pt-2 border-t">
                      <div className="flex items-center justify-between text-sm">
                        <span className="text-muted-foreground">Abonnés</span>
                        <span className="font-semibold">{tier.subscribersCount || 0}</span>
                      </div>
                      {tier.price > 0 && (
                        <div className="flex items-center justify-between text-sm mt-1">
                          <span className="text-muted-foreground">Revenus/mois</span>
                          <span className="font-semibold">
                            {((tier.price * (tier.subscribersCount || 0)) / 100).toFixed(2)}€
                          </span>
                        </div>
                      )}
                    </div>
                  </CardContent>
                  <CardFooter className="flex space-x-2">
                    <Button
                      variant="outline"
                      size="sm"
                      className="flex-1"
                      onClick={() => handleEdit(tier)}
                    >
                      <Edit className="h-3 w-3 mr-1" />
                      Modifier
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => handleDelete(tier)}
                      disabled={deleteTierMutation.isPending}
                    >
                      <Trash2 className="h-3 w-3" />
                    </Button>
                  </CardFooter>
                </Card>
              ))}
            </div>
          ) : (
            <Card>
              <CardContent className="py-12 text-center">
                <Users className="h-12 w-12 mx-auto mb-4 text-muted-foreground opacity-50" />
                <p className="text-muted-foreground mb-4">
                  Vous n'avez pas encore créé de tiers d'abonnement
                </p>
                <Button onClick={() => setShowForm(true)}>
                  <Plus className="h-4 w-4 mr-2" />
                  Créer votre premier tier
                </Button>
              </CardContent>
            </Card>
          )}
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
                      <Badge variant="outline">{sub.tier.name}</Badge>
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
