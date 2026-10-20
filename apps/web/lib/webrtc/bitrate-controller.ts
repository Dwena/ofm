/**
 * Adaptive bitrate decisions for the creator's per-viewer WebRTC senders.
 *
 * Pure functions only (no browser API) so they can be unit tested: the
 * broadcast quality manager feeds them one network sample per viewer every
 * couple of seconds and applies the result with RTCRtpSender.setParameters.
 *
 * Strategy (AIMD-like):
 * - a viewer's ceiling ("cap") is min(preset bitrate, upload budget / number
 *   of viewers), and 500 kbit/s in data saver mode;
 * - on packet loss, high RTT or a bandwidth-limited encoder the target drops
 *   quickly (x0.8, x0.6 when severe); when it stays low the resolution is
 *   scaled down (1 -> 1.5 -> 2) as a last resort;
 * - when the connection is healthy for a few samples the target climbs back
 *   slowly (+10 % per sample) and the resolution is restored.
 */

export type ViewerQualityMode = 'auto' | 'low'
export type ConnectionLevel = 'good' | 'fair' | 'poor'

/** One getStats() reading of a peer, already turned into rates */
export interface PeerNetworkSample {
  /** Fraction of packets lost since the previous sample, 0..1 */
  lossRate?: number
  /** Round trip time in ms */
  rttMs?: number
  /** Bandwidth estimate of the selected candidate pair (kbit/s) */
  availableOutgoingKbps?: number
  /** RTCOutboundRtpStreamStats.qualityLimitationReason of the video sender */
  qualityLimitationReason?: string
  /** Bitrate actually sent to this peer (audio + video, kbit/s) */
  sendKbps?: number
}

export interface PeerQualityState {
  /** Video maxBitrate currently wanted for this peer (kbit/s) */
  targetKbps: number
  /** RTCRtpEncodingParameters.scaleResolutionDownBy */
  scaleDownBy: number
  healthyTicks: number
  congestedTicks: number
  /** Number of samples seen (bandwidth hints are ignored while warming up) */
  ageTicks: number
  level: ConnectionLevel
}

export const MIN_VIDEO_KBPS = 150
export const LOW_MODE_MAX_KBPS = 500
export const LOW_MODE_SCALE = 2
export const SCALE_STEPS = [1, 1.5, 2] as const

/** Upload budget before any measurement, and its bounds (kbit/s) */
export const INITIAL_UPLOAD_BUDGET_KBPS = 8000
export const MIN_UPLOAD_BUDGET_KBPS = 500
export const MAX_UPLOAD_BUDGET_KBPS = 50000

/** Loss / RTT thresholds */
export const LOSS_CONGESTED = 0.05
export const LOSS_SEVERE = 0.1
export const LOSS_HEALTHY = 0.02
export const RTT_CONGESTED_MS = 400
export const RTT_SEVERE_MS = 800
export const RTT_HEALTHY_MS = 250

/** Samples during which a bandwidth-limited encoder is considered normal (ramp-up) */
export const WARMUP_TICKS = 4
/** Healthy samples before raising the bitrate again */
export const RECOVERY_TICKS = 3

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value))

/**
 * Ceiling of one viewer's video bitrate (kbit/s)
 */
export function computePeerCap(options: {
  presetKbps: number
  uploadBudgetKbps: number
  viewerCount: number
  mode?: ViewerQualityMode
}): number {
  const viewers = Math.max(1, Math.floor(options.viewerCount))
  const share = Math.max(MIN_VIDEO_KBPS, options.uploadBudgetKbps / viewers)
  let cap = Math.min(options.presetKbps, share)
  if (options.mode === 'low') cap = Math.min(cap, LOW_MODE_MAX_KBPS)
  return Math.round(Math.max(MIN_VIDEO_KBPS, cap))
}

export function initialPeerState(capKbps: number, mode: ViewerQualityMode = 'auto'): PeerQualityState {
  return {
    targetKbps: capKbps,
    scaleDownBy: mode === 'low' ? LOW_MODE_SCALE : 1,
    healthyTicks: 0,
    congestedTicks: 0,
    ageTicks: 0,
    level: 'good',
  }
}

const isSevere = (s: PeerNetworkSample) =>
  (s.lossRate ?? 0) > LOSS_SEVERE || (s.rttMs ?? 0) > RTT_SEVERE_MS

const isLossyOrSlow = (s: PeerNetworkSample) =>
  (s.lossRate ?? 0) > LOSS_CONGESTED || (s.rttMs ?? 0) > RTT_CONGESTED_MS

const isHealthy = (s: PeerNetworkSample) =>
  (s.lossRate ?? 0) < LOSS_HEALTHY && (s.rttMs ?? 0) < RTT_HEALTHY_MS && s.qualityLimitationReason !== 'bandwidth'

/**
 * Connection level shown in the creator's health panel
 */
export function classifyNetwork(sample: PeerNetworkSample): ConnectionLevel {
  if (isLossyOrSlow(sample)) return 'poor'
  if (isHealthy(sample)) return 'good'
  return 'fair'
}

