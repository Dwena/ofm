'use client';

import { useState } from 'react';
import Link from 'next/link';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useToast } from '@/hooks/use-toast';
import { useDebounce } from '@/hooks/use-debounce';
import { Ban, Clock, CheckCircle, Search, UserRound } from 'lucide-react';
import { adminApi } from '@/lib/api';
import {
  EmptyState,
  ErrorState,
  LoadingState,
  Paginated,
  PaginationControls,
  ReasonDialog,
  RoleBadge,
  UserStatusBadge,
  formatDateTime,
  getErrorMessage,
  timeAgo,
} from '@/components/admin/admin-shared';

interface User {
  id: string;
  username: string;
  displayName?: string | null;
  email: string;
  avatar?: string | null;
  status: string;
  role: string;
  createdAt: string;
}

type Action = 'SUSPEND' | 'BAN' | 'ACTIVATE';

const actionConfig: Record<Action, { title: string; description: string; confirm: string; success: string }> = {
  SUSPEND: {
    title: "Suspendre l'utilisateur",
    description: "L'utilisateur ne pourra plus se connecter pendant la durée choisie.",
    confirm: 'Suspendre',
    success: 'Utilisateur suspendu',
  },
  BAN: {
    title: "Bannir l'utilisateur",
    description: "L'utilisateur sera banni de la plateforme jusqu'à réactivation manuelle.",
    confirm: 'Bannir',
    success: 'Utilisateur banni',
  },
  ACTIVATE: {
    title: 'Réactiver le compte',
    description: "La suspension ou le bannissement sera levé et l'utilisateur notifié.",
    confirm: 'Réactiver',
    success: 'Compte réactivé',
  },
};

/**
 * « Utilisateurs » tab of /admin/moderation: quick sanctions (admin-only API).
 * Uses the same endpoint as /admin/users so every action is audited identically.
 */
