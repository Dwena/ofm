'use client'

import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { subscriptionsApi, usersApi } from '@/lib/api'
import { Card, CardContent, CardHeader, CardTitle, CardDescription, CardFooter } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Search, Check, X } from 'lucide-react'
import { useRouter } from 'next/navigation'

interface Creator {
  id: string
  username: string
  displayName?: string
  profilePicture?: string
  bio?: string
  subscribersCount: number
  contentCount: number
  tiers: SubscriptionTier[]
}

interface SubscriptionTier {
  id: string
  tier: string
  name: string
  description: string
  price: number
  benefits: string[]
}

interface Subscription {
  id: string
  tier: string
  status: string
  currentPeriodEnd: string
  creator: {
    id: string
    username: string
    displayName?: string
    profilePicture?: string
  }
}

export default function SubscriptionsPage() {
  const [searchQuery, setSearchQuery] = useState('')
  const queryClient = useQueryClient()
  const router = useRouter()

  // Fetch my subscriptions
  const { data: mySubscriptions, isLoading: subsLoading } = useQuery({
    queryKey: ['my-subscriptions'],
    queryFn: async () => {
      const response = await subscriptionsApi.getMySubscriptions()
      return response.data as Subscription[]
    },
  })

  // Fetch featured creators (mock - replace with actual API)
  const { data: featuredCreators, isLoading: creatorsLoading } = useQuery({
    queryKey: ['featured-creators', searchQuery],
    queryFn: async () => {
      // Mock data - replace with actual API call
      return [
        {
          id: '1',
          username: 'creator1',
          displayName: 'Amazing Creator',
          profilePicture: undefined,
          bio: 'Creating awesome content daily',
          subscribersCount: 1250,
          contentCount: 450,
          tiers: [
            {
              id: '1',
              tier: 'BASIC',
              name: 'Basic',
              description: 'Access to basic content',
              price: 999,
              benefits: ['Exclusive content', 'Priority messages'],
            },
            {
              id: '2',
              tier: 'PREMIUM',
              name: 'Premium',
              description: 'Full access',
              price: 1999,
              benefits: ['All BASIC benefits', 'Premium content', 'Early access'],
            },
          ],
        },
        {
          id: '2',
          username: 'creator2',
          displayName: 'Top Creator',
          profilePicture: undefined,
          bio: 'Premium content creator',
          subscribersCount: 2400,
          contentCount: 890,
          tiers: [
            {
              id: '3',
              tier: 'BASIC',
              name: 'Supporter',
              description: 'Support my work',
              price: 499,
              benefits: ['Behind the scenes', 'Exclusive updates'],
            },
          ],
        },
      ] as Creator[]
    },
  })

  const subscribeMutation = useMutation({
    mutationFn: async ({ creatorId, tierId }: { creatorId: string; tierId: string }) => {
      // Replace with actual API call
      return { success: true }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['my-subscriptions'] })
    },
  })

  const unsubscribeMutation = useMutation({
    mutationFn: async (subscriptionId: string) => {
      // Replace with actual API call
      return { success: true }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['my-subscriptions'] })
    },
  })

  const tierColors = {
    FREE: 'bg-gray-500',
    BASIC: 'bg-blue-500',
    PREMIUM: 'bg-purple-500',
    VIP: 'bg-amber-500',
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold">Abonnements</h1>
        <p className="text-muted-foreground mt-2">
          Gérez vos abonnements et découvrez de nouveaux créateurs
        </p>
      </div>

      <Tabs defaultValue="discover">
        <TabsList>
          <TabsTrigger value="discover">Découvrir</TabsTrigger>
          <TabsTrigger value="my-subscriptions">
            Mes Abonnements
            {mySubscriptions && mySubscriptions.length > 0 && (
              <Badge className="ml-2" variant="secondary">
                {mySubscriptions.length}
              </Badge>
            )}
          </TabsTrigger>
        </TabsList>

        <TabsContent value="discover" className="space-y-4">
          {/* Search */}
          <Card>
            <CardContent className="pt-6">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="Rechercher des créateurs..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="pl-10"
                />
              </div>
            </CardContent>
          </Card>

          {/* Featured Creators */}
          {creatorsLoading ? (
            <div className="flex justify-center py-12">
              <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary"></div>
            </div>
          ) : (
            <div className="grid md:grid-cols-2 gap-6">
              {featuredCreators?.map((creator) => (
                <Card key={creator.id}>
                  <CardHeader>
                    <div className="flex items-start space-x-4">
                      <Avatar className="h-16 w-16">
                        <AvatarImage src={creator.profilePicture} />
                        <AvatarFallback>
                          {creator.displayName?.substring(0, 2).toUpperCase() || creator.username.substring(0, 2).toUpperCase()}
                        </AvatarFallback>
                      </Avatar>
                      <div className="flex-1">
                        <CardTitle>{creator.displayName || creator.username}</CardTitle>
                        <p className="text-sm text-muted-foreground">@{creator.username}</p>
                        {creator.bio && (
                          <p className="text-sm mt-2">{creator.bio}</p>
                        )}
                        <div className="flex items-center space-x-4 mt-2 text-sm text-muted-foreground">
                          <span>{creator.subscribersCount} abonnés</span>
                          <span>{creator.contentCount} contenus</span>
                        </div>
                      </div>
                    </div>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    <p className="text-sm font-medium">Tiers d'abonnement:</p>
                    {creator.tiers.map((tier) => (
                      <div
                        key={tier.id}
                        className="flex items-center justify-between p-3 border rounded-lg"
                      >
                        <div className="flex-1">
                          <div className="flex items-center space-x-2">
                            <div className={`h-2 w-2 rounded-full ${tierColors[tier.tier as keyof typeof tierColors]}`} />
                            <span className="font-medium">{tier.name}</span>
                            <Badge variant="outline" className="text-xs">
                              {tier.tier}
                            </Badge>
                          </div>
                          <p className="text-sm text-muted-foreground mt-1">
                            {tier.description}
                          </p>
                          <div className="mt-2 space-y-1">
                            {tier.benefits.slice(0, 2).map((benefit, index) => (
                              <p key={index} className="text-xs flex items-center">
                                <Check className="h-3 w-3 text-green-500 mr-1" />
                                {benefit}
                              </p>
                            ))}
                          </div>
                        </div>
                        <div className="ml-4 text-right">
                          <p className="text-lg font-bold">
                            {(tier.price / 100).toFixed(2)}€
                          </p>
                          <p className="text-xs text-muted-foreground">/ mois</p>
                          <Button
                            size="sm"
                            className="mt-2"
                            onClick={() => subscribeMutation.mutate({ creatorId: creator.id, tierId: tier.id })}
                          >
                            S'abonner
                          </Button>
                        </div>
                      </div>
                    ))}
                  </CardContent>
                  <CardFooter>
                    <Button
                      variant="outline"
                      className="w-full"
                      onClick={() => router.push(`/creator/${creator.username}`)}
                    >
                      Voir le profil
                    </Button>
                  </CardFooter>
                </Card>
              ))}
            </div>
          )}
        </TabsContent>

        <TabsContent value="my-subscriptions">
          {subsLoading ? (
            <div className="flex justify-center py-12">
              <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary"></div>
            </div>
          ) : mySubscriptions && mySubscriptions.length > 0 ? (
            <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
              {mySubscriptions.map((sub) => (
                <Card key={sub.id}>
                  <CardHeader>
                    <div className="flex items-start space-x-3">
                      <Avatar>
                        <AvatarImage src={sub.creator.profilePicture} />
                        <AvatarFallback>
                          {sub.creator.displayName?.substring(0, 2).toUpperCase() || sub.creator.username.substring(0, 2).toUpperCase()}
                        </AvatarFallback>
                      </Avatar>
                      <div className="flex-1">
                        <CardTitle className="text-base">
                          {sub.creator.displayName || sub.creator.username}
                        </CardTitle>
                        <p className="text-sm text-muted-foreground">@{sub.creator.username}</p>
                      </div>
                    </div>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    <div className="flex items-center justify-between">
                      <span className="text-sm text-muted-foreground">Tier:</span>
                      <Badge variant="outline">{sub.tier}</Badge>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-sm text-muted-foreground">Status:</span>
                      <Badge variant={sub.status === 'ACTIVE' ? 'success' : 'secondary'}>
                        {sub.status}
                      </Badge>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-sm text-muted-foreground">Renouvellement:</span>
                      <span className="text-sm">
                        {new Date(sub.currentPeriodEnd).toLocaleDateString('fr-FR')}
                      </span>
                    </div>
                  </CardContent>
                  <CardFooter className="flex space-x-2">
                    <Button
                      variant="outline"
                      className="flex-1"
                      onClick={() => router.push(`/creator/${sub.creator.username}`)}
                    >
                      Voir
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => unsubscribeMutation.mutate(sub.id)}
                    >
                      <X className="h-4 w-4" />
                    </Button>
                  </CardFooter>
                </Card>
              ))}
            </div>
          ) : (
            <Card>
              <CardContent className="py-12 text-center">
                <p className="text-muted-foreground">
                  Vous n'avez aucun abonnement actif
                </p>
                <p className="text-sm text-muted-foreground mt-2">
                  Découvrez des créateurs et abonnez-vous à leur contenu
                </p>
              </CardContent>
            </Card>
          )}
        </TabsContent>
      </Tabs>
    </div>
  )
}
