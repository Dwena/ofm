'use client'

import { Activity, Loader2 } from 'lucide-react'
import type { BroadcastHealth } from '@/lib/webrtc/broadcast-quality-manager'
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

interface BroadcastHealthPanelProps {
  health: BroadcastHealth | null
  /** The signaling socket is reconnecting (video keeps flowing meanwhile) */
  reconnecting?: boolean
}

/**
 * "Santé du live": what the creator's upload looks like right now
 */
export function BroadcastHealthPanel({ health, reconnecting = false }: BroadcastHealthPanelProps) {
  return (
    <div className="rounded-lg border p-3 space-y-2 text-sm" data-testid="broadcast-health">
      <div className="flex items-center justify-between gap-2">
        <span className="flex items-center gap-2 font-medium">
          <Activity className="h-4 w-4" /> Santé du live
        </span>
        {health ? (
          <span className="flex items-center gap-1.5" data-testid="broadcast-health-level">
            <span className={cn('h-2 w-2 rounded-full', LEVEL_DOT[health.level])} aria-hidden />
            {health.totalPeers === 0 ? 'En attente de spectateurs' : LEVEL_LABELS[health.level]}
          </span>
        ) : (
          <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" aria-label="Mesure en cours" />
        )}
      </div>
      {reconnecting && (
        <p className="text-xs text-amber-600">
          Connexion au serveur interrompue : reconnexion en cours, la vidéo continue d&apos;être envoyée.
        </p>
      )}
      {health && (
        <dl className="grid grid-cols-2 gap-x-3 gap-y-1 text-xs">
          <dt className="text-muted-foreground">Qualité</dt>
          <dd data-testid="broadcast-health-preset">{QUALITY_PRESETS[health.presetId].label}</dd>
          <dt className="text-muted-foreground">Débit envoyé</dt>
          <dd data-testid="broadcast-health-upload">{formatKbps(health.totalUploadKbps)}</dd>
          <dt className="text-muted-foreground">Vidéo connectée</dt>
          <dd data-testid="broadcast-health-peers">
            {health.connectedPeers}/{health.totalPeers} spectateur{health.totalPeers > 1 ? 's' : ''}
          </dd>
          <dt className="text-muted-foreground">Plafond par spectateur</dt>
          <dd>{formatKbps(health.perViewerCapKbps)}</dd>
          {health.dataSaverViewers > 0 && (
            <>
              <dt className="text-muted-foreground">Économie de données</dt>
              <dd>
                {health.dataSaverViewers} spectateur{health.dataSaverViewers > 1 ? 's' : ''}
              </dd>
            </>
          )}
          {health.worst && (
            <>
              <dt className="text-muted-foreground">Connexion la plus faible</dt>
              <dd>
                {LEVEL_LABELS[health.worst.level]}
                {health.worst.lossPct !== undefined &&
                  ` · perte ${health.worst.lossPct.toLocaleString('fr-FR', { maximumFractionDigits: 1 })} %`}
                {health.worst.rttMs !== undefined && ` · ${Math.round(health.worst.rttMs)} ms`}
                {health.worst.scaleDownBy > 1 && ` · résolution ÷${health.worst.scaleDownBy.toLocaleString('fr-FR')}`}
                {health.worst.limitation && LIMITATION_LABELS[health.worst.limitation]
                  ? ` · ${LIMITATION_LABELS[health.worst.limitation]}`
                  : ''}
              </dd>
            </>
          )}
        </dl>
      )}
    </div>
  )
}
