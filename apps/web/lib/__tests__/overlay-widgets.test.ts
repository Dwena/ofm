import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  applyQueryOverrides,
  colorAlpha,
  colorHex,
  DEFAULT_OVERLAY_SETTINGS,
  hexToRgba,
  maskOverlayUrl,
  previewUrl,
  renderTemplate,
  validateOverlaySettings,
  withAlpha,
  withDefaults,
} from '../overlay-widgets'
import { alertFromGoal, alertFromTip, enqueueAlert, MAX_QUEUED_ALERTS, type OverlayAlert } from '../overlay-alerts'
import {
  initialOverlayState,
  overlayReducer,
  visibleMessages,
  visibleRequests,
  type OverlayChatMessage,
  type OverlayStateSnapshot,
} from '../overlay-state'
import type { TipAction } from '../live-tips-state'
import { getPathAccess, isOverlayPath } from '../navigation'

const alerts = DEFAULT_OVERLAY_SETTINGS.ALERTS
const fan = { id: 'fan-1', username: 'fan_david', displayName: 'David', avatar: null }

const message = (id: string, extra: Partial<OverlayChatMessage> = {}): OverlayChatMessage => ({
  id,
  userId: 'fan-1',
  username: 'fan',
  message: `message ${id}`,
  timestamp: '2026-10-20T10:00:00.000Z',
  type: 'MESSAGE',
  isCreator: false,
  ...extra,
})

const action = (id: string, status: TipAction['status'], completedAt: string | null = null): TipAction => ({
  id,
  streamId: 'stream-1',
  menuItemId: null,
  label: `Demande ${id}`,
  amount: 10,
  status,
  createdAt: '2026-10-20T10:00:00.000Z',
  completedAt,
  fromUser: fan,
})

const snapshot = (live: OverlayStateSnapshot['live'], settings: OverlayStateSnapshot['settings'] = {}): OverlayStateSnapshot => ({
  creator: { id: 'creator-1', username: 'alice', displayName: 'Alice', avatar: null },
  settings,
  menu: [],
  live,
})

const live = (streamId: string, extra: Partial<NonNullable<OverlayStateSnapshot['live']>> = {}) => ({
  streamId,
  title: 'Live',
  startedAt: null,
  tipTotal: 0,
  goals: [],
  actions: [],
  messages: [],
  ...extra,
})

describe('overlay templates and colors', () => {
  it('fills the placeholders and keeps the unknown ones', () => {
    assert.equal(renderTemplate('{name} a envoyé {amount} !', { name: 'David', amount: '10 €' }), 'David a envoyé 10 € !')
    assert.equal(renderTemplate('{name} {unknown}', { name: 'D' }), 'D {unknown}')
    // Plain text: markup stays as typed (React escapes it)
    assert.equal(renderTemplate('{name}', { name: '<b>x</b>' }), '<b>x</b>')
  })

  it('converts hex colors with alpha', () => {
    assert.equal(hexToRgba('#FF0000'), 'rgba(255, 0, 0, 1)')
    assert.equal(hexToRgba('#11182780'), 'rgba(17, 24, 39, 0.502)')
    assert.equal(hexToRgba('red'), 'rgba(0, 0, 0, 0)')
    assert.equal(colorHex('#f472b6cc'), '#F472B6')
    assert.equal(colorAlpha('#000000FF'), 100)
    assert.equal(colorAlpha('#00000080'), 50)
    assert.equal(withAlpha('#f472b6', 50), '#F472B680')
    assert.equal(withAlpha('#F472B6FF', 0), '#F472B600')
  })

  it('masks the token of an overlay URL and adds the preview flag', () => {
    const url = 'http://localhost:3050/overlay/demo-alice-overlay-token-dev-only-0123456789/alerts'
    const masked = maskOverlayUrl(url)
    assert.ok(!masked.includes('demo-alice-overlay-token-dev-only-0123456789'))
    assert.match(masked, /^http:\/\/localhost:3050\/overlay\/demo•+89\/alerts$/)
    assert.equal(previewUrl(url), `${url}?preview=1`)
    assert.equal(previewUrl(`${url}?a=1`), `${url}?a=1&preview=1`)
  })
})

