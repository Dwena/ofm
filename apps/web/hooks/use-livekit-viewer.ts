'use client'

import { useCallback, useEffect, useRef, useState, type MutableRefObject, type RefObject } from 'react'
import {
  DisconnectReason,
  RemoteTrack,
  RemoteTrackPublication,
  Room,
  RoomEvent,
  Track,
  VideoQuality,
  type RemoteParticipant,
} from 'livekit-client'
import { fetchLiveKitToken, LiveKitTokenError } from '@/lib/livekit/token'
import { BASE_ROOM_OPTIONS } from '@/lib/livekit/room'
import { viewerQualityRequest, type LiveKitViewerQualityMode } from '@/lib/livekit/presets'
import { viewerConnectionLevel } from '@/lib/livekit/stats'
import {
  classifyViewerQuality,
  VIEWER_QUALITY_LABELS,
  type ViewerQuality,
} from '@/lib/webrtc/connection-quality'
import { readReceiverStats, type ReceiverSnapshot } from '@/lib/webrtc/stats'

/** Same states as the P2P player of the live page */
export type LiveKitViewerState = 'connecting' | 'waiting' | 'playing' | 'reconnecting' | 'error' | 'offline'

// Automatic rejoin after a disconnection, then the "Réessayer" button
const RETRY_DELAYS_MS = [1000, 3000, 6000, 10000]
const STATS_INTERVAL_MS = 2000

const LAYER_QUALITY = {
  high: VideoQuality.HIGH,
  medium: VideoQuality.MEDIUM,
  low: VideoQuality.LOW,
} as const

interface Options {
  streamId: string
  /** Connected while true (LiveKit transport, live in progress, access granted) */
  enabled: boolean
  videoRef: RefObject<HTMLVideoElement>
  /** The player's mute state (autoplay starts muted until "Activer le son") */
  mutedRef: MutableRefObject<boolean>
  mode: LiveKitViewerQualityMode
  /** The room was closed or the token refused because the live is over */
  onEnded?: () => void
}

/**
 * Viewer's LiveKit connection: subscribes to the creator's camera and
 * microphone and plays them in the page's <video> element, with adaptive
 * stream (layer chosen from the player size and bandwidth) unless the
 * viewer picks a quality. LiveKit handles network blips; after a real
 * disconnection the page rejoins with a fresh token.
 */
