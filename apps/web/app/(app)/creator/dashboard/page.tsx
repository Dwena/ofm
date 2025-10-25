'use client'

import { useQuery } from '@tanstack/react-query'
import { paymentsApi, usersApi, contentApi } from '@/lib/api'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { DollarSign, Users, FileText, TrendingUp, Clock } from 'lucide-react'
import { formatDistanceToNow } from 'date-fns'
import { fr } from 'date-fns/locale'

export default function CreatorDashboard() {
  // Fetch earnings data
  const { data: earnings, isLoading: earningsLoading } = useQuery({
    queryKey: ['creator-earnings'],
    queryFn: async () => {
      const response = await paymentsApi.getCreatorEarnings()
      return response.data
    },
  })

  // Fetch profile data
  const { data: profile, isLoading: profileLoading } = useQuery({
    queryKey: ['creator-profile'],
    queryFn: async () => {
      const response = await usersApi.getProfile()
      return response.data.creatorProfile
    },
  })

  // Fetch recent content
  const { data: content, isLoading: contentLoading } = useQuery({
    queryKey: ['creator-content'],
    queryFn: async () => {
      const response = await contentApi.getMyContent({ page: 1, limit: 5 })
      return response.data
    },
  })

  const isLoading = earningsLoading || profileLoading || contentLoading

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

  const stats = [
    {
      title: 'Revenus Totaux',
      value: `${((earnings?.totalEarnings || 0) / 100).toFixed(2)} €`,
      icon: DollarSign,
      description: 'Depuis le début',
      color: 'text-green-600',
    },
    {
      title: 'Solde Disponible',
      value: `${((earnings?.availableBalance || 0) / 100).toFixed(2)} €`,
      icon: TrendingUp,
      description: 'Prêt pour retrait',
      color: 'text-blue-600',
    },
    {
      title: 'En attente',
      value: `${((earnings?.pendingBalance || 0) / 100).toFixed(2)} €`,
      icon: Clock,
      description: 'En cours de traitement',
      color: 'text-orange-600',
    },
    {
      title: 'Abonnés',
      value: profile?.subscribersCount || 0,
      icon: Users,
      description: `${profile?.activeSubscriptionsCount || 0} actifs`,
      color: 'text-purple-600',
    },
    {
      title: 'Contenus',
      value: profile?.totalContent || 0,
      icon: FileText,
      description: `${profile?.totalContent || 0} publiés`,
      color: 'text-indigo-600',
    },
  ]

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-3xl font-bold">Dashboard Créateur</h1>
        <p className="text-muted-foreground mt-2">
          Bienvenue sur votre espace créateur
        </p>
      </div>

      {/* Stats Cards */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
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
                <p className="text-xs text-muted-foreground">
                  {stat.description}
                </p>
              </CardContent>
            </Card>
          )
        })}
      </div>

      {/* Recent Content */}
      <Card>
        <CardHeader>
          <CardTitle>Contenus Récents</CardTitle>
        </CardHeader>
        <CardContent>
          {content && content.items.length > 0 ? (
            <div className="space-y-4">
              {content.items.map((item: any) => (
                <div
                  key={item.id}
                  className="flex items-center justify-between p-4 border rounded-lg hover:bg-accent transition-colors"
                >
                  <div className="flex-1">
                    <div className="flex items-center space-x-3">
                      <h3 className="font-medium">{item.title}</h3>
                      <Badge variant={item.isPublished ? 'success' : 'secondary'}>
                        {item.isPublished ? 'Publié' : 'Brouillon'}
                      </Badge>
                      <Badge variant="outline">
                        {item.tier}
                      </Badge>
                    </div>
                    {item.description && (
                      <p className="text-sm text-muted-foreground mt-1 line-clamp-1">
                        {item.description}
                      </p>
                    )}
                  </div>
                  <div className="text-sm text-muted-foreground">
                    {formatDistanceToNow(new Date(item.createdAt), {
                      addSuffix: true,
                      locale: fr,
                    })}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="text-center py-8 text-muted-foreground">
              <FileText className="h-12 w-12 mx-auto mb-4 opacity-50" />
              <p>Aucun contenu pour le moment</p>
              <p className="text-sm mt-2">Commencez par uploader votre premier contenu</p>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Recent Transactions */}
      <Card>
        <CardHeader>
          <CardTitle>Transactions Récentes</CardTitle>
        </CardHeader>
        <CardContent>
          {earnings && earnings.recentTransactions && earnings.recentTransactions.length > 0 ? (
            <div className="space-y-4">
              {earnings.recentTransactions.map((transaction: any) => (
                <div
                  key={transaction.id}
                  className="flex items-center justify-between p-4 border rounded-lg"
                >
                  <div>
                    <p className="font-medium">
                      {transaction.type === 'SUBSCRIPTION' && 'Abonnement'}
                      {transaction.type === 'TIP' && 'Pourboire'}
                      {transaction.type === 'PPV' && 'Contenu PPV'}
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
                      +{(transaction.amount / 100).toFixed(2)} €
                    </p>
                    <Badge variant={transaction.status === 'COMPLETED' ? 'success' : 'secondary'}>
                      {transaction.status}
                    </Badge>
                  </div>
                </div>
              ))}
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
