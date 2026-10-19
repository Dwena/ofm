'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { ReportsQueue } from '@/components/admin/reports-queue';
import { ContentModeration } from '@/components/moderation/ContentModeration';
import { UserModeration } from '@/components/moderation/UserModeration';
import { ModerationStats } from '@/components/moderation/ModerationStats';
import { AlertTriangle, FileText, Users, BarChart3, Shield } from 'lucide-react';
import { adminApi } from '@/lib/api';
import { useAuth } from '@/contexts/auth-context';

export default function ModerationPage() {
  const [activeTab, setActiveTab] = useState('reports');
  const { user } = useAuth();
  // Moderators only triage reports; content & user sanctions are admin-only
  const isAdmin = user?.role === 'ADMIN';

  const { data: stats } = useQuery({
    queryKey: ['moderation-stats', isAdmin],
    queryFn: async () => {
      const [moderation, flagged, suspended] = await Promise.all([
        adminApi.getModerationStats(1),
        isAdmin ? adminApi.getContent({ filter: 'FLAGGED', limit: 1 }) : null,
        isAdmin ? adminApi.getUsers({ status: 'SUSPENDED', limit: 1 }) : null,
      ]);
      return {
        pendingReports: (moderation.data?.totals?.pending as number) || 0,
        contentUnderReview: (flagged?.data?.pagination?.total as number) || 0,
        suspendedUsers: (suspended?.data?.pagination?.total as number) || 0,
        todayActions: (moderation.data?.totals?.todayActions as number) || 0,
      };
    },
    refetchInterval: 30000,
  });

  const cards = [
    {
      title: 'Signalements en attente',
      value: stats?.pendingReports,
      description: 'À traiter en priorité',
      icon: <AlertTriangle className="h-4 w-4 text-orange-500" />,
      tab: 'reports',
      show: true,
    },
    {
      title: 'Contenus en révision',
      value: stats?.contentUnderReview,
      description: 'Signalés ou en attente de validation',
      icon: <FileText className="h-4 w-4 text-blue-500" />,
      tab: 'content',
      show: isAdmin,
    },
    {
      title: 'Utilisateurs suspendus',
      value: stats?.suspendedUsers,
      description: 'Suspensions actives',
      icon: <Users className="h-4 w-4 text-yellow-500" />,
      tab: 'users',
      show: isAdmin,
    },
    {
      title: "Actions aujourd'hui",
      value: stats?.todayActions,
      description: 'Décisions prises',
      icon: <BarChart3 className="h-4 w-4 text-green-500" />,
      tab: 'stats',
      show: true,
    },
  ].filter((card) => card.show);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold flex items-center gap-2">
          <Shield className="h-7 w-7" />
          Modération
        </h1>
        <p className="text-muted-foreground mt-1">
          {isAdmin
            ? 'Gérez les signalements, contenus et utilisateurs de la plateforme'
            : 'Examinez les signalements et transmettez les cas graves aux administrateurs'}
        </p>
      </div>

      {/* Quick Stats */}
      <div className={`grid gap-4 grid-cols-1 sm:grid-cols-2 ${isAdmin ? 'lg:grid-cols-4' : ''}`}>
        {cards.map((card) => (
          <button
            key={card.title}
            type="button"
            onClick={() => setActiveTab(card.tab)}
            className="text-left rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <Card className="h-full transition-colors hover:bg-muted/50">
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">{card.title}</CardTitle>
                {card.icon}
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">{card.value ?? '…'}</div>
                <p className="text-xs text-muted-foreground">{card.description}</p>
              </CardContent>
            </Card>
          </button>
        ))}
      </div>

      {/* Main Content */}
      <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-4">
        <div className="overflow-x-auto">
          <TabsList>
            <TabsTrigger value="reports" className="flex items-center gap-2">
              <AlertTriangle className="h-4 w-4" />
              Signalements
              {!!stats?.pendingReports && (
                <span className="ml-1 bg-orange-500 text-white text-xs rounded-full px-2 py-0.5">
                  {stats.pendingReports}
                </span>
              )}
            </TabsTrigger>
            {isAdmin && (
              <TabsTrigger value="content" className="flex items-center gap-2">
                <FileText className="h-4 w-4" />
                Contenus
              </TabsTrigger>
            )}
            {isAdmin && (
              <TabsTrigger value="users" className="flex items-center gap-2">
                <Users className="h-4 w-4" />
                Utilisateurs
              </TabsTrigger>
            )}
            <TabsTrigger value="stats" className="flex items-center gap-2">
              <BarChart3 className="h-4 w-4" />
              Statistiques
            </TabsTrigger>
          </TabsList>
        </div>

        <TabsContent value="reports" className="space-y-4">
          <ReportsQueue />
        </TabsContent>

        {isAdmin && (
          <TabsContent value="content" className="space-y-4">
            <ContentModeration />
          </TabsContent>
        )}

        {isAdmin && (
          <TabsContent value="users" className="space-y-4">
            <UserModeration />
          </TabsContent>
        )}

        <TabsContent value="stats" className="space-y-4">
          <ModerationStats />
        </TabsContent>
      </Tabs>
    </div>
  );
}
