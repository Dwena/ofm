'use client'

import { useRef, type ReactNode } from 'react'
import { Activity, Loader2, MonitorPlay, Settings2 } from 'lucide-react'
import { Card, CardContent } from '@/components/ui/card'
import { useLiveKitViewer } from '@/hooks/use-livekit-viewer'
import type { useLiveIngress } from '@/hooks/use-live-ingress'
import { formatKbps } from '@/lib/webrtc/connection-quality'
import { OBS_STATUS_DESCRIPTIONS, type ObsStatus } from '@/lib/live-ingress'
import { ObsStatusBadge } from './obs-status-badge'
import { ObsIngressSettings } from './obs-ingress-settings'

interface ObsLivePanelProps {
  streamId: string
  /** OBS status of this live (socket `obs-status`, stream data, ingress polling) */
  status: ObsStatus
  controls: ReturnType<typeof useLiveIngress>
  /** Viewers connected to the live (socket) */
  viewerCount: number
  /** The signaling socket is reconnecting */
  reconnecting?: boolean
  /** "Quitter" / "Terminer le live" buttons of the page */
  actions?: ReactNode
}

/**
 * Creator's live in OBS mode: no camera here. Preview of what the viewers
 * receive (LiveKit, viewer token: the creator's own identity is the ingress),
 * OBS status, received video stats and the OBS settings.
 */
export function ObsLivePanel({ streamId, status, controls, viewerCount, reconnecting = false, actions }: ObsLivePanelProps) {
  const videoRef = useRef<HTMLVideoElement>(null)
  // The preview never plays sound (OBS already monitors it)
  const mutedRef = useRef(true)
  // Not adaptive: the preview keeps playing while the creator scrolls to the
  // chat / tip queue (an off-screen adaptive player is paused by LiveKit)
  const preview = useLiveKitViewer({ streamId, enabled: true, videoRef, mutedRef, mode: 'auto', adaptive: false })
  const sample = preview.quality?.sample
  const ingress = controls.ingress
  const playing = preview.state === 'playing'

  return (
    <>
      <Card className="overflow-hidden" data-testid="obs-live-panel">
        <div className="relative bg-black aspect-video">
          <video ref={videoRef} className="w-full h-full object-contain" autoPlay playsInline muted />
          {!playing && (
            <div className="absolute inset-0 flex flex-col items-center justify-center text-white/80 gap-3 p-4 text-center">
              {status === 'offline' ? <MonitorPlay className="h-10 w-10" /> : <Loader2 className="h-10 w-10 animate-spin" />}
              <p data-testid="obs-preview-waiting">
                {status === 'offline'
                  ? 'En attente du signal OBS… Cliquez sur « Démarrer le streaming » dans OBS.'
                  : 'Signal OBS reçu, la vidéo arrive…'}
              </p>
            </div>
          )}
          <div className="absolute top-3 left-3">
            <ObsStatusBadge status={playing && status !== 'live' ? 'live' : status} boundToLive />
          </div>
        </div>
        <CardContent className="pt-4 flex flex-wrap items-center gap-2">
          <p className="text-sm text-muted-foreground flex-1 min-w-[12rem]">
            Aperçu de ce que voient vos spectateurs (sans le son). {OBS_STATUS_DESCRIPTIONS[status]}
          </p>
          {actions && <div className="flex flex-wrap gap-2 sm:ml-auto">{actions}</div>}
        </CardContent>
      </Card>

      <div className="rounded-lg border p-3 space-y-2 text-sm" data-testid="broadcast-health" data-transport="obs">
        <div className="flex items-center justify-between gap-2">
          <span className="flex items-center gap-2 font-medium">
            <Activity className="h-4 w-4" /> Santé du live
          </span>
          <ObsStatusBadge status={status} boundToLive />
        </div>
        {reconnecting && (
          <p className="text-xs text-amber-600">
            Connexion au serveur interrompue : reconnexion en cours, OBS continue d&apos;envoyer la vidéo.
          </p>
        )}
        <dl className="grid grid-cols-2 gap-x-3 gap-y-1 text-xs">
          <dt className="text-muted-foreground">Diffusion</dt>
          <dd>OBS (RTMP) → serveur vidéo</dd>
          {sample?.height ? (
            <>
              <dt className="text-muted-foreground">Vidéo reçue</dt>
              <dd data-testid="obs-health-resolution">
                {sample.width}×{sample.height}
                {sample.framesPerSecond ? ` · ${Math.round(sample.framesPerSecond)} i/s` : ''}
              </dd>
            </>
          ) : null}
          {sample?.bitrateKbps !== undefined && (
            <>
              <dt className="text-muted-foreground">Débit reçu</dt>
              <dd data-testid="obs-health-bitrate">{formatKbps(sample.bitrateKbps)}</dd>
            </>
          )}
          {preview.layerCount !== null && (
            <>
              <dt className="text-muted-foreground">Qualités proposées</dt>
              <dd data-testid="obs-health-layers">
                {preview.layerCount > 1 ? `${preview.layerCount} (adaptatives)` : '1 (flux OBS tel quel)'}
              </dd>
            </>
          )}
          <dt className="text-muted-foreground">Spectateurs</dt>
          <dd data-testid="broadcast-health-peers">
            {viewerCount.toLocaleString('fr-FR')} spectateur{viewerCount > 1 ? 's' : ''}
          </dd>
        </dl>
      </div>

      {ingress && (
        <details className="rounded-lg border p-4 group" data-testid="obs-live-settings">
          <summary className="flex cursor-pointer items-center gap-2 font-medium">
            <Settings2 className="h-4 w-4" /> Réglages OBS (URL, clé, tutoriel)
          </summary>
          <div className="pt-4">
            <ObsIngressSettings controls={controls} live />
          </div>
        </details>
      )}
    </>
  )
}
