/**
 * State of an OBS overlay page, fed by GET /overlays/:token/state and the
 * events of the `/overlays` socket. Pure reducer (no React, no network).
 */
import { mergeGoalsSnapshot, sortGoals, upsertGoal, type TipGoal } from './live-tip-goals'
import type { TipAction, TipMenuItem } from './live-tips-state'
import { DEFAULT_OVERLAY_SETTINGS, OVERLAY_WIDGETS, withDefaults, type OverlaySettingsMap, type OverlayWidget } from './overlay-widgets'

export interface OverlayCreator {
  id: string
  username: string
  displayName: string | null
  avatar: string | null
}

/** Chat line as relayed to the overlays (same shape as the live chat) */
export interface OverlayChatMessage {
  id: string
  userId: string
  username: string
  displayName?: string | null
  avatar?: string | null
  message: string
  timestamp: string
  type: 'MESSAGE' | 'TIP' | 'SYSTEM'
  isCreator: boolean
  tipAmount?: number
  menuItemLabel?: string | null
  /** Fake line sent by the creator's "Tester" button */
  test?: boolean
}

export interface OverlayLiveSnapshot {
  streamId: string
  title: string
  startedAt: string | null
  tipTotal: number
  goals: TipGoal[]
  actions: TipAction[]
  messages: OverlayChatMessage[]
}

/** Body of GET /overlays/:token/state and of the `overlay-ready` event */
export interface OverlayStateSnapshot {
  creator: OverlayCreator
  settings: Partial<Record<OverlayWidget, unknown>>
  menu: TipMenuItem[]
  live: OverlayLiveSnapshot | null
}

export type OverlayStatus =
  /** First load */
  | 'loading'
  | 'connected'
  /** Socket lost, socket.io retries */
  | 'reconnecting'
  /** The creator regenerated the URLs: this one no longer works */
  | 'revoked'
  /** Unknown token (never valid, or regenerated while offline) */
  | 'invalid'

export interface OverlayState {
  status: OverlayStatus
  creator: OverlayCreator | null
  settings: OverlaySettingsMap
  menu: TipMenuItem[]
  live: { streamId: string; title: string } | null
  total: number
  goals: TipGoal[]
  actions: TipAction[]
  messages: OverlayChatMessage[]
}

export const initialOverlayState: OverlayState = {
  status: 'loading',
  creator: null,
  settings: DEFAULT_OVERLAY_SETTINGS,
  menu: [],
  live: null,
  total: 0,
  goals: [],
  actions: [],
  messages: [],
}

/** Chat lines kept in memory (the chat widget shows at most 50) */
export const MAX_OVERLAY_MESSAGES = 60
const MAX_OVERLAY_ACTIONS = 100

export type OverlayEvent =
  | { type: 'snapshot'; snapshot: OverlayStateSnapshot }
  | { type: 'live'; live: OverlayLiveSnapshot | null }
  | { type: 'settings'; widget: OverlayWidget; settings: unknown }
  | { type: 'menu'; items: TipMenuItem[] }
  | { type: 'chat'; message: OverlayChatMessage }
  | { type: 'chat-deleted'; messageId: string }
  | { type: 'goals'; total: number; goals: TipGoal[] }
  | { type: 'goal'; goal: TipGoal }
  | { type: 'reached'; goal: TipGoal; total: number; test?: boolean }
  | { type: 'action'; action: TipAction }
  | { type: 'ended' }
  | { type: 'status'; status: OverlayStatus }

const settingsOf = (settings: OverlayStateSnapshot['settings'] | undefined): OverlaySettingsMap => {
  const result = {} as Record<OverlayWidget, unknown>
  for (const widget of OVERLAY_WIDGETS) result[widget] = withDefaults(widget, settings?.[widget])
  return result as OverlaySettingsMap
}

function appendMessage(messages: OverlayChatMessage[], message: OverlayChatMessage) {
  if (messages.some((item) => item.id === message.id)) return messages
  return [...messages, message].slice(-MAX_OVERLAY_MESSAGES)
}

function withLive(state: OverlayState, live: OverlayLiveSnapshot | null): OverlayState {
  if (!live) {
    return { ...state, live: null, total: 0, goals: [], actions: [], messages: [] }
  }
  const sameLive = state.live?.streamId === live.streamId
  // Test lines (never persisted) survive a refresh of the same live
  const tests = sameLive ? state.messages.filter((message) => message.test) : []
  const messages = [...live.messages, ...tests].slice(-MAX_OVERLAY_MESSAGES)
  return {
    ...state,
    live: { streamId: live.streamId, title: live.title },
    total: sameLive ? Math.max(state.total, live.tipTotal) : live.tipTotal,
    goals: sameLive ? mergeGoalsSnapshot(state.goals, live.goals) : sortGoals(live.goals),
    actions: live.actions,
    messages,
  }
}

export function overlayReducer(state: OverlayState, event: OverlayEvent): OverlayState {
  switch (event.type) {
    case 'snapshot': {
      const { snapshot } = event
      return withLive(
        {
          ...state,
          // A snapshot never revives a revoked / invalid overlay
          status: state.status === 'revoked' || state.status === 'invalid' ? state.status : 'connected',
          creator: snapshot.creator,
          settings: settingsOf(snapshot.settings),
          menu: Array.isArray(snapshot.menu) ? snapshot.menu : [],
        },
        snapshot.live,
      )
    }
    case 'live':
      return withLive(state, event.live)
    case 'settings':
      return { ...state, settings: { ...state.settings, [event.widget]: withDefaults(event.widget, event.settings) } }
    case 'menu':
      return { ...state, menu: event.items }
    case 'chat':
      return { ...state, messages: appendMessage(state.messages, event.message) }
    case 'chat-deleted':
      return { ...state, messages: state.messages.filter((message) => message.id !== event.messageId) }
    case 'goals':
      return { ...state, goals: sortGoals(event.goals), total: Math.max(state.total, event.total) }
    case 'goal':
      return { ...state, goals: upsertGoal(state.goals, event.goal) }
    case 'reached':
      // A test celebration never changes the real milestones
      if (event.test) return state
      return { ...state, goals: upsertGoal(state.goals, event.goal), total: Math.max(state.total, event.total) }
    case 'action': {
      const exists = state.actions.some((action) => action.id === event.action.id)
      const actions = exists
        ? state.actions.map((action) => (action.id === event.action.id ? event.action : action))
        : [...state.actions, event.action]
      return { ...state, actions: actions.slice(-MAX_OVERLAY_ACTIONS) }
    }
    case 'ended':
      return withLive(state, null)
    case 'status':
      if (state.status === 'revoked' || state.status === 'invalid') return state
      return { ...state, status: event.status }
    default:
      return state
  }
}

/** Requests shown by the requests widget: pending first (oldest first), then done / skipped */
export function visibleRequests(actions: TipAction[], includeDone: boolean, maxItems: number) {
  const pending = actions.filter((action) => action.status === 'PENDING')
  const finished = includeDone
    ? actions
        .filter((action) => action.status !== 'PENDING')
        .sort((a, b) => (b.completedAt ?? '').localeCompare(a.completedAt ?? ''))
    : []
  return [...pending, ...finished].slice(0, maxItems)
}

/** Chat lines shown by the chat widget (latest `maxMessages`, tips and announcements only if asked) */
export function visibleMessages(messages: OverlayChatMessage[], tipsOnly: boolean, maxMessages: number) {
  const filtered = tipsOnly ? messages.filter((message) => message.type !== 'MESSAGE') : messages
  return filtered.slice(-maxMessages)
}
