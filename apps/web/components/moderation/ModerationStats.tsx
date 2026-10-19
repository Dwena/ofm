'use client';

import { useState } from 'react';
import { useQuery, keepPreviousData } from '@tanstack/react-query';
import { format, parseISO } from 'date-fns';
import { fr } from 'date-fns/locale';
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
} from 'recharts';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { adminApi } from '@/lib/api';
import { ACTION_LABELS, EmptyState, ErrorState, LoadingState, timeAgo } from '@/components/admin/admin-shared';
import {
  ChartLegend,
  ChartTooltip,
  StatTile,
  VIZ,
  axisProps,
  formatNumber,
  gridProps,
} from '@/components/admin/admin-charts';

interface ModerationStatsResponse {
  period: { start: string; end: string; days: number };
  totals: {
    received: number;
    handled: number;
    pending: number;
    resolutionRate: number;
    avgHandlingHours: number | null;
    medianHandlingHours: number | null;
    actions: number;
    todayActions: number;
  };
  byStatus: { status: string; count: number }[];
  byReason: { reason: string; count: number }[];
  byType: { type: string; count: number }[];
  overTime: { date: string; received: number; handled: number }[];
  actionsByDay: {
    date: string;
    resolved: number;
    rejected: number;
    sanctions: number;
    contentRemoved: number;
    other: number;
  }[];
  actionsByType: { action: string; count: number }[];
  recentActions: {
    id: string;
    action: string;
    resource: string;
    resourceId: string | null;
    createdAt: string;
    actor: { id: string; username: string; displayName?: string | null } | null;
  }[];
}

const REASON_LABELS: Record<string, string> = {
  SPAM: 'Spam',
  HARASSMENT: 'Harcèlement',
  HATE_SPEECH: 'Discours haineux',
  NUDITY: 'Nudité',
  VIOLENCE: 'Violence',
  FAKE_NEWS: 'Fausse information',
  COPYRIGHT: "Droits d'auteur",
  UNDERAGE: 'Mineur',
  ILLEGAL_CONTENT: 'Contenu illégal',
  OTHER: 'Autre',
};

const TYPE_LABELS: Record<string, string> = {
  USER: 'Utilisateurs',
  CONTENT: 'Contenus',
  COMMENT: 'Commentaires',
  MESSAGE: 'Messages',
};

const RESOURCE_LABELS: Record<string, string> = {
  USER: 'Utilisateur',
  CONTENT: 'Contenu',
  REPORT: 'Signalement',
  SETTINGS: 'Paramètres',
};

const STATUS_LABELS: Record<string, string> = {
  PENDING: 'En attente',
  REVIEWING: 'En examen',
  RESOLVED: 'Résolus',
  REJECTED: 'Rejetés',
};

const ACTION_SERIES = [
  { key: 'resolved', label: 'Résolus', color: VIZ[1] },
  { key: 'rejected', label: 'Rejetés', color: VIZ[2] },
  { key: 'sanctions', label: 'Sanctions', color: VIZ[3] },
  { key: 'contentRemoved', label: 'Contenus retirés', color: VIZ[4] },
] as const;

const dayLabel = (date: string | number) => format(parseISO(String(date)), 'd MMM', { locale: fr });

function formatHours(hours: number | null) {
  if (hours === null) return '—';
  if (hours < 1) return `${Math.round(hours * 60)} min`;
  if (hours < 48) return `${hours.toLocaleString('fr-FR')} h`;
  return `${(hours / 24).toLocaleString('fr-FR', { maximumFractionDigits: 1 })} j`;
}

function BreakdownList({ rows, total }: { rows: { label: string; count: number }[]; total: number }) {
  if (!rows.length) return <EmptyState>Aucun signalement sur la période</EmptyState>;
  return (
    <ul className="space-y-3">
      {rows.map((row) => {
        const share = total > 0 ? (row.count / total) * 100 : 0;
        return (
          <li key={row.label} className="space-y-1">
            <div className="flex items-baseline justify-between text-sm">
              <span>{row.label}</span>
              <span className="tabular-nums">
                {formatNumber(row.count)} <span className="text-muted-foreground">({share.toFixed(0)} %)</span>
              </span>
            </div>
            <div className="h-2 rounded-full bg-muted">
              <div className="h-2 rounded-full" style={{ width: `${share}%`, background: VIZ[1] }} />
            </div>
          </li>
        );
      })}
    </ul>
  );
}

