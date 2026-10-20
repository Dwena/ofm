'use client'

import { useCallback, useEffect, useRef, useState, type MutableRefObject } from 'react'
import {
  BroadcastQualityManager,
  type BroadcastHealth,
  type BroadcastPeerRef,
} from '@/lib/webrtc/broadcast-quality-manager'
import { DEFAULT_QUALITY_PRESET, isQualityPresetId, type QualityPresetId } from '@/lib/webrtc/quality-presets'

const PRESET_STORAGE_KEY = 'live-quality-preset'

/**
 * Creator's quality preset and adaptive bitrate loop over the viewers'
 * connections (`peersRef`). The loop runs while `active`.
 */
export function useBroadcastQuality<Peer extends BroadcastPeerRef>(
  peersRef: MutableRefObject<Map<string, Peer>>,
  active: boolean,
) {
  const [presetId, setPresetIdState] = useState<QualityPresetId>(DEFAULT_QUALITY_PRESET)
  const [health, setHealth] = useState<BroadcastHealth | null>(null)
  const managerRef = useRef<BroadcastQualityManager>()

  if (!managerRef.current) {
    managerRef.current = new BroadcastQualityManager({
      getPeers: () => peersRef.current,
      onHealth: setHealth,
      presetId: DEFAULT_QUALITY_PRESET,
    })
  }
  const manager = managerRef.current

  // Last preset chosen on this browser
  useEffect(() => {
    try {
      const saved = localStorage.getItem(PRESET_STORAGE_KEY)
      if (isQualityPresetId(saved)) {
        setPresetIdState(saved)
        manager.setPreset(saved)
      }
    } catch {
      // Storage unavailable
    }
  }, [manager])

  useEffect(() => {
    if (!active) return
    manager.start()
    return () => {
      manager.stop()
      setHealth(null)
    }
  }, [active, manager])

  const setPresetId = useCallback(
    (id: QualityPresetId) => {
      setPresetIdState(id)
      manager.setPreset(id)
      try {
        localStorage.setItem(PRESET_STORAGE_KEY, id)
      } catch {
        // Storage unavailable
      }
    },
    [manager],
  )

  return { manager, presetId, setPresetId, health }
}
