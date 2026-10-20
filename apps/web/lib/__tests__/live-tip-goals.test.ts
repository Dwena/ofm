import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  formatGoalEuros,
  goalReachedText,
  goalsScale,
  mergeGoalsSnapshot,
  nextGoal,
  parseGoalAmount,
  remainingBefore,
  scalePercent,
  toGoalsPayload,
  validateGoalDrafts,
  type GoalDraft,
  type TipGoal,
} from '../live-tip-goals'
import { CELEBRATION_MS, initialLiveTipState, liveTipsReducer } from '../live-tips-state'

const goal = (amount: number, label: string, extra: Partial<TipGoal> = {}): TipGoal => ({
  id: `goal-${amount}`,
  amount,
  label,
  position: 0,
  reachedAt: null,
  completedAt: null,
  ...extra,
})

const draft = (key: string, amount: string, label: string, id?: string): GoalDraft => ({ key, amount, label, id })

// Intl uses narrow / regular no-break spaces
const plain = (text: string) => text.replace(/[  ]/g, ' ')

describe('donation goals helpers', () => {
  it('formats euros without useless decimals', () => {
    assert.equal(plain(formatGoalEuros(100)), '100 €')
    assert.equal(plain(formatGoalEuros(12.5)), '12,50 €')
    assert.equal(plain(goalReachedText({ amount: 200, label: 'Bonus' })), '🎯 Palier atteint : 200 € — Bonus')
  })

  it('finds the next milestone and the euros still missing', () => {
    const goals = [goal(500, 'C'), goal(100, 'A', { reachedAt: '2026-10-20T12:00:00Z' }), goal(200, 'B')]
    assert.equal(nextGoal(goals, 150)?.label, 'B')
    assert.equal(remainingBefore(goal(200, 'B'), 149.99), 50.01)
    assert.equal(nextGoal(goals, 600), null)
  })

  it('scales the track to the highest milestone, or to the total once above', () => {
    const goals = [goal(100, 'A'), goal(500, 'B')]
    assert.equal(goalsScale(goals, 50), 500)
    assert.equal(goalsScale(goals, 800), 800)
    assert.equal(scalePercent(100, 500), 20)
    assert.equal(scalePercent(900, 500), 100)
    assert.equal(scalePercent(10, 0), 0)
  })

  it('parses French amounts', () => {
    assert.equal(parseGoalAmount('12,5'), 12.5)
    assert.equal(parseGoalAmount(' 1 000 '), 1000)
    assert.ok(Number.isNaN(parseGoalAmount('-5')))
    assert.ok(Number.isNaN(parseGoalAmount('abc')))
  })

  it('validates the editor rows like the API', () => {
    assert.deepEqual(validateGoalDrafts([draft('a', '100', 'Questions'), draft('b', '200,5', 'Bonus')]), {})

    const errors = validateGoalDrafts([
      draft('empty', '', ''),
      draft('low', '0,5', 'x'),
      draft('high', '100001', 'x'),
      draft('decimals', '10,555', 'x'),
      draft('dup1', '50', 'x'),
      draft('dup2', '50,00', 'x'),
      draft('long', '60', 'x'.repeat(121)),
    ])
    assert.equal(errors.empty.amount, 'Indiquez un montant.')
    assert.equal(errors.empty.label, 'Indiquez ce que vous ferez à ce palier.')
    assert.match(plain(errors.low.amount ?? ''), /Entre 1 € et 100 000 €/)
    assert.ok(errors.high.amount)
    assert.equal(errors.decimals.amount, 'Deux décimales maximum.')
    assert.equal(errors.dup1.amount, 'Deux paliers ne peuvent pas avoir le même montant.')
    assert.equal(errors.dup2.amount, 'Deux paliers ne peuvent pas avoir le même montant.')
    assert.equal(errors.long.label, '120 caractères maximum.')
  })

  it('sends the milestones sorted by amount, with trimmed labels and their ids', () => {
    assert.deepEqual(toGoalsPayload([draft('a', '500', ' C '), draft('b', '100,5', 'A', 'id-1')]), [
      { id: 'id-1', amount: 100.5, label: 'A' },
      { amount: 500, label: 'C' },
    ])
  })

  it('keeps a milestone reached when an older snapshot arrives', () => {
    const current = [goal(100, 'A', { reachedAt: '2026-10-20T12:00:00Z' })]
    assert.equal(mergeGoalsSnapshot(current, [goal(100, 'A')])[0].reachedAt, '2026-10-20T12:00:00Z')
    // Not when its amount changed
    assert.equal(mergeGoalsSnapshot(current, [{ ...goal(150, 'A'), id: 'goal-100' }])[0].reachedAt, null)
  })
})

describe('liveTipsReducer (donation goals)', () => {
  it('loads the total and the milestones from a snapshot, never lowering the total', () => {
    let state = liveTipsReducer(initialLiveTipState, {
      type: 'snapshot',
      snapshot: { tipTotal: 40, tipGoals: [goal(200, 'B'), goal(100, 'A')] },
    })
    assert.equal(state.total, 40)
    assert.deepEqual(state.goals.map((g) => g.amount), [100, 200])
    state = liveTipsReducer(state, { type: 'snapshot', snapshot: { tipTotal: 10 } })
    assert.equal(state.total, 40)
  })

  it('applies progress, updates and reached milestones', () => {
    let state = liveTipsReducer(initialLiveTipState, { type: 'goals', total: 0, goals: [goal(100, 'A'), goal(200, 'B')] })
    const reachedA = goal(100, 'A', { reachedAt: '2026-10-20T12:00:00Z' })
    const reachedB = goal(200, 'B', { reachedAt: '2026-10-20T12:00:00Z' })

    // One big tip crossing two milestones: one celebration with both
    state = liveTipsReducer(state, { type: 'goals', total: 240, goals: [reachedA, reachedB] })
    state = liveTipsReducer(state, { type: 'reached', goal: reachedA, total: 240, at: 1000 })
    state = liveTipsReducer(state, { type: 'reached', goal: reachedB, total: 240, at: 1010 })
    assert.equal(state.total, 240)
    assert.deepEqual(state.celebration?.goals.map((g) => g.amount), [100, 200])
    const key = state.celebration?.key ?? -1

    // A later milestone starts a new celebration
    const later = liveTipsReducer(state, { type: 'reached', goal: goal(300, 'C'), total: 300, at: 1010 + CELEBRATION_MS })
    assert.notEqual(later.celebration?.key, key)
    assert.deepEqual(later.celebration?.goals.map((g) => g.amount), [300])

    // Marked as done by the creator
    state = liveTipsReducer(state, { type: 'goal', goal: { ...reachedA, completedAt: '2026-10-20T12:05:00Z' } })
    assert.equal(state.goals[0].completedAt, '2026-10-20T12:05:00Z')

    // The banner ends (an old key does nothing)
    assert.equal(liveTipsReducer(state, { type: 'celebration-end', key: key + 5 }).celebration?.key, key)
    assert.equal(liveTipsReducer(state, { type: 'celebration-end', key }).celebration, null)
  })

  it('replaces the milestones when the creator saves them', () => {
    let state = liveTipsReducer(initialLiveTipState, { type: 'goals', total: 50, goals: [goal(100, 'A')] })
    state = liveTipsReducer(state, { type: 'goals', total: 50, goals: [] })
    assert.deepEqual(state.goals, [])
    assert.equal(state.total, 50)
  })
})
