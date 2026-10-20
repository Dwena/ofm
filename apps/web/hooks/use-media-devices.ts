'use client'

import { useCallback, useEffect, useState } from 'react'

export interface MediaDeviceOption {
  deviceId: string
  label: string
}

const toOptions = (devices: MediaDeviceInfo[], kind: MediaDeviceKind, fallback: string): MediaDeviceOption[] =>
  devices
    .filter((device) => device.kind === kind && device.deviceId)
    .map((device, index) => ({ deviceId: device.deviceId, label: device.label || `${fallback} ${index + 1}` }))

/**
 * Cameras and microphones of the browser. Labels are only exposed once the
 * camera permission was granted, so call refresh() after getUserMedia.
 */
export function useMediaDevices() {
  const [cameras, setCameras] = useState<MediaDeviceOption[]>([])
  const [microphones, setMicrophones] = useState<MediaDeviceOption[]>([])

  const refresh = useCallback(async () => {
    if (typeof navigator === 'undefined' || !navigator.mediaDevices?.enumerateDevices) return
    try {
      const devices = await navigator.mediaDevices.enumerateDevices()
      setCameras(toOptions(devices, 'videoinput', 'Caméra'))
      setMicrophones(toOptions(devices, 'audioinput', 'Micro'))
    } catch (error) {
      console.warn('enumerateDevices error:', error)
    }
  }, [])

  useEffect(() => {
    void refresh()
    const mediaDevices = typeof navigator !== 'undefined' ? navigator.mediaDevices : undefined
    if (!mediaDevices?.addEventListener) return
    const onChange = () => void refresh()
    mediaDevices.addEventListener('devicechange', onChange)
    return () => mediaDevices.removeEventListener('devicechange', onChange)
  }, [refresh])

  return { cameras, microphones, refresh }
}
