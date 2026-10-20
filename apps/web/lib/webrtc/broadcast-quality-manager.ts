/**
 * Creator-side quality loop: every couple of seconds, read the stats of each
 * viewer's connection, decide its bitrate / resolution with the bitrate
 * controller and apply them with setParameters. Also produces the "santé du
 * live" summary shown to the creator.
 */
import {
  INITIAL_UPLOAD_BUDGET_KBPS,
  compareLevels,
  computePeerCap,
  estimateUploadBudget,
  initialPeerState,
  nextPeerState,
  type ConnectionLevel,
  type PeerNetworkSample,
  type PeerQualityState,
  type ViewerQualityMode,
} from './bitrate-controller'
import { AUDIO_MAX_BITRATE_KBPS, QUALITY_PRESETS, type QualityPresetId } from './quality-presets'
import { applySenderEncoding, type SenderEncoding } from './sender-params'
import { readSenderStats, type SenderSnapshot } from './stats'

export interface BroadcastPeerRef {
  pc: RTCPeerConnection
}

export interface ViewerHealth {
  viewerId: string
  connectionState: RTCPeerConnectionState
  level: ConnectionLevel
  mode: ViewerQualityMode
  lossPct?: number
  rttMs?: number
  sendKbps?: number
  targetKbps: number
  scaleDownBy: number
  limitation?: string
}

export interface BroadcastHealth {
  presetId: QualityPresetId
  totalUploadKbps: number
  connectedPeers: number
  totalPeers: number
  uploadBudgetKbps: number
  perViewerCapKbps: number
  dataSaverViewers: number
  /** Worst connected viewer, when any */
  worst: ViewerHealth | null
  level: ConnectionLevel
  viewers: ViewerHealth[]
  updatedAt: number
}

interface PeerTracking {
  pc: RTCPeerConnection
  state: PeerQualityState
  snapshot?: SenderSnapshot
  sample?: PeerNetworkSample
}

const ACTIVE_STATES: RTCPeerConnectionState[] = ['new', 'connecting', 'connected', 'disconnected']

export class BroadcastQualityManager {
  private presetId: QualityPresetId
  private uploadBudgetKbps = INITIAL_UPLOAD_BUDGET_KBPS
  private modes = new Map<string, ViewerQualityMode>()
  private tracking = new Map<string, PeerTracking>()
  private timer: ReturnType<typeof setInterval> | null = null
  private ticking = false

  constructor(
    private readonly options: {
      getPeers: () => ReadonlyMap<string, BroadcastPeerRef>
      onHealth?: (health: BroadcastHealth) => void
      presetId: QualityPresetId
      intervalMs?: number
    },
  ) {
    this.presetId = options.presetId
  }

  get preset() {
    return QUALITY_PRESETS[this.presetId]
  }

  start() {
    if (this.timer) return
    this.timer = setInterval(() => void this.tick(), this.options.intervalMs ?? 2000)
  }

  stop() {
    if (this.timer) clearInterval(this.timer)
    this.timer = null
    this.tracking.clear()
    this.uploadBudgetKbps = INITIAL_UPLOAD_BUDGET_KBPS
  }

  /** Encodings of the transceivers of a new viewer connection */
  initialEncodings(viewerId: string): { video: SenderEncoding; audio: SenderEncoding } {
    const mode = this.modeOf(viewerId)
    const state = initialPeerState(this.capFor(viewerId, this.activePeerCount() + 1), mode)
    return { video: this.videoEncoding(state), audio: { maxBitrateKbps: AUDIO_MAX_BITRATE_KBPS } }
  }

  setPreset(presetId: QualityPresetId) {
    if (presetId === this.presetId) return
    this.presetId = presetId
    // A deliberate change: start every viewer from the new ceiling
    this.tracking.forEach((entry, viewerId) => {
      entry.state = { ...initialPeerState(this.capFor(viewerId), this.modeOf(viewerId)), ageTicks: entry.state.ageTicks }
    })
    this.applyAll()
  }

  setViewerMode(viewerId: string, mode: ViewerQualityMode) {
    this.modes.set(viewerId, mode)
    const entry = this.tracking.get(viewerId)
    if (entry) {
      entry.state = { ...initialPeerState(this.capFor(viewerId), mode), ageTicks: entry.state.ageTicks }
      void this.applyPeer(viewerId)
    }
  }

  forgetViewer(viewerId: string) {
    this.tracking.delete(viewerId)
    this.modes.delete(viewerId)
  }

  /** Apply the current target of one viewer now (e.g. once its answer is set) */
  applyPeer(viewerId: string): Promise<void> {
    const entry = this.track(viewerId)
    if (!entry) return Promise.resolve()
    entry.state = { ...entry.state, targetKbps: Math.min(entry.state.targetKbps, this.capFor(viewerId)) }
    return this.applyEncoding(entry)
  }

  /** Re-apply every viewer's cap (the number of viewers changed) */
  applyAll() {
    this.options.getPeers().forEach((_peer, viewerId) => void this.applyPeer(viewerId))
  }

  private modeOf(viewerId: string): ViewerQualityMode {
    return this.modes.get(viewerId) ?? 'auto'
  }

  private activePeerCount() {
    let count = 0
    this.options.getPeers().forEach(({ pc }) => {
      if (ACTIVE_STATES.includes(pc.connectionState)) count += 1
    })
    return count
  }

