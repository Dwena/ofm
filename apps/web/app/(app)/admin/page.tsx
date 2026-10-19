'use client';

import { useQuery } from '@tanstack/react-query';
import { adminApi } from '@/lib/api';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Users,
  FileText,
  DollarSign,
  AlertTriangle,
  TrendingUp,
  TrendingDown,
  Activity,
  Shield,
  Ban,
  CheckCircle,
  Clock,
  ScrollText,
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

// Shape returned by GET /admin/stats/platform (last 30 days by default)
interface PlatformStats {
  users: { total: number; new: number; active: number; creators: number; newCreators: number };
  content: { total: number; new: number };
  subscriptions: { total: number; active: number; churnRate: number };
  revenue: { total: number; platformFees: number };
  reports: { total: number; pending: number };
}

interface RecentUser {
  id: string;
  username: string;
  email: string;
  role: string;
  avatar?: string;
  createdAt: string;
  status: 'ACTIVE' | 'SUSPENDED' | 'BANNED' | 'PENDING_VERIFICATION';
}

interface PendingReport {
  id: string;
  reportedType: string;
  reason: string;
  status: string;
  reportedUser: {
    username: string;
    avatar?: string;
  } | null;
  reporter: {
    username: string;
  };
  createdAt: string;
}

export default function AdminDashboardPage() {
  // Access is guarded by app/(app)/admin/layout.tsx
  const { user } = useAuth();
  const router = useRouter();

  // Fetch dashboard stats
  const { data: stats } = useQuery({
    queryKey: ['admin-stats'],
    queryFn: async () => {
      const response = await adminApi.getStats();
      return response.data as PlatformStats;
    },
    refetchInterval: 60000,
  });

  // Fetch recent users
  const { data: recentUsers, isLoading: usersLoading } = useQuery({
    queryKey: ['admin-recent-users'],
    queryFn: async () => {
      const response = await adminApi.getRecentUsers();
      return (response.data?.items ?? []) as RecentUser[];
    },
  });

  // Fetch pending reports
  const { data: pendingReports, isLoading: reportsLoading } = useQuery({
    queryKey: ['admin-pending-reports'],
    queryFn: async () => {
      const response = await adminApi.getPendingReports();
      return (response.data?.items ?? []) as PendingReport[];
    },
    refetchInterval: 30000,
  });

  if (!user || user.role !== 'ADMIN') {
    return null;
  }

  const statCards = [
    {
      title: 'Utilisateurs totaux',
      value: (stats?.users.total ?? 0).toLocaleString('fr-FR'),
      description: `+${stats?.users.new ?? 0} sur 30 jours`,
      icon: Users,
      trend: (stats?.users.new ?? 0) > 0 ? 'up' : undefined,
      color: 'text-blue-500',
    },
    {
      title: 'Créateurs',
      value: (stats?.users.creators ?? 0).toLocaleString('fr-FR'),
      description: `+${stats?.users.newCreators ?? 0} sur 30 jours`,
      icon: Shield,
      color: 'text-purple-500',
    },
    {
      title: 'Revenus (30 jours)',
      value: `${(stats?.revenue.total ?? 0).toLocaleString('fr-FR')} €`,
      description: `${(stats?.revenue.platformFees ?? 0).toLocaleString('fr-FR')} € de commissions`,
      icon: DollarSign,
      color: 'text-green-500',
    },
    {
      title: 'Signalements en attente',
      value: (stats?.reports.pending ?? 0).toLocaleString('fr-FR'),
      description: 'Nécessitent une modération',
      icon: AlertTriangle,
      color: 'text-red-500',
    },
    {
      title: 'Publications',
      value: (stats?.content.total ?? 0).toLocaleString('fr-FR'),
      description: `+${stats?.content.new ?? 0} sur 30 jours`,
      icon: FileText,
      color: 'text-orange-500',
    },
    {
      title: 'Abonnements actifs',
      value: (stats?.subscriptions.active ?? 0).toLocaleString('fr-FR'),
      description: `${(stats?.users.active ?? 0).toLocaleString('fr-FR')} utilisateurs actifs`,
      icon: Activity,
      trend: undefined as 'up' | 'down' | undefined,
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
          onClick={() => router.push('/admin/logs')}
        >
          <ScrollText className="h-6 w-6" />
          <span>Journaux</span>
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
                      onClick={() => router.push('/admin/users')}
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
                        ) : user.status === 'PENDING_VERIFICATION' ? (
                          <Badge variant="secondary">Non vérifié</Badge>
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
                    onClick={() => router.push('/admin/reports')}
                  >
                    <Avatar className="h-10 w-10">
                      <AvatarImage src={report.reportedUser?.avatar} />
                      <AvatarFallback>
                        {(report.reportedUser?.username ?? '??').substring(0, 2).toUpperCase()}
                      </AvatarFallback>
                    </Avatar>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <p className="font-medium text-sm">
                          @{report.reportedUser?.username ?? 'inconnu'}
                        </p>
                        <Badge variant="outline" className="text-xs">
                          {report.reportedType}
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
