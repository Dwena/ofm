'use client'

import Link from 'next/link'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { paymentsApi, usersApi, contentApi } from '@/lib/api'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  AlertCircle,
  BarChart3,
  ChevronRight,
  Clock,
  DollarSign,
  Eye,
  FileText,
  FolderOpen,
  Heart,
  MessageCircle,
  Pencil,
  Radio,
  TrendingUp,
  Upload,
  Users,
} from 'lucide-react'
import { formatDistanceToNow } from 'date-fns'
import { fr } from 'date-fns/locale'
import { LIVE_REFETCH_INTERVAL, useLiveAnalytics } from '@/hooks/use-live-analytics'
import { LiveIndicator } from '@/components/live-indicator'
import { KycBanner } from '@/components/creator/kyc-banner'
import { ProcessingJobsCard } from '@/components/media/media-job-progress'
import { formatEuros } from '@/lib/utils'
import {
  CreatorContentPage,
  STATUS_BADGE_VARIANT,
  STATUS_LABELS,
  displayStatus,
  visibilityLabel,
} from '@/lib/creator-content'

// Metrics refreshed live (socket events + polling)
const LIVE_QUERY_KEYS = [['creator-earnings'], ['creator-profile'], ['creator-content']]

const TRANSACTION_TYPE_LABELS: Record<string, string> = {
  SUBSCRIPTION: 'Abonnement',
  TIP: 'Pourboire',
  PPV_UNLOCK: 'Contenu PPV',
  REFUND: 'Remboursement',
}

const TRANSACTION_STATUS: Record<string, { label: string; variant: 'success' | 'secondary' | 'destructive' | 'outline' }> = {
  COMPLETED: { label: 'Payé', variant: 'success' },
  PENDING: { label: 'En attente', variant: 'secondary' },
  PROCESSING: { label: 'En cours', variant: 'secondary' },
  FAILED: { label: 'Échoué', variant: 'destructive' },
  REFUNDED: { label: 'Remboursé', variant: 'outline' },
  PARTIALLY_REFUNDED: { label: 'Remboursé en partie', variant: 'outline' },
  DISPUTED: { label: 'Contesté', variant: 'destructive' },
  CANCELLED: { label: 'Annulé', variant: 'outline' },
}

const QUICK_ACTIONS = [
  { href: '/creator/upload', label: 'Nouveau contenu', icon: Upload },
  { href: '/creator/content', label: 'Mes contenus', icon: FolderOpen },
  { href: '/creator/earnings', label: 'Revenus', icon: DollarSign },
  { href: '/creator/analytics', label: 'Statistiques', icon: BarChart3 },
  { href: '/creator/live', label: 'Lancer un live', icon: Radio },
]

const plural = (count: number, word: string) => `${count} ${word}${count > 1 ? 's' : ''}`