export function ModerationStats() {
  const [days, setDays] = useState('30');

  const { data: stats, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['moderation-statistics', days],
    queryFn: async () => {
      const response = await adminApi.getModerationStats(Number(days));
      return response.data as ModerationStatsResponse;
    },
    placeholderData: keepPreviousData,
  });

  if (isLoading) {
    return <LoadingState label="Chargement des statistiques..." />;
  }

  if (isError || !stats) {
    return (
      <ErrorState
        error={error}
        onRetry={() => refetch()}
        label="Impossible de charger les statistiques de modération"
      />
    );
  }

  return (
    <div className="space-y-6" data-testid="moderation-stats">
      <div className="flex justify-end">
        <Select value={days} onValueChange={setDays}>
          <SelectTrigger className="w-48" aria-label="Période">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="7">7 derniers jours</SelectItem>
            <SelectItem value="30">30 derniers jours</SelectItem>
            <SelectItem value="90">90 derniers jours</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Summary */}
      <div className="grid gap-4 md:grid-cols-4">
        <StatTile
          title="Signalements reçus"
          value={formatNumber(stats.totals.received)}
          description={`${stats.period.days} derniers jours • ${formatNumber(stats.totals.pending)} en attente`}
        />
        <StatTile
          title="Taux de résolution"
          value={`${stats.totals.resolutionRate} %`}
          description="Signalements reçus déjà tranchés"
        />
        <StatTile
          title="Temps moyen de traitement"
          value={formatHours(stats.totals.avgHandlingHours)}
          description={`Médiane : ${formatHours(stats.totals.medianHandlingHours)} • ${formatNumber(stats.totals.handled)} traité(s)`}
        />
        <StatTile
          title="Actions de modération"
          value={formatNumber(stats.totals.actions)}
          description={`dont ${formatNumber(stats.totals.todayActions)} aujourd'hui`}
        />
      </div>

      {/* Reports over time */}
      <Card>
        <CardHeader>
          <CardTitle>Signalements reçus et traités</CardTitle>
          <CardDescription>Par jour, sur la période sélectionnée</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <ChartLegend
            items={[
              { label: 'Reçus', color: VIZ[1] },
              { label: 'Traités', color: VIZ[2] },
            ]}
          />
          <ResponsiveContainer width="100%" height={280}>
            <LineChart data={stats.overTime} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
              <CartesianGrid {...gridProps} />
              <XAxis dataKey="date" tickFormatter={dayLabel} minTickGap={24} {...axisProps} />
              <YAxis allowDecimals={false} width={40} {...axisProps} />
              <Tooltip
                cursor={{ stroke: 'hsl(var(--muted-foreground))', strokeDasharray: '3 3' }}
                content={<ChartTooltip labelFormatter={dayLabel} />}
              />
              <Line type="monotone" dataKey="received" name="Reçus" stroke={VIZ[1]} strokeWidth={2} dot={false} activeDot={{ r: 4 }} />
              <Line type="monotone" dataKey="handled" name="Traités" stroke={VIZ[2]} strokeWidth={2} dot={false} activeDot={{ r: 4 }} />
            </LineChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>

      {/* Breakdowns */}
      <div className="grid gap-4 md:grid-cols-3">
        <Card>
          <CardHeader>
            <CardTitle>Par motif</CardTitle>
            <CardDescription>Raisons invoquées</CardDescription>
          </CardHeader>
          <CardContent>
            <BreakdownList
              total={stats.totals.received}
              rows={stats.byReason.map((r) => ({ label: REASON_LABELS[r.reason] || r.reason, count: r.count }))}
            />
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Par type</CardTitle>
            <CardDescription>Éléments signalés</CardDescription>
          </CardHeader>
          <CardContent>
            <BreakdownList
              total={stats.totals.received}
              rows={stats.byType.map((r) => ({ label: TYPE_LABELS[r.type] || r.type, count: r.count }))}
            />
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Par statut</CardTitle>
            <CardDescription>Signalements reçus sur la période</CardDescription>
          </CardHeader>
          <CardContent>
            <BreakdownList
              total={stats.totals.received}
              rows={stats.byStatus
                .filter((r) => r.count > 0)
                .map((r) => ({ label: STATUS_LABELS[r.status] || r.status, count: r.count }))}
            />
          </CardContent>
        </Card>
      </div>

      {/* Actions */}
      <Card>
        <CardHeader>
          <CardTitle>Actions de modération</CardTitle>
          <CardDescription>Décisions enregistrées dans le journal d&apos;audit, par jour</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <ChartLegend items={ACTION_SERIES.map(({ label, color }) => ({ label, color }))} />
          <ResponsiveContainer width="100%" height={280}>
            <BarChart data={stats.actionsByDay} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
              <CartesianGrid {...gridProps} />
              <XAxis dataKey="date" tickFormatter={dayLabel} minTickGap={24} {...axisProps} />
              <YAxis allowDecimals={false} width={40} {...axisProps} />
              <Tooltip cursor={{ fill: 'hsl(var(--muted))' }} content={<ChartTooltip labelFormatter={dayLabel} />} />
              {ACTION_SERIES.map(({ key, label, color }, index) => (
                <Bar
                  key={key}
                  dataKey={key}
                  name={label}
                  stackId="actions"
                  fill={color}
                  stroke="hsl(var(--card))"
                  strokeWidth={1}
                  maxBarSize={24}
                  radius={index === ACTION_SERIES.length - 1 ? [4, 4, 0, 0] : undefined}
                />
              ))}
            </BarChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>

      {/* Recent Activity */}
      <Card>
        <CardHeader>
          <CardTitle>Activité récente</CardTitle>
          <CardDescription>Dernières actions de modération</CardDescription>
        </CardHeader>
        <CardContent>
          {!stats.recentActions.length ? (
            <EmptyState>Aucune action de modération enregistrée</EmptyState>
          ) : (
            <ul className="space-y-3">
              {stats.recentActions.map((log) => (
                <li key={log.id} className="flex items-center justify-between gap-3 rounded-lg border p-3">
                  <div className="min-w-0">
                    <p className="text-sm font-medium">{ACTION_LABELS[log.action] || log.action}</p>
                    <p className="text-xs text-muted-foreground truncate">
                      {RESOURCE_LABELS[log.resource] || log.resource}
                      {log.resourceId ? ` • ${log.resourceId.slice(0, 8)}` : ''} • {timeAgo(log.createdAt)}
                    </p>
                  </div>
                  <span className="text-xs text-muted-foreground whitespace-nowrap">
                    {log.actor ? `@${log.actor.username}` : 'Système'}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
