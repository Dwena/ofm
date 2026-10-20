'use client'

import { Activity, Loader2 } from 'lucide-react'
import type { LiveKitBroadcastHealth, LiveKitBroadcastState } from '@/hooks/use-livekit-broadcast'
import type { ConnectionLevel } from '@/lib/webrtc/bitrate-controller'
import { formatKbps } from '@/lib/webrtc/connection-quality'
import { QUALITY_PRESETS } from '@/lib/webrtc/quality-presets'
import { cn } from '@/lib/utils'

const LEVEL_LABELS: Record<ConnectionLevel, string> = {
  good: 'Bonne',
  fair: 'Moyenne',
  poor: 'Faible',
}

const LEVEL_DOT: Record<ConnectionLevel, string> = {
  good: 'bg-green-500',
  fair: 'bg-amber-500',
  poor: 'bg-red-500',
}

const LIMITATION_LABELS: Record<string, string> = {
  bandwidth: 'débit limité',
  cpu: 'processeur saturé',
}

const STATE_LABELS: Record<LiveKitBroadcastState, string> = {
  idle: 'En attente',
  connecting: 'Connexion au serveur vidéo...',
  publishing: 'En direct',
  reconnecting: 'Reconnexion au serveur vidéo...',
  replaced: 'Diffusion reprise ailleurs',
  ended: 'Live terminé',
  error: 'Serveur vidéo indisponible',
}

const LAYER_LABELS: Record<string, string> = { q: 'basse', h: 'moyenne', f: 'haute' }

interface LiveKitHealthPanelProps {
  health: LiveKitBroadcastHealth | null
  state: LiveKitBroadcastState
  /** Viewers connected to the live (socket) */
  viewerCount: number
  /** Viewers connected to the video (LiveKit webhooks), null when unknown */
  videoViewerCount: number | null
  /** The signaling socket is reconnecting (video keeps flowing meanwhile) */
  reconnecting?: boolean
}

/**
 * "Santé du live" with the LiveKit transport: the creator uploads one video
 * (three simulcast layers) to the server, whatever the number of viewers.
 */
export function LiveKitHealthPanel({
  health,
  state,
  viewerCount,
  videoViewerCount,
  reconnecting = false,
}: LiveKitHealthPanelProps) {
  const publishing = state === 'publishing'
  const level = publishing ? (health?.level ?? null) : null
  const viewers = videoViewerCount ?? viewerCount

  return (
    <div className="rounded-lg border p-3 space-y-2 text-sm" data-testid="broadcast-health" data-transport="livekit">
      <div className="flex items-center justify-between gap-2">
        <span className="flex items-center gap-2 font-medium">
          <Activity className="h-4 w-4" /> Santé du live
        </span>
        {publishing && health ? (
          <span className="flex items-center gap-1.5" data-testid="broadcast-health-level">
            <span className={cn('h-2 w-2 rounded-full', level ? LEVEL_DOT[level] : 'bg-muted-foreground')} aria-hidden />
            {level ? LEVEL_LABELS[level] : 'Mesure en cours'}
          </span>
        ) : publishing ? (
          <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" aria-label="Mesure en cours" />
        ) : (
          <span className="flex items-center gap-1.5 text-muted-foreground" data-testid="broadcast-health-state">
            {(state === 'connecting' || state === 'reconnecting') && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
            {STATE_LABELS[state]}
          </span>
        )}
      </div>
      {reconnecting && (
        <p className="text-xs text-amber-600">
          Connexion au serveur interrompue : reconnexion en cours, la vidéo continue d&apos;être envoyée.
        </p>
      )}
      <dl className="grid grid-cols-2 gap-x-3 gap-y-1 text-xs">
        <dt className="text-muted-foreground">Diffusion</dt>
        <dd>Serveur vidéo (envoi unique)</dd>
        {health && (
          <>
            <dt className="text-muted-foreground">Qualité</dt>
            <dd data-testid="broadcast-health-preset">{QUALITY_PRESETS[health.presetId].label}</dd>
            <dt className="text-muted-foreground">Débit envoyé</dt>
            <dd data-testid="broadcast-health-upload" data-kbps={Math.round(health.uploadKbps ?? 0)}>
              {health.uploadKbps !== undefined ? formatKbps(health.uploadKbps) : '…'}
            </dd>
          </>
        )}
        <dt className="text-muted-foreground">{videoViewerCount !== null ? 'Vidéo connectée' : 'Spectateurs'}</dt>
        <dd data-testid="broadcast-health-peers">
          {viewers.toLocaleString('fr-FR')} spectateur{viewers > 1 ? 's' : ''}
        </dd>
        {health && health.layers.length > 0 && (
          <>
            <dt className="text-muted-foreground">Couches envoyées</dt>
            <dd data-testid="broadcast-health-layers" className="break-words">
              {health.layers
                .map((layer) =>
                  layer.active && layer.height ? `${layer.height}p` : `${LAYER_LABELS[layer.rid] ?? layer.rid} en pause`,
                )
                .join(' · ')}
            </dd>
          </>
        )}
        {health?.rttMs !== undefined && (
          <>
            <dt className="text-muted-foreground">Latence serveur</dt>
            <dd>{Math.round(health.rttMs)} ms</dd>
          </>
        )}
        {health?.limitation && LIMITATION_LABELS[health.limitation] && (
          <>
            <dt className="text-muted-foreground">Limitation</dt>
            <dd>{LIMITATION_LABELS[health.limitation]}</dd>
          </>
        )}
      </dl>
    </div>
  )
}