export default function CreatorDashboard() {
  const queryClient = useQueryClient()
  const { connected } = useLiveAnalytics(LIVE_QUERY_KEYS)

  // Fetch earnings data
  const {
    data: earnings,
    isLoading: earningsLoading,
    isFetching: earningsFetching,
    isError: earningsError,
    dataUpdatedAt,
  } = useQuery({
    queryKey: ['creator-earnings'],
    queryFn: async () => {
      const response = await paymentsApi.getCreatorEarnings()
      return response.data
    },
    refetchInterval: LIVE_REFETCH_INTERVAL,
  })

  // Fetch profile data
  const { data: profile, isLoading: profileLoading, isError: profileError } = useQuery({
    queryKey: ['creator-profile'],
    queryFn: async () => {
      const response = await usersApi.getProfile()
      return response.data.creatorProfile
    },
    refetchInterval: LIVE_REFETCH_INTERVAL,
  })

  // Recent content (every status) + number of items per status
  const { data: content, isLoading: contentLoading, isError: contentError } = useQuery({
    queryKey: ['creator-content', 'dashboard'],
    queryFn: async () => {
      const response = await contentApi.getMyContent({ page: 1, limit: 5 })
      return response.data as CreatorContentPage
    },
    refetchInterval: LIVE_REFETCH_INTERVAL,
  })

  const isLoading = earningsLoading || profileLoading || contentLoading
  const refreshAll = () =>
    LIVE_QUERY_KEYS.forEach((queryKey) => queryClient.invalidateQueries({ queryKey }))

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary mx-auto"></div>
          <p className="mt-4 text-muted-foreground">Chargement du dashboard...</p>
        </div>
      </div>
    )
  }

  const counts = content?.counts
  const contentDetails = counts
    ? [
        counts.DRAFT > 0 && plural(counts.DRAFT, 'brouillon'),
        counts.SCHEDULED > 0 && plural(counts.SCHEDULED, 'programmé'),
        counts.ARCHIVED > 0 && plural(counts.ARCHIVED, 'archivé'),
      ].filter(Boolean).join(' · ') || 'Contenus publiés'
    : 'Contenus publiés'

  const stats = [
    {
      title: 'Revenus Totaux',
      value: formatEuros(earnings?.totalEarnings),
      icon: DollarSign,
      description: earnings ? `dont ${formatEuros(earnings.monthlyEarnings)} ce mois-ci` : 'Depuis le début',
      color: 'text-green-600',
      href: '/creator/earnings',
    },
    {
      title: 'Solde Disponible',
      value: formatEuros(earnings?.availableBalance),
      icon: TrendingUp,
      description: 'Prêt pour retrait',
      color: 'text-blue-600',
      href: '/creator/earnings',
    },
    {
      title: 'En attente',
      value: formatEuros(earnings?.pendingBalance),
      icon: Clock,
      description: 'En cours de traitement',
      color: 'text-orange-600',
      href: '/creator/earnings',
    },
    {
      title: 'Abonnés',
      value: (profile?.totalSubscribers ?? 0).toLocaleString('fr-FR'),
      icon: Users,
      description: 'Abonnements actifs',
      color: 'text-purple-600',
      href: '/creator/subscriptions',
    },
    {
      title: 'Contenus',
      value: (counts?.PUBLISHED ?? profile?.totalContent ?? 0).toLocaleString('fr-FR'),
      icon: FileText,
      description: contentDetails,
      color: 'text-indigo-600',
      href: '/creator/content',
    },
  ]

  const recentContent = content?.items ?? []

  return (
    <div className="space-y-8">
      <div className="flex flex-col gap-2 md:flex-row md:items-end md:justify-between">
        <div>
          <h1 className="text-3xl font-bold">Dashboard Créateur</h1>
          <p className="text-muted-foreground mt-2">
            Bienvenue sur votre espace créateur
          </p>
        </div>
        <LiveIndicator
          connected={connected}
          updatedAt={dataUpdatedAt}
          isFetching={earningsFetching}
          onRefresh={refreshAll}
        />
      </div>

      {/* Identity verification needed before publishing */}
      <KycBanner />

      {(earningsError || profileError || contentError) && (
        <Card className="border-red-300 bg-red-50 dark:bg-red-950/20">
          <CardContent className="flex flex-col gap-3 pt-6 sm:flex-row sm:items-center sm:justify-between">
            <p className="flex items-center gap-2 text-sm text-red-600 dark:text-red-400">
              <AlertCircle className="h-4 w-4 flex-shrink-0" />
              {`Certaines données n’ont pas pu être chargées (${[
                earningsError && 'revenus',
                profileError && 'abonnés',
                contentError && 'contenus',
              ]
                .filter(Boolean)
                .join(', ')}).`}
            </p>
            <Button variant="outline" size="sm" onClick={refreshAll}>
              Réessayer
            </Button>
          </CardContent>
        </Card>
      )}

      {/* Stats Cards */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
        {stats.map((stat) => {
          const Icon = stat.icon
          return (
            <Link key={stat.title} href={stat.href} className="block rounded-lg focus:outline-none focus-visible:ring-2 focus-visible:ring-ring">
              <Card className="h-full transition-colors hover:bg-accent/50">
                <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                  <CardTitle className="text-sm font-medium">
                    {stat.title}
                  </CardTitle>
                  <Icon className={`h-4 w-4 ${stat.color}`} />
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-bold">{stat.value}</div>
                  <p className="text-xs text-muted-foreground">
                    {stat.description}
                  </p>
                </CardContent>
              </Card>
            </Link>
          )
        })}
      </div>

      {/* Quick actions */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5" data-testid="dashboard-quick-actions">
        {QUICK_ACTIONS.map((action) => {
          const Icon = action.icon
          return (
            <Button key={action.href} asChild variant="outline" className="h-auto justify-start py-3">
              <Link href={action.href}>
                <Icon className="mr-2 h-4 w-4" />
                {action.label}
              </Link>
            </Button>
          )
        })}
      </div>

      {/* Media still being processed after upload */}
      <ProcessingJobsCard />

      {/* Recent Content */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0">
          <CardTitle>Contenus Récents</CardTitle>
          {recentContent.length > 0 && (
            <Button asChild variant="ghost" size="sm">
              <Link href="/creator/content">
                Tout gérer
                <ChevronRight className="ml-1 h-4 w-4" />
              </Link>
            </Button>
          )}
        </CardHeader>
        <CardContent>
          {recentContent.length > 0 ? (
            <div className="space-y-3">
              {recentContent.map((item) => {
                const state = displayStatus(item)
                return (
                  <div
                    key={item.id}
                    className="flex items-center gap-2 border rounded-lg hover:bg-accent transition-colors"
                    data-testid="dashboard-content-item"
                  >
                    <Link href={`/content/${item.id}`} className="flex min-w-0 flex-1 flex-col gap-1 p-4 sm:flex-row sm:items-center sm:justify-between">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <h3 className="font-medium truncate">{item.title || 'Sans titre'}</h3>
                          <Badge variant={STATUS_BADGE_VARIANT[state]}>{STATUS_LABELS[state]}</Badge>
                          <Badge variant="outline">
                            {item.isPpv && item.ppvPrice != null
                              ? `PPV · ${formatEuros(item.ppvPrice)}`
                              : visibilityLabel(item.visibility)}
                          </Badge>
                        </div>
                        <div className="mt-1 flex flex-wrap gap-3 text-xs text-muted-foreground">
                          <span className="flex items-center gap-1"><Eye className="h-3 w-3" />{item.stats.views}</span>
                          <span className="flex items-center gap-1"><Heart className="h-3 w-3" />{item.stats.likes}</span>
                          <span className="flex items-center gap-1"><MessageCircle className="h-3 w-3" />{item.stats.comments}</span>
                          {item.isPpv && <span className="text-green-600">{formatEuros(item.stats.revenue)}</span>}
                        </div>
                      </div>
                      <div className="text-sm text-muted-foreground sm:flex-shrink-0 sm:pl-4">
                        {formatDistanceToNow(new Date(item.publishedAt ?? item.createdAt), {
                          addSuffix: true,
                          locale: fr,
                        })}
                      </div>
                    </Link>
                    <Button asChild variant="ghost" size="sm" className="mr-2 h-8 w-8 flex-shrink-0 p-0">
                      <Link href={`/creator/content?edit=${item.id}`} aria-label={`Modifier ${item.title || 'le contenu'}`}>
                        <Pencil className="h-4 w-4" />
                      </Link>
                    </Button>
                  </div>
                )
              })}
            </div>
          ) : (
            <div className="text-center py-8 text-muted-foreground">
              <FileText className="h-12 w-12 mx-auto mb-4 opacity-50" />
              <p>Aucun contenu pour le moment</p>
              <p className="text-sm mt-2">Commencez par uploader votre premier contenu</p>
              <Button asChild className="mt-4">
                <Link href="/creator/upload">
                  <Upload className="mr-2 h-4 w-4" />
                  Nouveau contenu
                </Link>
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Recent Transactions */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0">
          <CardTitle>Transactions Récentes</CardTitle>
          {earnings?.recentTransactions?.length > 0 && (
            <Button asChild variant="ghost" size="sm">
              <Link href="/creator/earnings">
                Voir tout
                <ChevronRight className="ml-1 h-4 w-4" />
              </Link>
            </Button>
          )}
        </CardHeader>
        <CardContent>
          {earnings && earnings.recentTransactions && earnings.recentTransactions.length > 0 ? (
            <div className="space-y-4">
              {earnings.recentTransactions.map((transaction: any) => {
                const status = TRANSACTION_STATUS[transaction.status] ?? {
                  label: transaction.status,
                  variant: 'secondary' as const,
                }
                return (
                  <div
                    key={transaction.id}
                    className="flex items-center justify-between gap-3 p-4 border rounded-lg"
                  >
                    <div>
                      <p className="font-medium">
                        {TRANSACTION_TYPE_LABELS[transaction.type] ?? transaction.type}
                      </p>
                      <p className="text-sm text-muted-foreground">
                        {formatDistanceToNow(new Date(transaction.createdAt), {
                          addSuffix: true,
                          locale: fr,
                        })}
                      </p>
                    </div>
                    <div className="text-right">
                      <p className="font-bold text-green-600">
                        +{formatEuros(transaction.netAmount ?? transaction.amount)}
                      </p>
                      <Badge variant={status.variant}>{status.label}</Badge>
                    </div>
                  </div>
                )
              })}
            </div>
          ) : (
            <div className="text-center py-8 text-muted-foreground">
              <DollarSign className="h-12 w-12 mx-auto mb-4 opacity-50" />
              <p>Aucune transaction pour le moment</p>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
