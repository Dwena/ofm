'use client'

import { PartyPopper, Target } from 'lucide-react'
import { cn, formatEuros } from '@/lib/utils'
import { goalPercent } from '@/lib/live-tips'

interface TipGoalProgressProps {
  /** Euros; nothing is shown without a goal */
  amount: number | null
  label: string | null
  /** Euros of tips received during the live */
  total: number
  className?: string
  /** Light text on the dark player bar */
  variant?: 'default' | 'dark'
}

/**
 * Progress of the live's tip goal: label, total / amount, percentage
 */
export function TipGoalProgress({ amount, label, total, className, variant = 'default' }: TipGoalProgressProps) {
  if (!amount || amount <= 0) return null

  const percent = goalPercent(total, amount)
  const reached = total >= amount
  const dark = variant === 'dark'

  return (
    <div
      className={cn('space-y-1.5 min-w-0', className)}
      data-testid="tip-goal-progress"
      aria-label={`Objectif de la live : ${formatEuros(total)} sur ${formatEuros(amount)}`}
    >
      <div className="flex items-center justify-between gap-2 text-sm">
        <span className="flex items-center gap-1.5 min-w-0 font-medium">
          {reached ? (
            <PartyPopper className="h-4 w-4 shrink-0 text-amber-500" />
          ) : (
            <Target className={cn('h-4 w-4 shrink-0', dark ? 'text-white/80' : 'text-primary')} />
          )}
          <span className="truncate" title={label || undefined}>
            {reached ? 'Objectif atteint' : 'Objectif'}
            {label ? ` : ${label}` : ''}
          </span>
        </span>
        <span className={cn('shrink-0 tabular-nums text-xs', dark ? 'text-white/80' : 'text-muted-foreground')}>
          {formatEuros(total)} / {formatEuros(amount)} · {percent} %
        </span>
      </div>
      <div
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={percent}
        className={cn('h-2 w-full overflow-hidden rounded-full', dark ? 'bg-white/20' : 'bg-secondary')}
      >
        <div
          className={cn('h-full transition-all duration-500', reached ? 'bg-amber-500' : 'bg-primary')}
          style={{ width: `${percent}%` }}
        />
      </div>
    </div>
  )
}
