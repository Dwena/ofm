'use client'

import { useEffect, useState } from 'react'
import { formatDistanceToNow } from 'date-fns'
import { fr } from 'date-fns/locale'
import { RefreshCw } from 'lucide-react'
import { Button } from '@/components/ui/button'

/**
 * "En direct" badge for live-refreshing metrics, with last update time and manual refresh.
 */
export function LiveIndicator({
  connected,
  updatedAt,
  isFetching,
  onRefresh,
}: {
  connected: boolean
  updatedAt?: number
  isFetching?: boolean
  onRefresh?: () => void
}) {
  // Re-render periodically so the relative time stays accurate
  const [, setTick] = useState(0)
  useEffect(() => {
    const timer = setInterval(() => setTick((t) => t + 1), 15000)
    return () => clearInterval(timer)
  }, [])

  return (
    <div className="flex items-center gap-3 text-xs text-muted-foreground">
      <span className="flex items-center gap-1.5">
        <span className="relative flex h-2 w-2">
          {connected && (
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-green-500 opacity-75" />
          )}
          <span className={`relative inline-flex h-2 w-2 rounded-full ${connected ? 'bg-green-500' : 'bg-yellow-500'}`} />
        </span>
        {connected ? 'En direct' : 'Actualisation auto (30 s)'}
      </span>
      {updatedAt ? (
        <span>
          Mis à jour {formatDistanceToNow(new Date(updatedAt), { addSuffix: true, locale: fr })}
        </span>
      ) : null}
      {onRefresh && (
        <Button
          variant="ghost"
          size="sm"
          className="h-7 px-2"
          onClick={onRefresh}
          disabled={isFetching}
          aria-label="Actualiser"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${isFetching ? 'animate-spin' : ''}`} />
        </Button>
      )}
    </div>
  )
}
