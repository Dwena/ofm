'use client'

import { Camera, Loader2, Mic, SlidersHorizontal } from 'lucide-react'
import type { MediaDeviceOption } from '@/hooks/use-media-devices'
import { QUALITY_PRESETS, QUALITY_PRESET_IDS, type QualityPresetId } from '@/lib/webrtc/quality-presets'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'

interface BroadcastQualitySettingsProps {
  presetId: QualityPresetId
  onPresetChange: (id: QualityPresetId) => void
  cameras: MediaDeviceOption[]
  microphones: MediaDeviceOption[]
  cameraId?: string
  microphoneId?: string
  onCameraChange: (deviceId: string) => void
  onMicrophoneChange: (deviceId: string) => void
  /** A switch is in progress */
  busy?: boolean
  /** Live: changes apply to the viewers immediately */
  live?: boolean
}

/**
 * Quality preset and capture devices of the creator, before or during a live
 */
export function BroadcastQualitySettings({
  presetId,
  onPresetChange,
  cameras,
  microphones,
  cameraId,
  microphoneId,
  onCameraChange,
  onMicrophoneChange,
  busy = false,
  live = false,
}: BroadcastQualitySettingsProps) {
  return (
    <div className="space-y-3" data-testid="broadcast-quality-settings">
      <div className="flex items-center gap-2 text-sm font-medium">
        <SlidersHorizontal className="h-4 w-4" />
        Qualité de diffusion
        {busy && <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" aria-label="Application..." />}
      </div>
      <div className="grid gap-3 sm:grid-cols-3">
        <div className="space-y-1 min-w-0">
          <Label htmlFor="live-quality-preset" className="text-xs text-muted-foreground">
            Qualité vidéo
          </Label>
          <Select value={presetId} onValueChange={(value) => onPresetChange(value as QualityPresetId)} disabled={busy}>
            <SelectTrigger id="live-quality-preset" aria-label="Qualité vidéo">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {QUALITY_PRESET_IDS.map((id) => (
                <SelectItem key={id} value={id}>
                  {QUALITY_PRESETS[id].label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <p className="text-xs text-muted-foreground">{QUALITY_PRESETS[presetId].description}</p>
        </div>
        <div className="space-y-1 min-w-0">
          <Label htmlFor="live-camera" className="text-xs text-muted-foreground flex items-center gap-1">
            <Camera className="h-3 w-3" /> Caméra
          </Label>
          <Select
            value={cameraId || undefined}
            onValueChange={onCameraChange}
            disabled={busy || cameras.length === 0}
          >
            <SelectTrigger id="live-camera" aria-label="Caméra">
              <SelectValue placeholder={cameras.length === 0 ? 'Aucune caméra détectée' : 'Caméra par défaut'} />
            </SelectTrigger>
            <SelectContent>
              {cameras.map((device) => (
                <SelectItem key={device.deviceId} value={device.deviceId}>
                  {device.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1 min-w-0">
          <Label htmlFor="live-microphone" className="text-xs text-muted-foreground flex items-center gap-1">
            <Mic className="h-3 w-3" /> Micro
          </Label>
          <Select
            value={microphoneId || undefined}
            onValueChange={onMicrophoneChange}
            disabled={busy || microphones.length === 0}
          >
            <SelectTrigger id="live-microphone" aria-label="Micro">
              <SelectValue placeholder={microphones.length === 0 ? 'Aucun micro détecté' : 'Micro par défaut'} />
            </SelectTrigger>
            <SelectContent>
              {microphones.map((device) => (
                <SelectItem key={device.deviceId} value={device.deviceId}>
                  {device.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>
      {live && (
        <p className="text-xs text-muted-foreground">
          Les changements s&apos;appliquent en direct, sans couper la diffusion. Le débit envoyé à chaque spectateur
          s&apos;adapte automatiquement à sa connexion et à la vôtre.
        </p>
      )}
    </div>
  )
}