  private capFor(viewerId: string, viewerCount = this.activePeerCount()) {
    return computePeerCap({
      presetKbps: this.preset.maxBitrateKbps,
      uploadBudgetKbps: this.uploadBudgetKbps,
      viewerCount,
      mode: this.modeOf(viewerId),
    })
  }

  /** Tracking entry of a viewer, reset when its connection was replaced */
  private track(viewerId: string): PeerTracking | undefined {
    const peer = this.options.getPeers().get(viewerId)
    if (!peer) {
      this.tracking.delete(viewerId)
      return undefined
    }
    let entry = this.tracking.get(viewerId)
    if (!entry || entry.pc !== peer.pc) {
      entry = { pc: peer.pc, state: initialPeerState(this.capFor(viewerId), this.modeOf(viewerId)) }
      this.tracking.set(viewerId, entry)
    }
    return entry
  }

  private videoEncoding(state: PeerQualityState): SenderEncoding {
    return {
      maxBitrateKbps: state.targetKbps,
      maxFramerate: this.preset.frameRate,
      scaleResolutionDownBy: state.scaleDownBy,
    }
  }

  private async applyEncoding(entry: PeerTracking) {
    if (entry.pc.connectionState === 'closed') return
    const jobs = entry.pc.getSenders().map((sender) => {
      const kind = sender.track?.kind
      if (kind === 'video') return applySenderEncoding(sender, this.videoEncoding(entry.state))
      if (kind === 'audio') return applySenderEncoding(sender, { maxBitrateKbps: AUDIO_MAX_BITRATE_KBPS })
      return Promise.resolve(true)
    })
    await Promise.all(jobs)
  }

  private async tick() {
    if (this.ticking) return
    this.ticking = true
    try {
      const peers = this.options.getPeers()
      // Drop viewers that are gone
      this.tracking.forEach((_entry, viewerId) => {
        if (!peers.has(viewerId)) this.tracking.delete(viewerId)
      })

      const viewerIds = [...peers.keys()]
      const entries = viewerIds
        .map((viewerId) => ({ viewerId, entry: this.track(viewerId) }))
        .filter((item): item is { viewerId: string; entry: PeerTracking } => !!item.entry)

      // 1. Read the stats of every connected viewer
      await Promise.all(
        entries.map(async ({ entry }) => {
          entry.sample = undefined
          if (entry.pc.connectionState !== 'connected') return
          try {
            const report = await entry.pc.getStats()
            const { sample, snapshot } = readSenderStats(report, entry.snapshot)
            entry.snapshot = snapshot
            entry.sample = sample
          } catch {
            // Connection closed meanwhile
          }
        }),
      )

      // 2. Refine the upload budget, then decide each viewer's target
      const samples = entries.map(({ entry }) => entry.sample).filter((s): s is PeerNetworkSample => !!s)
      this.uploadBudgetKbps = estimateUploadBudget(this.uploadBudgetKbps, samples)
      const viewerCount = this.activePeerCount()

      for (const { viewerId, entry } of entries) {
        const cap = this.capFor(viewerId, viewerCount)
        entry.state = entry.sample
          ? nextPeerState(entry.state, entry.sample, cap, this.modeOf(viewerId))
          : { ...entry.state, targetKbps: Math.min(entry.state.targetKbps, cap) }
      }

      // 3. Apply (only changed encodings reach setParameters)
      await Promise.all(entries.map(({ entry }) => this.applyEncoding(entry)))

      this.options.onHealth?.(this.buildHealth(entries, viewerCount))
    } finally {
      this.ticking = false
    }
  }

  private buildHealth(
    entries: { viewerId: string; entry: PeerTracking }[],
    viewerCount: number,
  ): BroadcastHealth {
    const viewers: ViewerHealth[] = entries.map(({ viewerId, entry }) => ({
      viewerId,
      connectionState: entry.pc.connectionState,
      level: entry.pc.connectionState === 'connected' ? entry.state.level : 'poor',
      mode: this.modeOf(viewerId),
      lossPct: entry.sample?.lossRate !== undefined ? entry.sample.lossRate * 100 : undefined,
      rttMs: entry.sample?.rttMs,
      sendKbps: entry.sample?.sendKbps,
      targetKbps: entry.state.targetKbps,
      scaleDownBy: entry.state.scaleDownBy,
      limitation: entry.sample?.qualityLimitationReason,
    }))

    const connected = viewers.filter((v) => v.connectionState === 'connected')
    const worst =
      [...connected].sort(
        (a, b) => compareLevels(a.level, b.level) || (b.lossPct ?? 0) - (a.lossPct ?? 0) || (b.rttMs ?? 0) - (a.rttMs ?? 0),
      )[0] ?? null

    const pending = viewers.length - connected.length
    let level: ConnectionLevel = worst?.level ?? 'good'
    if (pending > 0 && level === 'good') level = 'fair'

    return {
      presetId: this.presetId,
      totalUploadKbps: connected.reduce((sum, v) => sum + (v.sendKbps ?? 0), 0),
      connectedPeers: connected.length,
      totalPeers: viewers.length,
      uploadBudgetKbps: this.uploadBudgetKbps,
      perViewerCapKbps: computePeerCap({
        presetKbps: this.preset.maxBitrateKbps,
        uploadBudgetKbps: this.uploadBudgetKbps,
        viewerCount,
      }),
      dataSaverViewers: viewers.filter((v) => v.mode === 'low').length,
      worst,
      level,
      viewers,
      updatedAt: Date.now(),
    }
  }
}
