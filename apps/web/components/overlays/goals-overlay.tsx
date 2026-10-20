'use client'

import { useOverlay } from '@/hooks/use-overlay'
import { goalsScale, isGoalReached, nextGoal, scalePercent, sortGoals } from '@/lib/live-tip-goals'
import { formatOverlayEuros, hexToRgba } from '@/lib/overlay-widgets'
import { OverlayFrame } from './overlay-frame'

/**
 * Donation goals of the creator's current live: one progress bar with the
 * milestones, or a list (every milestone or only the next one)
 */
export function GoalsOverlay({ token }: { token: string }) {
  const { state, settings, preview } = useOverlay(token, 'GOALS')
  const { total } = state
  const goals = sortGoals(state.goals)
  const upcoming = nextGoal(goals, total)
  const shown = settings.show === 'next' ? (upcoming ? [upcoming] : goals.slice(-1)) : goals

  const text = hexToRgba(settings.textColor)
  const accent = hexToRgba(settings.accentColor)
  const background = hexToRgba(settings.backgroundColor)

  const emptyHint = !state.live
    ? 'Aucun live en cours : les objectifs s’afficheront pendant votre live'
    : goals.length === 0
      ? 'Aucun objectif de dons pour ce live'
      : null

  // Bar: whole track up to the highest milestone, or up to the next one only
  const scale = settings.show === 'next' && upcoming ? upcoming.amount : goalsScale(goals, total)
  const percent = scalePercent(total, scale)

  return (
    <OverlayFrame widget="goals" status={state.status} preview={preview} emptyHint={emptyHint}>
      {state.live && goals.length > 0 && (
        <div
          data-testid="overlay-goals"
          data-total={total}
          className="m-3 rounded-2xl px-5 py-4 ov-fade-in"
          style={{ background, color: text, fontSize: settings.fontSize }}
        >
          <div className="flex items-baseline justify-between gap-3">
            {settings.title && <p className="font-bold leading-tight">{settings.title}</p>}
            {settings.showAmounts && (
              <p className="shrink-0 font-extrabold tabular-nums" style={{ color: accent }} data-testid="overlay-goals-total">
                {formatOverlayEuros(total)}
                {settings.show === 'next' && upcoming && (
                  <span style={{ color: text, opacity: 0.8 }}> / {formatOverlayEuros(upcoming.amount)}</span>
                )}
              </p>
            )}
          </div>

          {settings.layout === 'bar' ? (
            <>
              <div
                className="relative mt-3 w-full overflow-hidden rounded-full"
                style={{ height: Math.max(12, Math.round(settings.fontSize * 0.8)), background: 'rgba(255,255,255,0.18)' }}
              >
                <div className="ov-fill h-full rounded-full" style={{ width: `${percent}%`, background: accent }} />
                {settings.show === 'all' &&
                  goals.map((goal) => (
                    <span
                      key={goal.id}
                      className="absolute top-0 h-full w-[3px] -translate-x-1/2"
                      style={{ left: `${scalePercent(goal.amount, scale)}%`, background: text, opacity: 0.7 }}
                    />
                  ))}
              </div>
              <ul className="mt-2 space-y-1" style={{ fontSize: Math.round(settings.fontSize * 0.75) }}>
                {shown.map((goal) => {
                  const reached = isGoalReached(goal, total)
                  return (
                    <li key={goal.id} className="flex items-baseline justify-between gap-3" data-reached={reached}>
                      <span className="min-w-0 truncate">
                        {reached ? '✅ ' : '🎯 '}
                        {goal.label}
                      </span>
                      {settings.showAmounts && (
                        <span className="shrink-0 tabular-nums font-semibold">{formatOverlayEuros(goal.amount)}</span>
                      )}
                    </li>
                  )
                })}
              </ul>
            </>
          ) : (
            <ul className="mt-2 space-y-2">
              {shown.map((goal) => {
                const reached = isGoalReached(goal, total)
                return (
                  <li key={goal.id} data-reached={reached}>
                    <div className="flex items-baseline justify-between gap-3" style={{ fontSize: Math.round(settings.fontSize * 0.85) }}>
                      <span className={`min-w-0 truncate ${reached ? 'line-through opacity-80' : ''}`}>
                        {reached ? '✅ ' : '🎯 '}
                        {goal.label}
                      </span>
                      {settings.showAmounts && (
                        <span className="shrink-0 tabular-nums font-semibold">{formatOverlayEuros(goal.amount)}</span>
                      )}
                    </div>
                    <div className="mt-1 h-2 w-full overflow-hidden rounded-full" style={{ background: 'rgba(255,255,255,0.18)' }}>
                      <div
                        className="ov-fill h-full rounded-full"
                        style={{ width: `${scalePercent(total, goal.amount)}%`, background: accent }}
                      />
                    </div>
                  </li>
                )
              })}
            </ul>
          )}
        </div>
      )}
    </OverlayFrame>
  )
}
