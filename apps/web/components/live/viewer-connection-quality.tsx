'use client'

import { Check, Gauge, SignalHigh, SignalLow, SignalMedium } from 'lucide-react'
import type { ViewerQualityMode } from '@/lib/webrtc/bitrate-controller'
import { describeReceiverSample, type ViewerQuality } from '@/lib/webrtc/connection-quality'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'

const LEVEL_STYLE = {
  excellent: { icon: SignalHigh, className: 'text-green-400' },
  good: { icon: SignalMedium, className: 'text-amber-300' },
  poor: { icon: SignalLow, className: 'text-red-400' },
} as const

/**
 * Small badge over the player: "Excellente / Bonne / Faible", details on hover
 */
export function ViewerQualityIndicator({ quality }: { quality: ViewerQuality | null }) {
  if (!quality) return null
  const { icon: Icon, className } = LEVEL_STYLE[quality.level]
  const details = describeReceiverSample(quality.sample)
  return (
    <div
      className="flex items-center gap-1.5 rounded-full bg-black/60 px-2.5 py-1 text-xs text-white"
      title={details ? `Connexion ${quality.label.toLowerCase()} · ${details}` : undefined}
      data-testid="viewer-quality-indicator"
      data-level={quality.level}
    >
      <Icon className={cn('h-3.5 w-3.5', className)} aria-hidden />
      <span>{quality.label}</span>
      {quality.sample.height ? <span className="hidden sm:inline text-white/70">{quality.sample.height}p</span> : null}
    </div>
  )
}

const MODES: { value: ViewerQualityMode; label: string; description: string }[] = [
  { value: 'auto', label: 'Auto', description: 'Meilleure qualité possible pour votre connexion' },
  { value: 'low', label: 'Économie de données', description: 'Image réduite, environ 0,5 Mbit/s' },
]

/**
 * "Qualité" menu of the player
 */
export function ViewerQualityMenu({
  mode,
  onChange,
  disabled = false,
}: {
  mode: ViewerQualityMode
  onChange: (mode: ViewerQualityMode) => void
  disabled?: boolean
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="text-white hover:bg-white/20 h-8 w-8 sm:h-10 sm:w-10"
          title="Qualité"
          aria-label="Qualité"
          disabled={disabled}
          data-testid="viewer-quality-menu"
        >
          <Gauge className="h-5 w-5" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-64">
        <DropdownMenuLabel>Qualité</DropdownMenuLabel>
        <DropdownMenuSeparator />
        {MODES.map((item) => (
          <DropdownMenuItem
            key={item.value}
            onSelect={() => onChange(item.value)}
            className="flex items-start gap-2"
            data-testid={`viewer-quality-${item.value}`}
          >
            <Check className={cn('h-4 w-4 mt-0.5 shrink-0', mode === item.value ? 'opacity-100' : 'opacity-0')} />
            <span className="flex flex-col">
              <span>{item.label}</span>
              <span className="text-xs text-muted-foreground">{item.description}</span>
            </span>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
