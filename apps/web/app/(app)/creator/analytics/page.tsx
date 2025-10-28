'use client'

import { useQuery } from '@tanstack/react-query'
import { analyticsApi, paymentsApi } from '@/lib/api'
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
  PieChart,
  Pie,
  Cell,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from 'recharts'
import { useState } from 'react'
import { TrendingUp, Users, DollarSign, FileText, Eye, Heart, MessageCircle, Loader2 } from 'lucide-react'

const COLORS = ['#0088FE', '#00C49F', '#FFBB28', '#FF8042', '#8884D8']

type Interval = 'day' | 'week' | 'month' | 'year'

export default function AnalyticsPage() {
  const [interval, setInterval] = useState<Interval>('day')
  const [periods, setPeriods] = useState(30)

  // Fetch overview analytics
  const { data: overview, isLoading: overviewLoading } = useQuery({
    queryKey: ['analytics-overview'],
    queryFn: async () => {
      const response = await analyticsApi.getOverview()
      return response.data
    },
  })

  // Fetch subscriber growth
  const { data: subscriberGrowth, isLoading: subscriberLoading } = useQuery({
    queryKey: ['analytics-subscriber-growth', interval, periods],
    queryFn: async () => {
      const response = await analyticsApi.getSubscriberGrowth({ interval, periods })
      return response.data
    },
  })

  // Fetch engagement stats
  const { data: engagementStats, isLoading: engagementLoading } = useQuery({
    queryKey: ['analytics-engagement', interval, periods],
    queryFn: async () => {
      const response = await analyticsApi.getEngagementStats({ interval, periods })
      return response.data
    },
  })

  // Fetch content analytics
  const { data: contentAnalytics, isLoading: contentLoading } = useQuery({
    queryKey: ['analytics-content', interval, periods],
    queryFn: async () => {
      const response = await analyticsApi.getContentAnalytics({ interval, periods })
      return response.data
    },
  })

  // Fetch payment/revenue data
  const { data: paymentHistory, isLoading: paymentsLoading } = useQuery({
    queryKey: ['payment-history'],
    queryFn: async () => {
      const response = await paymentsApi.getHistory()
      return response.data
    },
  })

  const isLoading = overviewLoading || subscriberLoading || engagementLoading || contentLoading

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <div className="text-center">
          <Loader2 className="h-12 w-12 animate-spin text-primary mx-auto" />
          <p className="mt-4 text-muted-foreground">Chargement des analytics...</p>
        </div>
      </div>
    )
  }

  if (!overview) return null

  // Calculate engagement rate
  const engagementRate = overview.summary.totalViews > 0
    ? ((overview.summary.totalLikes + overview.summary.totalComments) / overview.summary.totalViews * 100).toFixed(1)
    : '0.0'

  const stats = [
    {
      title: 'Revenus ce mois',
      value: `${(overview.summary.monthlyRevenue / 100).toFixed(2)} €`,
      trend: '+12.5%',
      icon: DollarSign,
      color: 'text-green-600',
    },
    {
      title: 'Abonnés Actifs',
      value: overview.summary.activeSubscriptions,
      trend: `+${subscriberGrowth?.totals?.netGrowth || 0}`,
      icon: Users,
      color: 'text-blue-600',
    },
    {
      title: 'Vues Totales',
      value: overview.summary.totalViews.toLocaleString(),
      trend: `${overview.summary.totalContent} contenus`,
      icon: Eye,
      color: 'text-purple-600',
    },
    {
      title: 'Engagement',
      value: `${engagementRate}%`,
      trend: `${overview.summary.totalLikes} likes`,
      icon: TrendingUp,
      color: 'text-orange-600',
    },
  ]

  // Prepare revenue data from payments
  const revenueData = paymentHistory?.items
    ?.filter((payment: any) => payment.status === 'COMPLETED')
    ?.reduce((acc: any[], payment: any) => {
      const date = new Date(payment.createdAt).toISOString().split('T')[0]
      const existing = acc.find(item => item.date === date)
      if (existing) {
        existing.amount += payment.netAmount
      } else {
        acc.push({
          date,
          amount: payment.netAmount,
        })
      }
      return acc
    }, [])
    ?.sort((a: any, b: any) => a.date.localeCompare(b.date))
    ?.slice(-30) || []

  // Calculate revenue by type
  const revenueByType = paymentHistory?.items
    ?.filter((payment: any) => payment.status === 'COMPLETED')
    ?.reduce((acc: any[], payment: any) => {
      const existing = acc.find(item => item.type === payment.type)
      if (existing) {
        existing.amount += payment.netAmount
      } else {
        acc.push({
          type: payment.type === 'SUBSCRIPTION' ? 'Abonnements' :
                payment.type === 'TIP' ? 'Pourboires' :
                payment.type === 'PPV' ? 'PPV' : payment.type,
          amount: payment.netAmount,
        })
      }
      return acc
    }, []) || []

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">Analytics</h1>
          <p className="text-muted-foreground mt-2">
            Suivez vos performances et optimisez votre contenu
          </p>
        </div>
        <div className="flex gap-2">
          <Select value={interval} onValueChange={(v) => setInterval(v as Interval)}>
            <SelectTrigger className="w-[140px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="day">Par jour</SelectItem>
              <SelectItem value="week">Par semaine</SelectItem>
              <SelectItem value="month">Par mois</SelectItem>
              <SelectItem value="year">Par année</SelectItem>
            </SelectContent>
          </Select>
          <Select value={periods.toString()} onValueChange={(v) => setPeriods(parseInt(v))}>
            <SelectTrigger className="w-[180px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="7">7 dernières périodes</SelectItem>
              <SelectItem value="30">30 dernières périodes</SelectItem>
              <SelectItem value="90">90 dernières périodes</SelectItem>
              <SelectItem value="365">365 dernières périodes</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* Stats Cards */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        {stats.map((stat) => {
          const Icon = stat.icon
          return (
            <Card key={stat.title}>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">
                  {stat.title}
                </CardTitle>
                <Icon className={`h-4 w-4 ${stat.color}`} />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">{stat.value}</div>
                <p className="text-xs text-muted-foreground mt-1">
                  {stat.trend}
                </p>
              </CardContent>
            </Card>
          )
        })}
      </div>

      {/* Charts */}
      <Tabs defaultValue="revenue" className="space-y-4">
        <TabsList>
          <TabsTrigger value="revenue">Revenus</TabsTrigger>
          <TabsTrigger value="subscribers">Abonnés</TabsTrigger>
          <TabsTrigger value="engagement">Engagement</TabsTrigger>
          <TabsTrigger value="content">Contenu</TabsTrigger>
        </TabsList>

        <TabsContent value="revenue" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Évolution des Revenus</CardTitle>
              <CardDescription>
                Revenus au fil du temps (30 derniers jours)
              </CardDescription>
            </CardHeader>
            <CardContent>
              {revenueData.length > 0 ? (
                <ResponsiveContainer width="100%" height={350}>
                  <AreaChart data={revenueData}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis
                      dataKey="date"
                      tickFormatter={(value) => new Date(value).toLocaleDateString('fr-FR', { month: 'short', day: 'numeric' })}
                    />
                    <YAxis tickFormatter={(value) => `${(value / 100).toFixed(0)}€`} />
                    <Tooltip
                      formatter={(value: any) => [`${(value / 100).toFixed(2)}€`, 'Revenus']}
                      labelFormatter={(label) => new Date(label).toLocaleDateString('fr-FR')}
                    />
                    <Area type="monotone" dataKey="amount" stroke="#8884d8" fill="#8884d8" fillOpacity={0.6} />
                  </AreaChart>
                </ResponsiveContainer>
              ) : (
                <div className="h-[350px] flex items-center justify-center text-muted-foreground">
                  Aucune donnée de revenus disponible
                </div>
              )}
            </CardContent>
          </Card>

          {revenueByType.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle>Revenus par Type</CardTitle>
                <CardDescription>
                  Répartition des sources de revenus
                </CardDescription>
              </CardHeader>
              <CardContent>
                <ResponsiveContainer width="100%" height={300}>
                  <BarChart data={revenueByType}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="type" />
                    <YAxis tickFormatter={(value) => `${(value / 100).toFixed(0)}€`} />
                    <Tooltip formatter={(value: any) => `${(value / 100).toFixed(2)}€`} />
                    <Bar dataKey="amount" fill="#8884d8" />
                  </BarChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>
          )}
        </TabsContent>

        <TabsContent value="subscribers">
          <Card>
            <CardHeader>
              <CardTitle>Croissance des Abonnés</CardTitle>
              <CardDescription>
                Nouveaux abonnés et désabonnements sur la période
              </CardDescription>
            </CardHeader>
            <CardContent>
              {subscriberGrowth?.periods && subscriberGrowth.periods.length > 0 ? (
                <ResponsiveContainer width="100%" height={350}>
                  <LineChart data={subscriberGrowth.periods}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis
                      dataKey="period"
                      tickFormatter={(value) => {
                        if (interval === 'day') {
                          return new Date(value).toLocaleDateString('fr-FR', { month: 'short', day: 'numeric' })
                        } else if (interval === 'month') {
                          const [year, month] = value.split('-')
                          return new Date(parseInt(year), parseInt(month) - 1).toLocaleDateString('fr-FR', { month: 'short', year: 'numeric' })
                        }
                        return value
                      }}
                    />
                    <YAxis />
                    <Tooltip
                      labelFormatter={(label) => {
                        if (interval === 'day') {
                          return new Date(label).toLocaleDateString('fr-FR')
                        }
                        return label
                      }}
                    />
                    <Legend />
                    <Line type="monotone" dataKey="newSubscribers" stroke="#82ca9d" strokeWidth={2} name="Nouveaux" />
                    <Line type="monotone" dataKey="cancelledSubscribers" stroke="#ff8042" strokeWidth={2} name="Annulations" />
                    <Line type="monotone" dataKey="netGrowth" stroke="#8884d8" strokeWidth={2} name="Croissance nette" />
                  </LineChart>
                </ResponsiveContainer>
              ) : (
                <div className="h-[350px] flex items-center justify-center text-muted-foreground">
                  Aucune donnée d'abonnés disponible
                </div>
              )}
              {subscriberGrowth?.totals && (
                <div className="mt-4 grid grid-cols-3 gap-4">
                  <div className="text-center">
                    <p className="text-2xl font-bold text-green-600">{subscriberGrowth.totals.totalNewSubscribers}</p>
                    <p className="text-sm text-muted-foreground">Nouveaux abonnés</p>
                  </div>
                  <div className="text-center">
                    <p className="text-2xl font-bold text-red-600">{subscriberGrowth.totals.totalCancelled}</p>
                    <p className="text-sm text-muted-foreground">Annulations</p>
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

        <TabsContent value="engagement">
          <Card>
            <CardHeader>
              <CardTitle>Statistiques d'Engagement</CardTitle>
              <CardDescription>
                Likes, commentaires et nouveaux abonnés sur la période
              </CardDescription>
            </CardHeader>
            <CardContent>
              {engagementStats?.periods && engagementStats.periods.length > 0 ? (
                <ResponsiveContainer width="100%" height={350}>
                  <AreaChart data={engagementStats.periods}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis
                      dataKey="period"
                      tickFormatter={(value) => {
                        if (interval === 'day') {
                          return new Date(value).toLocaleDateString('fr-FR', { month: 'short', day: 'numeric' })
                        } else if (interval === 'month') {
                          const [year, month] = value.split('-')
                          return new Date(parseInt(year), parseInt(month) - 1).toLocaleDateString('fr-FR', { month: 'short', year: 'numeric' })
                        }
                        return value
                      }}
                    />
                    <YAxis />
                    <Tooltip
                      labelFormatter={(label) => {
                        if (interval === 'day') {
                          return new Date(label).toLocaleDateString('fr-FR')
                        }
                        return label
                      }}
                    />
                    <Legend />
                    <Area type="monotone" dataKey="likes" stackId="1" stroke="#ff6b9d" fill="#ff6b9d" fillOpacity={0.6} name="Likes" />
                    <Area type="monotone" dataKey="comments" stackId="1" stroke="#4ecdc4" fill="#4ecdc4" fillOpacity={0.6} name="Commentaires" />
                  </AreaChart>
                </ResponsiveContainer>
              ) : (
                <div className="h-[350px] flex items-center justify-center text-muted-foreground">
                  Aucune donnée d'engagement disponible
                </div>
              )}
              {engagementStats?.totals && (
                <div className="mt-4 grid grid-cols-3 gap-4">
                  <div className="text-center">
                    <p className="text-2xl font-bold text-pink-600">{engagementStats.totals.totalLikes}</p>
                    <p className="text-sm text-muted-foreground">Total Likes</p>
                  </div>
                  <div className="text-center">
                    <p className="text-2xl font-bold text-blue-600">{engagementStats.totals.totalComments}</p>
                    <p className="text-sm text-muted-foreground">Total Commentaires</p>
                  </div>
                  <div className="text-center">
                    <p className="text-2xl font-bold text-green-600">{engagementStats.totals.totalNewSubscribers}</p>
                    <p className="text-sm text-muted-foreground">Nouveaux Abonnés</p>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="content">
          <Card>
            <CardHeader>
              <CardTitle>Performance du Contenu</CardTitle>
              <CardDescription>
                Top 5 contenus les plus vus
              </CardDescription>
            </CardHeader>
            <CardContent>
              {overview.topContent && overview.topContent.length > 0 ? (
                <div className="space-y-4">
                  {overview.topContent.map((content: any, index: number) => (
                    <div
                      key={content.id}
                      className="flex items-center justify-between p-4 border rounded-lg hover:bg-accent transition-colors"
                    >
                      <div className="space-y-1 flex-1">
                        <div className="flex items-center gap-2">
                          <span className="text-2xl font-bold text-muted-foreground">#{index + 1}</span>
                          <p className="font-medium">{content.title || 'Sans titre'}</p>
                          <span className="text-xs px-2 py-1 bg-primary/10 text-primary rounded">
                            {content.type}
                          </span>
                        </div>
                        <div className="flex items-center space-x-4 text-sm text-muted-foreground">
                          <span className="flex items-center gap-1">
                            <Eye className="h-3 w-3" />
                            {content.viewCount} vues
                          </span>
                          <span className="flex items-center gap-1">
                            <Heart className="h-3 w-3" />
                            {content.likeCount} likes
                          </span>
                          <span className="flex items-center gap-1">
                            <MessageCircle className="h-3 w-3" />
                            {content.commentCount} commentaires
                          </span>
                        </div>
                      </div>
                      <div className="text-right">
                        <p className="text-sm text-muted-foreground">
                          {new Date(content.publishedAt).toLocaleDateString('fr-FR')}
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="py-8 text-center text-muted-foreground">
                  <FileText className="h-12 w-12 mx-auto mb-2 opacity-50" />
                  <p>Aucun contenu publié</p>
                  <p className="text-sm mt-1">Commencez à créer du contenu pour voir les analytics</p>
                </div>
              )}
            </CardContent>
          </Card>

          {contentAnalytics?.periods && contentAnalytics.periods.length > 0 && (
            <Card className="mt-4">
              <CardHeader>
                <CardTitle>Publication de Contenu</CardTitle>
                <CardDescription>
                  Nombre de contenus publiés et vues moyennes
                </CardDescription>
              </CardHeader>
              <CardContent>
                <ResponsiveContainer width="100%" height={300}>
                  <BarChart data={contentAnalytics.periods}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis
                      dataKey="period"
                      tickFormatter={(value) => {
                        if (interval === 'day') {
                          return new Date(value).toLocaleDateString('fr-FR', { month: 'short', day: 'numeric' })
                        } else if (interval === 'month') {
                          const [year, month] = value.split('-')
                          return new Date(parseInt(year), parseInt(month) - 1).toLocaleDateString('fr-FR', { month: 'short', year: 'numeric' })
                        }
                        return value
                      }}
                    />
                    <YAxis />
                    <Tooltip
                      labelFormatter={(label) => {
                        if (interval === 'day') {
                          return new Date(label).toLocaleDateString('fr-FR')
                        }
                        return label
                      }}
                    />
                    <Legend />
                    <Bar dataKey="contentPublished" fill="#8884d8" name="Contenus publiés" />
                    <Bar dataKey="totalViews" fill="#82ca9d" name="Vues totales" />
                  </BarChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>
          )}
        </TabsContent>
      </Tabs>
    </div>
  )
}
