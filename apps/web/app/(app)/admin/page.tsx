'use client';

import { useState, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { adminApi } from '@/lib/api';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Users,
  FileText,
  DollarSign,
  AlertTriangle,
  TrendingUp,
  TrendingDown,
  Activity,
  Shield,
  Eye,
  Ban,
  CheckCircle,
  XCircle,
  Clock,
  BarChart3
} from 'lucide-react';
import { useAuth } from '@/contexts/auth-context';
import { useRouter } from 'next/navigation';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { formatDistanceToNow } from 'date-fns';
import { fr } from 'date-fns/locale';

interface DashboardStats {
  totalUsers: number;
  totalCreators: number;
  totalSubscribers: number;
  totalRevenue: number;
  monthlyRevenue: number;
  totalPosts: number;
  pendingReports: number;
  activeStreams: number;
  userGrowth: number;
  revenueGrowth: number;
}

interface RecentUser {
  id: string;
  username: string;
  email: string;
  role: string;
  avatar?: string;
  createdAt: string;
  status: 'ACTIVE' | 'SUSPENDED' | 'BANNED';
}

interface PendingReport {
  id: string;
  type: string;
  reason: string;
  status: 'PENDING' | 'RESOLVED' | 'DISMISSED';
  reportedUser: {
    username: string;
    avatar?: string;
  };
  reporter: {
    username: string;
  };
  createdAt: string;
}

