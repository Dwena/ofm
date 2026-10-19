'use client'

import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { subscriptionsApi, usersApi } from '@/lib/api'
import { Card, CardContent, CardHeader, CardTitle, CardFooter } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Search } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useDebounce } from '@/hooks/use-debounce'
import { toast } from '@/hooks/use-toast'
import ChangeTierDialog, {
  type TierSummary,
  formatTierPrice,
  getPendingChangeLabel,
  getTierChangeLabel,
} from '@/components/subscriptions/change-tier-dialog'

interface Creator {
  id: string
  username: string
  displayName?: string
  avatar?: string
  bio?: string
  isFollowing?: boolean
  creatorProfile?: {
    totalSubscribers: number
    totalContent: number
  }
}

interface Subscription {
  id: string
  tierId: string
  status: 'ACTIVE' | 'CANCELLED' | 'EXPIRED' | 'PAST_DUE' | 'PAUSED'
  currentPeriodEnd: string
  cancelAtPeriodEnd: boolean
  stripeSubscriptionId?: string | null
  // Downgrade scheduled for currentPeriodEnd
  pendingTierId?: string | null
  pendingTier?: TierSummary | null
  tier: {
    id: string
    name: string
    price: string | number
    interval: string
    creator: {
      id: string
      username: string
      displayName?: string
      avatar?: string
    }
  }
}

const statusLabels: Record<Subscription['status'], string> = {
  ACTIVE: 'Actif',
  CANCELLED: 'Annulé',
  EXPIRED: 'Expiré',
  PAST_DUE: 'Paiement en échec',
  PAUSED: 'En pause',
}

