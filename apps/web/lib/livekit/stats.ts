/**
 * Stats of the creator's LiveKit publication (one upload, simulcast layers)
 * and mapping of LiveKit's connection quality to the app's levels.
 *
 * Pure functions (reports are anything with forEach) for unit tests.
 */
import type { ConnectionLevel } from '../webrtc/bitrate-controller'
import type { ViewerQualityLevel } from '../webrtc/connection-quality'
import type { StatsReportLike } from '../webrtc/stats'

type StatsEntry = Record<string, any>

const num = (value: unknown): number | undefined =>
  typeof value === 'number' && Number.isFinite(value) ? value : undefined

export interface PublisherLayer {
  /** Simulcast rid: q (low), h (medium), f (full) */
  rid: string
  width?: number
  height?: number
  framesPerSecond?: number
  kbps?: number
  /** False when no viewer currently needs this layer (dynacast paused it) */
  active: boolean
}

export interface PublisherSample {
  /** Everything sent to the SFU (all layers + audio, kbit/s) */
  uploadKbps?: number
  layers: PublisherLayer[]
  /** qualityLimitationReason of the full layer (bandwidth / cpu) */
  limitation?: string
  rttMs?: number
  availableOutgoingKbps?: number
}

export interface PublisherSnapshot {
  timestamp: number
  bytesSent: number
  layerBytes: Record<string, number>
}

const RID_ORDER: Record<string, number> = { q: 0, h: 1, f: 2 }

/**
 * Read the outbound stats of the published camera + microphone senders.
 * A layer counts as active while its frame counter moves (dynacast pauses
 * the layers nobody watches).
 */
export function readPublisherStats(
  reports: StatsReportLike[],
  prev?: PublisherSnapshot,
  now: number = Date.now(),
  prevFrames?: Record<string, number>,
): { sample: PublisherSample; snapshot: PublisherSnapshot; frames: Record<string, number> } {
  const entries: StatsEntry[] = []
  reports.forEach((report) => report.forEach((entry) => entries.push(entry)))

  let bytesSent = 0
  const layerBytes: Record<string, number> = {}
  const frames: Record<string, number> = {}
  const layers: PublisherLayer[] = []
  const sample: PublisherSample = { layers }
  const seconds = prev && now > prev.timestamp ? (now - prev.timestamp) / 1000 : undefined

  const seen = new Set<string>()
  for (const entry of entries) {
    if (entry.type === 'outbound-rtp') {
      // The same stats object can appear in both senders' reports
      if (seen.has(entry.id)) continue
      seen.add(entry.id)
      const bytes = num(entry.bytesSent) ?? 0
      bytesSent += bytes
      if (entry.kind !== 'video') continue
      const rid: string = entry.rid || 'f'
      layerBytes[rid] = bytes
      const framesEncoded = num(entry.framesEncoded) ?? num(entry.framesSent) ?? 0
      frames[rid] = framesEncoded
      const previousBytes = prev?.layerBytes[rid]
      const kbps =
        seconds !== undefined && previousBytes !== undefined
          ? Math.max(0, ((bytes - previousBytes) * 8) / 1000 / seconds)
          : undefined
      const active =
        entry.active === false
          ? false
          : prevFrames && prevFrames[rid] !== undefined
            ? framesEncoded > prevFrames[rid]
            : true
      layers.push({
        rid,
        width: num(entry.frameWidth),
        height: num(entry.frameHeight),
        framesPerSecond: num(entry.framesPerSecond),
        kbps,
        active,
      })
      if (rid === 'f' && entry.qualityLimitationReason && entry.qualityLimitationReason !== 'none') {
        sample.limitation = entry.qualityLimitationReason
      }
    } else if (entry.type === 'candidate-pair' && (entry.nominated || entry.selected) && entry.state === 'succeeded') {
      const rtt = num(entry.currentRoundTripTime)
      if (rtt !== undefined) sample.rttMs = rtt * 1000
      const available = num(entry.availableOutgoingBitrate)
      if (available !== undefined) sample.availableOutgoingKbps = available / 1000
    }
  }

  layers.sort((a, b) => (RID_ORDER[a.rid] ?? 3) - (RID_ORDER[b.rid] ?? 3))
  if (seconds !== undefined && prev) {
    sample.uploadKbps = Math.max(0, ((bytesSent - prev.bytesSent) * 8) / 1000 / seconds)
  }

  return { sample, snapshot: { timestamp: now, bytesSent, layerBytes }, frames }
}

/** LiveKit's ConnectionQuality values ('excellent' | 'good' | 'poor' | 'lost' | 'unknown') */
export type LiveKitConnectionQuality = string

/** Creator side ("Santé du live") */
export function publisherConnectionLevel(quality: LiveKitConnectionQuality): ConnectionLevel | null {
  switch (quality) {
    case 'excellent':
      return 'good'
    case 'good':
      return 'fair'
    case 'poor':
    case 'lost':
      return 'poor'
    default:
      return null
  }
}

const VIEWER_LEVEL_ORDER: ViewerQualityLevel[] = ['excellent', 'good', 'poor']

/**
 * Viewer side: the worse of LiveKit's own estimate and the level computed
 * from the inbound video stats
 */
export function viewerConnectionLevel(
  quality: LiveKitConnectionQuality,
  fromStats?: ViewerQualityLevel,
): ViewerQualityLevel | undefined {
  const fromLiveKit: ViewerQualityLevel | undefined =
    quality === 'excellent' ? 'excellent' : quality === 'good' ? 'good' : quality === 'poor' || quality === 'lost' ? 'poor' : undefined
  if (!fromLiveKit) return fromStats
  if (!fromStats) return fromLiveKit
  return VIEWER_LEVEL_ORDER[Math.max(VIEWER_LEVEL_ORDER.indexOf(fromLiveKit), VIEWER_LEVEL_ORDER.indexOf(fromStats))]
}
