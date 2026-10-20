'use client'

import { Loader2, Radio, WifiOff } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { obsStatusLabel, type ObsStatus } from '@/lib/live-ingress'
import { cn } from '@/lib/utils'

interface ObsStatusBadgeProps {
  status: ObsStatus
  /** The ingress publishes in a live in progress (otherwise "Signal reçu") */
  boundToLive: boolean
  className?: string
}

/** OBS status: Hors ligne / Connexion… / En direct */
export function ObsStatusBadge({ status, boundToLive, className }: ObsStatusBadgeProps) {
  const label = obsStatusLabel(status, boundToLive)
  return (
    <Badge
      variant={status === 'live' ? (boundToLive ? 'destructive' : 'success') : 'secondary'}
      className={cn('flex items-center gap-1 whitespace-nowrap', className)}
      data-testid="obs-status"
      data-status={status}
      role="status"
      aria-live="polite"
    >
      {status === 'live' ? (
        <Radio className="h-3 w-3" aria-hidden />
      ) : status === 'connecting' ? (
        <Loader2 className="h-3 w-3 animate-spin" aria-hidden />
      ) : (
        <WifiOff className="h-3 w-3" aria-hidden />
      )}
      {label}
    </Badge>
  )
}
