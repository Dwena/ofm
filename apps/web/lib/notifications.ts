// Shared notification types and helpers (notifications page, dropdown, settings)

// Mirrors the NotificationType enum of the API
export type NotificationType =
  | 'NEW_SUBSCRIBER'
  | 'NEW_MESSAGE'
  | 'NEW_TIP'
  | 'NEW_COMMENT'
  | 'SUBSCRIPTION_RENEWAL'
  | 'PAYOUT_COMPLETED'
  | 'CONTENT_APPROVED'
  | 'CONTENT_REJECTED'
  | 'SYSTEM'
  | 'NEW_FOLLOWER'

// Shape of a row returned by GET /notifications
export interface AppNotification {
  id: string
  userId?: string
  type: NotificationType | string
  title: string
  message: string
  isRead: boolean
  linkUrl?: string | null
  metadata?: { kind?: string; [key: string]: unknown } | null
  createdAt: string
}

// GET /notifications response
export interface NotificationsPage {
  items: AppNotification[]
  total: number
  unreadCount: number
  page: number
  limit: number
  hasMore: boolean
}

// Categories of GET/PUT /notifications/preferences (and the `category` list filter)
export type NotificationCategory =
  | 'messages'
  | 'subscribers'
  | 'followers'
  | 'comments'
  | 'purchases'
  | 'payouts'

export type NotificationPreferences = Record<NotificationCategory, { inApp: boolean; push: boolean }>

export const NOTIFICATION_CATEGORIES: {
  value: NotificationCategory
  label: string
  description: string
  creatorOnly?: boolean
}[] = [
  {
    value: 'subscribers',
    label: 'Abonnements',
    description: 'Nouveaux abonnés et renouvellements',
    creatorOnly: true,
  },
  { value: 'followers', label: 'Followers', description: 'Quand quelqu’un commence à vous suivre', creatorOnly: true },
  { value: 'comments', label: 'Commentaires', description: 'Nouveaux commentaires sur vos contenus', creatorOnly: true },
  {
    value: 'purchases',
    label: 'Achats et pourboires',
    description: 'Pourboires reçus et contenus débloqués',
    creatorOnly: true,
  },
  { value: 'payouts', label: 'Virements', description: 'Versements de vos revenus', creatorOnly: true },
]

/**
 * Where a notification leads: its `linkUrl` when it is an internal path,
 * otherwise a sensible page for its type (null when there is none).
 */
export function getNotificationHref(notification: Pick<AppNotification, 'type' | 'linkUrl'>): string | null {
  const link = notification.linkUrl?.trim()
  if (link && link.startsWith('/') && !link.startsWith('//')) {
    return link
  }
  switch (notification.type) {
    case 'NEW_MESSAGE':
      return '/messages'
    case 'NEW_SUBSCRIBER':
    case 'SUBSCRIPTION_RENEWAL':
      return '/creator/subscriptions'
    case 'NEW_TIP':
    case 'PAYOUT_COMPLETED':
      return '/creator/earnings'
    default:
      return null
  }
}