export function UserModeration() {
  const [searchQuery, setSearchQuery] = useState('');
  const [status, setStatus] = useState('all');
  const [page, setPage] = useState(1);
  const [target, setTarget] = useState<{ user: User; action: Action } | null>(null);
  const [reason, setReason] = useState('');
  const [durationDays, setDurationDays] = useState('7');

  const debouncedSearch = useDebounce(searchQuery, 400);
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['admin-users', 'moderation-tab', debouncedSearch, status, page],
    queryFn: async () => {
      const response = await adminApi.getUsers({
        query: debouncedSearch.trim() || undefined,
        status: status !== 'all' ? status : undefined,
        page,
        limit: 10,
      });
      return response.data as Paginated<User>;
    },
    placeholderData: keepPreviousData,
  });

  const mutation = useMutation({
    mutationFn: ({ user, action }: { user: User; action: Action }) =>
      adminApi.moderateUser({
        userId: user.id,
        action,
        reason: reason.trim() || undefined,
        durationDays: action === 'SUSPEND' && durationDays !== 'indefinite' ? Number(durationDays) : undefined,
      }),
    onSuccess: (_data, { action }) => {
      queryClient.invalidateQueries({ queryKey: ['admin-users'] });
      queryClient.invalidateQueries({ queryKey: ['admin-user-details'] });
      queryClient.invalidateQueries({ queryKey: ['moderation-stats'] });
      queryClient.invalidateQueries({ queryKey: ['admin-audit-logs'] });
      toast({ title: actionConfig[action].success });
      setTarget(null);
    },
    onError: (err) => {
      toast({ title: 'Action impossible', description: getErrorMessage(err), variant: 'destructive' });
    },
  });

  const open = (user: User, action: Action) => {
    setReason('');
    setDurationDays('7');
    setTarget({ user, action });
  };

  const users = data?.items ?? [];

  return (
    <>
      <Card>
        <CardHeader>
          <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
            <div>
              <CardTitle>Sanctions</CardTitle>
              <CardDescription>Suspendre, bannir ou réactiver des comptes</CardDescription>
            </div>
            <div className="flex flex-col gap-2 sm:flex-row">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="Rechercher un utilisateur..."
                  value={searchQuery}
                  onChange={(e) => {
                    setSearchQuery(e.target.value);
                    setPage(1);
                  }}
                  className="pl-10 sm:w-64"
                  aria-label="Rechercher un utilisateur"
                />
              </div>
              <Select
                value={status}
                onValueChange={(value) => {
                  setStatus(value);
                  setPage(1);
                }}
              >
                <SelectTrigger className="sm:w-44" aria-label="Statut">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Tous les statuts</SelectItem>
                  <SelectItem value="ACTIVE">Actifs</SelectItem>
                  <SelectItem value="SUSPENDED">Suspendus</SelectItem>
                  <SelectItem value="BANNED">Bannis</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <LoadingState />
          ) : error ? (
            <ErrorState error={error} onRetry={() => refetch()} label="Impossible de charger les utilisateurs" />
          ) : !users.length ? (
            <EmptyState>Aucun utilisateur trouvé</EmptyState>
          ) : (
            <div className="space-y-3">
              {users.map((user) => (
                <div key={user.id} className="flex flex-col gap-3 rounded-lg border p-4 md:flex-row md:items-start md:justify-between">
                  <div className="flex items-start gap-4 min-w-0">
                    <Avatar className="h-12 w-12">
                      <AvatarImage src={user.avatar || undefined} />
                      <AvatarFallback>{user.username.substring(0, 2).toUpperCase()}</AvatarFallback>
                    </Avatar>

                    <div className="space-y-1 min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-medium truncate">{user.displayName || user.username}</span>
                        <UserStatusBadge status={user.status} />
                        <RoleBadge role={user.role} />
                      </div>
                      <p className="text-sm text-muted-foreground truncate">
                        @{user.username} • {user.email}
                      </p>
                      <p className="text-xs text-muted-foreground">Inscrit {timeAgo(user.createdAt)}</p>
                    </div>
                  </div>

                  <div className="flex flex-wrap gap-2">
                    <Button size="sm" variant="ghost" asChild>
                      <Link href={`/admin/users?user=${user.id}`}>
                        <UserRound className="h-4 w-4 mr-1" />
                        Fiche
                      </Link>
                    </Button>
                    {user.role !== 'ADMIN' && user.status !== 'SUSPENDED' && user.status !== 'BANNED' && (
                      <Button size="sm" variant="outline" onClick={() => open(user, 'SUSPEND')}>
                        <Clock className="h-4 w-4 mr-1" />
                        Suspendre
                      </Button>
                    )}
                    {user.role !== 'ADMIN' && user.status !== 'BANNED' && (
                      <Button size="sm" variant="destructive" onClick={() => open(user, 'BAN')}>
                        <Ban className="h-4 w-4 mr-1" />
                        Bannir
                      </Button>
                    )}
                    {(user.status === 'SUSPENDED' || user.status === 'BANNED') && (
                      <Button size="sm" onClick={() => open(user, 'ACTIVATE')}>
                        <CheckCircle className="h-4 w-4 mr-1" />
                        Réactiver
                      </Button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
          <PaginationControls pagination={data?.pagination} onPageChange={setPage} />
        </CardContent>
      </Card>

      {target && (
        <ReasonDialog
          open={!!target}
          onOpenChange={(isOpen) => !isOpen && !mutation.isPending && setTarget(null)}
          title={actionConfig[target.action].title}
          description={`@${target.user.username} — ${actionConfig[target.action].description}`}
          confirmLabel={actionConfig[target.action].confirm}
          destructive={target.action !== 'ACTIVATE'}
          reason={reason}
          onReasonChange={setReason}
          reasonRequired={target.action !== 'ACTIVATE'}
          isPending={mutation.isPending}
          onConfirm={() => mutation.mutate(target)}
        >
          {target.action === 'SUSPEND' && (
            <div className="space-y-2">
              <Label>Durée</Label>
              <Select value={durationDays} onValueChange={setDurationDays}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="1">1 jour</SelectItem>
                  <SelectItem value="3">3 jours</SelectItem>
                  <SelectItem value="7">7 jours</SelectItem>
                  <SelectItem value="30">30 jours</SelectItem>
                  <SelectItem value="90">90 jours</SelectItem>
                  <SelectItem value="indefinite">Indéterminée</SelectItem>
                </SelectContent>
              </Select>
              {durationDays !== 'indefinite' && (
                <p className="text-xs text-muted-foreground">
                  Fin prévue le {formatDateTime(new Date(Date.now() + Number(durationDays) * 86400000).toISOString())}
                </p>
              )}
            </div>
          )}
        </ReasonDialog>
      )}
    </>
  );
}
