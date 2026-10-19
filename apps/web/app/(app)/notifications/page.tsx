'use client';

import { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { notificationsApi } from '@/lib/api';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Bell,
  MessageCircle,
  UserPlus,
  DollarSign,
  CheckCheck,
  Trash2,
  Loader2,
  Filter
} from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import { fr } from 'date-fns/locale';
import { useAuth } from '@/contexts/auth-context';
import { useRouter } from 'next/navigation';

// Mirrors the NotificationType enum of the API
type NotificationType =
  | 'NEW_SUBSCRIBER'
  | 'NEW_MESSAGE'
  | 'NEW_TIP'
  | 'NEW_COMMENT'
  | 'SUBSCRIPTION_RENEWAL'
  | 'PAYOUT_COMPLETED'
  | 'CONTENT_APPROVED'
  | 'CONTENT_REJECTED'
  | 'SYSTEM';

// Shape returned by GET /notifications
interface Notification {
  id: string;
  type: NotificationType;
  title: string;
  message: string;
  isRead: boolean;
  linkUrl?: string | null;
  createdAt: string;
  metadata?: any;
}

const notificationIcons: Partial<Record<NotificationType, any>> = {
  NEW_SUBSCRIBER: UserPlus,
  NEW_MESSAGE: MessageCircle,
  NEW_TIP: DollarSign,
  NEW_COMMENT: MessageCircle,
  SUBSCRIPTION_RENEWAL: CheckCheck,
  PAYOUT_COMPLETED: DollarSign,
  CONTENT_APPROVED: CheckCheck,
  CONTENT_REJECTED: Bell,
};

const notificationColors: Partial<Record<NotificationType, string>> = {
  NEW_SUBSCRIBER: 'text-green-500',
  NEW_MESSAGE: 'text-purple-500',
  NEW_TIP: 'text-yellow-500',
  NEW_COMMENT: 'text-blue-500',
  SUBSCRIPTION_RENEWAL: 'text-green-500',
  PAYOUT_COMPLETED: 'text-yellow-500',
  CONTENT_APPROVED: 'text-green-500',
  CONTENT_REJECTED: 'text-red-500',
};

export default function NotificationsPage() {
  const { user } = useAuth();
  const router = useRouter();
  const queryClient = useQueryClient();
  const [filter, setFilter] = useState<'all' | 'unread'>('all');

  // Fetch notifications
  const { data: notifications, isLoading } = useQuery({
    queryKey: ['notifications', filter],
    queryFn: async () => {
      const response = await notificationsApi.getAll(filter === 'unread');
      return response.data as Notification[];
    },
    refetchInterval: 30000, // Refetch every 30 seconds
  });

  // Mark as read mutation
  const markAsReadMutation = useMutation({
    mutationFn: async (notificationId: string) => {
      await notificationsApi.markAsRead(notificationId);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['notifications'] });
    },
  });

  // Mark all as read mutation
  const markAllAsReadMutation = useMutation({
    mutationFn: async () => {
      await notificationsApi.markAllAsRead();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['notifications'] });
    },
  });

  // Delete notification mutation
  const deleteNotificationMutation = useMutation({
    mutationFn: async (notificationId: string) => {
      await notificationsApi.deleteNotification(notificationId);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['notifications'] });
    },
  });

  const handleNotificationClick = async (notification: Notification) => {
    if (!notification.isRead) {
      await markAsReadMutation.mutateAsync(notification.id);
    }

    // Navigate based on notification link or type
    if (notification.linkUrl) {
      router.push(notification.linkUrl);
    } else if (notification.type === 'NEW_MESSAGE') {
      router.push('/messages');
    }
  };

  const unreadCount = notifications?.filter(n => !n.isRead).length || 0;

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

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold flex items-center gap-2">
            <Bell className="h-8 w-8" />
            Notifications
            {unreadCount > 0 && (
              <Badge variant="destructive" className="ml-2">
                {unreadCount}
              </Badge>
            )}
          </h1>
          <p className="text-muted-foreground mt-2">
            Restez informé de toute l'activité sur votre compte
          </p>
        </div>

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
      </div>

      <Tabs value={filter} onValueChange={(v) => setFilter(v as 'all' | 'unread')}>
        <TabsList>
          <TabsTrigger value="all">
            Toutes
            {notifications && notifications.length > 0 && (
              <Badge variant="secondary" className="ml-2">
                {notifications.length}
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

        <TabsContent value={filter} className="space-y-2">
          {isLoading ? (
            <div className="flex justify-center py-12">
              <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
            </div>
          ) : notifications && notifications.length > 0 ? (
            <div className="space-y-2">
              {notifications.map((notification) => {
                const Icon = notificationIcons[notification.type] ?? Bell;
                const iconColor = notificationColors[notification.type] ?? 'text-muted-foreground';

                return (
                  <Card
                    key={notification.id}
                    className={`cursor-pointer transition-colors hover:bg-muted/50 ${!notification.isRead ? 'border-l-4 border-l-primary bg-muted/20' : ''}`}
                    onClick={() => handleNotificationClick(notification)}
                  >
                    <CardContent className="p-4">
                      <div className="flex items-start gap-4">
                        <div className={`h-10 w-10 rounded-full bg-muted flex items-center justify-center ${iconColor}`}>
                          <Icon className="h-5 w-5" />
                        </div>

                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-semibold">{notification.title}</p>
                          <p className="text-sm text-muted-foreground">{notification.message}</p>
                          <p className="text-xs text-muted-foreground mt-1">
                            {formatDistanceToNow(new Date(notification.createdAt), {
                              addSuffix: true,
                              locale: fr,
                            })}
                          </p>
                        </div>

                        <div className="flex items-center gap-2">
                          {!notification.isRead && (
                            <div className="h-2 w-2 rounded-full bg-primary" />
                          )}
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={(e) => {
                              e.stopPropagation();
                              deleteNotificationMutation.mutate(notification.id);
                            }}
                            disabled={deleteNotificationMutation.isPending}
                          >
                            <Trash2 className="h-4 w-4 text-muted-foreground hover:text-destructive" />
                          </Button>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          ) : (
            <Card>
              <CardContent className="flex flex-col items-center justify-center py-12">
                <Bell className="h-12 w-12 text-muted-foreground mb-4" />
                <p className="text-lg font-medium">Aucune notification</p>
                <p className="text-sm text-muted-foreground mt-2">
                  {filter === 'unread'
                    ? 'Vous avez tout lu !'
                    : 'Vous recevrez des notifications ici'}
                </p>
              </CardContent>
            </Card>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}
