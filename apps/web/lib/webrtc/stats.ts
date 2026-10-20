/**
 * Parsing of RTCPeerConnection.getStats() reports into small samples.
 *
 * Counters in the reports are cumulative, so each reader takes the snapshot
 * returned by the previous call and computes rates over the interval.
 * Reports are passed as anything with forEach (RTCStatsReport or a Map in tests).
 */
import type { PeerNetworkSample } from './bitrate-controller'

type StatsEntry = Record<string, any>
export interface StatsReportLike {
  forEach(callback: (value: StatsEntry) => void): void
}

const num = (value: unknown): number | undefined =>
  typeof value === 'number' && Number.isFinite(value) ? value : undefined

function selectedCandidatePair(entries: StatsEntry[]): StatsEntry | undefined {
  const byId = new Map(entries.map((entry) => [entry.id, entry]))
  for (const entry of entries) {
    if (entry.type === 'transport' && entry.selectedCandidatePairId) {
      const pair = byId.get(entry.selectedCandidatePairId)
      if (pair) return pair
    }
  }
  return (
    entries.find((e) => e.type === 'candidate-pair' && e.state === 'succeeded' && (e.nominated || e.selected)) ??
    entries.find((e) => e.type === 'candidate-pair' && e.state === 'succeeded')
  )
}

const toEntries = (report: StatsReportLike) => {
  const entries: StatsEntry[] = []
  report.forEach((entry) => entries.push(entry))
  return entries
}

// ---- Sender side (creator) ---------------------------------------------------

export interface SenderSnapshot {
  timestamp: number
  bytesSent: number
  videoPacketsSent: number
  videoPacketsLost: number
}

export interface SenderSample extends PeerNetworkSample {
  frameWidth?: number
  frameHeight?: number
  framesPerSecond?: number
}

export function readSenderStats(
  report: StatsReportLike,
  prev?: SenderSnapshot,
  now: number = Date.now(),
): { sample: SenderSample; snapshot: SenderSnapshot } {
  const entries = toEntries(report)
  let bytesSent = 0
  let videoPacketsSent = 0
  let videoPacketsLost = 0
  let fractionLost: number | undefined
  let remoteRtt: number | undefined
  const sample: SenderSample = {}

  for (const entry of entries) {
    if (entry.type === 'outbound-rtp') {
      bytesSent += num(entry.bytesSent) ?? 0
      if (entry.kind === 'video') {
        videoPacketsSent += num(entry.packetsSent) ?? 0
        sample.qualityLimitationReason = entry.qualityLimitationReason ?? sample.qualityLimitationReason
        sample.frameWidth = num(entry.frameWidth) ?? sample.frameWidth
        sample.frameHeight = num(entry.frameHeight) ?? sample.frameHeight
        sample.framesPerSecond = num(entry.framesPerSecond) ?? sample.framesPerSecond
      }
    } else if (entry.type === 'remote-inbound-rtp' && entry.kind === 'video') {
      videoPacketsLost += Math.max(0, num(entry.packetsLost) ?? 0)
      fractionLost = num(entry.fractionLost) ?? fractionLost
      const rtt = num(entry.roundTripTime)
      if (rtt !== undefined) remoteRtt = rtt * 1000
    }
  }

  const pair = selectedCandidatePair(entries)
  const available = num(pair?.availableOutgoingBitrate)
  if (available !== undefined) sample.availableOutgoingKbps = available / 1000
  const pairRtt = num(pair?.currentRoundTripTime)
  sample.rttMs = remoteRtt ?? (pairRtt !== undefined ? pairRtt * 1000 : undefined)

  const snapshot: SenderSnapshot = { timestamp: now, bytesSent, videoPacketsSent, videoPacketsLost }
  if (prev && now > prev.timestamp) {
    const seconds = (now - prev.timestamp) / 1000
    sample.sendKbps = Math.max(0, ((bytesSent - prev.bytesSent) * 8) / 1000 / seconds)
    const sent = videoPacketsSent - prev.videoPacketsSent
    const lost = videoPacketsLost - prev.videoPacketsLost
    if (sent > 0 && lost >= 0) sample.lossRate = Math.min(1, lost / (sent + lost))
  }
  if (sample.lossRate === undefined && fractionLost !== undefined) sample.lossRate = fractionLost

  return { sample, snapshot }
}

// ---- Receiver side (viewer) ---------------------------------------------------

export interface ReceiverSnapshot {
  timestamp: number
  bytesReceived: number
  packetsReceived: number
  packetsLost: number
}

export interface ReceiverSample {
  width?: number
  height?: number
  framesPerSecond?: number
  /** Fraction of video packets lost since the previous sample, 0..1 */
  lossRate?: number
  rttMs?: number
  bitrateKbps?: number
  jitterMs?: number
}

export function readReceiverStats(
  report: StatsReportLike,
  prev?: ReceiverSnapshot,
  now: number = Date.now(),
): { sample: ReceiverSample; snapshot: ReceiverSnapshot } {
  const entries = toEntries(report)
  const sample: ReceiverSample = {}
  let bytesReceived = 0
  let packetsReceived = 0
  let packetsLost = 0

  for (const entry of entries) {
    if (entry.type !== 'inbound-rtp') continue
    bytesReceived += num(entry.bytesReceived) ?? 0
    if (entry.kind === 'video') {
      packetsReceived += num(entry.packetsReceived) ?? 0
      packetsLost += Math.max(0, num(entry.packetsLost) ?? 0)
      sample.width = num(entry.frameWidth) ?? sample.width
      sample.height = num(entry.frameHeight) ?? sample.height
      sample.framesPerSecond = num(entry.framesPerSecond) ?? sample.framesPerSecond
      const jitter = num(entry.jitter)
      if (jitter !== undefined) sample.jitterMs = jitter * 1000
    }
  }

  const pairRtt = num(selectedCandidatePair(entries)?.currentRoundTripTime)
  if (pairRtt !== undefined) sample.rttMs = pairRtt * 1000

  const snapshot: ReceiverSnapshot = { timestamp: now, bytesReceived, packetsReceived, packetsLost }
  if (prev && now > prev.timestamp) {
    const seconds = (now - prev.timestamp) / 1000
    sample.bitrateKbps = Math.max(0, ((bytesReceived - prev.bytesReceived) * 8) / 1000 / seconds)
    const received = packetsReceived - prev.packetsReceived
    const lost = packetsLost - prev.packetsLost
    if (received + lost > 0 && lost >= 0) sample.lossRate = lost / (received + lost)
  }

  return { sample, snapshot }
}
