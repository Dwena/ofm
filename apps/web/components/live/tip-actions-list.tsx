'use client'

import { Check, Clock, SkipForward } from 'lucide-react'
import { cn, formatEuros } from '@/lib/utils'
import { TIP_ACTION_STATUS_LABELS, type TipAction } from '@/lib/live-tips'

interface TipActionsListProps {
  actions: TipAction[]
  /** Highlight the requests of this user ("Vous") */
  currentUserId?: string
  /** Most recent requests shown */
  limit?: number
}

const STATUS_STYLES = {
  PENDING: 'bg-amber-100 text-amber-800 dark:bg-amber-900/50 dark:text-amber-200',
  DONE: 'bg-green-100 text-green-800 dark:bg-green-900/50 dark:text-green-200',
  SKIPPED: 'bg-muted text-muted-foreground',
} as const

const STATUS_ICONS = { PENDING: Clock, DONE: Check, SKIPPED: SkipForward } as const

/**
 * Compact "Demandes en cours" list for the viewers: pending requests first,
 * then the latest handled ones, so fans see theirs was taken into account
 */
export function TipActionsList({ actions, currentUserId, limit = 20 }: TipActionsListProps) {
  const pending = actions.filter((action) => action.status === 'PENDING')
  const handled = actions
    .filter((action) => action.status !== 'PENDING')
    .sort((a, b) => (b.completedAt ?? b.createdAt).localeCompare(a.completedAt ?? a.createdAt))
  const shown = [...pending, ...handled].slice(0, limit)

  if (shown.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        Aucune demande pour le moment. Choisissez un palier du menu pour faire la vôtre !
      </p>
    )
  }

  return (
    <ul className="space-y-1.5" data-testid="tip-actions-list">
      {shown.map((action) => {
        const Icon = STATUS_ICONS[action.status]
        const mine = !!currentUserId && action.fromUser.id === currentUserId
        return (
          <li key={action.id} className="flex items-center justify-between gap-2 text-sm min-w-0">
            <span className="min-w-0 truncate">
              <span className="font-medium">{mine ? 'Vous' : action.fromUser.displayName || action.fromUser.username}</span>
              {' · '}
              {action.label}
              <span className="text-muted-foreground"> · {formatEuros(action.amount)}</span>
            </span>
            <span
              className={cn(
                'inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium',
                STATUS_STYLES[action.status],
              )}
            >
              <Icon className="h-3 w-3" />
              {TIP_ACTION_STATUS_LABELS[action.status]}
            </span>
          </li>
        )
      })}
    </ul>
  )
}