describe('overlay settings', () => {
  it('validates with the API bounds, in French', () => {
    assert.deepEqual(validateOverlaySettings('ALERTS', alerts), {})
    const errors = validateOverlaySettings('ALERTS', { ...alerts, durationSeconds: 30, textTemplate: ' ', accentColor: 'pink' })
    assert.equal(errors.durationSeconds, 'Entre 3 et 20.')
    assert.equal(errors.textTemplate, 'Ce texte ne peut pas être vide.')
    assert.equal(errors.accentColor, 'Couleur invalide.')
    assert.equal(validateOverlaySettings('CHAT', { ...DEFAULT_OVERLAY_SETTINGS.CHAT, maxMessages: Number.NaN }).maxMessages, 'Nombre invalide.')
  })

  it('completes partial / invalid settings with the defaults', () => {
    assert.deepEqual(withDefaults('GOALS', { layout: 'list', fontSize: 500 }), { ...DEFAULT_OVERLAY_SETTINGS.GOALS, layout: 'list' })
    assert.deepEqual(withDefaults('GOALS', null), DEFAULT_OVERLAY_SETTINGS.GOALS)
  })

  it('applies valid query overrides only', () => {
    const params = new URLSearchParams('fontSize=48&animation=slide&soundEnabled=0&accentColor=00ff00&durationSeconds=99&preview=1&evil=1')
    const result = applyQueryOverrides('ALERTS', alerts, params)
    assert.equal(result.fontSize, 48)
    assert.equal(result.animation, 'slide')
    assert.equal(result.soundEnabled, false)
    assert.equal(result.accentColor, '#00ff00')
    assert.equal(result.durationSeconds, alerts.durationSeconds)
    assert.ok(!('evil' in result) && !('preview' in result))
    assert.equal(applyQueryOverrides('TIP_MENU', DEFAULT_OVERLAY_SETTINGS.TIP_MENU, new URLSearchParams('columns=2')).columns, 2)
    assert.equal(applyQueryOverrides('TIP_MENU', DEFAULT_OVERLAY_SETTINGS.TIP_MENU, new URLSearchParams('columns=3')).columns, 1)
  })
})

describe('overlay alerts', () => {
  const tip = { transactionId: 'tx-1', amount: 10, message: 'Bravo !', menuItemLabel: null, fromUser: fan }

  it('announces a tip with the template and the fan message', () => {
    const alert = alertFromTip(tip, alerts)
    assert.equal(alert?.kind, 'tip')
    assert.equal(alert?.title.replace(/\s/g, ' '), 'David a envoyé 10 € !')
    assert.equal(alert?.message, 'Bravo !')
    assert.equal(alertFromTip(tip, { ...alerts, showMessage: false })?.message, null)
  })

  it('ignores tips under the minimum, never menu requests', () => {
    assert.equal(alertFromTip({ ...tip, amount: 2 }, { ...alerts, minAmount: 5 }), null)
    const request = alertFromTip({ ...tip, amount: 2, menuItemLabel: '🎵 Une chanson' }, { ...alerts, minAmount: 5 })
    assert.equal(request?.kind, 'menu-request')
    assert.equal(request?.title, 'David a demandé : 🎵 Une chanson')
  })

  it('falls back to a tip alert when menu request alerts are off', () => {
    const alert = alertFromTip({ ...tip, menuItemLabel: 'Danse' }, { ...alerts, menuRequestEnabled: false })
    assert.equal(alert?.kind, 'tip')
  })

  it('announces a reached milestone unless disabled', () => {
    const event = { goal: { id: 'g1', amount: 100, label: 'Danse' }, total: 120 }
    assert.equal(alertFromGoal(event, alerts)?.title.replace(/\s/g, ' '), '🎯 Palier atteint : 100 € — Danse')
    assert.equal(alertFromGoal(event, { ...alerts, goalReachedEnabled: false }), null)
    assert.equal(alertFromGoal({ ...event, test: true }, alerts)?.test, true)
  })

  it('queues alerts once each, dropping the oldest of a burst', () => {
    const a = alertFromTip(tip, alerts)
    let queue = enqueueAlert([], a)
    queue = enqueueAlert(queue, a)
    assert.equal(queue.length, 1)
    let burst: OverlayAlert[] = []
    for (let i = 0; i < MAX_QUEUED_ALERTS + 5; i += 1) burst = enqueueAlert(burst, alertFromTip({ ...tip, transactionId: `t${i}` }, alerts))
    assert.equal(burst.length, MAX_QUEUED_ALERTS)
    assert.equal(burst[0].id, 'tip-t5')
  })
})

