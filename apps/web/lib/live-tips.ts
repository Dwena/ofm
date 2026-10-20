import type { Socket } from 'socket.io-client'
import { api } from './api'
import { LIVE_ACK_TIMEOUT } from './live'
import type { TipGoal } from './live-tip-goals'
import type { LiveTipEvent, TipAction, TipActionStatus, TipMenuItem } from './live-tips-state'

export * from './live-tips-state'
export type { TipGoal } from './live-tip-goals'

/** The creator's own menu, with the bounds of an item amount (euros) */
export interface OwnTipMenu {
  items: TipMenuItem[]
  minimumAmount: number
  maximumAmount: number
  maxItems: number
}

/** Milestones of a live with its running total (PUT response, tip-goals-updated, tip-goal-progress) */
export interface TipGoalsSnapshot {
  streamId: string
  total: number
  goals: TipGoal[]
}

const toGoals = (goals: unknown): TipGoal[] => (Array.isArray(goals) ? (goals as TipGoal[]) : [])

/**
 * Feed the reducer with the tip events of a live socket (milestones, requests)
 */
export function bindLiveTipEvents(socket: Socket, dispatch: (event: LiveTipEvent) => void) {
  const onGoals = (data: { total?: number; goals?: TipGoal[] }) =>
    dispatch({ type: 'goals', total: Number(data?.total) || 0, goals: toGoals(data?.goals) })
  const onGoal = (data: { goal?: TipGoal }) => {
    if (data?.goal) dispatch({ type: 'goal', goal: data.goal })
  }
  const onReached = (data: { goal?: TipGoal; total?: number }) => {
    if (data?.goal) dispatch({ type: 'reached', goal: data.goal, total: Number(data.total) || 0, at: Date.now() })
  }
  const onAction = (data: { action: TipAction }) => {
    if (data?.action) dispatch({ type: 'action', action: data.action })
  }
  socket.on('tip-goal-progress', onGoals)
  socket.on('tip-goals-updated', onGoals)
  socket.on('tip-goal-updated', onGoal)
  socket.on('tip-goal-reached', onReached)
  socket.on('tip-action-created', onAction)
  socket.on('tip-action-updated', onAction)
}

/** Ack of `update-tip-action` */
export type TipActionAck = { success?: boolean; error?: string; reason?: string; action?: TipAction }

/**
 * Creator marks a request done or skipped (socket event)
 */
export function emitTipActionUpdate(
  socket: Socket,
  streamId: string,
  actionId: string,
  status: Exclude<TipActionStatus, 'PENDING'>,
): Promise<TipActionAck> {
  return new Promise((resolve) => {
    socket
      .timeout(LIVE_ACK_TIMEOUT)
      .emit('update-tip-action', { streamId, actionId, status }, (err: Error | null, ack: TipActionAck) => {
        resolve(err ? { error: 'TIMEOUT' } : ack ?? { error: 'UNKNOWN' })
      })
  })
}

export const liveTipsApi = {
  getOwnMenu: () => api.get<OwnTipMenu>('/streaming/me/tip-menu'),
  replaceMenu: (
    items: { id?: string; label: string; description?: string | null; amount: number; emoji?: string | null; isActive?: boolean }[],
  ) => api.put<OwnTipMenu>('/streaming/me/tip-menu', { items }),
  getCreatorMenu: (creatorId: string) => api.get<TipMenuItem[]>(`/streaming/creators/${creatorId}/tip-menu`),
  /** Replace the milestones of a scheduled or live stream (empty list: no goals) */
  replaceGoals: (streamId: string, goals: { id?: string; amount: number; label: string }[]) =>
    api.put<TipGoalsSnapshot>(`/streaming/${streamId}/tip-goals`, { goals }),
  /** Mark a reached milestone as done / not done */
  setGoalCompleted: (streamId: string, goalId: string, completed: boolean) =>
    api.patch<{ streamId: string; goal: TipGoal }>(`/streaming/${streamId}/tip-goals/${goalId}`, { completed }),
  /** Milestones of the creator's last live that has some */
  getLatestGoals: (excludeStreamId?: string) =>
    api.get<{ goals: { amount: number; label: string }[] }>('/streaming/me/tip-goals/latest', {
      params: excludeStreamId ? { excludeStreamId } : undefined,
    }),
}

const API_ERRORS: [RegExp, string | ((match: RegExpMatchArray) => string)][] = [
  [/more than (\d+) items/i, (m) => `Le menu ne peut pas dépasser ${m[1]} paliers.`],
  [/amount must be between €?([\d.]+) and €?([\d.]+)/i, (m) =>
    `Chaque montant doit être compris entre ${m[1].replace('.', ',')} € et ${Number(m[2]).toLocaleString('fr-FR')} €.`],
  [/label is required/i, 'Chaque palier doit avoir un intitulé.'],
  [/duplicate tip menu item/i, 'Un palier est présent deux fois.'],
  [/more than (\d+) tip goals|goals must contain no more than (\d+)/i, (m) =>
    `Un live ne peut pas avoir plus de ${m[1] ?? m[2]} paliers.`],
  [/goals\.\d+\.amount must not be (less|greater)/i, 'Chaque palier doit être compris entre 1 € et 100 000 €.'],
  [/goals\.\d+\.amount must be a number/i, 'Montant invalide : deux décimales maximum.'],
  [/goals\.\d+\.label should not be empty/i, 'Chaque palier doit avoir un intitulé.'],
  [/goals\.\d+\.label must be shorter/i, 'Chaque intitulé doit faire 120 caractères maximum.'],
  [/tip goal amount must be between/i, 'Chaque palier doit être compris entre 1 € et 100 000 €.'],
  [/at most 2 decimals|maxDecimalPlaces|decimal places/i, 'Deux décimales maximum par montant.'],
  [/amounts must be distinct/i, 'Deux paliers ne peuvent pas avoir le même montant.'],
  [/duplicate tip goal/i, 'Un palier est présent deux fois.'],
  [/label must be at most (\d+)|label must be shorter/i, 'Chaque intitulé doit faire 120 caractères maximum.'],
  [/only a reached tip goal/i, "Ce palier n'est pas encore atteint."],
  [/tip goal not found/i, 'Ce palier a été supprimé entre-temps.'],
  [/before or during the live/i, "Les paliers ne peuvent être modifiés qu'avant ou pendant le live."],
  [/only update your own streams/i, "Ce live ne vous appartient pas."],
  [/stream not found/i, 'Ce live est introuvable.'],
]

/**
 * French message for an error of the tip menu / goals endpoints
 */
export function tipErrorMessage(error: unknown, fallback: string): string {
  const raw = (error as { response?: { data?: { message?: unknown } } })?.response?.data?.message
  const message = Array.isArray(raw) ? raw[0] : raw
  if (typeof message !== 'string' || !message) return fallback
  for (const [pattern, translation] of API_ERRORS) {
    const match = message.match(pattern)
    if (match) return typeof translation === 'string' ? translation : translation(match)
  }
  return fallback
}

/** French label of a request status */
export const TIP_ACTION_STATUS_LABELS: Record<TipActionStatus, string> = {
  PENDING: 'En attente',
  DONE: 'Réalisée',
  SKIPPED: 'Ignorée',
}
