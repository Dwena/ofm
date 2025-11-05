'use client';

import { useQuery } from '@tanstack/react-query';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  LineChart,
  Line,
  PieChart,
  Pie,
  Cell,
} from 'recharts';
import axios from 'axios';

export function ModerationStats() {
  const { data: stats, isLoading } = useQuery({
    queryKey: ['moderation-statistics'],
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
  });

  // Mock data for charts (replace with real data from API)
  const reportsOverTimeData = [
    { date: 'Lun', reports: 12 },
    { date: 'Mar', reports: 19 },
    { date: 'Mer', reports: 8 },
    { date: 'Jeu', reports: 15 },
    { date: 'Ven', reports: 22 },
    { date: 'Sam', reports: 10 },
    { date: 'Dim', reports: 7 },
  ];

  const reportsByTypeData = [
    { name: 'Spam', value: 45, color: '#fbbf24' },
    { name: 'Harcèlement', value: 30, color: '#ef4444' },
    { name: 'Contenu inapproprié', value: 20, color: '#f97316' },
    { name: 'Autre', value: 5, color: '#94a3b8' },
  ];

  const actionsByDayData = [
    { day: 'Lun', approved: 25, rejected: 8, dismissed: 5 },
    { day: 'Mar', approved: 30, rejected: 10, dismissed: 3 },
    { day: 'Mer', approved: 20, rejected: 5, dismissed: 7 },
    { day: 'Jeu', approved: 28, rejected: 12, dismissed: 4 },
    { day: 'Ven', approved: 35, rejected: 15, dismissed: 6 },
    { day: 'Sam', approved: 18, rejected: 6, dismissed: 2 },
    { day: 'Dim', approved: 15, rejected: 4, dismissed: 3 },
  ];

  if (isLoading) {
    return <div>Chargement des statistiques...</div>;
  }

  return (
    <div className="space-y-6">
      {/* Summary Cards */}
      <div className="grid gap-4 md:grid-cols-3">
        <Card>
          <CardHeader>
            <CardTitle className="text-sm font-medium">
              Total des signalements
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold">{stats?.totalReports || 0}</div>
            <p className="text-xs text-muted-foreground mt-1">
              Ce mois-ci
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-sm font-medium">
              Taux de résolution
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold">
              {stats?.resolutionRate || 0}%
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              Moyenne sur 7 jours
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-sm font-medium">
              Temps moyen de traitement
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold">
              {stats?.avgProcessingTime || 0}h
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              Par signalement
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Reports Over Time */}
      <Card>
        <CardHeader>
          <CardTitle>Signalements cette semaine</CardTitle>
          <CardDescription>
            Évolution des signalements reçus
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ResponsiveContainer width="100%" height={300}>
            <LineChart data={reportsOverTimeData}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="date" />
              <YAxis />
              <Tooltip />
              <Line
                type="monotone"
                dataKey="reports"
                stroke="#3b82f6"
                strokeWidth={2}
                dot={{ fill: '#3b82f6' }}
              />
            </LineChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>

      {/* Reports by Type and Actions */}
      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Signalements par type</CardTitle>
            <CardDescription>Répartition par catégorie</CardDescription>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={300}>
              <PieChart>
                <Pie
                  data={reportsByTypeData}
                  cx="50%"
                  cy="50%"
                  labelLine={false}
                  label={({ name, percent }) =>
                    `${name}: ${(percent * 100).toFixed(0)}%`
                  }
                  outerRadius={80}
                  fill="#8884d8"
                  dataKey="value"
                >
                  {reportsByTypeData.map((entry, index) => (
                    <Cell key={`cell-${index}`} fill={entry.color} />
                  ))}
                </Pie>
                <Tooltip />
              </PieChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Actions de modération</CardTitle>
            <CardDescription>Par jour cette semaine</CardDescription>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={300}>
              <BarChart data={actionsByDayData}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="day" />
                <YAxis />
                <Tooltip />
                <Bar dataKey="approved" stackId="a" fill="#10b981" name="Approuvés" />
                <Bar dataKey="rejected" stackId="a" fill="#ef4444" name="Rejetés" />
                <Bar dataKey="dismissed" stackId="a" fill="#94a3b8" name="Rejetés" />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      </div>

      {/* Recent Activity */}
      <Card>
        <CardHeader>
          <CardTitle>Activité récente</CardTitle>
          <CardDescription>Dernières actions de modération</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-3">
            {[1, 2, 3, 4, 5].map((i) => (
              <div
                key={i}
                className="flex items-center justify-between p-3 border rounded-lg"
              >
                <div className="flex items-center gap-3">
                  <div className="w-2 h-2 bg-green-500 rounded-full"></div>
                  <div>
                    <p className="text-sm font-medium">
                      Signalement #{1000 + i} traité
                    </p>
                    <p className="text-xs text-muted-foreground">
                      Il y a {i * 15} minutes
                    </p>
                  </div>
                </div>
                <span className="text-xs text-muted-foreground">
                  Admin #{i}
                </span>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
