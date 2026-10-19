'use client'

import { useEffect, useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { notificationsApi } from '@/lib/api'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
  Bell,
  MessageCircle,
  UserPlus,
  DollarSign,
  CheckCircle,
  Trash2,
  Loader2
} from 'lucide-react'
import { formatRelativeTime } from '@/lib/utils'
import { useRouter } from 'next/navigation'
import { useSocket, type RealtimeNotification } from '@/hooks/use-socket'
import { useToast } from '@/hooks/use-toast'

// Shape returned by GET /notifications
interface Notification {
  id: string
  userId: string
  type: string // NotificationType enum (NEW_SUBSCRIBER, NEW_MESSAGE, NEW_TIP, ...)
  title: string
  message: string
  isRead: boolean
  linkUrl?: string | null
  metadata?: { kind?: string; [key: string]: unknown } | null
  createdAt: string
}

export default function NotificationsDropdown() {
  const router = useRouter()
  const queryClient = useQueryClient()
  const [open, setOpen] = useState(false)
  const { socket, connected } = useSocket()
  const { toast } = useToast()

  // Fetch notifications
  const { data: notifications, isLoading } = useQuery({
    queryKey: ['notifications'],
    queryFn: async () => {
      const response = await notificationsApi.getAll(false)
      return response.data as Notification[]
    },
    refetchInterval: 30000, // Refetch every 30 seconds
  })

  // Realtime: every notification created server-side is pushed on the socket
  useEffect(() => {
    if (!socket || !connected) return

    const handleNotification = (notification: RealtimeNotification) => {
      // Show it immediately (badge + list), then resync with the server
      queryClient.setQueryData<Notification[]>(['notifications'], (current) => {
        if (!current) return current
        if (current.some((n) => n.id === notification.id)) return current
        return [{ ...notification, isRead: notification.isRead ?? false }, ...current]
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

  // Count unread
  const unreadCount = notifications?.filter(n => !n.isRead).length || 0

  // Mark as read mutation
  const markAsReadMutation = useMutation({
    mutationFn: async (notificationId: string) => {
      await notificationsApi.markAsRead(notificationId)
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['notifications'] })
    },
  })

  // Mark all as read mutation
  const markAllAsReadMutation = useMutation({
    mutationFn: async () => {
      await notificationsApi.markAllAsRead()
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['notifications'] })
    },
  })

  // Delete notification mutation
  const deleteNotificationMutation = useMutation({
    mutationFn: async (notificationId: string) => {
      await notificationsApi.deleteNotification(notificationId)
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['notifications'] })
    },
  })

  const getNotificationIcon = (type: Notification['type']) => {
    switch (type) {
      case 'NEW_COMMENT':
        return <MessageCircle className="h-4 w-4 text-blue-500" />
      case 'NEW_MESSAGE':
        return <MessageCircle className="h-4 w-4 text-purple-500" />
      case 'NEW_SUBSCRIBER':
        return <UserPlus className="h-4 w-4 text-green-500" />
      case 'NEW_FOLLOWER':
        return <UserPlus className="h-4 w-4 text-pink-500" />
      case 'SUBSCRIPTION_RENEWAL':
      case 'CONTENT_APPROVED':
        return <CheckCircle className="h-4 w-4 text-purple-500" />
      case 'NEW_TIP':
      case 'PAYOUT_COMPLETED':
        return <DollarSign className="h-4 w-4 text-yellow-500" />
      case 'CONTENT_REJECTED':
        return <Bell className="h-4 w-4 text-red-500" />
      default:
        return <Bell className="h-4 w-4 text-gray-500" />
    }
  }

  const handleNotificationClick = (notification: Notification) => {
    // Mark as read if unread
    if (!notification.isRead) {
      markAsReadMutation.mutate(notification.id)
    }

    // Navigate to the linked page if available
    if (notification.linkUrl) {
      router.push(notification.linkUrl)
    } else if (notification.type === 'NEW_MESSAGE') {
      router.push('/messages')
    }

    setOpen(false)
  }

  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" className="relative">
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

      <DropdownMenuContent align="end" className="w-80 max-h-[500px] overflow-y-auto">
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
              Tout marquer comme lu
            </Button>
          )}
        </div>

        <DropdownMenuSeparator />

        {isLoading ? (
          <div className="p-8 text-center">
            <Loader2 className="h-6 w-6 animate-spin mx-auto text-muted-foreground" />
          </div>
        ) : notifications && notifications.length > 0 ? (
          <div>
            {notifications.slice(0, 10).map((notification) => (
              <DropdownMenuItem
                key={notification.id}
                className={`flex gap-3 p-3 cursor-pointer ${
                  !notification.isRead ? 'bg-accent' : ''
                }`}
                onClick={() => handleNotificationClick(notification)}
              >
                <div className="flex-shrink-0 mt-1">
                  {getNotificationIcon(notification.type)}
                </div>

                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium line-clamp-1">
                    {notification.title}
                  </p>
                  <p className="text-xs text-muted-foreground line-clamp-2 mt-1">
                    {notification.message}
                  </p>
                  <p className="text-xs text-muted-foreground mt-1">
                    {formatRelativeTime(new Date(notification.createdAt))}
                  </p>
                </div>

                <Button
                  variant="ghost"
                  size="sm"
                  onClick={(e) => {
                    e.stopPropagation()
                    deleteNotificationMutation.mutate(notification.id)
                  }}
                  className="h-7 w-7 p-0 flex-shrink-0"
                >
                  <Trash2 className="h-3 w-3" />
                </Button>
              </DropdownMenuItem>
            ))}

            {notifications.length > 10 && (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  className="justify-center text-sm text-primary cursor-pointer"
                  onClick={() => {
                    router.push('/notifications')
                    setOpen(false)
                  }}
                >
                  Voir toutes les notifications
                </DropdownMenuItem>
              </>
            )}
          </div>
        ) : (
          <div className="p-8 text-center">
            <Bell className="h-12 w-12 mx-auto mb-2 text-muted-foreground opacity-50" />
            <p className="text-sm text-muted-foreground">
              Aucune notification
            </p>
          </div>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
