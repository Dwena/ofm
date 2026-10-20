/**
 * LiveKit publishing plans and viewer quality choices.
 *
 * With LiveKit the creator uploads its video once, as three simulcast layers
 * (low / medium / full resolution); the SFU forwards to each viewer the layer
 * that fits its connection and player size. The plans follow the creator's
 * quality presets (480p / 720p / 1080p).
 *
 * Pure data and functions (no livekit-client import) so they can be unit tested.
 */
import {
  AUDIO_MAX_BITRATE_KBPS,
  QUALITY_PRESETS,
  type QualityPresetId,
} from '../webrtc/quality-presets'

export interface LiveKitLayer {
  width: number
  height: number
  maxBitrateKbps: number
  maxFramerate: number
}

export interface LiveKitPublishPlan {
  /** Full resolution layer (rid "f") */
  main: LiveKitLayer
  /** Lower simulcast layers, lowest first (rids "q" then "h") */
  simulcast: [LiveKitLayer, LiveKitLayer]
}

const LOW_LAYER: LiveKitLayer = { width: 320, height: 180, maxBitrateKbps: 160, maxFramerate: 30 }
const H360_LAYER: LiveKitLayer = { width: 640, height: 360, maxBitrateKbps: 450, maxFramerate: 30 }
const H540_LAYER: LiveKitLayer = { width: 960, height: 540, maxBitrateKbps: 1200, maxFramerate: 30 }

const mainLayer = (id: QualityPresetId): LiveKitLayer => {
  const preset = QUALITY_PRESETS[id]
  return {
    width: preset.width,
    height: preset.height,
    maxBitrateKbps: preset.maxBitrateKbps,
    maxFramerate: preset.frameRate,
  }
}

export const LIVEKIT_PUBLISH_PLANS: Record<QualityPresetId, LiveKitPublishPlan> = {
  '480p': { main: mainLayer('480p'), simulcast: [LOW_LAYER, H360_LAYER] },
  '720p': { main: mainLayer('720p'), simulcast: [LOW_LAYER, H360_LAYER] },
  '1080p': { main: mainLayer('1080p'), simulcast: [LOW_LAYER, H540_LAYER] },
}

/** Opus ceiling of the creator's microphone (bit/s) */
export const LIVEKIT_AUDIO_MAX_BITRATE = AUDIO_MAX_BITRATE_KBPS * 1000

/** Simulcast rid of each layer, lowest first (LiveKit's convention) */
export const LAYER_RIDS = ['q', 'h', 'f'] as const
export type LayerRid = (typeof LAYER_RIDS)[number]

export function planLayers(plan: LiveKitPublishPlan): Record<LayerRid, LiveKitLayer> {
  return { q: plan.simulcast[0], h: plan.simulcast[1], f: plan.main }
}

/**
 * Encoding parameters of each simulcast layer for a capture of
 * `sourceWidth` × `sourceHeight` (the short side drives the downscale, so a
 * portrait camera gets the same layers). Used when the creator switches
 * preset while live: the encodings are updated in place, without
 * republishing (viewers keep playing).
 */
export function layerEncodings(
  plan: LiveKitPublishPlan,
  sourceWidth: number,
  sourceHeight: number,
): Record<LayerRid, { maxBitrate: number; maxFramerate: number; scaleResolutionDownBy: number }> {
  const sourceShort = Math.min(sourceWidth, sourceHeight)
  const layers = planLayers(plan)
  const result = {} as Record<LayerRid, { maxBitrate: number; maxFramerate: number; scaleResolutionDownBy: number }>
  for (const rid of LAYER_RIDS) {
    const layer = layers[rid]
    const layerShort = Math.min(layer.width, layer.height)
    const scale = sourceShort > 0 ? Math.max(1, sourceShort / layerShort) : 1
    result[rid] = {
      maxBitrate: layer.maxBitrateKbps * 1000,
      maxFramerate: layer.maxFramerate,
      scaleResolutionDownBy: Math.round(scale * 1000) / 1000,
    }
  }
  return result
}

// ---- Viewer side --------------------------------------------------------------

export type LiveKitViewerQualityMode = 'auto' | 'high' | 'medium' | 'low' | 'data-saver'

export const LIVEKIT_VIEWER_QUALITY_MODES: LiveKitViewerQualityMode[] = ['auto', 'high', 'medium', 'low', 'data-saver']

export const LIVEKIT_VIEWER_QUALITY_OPTIONS: { value: LiveKitViewerQualityMode; label: string; description: string }[] = [
  { value: 'auto', label: 'Auto', description: "S'adapte à votre connexion et à la taille du lecteur" },
  { value: 'high', label: 'Haute', description: 'Pleine résolution (selon la taille du lecteur)' },
  { value: 'medium', label: 'Moyenne', description: 'Environ 360p' },
  { value: 'low', label: 'Basse', description: 'Environ 180p' },
  { value: 'data-saver', label: 'Économie de données', description: '180p, 15 i/s, environ 0,1 Mbit/s' },
]

export function isLiveKitViewerQualityMode(value: unknown): value is LiveKitViewerQualityMode {
  return typeof value === 'string' && (LIVEKIT_VIEWER_QUALITY_MODES as string[]).includes(value)
}

export interface ViewerQualityRequest {
  /** Highest simulcast layer the viewer accepts */
  layer: 'high' | 'medium' | 'low'
  /** Frame rate cap (temporal layers), the full rate otherwise */
  fps: number
}

const FULL_FPS = 30

/**
 * What a viewer's quality choice asks the SFU for. "Auto" asks for the best
 * layer: LiveKit's adaptive stream still lowers it to the player size and the
 * SFU to the viewer's bandwidth.
 */
export function viewerQualityRequest(mode: LiveKitViewerQualityMode): ViewerQualityRequest {
  switch (mode) {
    case 'medium':
      return { layer: 'medium', fps: FULL_FPS }
    case 'low':
      return { layer: 'low', fps: FULL_FPS }
    case 'data-saver':
      return { layer: 'low', fps: 15 }
    case 'high':
    case 'auto':
    default:
      return { layer: 'high', fps: FULL_FPS }
  }
}

/**
 * Quality choices that make sense for the video being played. A browser
 * broadcast (and an OBS RTMP input, transcoded by the Ingress) has three
 * simulcast layers; an OBS WHIP input is forwarded as is, with a single
 * layer: only "Auto" then (the SFU cannot send a lower resolution).
 * `layerCount` null = not known yet (every choice).
 */
export function viewerQualityOptionsFor(layerCount: number | null) {
  if (layerCount === null || layerCount >= 3) return LIVEKIT_VIEWER_QUALITY_OPTIONS
  if (layerCount === 2) return LIVEKIT_VIEWER_QUALITY_OPTIONS.filter((option) => option.value !== 'medium')
  return LIVEKIT_VIEWER_QUALITY_OPTIONS.filter((option) => option.value === 'auto').map((option) => ({
    ...option,
    description: 'Qualité unique : celle envoyée par le créateur',
  }))
}
