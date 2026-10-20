/**
 * Donation goals of a live ("objectifs de dons"): milestones on the live's
 * cumulative tip total. Pure helpers (no React, no network), shared by the
 * viewer progress, the creator editor and the live tip reducer.
 */

/** Milestone of a live's donation goal (amount in euros) */
export interface TipGoal {
  id: string
  amount: number
  /** Free text written by the creator */
  label: string
  position: number
  /** When the live's total reached the amount */
  reachedAt: string | null
  /** When the creator marked it as done */
  completedAt: string | null
}

/** Same limits as the API (PUT /streaming/:id/tip-goals) */
export const TIP_GOALS_MAX = 10
export const TIP_GOAL_MIN_AMOUNT = 1
export const TIP_GOAL_MAX_AMOUNT = 100000
export const TIP_GOAL_LABEL_MAX = 120

export const sortGoals = (goals: TipGoal[]) =>
  [...goals].sort((a, b) => a.amount - b.amount || a.position - b.position)

export const isGoalReached = (goal: TipGoal, total: number) => !!goal.reachedAt || total >= goal.amount

/** First milestone not reached yet (null when there is none) */
export function nextGoal(goals: TipGoal[], total: number): TipGoal | null {
  return sortGoals(goals).find((goal) => !isGoalReached(goal, total)) ?? null
}

/** Euros the progress track spans: the highest milestone, or the total once above it */
export function goalsScale(goals: TipGoal[], total: number) {
  const highest = goals.reduce((max, goal) => Math.max(max, goal.amount), 0)
  return Math.max(highest, total, 0)
}

/** Position on the track, 0-100 */
export function scalePercent(amount: number, scale: number) {
  if (!(scale > 0)) return 0
  return Math.min(100, Math.max(0, (amount / scale) * 100))
}

/** Euros still missing before a milestone, rounded to the cent */
export const remainingBefore = (goal: TipGoal, total: number) =>
  Math.max(0, Math.round((goal.amount - total) * 100) / 100)

/** "100 €", "12,50 €" */
export function formatGoalEuros(amount: number) {
  const decimals = Number.isInteger(amount) ? 0 : 2
  return new Intl.NumberFormat('fr-FR', {
    style: 'currency',
    currency: 'EUR',
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  }).format(amount)
}

/** Text of the celebration / chat line of a milestone reached */
export const goalReachedText = (goal: { amount: number; label: string }) =>
  `🎯 Palier atteint : ${formatGoalEuros(goal.amount)} — ${goal.label}`

/**
 * Milestones received in a snapshot (stream detail poll, socket ack) that
 * may be older than the socket events already applied: a milestone the
 * client already knows as reached (same id and amount) stays reached.
 */
export function mergeGoalsSnapshot(current: TipGoal[], incoming: TipGoal[]): TipGoal[] {
  const known = new Map(current.map((goal) => [goal.id, goal]))
  return sortGoals(
    incoming.map((goal) => {
      const previous = known.get(goal.id)
      if (!goal.reachedAt && previous?.reachedAt && previous.amount === goal.amount) {
        return { ...goal, reachedAt: previous.reachedAt }
      }
      return goal
    }),
  )
}

/** Replace one milestone (done / not done), keeping the order */
export function upsertGoal(goals: TipGoal[], goal: TipGoal): TipGoal[] {
  const exists = goals.some((item) => item.id === goal.id)
  return sortGoals(exists ? goals.map((item) => (item.id === goal.id ? goal : item)) : [...goals, goal])
}

// ---- Editor -------------------------------------------------------------

/** Row of the goals editor (inputs as typed) */
export interface GoalDraft {
  /** React key */
  key: string
  /** Saved milestone this row edits */
  id?: string
  amount: string
  label: string
}

export interface GoalDraftErrors {
  amount?: string
  label?: string
}

/** Euros typed by the creator ("12,5" or "12.5"), NaN when invalid */
export function parseGoalAmount(input: string): number {
  const normalized = input.trim().replace(/\s/g, '').replace(',', '.')
  if (!/^\d+(\.\d*)?$/.test(normalized)) return Number.NaN
  return Number(normalized)
}

/**
 * French validation of the editor rows, mirroring the API: amount 1 to
 * 100 000 € with two decimals at most, distinct amounts, label 1 to 120
 * characters. Returns the errors by row key (empty when valid).
 */
export function validateGoalDrafts(drafts: GoalDraft[]): Record<string, GoalDraftErrors> {
  const errors: Record<string, GoalDraftErrors> = {}
  const set = (key: string, field: keyof GoalDraftErrors, message: string) => {
    errors[key] = { ...errors[key], [field]: errors[key]?.[field] ?? message }
  }

  const seen = new Map<number, string>()
  for (const draft of drafts) {
    const amount = parseGoalAmount(draft.amount)
    if (!draft.amount.trim()) {
      set(draft.key, 'amount', 'Indiquez un montant.')
    } else if (!Number.isFinite(amount)) {
      set(draft.key, 'amount', 'Montant invalide.')
    } else if (amount < TIP_GOAL_MIN_AMOUNT || amount > TIP_GOAL_MAX_AMOUNT) {
      set(draft.key, 'amount', `Entre ${formatGoalEuros(TIP_GOAL_MIN_AMOUNT)} et ${formatGoalEuros(TIP_GOAL_MAX_AMOUNT)}.`)
    } else if (Math.abs(amount * 100 - Math.round(amount * 100)) > 1e-6) {
      set(draft.key, 'amount', 'Deux décimales maximum.')
    } else {
      const cents = Math.round(amount * 100)
      const other = seen.get(cents)
      if (other !== undefined) {
        set(draft.key, 'amount', 'Deux paliers ne peuvent pas avoir le même montant.')
        set(other, 'amount', 'Deux paliers ne peuvent pas avoir le même montant.')
      } else {
        seen.set(cents, draft.key)
      }
    }

    const label = draft.label.trim()
    if (!label) {
      set(draft.key, 'label', 'Indiquez ce que vous ferez à ce palier.')
    } else if (label.length > TIP_GOAL_LABEL_MAX) {
      set(draft.key, 'label', `${TIP_GOAL_LABEL_MAX} caractères maximum.`)
    }
  }
  return errors
}

/** Body of PUT /streaming/:id/tip-goals, sorted by amount */
export function toGoalsPayload(drafts: GoalDraft[]) {
  return drafts
    .map((draft) => ({
      ...(draft.id ? { id: draft.id } : {}),
      amount: Math.round(parseGoalAmount(draft.amount) * 100) / 100,
      label: draft.label.trim(),
    }))
    .sort((a, b) => a.amount - b.amount)
}

/** Amount as shown in the editor input (French decimal comma) */
export const amountInputValue = (amount: number) => String(amount).replace('.', ',')
