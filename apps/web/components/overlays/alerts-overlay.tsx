'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { useOverlay } from '@/hooks/use-overlay'
import { alertFromGoal, alertFromTip, enqueueAlert, type OverlayAlert } from '@/lib/overlay-alerts'
import { hexToRgba } from '@/lib/overlay-widgets'
import { isAudioUnlocked, playAlertSound, unlockAudio } from '@/lib/overlay-sounds'
import { OverlayFrame } from './overlay-frame'

/** Length of the exit animation (ms) */
const EXIT_MS = 400
/** Pause between two alerts (ms) */
const GAP_MS = 250

const KIND_ICONS: Record<OverlayAlert['kind'], string> = {
  tip: '💸',
  'menu-request': '🎁',
  'goal-reached': '',
}

/**
 * Alert box: tips, menu requests and milestones reached, one at a time
 * (queued), with the creator's animation and a synthesized sound
 */
export function AlertsOverlay({ token }: { token: string }) {
  const [queue, setQueue] = useState<OverlayAlert[]>([])
  const [current, setCurrent] = useState<OverlayAlert | null>(null)
  const [leaving, setLeaving] = useState(false)
  const [audioBlocked, setAudioBlocked] = useState(false)
  const settingsRef = useRef<Parameters<typeof alertFromTip>[1] | null>(null)

  const { state, settings, preview } = useOverlay(token, 'ALERTS', {
    onTip: (tip) => {
      if (settingsRef.current) setQueue((items) => enqueueAlert(items, alertFromTip(tip, settingsRef.current!)))
    },
    onGoalReached: (event) => {
      if (settingsRef.current) setQueue((items) => enqueueAlert(items, alertFromGoal(event, settingsRef.current!)))
    },
  })
  settingsRef.current = settings

  // Next alert of the queue once the box is free
  useEffect(() => {
    if (current || queue.length === 0) return
    const timer = setTimeout(() => {
      setCurrent(queue[0])
      setQueue((items) => items.slice(1))
      setLeaving(false)
    }, GAP_MS)
    return () => clearTimeout(timer)
  }, [current, queue])

  // Sound, then exit after the configured duration
  const currentId = current?.id
  useEffect(() => {
    if (!currentId) return
    const { soundEnabled, sound, soundVolume, durationSeconds } = settingsRef.current!
    if (soundEnabled) {
      void playAlertSound(sound, soundVolume).then((played) => setAudioBlocked(!played && soundVolume > 0))
    }
    const exit = setTimeout(() => setLeaving(true), durationSeconds * 1000)
    const done = setTimeout(() => setCurrent(null), durationSeconds * 1000 + EXIT_MS)
    return () => {
      clearTimeout(exit)
      clearTimeout(done)
    }
  }, [currentId])

  const enableSound = useCallback(async () => {
    setAudioBlocked(!(await unlockAudio()))
  }, [])

  useEffect(() => {
    if (preview) setAudioBlocked(!isAudioUnlocked())
  }, [preview])

  const animation = `ov-${settings.animation}-${leaving ? 'out' : 'in'}`

  return (
    <OverlayFrame
      widget="alerts"
      status={state.status}
      preview={preview}
      emptyHint={!current ? 'Les alertes s’afficheront ici (utilisez « Tester »)' : null}
      style={{ ['--ov-accent' as string]: hexToRgba(settings.accentColor) }}
    >
      <div className="flex h-full w-full items-center justify-center p-6" aria-live="polite">
        {current && (
          <div
            key={current.id}
            data-testid="overlay-alert"
            data-kind={current.kind}
            data-test={current.test ? 'true' : 'false'}
            className={`max-w-full rounded-2xl px-8 py-6 text-center shadow-2xl ${animation}`}
            style={{
              background: hexToRgba(settings.backgroundColor),
              color: hexToRgba(settings.textColor),
              border: `3px solid ${hexToRgba(settings.accentColor)}`,
              fontSize: settings.fontSize,
            }}
          >
            <p className="font-extrabold leading-tight ov-glow break-words" style={{ textShadow: '0 2px 6px rgba(0,0,0,.45)' }}>
              {KIND_ICONS[current.kind] && <span className="mr-2">{KIND_ICONS[current.kind]}</span>}
              <span data-testid="overlay-alert-title">{current.title}</span>
            </p>
            {current.message && (
              <p
                data-testid="overlay-alert-message"
                className="mt-3 break-words font-medium"
                style={{ fontSize: Math.round(settings.fontSize * 0.6), color: hexToRgba(settings.accentColor) }}
              >
                « {current.message} »
              </p>
            )}
            {current.test && (
              <p className="mt-2 text-xs uppercase tracking-widest opacity-70" style={{ fontSize: 12 }}>
                Test
              </p>
            )}
          </div>
        )}
      </div>
      {preview && settings.soundEnabled && audioBlocked && (
        <button
          type="button"
          onClick={enableSound}
          data-testid="overlay-sound-hint"
          className="absolute left-2 top-2 rounded-full bg-black/70 px-3 py-1 text-xs text-white"
        >
          🔇 Aperçu : cliquez pour activer le son (OBS le joue automatiquement)
        </button>
      )}
    </OverlayFrame>
  )
}
