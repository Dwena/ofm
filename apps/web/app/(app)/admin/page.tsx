'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { adminApi } from '@/lib/api';
import { formatEuros } from '@/lib/utils';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Users,
  FileText,
  Euro,
  AlertTriangle,
  TrendingUp,
  Activity,
  Shield,
  ScrollText,
  BadgeCheck,
  ChevronRight,
} from 'lucide-react';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import {
  EmptyState,
  ErrorState,
  LoadingState,
  RoleBadge,
  UserStatusBadge,
  timeAgo,
} from '@/components/admin/admin-shared';

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
  displayName?: string | null;
  email: string;
  role: string;
  avatar?: string | null;
  createdAt: string;
  status: string;
  kycSubmittedAt?: string | null;
}

interface PendingReport {
  id: string;
  reportedType: string;
  reason: string;
  description?: string | null;
  status: string;
  reportedUser: {
    username: string;
    avatar?: string | null;
  } | null;
  reporter: {
    username: string;
  };
  createdAt: string;
}

const typeLabels: Record<string, string> = {
  USER: 'Utilisateur',
  CONTENT: 'Contenu',
  COMMENT: 'Commentaire',
  MESSAGE: 'Message',
};

const quickLinks = [
  { href: '/admin/users', label: 'Utilisateurs', icon: Users },
  { href: '/admin/content', label: 'Contenus', icon: FileText },
  { href: '/admin/reports', label: 'Signalements', icon: AlertTriangle },
  { href: '/admin/logs', label: 'Journaux', icon: ScrollText },
];

