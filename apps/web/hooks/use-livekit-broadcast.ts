'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { DisconnectReason, Room, RoomEvent } from 'livekit-client'
import type { ConnectionLevel } from '@/lib/webrtc/bitrate-controller'
import type { QualityPresetId } from '@/lib/webrtc/quality-presets'
import {
  PUBLISHER_ROOM_OPTIONS,
  applyPublishPreset,
  publishBroadcastMedia,
  publishedSenders,
  setPublishedTrackEnabled,
  syncPublishedMedia,
} from '@/lib/livekit/publisher'
import {
  publisherConnectionLevel,
  readPublisherStats,
  type PublisherLayer,
  type PublisherSnapshot,
} from '@/lib/livekit/stats'
import { fetchLiveKitToken, LiveKitTokenError } from '@/lib/livekit/token'

export type LiveKitBroadcastState =
  | 'idle'
  | 'connecting'
  | 'publishing'
  | 'reconnecting'
  /** Another tab or device took over the broadcast */
  | 'replaced'
  /** The room was closed (live ended) */
  | 'ended'
  | 'error'

export interface LiveKitBroadcastHealth {
  presetId: QualityPresetId
  /** LiveKit's estimate of the creator's connection, null while unknown */
  level: ConnectionLevel | null
  uploadKbps?: number
  layers: PublisherLayer[]
  limitation?: string
  rttMs?: number
  updatedAt: number
}

// Delays between automatic attempts to reconnect the publisher (the last one repeats)
const RETRY_DELAYS_MS = [1000, 2000, 5000, 10000]
const STATS_INTERVAL_MS = 2000

interface Options {
  streamId: string | null
  /** Publish while true (LiveKit transport and broadcasting from this page) */
  enabled: boolean
  /** The camera + microphone of the page (preview) */
  getMedia: () => MediaStream | null
  presetId: QualityPresetId
}

/**
 * Creator's LiveKit publication: connects with a publisher token, publishes
 * the page's camera and microphone with simulcast, reconnects with a fresh
 * token after a disconnection, and measures the upload for "Santé du live".
 * LiveKit itself handles network blips (Reconnecting / Reconnected).
 */
export function useLiveKitBroadcast({ streamId, enabled, getMedia, presetId }: Options) {
  const [state, setState] = useState<LiveKitBroadcastState>('idle')
  const [error, setError] = useState<string | null>(null)
  const [health, setHealth] = useState<LiveKitBroadcastHealth | null>(null)
  const roomRef = useRef<Room | null>(null)
  const presetRef = useRef(presetId)
  presetRef.current = presetId
  const getMediaRef = useRef(getMedia)
  getMediaRef.current = getMedia

  useEffect(() => {
    if (!enabled || !streamId) {
      setState('idle')
      return
    }

    let disposed = false
    let attempt = 0
    let retryTimer: ReturnType<typeof setTimeout> | undefined

    const scheduleRetry = () => {
      if (disposed || retryTimer) return
      const delay = RETRY_DELAYS_MS[Math.min(attempt, RETRY_DELAYS_MS.length - 1)]
      attempt += 1
      setState('reconnecting')
      retryTimer = setTimeout(() => {
        retryTimer = undefined
        void connect()
      }, delay)
    }

    const connect = async () => {
      if (disposed) return
      setState(attempt === 0 ? 'connecting' : 'reconnecting')
      let room: Room | null = null
      try {
        const { url, token } = await fetchLiveKitToken(streamId, 'publisher')
        if (disposed) return
        room = new Room(PUBLISHER_ROOM_OPTIONS)
        const current = room
        roomRef.current = current

        current.on(RoomEvent.Reconnecting, () => setState('reconnecting'))
        current.on(RoomEvent.SignalReconnecting, () => setState('reconnecting'))
        current.on(RoomEvent.Reconnected, () => setState('publishing'))
        current.on(RoomEvent.Disconnected, (reason?: DisconnectReason) => {
          if (disposed || roomRef.current !== current) return
          roomRef.current = null
          setHealth(null)
          if (reason === DisconnectReason.CLIENT_INITIATED) return
          if (reason === DisconnectReason.DUPLICATE_IDENTITY) {
            setState('replaced')
          } else if (reason === DisconnectReason.ROOM_DELETED) {
            setState('ended')
          } else if (reason === DisconnectReason.PARTICIPANT_REMOVED) {
            setError('REMOVED')
            setState('error')
          } else {
            scheduleRetry()
          }
        })

        await current.connect(url, token, { autoSubscribe: false })
        if (disposed) {
          await current.disconnect()
          return
        }
        const media = getMediaRef.current()
        if (media) await publishBroadcastMedia(current, media, presetRef.current)
        if (disposed) return
        attempt = 0
        setError(null)
        setState('publishing')
      } catch (err) {
        if (disposed) return
        console.error('LiveKit publish error:', err)
        if (room && roomRef.current === room) {
          roomRef.current = null
          void room.disconnect()
        }
        if (err instanceof LiveKitTokenError && err.final) {
          setError(err.reason)
          setState(err.reason === 'NOT_LIVE' ? 'ended' : 'error')
          return
        }
        scheduleRetry()
      }
    }

    void connect()

    return () => {
      disposed = true
      clearTimeout(retryTimer)
      const room = roomRef.current
      roomRef.current = null
      // Unpublishes the tracks (kept alive for the preview) and leaves the room
      void room?.disconnect()
      setHealth(null)
      setState('idle')
    }
  }, [enabled, streamId])

  // "Santé du live": connection quality and what is sent to the SFU
  useEffect(() => {
    if (state !== 'publishing' && state !== 'reconnecting') return
    let previous: { snapshot: PublisherSnapshot; frames: Record<string, number> } | undefined
    let cancelled = false

    const read = async () => {
      const room = roomRef.current
      if (!room) return
      try {
        const reports = await Promise.all(publishedSenders(room).map((sender) => sender.getStats()))
        if (cancelled) return
        const { sample, snapshot, frames } = readPublisherStats(reports, previous?.snapshot, Date.now(), previous?.frames)
        previous = { snapshot, frames }
        setHealth({
          presetId: presetRef.current,
          level: publisherConnectionLevel(room.localParticipant.connectionQuality),
          uploadKbps: sample.uploadKbps,
          layers: sample.layers,
          limitation: sample.limitation,
          rttMs: sample.rttMs,
          updatedAt: Date.now(),
        })
      } catch {
        // Publication closed meanwhile
      }
    }

    void read()
    const timer = setInterval(() => void read(), STATS_INTERVAL_MS)
    return () => {
      cancelled = true
      clearInterval(timer)
    }
  }, [state])

  /** Device / preset switch: swap the new tracks in and apply the preset's encodings */
  const applyMedia = useCallback(async (media: MediaStream, nextPresetId: QualityPresetId) => {
    const room = roomRef.current
    if (!room) return
    await syncPublishedMedia(room, media)
    await applyPublishPreset(room, nextPresetId)
  }, [])

  const setTrackEnabled = useCallback(async (kind: 'video' | 'audio', on: boolean) => {
    const room = roomRef.current
    if (!room) return
    await setPublishedTrackEnabled(room, kind, on)
  }, [])

  return { state, error, health, applyMedia, setTrackEnabled }
}
