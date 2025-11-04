'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { analyticsApi } from '@/lib/api';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Loader2, Users, Eye, Heart, MessageCircle, DollarSign, TrendingUp, TrendingDown, Calendar, Download } from 'lucide-react';
import { LineChart, Line, BarChart, Bar, PieChart, Pie, Cell, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';

const COLORS = ['#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6'];

export default function DetailedStatsPage() {
  const [period, setPeriod] = useState('30d');
  const [contentType, setContentType] = useState('all');

  const { data: overview, isLoading } = useQuery({
    queryKey: ['analytics-overview', period],
    queryFn: async () => {
      const response = await analyticsApi.getOverview(period);
      return response.data;
    },
  });

  const { data: engagement } = useQuery({
    queryKey: ['engagement-stats', period],
    queryFn: async () => {
      const response = await analyticsApi.getEngagementStats(period);
      return response.data;
    },
  });

  const { data: subscribers } = useQuery({
    queryKey: ['subscriber-growth', period],
    queryFn: async () => {
      const response = await analyticsApi.getSubscriberGrowth(period);
      return response.data;
    },
  });

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <Loader2 className="h-8 w-8 animate-spin" />
      </div>
    );
  }

  const stats = [
    { label: 'Vues totales', value: overview?.totalViews || 0, icon: Eye, change: '+12%', positive: true },
    { label: 'Abonnés', value: overview?.totalSubscribers || 0, icon: Users, change: '+8%', positive: true },
    { label: 'Likes', value: overview?.totalLikes || 0, icon: Heart, change: '+15%', positive: true },
    { label: 'Commentaires', value: overview?.totalComments || 0, icon: MessageCircle, change: '+5%', positive: true },
    { label: 'Revenus', value: `${overview?.totalRevenue || 0}€`, icon: DollarSign, change: '+20%', positive: true },
  ];

  return (
    <div className="container max-w-7xl py-8 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">Statistiques Détaillées</h1>
          <p className="text-muted-foreground mt-2">Analysez vos performances en profondeur</p>
        </div>
        <div className="flex gap-2">
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
          <Button variant="outline">
            <Download className="h-4 w-4 mr-2" />
            Exporter
          </Button>
        </div>
      </div>

      {/* Key Metrics */}
      <div className="grid md:grid-cols-5 gap-4">
        {stats.map((stat, index) => (
          <Card key={index}>
            <CardContent className="pt-6">
              <div className="flex items-start justify-between">
                <div>
                  <p className="text-sm text-muted-foreground">{stat.label}</p>
                  <p className="text-2xl font-bold mt-1">{stat.value}</p>
                  <div className={`flex items-center gap-1 mt-2 text-sm ${stat.positive ? 'text-green-600' : 'text-red-600'}`}>
                    {stat.positive ? <TrendingUp className="h-4 w-4" /> : <TrendingDown className="h-4 w-4" />}
                    <span>{stat.change}</span>
                  </div>
                </div>
                <div className="h-10 w-10 bg-primary/10 rounded-full flex items-center justify-center">
                  <stat.icon className="h-5 w-5 text-primary" />
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      <Tabs defaultValue="overview" className="space-y-6">
        <TabsList>
          <TabsTrigger value="overview">Vue d'ensemble</TabsTrigger>
          <TabsTrigger value="engagement">Engagement</TabsTrigger>
          <TabsTrigger value="revenue">Revenus</TabsTrigger>
          <TabsTrigger value="content">Contenu</TabsTrigger>
        </TabsList>

        {/* Overview Tab */}
        <TabsContent value="overview" className="space-y-6">
          <div className="grid md:grid-cols-2 gap-6">
            <Card>
              <CardHeader>
                <CardTitle>Croissance des abonnés</CardTitle>
                <CardDescription>Évolution sur les {period === '7d' ? '7 derniers jours' : period === '30d' ? '30 derniers jours' : period === '90d' ? '90 derniers jours' : '12 derniers mois'}</CardDescription>
              </CardHeader>
              <CardContent>
                <ResponsiveContainer width="100%" height={300}>
                  <LineChart data={subscribers?.data || []}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="date" />
                    <YAxis />
                    <Tooltip />
                    <Legend />
                    <Line type="monotone" dataKey="subscribers" stroke="#3b82f6" strokeWidth={2} />
                  </LineChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Vues de contenu</CardTitle>
                <CardDescription>Nombre de vues par jour</CardDescription>
              </CardHeader>
              <CardContent>
                <ResponsiveContainer width="100%" height={300}>
                  <BarChart data={engagement?.viewsPerDay || []}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="date" />
                    <YAxis />
                    <Tooltip />
                    <Legend />
                    <Bar dataKey="views" fill="#10b981" />
                  </BarChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        {/* Engagement Tab */}
        <TabsContent value="engagement" className="space-y-6">
          <div className="grid md:grid-cols-2 gap-6">
            <Card>
              <CardHeader>
                <CardTitle>Répartition de l'engagement</CardTitle>
                <CardDescription>Types d'interactions</CardDescription>
              </CardHeader>
              <CardContent>
                <ResponsiveContainer width="100%" height={300}>
                  <PieChart>
                    <Pie
                      data={[
                        { name: 'Likes', value: overview?.totalLikes || 0 },
                        { name: 'Commentaires', value: overview?.totalComments || 0 },
                        { name: 'Partages', value: overview?.totalShares || 0 },
                      ]}
                      cx="50%"
                      cy="50%"
                      labelLine={false}
                      label
                      outerRadius={100}
                      fill="#8884d8"
                      dataKey="value"
                    >
                      {COLORS.map((color, index) => (
                        <Cell key={`cell-${index}`} fill={color} />
                      ))}
                    </Pie>
                    <Tooltip />
                    <Legend />
                  </PieChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Taux d'engagement</CardTitle>
                <CardDescription>Par type de contenu</CardDescription>
              </CardHeader>
              <CardContent>
                <ResponsiveContainer width="100%" height={300}>
                  <BarChart data={engagement?.byContentType || []}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="type" />
                    <YAxis />
                    <Tooltip />
                    <Legend />
                    <Bar dataKey="rate" fill="#8b5cf6" />
                  </BarChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        {/* Revenue Tab */}
        <TabsContent value="revenue" className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Revenus par source</CardTitle>
              <CardDescription>Répartition de vos revenus</CardDescription>
            </CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height={400}>
                <BarChart data={overview?.revenueBySource || [
                  { source: 'Abonnements', amount: 5000 },
                  { source: 'Tips', amount: 1200 },
                  { source: 'PPV', amount: 800 },
                ]}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="source" />
                  <YAxis />
                  <Tooltip />
                  <Legend />
                  <Bar dataKey="amount" fill="#f59e0b" />
                </BarChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Content Tab */}
        <TabsContent value="content" className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Performances du contenu</CardTitle>
              <CardDescription>Top 10 de vos contenus les plus performants</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                {overview?.topContent?.slice(0, 10).map((content: any, index: number) => (
                  <div key={content.id} className="flex items-center justify-between p-4 border rounded-lg">
                    <div className="flex items-center gap-4">
                      <span className="font-bold text-2xl text-muted-foreground">#{index + 1}</span>
                      <div>
                        <p className="font-medium">{content.title}</p>
                        <p className="text-sm text-muted-foreground">{content.type}</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-6 text-sm">
                      <div className="text-center">
                        <Eye className="h-4 w-4 mx-auto mb-1 text-muted-foreground" />
                        <p className="font-medium">{content.views}</p>
                      </div>
                      <div className="text-center">
                        <Heart className="h-4 w-4 mx-auto mb-1 text-muted-foreground" />
                        <p className="font-medium">{content.likes}</p>
                      </div>
                      <div className="text-center">
                        <MessageCircle className="h-4 w-4 mx-auto mb-1 text-muted-foreground" />
                        <p className="font-medium">{content.comments}</p>
                      </div>
                    </div>
                  </div>
                )) || <p className="text-center text-muted-foreground py-8">Aucun contenu disponible</p>}
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