export default function AdminDashboardPage() {
  // Access is guarded by app/(app)/admin/layout.tsx (ADMIN only for this page)
  const router = useRouter();

  const { data: stats, error: statsError, refetch: refetchStats } = useQuery({
    queryKey: ['admin-stats'],
    queryFn: async () => {
      const response = await adminApi.getStats();
      return response.data as PlatformStats;
    },
    refetchInterval: 60000,
  });

  const { data: recentUsers, isLoading: usersLoading, error: usersError } = useQuery({
    queryKey: ['admin-recent-users'],
    queryFn: async () => {
      const response = await adminApi.getRecentUsers();
      return (response.data?.items ?? []) as RecentUser[];
    },
  });

  const { data: pendingReports, isLoading: reportsLoading, error: reportsError } = useQuery({
    queryKey: ['admin-pending-reports'],
    queryFn: async () => {
      const response = await adminApi.getPendingReports();
      return (response.data?.items ?? []) as PendingReport[];
    },
    refetchInterval: 30000,
  });

  const { data: pendingKyc } = useQuery({
    queryKey: ['admin-users', 'kyc-pending'],
    queryFn: async () => {
      const response = await adminApi.getUsers({ kycStatus: 'PENDING', page: 1, limit: 5 });
      return {
        items: (response.data?.items ?? []) as RecentUser[],
        total: (response.data?.pagination?.total ?? 0) as number,
      };
    },
  });

  const statCards = [
    {
      title: 'Utilisateurs totaux',
      value: (stats?.users.total ?? 0).toLocaleString('fr-FR'),
      description: `+${stats?.users.new ?? 0} sur 30 jours`,
      icon: Users,
      trend: (stats?.users.new ?? 0) > 0,
      color: 'text-blue-500',
      href: '/admin/users',
    },
    {
      title: 'Créateurs',
      value: (stats?.users.creators ?? 0).toLocaleString('fr-FR'),
      description: `+${stats?.users.newCreators ?? 0} sur 30 jours`,
      icon: Shield,
      trend: (stats?.users.newCreators ?? 0) > 0,
      color: 'text-purple-500',
      href: '/admin/users?role=CREATOR',
    },
    {
      title: 'Revenus (30 jours)',
      value: formatEuros(stats?.revenue.total ?? 0),
      description: `${formatEuros(stats?.revenue.platformFees ?? 0)} de commissions`,
      icon: Euro,
      color: 'text-green-500',
      href: '/admin/analytics',
    },
    {
      title: 'Signalements en attente',
      value: (stats?.reports.pending ?? 0).toLocaleString('fr-FR'),
      description: 'Nécessitent une modération',
      icon: AlertTriangle,
      color: 'text-red-500',
      href: '/admin/reports',
    },
    {
      title: 'Publications',
      value: (stats?.content.total ?? 0).toLocaleString('fr-FR'),
      description: `+${stats?.content.new ?? 0} sur 30 jours`,
      icon: FileText,
      trend: (stats?.content.new ?? 0) > 0,
      color: 'text-orange-500',
      href: '/admin/content?filter=ALL',
    },
    {
      title: 'Abonnements actifs',
      value: (stats?.subscriptions.active ?? 0).toLocaleString('fr-FR'),
      description: `${(stats?.users.active ?? 0).toLocaleString('fr-FR')} utilisateurs actifs sur 30 jours`,
      icon: Activity,
      color: 'text-pink-500',
      href: '/admin/analytics',
    },
  ];

  return (
    <div className="space-y-8">
      {/* Header */}
      <div>
        <h1 className="text-3xl font-bold flex items-center gap-2">
          <Shield className="h-8 w-8" />
          Panneau d&apos;administration
        </h1>
        <p className="text-muted-foreground mt-2">
          Gérez les utilisateurs, le contenu et les paramètres de la plateforme
        </p>
      </div>

      {/* Quick Navigation */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {quickLinks.map(({ href, label, icon: Icon }) => (
          <Button key={href} variant="outline" className="h-auto py-6 flex flex-col items-center gap-2" asChild>
            <Link href={href}>
              <Icon className="h-6 w-6" />
              <span>{label}</span>
            </Link>
          </Button>
        ))}
      </div>

      {/* Stats Grid */}
      {statsError ? (
        <Card>
          <CardContent>
            <ErrorState error={statsError} onRetry={() => refetchStats()} label="Impossible de charger les statistiques" />
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
          {statCards.map((stat) => (
            <Link key={stat.title} href={stat.href} className="block rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
              <Card className="h-full transition-colors hover:bg-muted/50">
                <CardHeader className="flex flex-row items-center justify-between pb-2">
                  <CardTitle className="text-sm font-medium text-muted-foreground">{stat.title}</CardTitle>
                  <stat.icon className={`h-5 w-5 ${stat.color}`} />
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-bold">{stats ? stat.value : '…'}</div>
                  <div className="flex items-center gap-1 text-xs text-muted-foreground mt-1">
                    {stat.trend && <TrendingUp className="h-3 w-3 text-green-500" />}
                    <span>{stat.description}</span>
                  </div>
                </CardContent>
              </Card>
            </Link>
          ))}
        </div>
      )}

      {/* Pending identity verifications */}
      {!!pendingKyc?.total && (
        <Card className="border-orange-300">
          <CardHeader className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <CardTitle className="flex items-center gap-2">
                <BadgeCheck className="h-5 w-5 text-orange-500" />
                Vérifications d&apos;identité en attente
              </CardTitle>
              <CardDescription>
                {pendingKyc.total} créateur(s) attendent la validation de leur KYC
              </CardDescription>
            </div>
            <Button variant="outline" size="sm" asChild>
              <Link href="/admin/users?kyc=PENDING">
                Tout voir
                <ChevronRight className="h-4 w-4 ml-1" />
              </Link>
            </Button>
          </CardHeader>
          <CardContent className="space-y-2">
            {pendingKyc.items.map((u) => (
              <Link
                key={u.id}
                href={`/admin/users?user=${u.id}`}
                className="flex items-center gap-3 rounded-lg border p-3 hover:bg-muted/50"
              >
                <Avatar className="h-8 w-8">
                  <AvatarImage src={u.avatar || undefined} />
                  <AvatarFallback>{u.username.substring(0, 2).toUpperCase()}</AvatarFallback>
                </Avatar>
                <div className="min-w-0 flex-1">
                  <p className="font-medium truncate">{u.displayName || `@${u.username}`}</p>
                  <p className="text-xs text-muted-foreground truncate">
                    @{u.username} • soumis {timeAgo(u.kycSubmittedAt)}
                  </p>
                </div>
                <ChevronRight className="h-4 w-4 text-muted-foreground" />
              </Link>
            ))}
          </CardContent>
        </Card>
      )}

      {/* Recent Activity */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Recent Users */}
        <Card>
          <CardHeader className="flex flex-row items-start justify-between gap-2">
            <div>
              <CardTitle>Utilisateurs récents</CardTitle>
              <CardDescription>Dernières inscriptions sur la plateforme</CardDescription>
            </div>
            <Button variant="ghost" size="sm" asChild>
              <Link href="/admin/users">Tout voir</Link>
            </Button>
          </CardHeader>
          <CardContent>
            {usersLoading ? (
              <LoadingState />
            ) : usersError ? (
              <ErrorState error={usersError} />
            ) : recentUsers && recentUsers.length > 0 ? (
              <div className="overflow-x-auto">
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
                    {recentUsers.slice(0, 5).map((u) => (
                      <TableRow
                        key={u.id}
                        className="cursor-pointer hover:bg-muted/50"
                        onClick={() => router.push(`/admin/users?user=${u.id}`)}
                      >
                        <TableCell>
                          <div className="flex items-center gap-2">
                            <Avatar className="h-8 w-8">
                              <AvatarImage src={u.avatar || undefined} />
                              <AvatarFallback>{u.username.substring(0, 2).toUpperCase()}</AvatarFallback>
                            </Avatar>
                            <div className="min-w-0">
                              <p className="font-medium truncate">@{u.username}</p>
                              <p className="text-xs text-muted-foreground truncate">{u.email}</p>
                            </div>
                          </div>
                        </TableCell>
                        <TableCell>
                          <RoleBadge role={u.role} />
                        </TableCell>
                        <TableCell>
                          <UserStatusBadge status={u.status} />
                        </TableCell>
                        <TableCell className="text-xs text-muted-foreground whitespace-nowrap">
                          {timeAgo(u.createdAt)}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            ) : (
              <EmptyState>Aucun utilisateur récent</EmptyState>
            )}
          </CardContent>
        </Card>

        {/* Pending Reports */}
        <Card>
          <CardHeader className="flex flex-row items-start justify-between gap-2">
            <div>
              <CardTitle>Signalements en attente</CardTitle>
              <CardDescription>Signalements nécessitant une modération</CardDescription>
            </div>
            <Button variant="ghost" size="sm" asChild>
              <Link href="/admin/reports">Traiter</Link>
            </Button>
          </CardHeader>
          <CardContent>
            {reportsLoading ? (
              <LoadingState />
            ) : reportsError ? (
              <ErrorState error={reportsError} />
            ) : pendingReports && pendingReports.length > 0 ? (
              <div className="space-y-4">
                {pendingReports.slice(0, 5).map((report) => (
                  <Link
                    key={report.id}
                    href="/admin/reports"
                    className="flex items-start gap-3 p-3 border rounded-lg hover:bg-muted/50"
                  >
                    <Avatar className="h-10 w-10">
                      <AvatarImage src={report.reportedUser?.avatar || undefined} />
                      <AvatarFallback>
                        {(report.reportedUser?.username ?? '??').substring(0, 2).toUpperCase()}
                      </AvatarFallback>
                    </Avatar>
                    <div className="flex-1 min-w-0">
                      <div className="flex flex-wrap items-center gap-2 mb-1">
                        <p className="font-medium text-sm">@{report.reportedUser?.username ?? 'inconnu'}</p>
                        <Badge variant="outline" className="text-xs">
                          {typeLabels[report.reportedType] || report.reportedType}
                        </Badge>
                      </div>
                      <p className="text-xs text-muted-foreground line-clamp-2">
                        {report.description || report.reason}
                      </p>
                      <p className="text-xs text-muted-foreground mt-1">
                        Par @{report.reporter?.username} • {timeAgo(report.createdAt)}
                      </p>
                    </div>
                    <AlertTriangle className="h-5 w-5 text-red-500 flex-shrink-0" />
                  </Link>
                ))}
              </div>
            ) : (
              <EmptyState>Aucun signalement en attente</EmptyState>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
