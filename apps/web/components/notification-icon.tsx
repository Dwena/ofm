import { Bell, CheckCircle, DollarSign, MessageCircle, ShieldAlert, UserPlus, Wallet } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { AppNotification } from '@/lib/notifications'

/** Icon of a notification, by type (and `metadata.kind` for SYSTEM rows) */
export function NotificationIcon({
  notification,
  className,
}: {
  notification: Pick<AppNotification, 'type' | 'metadata'>
  className?: string
}) {
  const kind = typeof notification.metadata?.kind === 'string' ? notification.metadata.kind.toUpperCase() : ''
  const base = cn('h-4 w-4', className)

  switch (notification.type) {
    case 'NEW_COMMENT':
      return <MessageCircle className={cn(base, 'text-blue-500')} />
    case 'NEW_MESSAGE':
      return <MessageCircle className={cn(base, 'text-purple-500')} />
    case 'NEW_SUBSCRIBER':
      return <UserPlus className={cn(base, 'text-green-500')} />
    case 'NEW_FOLLOWER':
      return <UserPlus className={cn(base, 'text-pink-500')} />
    case 'SUBSCRIPTION_RENEWAL':
    case 'CONTENT_APPROVED':
      return <CheckCircle className={cn(base, 'text-green-500')} />
    case 'NEW_TIP':
      return <DollarSign className={cn(base, 'text-yellow-500')} />
    case 'PAYOUT_COMPLETED':
      return <Wallet className={cn(base, 'text-yellow-500')} />
    case 'CONTENT_REJECTED':
      return <ShieldAlert className={cn(base, 'text-red-500')} />
    default:
      break
  }
  if (kind === 'PPV_PURCHASE' || kind === 'PURCHASE' || kind === 'TIP') {
    return <DollarSign className={cn(base, 'text-yellow-500')} />
  }
  if (kind.startsWith('PAYOUT')) {
    return <Wallet className={cn(base, 'text-yellow-500')} />
  }
  if (kind.includes('FAILED') || kind.includes('DISPUTE')) {
    return <ShieldAlert className={cn(base, 'text-red-500')} />
  }
  return <Bell className={cn(base, 'text-muted-foreground')} />
}
