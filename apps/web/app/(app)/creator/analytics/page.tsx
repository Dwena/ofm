'use client'

import { useQuery } from '@tanstack/react-query'
import { paymentsApi, contentApi } from '@/lib/api'
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
import { TrendingUp, Users, DollarSign, FileText, Eye } from 'lucide-react'

const COLORS = ['#0088FE', '#00C49F', '#FFBB28', '#FF8042', '#8884D8']

export default function AnalyticsPage() {
  const [period, setPeriod] = useState('30d')

  // Fetch analytics data
  const { data: analytics, isLoading } = useQuery({
    queryKey: ['analytics', period],
    queryFn: async () => {
      // In a real app, this would fetch from an analytics endpoint
      // For now, we'll use mock data structure
      return {
        revenue: {
          total: 25680,
          trend: '+12.5%',
          data: [
            { date: '2024-01-01', amount: 1200 },
            { date: '2024-01-08', amount: 1800 },
            { date: '2024-01-15', amount: 2100 },
            { date: '2024-01-22', amount: 1950 },
            { date: '2024-01-29', amount: 2300 },
            { date: '2024-02-05', amount: 2650 },
            { date: '2024-02-12', amount: 2850 },
          ],
        },
        subscribers: {
          total: 342,
          trend: '+8.3%',
          data: [
            { date: '2024-01-01', count: 280 },
            { date: '2024-01-08', count: 295 },
            { date: '2024-01-15', count: 305 },
            { date: '2024-01-22', count: 318 },
            { date: '2024-01-29', count: 328 },
            { date: '2024-02-05', count: 335 },
            { date: '2024-02-12', count: 342 },
          ],
        },
        contentPerformance: [
          { title: 'Photo Set #45', views: 1250, likes: 340, revenue: 2400 },
          { title: 'Video Tutorial', views: 980, likes: 280, revenue: 1960 },
          { title: 'Behind the Scenes', views: 850, likes: 220, revenue: 1700 },
          { title: 'Exclusive Content', views: 720, likes: 195, revenue: 1440 },
          { title: 'Q&A Session', views: 650, likes: 175, revenue: 1300 },
        ],
        tierDistribution: [
          { name: 'FREE', value: 120, revenue: 0 },
          { name: 'BASIC', value: 95, revenue: 4750 },
          { name: 'PREMIUM', value: 85, revenue: 8500 },
          { name: 'VIP', value: 42, revenue: 12600 },
        ],
        revenueByType: [
          { type: 'Subscriptions', amount: 18500 },
          { type: 'PPV', amount: 5800 },
          { type: 'Tips', amount: 1380 },
        ],
      }
    },
  })

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary mx-auto"></div>
          <p className="mt-4 text-muted-foreground">Chargement des analytics...</p>
        </div>
      </div>
    )
  }

  if (!analytics) return null

  const stats = [
    {
      title: 'Revenus Totaux',
      value: `${(analytics.revenue.total / 100).toFixed(2)} €`,
      trend: analytics.revenue.trend,
      icon: DollarSign,
      color: 'text-green-600',
    },
    {
      title: 'Abonnés',
      value: analytics.subscribers.total,
      trend: analytics.subscribers.trend,
      icon: Users,
      color: 'text-blue-600',
    },
    {
      title: 'Contenus Vus',
      value: analytics.contentPerformance.reduce((sum, c) => sum + c.views, 0),
      trend: '+15.2%',
      icon: Eye,
      color: 'text-purple-600',
    },
    {
      title: 'Engagement',
      value: `${((analytics.contentPerformance.reduce((sum, c) => sum + c.likes, 0) / analytics.contentPerformance.reduce((sum, c) => sum + c.views, 0)) * 100).toFixed(1)}%`,
      trend: '+2.4%',
      icon: TrendingUp,
      color: 'text-orange-600',
    },
  ]

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">Analytics</h1>
          <p className="text-muted-foreground mt-2">
            Suivez vos performances et optimisez votre contenu
          </p>
        </div>
        <Select value={period} onValueChange={setPeriod}>
          <SelectTrigger className="w-[180px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="7d">7 derniers jours</SelectItem>
            <SelectItem value="30d">30 derniers jours</SelectItem>
            <SelectItem value="90d">90 derniers jours</SelectItem>
            <SelectItem value="1y">1 an</SelectItem>
          </SelectContent>
        </Select>
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
                <p className="text-xs text-green-600 mt-1">
                  {stat.trend} vs période précédente
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
          <TabsTrigger value="content">Contenu</TabsTrigger>
          <TabsTrigger value="tiers">Tiers</TabsTrigger>
        </TabsList>

        <TabsContent value="revenue" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Évolution des Revenus</CardTitle>
              <CardDescription>
                Revenus au fil du temps
              </CardDescription>
            </CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height={350}>
                <AreaChart data={analytics.revenue.data}>
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
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Revenus par Type</CardTitle>
              <CardDescription>
                Répartition des sources de revenus
              </CardDescription>
            </CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height={300}>
                <BarChart data={analytics.revenueByType}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="type" />
                  <YAxis tickFormatter={(value) => `${(value / 100).toFixed(0)}€`} />
                  <Tooltip formatter={(value: any) => `${(value / 100).toFixed(2)}€`} />
                  <Bar dataKey="amount" fill="#8884d8" />
                </BarChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="subscribers">
          <Card>
            <CardHeader>
              <CardTitle>Croissance des Abonnés</CardTitle>
              <CardDescription>
                Nombre d'abonnés au fil du temps
              </CardDescription>
            </CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height={350}>
                <LineChart data={analytics.subscribers.data}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis
                    dataKey="date"
                    tickFormatter={(value) => new Date(value).toLocaleDateString('fr-FR', { month: 'short', day: 'numeric' })}
                  />
                  <YAxis />
                  <Tooltip
                    labelFormatter={(label) => new Date(label).toLocaleDateString('fr-FR')}
                  />
                  <Legend />
                  <Line type="monotone" dataKey="count" stroke="#82ca9d" strokeWidth={2} name="Abonnés" />
                </LineChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="content">
          <Card>
            <CardHeader>
              <CardTitle>Performance du Contenu</CardTitle>
              <CardDescription>
                Top 5 contenus les plus performants
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                {analytics.contentPerformance.map((content, index) => (
                  <div
                    key={index}
                    className="flex items-center justify-between p-4 border rounded-lg"
                  >
                    <div className="space-y-1">
                      <p className="font-medium">{content.title}</p>
                      <div className="flex items-center space-x-4 text-sm text-muted-foreground">
                        <span className="flex items-center">
                          <Eye className="h-3 w-3 mr-1" />
                          {content.views} vues
                        </span>
                        <span>❤️ {content.likes} likes</span>
                      </div>
                    </div>
                    <div className="text-right">
                      <p className="font-bold text-green-600">
                        {(content.revenue / 100).toFixed(2)}€
                      </p>
                      <p className="text-xs text-muted-foreground">Revenus</p>
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="tiers">
          <div className="grid md:grid-cols-2 gap-4">
            <Card>
              <CardHeader>
                <CardTitle>Distribution des Tiers</CardTitle>
                <CardDescription>
                  Répartition des abonnés par tier
                </CardDescription>
              </CardHeader>
              <CardContent>
                <ResponsiveContainer width="100%" height={300}>
                  <PieChart>
                    <Pie
                      data={analytics.tierDistribution}
                      cx="50%"
                      cy="50%"
                      labelLine={false}
                      label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`}
                      outerRadius={80}
                      fill="#8884d8"
                      dataKey="value"
                    >
                      {analytics.tierDistribution.map((entry, index) => (
                        <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                      ))}
                    </Pie>
                    <Tooltip />
                  </PieChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Revenus par Tier</CardTitle>
                <CardDescription>
                  Contribution de chaque tier aux revenus
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="space-y-4">
                  {analytics.tierDistribution.filter(t => t.revenue > 0).map((tier, index) => (
                    <div key={tier.name} className="space-y-2">
                      <div className="flex items-center justify-between text-sm">
                        <span className="font-medium">{tier.name}</span>
                        <span className="text-muted-foreground">
                          {tier.value} abonnés - {(tier.revenue / 100).toFixed(2)}€
                        </span>
                      </div>
                      <div className="h-2 bg-muted rounded-full overflow-hidden">
                        <div
                          className="h-full transition-all"
                          style={{
                            width: `${(tier.revenue / analytics.revenue.total * 100).toFixed(0)}%`,
                            backgroundColor: COLORS[index % COLORS.length],
                          }}
                        />
                      </div>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          </div>
        </TabsContent>
      </Tabs>
    </div>
  )
}
