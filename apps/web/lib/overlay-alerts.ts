/**
 * Alerts of the OBS alert box: which live events make an alert, and its text.
 * Pure helpers (no React, no network).
 */
import { formatOverlayEuros, renderTemplate, type AlertsSettings } from './overlay-widgets'

/** `tip` event of the live (and of the "Tester" buttons) */
export interface OverlayTipEvent {
  transactionId: string
  amount: number
  message?: string | null
  menuItemLabel?: string | null
  fromUser: { id: string; username: string; displayName?: string | null; avatar?: string | null }
  test?: boolean
}

/** `tip-goal-reached` event */
export interface OverlayGoalReachedEvent {
  goal: { id: string; amount: number; label: string }
  total: number
  test?: boolean
}

export type OverlayAlertKind = 'tip' | 'menu-request' | 'goal-reached'

export interface OverlayAlert {
  id: string
  kind: OverlayAlertKind
  /** Main line (template filled in) */
  title: string
  /** Fan's message, shown under the title */
  message: string | null
  test: boolean
}

/** Alerts waiting in the queue at most (a burst of tips drops the oldest) */
export const MAX_QUEUED_ALERTS = 30

/**
 * Alert of a tip: a menu request ("{name} a demandé : {item}") or a plain tip
 * ("{name} a envoyé {amount} !", only from `minAmount`). Null when none.
 */
export function alertFromTip(tip: OverlayTipEvent, settings: AlertsSettings): OverlayAlert | null {
  if (!tip || typeof tip.amount !== 'number') return null
  const name = tip.fromUser?.displayName || tip.fromUser?.username || 'Un fan'
  const amount = formatOverlayEuros(tip.amount)
  const message = settings.showMessage && tip.message?.trim() ? tip.message.trim() : null
  const item = tip.menuItemLabel?.trim()

  if (item && settings.menuRequestEnabled) {
    return {
      id: `menu-${tip.transactionId}`,
      kind: 'menu-request',
      title: renderTemplate(settings.menuRequestTemplate, { name, amount, item, message: message ?? '' }),
      message,
      test: !!tip.test,
    }
  }
  if (tip.amount < settings.minAmount) return null
  return {
    id: `tip-${tip.transactionId}`,
    kind: 'tip',
    title: renderTemplate(settings.textTemplate, { name, amount, item: item ?? '', message: message ?? '' }),
    message,
    test: !!tip.test,
  }
}

/** Alert of a milestone reached ("🎯 Palier atteint : {amount} — {label}"), null when disabled */
export function alertFromGoal(event: OverlayGoalReachedEvent, settings: AlertsSettings): OverlayAlert | null {
  if (!settings.goalReachedEnabled || !event?.goal) return null
  return {
    id: `goal-${event.goal.id}-${event.test ? Date.now() : 'live'}`,
    kind: 'goal-reached',
    title: renderTemplate(settings.goalReachedTemplate, {
      amount: formatOverlayEuros(event.goal.amount),
      label: event.goal.label,
      total: formatOverlayEuros(event.total),
    }),
    message: null,
    test: !!event.test,
  }
}

/** Queue with a new alert (ignored when already queued, oldest dropped beyond the limit) */
export function enqueueAlert(queue: OverlayAlert[], alert: OverlayAlert | null): OverlayAlert[] {
  if (!alert || queue.some((queued) => queued.id === alert.id)) return queue
  return [...queue, alert].slice(-MAX_QUEUED_ALERTS)
}
