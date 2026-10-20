'use client'

import { useEffect } from 'react'
import { Check, Circle, PartyPopper, Target } from 'lucide-react'
import { cn } from '@/lib/utils'
import {
  formatGoalEuros,
  goalReachedText,
  goalsScale,
  isGoalReached,
  nextGoal,
  remainingBefore,
  scalePercent,
  sortGoals,
  type TipGoal,
} from '@/lib/live-tip-goals'
import { CELEBRATION_MS, type GoalCelebration } from '@/lib/live-tips-state'

interface TipGoalsProgressProps {
  /** Euros of tips received during the live */
  total: number
  goals: TipGoal[]
  /** Milestones just reached (tip-goal-reached), shown in a banner for a few seconds */
  celebration?: GoalCelebration | null
  /** Called when the celebration banner should disappear */
  onCelebrationEnd?: (key: number) => void
  /** Compact list (the creator's editor shows its own rows) */
  showList?: boolean
  className?: string
}

/** Amount labels under the track closer than this (percent) are skipped */
const MIN_LABEL_GAP = 14

/**
 * Donation goals of a live: one track for the pot (scaled to the highest
 * milestone, or to the total once above), a marker per milestone, then the
 * milestones (reached, next one highlighted, later ones dimmed)
 */
export function TipGoalsProgress({
  total,
  goals,
  celebration,
  onCelebrationEnd,
  showList = true,
  className,
}: TipGoalsProgressProps) {
  // The banner hides itself CELEBRATION_MS after the last milestone reached
  const celebrationKey = celebration?.key
  const celebrationAt = celebration?.at
  useEffect(() => {
    if (celebrationKey === undefined || celebrationAt === undefined || !onCelebrationEnd) return
    const delay = Math.max(0, celebrationAt + CELEBRATION_MS - Date.now())
    const timer = setTimeout(() => onCelebrationEnd(celebrationKey), delay)
    return () => clearTimeout(timer)
  }, [celebrationKey, celebrationAt, onCelebrationEnd])

  if (goals.length === 0) return null

  const sorted = sortGoals(goals)
  const scale = goalsScale(sorted, total)
  const fill = scalePercent(total, scale)
  const next = nextGoal(sorted, total)
  const reachedCount = sorted.filter((goal) => isGoalReached(goal, total)).length

  let lastLabel = -Infinity
  const markers = sorted.map((goal) => {
    const left = scalePercent(goal.amount, scale)
    const showLabel = left - lastLabel >= MIN_LABEL_GAP || goal === sorted[sorted.length - 1]
    if (showLabel) lastLabel = left
    return { goal, left, showLabel }
  })
  // The last label always shows: hide the previous one if they would overlap
  if (markers.length > 1) {
    const last = markers[markers.length - 1]
    for (let i = markers.length - 2; i >= 0; i--) {
      if (!markers[i].showLabel) continue
      if (last.left - markers[i].left < MIN_LABEL_GAP) markers[i].showLabel = false
      break
    }
  }

  return (
    <div className={cn('min-w-0 space-y-2', className)} data-testid="tip-goals-progress">
      {celebration && celebration.goals.length > 0 && (
        <div
          role="status"
          aria-live="polite"
          data-testid="tip-goal-celebration"
          className="flex items-start gap-2 rounded-lg border border-amber-400 bg-amber-50 px-3 py-2 text-sm font-semibold text-amber-900 shadow-sm motion-safe:animate-in motion-safe:fade-in motion-safe:zoom-in-95 motion-safe:duration-500 dark:bg-amber-950/60 dark:text-amber-100"
        >
          <PartyPopper className="mt-0.5 h-4 w-4 shrink-0 text-amber-500 motion-safe:animate-bounce" aria-hidden />
          <div className="min-w-0 space-y-0.5">
            {celebration.goals.map((goal) => (
              <p key={goal.id} className="break-words">
                {goalReachedText(goal)}
              </p>
            ))}
          </div>
        </div>
      )}

      <div className="flex items-center justify-between gap-2 text-sm">
        <span className="flex min-w-0 items-center gap-1.5 font-medium">
          <Target className="h-4 w-4 shrink-0 text-primary" aria-hidden />
          <span className="truncate">Objectifs de dons</span>
        </span>
        <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
          <span className="font-semibold text-foreground" data-testid="tip-goals-total">
            {formatGoalEuros(total)}
          </span>{' '}
          récoltés · {reachedCount}/{sorted.length}
        </span>
      </div>

      <div className="pb-4">
        <div
          role="progressbar"
          aria-label={`Objectifs de dons : ${formatGoalEuros(total)} récoltés sur ${formatGoalEuros(sorted[sorted.length - 1].amount)}`}
          aria-valuemin={0}
          aria-valuemax={Math.round(scale * 100) / 100}
          aria-valuenow={Math.round(total * 100) / 100}
          className="relative h-2.5 w-full rounded-full bg-secondary"
        >
          <div
            className={cn(
              'h-full rounded-full transition-[width] duration-700 motion-reduce:transition-none',
              next ? 'bg-primary' : 'bg-amber-500',
            )}
            style={{ width: `${fill}%` }}
          />
          {markers.map(({ goal, left, showLabel }) => {
            const reached = isGoalReached(goal, total)
            return (
              <div key={goal.id} className="absolute top-0 h-full" style={{ left: `${left}%` }}>
                <span
                  className={cn(
                    'absolute top-1/2 h-3.5 w-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-background',
                    reached ? 'bg-amber-500' : goal === next ? 'bg-primary/40 ring-2 ring-primary' : 'bg-muted-foreground/40',
                  )}
                  title={`${formatGoalEuros(goal.amount)} — ${goal.label}`}
                  aria-hidden
                />
                {showLabel && (
                  <span
                    className={cn(
                      'absolute top-3.5 whitespace-nowrap text-[10px] leading-none tabular-nums',
                      left > 85 ? '-translate-x-full' : left < 10 ? '' : '-translate-x-1/2',
                      reached ? 'text-amber-600 dark:text-amber-400' : 'text-muted-foreground',
                    )}
                    aria-hidden
                  >
                    {formatGoalEuros(goal.amount)}
                  </span>
                )}
              </div>
            )
          })}
        </div>
      </div>

      {showList && (
        <ol className="max-h-44 space-y-1 overflow-y-auto pr-1" aria-label="Paliers">
          {sorted.map((goal) => {
            const reached = isGoalReached(goal, total)
            const isNext = goal === next
            return (
              <li
                key={goal.id}
                data-testid="tip-goal-step"
                data-state={reached ? 'reached' : isNext ? 'next' : 'later'}
                className={cn(
                  'flex items-start gap-2 rounded-md px-2 py-1.5 text-sm',
                  isNext && 'border border-primary/40 bg-primary/5',
                  !reached && !isNext && 'opacity-60',
                )}
              >
                <span className="mt-0.5 shrink-0" aria-hidden>
                  {reached ? (
                    <Check className="h-4 w-4 text-amber-500" />
                  ) : isNext ? (
                    <Target className="h-4 w-4 text-primary" />
                  ) : (
                    <Circle className="h-4 w-4 text-muted-foreground" />
                  )}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex flex-wrap items-baseline gap-x-2">
                    <span className="font-semibold tabular-nums">{formatGoalEuros(goal.amount)}</span>
                    <span className={cn('min-w-0 break-words', reached && 'text-muted-foreground')}>{goal.label}</span>
                  </span>
                  {isNext && (
                    <span className="block text-xs font-medium text-primary" data-testid="tip-goal-next">
                      Plus que {formatGoalEuros(remainingBefore(goal, total))} avant : {goal.label}
                    </span>
                  )}
                </span>
                {reached && (
                  <span
                    className={cn(
                      'shrink-0 rounded-full px-2 py-0.5 text-xs font-semibold',
                      goal.completedAt
                        ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/50 dark:text-emerald-200'
                        : 'bg-amber-100 text-amber-800 dark:bg-amber-900/50 dark:text-amber-200',
                    )}
                  >
                    {goal.completedAt ? 'Fait' : 'Atteint'}
                  </span>
                )}
                <span className="sr-only">
                  {reached ? (goal.completedAt ? 'Palier atteint et réalisé' : 'Palier atteint') : isNext ? 'Prochain palier' : 'Palier à venir'}
                </span>
              </li>
            )
          })}
        </ol>
      )}
    </div>
  )
}