export function useLiveKitViewer({ streamId, enabled, videoRef, mutedRef, mode, onEnded }: Options) {
  const [state, setState] = useState<LiveKitViewerState>('connecting')
  const [accessError, setAccessError] = useState<string | null>(null)
  const [quality, setQuality] = useState<ViewerQuality | null>(null)
  const [attempt, setAttempt] = useState(0)
  const roomRef = useRef<Room | null>(null)
  const videoPublicationRef = useRef<RemoteTrackPublication | null>(null)
  const modeRef = useRef(mode)
  modeRef.current = mode
  const onEndedRef = useRef(onEnded)
  onEndedRef.current = onEnded

  const applyMode = useCallback((publication: RemoteTrackPublication | null) => {
    if (!publication?.isSubscribed) return
    const request = viewerQualityRequest(modeRef.current)
    publication.setVideoQuality(LAYER_QUALITY[request.layer])
    publication.setVideoFPS(request.fps)
  }, [])

  useEffect(() => {
    if (!enabled) return

    let disposed = false
    let retryCount = 0
    let retryTimer: ReturnType<typeof setTimeout> | undefined
    setAccessError(null)
    setState('connecting')

    const element = () => videoRef.current

    const play = () => {
      const video = element()
      if (!video) return
      // Attaching an audio track unmutes the element: keep the player's choice
      video.muted = mutedRef.current
      video.play().catch(() => undefined)
    }

    const hasVideo = (room: Room) =>
      [...room.remoteParticipants.values()].some((participant) =>
        [...participant.videoTrackPublications.values()].some((publication) => !!publication.track),
      )

    const scheduleRejoin = () => {
      if (disposed || retryTimer) return
      if (retryCount >= RETRY_DELAYS_MS.length) {
        setState('error')
        return
      }
      const delay = RETRY_DELAYS_MS[retryCount]
      retryCount += 1
      setState('reconnecting')
      retryTimer = setTimeout(() => {
        retryTimer = undefined
        void connect()
      }, delay)
    }

    const connect = async () => {
      if (disposed) return
      let room: Room | null = null
      try {
        // Viewer token even for the creator watching its own live
        const { url, token } = await fetchLiveKitToken(streamId, 'viewer')
        if (disposed) return
        room = new Room({ ...BASE_ROOM_OPTIONS, adaptiveStream: true, dynacast: true })
        const current = room
        roomRef.current = current

        current.on(
          RoomEvent.TrackSubscribed,
          (track: RemoteTrack, publication: RemoteTrackPublication, _participant: RemoteParticipant) => {
            const video = element()
            if (!video || roomRef.current !== current) return
            if (track.kind === Track.Kind.Video) {
              videoPublicationRef.current = publication
              track.attach(video)
              applyMode(publication)
              setState('playing')
            } else if (track.kind === Track.Kind.Audio) {
              track.attach(video)
            }
            play()
          },
        )
        current.on(RoomEvent.TrackUnsubscribed, (track: RemoteTrack, publication: RemoteTrackPublication) => {
          const video = element()
          if (video) track.detach(video)
          if (track.kind === Track.Kind.Video && videoPublicationRef.current === publication) {
            videoPublicationRef.current = null
            if (roomRef.current === current && !hasVideo(current)) setState('waiting')
          }
        })
        current.on(RoomEvent.ParticipantDisconnected, () => {
          if (roomRef.current === current && !hasVideo(current)) setState('waiting')
        })
        current.on(RoomEvent.Reconnecting, () => setState('reconnecting'))
        current.on(RoomEvent.Reconnected, () => setState(hasVideo(current) ? 'playing' : 'waiting'))
        current.on(RoomEvent.Disconnected, (reason?: DisconnectReason) => {
          if (disposed || roomRef.current !== current) return
          roomRef.current = null
          videoPublicationRef.current = null
          const video = element()
          if (video) video.srcObject = null
          if (reason === DisconnectReason.CLIENT_INITIATED) return
          if (reason === DisconnectReason.ROOM_DELETED) {
            // The live ended: the socket's stream-ended event shows "Live terminé"
            setState('waiting')
            onEndedRef.current?.()
          } else if (reason === DisconnectReason.PARTICIPANT_REMOVED) {
            setState('error')
          } else {
            scheduleRejoin()
          }
        })

        await current.connect(url, token)
        if (disposed) {
          await current.disconnect()
          return
        }
        retryCount = 0
        // TrackSubscribed may already have fired for a creator who was live
        if (!hasVideo(current)) setState('waiting')
      } catch (error) {
        if (disposed) return
        if (room && roomRef.current === room) {
          roomRef.current = null
          void room.disconnect()
        }
        if (error instanceof LiveKitTokenError && error.final) {
          if (error.reason === 'NOT_LIVE' || error.reason === 'NOT_FOUND') {
            setState('waiting')
            onEndedRef.current?.()
          } else {
            // SUBSCRIPTION_REQUIRED, PPV_PURCHASE_REQUIRED... shown by the page
            setAccessError(error.reason)
            setState('error')
          }
          return
        }
        console.error('LiveKit join error:', error)
        scheduleRejoin()
      }
    }

    void connect()

    return () => {
      disposed = true
      clearTimeout(retryTimer)
      const room = roomRef.current
      roomRef.current = null
      videoPublicationRef.current = null
      void room?.disconnect()
      const video = element()
      if (video) video.srcObject = null
      setQuality(null)
    }
    // `attempt` restarts the connection (Réessayer)
  }, [enabled, streamId, videoRef, mutedRef, applyMode, attempt])

  // Quality choice of the viewer
  useEffect(() => {
    applyMode(videoPublicationRef.current)
  }, [mode, applyMode])

  // Connection badge: LiveKit's estimate + inbound video stats
  useEffect(() => {
    if (state !== 'playing' && state !== 'reconnecting') {
      setQuality(null)
      return
    }
    let previous: ReceiverSnapshot | undefined
    let cancelled = false

    const read = async () => {
      const room = roomRef.current
      const track = videoPublicationRef.current?.track
      const receiver = track?.receiver
      if (!room || !receiver) return
      try {
        const report = await receiver.getStats()
        if (cancelled) return
        const { sample, snapshot } = readReceiverStats(report, previous)
        const first = !previous
        previous = snapshot
        if (first) return
        const level =
          viewerConnectionLevel(room.localParticipant.connectionQuality, classifyViewerQuality(sample)) ?? 'good'
        setQuality({ level, label: VIEWER_QUALITY_LABELS[level], sample })
      } catch {
        // Track ended meanwhile
      }
    }

    void read()
    const timer = setInterval(() => void read(), STATS_INTERVAL_MS)
    return () => {
      cancelled = true
      clearInterval(timer)
    }
  }, [state])

  const retry = useCallback(() => setAttempt((n) => n + 1), [])

  return { state, quality, accessError, retry }
}
