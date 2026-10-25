'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { subscriptionsApi, socialApi } from '@/lib/api'
import { formatEuros } from '@/lib/utils'
import { getPaymentErrorMessage } from '@/lib/payment-errors'
import { Card, CardContent, CardHeader, CardTitle, CardFooter } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { AlertTriangle, Compass, Loader2 } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { toast } from '@/hooks/use-toast'
import { useConfirm } from '@/hooks/use-confirm'
import ChangeTierDialog, {
  type TierSummary,
  formatDate,
  formatTierPrice,
  getPendingChangeLabel,
  getTierChangeLabel,
} from '@/components/subscriptions/change-tier-dialog'
import RetryPaymentDialog from '@/components/subscriptions/retry-payment-dialog'

interface Creator {
  id: string
  username: string
  displayName?: string
  avatar?: string
  bio?: string
  isSubscribed?: boolean
  followersCount?: number
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
  cancelledAt?: string | null
  cancelAtPeriodEnd: boolean
  createdAt: string
  // Saved card renewing a paid subscription
  paymentCardId?: string | null
  // Downgrade scheduled for currentPeriodEnd
  pendingTierId?: string | null
  pendingTier?: TierSummary | null
  tier: {
    id: string
    name: string
    price: string | number
    interval: string
    isActive?: boolean
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

const RETURN_URL = '/subscriptions'

const isLive = (sub: Subscription) => sub.status === 'ACTIVE' || sub.status === 'PAST_DUE'

const getCreatorName = (creator: { username: string; displayName?: string }) =>
  creator.displayName || creator.username

function Spinner() {
  return (
    <div className="flex justify-center py-12">
      <Loader2 className="h-10 w-10 animate-spin text-muted-foreground" />
    </div>
  )
}

function EmptyState({ title, description }: { title: string; description: string }) {
  return (
    <Card>
      <CardContent className="py-12 text-center space-y-4">
        <div>
          <p className="text-muted-foreground">{title}</p>
          <p className="text-sm text-muted-foreground mt-2">{description}</p>
        </div>
        <Button asChild variant="outline">
          <Link href="/discover">
            <Compass className="h-4 w-4 mr-2" />
            Découvrir des créateurs
          </Link>
        </Button>
      </CardContent>
    </Card>
  )
}

function CreatorHeader({ creator }: { creator: Subscription['tier']['creator'] }) {
  return (
    <Link href={`/${creator.username}`} className="flex items-center gap-3 min-w-0 group">
      <Avatar>
        <AvatarImage src={creator.avatar} />
        <AvatarFallback>{getCreatorName(creator).substring(0, 2).toUpperCase()}</AvatarFallback>
      </Avatar>
      <div className="min-w-0">
        <CardTitle className="text-base truncate group-hover:underline">{getCreatorName(creator)}</CardTitle>
        <p className="text-sm text-muted-foreground truncate">@{creator.username}</p>
      </div>
    </Link>
  )
}

export default function SubscriptionsPage() {
  const queryClient = useQueryClient()
  const router = useRouter()
  const { confirm } = useConfirm()
  // Upgrade / downgrade being confirmed
  const [tierChange, setTierChange] = useState<{ subscription: Subscription; tier: TierSummary } | null>(null)
  const [retrying, setRetrying] = useState<Subscription | null>(null)

  const {
    data: mySubscriptions,
    isLoading: subsLoading,
    isError: subsError,
    refetch: refetchSubs,
  } = useQuery({
    queryKey: ['my-subscriptions'],
    queryFn: async () => {
      const response = await subscriptionsApi.getMySubscriptions()
      return response.data as Subscription[]
    },
  })

  // Creators followed for free (Follow table)
  const {
    data: following,
    isLoading: followingLoading,
    isError: followingError,
    refetch: refetchFollowing,
  } = useQuery({
    queryKey: ['following'],
    queryFn: async () => {
      const response = await socialApi.getFollowing()
      return (response.data as { items: Creator[]; total: number }).items
    },
  })

  const refreshSubscriptions = (creatorId?: string) => {
    queryClient.invalidateQueries({ queryKey: ['my-subscriptions'] })
    queryClient.invalidateQueries({ queryKey: ['feed'] })
    if (creatorId) {
      queryClient.invalidateQueries({ queryKey: ['subscription-status', creatorId] })
    }
  }

  const onError = (error: any) => {
    toast({
      title: 'Erreur',
      description: getPaymentErrorMessage(error, 'Une erreur est survenue'),
      variant: 'destructive',
    })
  }

  const unfollowMutation = useMutation({
    mutationFn: (creatorId: string) => socialApi.unfollowCreator(creatorId),
    onSuccess: (_response, creatorId) => {
      queryClient.invalidateQueries({ queryKey: ['following'] })
      queryClient.invalidateQueries({ queryKey: ['follow-status', creatorId] })
      toast({ title: 'Vous ne suivez plus ce créateur' })
    },
    onError,
  })

  const cancelMutation = useMutation({
    mutationFn: (sub: Subscription) => subscriptionsApi.cancel(sub.id),
    onSuccess: (response, sub) => {
      refreshSubscriptions(sub.tier.creator.id)
      const updated = response.data as Partial<Subscription> | undefined
      toast({
        title: 'Abonnement annulé',
        description:
          updated?.status === 'ACTIVE' && updated?.cancelAtPeriodEnd
            ? `Vous gardez l'accès jusqu'au ${formatDate(sub.currentPeriodEnd)}.`
            : undefined,
      })
    },
    onError,
  })

  const goToCheckout = (sub: Subscription) => {
    const params = new URLSearchParams({
      type: 'subscription',
      itemId: sub.tierId,
      description: `${sub.tier.name} - @${sub.tier.creator.username}`,
      returnUrl: RETURN_URL,
    })
    router.push(`/checkout?${params.toString()}`)
  }

  const resumeMutation = useMutation({
    mutationFn: (sub: Subscription) => subscriptionsApi.resume(sub.id),
    onSuccess: (response, sub) => {
      refreshSubscriptions(sub.tier.creator.id)
      const result = response.data as { requiresPayment: boolean }
      if (result.requiresPayment) {
        // Ended paid subscription: pay again through checkout
        goToCheckout(sub)
        return
      }
      toast({ title: sub.status === 'ACTIVE' ? 'Abonnement repris' : 'Vous êtes de nouveau abonné' })
    },
    onError,
  })

  const handleCancel = async (sub: Subscription) => {
    const creatorName = getCreatorName(sub.tier.creator)
    const paidPeriod = Number(sub.tier.price) > 0 && sub.status === 'ACTIVE'
    const description = paidPeriod
      ? `Vous ne serez plus débité. Votre abonnement ${sub.tier.name} reste actif jusqu'au ${formatDate(sub.currentPeriodEnd)}, puis vous perdrez l'accès au contenu réservé de ${creatorName}.` +
        (sub.pendingTierId ? ' Le changement d\'offre programmé sera annulé.' : '')
      : sub.status === 'PAST_DUE'
        ? `Le paiement en retard ne sera pas relancé et votre accès au contenu réservé de ${creatorName} prendra fin immédiatement.`
        : `Votre accès au contenu réservé de ${creatorName} prendra fin immédiatement.`

    const ok = await confirm({
      title: `Se désabonner de ${creatorName} ?`,
      description,
      confirmText: 'Se désabonner',
      cancelText: 'Garder mon abonnement',
      variant: 'destructive',
    })
    if (ok) cancelMutation.mutate(sub)
  }

  const handleResubscribe = (sub: Subscription) => {
    // An ended paid subscription needs a new payment
    if (sub.status !== 'ACTIVE' && Number(sub.tier.price) > 0) {
      goToCheckout(sub)
      return
    }
    resumeMutation.mutate(sub)
  }

  const subscriptions = mySubscriptions ?? []
  const active = subscriptions.filter(isLive)
  const pastDue = active.filter((sub) => sub.status === 'PAST_DUE')
  const history = subscriptions.filter((sub) => !isLive(sub))
  // Creators with a live subscription cannot be subscribed to again
  const liveCreatorIds = new Set(active.map((sub) => sub.tier.creator.id))

  const isPendingFor = (mutation: { isPending: boolean; variables?: Subscription }, sub: Subscription) =>
    mutation.isPending && mutation.variables?.id === sub.id

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold">Abonnements</h1>
          <p className="text-muted-foreground mt-2">Gérez vos abonnements et les créateurs que vous suivez</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button asChild variant="outline">
            <Link href="/payments">Historique des paiements</Link>
          </Button>
          <Button asChild>
            <Link href="/discover">
              <Compass className="h-4 w-4 mr-2" />
              Découvrir
            </Link>
          </Button>
        </div>
      </div>

      {pastDue.map((sub) => (
        <Alert key={sub.id} variant="destructive">
          <AlertTriangle className="h-4 w-4" />
          <AlertTitle>Paiement en échec</AlertTitle>
          <AlertDescription className="space-y-3">
            <p>
              Le renouvellement de votre abonnement {sub.tier.name} chez {getCreatorName(sub.tier.creator)} (
              {formatEuros(sub.tier.price)}) n'a pas pu être débité. Mettez à jour votre moyen de paiement pour
              conserver votre accès.
            </p>
            <div className="flex flex-wrap gap-2">
              <Button size="sm" onClick={() => setRetrying(sub)}>
                Mettre à jour le moyen de paiement
              </Button>
              <Button size="sm" variant="outline" asChild>
                <Link href={`/settings/payment-methods?returnUrl=${encodeURIComponent(RETURN_URL)}`}>
                  Gérer mes cartes
                </Link>
              </Button>
            </div>
          </AlertDescription>
        </Alert>
      ))}

      <Tabs defaultValue="active">
        <TabsList className="w-full sm:w-auto">
          <TabsTrigger value="active" className="flex-1 sm:flex-none">
            Actifs
            {active.length > 0 && (
              <Badge className="ml-2" variant="secondary">
                {active.length}
              </Badge>
            )}
          </TabsTrigger>
          <TabsTrigger value="following" className="flex-1 sm:flex-none">
            Suivis
            {following && following.length > 0 && (
              <Badge className="ml-2" variant="secondary">
                {following.length}
              </Badge>
            )}
          </TabsTrigger>
          <TabsTrigger value="history" className="flex-1 sm:flex-none">
            Historique
          </TabsTrigger>
        </TabsList>

        <TabsContent value="active">
          {subsLoading ? (
            <Spinner />
          ) : subsError ? (
            <ErrorCard onRetry={() => refetchSubs()} />
          ) : active.length > 0 ? (
            <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
              {active.map((sub) => {
                const price = Number(sub.tier.price)
                const isFree = price === 0
                const scheduledEnd = sub.cancelAtPeriodEnd && !sub.pendingTierId

                return (
                  <Card key={sub.id} className="flex flex-col">
                    <CardHeader>
                      <CreatorHeader creator={sub.tier.creator} />
                    </CardHeader>
                    <CardContent className="space-y-3 flex-1">
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-sm text-muted-foreground">Offre</span>
                        <Badge variant="outline">
                          {sub.tier.name} · {formatTierPrice(sub.tier)}
                        </Badge>
                      </div>
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-sm text-muted-foreground">Statut</span>
                        <Badge
                          variant={
                            sub.status === 'PAST_DUE' ? 'destructive' : scheduledEnd ? 'secondary' : 'success'
                          }
                        >
                          {sub.status === 'ACTIVE' && sub.pendingTierId
                            ? 'Changement programmé'
                            : sub.status === 'ACTIVE' && scheduledEnd
                              ? 'Annulation programmée'
                              : statusLabels[sub.status]}
                        </Badge>
                      </div>
                      {!isFree && sub.status === 'ACTIVE' && (
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-sm text-muted-foreground">
                            {scheduledEnd ? 'Se termine le' : 'Renouvellement le'}
                          </span>
                          <span className="text-sm">{formatDate(sub.currentPeriodEnd)}</span>
                        </div>
                      )}
                      {isFree && (
                        <p className="text-sm text-muted-foreground">Offre gratuite, sans engagement</p>
                      )}
                      {sub.status === 'PAST_DUE' && (
                        <p className="text-sm text-destructive">
                          Le dernier renouvellement n'a pas pu être débité.
                        </p>
                      )}
                      {sub.status === 'ACTIVE' && sub.pendingTierId && (
                        <div className="flex flex-wrap items-center justify-between gap-2 rounded-md bg-muted/50 p-2">
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
                      {sub.status === 'ACTIVE' && !scheduledEnd && (
                        <OtherTiers
                          subscription={sub}
                          onSelect={(tier) => setTierChange({ subscription: sub, tier })}
                        />
                      )}
                    </CardContent>
                    <CardFooter className="flex flex-wrap gap-2">
                      <Button asChild variant="outline" className="flex-1">
                        <Link href={`/${sub.tier.creator.username}`}>Voir le profil</Link>
                      </Button>
                      {sub.status === 'PAST_DUE' && (
                        <Button className="flex-1" onClick={() => setRetrying(sub)}>
                          Régler le paiement
                        </Button>
                      )}
                      {scheduledEnd ? (
                        <Button
                          className="flex-1"
                          disabled={isPendingFor(resumeMutation, sub)}
                          onClick={() => resumeMutation.mutate(sub)}
                        >
                          {isPendingFor(resumeMutation, sub) && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                          Reprendre
                        </Button>
                      ) : (
                        <Button
                          variant="ghost"
                          className="flex-1"
                          disabled={isPendingFor(cancelMutation, sub)}
                          onClick={() => handleCancel(sub)}
                        >
                          {isPendingFor(cancelMutation, sub) && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                          Se désabonner
                        </Button>
                      )}
                    </CardFooter>
                  </Card>
                )
              })}
            </div>
          ) : (
            <EmptyState
              title="Vous n'avez aucun abonnement actif"
              description="Abonnez-vous à vos créateurs préférés depuis leur profil pour accéder à leur contenu exclusif"
            />
          )}
        </TabsContent>

        <TabsContent value="following">
          {followingLoading ? (
            <Spinner />
          ) : followingError ? (
            <ErrorCard onRetry={() => refetchFollowing()} />
          ) : following && following.length > 0 ? (
            <div className="grid md:grid-cols-2 gap-4">
              {following.map((creator) => (
                <Card key={creator.id}>
                  <CardHeader>
                    <Link href={`/${creator.username}`} className="flex items-start gap-4 group">
                      <Avatar className="h-16 w-16">
                        <AvatarImage src={creator.avatar} />
                        <AvatarFallback>{getCreatorName(creator).substring(0, 2).toUpperCase()}</AvatarFallback>
                      </Avatar>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <CardTitle className="group-hover:underline">{getCreatorName(creator)}</CardTitle>
                          {(creator.isSubscribed || liveCreatorIds.has(creator.id)) && (
                            <Badge variant="success">Abonné</Badge>
                          )}
                        </div>
                        <p className="text-sm text-muted-foreground">@{creator.username}</p>
                        {creator.bio && <p className="text-sm mt-2 line-clamp-2">{creator.bio}</p>}
                        <div className="flex items-center gap-4 mt-2 text-sm text-muted-foreground">
                          <span>{creator.followersCount ?? 0} followers</span>
                          <span>{creator.creatorProfile?.totalContent ?? 0} contenus</span>
                        </div>
                      </div>
                    </Link>
                  </CardHeader>
                  <CardFooter className="flex flex-wrap gap-2">
                    <Button asChild className="flex-1">
                      <Link href={`/${creator.username}`}>
                        {creator.isSubscribed || liveCreatorIds.has(creator.id) ? 'Voir le profil' : 'Voir les offres'}
                      </Link>
                    </Button>
                    <Button
                      variant="outline"
                      onClick={() => unfollowMutation.mutate(creator.id)}
                      disabled={unfollowMutation.isPending && unfollowMutation.variables === creator.id}
                    >
                      {unfollowMutation.isPending && unfollowMutation.variables === creator.id && (
                        <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                      )}
                      Ne plus suivre
                    </Button>
                  </CardFooter>
                </Card>
              ))}
            </div>
          ) : (
            <EmptyState
              title="Vous ne suivez encore aucun créateur"
              description="Suivez gratuitement vos créateurs préférés depuis leur profil"
            />
          )}
        </TabsContent>

        <TabsContent value="history">
          {subsLoading ? (
            <Spinner />
          ) : subsError ? (
            <ErrorCard onRetry={() => refetchSubs()} />
          ) : history.length > 0 ? (
            <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
              {history.map((sub) => {
                const endedAt = sub.status === 'CANCELLED' && sub.cancelledAt ? sub.cancelledAt : sub.currentPeriodEnd
                const canResubscribe = !liveCreatorIds.has(sub.tier.creator.id) && sub.tier.isActive !== false

                return (
                  <Card key={sub.id} className="flex flex-col">
                    <CardHeader>
                      <CreatorHeader creator={sub.tier.creator} />
                    </CardHeader>
                    <CardContent className="space-y-3 flex-1">
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-sm text-muted-foreground">Offre</span>
                        <Badge variant="outline">
                          {sub.tier.name} · {formatTierPrice(sub.tier)}
                        </Badge>
                      </div>
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-sm text-muted-foreground">Statut</span>
                        <Badge variant="secondary">{statusLabels[sub.status]}</Badge>
                      </div>
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-sm text-muted-foreground">Abonné du</span>
                        <span className="text-sm">
                          {formatDate(sub.createdAt)} au {formatDate(endedAt)}
                        </span>
                      </div>
                      {liveCreatorIds.has(sub.tier.creator.id) && (
                        <p className="text-sm text-muted-foreground">Vous êtes de nouveau abonné à ce créateur.</p>
                      )}
                      {sub.tier.isActive === false && !liveCreatorIds.has(sub.tier.creator.id) && (
                        <p className="text-sm text-muted-foreground">Cette offre n'est plus proposée.</p>
                      )}
                    </CardContent>
                    <CardFooter className="flex flex-wrap gap-2">
                      <Button asChild variant="outline" className="flex-1">
                        <Link href={`/${sub.tier.creator.username}`}>Voir le profil</Link>
                      </Button>
                      {canResubscribe && (
                        <Button
                          className="flex-1"
                          disabled={isPendingFor(resumeMutation, sub)}
                          onClick={() => handleResubscribe(sub)}
                        >
                          {isPendingFor(resumeMutation, sub) && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                          Se réabonner
                        </Button>
                      )}
                    </CardFooter>
                  </Card>
                )
              })}
            </div>
          ) : (
            <Card>
              <CardContent className="py-12 text-center">
                <p className="text-muted-foreground">Aucun abonnement terminé</p>
                <p className="text-sm text-muted-foreground mt-2">
                  Vos abonnements annulés ou expirés apparaîtront ici
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
        returnUrl={RETURN_URL}
        onOpenChange={(open) => !open && setTierChange(null)}
        onChanged={() => refreshSubscriptions(tierChange?.subscription.tier.creator.id)}
      />

      <RetryPaymentDialog
        subscription={retrying}
        returnUrl={RETURN_URL}
        onOpenChange={(open) => !open && setRetrying(null)}
        onPaid={() => refreshSubscriptions(retrying?.tier.creator.id)}
      />
    </div>
  )
}

function ErrorCard({ onRetry }: { onRetry: () => void }) {
  return (
    <Card>
      <CardContent className="py-12 text-center space-y-4">
        <p className="text-muted-foreground">Impossible de charger vos abonnements.</p>
        <Button variant="outline" onClick={onRetry}>
          Réessayer
        </Button>
      </CardContent>
    </Card>
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
      <p className="text-sm font-medium">Changer d'offre</p>
      {others.map((tier) => {
        const isPending = subscription.pendingTierId === tier.id
        return (
          <div key={tier.id} className="flex items-center justify-between gap-2">
            <span className="text-sm min-w-0">
              {tier.name} <span className="text-muted-foreground">· {formatTierPrice(tier)}</span>
            </span>
            <Button size="sm" variant="outline" disabled={isPending} onClick={() => onSelect(tier)}>
              {isPending ? 'Programmé' : getTierChangeLabel(subscription, tier)}
            </Button>
          </div>
        )
      })}
    </div>
  )
}
