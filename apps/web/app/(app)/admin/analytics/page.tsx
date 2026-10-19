'use client'

import { useMemo, useState } from 'react'
import Link from 'next/link'
import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { format, parseISO } from 'date-fns'
import { fr } from 'date-fns/locale'
import {
  Bar,
  BarChart,
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { BarChart3, Euro, FileText, Percent, UserPlus, Users } from 'lucide-react'
import { adminApi } from '@/lib/api'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { EmptyState, ErrorState, LoadingState } from '@/components/admin/admin-shared'
import {
  ChartLegend,
  ChartTooltip,
  StatTile,
  VIZ,
  axisProps,
  formatEuro,
  formatEuroCompact,
  formatNumber,
  gridProps,
} from '@/components/admin/admin-charts'

type Interval = 'day' | 'week' | 'month'

interface SeriesPoint {
  date: string
  revenue: number
  platformFees: number
  transactions: number
  newUsers: number
  newCreators: number
  contentUploads: number
  newSubscriptions: number
  cancelledSubscriptions: number
}

interface AnalyticsResponse {
  period: { start: string; end: string; interval: Interval }
  totals: {
    revenue: number
    platformFees: number
    transactions: number
    newUsers: number
    newCreators: number
    contentUploads: number
    newSubscriptions: number
    cancelledSubscriptions: number
    activeSubscriptions: number
    totalUsers: number
    totalCreators: number
  }
  series: SeriesPoint[]
  revenueByType: { type: string; amount: number; platformFees: number; count: number }[]
  topCreators: {
    id: string
    username: string | null
    displayName: string | null
    avatar: string | null
    subscribers: number
    revenue: number
    platformFees: number
    netRevenue: number
    transactions: number
  }[]
}

const PERIODS: Record<string, { label: string; days: number; interval: Interval }> = {
  '7': { label: '7 derniers jours', days: 7, interval: 'day' },
  '30': { label: '30 derniers jours', days: 30, interval: 'day' },
  '90': { label: '90 derniers jours', days: 90, interval: 'week' },
  '365': { label: '12 derniers mois', days: 365, interval: 'month' },
}

const INTERVAL_LABELS: Record<Interval, string> = { day: 'Par jour', week: 'Par semaine', month: 'Par mois' }

const TRANSACTION_TYPE_LABELS: Record<string, string> = {
  SUBSCRIPTION: 'Abonnements',
  TIP: 'Pourboires',
  PPV_UNLOCK: 'Contenus payants',
}

function formatBucket(date: string | number, interval: Interval) {
  const d = parseISO(String(date))
  if (interval === 'month') return format(d, 'MMM yyyy', { locale: fr })
  if (interval === 'week') return `Sem. du ${format(d, 'd MMM', { locale: fr })}`
  return format(d, 'd MMM', { locale: fr })
}

export default function AdminAnalyticsPage() {
  const [period, setPeriod] = useState('30')
  const [interval, setGroupBy] = useState<Interval>('day')

  const range = useMemo(() => {
    const end = new Date()
    const start = new Date(end.getTime() - (PERIODS[period].days - 1) * 24 * 60 * 60 * 1000)
    start.setHours(0, 0, 0, 0)
    return { startDate: start.toISOString(), endDate: end.toISOString() }
  }, [period])

  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['admin-analytics', period, interval],
    queryFn: async () => {
      const response = await adminApi.getAnalytics({ ...range, interval })
      return response.data as AnalyticsResponse
    },
    placeholderData: keepPreviousData,
  })

  const changePeriod = (value: string) => {
    setPeriod(value)
    setGroupBy(PERIODS[value].interval)
  }

  const tickFormatter = (value: string | number) => formatBucket(value, interval)
  const totals = data?.totals

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
        <div>
          <h1 className="text-3xl font-bold flex items-center gap-2">
            <BarChart3 className="h-7 w-7" />
            Analytique
          </h1>
          <p className="text-muted-foreground mt-1">
            Revenus, commissions, inscriptions et activité de la plateforme
          </p>
        </div>
        <div className="flex flex-col gap-2 sm:flex-row">
          <Select value={period} onValueChange={changePeriod}>
            <SelectTrigger className="sm:w-48" aria-label="Période">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {Object.entries(PERIODS).map(([value, { label }]) => (
                <SelectItem key={value} value={value}>
                  {label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={interval} onValueChange={(value) => setGroupBy(value as Interval)}>
            <SelectTrigger className="sm:w-40" aria-label="Regroupement">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {(Object.keys(INTERVAL_LABELS) as Interval[]).map((value) => (
                <SelectItem key={value} value={value}>
                  {INTERVAL_LABELS[value]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {isLoading ? (
        <LoadingState label="Chargement des statistiques..." />
      ) : isError || !data ? (
        <ErrorState error={error} onRetry={() => refetch()} label="Impossible de charger les statistiques" />
      ) : (
        <>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
            <StatTile
              testId="kpi-revenue"
              title="Revenus"
              value={formatEuro(totals!.revenue)}
              description={`${formatNumber(totals!.transactions)} transaction(s)`}
              icon={<Euro className="h-4 w-4 text-muted-foreground" />}
            />
            <StatTile
              testId="kpi-platform-fees"
              title="Commissions plateforme"
              value={formatEuro(totals!.platformFees)}
              description={
                totals!.revenue > 0
                  ? `${((totals!.platformFees / totals!.revenue) * 100).toFixed(1)} % des revenus`
                  : 'Aucun revenu sur la période'
              }
              icon={<Percent className="h-4 w-4 text-muted-foreground" />}
            />
            <StatTile
              testId="kpi-new-users"
              title="Nouveaux utilisateurs"
              value={formatNumber(totals!.newUsers)}
              description={`dont ${formatNumber(totals!.newCreators)} créateur(s) • ${formatNumber(totals!.totalUsers)} au total`}
              icon={<UserPlus className="h-4 w-4 text-muted-foreground" />}
            />
            <StatTile
              testId="kpi-active-subscriptions"
              title="Abonnements actifs"
              value={formatNumber(totals!.activeSubscriptions)}
              description={`+${formatNumber(totals!.newSubscriptions)} / -${formatNumber(totals!.cancelledSubscriptions)} sur la période`}
              icon={<Users className="h-4 w-4 text-muted-foreground" />}
            />
            <StatTile
              testId="kpi-content-uploads"
              title="Contenus mis en ligne"
              value={formatNumber(totals!.contentUploads)}
              description="Sur la période"
              icon={<FileText className="h-4 w-4 text-muted-foreground" />}
            />
          </div>

          <Card>
            <CardHeader>
              <CardTitle>Revenus et commissions</CardTitle>
              <CardDescription>Montants encaissés (abonnements, pourboires, contenus payants), en euros</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <ChartLegend
                items={[
                  { label: 'Revenus', color: VIZ[1] },
                  { label: 'Commissions plateforme', color: VIZ[2] },
                ]}
              />
              <ResponsiveContainer width="100%" height={300}>
                <LineChart data={data.series} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                  <CartesianGrid {...gridProps} />
                  <XAxis dataKey="date" tickFormatter={tickFormatter} minTickGap={24} {...axisProps} />
                  <YAxis tickFormatter={(v) => formatEuroCompact(Number(v))} width={70} {...axisProps} />
                  <Tooltip
                    cursor={{ stroke: 'hsl(var(--muted-foreground))', strokeDasharray: '3 3' }}
                    content={
                      <ChartTooltip labelFormatter={tickFormatter} valueFormatter={(value) => formatEuro(value)} />
                    }
                  />
                  <Line
                    type="monotone"
                    dataKey="revenue"
                    name="Revenus"
                    stroke={VIZ[1]}
                    strokeWidth={2}
                    dot={false}
                    activeDot={{ r: 4 }}
                  />
                  <Line
                    type="monotone"
                    dataKey="platformFees"
                    name="Commissions plateforme"
                    stroke={VIZ[2]}
                    strokeWidth={2}
                    dot={false}
                    activeDot={{ r: 4 }}
                  />
                </LineChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>

          <div className="grid gap-4 lg:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle>Nouvelles inscriptions</CardTitle>
                <CardDescription>Abonnés et créateurs inscrits</CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                <ChartLegend
                  items={[
                    { label: 'Utilisateurs', color: VIZ[1] },
                    { label: 'dont créateurs', color: VIZ[3] },
                  ]}
                />
                <ResponsiveContainer width="100%" height={260}>
                  <BarChart data={data.series} barGap={2} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                    <CartesianGrid {...gridProps} />
                    <XAxis dataKey="date" tickFormatter={tickFormatter} minTickGap={24} {...axisProps} />
                    <YAxis allowDecimals={false} width={40} {...axisProps} />
                    <Tooltip
                      cursor={{ fill: 'hsl(var(--muted))' }}
                      content={<ChartTooltip labelFormatter={tickFormatter} />}
                    />
                    <Bar dataKey="newUsers" name="Utilisateurs" fill={VIZ[1]} radius={[4, 4, 0, 0]} maxBarSize={24} />
                    <Bar dataKey="newCreators" name="dont créateurs" fill={VIZ[3]} radius={[4, 4, 0, 0]} maxBarSize={24} />
                  </BarChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Abonnements</CardTitle>
                <CardDescription>Nouveaux abonnements et résiliations</CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                <ChartLegend
                  items={[
                    { label: 'Nouveaux', color: VIZ[1] },
                    { label: 'Résiliations', color: VIZ[2] },
                  ]}
                />
                <ResponsiveContainer width="100%" height={260}>
                  <BarChart data={data.series} barGap={2} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                    <CartesianGrid {...gridProps} />
                    <XAxis dataKey="date" tickFormatter={tickFormatter} minTickGap={24} {...axisProps} />
                    <YAxis allowDecimals={false} width={40} {...axisProps} />
                    <Tooltip
                      cursor={{ fill: 'hsl(var(--muted))' }}
                      content={<ChartTooltip labelFormatter={tickFormatter} />}
                    />
                    <Bar dataKey="newSubscriptions" name="Nouveaux" fill={VIZ[1]} radius={[4, 4, 0, 0]} maxBarSize={24} />
                    <Bar
                      dataKey="cancelledSubscriptions"
                      name="Résiliations"
                      fill={VIZ[2]}
                      radius={[4, 4, 0, 0]}
                      maxBarSize={24}
                    />
                  </BarChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Contenus mis en ligne</CardTitle>
                <CardDescription>Publications créées par les créateurs</CardDescription>
              </CardHeader>
              <CardContent>
                <ResponsiveContainer width="100%" height={260}>
                  <BarChart data={data.series} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                    <CartesianGrid {...gridProps} />
                    <XAxis dataKey="date" tickFormatter={tickFormatter} minTickGap={24} {...axisProps} />
                    <YAxis allowDecimals={false} width={40} {...axisProps} />
                    <Tooltip
                      cursor={{ fill: 'hsl(var(--muted))' }}
                      content={<ChartTooltip labelFormatter={tickFormatter} />}
                    />
                    <Bar dataKey="contentUploads" name="Contenus" fill={VIZ[1]} radius={[4, 4, 0, 0]} maxBarSize={24} />
                  </BarChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Revenus par source</CardTitle>
                <CardDescription>Répartition sur la période</CardDescription>
              </CardHeader>
              <CardContent>
                {data.revenueByType.length === 0 ? (
                  <EmptyState>Aucun revenu sur la période</EmptyState>
                ) : (
                  <ul className="space-y-4">
                    {data.revenueByType
                      .slice()
                      .sort((a, b) => b.amount - a.amount)
                      .map((row) => {
                        const share = data.totals.revenue > 0 ? (row.amount / data.totals.revenue) * 100 : 0
                        return (
                          <li key={row.type} className="space-y-1">
                            <div className="flex items-baseline justify-between text-sm">
                              <span>{TRANSACTION_TYPE_LABELS[row.type] || row.type}</span>
                              <span className="tabular-nums">
                                {formatEuro(row.amount)}{' '}
                                <span className="text-muted-foreground">({share.toFixed(0)} %)</span>
                              </span>
                            </div>
                            <div className="h-2 rounded-full bg-muted">
                              <div className="h-2 rounded-full" style={{ width: `${share}%`, background: VIZ[1] }} />
                            </div>
                            <p className="text-xs text-muted-foreground">
                              {formatNumber(row.count)} transaction(s) • {formatEuro(row.platformFees)} de commissions
                            </p>
                          </li>
                        )
                      })}
                  </ul>
                )}
              </CardContent>
            </Card>
          </div>

          <Card>
            <CardHeader>
              <CardTitle>Meilleurs créateurs</CardTitle>
              <CardDescription>Classés par revenus générés sur la période</CardDescription>
            </CardHeader>
            <CardContent>
              {data.topCreators.length === 0 ? (
                <EmptyState>Aucun revenu créateur sur la période</EmptyState>
              ) : (
                <Table data-testid="top-creators">
                  <TableHeader>
                    <TableRow>
                      <TableHead>Créateur</TableHead>
                      <TableHead className="text-right">Revenus</TableHead>
                      <TableHead className="text-right">Commissions</TableHead>
                      <TableHead className="text-right">Net créateur</TableHead>
                      <TableHead className="text-right">Transactions</TableHead>
                      <TableHead className="text-right">Abonnés</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {data.topCreators.map((creator) => (
                      <TableRow key={creator.id}>
                        <TableCell>
                          <div className="flex items-center gap-2">
                            <Avatar className="h-8 w-8">
                              <AvatarImage src={creator.avatar || undefined} />
                              <AvatarFallback>{(creator.username || '??').substring(0, 2).toUpperCase()}</AvatarFallback>
                            </Avatar>
                            <div className="min-w-0">
                              <Link href={`/admin/users?user=${creator.id}`} className="font-medium truncate hover:underline block">
                                {creator.displayName || creator.username || 'Inconnu'}
                              </Link>
                              {creator.username && <p className="text-xs text-muted-foreground">@{creator.username}</p>}
                            </div>
                          </div>
                        </TableCell>
                        <TableCell className="text-right tabular-nums">{formatEuro(creator.revenue)}</TableCell>
                        <TableCell className="text-right tabular-nums">{formatEuro(creator.platformFees)}</TableCell>
                        <TableCell className="text-right tabular-nums">{formatEuro(creator.netRevenue)}</TableCell>
                        <TableCell className="text-right tabular-nums">{formatNumber(creator.transactions)}</TableCell>
                        <TableCell className="text-right tabular-nums">{formatNumber(creator.subscribers)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>

          <details className="rounded-lg border p-4">
            <summary className="cursor-pointer text-sm font-medium">Voir les données sous forme de tableau</summary>
            <div className="mt-4 overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Période</TableHead>
                    <TableHead className="text-right">Revenus</TableHead>
                    <TableHead className="text-right">Commissions</TableHead>
                    <TableHead className="text-right">Inscrits</TableHead>
                    <TableHead className="text-right">Créateurs</TableHead>
                    <TableHead className="text-right">Abonnements</TableHead>
                    <TableHead className="text-right">Résiliations</TableHead>
                    <TableHead className="text-right">Contenus</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.series.map((point) => (
                    <TableRow key={point.date}>
                      <TableCell>{formatBucket(point.date, interval)}</TableCell>
                      <TableCell className="text-right tabular-nums">{formatEuro(point.revenue)}</TableCell>
                      <TableCell className="text-right tabular-nums">{formatEuro(point.platformFees)}</TableCell>
                      <TableCell className="text-right tabular-nums">{point.newUsers}</TableCell>
                      <TableCell className="text-right tabular-nums">{point.newCreators}</TableCell>
                      <TableCell className="text-right tabular-nums">{point.newSubscriptions}</TableCell>
                      <TableCell className="text-right tabular-nums">{point.cancelledSubscriptions}</TableCell>
                      <TableCell className="text-right tabular-nums">{point.contentUploads}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </details>
        </>
      )}
    </div>
  )
}
