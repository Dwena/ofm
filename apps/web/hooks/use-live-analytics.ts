'use client'

import { useEffect, useRef, useState } from 'react'
import { QueryKey, useQueryClient } from '@tanstack/react-query'
import { useSocket } from '@/hooks/use-socket'

/** Polling fallback for live metrics (ms) */
export const LIVE_REFETCH_INTERVAL = 30000

/** Notification types that change creator metrics (earnings, subscribers) */
const METRIC_NOTIFICATION_TYPES = new Set([
  'NEW_SUBSCRIBER',
  'NEW_TIP',
  'SUBSCRIPTION_RENEWAL',
  'PAYOUT_COMPLETED',
  'NEW_COMMENT',
])

/** Socket events that should refresh metrics */
const METRIC_EVENTS = ['notification:new', 'analytics:update'] as const

interface LiveEventPayload {
  type?: string
  metadata?: { kind?: string } | null
}

function isMetricEvent(event: string, payload: LiveEventPayload | undefined) {
  if (event === 'analytics:update') return true
  if (!payload?.type) return false
  if (METRIC_NOTIFICATION_TYPES.has(payload.type)) return true
  // PPV purchases are sent as SYSTEM notifications with a purchase marker
  const kind = payload.metadata?.kind?.toUpperCase()
  return kind === 'PURCHASE' || kind === 'PPV_PURCHASE'
}

/**
 * Keeps creator analytics fresh: queries poll every LIVE_REFETCH_INTERVAL (set
 * `refetchInterval` on them), and the given query keys are invalidated immediately
 * when the realtime socket (/messaging namespace) pushes a new subscriber, tip or
 * purchase event to the current user.
 */
export function useLiveAnalytics(queryKeys: QueryKey[]) {
  const queryClient = useQueryClient()
  const { socket, connected } = useSocket()
  const [lastEventAt, setLastEventAt] = useState<number | null>(null)
  const keysRef = useRef(queryKeys)
  keysRef.current = queryKeys

  useEffect(() => {
    if (!socket || !connected) return

    const handlers = METRIC_EVENTS.map((event) => {
      const handler = (payload?: LiveEventPayload) => {
        if (!isMetricEvent(event, payload)) return
        keysRef.current.forEach((queryKey) => queryClient.invalidateQueries({ queryKey }))
        setLastEventAt(Date.now())
      }
      socket.on(event, handler)
      return { event, handler }
    })

    return () => {
      handlers.forEach(({ event, handler }) => socket.off(event, handler))
    }
  }, [socket, connected, queryClient])

  return { connected, lastEventAt }
}
