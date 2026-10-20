/**
 * Alert sounds of the OBS alert box, synthesized at runtime with the Web
 * Audio API (no audio file shipped, nothing copyrighted).
 *
 * OBS browser sources may autoplay audio ("Contrôler l'audio via OBS" routes it
 * to the OBS mixer). Regular browsers block audio until the page got a click:
 * playAlertSound then resolves to false.
 */
import type { AlertSound } from './overlay-widgets'

type WindowWithWebkitAudio = Window & { webkitAudioContext?: typeof AudioContext }

let context: AudioContext | null = null

/** resume() may stay pending until a click in regular browsers: never wait for it long */
const resumeQuickly = (ctx: AudioContext) =>
  Promise.race([ctx.resume().catch(() => undefined), new Promise((resolve) => setTimeout(resolve, 300))])

function getContext(): AudioContext | null {
  if (typeof window === 'undefined') return null
  if (!context) {
    const Ctor = window.AudioContext ?? (window as WindowWithWebkitAudio).webkitAudioContext
    if (!Ctor) return null
    try {
      context = new Ctor()
    } catch {
      return null
    }
  }
  return context
}

/** True when audio can play right now (false until a click in regular browsers) */
export function isAudioUnlocked() {
  return getContext()?.state === 'running'
}

/** Resume the audio context from a user gesture (preview "Activer le son") */
export async function unlockAudio() {
  const ctx = getContext()
  if (!ctx) return false
  await resumeQuickly(ctx)
  return ctx.state === 'running'
}

interface ToneOptions {
  type: OscillatorType
  frequency: number
  /** Frequency reached at the end (glide) */
  endFrequency?: number
  /** Seconds from now */
  start: number
  duration: number
  gain: number
}

function tone(ctx: AudioContext, destination: AudioNode, options: ToneOptions) {
  const oscillator = ctx.createOscillator()
  const envelope = ctx.createGain()
  const at = ctx.currentTime + options.start
  oscillator.type = options.type
  oscillator.frequency.setValueAtTime(options.frequency, at)
  if (options.endFrequency) {
    oscillator.frequency.exponentialRampToValueAtTime(options.endFrequency, at + options.duration)
  }
  // Short attack, exponential release: no click
  envelope.gain.setValueAtTime(0.0001, at)
  envelope.gain.exponentialRampToValueAtTime(options.gain, at + 0.01)
  envelope.gain.exponentialRampToValueAtTime(0.0001, at + options.duration)
  oscillator.connect(envelope).connect(destination)
  oscillator.start(at)
  oscillator.stop(at + options.duration + 0.05)
}

const NOTES = { C5: 523.25, E5: 659.25, G5: 783.99, B5: 987.77, C6: 1046.5, E6: 1318.51, G6: 1567.98, B6: 1975.53 }

const SOUNDS: Record<AlertSound, (ctx: AudioContext, out: AudioNode) => void> = {
  chime: (ctx, out) => {
    tone(ctx, out, { type: 'sine', frequency: NOTES.E6, start: 0, duration: 0.9, gain: 0.5 })
    tone(ctx, out, { type: 'sine', frequency: NOTES.B6, start: 0.12, duration: 1.1, gain: 0.35 })
    tone(ctx, out, { type: 'triangle', frequency: NOTES.E5, start: 0, duration: 0.6, gain: 0.15 })
  },
  coins: (ctx, out) => {
    for (const [index, start] of [0, 0.11, 0.3, 0.41].entries()) {
      tone(ctx, out, { type: 'square', frequency: index % 2 ? NOTES.E6 : NOTES.B5, start, duration: 0.12, gain: 0.12 })
    }
  },
  fanfare: (ctx, out) => {
    const filter = ctx.createBiquadFilter()
    filter.type = 'lowpass'
    filter.frequency.value = 2400
    filter.connect(out)
    ;[NOTES.C5, NOTES.E5, NOTES.G5].forEach((frequency, index) =>
      tone(ctx, filter, { type: 'sawtooth', frequency, start: index * 0.12, duration: 0.18, gain: 0.18 }),
    )
    tone(ctx, filter, { type: 'sawtooth', frequency: NOTES.C6, start: 0.36, duration: 0.8, gain: 0.22 })
    tone(ctx, filter, { type: 'sawtooth', frequency: NOTES.G5, start: 0.36, duration: 0.8, gain: 0.12 })
  },
  pop: (ctx, out) => {
    tone(ctx, out, { type: 'sine', frequency: 900, endFrequency: 180, start: 0, duration: 0.18, gain: 0.6 })
    tone(ctx, out, { type: 'sine', frequency: 1400, endFrequency: 600, start: 0.16, duration: 0.12, gain: 0.25 })
  },
}

/**
 * Play an alert sound at `volume` (0-1). Resolves to false when the browser
 * blocked audio (no click yet) or Web Audio is unavailable.
 */
export async function playAlertSound(sound: AlertSound, volume: number): Promise<boolean> {
  const ctx = getContext()
  if (!ctx || volume <= 0) return false
  if (ctx.state !== 'running') await resumeQuickly(ctx)
  if (ctx.state !== 'running') return false
  const master = ctx.createGain()
  master.gain.value = Math.min(1, Math.max(0, volume))
  master.connect(ctx.destination)
  ;(SOUNDS[sound] ?? SOUNDS.chime)(ctx, master)
  return true
}
