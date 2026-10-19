'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useInfiniteQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { formatDistanceToNow } from 'date-fns';
import { fr } from 'date-fns/locale';
import { Bell, Check, CheckCheck, Loader2, RefreshCw, Settings, Trash2 } from 'lucide-react';

import { notificationsApi } from '@/lib/api';
import {
  NOTIFICATION_CATEGORIES,
  getNotificationHref,
  type AppNotification,
  type NotificationCategory,
  type NotificationsPage as NotificationsResponse,
} from '@/lib/notifications';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { NotificationIcon } from '@/components/notification-icon';
import { useAuth } from '@/contexts/auth-context';
import { useConfirm } from '@/hooks/use-confirm';
import { useToast } from '@/hooks/use-toast';
import { getApiErrorMessage } from '@/components/auth-shell';

const PAGE_SIZE = 20;

export default function NotificationsPage() {
  const { user } = useAuth();
  const router = useRouter();
  const queryClient = useQueryClient();
  const { confirm } = useConfirm();
  const { toast } = useToast();
  const [filter, setFilter] = useState<'all' | 'unread'>('all');
  const [category, setCategory] = useState<NotificationCategory | 'all'>('all');

  const {
    data,
    isLoading,
    isError,
    refetch,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
  } = useInfiniteQuery({
    queryKey: ['notifications', 'list', filter, category],
    queryFn: async ({ pageParam }) => {
      const response = await notificationsApi.getAll({
        unreadOnly: filter === 'unread',
        category: category === 'all' ? undefined : category,
        page: pageParam,
        limit: PAGE_SIZE,
      });
      return response.data as NotificationsResponse;
    },
    initialPageParam: 1,
    getNextPageParam: (lastPage) => (lastPage.hasMore ? lastPage.page + 1 : undefined),
    refetchInterval: 30000,
    enabled: !!user,
  });

  const notifications = data?.pages.flatMap((page) => page.items) ?? [];
  const total = data?.pages[0]?.total ?? 0;
  const unreadCount = data?.pages[data.pages.length - 1]?.unreadCount ?? 0;

  const onError = (fallback: string) => (error: unknown) =>
    toast({ title: 'Erreur', description: getApiErrorMessage(error, fallback), variant: 'destructive' });

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['notifications'] });

  const markAsReadMutation = useMutation({
    mutationFn: (notificationId: string) => notificationsApi.markAsRead(notificationId),
    onSuccess: invalidate,
    onError: onError('Impossible de marquer la notification comme lue.'),
  });

  const markAllAsReadMutation = useMutation({
    mutationFn: () => notificationsApi.markAllAsRead(),
    onSuccess: () => {
      invalidate();
      toast({ title: 'Toutes les notifications sont marquées comme lues' });
    },
    onError: onError('Impossible de tout marquer comme lu.'),
  });

  const deleteNotificationMutation = useMutation({
    mutationFn: (notificationId: string) => notificationsApi.deleteNotification(notificationId),
    onSuccess: () => {
      invalidate();
      toast({ title: 'Notification supprimée' });
    },
    onError: onError('Impossible de supprimer la notification.'),
  });

  const handleNotificationClick = (notification: AppNotification) => {
    if (!notification.isRead) {
      markAsReadMutation.mutate(notification.id);
    }
    const href = getNotificationHref(notification);
    if (href) {
      router.push(href);
    }
  };

  const handleDelete = async (notification: AppNotification) => {
    const ok = await confirm({
      title: 'Supprimer cette notification ?',
      description: `« ${notification.title} » sera définitivement supprimée.`,
      confirmText: 'Supprimer',
      variant: 'destructive',
    });
    if (ok) {
      deleteNotificationMutation.mutate(notification.id);
    }
  };

  if (!user) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary mx-auto"></div>
          <p className="mt-4 text-muted-foreground">Chargement...</p>
        </div>
      </div>
    );
  }

  const categoryOptions = NOTIFICATION_CATEGORIES.filter((c) => !c.creatorOnly || user.role === 'CREATOR');

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold flex items-center gap-2">
            <Bell className="h-7 w-7 sm:h-8 sm:w-8" />
            Notifications
            {unreadCount > 0 && (
              <Badge variant="destructive" className="ml-2">
                {unreadCount}
              </Badge>
            )}
          </h1>
          <p className="text-muted-foreground mt-2">Restez informé de toute l&apos;activité sur votre compte</p>
        </div>

        <div className="flex flex-wrap gap-2">
          {unreadCount > 0 && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => markAllAsReadMutation.mutate()}
              disabled={markAllAsReadMutation.isPending}
            >
              {markAllAsReadMutation.isPending ? (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              ) : (
                <CheckCheck className="h-4 w-4 mr-2" />
              )}
              Tout marquer comme lu
            </Button>
          )}
          <Button variant="ghost" size="sm" asChild>
            <Link href="/settings?tab=notifications">
              <Settings className="h-4 w-4 mr-2" />
              Préférences
            </Link>
          </Button>
        </div>
      </div>

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <Tabs value={filter} onValueChange={(v) => setFilter(v as 'all' | 'unread')}>
          <TabsList>
            <TabsTrigger value="all">
              Toutes
              {filter === 'all' && total > 0 && (
                <Badge variant="secondary" className="ml-2">
                  {total}
                </Badge>
              )}
            </TabsTrigger>
            <TabsTrigger value="unread">
              Non lues
              {unreadCount > 0 && (
                <Badge variant="destructive" className="ml-2">
                  {unreadCount}
                </Badge>
              )}
            </TabsTrigger>
          </TabsList>
        </Tabs>

        {categoryOptions.length > 0 && (
          <Select value={category} onValueChange={(v) => setCategory(v as NotificationCategory | 'all')}>
            <SelectTrigger className="w-full sm:w-56" aria-label="Filtrer par type">
              <SelectValue placeholder="Tous les types" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Tous les types</SelectItem>
              {categoryOptions.map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
      </div>

      <div className="space-y-2">
        {isLoading ? (
          <div className="flex justify-center py-12">
            <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
          </div>
        ) : isError ? (
          <Card>
            <CardContent className="flex flex-col items-center justify-center py-12 text-center">
              <p className="text-lg font-medium">Impossible de charger les notifications</p>
              <Button variant="outline" className="mt-4" onClick={() => refetch()}>
                <RefreshCw className="h-4 w-4 mr-2" />
                Réessayer
              </Button>
            </CardContent>
          </Card>
        ) : notifications.length > 0 ? (
          <>
            {notifications.map((notification) => {
              const href = getNotificationHref(notification);
              return (
                <Card
                  key={notification.id}
                  role={href ? 'link' : undefined}
                  tabIndex={0}
                  className={`transition-colors hover:bg-muted/50 ${href ? 'cursor-pointer' : ''} ${
                    !notification.isRead ? 'border-l-4 border-l-primary bg-muted/20' : ''
                  }`}
                  onClick={() => handleNotificationClick(notification)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && e.target === e.currentTarget) handleNotificationClick(notification);
                  }}
                >
                  <CardContent className="p-4">
                    <div className="flex items-start gap-3 sm:gap-4">
                      <div className="h-10 w-10 shrink-0 rounded-full bg-muted flex items-center justify-center">
                        <NotificationIcon notification={notification} className="h-5 w-5" />
                      </div>

                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-semibold break-words">{notification.title}</p>
                        <p className="text-sm text-muted-foreground break-words">{notification.message}</p>
                        <p className="text-xs text-muted-foreground mt-1">
                          {formatDistanceToNow(new Date(notification.createdAt), {
                            addSuffix: true,
                            locale: fr,
                          })}
                        </p>
                      </div>

                      <div className="flex items-center gap-1 shrink-0">
                        {!notification.isRead && (
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-8 w-8 p-0"
                            title="Marquer comme lu"
                            aria-label="Marquer comme lu"
                            onClick={(e) => {
                              e.stopPropagation();
                              markAsReadMutation.mutate(notification.id);
                            }}
                            disabled={markAsReadMutation.isPending && markAsReadMutation.variables === notification.id}
                          >
                            <Check className="h-4 w-4 text-primary" />
                          </Button>
                        )}
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-8 w-8 p-0"
                          title="Supprimer"
                          aria-label="Supprimer la notification"
                          onClick={(e) => {
                            e.stopPropagation();
                            handleDelete(notification);
                          }}
                          disabled={
                            deleteNotificationMutation.isPending &&
                            deleteNotificationMutation.variables === notification.id
                          }
                        >
                          {deleteNotificationMutation.isPending &&
                          deleteNotificationMutation.variables === notification.id ? (
                            <Loader2 className="h-4 w-4 animate-spin" />
                          ) : (
                            <Trash2 className="h-4 w-4 text-muted-foreground hover:text-destructive" />
                          )}
                        </Button>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              );
            })}

            <div className="flex flex-col items-center gap-2 pt-2">
              <p className="text-xs text-muted-foreground">
                {notifications.length} sur {total} notification{total > 1 ? 's' : ''}
              </p>
              {hasNextPage && (
                <Button variant="outline" onClick={() => fetchNextPage()} disabled={isFetchingNextPage}>
                  {isFetchingNextPage && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                  Charger plus
                </Button>
              )}
            </div>
          </>
        ) : (
          <Card>
            <CardContent className="flex flex-col items-center justify-center py-12 text-center">
              <Bell className="h-12 w-12 text-muted-foreground mb-4" />
              <p className="text-lg font-medium">Aucune notification</p>
              <p className="text-sm text-muted-foreground mt-2">
                {filter === 'unread'
                  ? 'Vous avez tout lu !'
                  : category !== 'all'
                    ? 'Aucune notification de ce type pour le moment'
                    : 'Vous recevrez des notifications ici'}
              </p>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}
