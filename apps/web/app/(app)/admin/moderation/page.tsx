'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { ReportsQueue } from '@/components/moderation/ReportsQueue';
import { ContentModeration } from '@/components/moderation/ContentModeration';
import { UserModeration } from '@/components/moderation/UserModeration';
import { ModerationStats } from '@/components/moderation/ModerationStats';
import { AlertTriangle, FileText, Users, BarChart3 } from 'lucide-react';
import axios from 'axios';

export default function ModerationPage() {
  const [activeTab, setActiveTab] = useState('reports');

  // Fetch pending reports count
  const { data: stats } = useQuery({
    queryKey: ['moderation-stats'],
    queryFn: async () => {
      const response = await axios.get(
        `${process.env.NEXT_PUBLIC_API_URL}/admin/stats/platform`,
        {
          headers: {
            Authorization: `Bearer ${localStorage.getItem('access_token')}`,
          },
        }
      );
      return response.data;
    },
    refetchInterval: 30000, // Refresh every 30 seconds
  });

  return (
    <div className="container mx-auto p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">Modération</h1>
          <p className="text-muted-foreground">
            Gérez les signalements, contenus et utilisateurs de la plateforme
          </p>
        </div>
      </div>

      {/* Quick Stats */}
      <div className="grid gap-4 md:grid-cols-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">
              Signalements en attente
            </CardTitle>
            <AlertTriangle className="h-4 w-4 text-orange-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{stats?.pendingReports || 0}</div>
            <p className="text-xs text-muted-foreground">
              À traiter en priorité
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">
              Contenus en révision
            </CardTitle>
            <FileText className="h-4 w-4 text-blue-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{stats?.contentUnderReview || 0}</div>
            <p className="text-xs text-muted-foreground">
              En attente de validation
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">
              Utilisateurs suspendus
            </CardTitle>
            <Users className="h-4 w-4 text-yellow-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{stats?.suspendedUsers || 0}</div>
            <p className="text-xs text-muted-foreground">
              Suspensions actives
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">
              Actions aujourd'hui
            </CardTitle>
            <BarChart3 className="h-4 w-4 text-green-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{stats?.todayActions || 0}</div>
            <p className="text-xs text-muted-foreground">
              Décisions prises
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Main Content */}
      <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-4">
        <TabsList>
          <TabsTrigger value="reports" className="flex items-center gap-2">
            <AlertTriangle className="h-4 w-4" />
            Signalements
            {stats?.pendingReports > 0 && (
              <span className="ml-2 bg-orange-500 text-white text-xs rounded-full px-2 py-0.5">
                {stats.pendingReports}
              </span>
            )}
          </TabsTrigger>
          <TabsTrigger value="content" className="flex items-center gap-2">
            <FileText className="h-4 w-4" />
            Contenus
          </TabsTrigger>
          <TabsTrigger value="users" className="flex items-center gap-2">
            <Users className="h-4 w-4" />
            Utilisateurs
          </TabsTrigger>
          <TabsTrigger value="stats" className="flex items-center gap-2">
            <BarChart3 className="h-4 w-4" />
            Statistiques
          </TabsTrigger>
        </TabsList>

        <TabsContent value="reports" className="space-y-4">
          <ReportsQueue />
        </TabsContent>

        <TabsContent value="content" className="space-y-4">
          <ContentModeration />
        </TabsContent>

        <TabsContent value="users" className="space-y-4">
          <UserModeration />
        </TabsContent>

        <TabsContent value="stats" className="space-y-4">
          <ModerationStats />
        </TabsContent>
      </Tabs>
    </div>
  );
}