export default function SubscriptionsPage() {
  const [searchQuery, setSearchQuery] = useState('')
  const debouncedSearch = useDebounce(searchQuery, 300)
  const queryClient = useQueryClient()
  const router = useRouter()
  // Upgrade / downgrade being confirmed
  const [tierChange, setTierChange] = useState<{ subscription: Subscription; tier: TierSummary } | null>(null)

  // Fetch my subscriptions
  const { data: mySubscriptions, isLoading: subsLoading } = useQuery({
    queryKey: ['my-subscriptions'],
    queryFn: async () => {
      const response = await subscriptionsApi.getMySubscriptions()
      return response.data as Subscription[]
    },
  })

  // Discover creators (subscription happens on their profile, where tiers are listed)
  const { data: featuredCreators, isLoading: creatorsLoading } = useQuery({
    queryKey: ['featured-creators', debouncedSearch],
    queryFn: async () => {
      const response = await usersApi.discover({ search: debouncedSearch, limit: 20 })
      return response.data as Creator[]
    },
  })

  const onError = (error: any) => {
    toast({
      title: 'Erreur',
      description: error.response?.data?.message || 'Une erreur est survenue',
      variant: 'destructive',
    })
  }

  const cancelMutation = useMutation({
    mutationFn: (subscriptionId: string) => subscriptionsApi.cancel(subscriptionId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['my-subscriptions'] })
      toast({ title: 'Abonnement annulé' })
    },
    onError,
  })

  const resumeMutation = useMutation({
    mutationFn: (subscriptionId: string) => subscriptionsApi.resume(subscriptionId),
    onSuccess: (response, subscriptionId) => {
      queryClient.invalidateQueries({ queryKey: ['my-subscriptions'] })
      const result = response.data as { requiresPayment: boolean }
      if (result.requiresPayment) {
        // Ended paid subscription: pay again through checkout
        const sub = mySubscriptions?.find((s) => s.id === subscriptionId)
        if (sub) goToCheckout(sub)
        return
      }
      toast({ title: 'Abonnement repris' })
    },
    onError,
  })

  const goToCheckout = (sub: Subscription) => {
    const params = new URLSearchParams({
      type: 'subscription',
      itemId: sub.tierId,
      amount: String(Math.round(Number(sub.tier.price) * 100)),
      description: `${sub.tier.name} - @${sub.tier.creator.username}`,
      returnUrl: '/subscriptions',
    })
    router.push(`/checkout?${params.toString()}`)
  }

  const handleCancel = (sub: Subscription) => {
    const message = sub.stripeSubscriptionId
      ? `Votre abonnement restera actif jusqu'au ${new Date(sub.currentPeriodEnd).toLocaleDateString('fr-FR')}. Confirmer l'annulation ?`
      : 'Confirmer l\'annulation de votre abonnement ?'
    if (window.confirm(message)) {
      cancelMutation.mutate(sub.id)
    }
  }

  const handleResume = (sub: Subscription) => {
    // An ended paid subscription needs a new payment
    if (sub.status !== 'ACTIVE' && Number(sub.tier.price) > 0) {
      goToCheckout(sub)
      return
    }
    resumeMutation.mutate(sub.id)
  }

  const activeCount = mySubscriptions?.filter((sub) => sub.status === 'ACTIVE').length ?? 0

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
            {activeCount > 0 && (
              <Badge className="ml-2" variant="secondary">
                {activeCount}
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
          ) : featuredCreators && featuredCreators.length > 0 ? (
            <div className="grid md:grid-cols-2 gap-6">
              {featuredCreators.map((creator) => (
                <Card key={creator.id}>
                  <CardHeader>
                    <div className="flex items-start space-x-4">
                      <Avatar className="h-16 w-16">
                        <AvatarImage src={creator.avatar} />
                        <AvatarFallback>
                          {(creator.displayName || creator.username).substring(0, 2).toUpperCase()}
                        </AvatarFallback>
                      </Avatar>
                      <div className="flex-1">
                        <div className="flex items-center gap-2">
                          <CardTitle>{creator.displayName || creator.username}</CardTitle>
                          {creator.isFollowing && <Badge variant="success">Abonné</Badge>}
                        </div>
                        <p className="text-sm text-muted-foreground">@{creator.username}</p>
                        {creator.bio && (
                          <p className="text-sm mt-2">{creator.bio}</p>
                        )}
                        <div className="flex items-center space-x-4 mt-2 text-sm text-muted-foreground">
                          <span>{creator.creatorProfile?.totalSubscribers ?? 0} abonnés</span>
                          <span>{creator.creatorProfile?.totalContent ?? 0} contenus</span>
                        </div>
                      </div>
                    </div>
                  </CardHeader>
                  <CardFooter>
                    <Button
                      variant={creator.isFollowing ? 'outline' : 'default'}
                      className="w-full"
                      onClick={() => router.push(`/${creator.username}`)}
                    >
                      {creator.isFollowing ? 'Voir le profil' : 'Voir les offres'}
                    </Button>
                  </CardFooter>
                </Card>
              ))}
            </div>
          ) : (
            <Card>
              <CardContent className="py-12 text-center">
                <p className="text-muted-foreground">Aucun créateur trouvé</p>
              </CardContent>
            </Card>
          )}
        </TabsContent>

        <TabsContent value="my-subscriptions">
          {subsLoading ? (
            <div className="flex justify-center py-12">
              <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary"></div>
            </div>
          ) : mySubscriptions && mySubscriptions.length > 0 ? (
            <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
              {mySubscriptions.map((sub) => {
                const creator = sub.tier.creator
                const isLive = sub.status === 'ACTIVE' || sub.status === 'PAST_DUE'
                const price = Number(sub.tier.price)

                return (
                  <Card key={sub.id}>
                    <CardHeader>
                      <div className="flex items-start space-x-3">
                        <Avatar>
                          <AvatarImage src={creator.avatar} />
                          <AvatarFallback>
                            {(creator.displayName || creator.username).substring(0, 2).toUpperCase()}
                          </AvatarFallback>
                        </Avatar>
                        <div className="flex-1">
                          <CardTitle className="text-base">
                            {creator.displayName || creator.username}
                          </CardTitle>
                          <p className="text-sm text-muted-foreground">@{creator.username}</p>
                        </div>
                      </div>
                    </CardHeader>
                    <CardContent className="space-y-3">
                      <div className="flex items-center justify-between">
                        <span className="text-sm text-muted-foreground">Offre :</span>
                        <Badge variant="outline">
                          {sub.tier.name} · {price === 0 ? 'Gratuit' : `${price.toFixed(2)}€/${sub.tier.interval === 'year' ? 'an' : 'mois'}`}
                        </Badge>
                      </div>
                      <div className="flex items-center justify-between">
                        <span className="text-sm text-muted-foreground">Statut :</span>
                        <Badge
                          variant={
                            sub.status === 'ACTIVE'
                              ? 'success'
                              : sub.status === 'PAST_DUE'
                                ? 'destructive'
                                : 'secondary'
                          }
                        >
                          {sub.status === 'ACTIVE' && sub.pendingTierId
                            ? 'Changement programmé'
                            : sub.status === 'ACTIVE' && sub.cancelAtPeriodEnd
                              ? 'Annulation programmée'
                              : statusLabels[sub.status]}
                        </Badge>
                      </div>
                      {isLive && (
                        <div className="flex items-center justify-between">
                          <span className="text-sm text-muted-foreground">
                            {sub.cancelAtPeriodEnd ? 'Se termine le :' : 'Renouvellement :'}
                          </span>
                          <span className="text-sm">
                            {new Date(sub.currentPeriodEnd).toLocaleDateString('fr-FR')}
                          </span>
                        </div>
                      )}
                      {sub.status === 'ACTIVE' && sub.pendingTierId && (
                        <div className="flex items-center justify-between gap-2 rounded-md bg-muted/50 p-2">
                          <span className="text-sm">{getPendingChangeLabel(sub)}</span>
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => setTierChange({ subscription: sub, tier: sub.tier })}
                          >
                            Conserver {sub.tier.name}
                          </Button>
                        </div>
                      )}
                      {sub.status === 'ACTIVE' && (
                        <OtherTiers
                          subscription={sub}
                          onSelect={(tier) => setTierChange({ subscription: sub, tier })}
                        />
                      )}
                    </CardContent>
                    <CardFooter className="flex space-x-2">
                      <Button
                        variant="outline"
                        className="flex-1"
                        onClick={() => router.push(`/${creator.username}`)}
                      >
                        Voir
                      </Button>
                      {isLive && !sub.cancelAtPeriodEnd ? (
                        <Button
                          variant="ghost"
                          className="flex-1"
                          disabled={cancelMutation.isPending}
                          onClick={() => handleCancel(sub)}
                        >
                          Se désabonner
                        </Button>
                      ) : sub.status !== 'PAST_DUE' ? (
                        <Button
                          className="flex-1"
                          disabled={resumeMutation.isPending}
                          onClick={() => handleResume(sub)}
                        >
                          {sub.status === 'ACTIVE' ? 'Reprendre' : 'Se réabonner'}
                        </Button>
                      ) : null}
                    </CardFooter>
                  </Card>
                )
              })}
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

      <ChangeTierDialog
        subscription={tierChange?.subscription ?? null}
        tier={tierChange?.tier ?? null}
        creatorUsername={tierChange?.subscription.tier.creator.username ?? ''}
        returnUrl="/subscriptions"
        onOpenChange={(open) => !open && setTierChange(null)}
        onChanged={() => {
          queryClient.invalidateQueries({ queryKey: ['my-subscriptions'] })
          if (tierChange) {
            queryClient.invalidateQueries({
              queryKey: ['subscription-status', tierChange.subscription.tier.creator.id],
            })
          }
        }}
      />
    </div>
  )
}