export default function AdminDashboardPage() {
  const { user } = useAuth();
  const router = useRouter();

  // Check if user is admin
  useEffect(() => {
    if (user && user.role !== 'ADMIN') {
      router.push('/');
    }
  }, [user, router]);

  // Fetch dashboard stats
  const { data: stats, isLoading: statsLoading } = useQuery({
    queryKey: ['admin-stats'],
    queryFn: async () => {
      const response = await adminApi.getStats();
      return response.data as DashboardStats;
    },
  });

  // Fetch recent users
  const { data: recentUsers, isLoading: usersLoading } = useQuery({
    queryKey: ['admin-recent-users'],
    queryFn: async () => {
      const response = await adminApi.getRecentUsers();
      return response.data as RecentUser[];
    },
  });

  // Fetch pending reports
  const { data: pendingReports, isLoading: reportsLoading } = useQuery({
    queryKey: ['admin-pending-reports'],
    queryFn: async () => {
      const response = await adminApi.getPendingReports();
      return response.data as PendingReport[];
    },
  });

  if (!user || user.role !== 'ADMIN') {
    return null;
  }

  const statCards = [
    {
      title: 'Utilisateurs totaux',
      value: stats?.totalUsers.toLocaleString() || '0',
      description: `+${stats?.userGrowth || 0}% ce mois`,
      icon: Users,
      trend: (stats?.userGrowth || 0) > 0 ? 'up' : 'down',
      color: 'text-blue-500',
    },
    {
      title: 'Créateurs',
      value: stats?.totalCreators.toLocaleString() || '0',
      description: 'Comptes créateurs actifs',
      icon: Shield,
      color: 'text-purple-500',
    },
    {
      title: 'Revenus mensuels',
      value: `${stats?.monthlyRevenue.toLocaleString() || 0}€`,
      description: `+${stats?.revenueGrowth || 0}% vs mois dernier`,
      icon: DollarSign,
      trend: (stats?.revenueGrowth || 0) > 0 ? 'up' : 'down',
      color: 'text-green-500',
    },
    {
      title: 'Rapports en attente',
      value: stats?.pendingReports.toLocaleString() || '0',
      description: 'Nécessitent une modération',
      icon: AlertTriangle,
      color: 'text-red-500',
    },
    {
      title: 'Publications totales',
      value: stats?.totalPosts.toLocaleString() || '0',
      description: 'Contenu sur la plateforme',
      icon: FileText,
      color: 'text-orange-500',
    },
    {
      title: 'Streams en direct',
      value: stats?.activeStreams.toLocaleString() || '0',
      description: 'Actuellement actifs',
      icon: Activity,
      color: 'text-pink-500',
    },
  ];

  return (
    <div className="container mx-auto py-8 px-4">
      {/* Header */}
      <div className="mb-8">
        <h1 className="text-3xl font-bold flex items-center gap-2">
          <Shield className="h-8 w-8" />
          Panneau d'administration
        </h1>
        <p className="text-muted-foreground mt-2">
          Gérez les utilisateurs, le contenu et les paramètres de la plateforme
        </p>
      </div>

      {/* Quick Navigation */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
        <Button
          variant="outline"
          className="h-auto py-6 flex flex-col items-center gap-2"
          onClick={() => router.push('/admin/users')}
        >
          <Users className="h-6 w-6" />
          <span>Utilisateurs</span>
        </Button>
        <Button
          variant="outline"
          className="h-auto py-6 flex flex-col items-center gap-2"
          onClick={() => router.push('/admin/content')}
        >
          <FileText className="h-6 w-6" />
          <span>Contenu</span>
        </Button>
        <Button
          variant="outline"
          className="h-auto py-6 flex flex-col items-center gap-2"
          onClick={() => router.push('/admin/reports')}
        >
          <AlertTriangle className="h-6 w-6" />
          <span>Rapports</span>
        </Button>
        <Button
          variant="outline"
          className="h-auto py-6 flex flex-col items-center gap-2"
          onClick={() => router.push('/admin/analytics')}
        >
          <BarChart3 className="h-6 w-6" />
          <span>Analytiques</span>
        </Button>
      </div>

      {/* Stats Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 mb-8">
        {statCards.map((stat, index) => (
          <Card key={index}>
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">
                {stat.title}
              </CardTitle>
              <stat.icon className={`h-5 w-5 ${stat.color}`} />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{stat.value}</div>
              <div className="flex items-center gap-1 text-xs text-muted-foreground mt-1">
                {stat.trend && (
                  <>
                    {stat.trend === 'up' ? (
                      <TrendingUp className="h-3 w-3 text-green-500" />
                    ) : (
                      <TrendingDown className="h-3 w-3 text-red-500" />
                    )}
                  </>
                )}
                <span>{stat.description}</span>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Recent Activity */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Recent Users */}
        <Card>
          <CardHeader>
            <CardTitle>Utilisateurs récents</CardTitle>
            <CardDescription>
              Dernières inscriptions sur la plateforme
            </CardDescription>
          </CardHeader>
          <CardContent>
            {usersLoading ? (
              <div className="flex justify-center py-8">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
              </div>
            ) : recentUsers && recentUsers.length > 0 ? (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Utilisateur</TableHead>
                    <TableHead>Rôle</TableHead>
                    <TableHead>Statut</TableHead>
                    <TableHead>Inscription</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {recentUsers.slice(0, 5).map((user) => (
                    <TableRow
                      key={user.id}
                      className="cursor-pointer hover:bg-muted/50"
                      onClick={() => router.push(`/admin/users/${user.id}`)}
                    >
                      <TableCell>
                        <div className="flex items-center gap-2">
                          <Avatar className="h-8 w-8">
                            <AvatarImage src={user.avatar} />
                            <AvatarFallback>
                              {user.username.substring(0, 2).toUpperCase()}
                            </AvatarFallback>
                          </Avatar>
                          <div>
                            <p className="font-medium">@{user.username}</p>
                            <p className="text-xs text-muted-foreground">{user.email}</p>
                          </div>
                        </div>
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline">{user.role}</Badge>
                      </TableCell>
                      <TableCell>
                        {user.status === 'ACTIVE' ? (
                          <Badge variant="default" className="bg-green-500">
                            <CheckCircle className="h-3 w-3 mr-1" />
                            Actif
                          </Badge>
                        ) : user.status === 'SUSPENDED' ? (
                          <Badge variant="default" className="bg-yellow-500">
                            <Clock className="h-3 w-3 mr-1" />
                            Suspendu
                          </Badge>
                        ) : (
                          <Badge variant="destructive">
                            <Ban className="h-3 w-3 mr-1" />
                            Banni
                          </Badge>
                        )}
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {formatDistanceToNow(new Date(user.createdAt), {
                          addSuffix: true,
                          locale: fr,
                        })}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            ) : (
              <p className="text-center text-muted-foreground py-8">
                Aucun utilisateur récent
              </p>
            )}
          </CardContent>
        </Card>

        {/* Pending Reports */}
        <Card>
          <CardHeader>
            <CardTitle>Rapports en attente</CardTitle>
            <CardDescription>
              Signalements nécessitant une modération
            </CardDescription>
          </CardHeader>
          <CardContent>
            {reportsLoading ? (
              <div className="flex justify-center py-8">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
              </div>
            ) : pendingReports && pendingReports.length > 0 ? (
              <div className="space-y-4">
                {pendingReports.slice(0, 5).map((report) => (
                  <div
                    key={report.id}
                    className="flex items-start gap-3 p-3 border rounded-lg cursor-pointer hover:bg-muted/50"
                    onClick={() => router.push(`/admin/reports/${report.id}`)}
                  >
                    <Avatar className="h-10 w-10">
                      <AvatarImage src={report.reportedUser.avatar} />
                      <AvatarFallback>
                        {report.reportedUser.username.substring(0, 2).toUpperCase()}
                      </AvatarFallback>
                    </Avatar>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <p className="font-medium text-sm">
                          @{report.reportedUser.username}
                        </p>
                        <Badge variant="outline" className="text-xs">
                          {report.type}
                        </Badge>
                      </div>
                      <p className="text-xs text-muted-foreground line-clamp-2">
                        {report.reason}
                      </p>
                      <p className="text-xs text-muted-foreground mt-1">
                        Par @{report.reporter.username} •{' '}
                        {formatDistanceToNow(new Date(report.createdAt), {
                          addSuffix: true,
                          locale: fr,
                        })}
                      </p>
                    </div>
                    <AlertTriangle className="h-5 w-5 text-red-500 flex-shrink-0" />
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-center text-muted-foreground py-8">
                Aucun rapport en attente
              </p>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
