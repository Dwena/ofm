import { mergeGoalsSnapshot, sortGoals, upsertGoal, type TipGoal } from './live-tip-goals'

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
  /** Euros of completed tips sent from the live (the pot of the milestones) */
  tipTotal?: number
  tipGoals?: TipGoal[]
  tipMenu?: TipMenuItem[]
  pendingTipActions?: TipAction[]
}

/** Milestones just reached, shown for a few seconds */
export interface GoalCelebration {
  /** Changes with every new celebration */
  key: number
  /** Milestones reached (one big tip may unlock several) */
  goals: TipGoal[]
  /** Time of the last milestone reached (ms) */
  at: number
}

export interface LiveTipState {
  /** Euros of completed tips sent from the live */
  total: number
  /** Milestones, by amount */
  goals: TipGoal[]
  menu: TipMenuItem[]
  actions: TipAction[]
  celebration: GoalCelebration | null
}

export const initialLiveTipState: LiveTipState = {
  total: 0,
  goals: [],
  menu: [],
  actions: [],
  celebration: null,
}

/** How long a milestone celebration stays on screen; reached milestones within it are grouped */
export const CELEBRATION_MS = 5000

export type LiveTipEvent =
  | { type: 'snapshot'; snapshot: LiveTipSnapshot }
  /** tip-goal-progress (every tip) and tip-goals-updated (creator saved the milestones) */
  | { type: 'goals'; total: number; goals: TipGoal[] }
  /** tip-goal-updated: one milestone marked as done / not done */
  | { type: 'goal'; goal: TipGoal }
  /** tip-goal-reached */
  | { type: 'reached'; goal: TipGoal; total: number; at: number }
  | { type: 'celebration-end'; key: number }
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
      // The total only grows: a snapshot older than a socket event never lowers it
      if (typeof snapshot.tipTotal === 'number') next.total = Math.max(next.total, snapshot.tipTotal)
      if (Array.isArray(snapshot.tipGoals)) next.goals = mergeGoalsSnapshot(state.goals, snapshot.tipGoals)
      if (Array.isArray(snapshot.tipMenu)) next.menu = snapshot.tipMenu
      if (Array.isArray(snapshot.pendingTipActions)) next.actions = snapshot.pendingTipActions
      return next
    }
    case 'goals':
      return {
        ...state,
        goals: sortGoals(event.goals),
        // Never go back to an older total (events may cross)
        total: Math.max(state.total, event.total),
      }
    case 'goal':
      return { ...state, goals: upsertGoal(state.goals, event.goal) }
    case 'reached': {
      const goals = upsertGoal(state.goals, event.goal)
      const previous = state.celebration
      const grouped = previous && event.at - previous.at < CELEBRATION_MS
      const celebration: GoalCelebration = grouped
        ? {
            key: previous.key,
            goals: sortGoals([...previous.goals.filter((goal) => goal.id !== event.goal.id), event.goal]),
            at: event.at,
          }
        : { key: (previous?.key ?? 0) + 1, goals: [event.goal], at: event.at }
      return { ...state, goals, total: Math.max(state.total, event.total), celebration }
    }
    case 'celebration-end':
      return state.celebration?.key === event.key ? { ...state, celebration: null } : state
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
