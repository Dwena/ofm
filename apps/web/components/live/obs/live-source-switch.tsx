'use client'

import Link from 'next/link'
import { Loader2, MonitorPlay, Video } from 'lucide-react'
import type { LiveSource } from '@/lib/live-ingress'
import { cn } from '@/lib/utils'

interface LiveSourceSwitchProps {
  value: LiveSource
  onChange: (source: LiveSource) => void
  /** OBS mode possible (LiveKit configured); false: disabled with an explanation */
  obsAvailable: boolean
  /** Availability still being checked */
  checking?: boolean
}

const OPTIONS: { value: LiveSource; label: string; description: string; icon: typeof Video }[] = [
  { value: 'BROWSER', label: 'Navigateur', description: 'Caméra et micro de cet appareil', icon: Video },
  { value: 'OBS', label: 'OBS', description: 'Scènes, overlays, carte de capture…', icon: MonitorPlay },
]

/** "Navigateur / OBS": where the video of the live comes from */
export function LiveSourceSwitch({ value, onChange, obsAvailable, checking = false }: LiveSourceSwitchProps) {
  return (
    <fieldset className="space-y-2">
      <legend className="text-sm font-medium mb-2">Source vidéo</legend>
      <div className="grid grid-cols-2 gap-2" role="radiogroup" aria-label="Source vidéo">
        {OPTIONS.map((option) => {
          const disabled = option.value === 'OBS' && !obsAvailable
          const selected = value === option.value
          const Icon = option.icon
          return (
            <button
              key={option.value}
              type="button"
              role="radio"
              aria-checked={selected}
              disabled={disabled}
              onClick={() => onChange(option.value)}
              data-testid={`live-source-${option.value}`}
              className={cn(
                'rounded-lg border p-3 text-left transition-colors min-w-0 disabled:cursor-not-allowed disabled:opacity-50',
                selected ? 'border-primary bg-primary/5 ring-1 ring-primary' : 'hover:bg-muted',
              )}
            >
              <span className="flex items-center gap-2 font-medium">
                <Icon className="h-4 w-4 shrink-0" />
                {option.label}
                {option.value === 'OBS' && checking && <Loader2 className="h-3 w-3 animate-spin" />}
              </span>
              <span className="mt-1 block text-xs text-muted-foreground break-words">{option.description}</span>
            </button>
          )
        })}
      </div>
      {!obsAvailable && !checking ? (
        <p className="text-xs text-muted-foreground">
          La diffusion avec OBS nécessite le serveur vidéo LiveKit, qui n’est pas configuré sur cette plateforme.
        </p>
      ) : value === 'OBS' ? (
        <p className="text-xs text-muted-foreground">
          Pas besoin de caméra ici : OBS envoie la vidéo.{' '}
          <Link href="/creator/live/obs" className="underline">
            Réglages et tutoriel OBS
          </Link>
        </p>
      ) : null}
    </fieldset>
  )
}