const nextScale = (scale: number, direction: 1 | -1, minScale: number) => {
  const index = SCALE_STEPS.findIndex((step) => step >= scale)
  const current = index === -1 ? SCALE_STEPS.length - 1 : index
  const next = SCALE_STEPS[clamp(current + direction, 0, SCALE_STEPS.length - 1)]
  return Math.max(minScale, next)
}

/**
 * Decide the next target of one peer from its latest sample.
 * `capKbps` is the current ceiling (see computePeerCap).
 */
export function nextPeerState(
  prev: PeerQualityState,
  sample: PeerNetworkSample,
  capKbps: number,
  mode: ViewerQualityMode = 'auto',
): PeerQualityState {
  const minScale = mode === 'low' ? LOW_MODE_SCALE : 1
  const floor = Math.min(MIN_VIDEO_KBPS, capKbps)
  const ageTicks = prev.ageTicks + 1
  const warmingUp = ageTicks <= WARMUP_TICKS

  const bandwidthLimited =
    !warmingUp &&
    sample.qualityLimitationReason === 'bandwidth' &&
    sample.availableOutgoingKbps !== undefined &&
    sample.availableOutgoingKbps < prev.targetKbps * 0.9

  let { targetKbps, scaleDownBy, healthyTicks, congestedTicks } = prev
  scaleDownBy = Math.max(minScale, scaleDownBy)

  if (isLossyOrSlow(sample) || bandwidthLimited) {
    const factor = isSevere(sample) ? 0.6 : 0.8
    let next = targetKbps * factor
    if (bandwidthLimited && sample.availableOutgoingKbps !== undefined) {
      // Follow the bandwidth estimate rather than cutting blindly
      next = Math.max(next, sample.availableOutgoingKbps * 0.9)
      next = Math.min(next, targetKbps * 0.9)
    }
    targetKbps = next
    healthyTicks = 0
    congestedTicks += 1

    // Last resort: fewer pixels per frame keeps the frame rate smooth
    const lowBitrate = targetKbps <= Math.max(capKbps * 0.35, MIN_VIDEO_KBPS * 1.5)
    if (lowBitrate && congestedTicks >= 2 && scaleDownBy < SCALE_STEPS[SCALE_STEPS.length - 1]) {
      scaleDownBy = nextScale(scaleDownBy, 1, minScale)
      congestedTicks = 0
    }
  } else if (isHealthy(sample)) {
    healthyTicks += 1
    congestedTicks = 0
    if (healthyTicks >= RECOVERY_TICKS) {
      targetKbps = targetKbps * 1.1 + 50
      if (scaleDownBy > minScale && targetKbps >= capKbps * 0.6 && healthyTicks >= RECOVERY_TICKS + 2) {
        scaleDownBy = nextScale(scaleDownBy, -1, minScale)
        healthyTicks = RECOVERY_TICKS
      }
    }
  } else {
    // In between: hold
    healthyTicks = 0
    congestedTicks = 0
  }

  return {
    targetKbps: Math.round(clamp(targetKbps, floor, capKbps)),
    scaleDownBy,
    healthyTicks,
    congestedTicks,
    ageTicks,
    level: classifyNetwork(sample),
  }
}

/**
 * Refine the creator's total upload budget from the samples of every peer.
 *
 * The sum of the candidate pairs' availableOutgoingBitrate approximates the
 * uplink capacity. When several peers suffer at the same time the uplink is
 * likely the bottleneck, so the budget moves down toward what is actually
 * achievable; otherwise it grows slowly toward the measured estimate.
 */
export function estimateUploadBudget(prevBudgetKbps: number, samples: PeerNetworkSample[]): number {
  if (samples.length === 0) return prevBudgetKbps

  const totalSent = samples.reduce((sum, s) => sum + (s.sendKbps ?? 0), 0)
  const withEstimate = samples.filter((s) => s.availableOutgoingKbps !== undefined)
  const totalAvailable = withEstimate.reduce((sum, s) => sum + (s.availableOutgoingKbps ?? 0), 0)
  const suffering = samples.filter((s) => isLossyOrSlow(s) || s.qualityLimitationReason === 'bandwidth').length

  let next = prevBudgetKbps
  // A single struggling viewer is its own network's problem (handled per peer)
  if (samples.length >= 2 && suffering >= Math.ceil(samples.length / 2)) {
    const measured = Math.max(totalSent, withEstimate.length > 0 ? totalAvailable : 0)
    if (measured > 0) {
      next = 0.7 * prevBudgetKbps + 0.3 * Math.min(prevBudgetKbps, measured * 0.9)
    } else {
      next = prevBudgetKbps * 0.85
    }
  } else if (suffering === 0) {
    const measured = withEstimate.length === samples.length ? totalAvailable * 0.9 : 0
    next = Math.max(prevBudgetKbps * 1.02, measured)
  }

  return Math.round(clamp(next, MIN_UPLOAD_BUDGET_KBPS, MAX_UPLOAD_BUDGET_KBPS))
}

/** Worst first: poor < fair < good */
export function compareLevels(a: ConnectionLevel, b: ConnectionLevel): number {
  const rank: Record<ConnectionLevel, number> = { poor: 0, fair: 1, good: 2 }
  return rank[a] - rank[b]
}
