'use client'

import { useEffect, useMemo, useReducer, useRef, useState } from 'react'
import { io } from 'socket.io-client'
import type { TipGoal } from '@/lib/live-tip-goals'
import type { TipAction, TipMenuItem } from '@/lib/live-tips-state'
import type { OverlayGoalReachedEvent, OverlayTipEvent } from '@/lib/overlay-alerts'
import {
  initialOverlayState,
  overlayReducer,
  type OverlayChatMessage,
  type OverlayLiveSnapshot,
  type OverlayStateSnapshot,
} from '@/lib/overlay-state'
import { applyQueryOverrides, isOverlayWidget, type OverlaySettingsMap, type OverlayWidget } from '@/lib/overlay-widgets'

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001'

/** Error of the socket middleware for an unknown token (see the API overlays gateway) */
const INVALID_OVERLAY_TOKEN = 'INVALID_OVERLAY_TOKEN'

export interface OverlayHandlers {
  /** Every `tip` event (real or test), for the alert box */
  onTip?: (tip: OverlayTipEvent) => void
  /** Every `tip-goal-reached` event (real or test) */
  onGoalReached?: (event: OverlayGoalReachedEvent) => void
}

/**
 * State of an OBS overlay page (no session: the token of the URL is the only
 * credential). Loads GET /overlays/:token/state, then follows the `/overlays`
 * socket (auto-reconnect; a fresh state comes with every reconnection).
 * Query parameters of the page override the widget's settings, `?preview=1`
 * turns the preview mode on (checkerboard, hints).
 */
export function useOverlay<W extends OverlayWidget>(token: string, widget: W, handlers: OverlayHandlers = {}) {
  const [state, dispatch] = useReducer(overlayReducer, initialOverlayState)
  const [params, setParams] = useState<URLSearchParams | null>(null)
  const handlersRef = useRef(handlers)
  handlersRef.current = handlers

  useEffect(() => {
    setParams(new URLSearchParams(window.location.search))
  }, [])

  useEffect(() => {
    let cancelled = false
    let revoked = false

    fetch(`${API_URL}/api/v1/overlays/${encodeURIComponent(token)}/state`, { cache: 'no-store' })
      .then(async (response) => {
        if (cancelled) return
        if (response.status === 404 || response.status === 400) {
          dispatch({ type: 'status', status: 'invalid' })
          return
        }
        if (!response.ok) return
        const body = await response.json()
        if (!cancelled && body?.data) dispatch({ type: 'snapshot', snapshot: body.data as OverlayStateSnapshot })
      })
      .catch(() => {
        // API unreachable: the socket keeps retrying and brings the state once connected
        if (!cancelled) dispatch({ type: 'status', status: 'reconnecting' })
      })

    const socket = io(`${API_URL}/overlays`, {
      auth: { overlayToken: token },
      transports: ['websocket', 'polling'],
      reconnectionDelay: 1000,
      reconnectionDelayMax: 10000,
    })

    socket.on('overlay-ready', (snapshot: OverlayStateSnapshot | null) => {
      if (snapshot) dispatch({ type: 'snapshot', snapshot })
      else dispatch({ type: 'status', status: 'connected' })
    })
    socket.on('connect_error', (error: Error) => {
      if (error?.message === INVALID_OVERLAY_TOKEN) {
        dispatch({ type: 'status', status: 'invalid' })
        socket.disconnect()
        return
      }
      dispatch({ type: 'status', status: 'reconnecting' })
    })
    socket.on('overlay-revoked', () => {
      revoked = true
      dispatch({ type: 'status', status: 'revoked' })
    })
    socket.on('disconnect', (reason: string) => {
      if (revoked) return
      dispatch({ type: 'status', status: 'reconnecting' })
      // Disconnected by the server without a revocation (e.g. restart): come back
      if (reason === 'io server disconnect') setTimeout(() => !cancelled && socket.connect(), 2000)
    })

    socket.on('settings-updated', (data: { widget?: string; settings?: unknown }) => {
      if (isOverlayWidget(data?.widget)) dispatch({ type: 'settings', widget: data.widget, settings: data.settings })
    })
    socket.on('overlay-live-changed', (data: { live?: OverlayLiveSnapshot | null }) =>
      dispatch({ type: 'live', live: data?.live ?? null }),
    )
    socket.on('stream-ended', () => dispatch({ type: 'ended' }))
    socket.on('tip-menu-updated', (data: { items?: TipMenuItem[] }) => {
      if (Array.isArray(data?.items)) dispatch({ type: 'menu', items: data.items })
    })
    socket.on('chat-message', (message: OverlayChatMessage) => {
      if (message?.id) dispatch({ type: 'chat', message })
    })
    socket.on('chat-message-deleted', (data: { messageId?: string }) => {
      if (data?.messageId) dispatch({ type: 'chat-deleted', messageId: data.messageId })
    })
    const onGoals = (data: { total?: number; goals?: TipGoal[] }) => {
      if (Array.isArray(data?.goals)) dispatch({ type: 'goals', total: Number(data.total) || 0, goals: data.goals })
    }
    socket.on('tip-goal-progress', onGoals)
    socket.on('tip-goals-updated', onGoals)
    socket.on('tip-goal-updated', (data: { goal?: TipGoal }) => {
      if (data?.goal) dispatch({ type: 'goal', goal: data.goal })
    })
    socket.on('tip-goal-reached', (data: OverlayGoalReachedEvent) => {
      if (!data?.goal) return
      dispatch({ type: 'reached', goal: data.goal as TipGoal, total: Number(data.total) || 0, test: !!data.test })
      handlersRef.current.onGoalReached?.(data)
    })
    const onAction = (data: { action?: TipAction }) => {
      if (data?.action) dispatch({ type: 'action', action: data.action })
    }
    socket.on('tip-action-created', onAction)
    socket.on('tip-action-updated', onAction)
    socket.on('tip', (tip: OverlayTipEvent) => {
      if (tip) handlersRef.current.onTip?.(tip)
    })

    return () => {
      cancelled = true
      socket.removeAllListeners()
      socket.disconnect()
    }
  }, [token])

  const settings = useMemo(
    () => applyQueryOverrides(widget, state.settings[widget], params) as OverlaySettingsMap[W],
    [widget, state.settings, params],
  )
  const preview = params?.get('preview') === '1' || params?.get('preview') === 'true'

  return { state, settings, preview }
}