/**
 * The creator's other tiers, offered as upgrade / downgrade targets
 */
function OtherTiers({
  subscription,
  onSelect,
}: {
  subscription: Subscription
  onSelect: (tier: TierSummary) => void
}) {
  const creatorId = subscription.tier.creator.id

  // Same cache as the creator profile tier section
  const { data: tiers } = useQuery({
    queryKey: ['creator-tiers', creatorId],
    queryFn: async () => {
      const response = await subscriptionsApi.getCreatorTiers(creatorId)
      return response.data as TierSummary[]
    },
  })

  const others = tiers?.filter((tier) => tier.id !== subscription.tierId) ?? []
  if (others.length === 0) return null

  return (
    <div className="space-y-2 border-t pt-3">
      <p className="text-sm font-medium">Autres offres</p>
      {others.map((tier) => {
        const isPending = subscription.pendingTierId === tier.id
        return (
          <div key={tier.id} className="flex items-center justify-between gap-2">
            <span className="text-sm">
              {tier.name} <span className="text-muted-foreground">· {formatTierPrice(tier)}</span>
            </span>
            <Button
              size="sm"
              variant="outline"
              disabled={isPending}
              onClick={() => onSelect(tier)}
            >
              {isPending ? 'Programmé' : getTierChangeLabel(subscription, tier)}
            </Button>
          </div>
        )
      })}
    </div>
  )
}
