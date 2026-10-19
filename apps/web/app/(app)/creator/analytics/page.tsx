'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { LIVE_REFETCH_INTERVAL, useLiveAnalytics } from '@/hooks/use-live-analytics'
import { LiveIndicator } from '@/components/live-indicator'
import { analyticsApi, paymentsApi } from '@/lib/api'
import { formatEuros } from '@/lib/utils'
import { useToast } from '@/hooks/use-toast'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import {
  LineChart,
  Line,
  AreaChart,
  Area,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from 'recharts'
import {
  AlertCircle,
  DollarSign,
  Download,
  Eye,
  FileText,
  Heart,
  Loader2,
  MessageCircle,
  RefreshCw,
  TrendingUp,
  Users,
} from 'lucide-react'

type Interval = 'day' | 'week' | 'month'
type PeriodPreset = '7d' | '30d' | '90d' | '12m'

/** UI period presets -> analytics API params (the current period is included) */
const PERIOD_PRESETS: Record<PeriodPreset, { label: string; interval: Interval; periods: number }> = {
  '7d': { label: '7 derniers jours', interval: 'day', periods: 7 },
  '30d': { label: '30 derniers jours', interval: 'day', periods: 30 },
  '90d': { label: '13 dernières semaines', interval: 'week', periods: 13 },
  '12m': { label: '12 derniers mois', interval: 'month', periods: 12 },
}

const CONTENT_TYPE_LABELS: Record<string, string> = {
  PHOTO: 'Photo',
  VIDEO: 'Vidéo',
  AUDIO: 'Audio',
  TEXT: 'Texte',
  ALBUM: 'Album',
}

// Metrics refreshed live on new subscriber / tip / purchase events (prefix match)
const LIVE_QUERY_KEYS = [
  ['analytics-overview'],
  ['analytics-subscriber-growth'],
  ['analytics-engagement'],
  ['analytics-revenue'],
]

/** Period keys are UTC dates (YYYY-MM-DD, weeks start on Monday) or YYYY-MM */
function formatPeriod(value: string, interval: Interval, long = false): string {
  if (!value) return ''
  if (interval === 'month') {
    const [year, month] = value.split('-').map(Number)
    return new Date(Date.UTC(year, month - 1, 1)).toLocaleDateString('fr-FR', {
      month: long ? 'long' : 'short',
      year: 'numeric',
      timeZone: 'UTC',
    })
  }
  const date = new Date(`${value}T00:00:00Z`)
  const label = date.toLocaleDateString('fr-FR', {
    day: 'numeric',
    month: 'short',
    ...(long ? { year: 'numeric' } : {}),
    timeZone: 'UTC',
  })
  return interval === 'week' ? `Sem. du ${label}` : label
}

function percentChange(current: number, previous: number): string | null {
  if (!previous) return null
  const change = ((current - previous) / previous) * 100
  return `${change >= 0 ? '+' : ''}${change.toLocaleString('fr-FR', { maximumFractionDigits: 1 })} %`
}

function plural(count: number, singular: string, pluralForm = `${singular}s`): string {
  return `${count.toLocaleString('fr-FR')} ${count > 1 ? pluralForm : singular}`
}

function csvCell(value: string | number): string {
  const text = typeof value === 'number' ? String(value).replace('.', ',') : value
  return /[;"\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text
}

function ChartState({ loading, error, empty, emptyText }: { loading?: boolean; error?: boolean; empty?: boolean; emptyText: string }) {
  if (!loading && !error && !empty) return null
  return (
    <div className="h-[300px] flex items-center justify-center text-muted-foreground text-sm text-center px-4">
      {loading ? (
        <Loader2 className="h-6 w-6 animate-spin" />
      ) : error ? (
        <span className="flex items-center gap-2 text-destructive">
          <AlertCircle className="h-4 w-4" />
          Impossible de charger ces données
        </span>
      ) : (
        emptyText
      )}
    </div>
  )
}

export default function AnalyticsPage() {
  const [preset, setPreset] = useState<PeriodPreset>('30d')
  const { interval, periods, label: periodLabel } = PERIOD_PRESETS[preset]
  const params = { interval, periods }
  const queryClient = useQueryClient()
  const { toast } = useToast()
  const { connected } = useLiveAnalytics(LIVE_QUERY_KEYS)

  const overviewQuery = useQuery({
    queryKey: ['analytics-overview'],
    queryFn: async () => (await analyticsApi.getOverview()).data,
    refetchInterval: LIVE_REFETCH_INTERVAL,
  })

  const revenueQuery = useQuery({
    queryKey: ['analytics-revenue', interval, periods],
    queryFn: async () => (await paymentsApi.getRevenueStats(params)).data,
    refetchInterval: LIVE_REFETCH_INTERVAL,
  })

  const subscribersQuery = useQuery({
    queryKey: ['analytics-subscriber-growth', interval, periods],
    queryFn: async () => (await analyticsApi.getSubscriberGrowth(params)).data,
    refetchInterval: LIVE_REFETCH_INTERVAL,
  })

  const engagementQuery = useQuery({
    queryKey: ['analytics-engagement', interval, periods],
    queryFn: async () => (await analyticsApi.getEngagementStats(params)).data,
  })

  const contentQuery = useQuery({
    queryKey: ['analytics-content', interval, periods],
    queryFn: async () => (await analyticsApi.getContentAnalytics(params)).data,
  })

  // All-time performance by content type
  const reportQuery = useQuery({
    queryKey: ['analytics-report'],
    queryFn: async () => (await analyticsApi.getDetailedReport({ interval: 'month', periods: 1 })).data,
  })

  const overview = overviewQuery.data
  const revenue = revenueQuery.data
  const subscriberGrowth = subscribersQuery.data
  const engagementStats = engagementQuery.data
  const contentAnalytics = contentQuery.data

  const periodsLoaded = revenue && subscriberGrowth && engagementStats && contentAnalytics

  const handleExport = () => {
    if (!periodsLoaded) return
    const byPeriod = <T extends { period: string }>(rows: T[] | undefined) =>
      new Map((rows ?? []).map((row) => [row.period, row]))
    const subs = byPeriod<any>(subscriberGrowth.periods)
    const engagement = byPeriod<any>(engagementStats.periods)
    const content = byPeriod<any>(contentAnalytics.periods)

    const header = [
      'Période',
      'Revenus nets (€)',
      'Abonnements (€)',
      'Pourboires (€)',
      'Contenus payants (€)',
      'Transactions',
      'Nouveaux abonnés',
      'Désabonnements',
      'Croissance nette',
      'Likes',
      'Commentaires',
      'Contenus publiés',
      'Vues des contenus publiés',
    ]
    const rows = (revenue.periods ?? []).map((row: any) => {
      const s = subs.get(row.period) ?? {}
      const e = engagement.get(row.period) ?? {}
      const c = content.get(row.period) ?? {}
      return [
        row.period,
        row.netRevenue,
        row.subscriptionRevenue,
        row.tipRevenue,
        row.ppvRevenue,
        row.transactionCount,
        s.newSubscribers ?? 0,
        s.cancelledSubscribers ?? 0,
        s.netGrowth ?? 0,
        e.likes ?? 0,
        e.comments ?? 0,
        c.contentPublished ?? 0,
        c.totalViews ?? 0,
      ]
    })

    const csv = [header, ...rows].map((line) => line.map(csvCell).join(';')).join('\n')
    // BOM so Excel opens the accents correctly
    const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = `analytics-${preset}-${new Date().toISOString().slice(0, 10)}.csv`
    document.body.appendChild(link)
    link.click()
    link.remove()
    URL.revokeObjectURL(url)
    toast({ title: 'Export terminé', description: `${rows.length} périodes exportées (${periodLabel}).` })
  }

  if (overviewQuery.isLoading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <div className="text-center">
          <Loader2 className="h-12 w-12 animate-spin text-primary mx-auto" />
          <p className="mt-4 text-muted-foreground">Chargement des analytics...</p>
        </div>
      </div>
    )
  }

  if (overviewQuery.isError || !overview) {
    return (
      <div className="py-12 text-center space-y-4">
        <AlertCircle className="h-12 w-12 mx-auto text-destructive" />
        <p className="text-muted-foreground">Impossible de charger vos statistiques.</p>
        <Button variant="outline" onClick={() => overviewQuery.refetch()}>
          <RefreshCw className="h-4 w-4 mr-2" />
          Réessayer
        </Button>
      </div>
    )
  }

  const summary = overview.summary
  const engagementRate =
    summary.totalViews > 0 ? (((summary.totalLikes + summary.totalComments) / summary.totalViews) * 100).toFixed(1) : '0.0'
  const revenueTrend = percentChange(summary.monthlyRevenue, summary.previousMonthRevenue ?? 0)
  const netGrowth = subscriberGrowth?.totals?.netGrowth

  const stats = [
    {
      title: 'Revenus ce mois',
      value: formatEuros(summary.monthlyRevenue),
      detail: revenueTrend
        ? `${revenueTrend} vs mois dernier (${formatEuros(summary.previousMonthRevenue)})`
        : 'Revenus nets depuis le 1er du mois',
      icon: DollarSign,
      color: 'text-green-600',
    },
    {
      title: 'Abonnés actifs',
      value: summary.activeSubscriptions.toLocaleString('fr-FR'),
      detail:
        netGrowth === undefined
          ? `${summary.totalSubscribers} abonnements au total`
          : `${netGrowth >= 0 ? '+' : ''}${netGrowth} nets • ${periodLabel}`,
      icon: Users,
      color: 'text-blue-600',
    },
    {
      title: 'Vues totales',
      value: summary.totalViews.toLocaleString('fr-FR'),
      detail: `${plural(summary.totalContent, 'contenu publié', 'contenus publiés')}`,
      icon: Eye,
      color: 'text-purple-600',
    },
    {
      title: 'Engagement',
      value: `${engagementRate.replace('.', ',')} %`,
      detail: `${plural(summary.totalLikes, 'like')} • ${plural(summary.totalComments, 'commentaire')}`,
      icon: TrendingUp,
      color: 'text-orange-600',
    },
  ]

  const revenueBySource = revenue?.totals
    ? [
        { source: 'Abonnements', amount: revenue.totals.subscriptionRevenue },
        { source: 'Pourboires', amount: revenue.totals.tipRevenue },
        { source: 'Contenus payants', amount: revenue.totals.ppvRevenue },
      ]
    : []
  const hasRevenue = (revenue?.totals?.totalRevenue ?? 0) > 0
  const hasSubscriberActivity =
    (subscriberGrowth?.totals?.totalNewSubscribers ?? 0) + (subscriberGrowth?.totals?.totalCancelled ?? 0) > 0
  const hasEngagement = (engagementStats?.totals?.totalLikes ?? 0) + (engagementStats?.totals?.totalComments ?? 0) > 0
  const hasPublished = (contentAnalytics?.totals?.contentPublished ?? 0) > 0
  const contentBreakdown = (reportQuery.data?.contentBreakdown ?? []).map((item: any) => ({
    ...item,
    label: CONTENT_TYPE_LABELS[item.type] ?? item.type,
    engagementRate: Math.round(item.engagementRate * 10) / 10,
  }))

  const xAxisProps = {
    dataKey: 'period',
    tickFormatter: (value: string) => formatPeriod(value, interval),
    minTickGap: 16,
    tick: { fontSize: 12 },
  }
  const tooltipLabel = (label: string) => formatPeriod(label, interval, true)

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
        <div>
          <h1 className="text-3xl font-bold">Analytics</h1>
          <p className="text-muted-foreground mt-2">Suivez vos performances et optimisez votre contenu</p>
          <div className="mt-2">
            <LiveIndicator
              connected={connected}
              updatedAt={overviewQuery.dataUpdatedAt}
              isFetching={overviewQuery.isFetching}
              onRefresh={() => {
                LIVE_QUERY_KEYS.forEach((queryKey) => queryClient.invalidateQueries({ queryKey }))
                queryClient.invalidateQueries({ queryKey: ['analytics-content'] })
                queryClient.invalidateQueries({ queryKey: ['analytics-report'] })
              }}
            />
          </div>
        </div>
        <div className="flex flex-col gap-2 sm:flex-row">
          <Select value={preset} onValueChange={(value) => setPreset(value as PeriodPreset)}>
            <SelectTrigger className="w-full sm:w-[200px]" aria-label="Période">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {(Object.keys(PERIOD_PRESETS) as PeriodPreset[]).map((key) => (
                <SelectItem key={key} value={key}>
                  {PERIOD_PRESETS[key].label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button variant="outline" onClick={handleExport} disabled={!periodsLoaded}>
            {periodsLoaded ? <Download className="h-4 w-4 mr-2" /> : <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
            Exporter (CSV)
          </Button>
        </div>
      </div>

      {/* Stats cards */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {stats.map((stat) => {
          const Icon = stat.icon
          return (
            <Card key={stat.title}>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">{stat.title}</CardTitle>
                <Icon className={`h-4 w-4 ${stat.color}`} />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">{stat.value}</div>
                <p className="text-xs text-muted-foreground mt-1">{stat.detail}</p>
              </CardContent>
            </Card>
          )
        })}
      </div>

      {/* Charts */}
      <Tabs defaultValue="revenue" className="space-y-4">
        <TabsList className="w-full justify-start overflow-x-auto sm:w-auto">
          <TabsTrigger value="revenue">Revenus</TabsTrigger>
          <TabsTrigger value="subscribers">Abonnés</TabsTrigger>
          <TabsTrigger value="engagement">Engagement</TabsTrigger>
          <TabsTrigger value="content">Contenu</TabsTrigger>
        </TabsList>

        <TabsContent value="revenue" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Évolution des revenus</CardTitle>
              <CardDescription>Revenus nets (après commission) — {periodLabel}</CardDescription>
            </CardHeader>
            <CardContent>
              <ChartState
                loading={revenueQuery.isLoading}
                error={revenueQuery.isError}
                empty={!hasRevenue}
                emptyText="Aucun revenu sur cette période"
              />
              {hasRevenue && (
                <>
                  <ResponsiveContainer width="100%" height={300}>
                    <AreaChart data={revenue.periods}>
                      <CartesianGrid strokeDasharray="3 3" />
                      <XAxis {...xAxisProps} />
                      <YAxis tickFormatter={(value) => `${Number(value).toFixed(0)} €`} width={60} />
                      <Tooltip formatter={(value: any) => [formatEuros(value), 'Revenus nets']} labelFormatter={tooltipLabel} />
                      <Area type="monotone" dataKey="netRevenue" stroke="#8884d8" fill="#8884d8" fillOpacity={0.6} />
                    </AreaChart>
                  </ResponsiveContainer>
                  <div className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-3">
                    <div className="text-center">
                      <p className="text-2xl font-bold text-green-600">{formatEuros(revenue.totals.netRevenue)}</p>
                      <p className="text-sm text-muted-foreground">Total sur la période</p>
                    </div>
                    <div className="text-center">
                      <p className="text-2xl font-bold">{revenue.totals.transactionCount}</p>
                      <p className="text-sm text-muted-foreground">Transactions</p>
                    </div>
                    <div className="text-center col-span-2 sm:col-span-1">
                      <p className="text-2xl font-bold">{formatEuros(revenue.averages?.avgRevenuePerPeriod)}</p>
                      <p className="text-sm text-muted-foreground">
                        Moyenne par {interval === 'day' ? 'jour' : interval === 'week' ? 'semaine' : 'mois'}
                      </p>
                    </div>
                  </div>
                </>
              )}
            </CardContent>
          </Card>

          {hasRevenue && (
            <Card>
              <CardHeader>
                <CardTitle>Revenus par source</CardTitle>
                <CardDescription>Répartition des revenus nets — {periodLabel}</CardDescription>
              </CardHeader>
              <CardContent>
                <ResponsiveContainer width="100%" height={260}>
                  <BarChart data={revenueBySource}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="source" tick={{ fontSize: 12 }} />
                    <YAxis tickFormatter={(value) => `${Number(value).toFixed(0)} €`} width={60} />
                    <Tooltip formatter={(value: any) => [formatEuros(value), 'Revenus nets']} />
                    <Bar dataKey="amount" fill="#f59e0b" />
                  </BarChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>
          )}
        </TabsContent>

        <TabsContent value="subscribers">
          <Card>
            <CardHeader>
              <CardTitle>Croissance des abonnés</CardTitle>
              <CardDescription>Nouveaux abonnements et résiliations — {periodLabel}</CardDescription>
            </CardHeader>
            <CardContent>
              <ChartState
                loading={subscribersQuery.isLoading}
                error={subscribersQuery.isError}
                empty={!hasSubscriberActivity}
                emptyText="Aucun nouvel abonné ni résiliation sur cette période"
              />
              {hasSubscriberActivity && (
                <ResponsiveContainer width="100%" height={300}>
                  <LineChart data={subscriberGrowth.periods}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis {...xAxisProps} />
                    <YAxis allowDecimals={false} width={40} />
                    <Tooltip labelFormatter={tooltipLabel} />
                    <Legend />
                    <Line type="monotone" dataKey="newSubscribers" stroke="#82ca9d" strokeWidth={2} name="Nouveaux" dot={false} />
                    <Line type="monotone" dataKey="cancelledSubscribers" stroke="#ff8042" strokeWidth={2} name="Résiliations" dot={false} />
                    <Line type="monotone" dataKey="netGrowth" stroke="#8884d8" strokeWidth={2} name="Croissance nette" dot={false} />
                  </LineChart>
                </ResponsiveContainer>
              )}
              {subscriberGrowth?.totals && (
                <div className="mt-4 grid grid-cols-3 gap-4">
                  <div className="text-center">
                    <p className="text-2xl font-bold text-green-600">{subscriberGrowth.totals.totalNewSubscribers}</p>
                    <p className="text-sm text-muted-foreground">Nouveaux abonnés</p>
                  </div>
                  <div className="text-center">
                    <p className="text-2xl font-bold text-red-600">{subscriberGrowth.totals.totalCancelled}</p>
                    <p className="text-sm text-muted-foreground">Résiliations</p>
                  </div>
                  <div className="text-center">
                    <p className="text-2xl font-bold text-blue-600">{subscriberGrowth.totals.netGrowth}</p>
                    <p className="text-sm text-muted-foreground">Croissance nette</p>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="engagement" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Statistiques d&apos;engagement</CardTitle>
              <CardDescription>Likes et commentaires reçus — {periodLabel}</CardDescription>
            </CardHeader>
            <CardContent>
              <ChartState
                loading={engagementQuery.isLoading}
                error={engagementQuery.isError}
                empty={!hasEngagement}
                emptyText="Aucune interaction sur cette période"
              />
              {hasEngagement && (
                <ResponsiveContainer width="100%" height={300}>
                  <AreaChart data={engagementStats.periods}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis {...xAxisProps} />
                    <YAxis allowDecimals={false} width={40} />
                    <Tooltip labelFormatter={tooltipLabel} />
                    <Legend />
                    <Area type="monotone" dataKey="likes" stackId="1" stroke="#ff6b9d" fill="#ff6b9d" fillOpacity={0.6} name="Likes" />
                    <Area type="monotone" dataKey="comments" stackId="1" stroke="#4ecdc4" fill="#4ecdc4" fillOpacity={0.6} name="Commentaires" />
                  </AreaChart>
                </ResponsiveContainer>
              )}
              {engagementStats?.totals && (
                <div className="mt-4 grid grid-cols-3 gap-4">
                  <div className="text-center">
                    <p className="text-2xl font-bold text-pink-600">{engagementStats.totals.totalLikes}</p>
                    <p className="text-sm text-muted-foreground">Likes</p>
                  </div>
                  <div className="text-center">
                    <p className="text-2xl font-bold text-blue-600">{engagementStats.totals.totalComments}</p>
                    <p className="text-sm text-muted-foreground">Commentaires</p>
                  </div>
                  <div className="text-center">
                    <p className="text-2xl font-bold text-green-600">{engagementStats.totals.totalNewSubscribers}</p>
                    <p className="text-sm text-muted-foreground">Nouveaux abonnés</p>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Taux d&apos;engagement par type de contenu</CardTitle>
              <CardDescription>(Likes + commentaires) / vues, depuis le début</CardDescription>
            </CardHeader>
            <CardContent>
              <ChartState
                loading={reportQuery.isLoading}
                error={reportQuery.isError}
                empty={contentBreakdown.length === 0}
                emptyText="Aucun contenu publié"
              />
              {contentBreakdown.length > 0 && (
                <ResponsiveContainer width="100%" height={260}>
                  <BarChart data={contentBreakdown}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="label" tick={{ fontSize: 12 }} />
                    <YAxis tickFormatter={(value) => `${Number(value).toLocaleString('fr-FR')} %`} width={50} />
                    <Tooltip
                      formatter={(value: any, _name: any, item: any) => [
                        `${Number(value).toLocaleString('fr-FR')} % (${plural(item.payload.count, 'contenu')}, ${plural(item.payload.totalViews, 'vue')})`,
                        'Engagement',
                      ]}
                    />
                    <Bar dataKey="engagementRate" fill="#8b5cf6" />
                  </BarChart>
                </ResponsiveContainer>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="content" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Performance du contenu</CardTitle>
              <CardDescription>Top 5 de vos contenus les plus vus</CardDescription>
            </CardHeader>
            <CardContent>
              {overview.topContent && overview.topContent.length > 0 ? (
                <div className="space-y-3">
                  {overview.topContent.map((content: any, index: number) => (
                    <Link
                      key={content.id}
                      href={`/content/${content.id}`}
                      className="flex flex-col gap-2 p-4 border rounded-lg hover:bg-accent transition-colors sm:flex-row sm:items-center sm:justify-between"
                    >
                      <div className="space-y-1 min-w-0">
                        <div className="flex items-center gap-2 min-w-0">
                          <span className="text-2xl font-bold text-muted-foreground">#{index + 1}</span>
                          <p className="font-medium truncate">{content.title || 'Sans titre'}</p>
                          <span className="text-xs px-2 py-1 bg-primary/10 text-primary rounded shrink-0">
                            {CONTENT_TYPE_LABELS[content.type] ?? content.type}
                          </span>
                        </div>
                        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-muted-foreground">
                          <span className="flex items-center gap-1">
                            <Eye className="h-3 w-3" />
                            {plural(content.viewCount, 'vue')}
                          </span>
                          <span className="flex items-center gap-1">
                            <Heart className="h-3 w-3" />
                            {plural(content.likeCount, 'like')}
                          </span>
                          <span className="flex items-center gap-1">
                            <MessageCircle className="h-3 w-3" />
                            {plural(content.commentCount, 'commentaire')}
                          </span>
                        </div>
                      </div>
                      {content.publishedAt && (
                        <p className="text-sm text-muted-foreground shrink-0">
                          {new Date(content.publishedAt).toLocaleDateString('fr-FR')}
                        </p>
                      )}
                    </Link>
                  ))}
                </div>
              ) : (
                <div className="py-8 text-center text-muted-foreground">
                  <FileText className="h-12 w-12 mx-auto mb-2 opacity-50" />
                  <p>Aucun contenu publié</p>
                  <p className="text-sm mt-1">Commencez à créer du contenu pour voir les analytics</p>
                  <Button asChild className="mt-4">
                    <Link href="/creator/upload">Publier un contenu</Link>
                  </Button>
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Publication de contenu</CardTitle>
              <CardDescription>Contenus publiés et vues qu&apos;ils ont reçues — {periodLabel}</CardDescription>
            </CardHeader>
            <CardContent>
              <ChartState
                loading={contentQuery.isLoading}
                error={contentQuery.isError}
                empty={!hasPublished}
                emptyText="Aucun contenu publié sur cette période"
              />
              {hasPublished && (
                <ResponsiveContainer width="100%" height={300}>
                  <BarChart data={contentAnalytics.periods}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis {...xAxisProps} />
                    <YAxis yAxisId="count" allowDecimals={false} width={40} />
                    <YAxis yAxisId="views" orientation="right" width={50} />
                    <Tooltip labelFormatter={tooltipLabel} />
                    <Legend />
                    <Bar yAxisId="count" dataKey="contentPublished" fill="#8884d8" name="Contenus publiés" />
                    <Bar yAxisId="views" dataKey="totalViews" fill="#82ca9d" name="Vues" />
                  </BarChart>
                </ResponsiveContainer>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  )
}
