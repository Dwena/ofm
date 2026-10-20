/**
 * Video quality presets of a live broadcast (creator side).
 *
 * Every viewer gets its own WebRTC connection (mesh), so the creator's upload
 * is shared by all viewers: the bitrate of a preset is a per-viewer ceiling,
 * lowered by the bitrate controller when the upload or a viewer's network
 * cannot keep up.
 */

export type QualityPresetId = '480p' | '720p' | '1080p'

export interface QualityPreset {
  id: QualityPresetId
  label: string
  description: string
  width: number
  height: number
  frameRate: number
  /** Per-viewer video ceiling (kbit/s) */
  maxBitrateKbps: number
}

export const QUALITY_PRESETS: Record<QualityPresetId, QualityPreset> = {
  '480p': {
    id: '480p',
    label: '480p',
    description: 'Économie · ≈ 1 Mbit/s par spectateur',
    width: 854,
    height: 480,
    frameRate: 30,
    maxBitrateKbps: 1000,
  },
  '720p': {
    id: '720p',
    label: '720p HD',
    description: 'Recommandé · ≈ 2,5 Mbit/s par spectateur',
    width: 1280,
    height: 720,
    frameRate: 30,
    maxBitrateKbps: 2500,
  },
  '1080p': {
    id: '1080p',
    label: '1080p Full HD',
    description: 'Connexion fibre conseillée · ≈ 4,5 Mbit/s par spectateur',
    width: 1920,
    height: 1080,
    frameRate: 30,
    maxBitrateKbps: 4500,
  },
}

export const QUALITY_PRESET_IDS = Object.keys(QUALITY_PRESETS) as QualityPresetId[]
export const DEFAULT_QUALITY_PRESET: QualityPresetId = '720p'

/** Audio ceiling per viewer (Opus, voice + music) */
export const AUDIO_MAX_BITRATE_KBPS = 64

export function isQualityPresetId(value: unknown): value is QualityPresetId {
  return typeof value === 'string' && value in QUALITY_PRESETS
}

/** getUserMedia video constraints of a preset (ideals only: never overconstrained) */
export function videoConstraints(preset: QualityPreset, deviceId?: string | null): MediaTrackConstraints {
  return {
    ...(deviceId ? { deviceId: { exact: deviceId } } : {}),
    width: { ideal: preset.width },
    height: { ideal: preset.height },
    frameRate: { ideal: preset.frameRate, max: preset.frameRate },
  }
}

/** Constraints applied to a live video track when the preset changes */
export function presetTrackConstraints(preset: QualityPreset): MediaTrackConstraints {
  return {
    width: { ideal: preset.width },
    height: { ideal: preset.height },
    frameRate: { ideal: preset.frameRate, max: preset.frameRate },
  }
}

export function audioConstraints(deviceId?: string | null): MediaTrackConstraints {
  return {
    ...(deviceId ? { deviceId: { exact: deviceId } } : {}),
    echoCancellation: true,
    noiseSuppression: true,
    autoGainControl: true,
    sampleRate: { ideal: 48000 },
    channelCount: { ideal: 1 },
  }
}
