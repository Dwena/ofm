'use client'

import { Suspense } from 'react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { useQuery } from '@tanstack/react-query'
import { subscriptionsApi } from '@/lib/api'
import { formatEuros } from '@/lib/utils'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { AlertCircle, DollarSign, Layers, Loader2, Users } from 'lucide-react'
import { TierManager, MY_TIERS_QUERY_KEY, type CreatorTier } from '@/components/creator/tier-manager'
import { SubscribersList, type CreatorSubscription } from '@/components/creator/subscribers-list'

type Tab = 'tiers' | 'subscribers'

function CreatorSubscriptionsContent() {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const tab: Tab = searchParams.get('tab') === 'subscribers' ? 'subscribers' : 'tiers'

  const tiersQuery = useQuery({
    queryKey: MY_TIERS_QUERY_KEY,
    queryFn: async () => {
      const response = await subscriptionsApi.getMyTiers()
      return response.data as CreatorTier[]
    },
  })

  const subscribersQuery = useQuery({
    queryKey: ['creator-subscribers'],
    queryFn: async () => {
      const response = await subscriptionsApi.getMySubscribers()
      return response.data as CreatorSubscription[]
    },
  })

  const setTab = (value: string) => {
    const params = new URLSearchParams(searchParams.toString())
    params.set('tab', value)
    router.replace(`${pathname}?${params.toString()}`, { scroll: false })
  }

  const tiers = tiersQuery.data || []
  const activeSubscribers = tiers.reduce((sum, tier) => sum + tier.subscribersCount, 0)
  const monthlyRevenue = tiers.reduce((sum, tier) => sum + Number(tier.monthlyRevenue || 0), 0)
  const activeTiers = tiers.filter((tier) => tier.isActive).length

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl sm:text-3xl font-bold">Abonnements</h1>
        <p className="text-muted-foreground mt-2">Gérez vos offres d&apos;abonnement et vos abonnés</p>
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Abonnés actifs</CardTitle>
            <Users className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{tiersQuery.isLoading ? '—' : activeSubscribers}</div>
            <p className="text-xs text-muted-foreground mt-1">Toutes offres confondues</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Revenus mensuels</CardTitle>
            <DollarSign className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{tiersQuery.isLoading ? '—' : formatEuros(monthlyRevenue)}</div>
            <p className="text-xs text-muted-foreground mt-1">Revenus récurrents estimés (annuels ramenés au mois)</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Offres actives</CardTitle>
            <Layers className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{tiersQuery.isLoading ? '—' : activeTiers}</div>
            <p className="text-xs text-muted-foreground mt-1">
              {tiers.length} offre{tiers.length > 1 ? 's' : ''} configurée{tiers.length > 1 ? 's' : ''}
            </p>
          </CardContent>
        </Card>
      </div>

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="tiers">Offres</TabsTrigger>
          <TabsTrigger value="subscribers">
            Abonnés{subscribersQuery.data ? ` (${activeSubscribers})` : ''}
          </TabsTrigger>
        </TabsList>

        <TabsContent value="tiers" className="mt-4">
          {tiersQuery.isLoading ? (
            <div className="flex justify-center py-12">
              <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
            </div>
          ) : tiersQuery.isError ? (
            <Card>
              <CardContent className="flex flex-col items-center gap-3 py-12 text-center">
                <AlertCircle className="h-8 w-8 text-destructive" />
                <p className="text-sm text-muted-foreground">Impossible de charger vos offres.</p>
                <Button variant="outline" size="sm" onClick={() => tiersQuery.refetch()}>
                  Réessayer
                </Button>
              </CardContent>
            </Card>
          ) : (
            <TierManager tiers={tiers} />
          )}
        </TabsContent>

        <TabsContent value="subscribers" className="mt-4">
          <SubscribersList
            subscriptions={subscribersQuery.data}
            tiers={tiers}
            isLoading={subscribersQuery.isLoading}
            isError={subscribersQuery.isError}
            onRetry={() => subscribersQuery.refetch()}
          />
        </TabsContent>
      </Tabs>
    </div>
  )
}

export default function CreatorSubscriptionsPage() {
  return (
    <Suspense
      fallback={
        <div className="flex items-center justify-center min-h-[60vh]">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </div>
      }
    >
      <CreatorSubscriptionsContent />
    </Suspense>
  )
}
