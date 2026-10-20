/**
 * Viewer-side connection quality, from the inbound video stats
 */
import type { ReceiverSample } from './stats'

export type ViewerQualityLevel = 'excellent' | 'good' | 'poor'

export const VIEWER_QUALITY_LABELS: Record<ViewerQualityLevel, string> = {
  excellent: 'Excellente',
  good: 'Bonne',
  poor: 'Faible',
}

export interface ViewerQuality {
  level: ViewerQualityLevel
  label: string
  sample: ReceiverSample
}

/**
 * Packet loss and frame rate drive the level; the resolution only matters
 * when it is very low (the data saver mode lowers it on purpose).
 */
export function classifyViewerQuality(sample: ReceiverSample): ViewerQualityLevel {
  const loss = sample.lossRate ?? 0
  const fps = sample.framesPerSecond
  const rtt = sample.rttMs ?? 0
  const height = sample.height

  if (loss > 0.05 || (fps !== undefined && fps < 12) || rtt > 600 || (height !== undefined && height < 180)) {
    return 'poor'
  }
  if (loss > 0.01 || (fps !== undefined && fps < 24) || rtt > 250) {
    return 'good'
  }
  return 'excellent'
}

const percent = (value: number) =>
  `${(value * 100).toLocaleString('fr-FR', { maximumFractionDigits: value < 0.1 ? 1 : 0 })} %`

/** "1280×720 · 30 i/s · perte 0,4 % · 120 ms" */
export function describeReceiverSample(sample: ReceiverSample): string {
  const parts: string[] = []
  if (sample.width && sample.height) parts.push(`${sample.width}×${sample.height}`)
  if (sample.framesPerSecond !== undefined) parts.push(`${Math.round(sample.framesPerSecond)} i/s`)
  if (sample.lossRate !== undefined) parts.push(`perte ${percent(sample.lossRate)}`)
  if (sample.rttMs !== undefined) parts.push(`${Math.round(sample.rttMs)} ms`)
  if (sample.bitrateKbps !== undefined) parts.push(formatKbps(sample.bitrateKbps))
  return parts.join(' · ')
}

/** 850 -> "850 kbit/s", 2500 -> "2,5 Mbit/s" */
export function formatKbps(kbps: number): string {
  if (kbps >= 1000) {
    return `${(kbps / 1000).toLocaleString('fr-FR', { maximumFractionDigits: 1 })} Mbit/s`
  }
  return `${Math.round(kbps).toLocaleString('fr-FR')} kbit/s`
}