describe('overlay state', () => {
  it('loads a snapshot with its live and settings', () => {
    const state = overlayReducer(initialOverlayState, {
      type: 'snapshot',
      snapshot: snapshot(live('stream-1', { tipTotal: 42, messages: [message('m1')] }), { CHAT: { tipsOnly: true } }),
    })
    assert.equal(state.status, 'connected')
    assert.equal(state.live?.streamId, 'stream-1')
    assert.equal(state.total, 42)
    assert.equal(state.settings.CHAT.tipsOnly, true)
    assert.equal(state.settings.CHAT.maxMessages, DEFAULT_OVERLAY_SETTINGS.CHAT.maxMessages)
  })

  it('applies live events and dedupes chat lines', () => {
    let state = overlayReducer(initialOverlayState, { type: 'snapshot', snapshot: snapshot(live('stream-1', { messages: [message('m1')] })) })
    state = overlayReducer(state, { type: 'chat', message: message('m1') })
    state = overlayReducer(state, { type: 'chat', message: message('m2') })
    assert.deepEqual(state.messages.map((m) => m.id), ['m1', 'm2'])
    state = overlayReducer(state, { type: 'chat-deleted', messageId: 'm1' })
    assert.deepEqual(state.messages.map((m) => m.id), ['m2'])

    state = overlayReducer(state, { type: 'goals', total: 50, goals: [{ id: 'g', amount: 100, label: 'x', position: 0, reachedAt: null, completedAt: null }] })
    assert.equal(state.total, 50)
    state = overlayReducer(state, { type: 'action', action: action('a1', 'PENDING') })
    state = overlayReducer(state, { type: 'action', action: action('a1', 'DONE', '2026-10-20T11:00:00Z') })
    assert.deepEqual(state.actions.map((a) => a.status), ['DONE'])
  })

  it('never lets a test celebration change the real milestones', () => {
    const state = overlayReducer(initialOverlayState, {
      type: 'reached',
      goal: { id: 'test', amount: 100, label: 'Test', position: 0, reachedAt: 'x', completedAt: null },
      total: 100,
      test: true,
    })
    assert.equal(state, initialOverlayState)
  })

  it('switches lives and clears everything when the live ends', () => {
    let state = overlayReducer(initialOverlayState, { type: 'snapshot', snapshot: snapshot(live('stream-1', { tipTotal: 10, messages: [message('m1')] })) })
    state = overlayReducer(state, { type: 'chat', message: message('t', { test: true }) })
    state = overlayReducer(state, { type: 'live', live: live('stream-1', { tipTotal: 5, messages: [message('m1')] }) })
    // Same live: the total never goes back, test lines are kept
    assert.equal(state.total, 10)
    assert.deepEqual(state.messages.map((m) => m.id), ['m1', 't'])
    state = overlayReducer(state, { type: 'live', live: live('stream-2', { tipTotal: 0 }) })
    assert.equal(state.total, 0)
    assert.deepEqual(state.messages, [])
    state = overlayReducer(state, { type: 'ended' })
    assert.equal(state.live, null)
  })

  it('stays revoked whatever comes next', () => {
    let state = overlayReducer(initialOverlayState, { type: 'status', status: 'revoked' })
    state = overlayReducer(state, { type: 'status', status: 'connected' })
    state = overlayReducer(state, { type: 'snapshot', snapshot: snapshot(null) })
    assert.equal(state.status, 'revoked')
  })

  it('pushes new settings live', () => {
    const state = overlayReducer(initialOverlayState, { type: 'settings', widget: 'ALERTS', settings: { ...alerts, fontSize: 60 } })
    assert.equal(state.settings.ALERTS.fontSize, 60)
  })

  it('lists the requests and the chat lines the widgets show', () => {
    const actions = [action('p1', 'PENDING'), action('d1', 'DONE', '2026-10-20T11:00:00Z'), action('p2', 'PENDING'), action('s1', 'SKIPPED', '2026-10-20T12:00:00Z')]
    assert.deepEqual(visibleRequests(actions, false, 5).map((a) => a.id), ['p1', 'p2'])
    assert.deepEqual(visibleRequests(actions, true, 3).map((a) => a.id), ['p1', 'p2', 's1'])
    const messages = [message('m1'), message('t1', { type: 'TIP' }), message('m2'), message('s1', { type: 'SYSTEM' })]
    assert.deepEqual(visibleMessages(messages, true, 10).map((m) => m.id), ['t1', 's1'])
    assert.deepEqual(visibleMessages(messages, false, 2).map((m) => m.id), ['m2', 's1'])
  })
})

describe('overlay routes', () => {
  it('are public pages, never gated by role', () => {
    assert.equal(isOverlayPath('/overlay/abc/alerts'), true)
    assert.equal(isOverlayPath('/overlays'), false)
    assert.equal(isOverlayPath('/creator/overlays'), false)
    assert.equal(getPathAccess(undefined, '/overlay/abc/chat'), 'ok')
    assert.equal(getPathAccess('SUBSCRIBER', '/creator/overlays'), 'creator-only')
    assert.equal(getPathAccess('CREATOR', '/creator/overlays'), 'ok')
  })
})
