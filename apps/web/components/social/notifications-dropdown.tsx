'use client'

import { useEffect, useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useRouter } from 'next/navigation'
import { Bell, Loader2, Trash2 } from 'lucide-react'

import { notificationsApi } from '@/lib/api'
import { getNotificationHref, type AppNotification, type NotificationsPage } from '@/lib/notifications'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { NotificationIcon } from '@/components/notification-icon'
import { getApiErrorMessage } from '@/components/auth-shell'
import { formatRelativeTime } from '@/lib/utils'
import { useSocket, type RealtimeNotification } from '@/hooks/use-socket'
import { useToast } from '@/hooks/use-toast'
import { useConfirm } from '@/hooks/use-confirm'

const DROPDOWN_QUERY_KEY = ['notifications', 'dropdown']
const DROPDOWN_SIZE = 10

export default function NotificationsDropdown() {
  const router = useRouter()
  const queryClient = useQueryClient()
  const [open, setOpen] = useState(false)
  const { socket, connected } = useSocket()
  const { toast } = useToast()
  const { confirm } = useConfirm()

  // Latest notifications + global unread count
  const { data, isLoading, isError } = useQuery({
    queryKey: DROPDOWN_QUERY_KEY,
    queryFn: async () => {
      const response = await notificationsApi.getAll({ limit: DROPDOWN_SIZE })
      return response.data as NotificationsPage
    },
    refetchInterval: 30000, // Refetch every 30 seconds
  })

  const notifications = data?.items ?? []
  const unreadCount = data?.unreadCount ?? 0

  // Realtime: every notification created server-side is pushed on the socket
  useEffect(() => {
    if (!socket || !connected) return

    const handleNotification = (notification: RealtimeNotification) => {
      // Show it immediately (badge + list), then resync with the server
      queryClient.setQueryData<NotificationsPage>(DROPDOWN_QUERY_KEY, (current) => {
        if (!current) return current
        if (current.items.some((n) => n.id === notification.id)) return current
        const isRead = notification.isRead ?? false
        return {
          ...current,
          items: [{ ...notification, isRead }, ...current.items].slice(0, DROPDOWN_SIZE),
          total: current.total + 1,
          unreadCount: current.unreadCount + (isRead ? 0 : 1),
        }
      })
      queryClient.invalidateQueries({ queryKey: ['notifications'] })

      toast({
        title: notification.title,
        description: notification.message,
      })
    }

    socket.on('notification:new', handleNotification)
    return () => {
      socket.off('notification:new', handleNotification)
    }
  }, [socket, connected, queryClient, toast])

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['notifications'] })
  const onError = (fallback: string) => (error: unknown) =>
    toast({ title: 'Erreur', description: getApiErrorMessage(error, fallback), variant: 'destructive' })

  const markAsReadMutation = useMutation({
    mutationFn: (notificationId: string) => notificationsApi.markAsRead(notificationId),
    onSuccess: invalidate,
    onError: onError('Impossible de marquer la notification comme lue.'),
  })

  const markAllAsReadMutation = useMutation({
    mutationFn: () => notificationsApi.markAllAsRead(),
    onSuccess: invalidate,
    onError: onError('Impossible de tout marquer comme lu.'),
  })

  const deleteNotificationMutation = useMutation({
    mutationFn: (notificationId: string) => notificationsApi.deleteNotification(notificationId),
    onSuccess: () => {
      invalidate()
      toast({ title: 'Notification supprimée' })
    },
    onError: onError('Impossible de supprimer la notification.'),
  })

  const handleNotificationClick = (notification: AppNotification) => {
    if (!notification.isRead) {
      markAsReadMutation.mutate(notification.id)
    }
    setOpen(false)
    const href = getNotificationHref(notification)
    if (href) {
      router.push(href)
    }
  }

  const handleDelete = async (notification: AppNotification) => {
    // Close the menu first so the confirmation dialog gets the focus
    setOpen(false)
    const ok = await confirm({
      title: 'Supprimer cette notification ?',
      description: `« ${notification.title} » sera définitivement supprimée.`,
      confirmText: 'Supprimer',
      variant: 'destructive',
    })
    if (ok) {
      deleteNotificationMutation.mutate(notification.id)
    }
  }

  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="relative"
          aria-label={unreadCount > 0 ? `Notifications (${unreadCount} non lues)` : 'Notifications'}
        >
          <Bell className="h-5 w-5" />
          {unreadCount > 0 && (
            <Badge
              variant="destructive"
              className="absolute -top-1 -right-1 h-5 w-5 flex items-center justify-center p-0 text-xs"
            >
              {unreadCount > 9 ? '9+' : unreadCount}
            </Badge>
          )}
        </Button>
      </DropdownMenuTrigger>

      <DropdownMenuContent align="end" className="w-[calc(100vw-2rem)] max-w-sm max-h-[500px] overflow-y-auto">
        <div className="flex items-center justify-between p-2">
          <h3 className="font-semibold">Notifications</h3>
          {unreadCount > 0 && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => markAllAsReadMutation.mutate()}
              disabled={markAllAsReadMutation.isPending}
              className="h-7 text-xs"
            >
              {markAllAsReadMutation.isPending && <Loader2 className="h-3 w-3 mr-1 animate-spin" />}
              Tout marquer comme lu
            </Button>
          )}
        </div>

        <DropdownMenuSeparator />

        {isLoading ? (
          <div className="p-8 text-center">
            <Loader2 className="h-6 w-6 animate-spin mx-auto text-muted-foreground" />
          </div>
        ) : isError ? (
          <div className="p-6 text-center text-sm text-muted-foreground">
            Impossible de charger les notifications
          </div>
        ) : notifications.length > 0 ? (
          <div>
            {notifications.map((notification) => (
              <DropdownMenuItem
                key={notification.id}
                className={`flex gap-3 p-3 cursor-pointer items-start ${!notification.isRead ? 'bg-accent' : ''}`}
                onSelect={() => handleNotificationClick(notification)}
              >
                <div className="flex-shrink-0 mt-1">
                  <NotificationIcon notification={notification} />
                </div>

                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium line-clamp-1">{notification.title}</p>
                  <p className="text-xs text-muted-foreground line-clamp-2 mt-1">{notification.message}</p>
                  <p className="text-xs text-muted-foreground mt-1">
                    {formatRelativeTime(new Date(notification.createdAt))}
                  </p>
                </div>

                <Button
                  variant="ghost"
                  size="sm"
                  aria-label="Supprimer la notification"
                  onClick={(e) => {
                    e.preventDefault()
                    e.stopPropagation()
                    handleDelete(notification)
                  }}
                  onPointerDown={(e) => e.stopPropagation()}
                  className="h-7 w-7 p-0 flex-shrink-0"
                >
                  <Trash2 className="h-3 w-3" />
                </Button>
              </DropdownMenuItem>
            ))}
          </div>
        ) : (
          <div className="p-8 text-center">
            <Bell className="h-12 w-12 mx-auto mb-2 text-muted-foreground opacity-50" />
            <p className="text-sm text-muted-foreground">Aucune notification</p>
          </div>
        )}

        <DropdownMenuSeparator />
        <DropdownMenuItem
          className="justify-center text-sm text-primary cursor-pointer"
          onSelect={() => {
            setOpen(false)
            router.push('/notifications')
          }}
        >
          Voir toutes les notifications
          {data && data.total > notifications.length ? ` (${data.total})` : ''}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
