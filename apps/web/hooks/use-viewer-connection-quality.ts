'use client'

import { useEffect, useState, type MutableRefObject } from 'react'
import { classifyViewerQuality, VIEWER_QUALITY_LABELS, type ViewerQuality } from '@/lib/webrtc/connection-quality'
import { readReceiverStats, type ReceiverSnapshot } from '@/lib/webrtc/stats'

/**
 * Quality of the viewer's incoming video, refreshed every 2 s while `enabled`
 */
export function useViewerConnectionQuality(
  peerRef: MutableRefObject<RTCPeerConnection | null>,
  enabled: boolean,
  intervalMs = 2000,
): ViewerQuality | null {
  const [quality, setQuality] = useState<ViewerQuality | null>(null)

  useEffect(() => {
    if (!enabled) {
      setQuality(null)
      return
    }
    let previous: { pc: RTCPeerConnection; snapshot: ReceiverSnapshot } | null = null
    let cancelled = false

    const read = async () => {
      const pc = peerRef.current
      if (!pc || pc.connectionState === 'closed') return
      try {
        const report = await pc.getStats()
        if (cancelled) return
        const samePeer = previous?.pc === pc
        const { sample, snapshot } = readReceiverStats(report, samePeer ? previous?.snapshot : undefined)
        previous = { pc, snapshot }
        // Rates (loss, bitrate) need two readings of the same connection
        if (!samePeer) return
        const level = classifyViewerQuality(sample)
        setQuality({ level, label: VIEWER_QUALITY_LABELS[level], sample })
      } catch {
        // Connection closed meanwhile
      }
    }

    void read()
    const timer = setInterval(() => void read(), intervalMs)
    return () => {
      cancelled = true
      clearInterval(timer)
    }
  }, [peerRef, enabled, intervalMs])

  return quality
}
