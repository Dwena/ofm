import type { Socket } from 'socket.io-client'
import { api } from './api'
import { LIVE_ACK_TIMEOUT } from './live'

/** Item of a creator's live tip menu ("paliers de dons"), amount in euros */
export interface TipMenuItem {
  id: string
  label: string
  description: string | null
  amount: number
  emoji: string | null
  position: number
  isActive: boolean
}

/** The creator's own menu, with the bounds of an item amount (euros) */
export interface OwnTipMenu {
  items: TipMenuItem[]
  minimumAmount: number
  maximumAmount: number
  maxItems: number
}

export interface TipGoal {
  /** Euros */
  amount: number
  label: string | null
  /** Euros of completed tips sent from the live */
  total: number
}

export type TipActionStatus = 'PENDING' | 'DONE' | 'SKIPPED'

/** Request a fan paid for from the tip menu, for the creator to perform */
export interface TipAction {
  id: string
  streamId: string
  menuItemId: string | null
  label: string
  amount: number
  status: TipActionStatus
  createdAt: string
  completedAt: string | null
  fromUser: { id: string; username: string; displayName: string | null; avatar: string | null }
}

/** Tip fields of the stream detail and of the join / broadcast acknowledgements */
export interface LiveTipSnapshot {
  tipGoal?: TipGoal | null
  tipTotal?: number
  tipMenu?: TipMenuItem[]
  pendingTipActions?: TipAction[]
}

export interface LiveTipState {
  goalAmount: number | null
  goalLabel: string | null
  total: number
  menu: TipMenuItem[]
  actions: TipAction[]
}

export const initialLiveTipState: LiveTipState = {
  goalAmount: null,
  goalLabel: null,
  total: 0,
  menu: [],
  actions: [],
}

export type LiveTipEvent =
  | { type: 'snapshot'; snapshot: LiveTipSnapshot }
  | { type: 'goal'; amount: number | null; label: string | null; total: number }
  | { type: 'action'; action: TipAction }
  | { type: 'reset' }

const MAX_ACTIONS = 100

/**
 * Live tip state, fed by the stream detail, the socket acknowledgements and
 * the tip events of the room
 */
export function liveTipsReducer(state: LiveTipState, event: LiveTipEvent): LiveTipState {
  switch (event.type) {
    case 'snapshot': {
      const { snapshot } = event
      const next = { ...state }
      if (snapshot.tipGoal !== undefined) {
        next.goalAmount = snapshot.tipGoal?.amount ?? null
        next.goalLabel = snapshot.tipGoal?.label ?? null
        if (snapshot.tipGoal) next.total = Math.max(next.total, snapshot.tipGoal.total)
      }
      // The total only grows: a snapshot older than a socket event never lowers it
      if (typeof snapshot.tipTotal === 'number') next.total = Math.max(next.total, snapshot.tipTotal)
      if (Array.isArray(snapshot.tipMenu)) next.menu = snapshot.tipMenu
      if (Array.isArray(snapshot.pendingTipActions)) next.actions = snapshot.pendingTipActions
      return next
    }
    case 'goal':
      return {
        ...state,
        goalAmount: event.amount,
        goalLabel: event.amount === null ? null : event.label,
        // Never go back to an older total (events may cross)
        total: Math.max(state.total, event.total),
      }
    case 'action': {
      const exists = state.actions.some((action) => action.id === event.action.id)
      const actions = exists
        ? state.actions.map((action) => (action.id === event.action.id ? event.action : action))
        : [...state.actions, event.action]
      return { ...state, actions: actions.slice(-MAX_ACTIONS) }
    }
    case 'reset':
      return initialLiveTipState
    default:
      return state
  }
}

/**
 * Feed the reducer with the tip events of a live socket (goal, requests)
 */
export function bindLiveTipEvents(socket: Socket, dispatch: (event: LiveTipEvent) => void) {
  const onGoal = (data: { amount: number | null; label: string | null; total: number }) =>
    dispatch({ type: 'goal', amount: data.amount ?? null, label: data.label ?? null, total: Number(data.total) || 0 })
  const onAction = (data: { action: TipAction }) => {
    if (data?.action) dispatch({ type: 'action', action: data.action })
  }
  socket.on('tip-goal-progress', onGoal)
  socket.on('tip-goal-updated', onGoal)
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
  setGoal: (streamId: string, amount: number | null, label?: string | null) =>
    api.patch<{ streamId: string; amount: number | null; label: string | null; total: number }>(
      `/streaming/${streamId}/tip-goal`,
      { amount, label: label ?? null },
    ),
}

/** Progress of a goal, 0-100 */
export function goalPercent(total: number, amount: number | null) {
  if (!amount || amount <= 0) return 0
  return Math.min(100, Math.floor((total / amount) * 100))
}

const API_ERRORS: [RegExp, string | ((match: RegExpMatchArray) => string)][] = [
  [/more than (\d+) items/i, (m) => `Le menu ne peut pas dépasser ${m[1]} paliers.`],
  [/amount must be between €?([\d.]+) and €?([\d.]+)/i, (m) =>
    `Chaque montant doit être compris entre ${m[1].replace('.', ',')} € et ${Number(m[2]).toLocaleString('fr-FR')} €.`],
  [/label is required/i, 'Chaque palier doit avoir un intitulé.'],
  [/duplicate tip menu item/i, 'Un palier est présent deux fois.'],
  [/before or during the live/i, "L'objectif ne peut être modifié qu'avant ou pendant le live."],
  [/only update your own streams/i, "Ce live ne vous appartient pas."],
  [/stream not found/i, 'Ce live est introuvable.'],
]

/**
 * French message for an error of the tip menu / goal endpoints
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
