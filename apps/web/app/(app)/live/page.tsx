'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { format, formatDistanceToNow } from 'date-fns'
import { fr } from 'date-fns/locale'
import { Radio, Users, CalendarClock, Lock, Ticket, RefreshCw, Loader2 } from 'lucide-react'
import { liveApi } from '@/lib/api'
import { VISIBILITY_LABELS } from '@/lib/live'
import { formatEuros } from '@/lib/utils'
import { formatGoalEuros } from '@/lib/live-tip-goals'
import { useAuth } from '@/contexts/auth-context'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'

interface StreamSummary {
  id: string
  title: string
  description?: string | null
  thumbnailUrl?: string | null
  status: 'SCHEDULED' | 'LIVE' | 'ENDED' | 'CANCELLED'
  visibility: string
  isPpv?: boolean
  ppvPrice?: number | string | null
  viewerCount: number
  startedAt?: string | null
  scheduledFor?: string | null
  /** Euros of tips received during the live */
  tipTotal?: number
  /** Number of donation goal milestones */
  tipGoalsCount?: number
  /** First milestone not reached yet (null: none, or all reached) */
  nextTipGoal?: { amount: number; label: string } | null
  creator: {
    id: string
    username: string
    displayName?: string | null
    avatar?: string | null
  }
}

const toList = (data: unknown) => (Array.isArray(data) ? (data as StreamSummary[]) : [])

/** Ticking clock; re-renders every `intervalMs` */
function useNow(intervalMs: number) {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), intervalMs)
    return () => clearInterval(timer)
  }, [intervalMs])
  return now
}

function formatCountdown(ms: number) {
  if (ms <= 0) return 'Imminent'
  const totalMinutes = Math.floor(ms / 60000)
  const days = Math.floor(totalMinutes / 1440)
  const hours = Math.floor((totalMinutes % 1440) / 60)
  const minutes = totalMinutes % 60
  if (days > 0) return `Dans ${days} j ${hours} h`
  if (hours > 0) return `Dans ${hours} h ${String(minutes).padStart(2, '0')} min`
  if (totalMinutes > 0) return `Dans ${minutes} min`
  return `Dans ${Math.ceil(ms / 1000)} s`
}

function AccessBadge({ stream }: { stream: StreamSummary }) {
  if (stream.isPpv || stream.visibility === 'PPV') {
    return (
      <Badge variant="outline" className="gap-1">
        <Ticket className="h-3 w-3" />
        {stream.ppvPrice != null && Number(stream.ppvPrice) > 0
          ? `Pay-per-view · ${formatEuros(stream.ppvPrice)}`
          : 'Pay-per-view'}
      </Badge>
    )
  }
  const restricted = stream.visibility !== 'PUBLIC'
  return (
    <Badge variant="outline" className="gap-1">
      {restricted && <Lock className="h-3 w-3" />}
      {VISIBILITY_LABELS[stream.visibility] ?? stream.visibility}
    </Badge>
  )
}

/** "🎯 45 € / 100 € · Je réponds à toutes vos questions" when the live has donation goals */
function TipGoalLine({ stream }: { stream: StreamSummary }) {
  if (!stream.tipGoalsCount) return null
  const total = formatGoalEuros(Number(stream.tipTotal ?? 0))
  const next = stream.nextTipGoal
  const text = next
    ? `${total} / ${formatGoalEuros(next.amount)} · ${next.label}`
    : `${total} · tous les paliers sont atteints`
  return (
    <p
      className="truncate text-xs text-muted-foreground"
      title={next ? `Prochain palier : ${formatGoalEuros(next.amount)} — ${next.label}` : undefined}
      data-testid="live-card-goal"
    >
      <span aria-hidden>🎯 </span>
      <span className="sr-only">Objectifs de dons : </span>
      {text}
    </p>
  )
}

function ErrorCard({ message, onRetry, retrying }: { message: string; onRetry: () => void; retrying: boolean }) {
  return (
    <Card>
      <CardContent className="py-10 text-center space-y-3">
        <p className="text-muted-foreground">{message}</p>
        <Button variant="outline" size="sm" onClick={onRetry} disabled={retrying}>
          {retrying ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <RefreshCw className="h-4 w-4 mr-2" />}
          Réessayer
        </Button>
      </CardContent>
    </Card>
  )
}

export default function LiveStreamsPage() {
  const { user } = useAuth()
  const queryClient = useQueryClient()
  const now = useNow(1000)

  const live = useQuery({
    queryKey: ['live-streams'],
    queryFn: async () => toList((await liveApi.getLiveStreams()).data),
    refetchInterval: 15000,
  })
  const liveStreams = live.data ?? []

  const scheduled = useQuery({
    queryKey: ['scheduled-streams'],
    queryFn: async () => toList((await liveApi.getScheduledStreams()).data),
    refetchInterval: 60000,
  })
  const scheduledStreams = scheduled.data ?? []

  // When a scheduled start time passes, refresh both lists (the creator may have gone live)
  const nextStart = scheduledStreams
    .map((s) => (s.scheduledFor ? new Date(s.scheduledFor).getTime() : Infinity))
    .filter((t) => t > Date.now())
    .sort((a, b) => a - b)[0]
  useEffect(() => {
    if (!nextStart || !Number.isFinite(nextStart)) return
    const delay = Math.min(nextStart - Date.now() + 1000, 2 ** 31 - 1)
    const timer = setTimeout(() => {
      queryClient.invalidateQueries({ queryKey: ['live-streams'] })
      queryClient.invalidateQueries({ queryKey: ['scheduled-streams'] })
    }, Math.max(delay, 1000))
    return () => clearTimeout(timer)
  }, [nextStart, queryClient])

  return (
    <div className="space-y-8">
      <div className="flex items-center justify-between flex-wrap gap-4">
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold flex items-center gap-2">
            <Radio className="h-7 w-7 text-red-500" />
            Lives
          </h1>
          <p className="text-muted-foreground">Les créateurs en direct en ce moment</p>
        </div>
        {user?.role === 'CREATOR' && (
          <Button asChild>
            <Link href="/creator/live">
              <Radio className="h-4 w-4 mr-2" /> Lancer un live
            </Link>
          </Button>
        )}
      </div>

      <section className="space-y-4">
        <h2 className="text-xl font-semibold flex items-center gap-2">
          <span className="relative flex h-2.5 w-2.5">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75" />
            <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-red-500" />
          </span>
          En direct
          {liveStreams.length > 0 && (
            <span className="text-sm font-normal text-muted-foreground">({liveStreams.length})</span>
          )}
        </h2>
        {live.isLoading ? (
          <div className="flex justify-center py-12">
            <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-primary"></div>
          </div>
        ) : live.isError ? (
          <ErrorCard
            message="Impossible de charger les lives en cours."
            onRetry={() => live.refetch()}
            retrying={live.isRefetching}
          />
        ) : liveStreams.length === 0 ? (
          <Card>
            <CardContent className="py-12 text-center text-muted-foreground">
              Aucun live en cours pour le moment.
              {scheduledStreams.length > 0 && ' Découvrez les prochains lives programmés ci-dessous.'}
            </CardContent>
          </Card>
        ) : (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {liveStreams.map((stream) => (
              <Link key={stream.id} href={`/live/${stream.id}`} className="block">
                <Card className="overflow-hidden hover:shadow-lg transition-shadow h-full">
                  <div className="relative aspect-video bg-gradient-to-br from-red-500/20 to-purple-500/20">
                    {stream.thumbnailUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={stream.thumbnailUrl} alt={stream.title} className="w-full h-full object-cover" />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center">
                        <Avatar className="h-20 w-20">
                          <AvatarImage src={stream.creator.avatar || undefined} />
                          <AvatarFallback>{stream.creator.username.substring(0, 2).toUpperCase()}</AvatarFallback>
                        </Avatar>
                      </div>
                    )}
                    <Badge variant="destructive" className="absolute top-2 left-2 flex items-center gap-1">
                      <Radio className="h-3 w-3" /> LIVE
                    </Badge>
                    <div
                      className="absolute top-2 right-2 flex items-center gap-1 bg-black/60 text-white text-xs px-2 py-1 rounded-full"
                      title="Spectateurs"
                    >
                      <Users className="h-3 w-3" />
                      {(stream.viewerCount ?? 0).toLocaleString('fr-FR')}
                    </div>
                  </div>
                  <CardContent className="pt-4 space-y-2">
                    <div className="flex items-center gap-2 min-w-0">
                      <Avatar className="h-8 w-8 flex-shrink-0">
                        <AvatarImage src={stream.creator.avatar || undefined} />
                        <AvatarFallback>{stream.creator.username.substring(0, 2).toUpperCase()}</AvatarFallback>
                      </Avatar>
                      <div className="min-w-0">
                        <p className="font-semibold truncate">{stream.title}</p>
                        <p className="text-sm text-muted-foreground truncate">
                          {stream.creator.displayName || `@${stream.creator.username}`}
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
                      <AccessBadge stream={stream} />
                      {stream.startedAt && (
                        <span className="truncate">
                          depuis {formatDistanceToNow(new Date(stream.startedAt), { locale: fr })}
                        </span>
                      )}
                    </div>
                    <TipGoalLine stream={stream} />
                  </CardContent>
                </Card>
              </Link>
            ))}
          </div>
        )}
      </section>

      <section className="space-y-4">
        <h2 className="text-xl font-semibold flex items-center gap-2">
          <CalendarClock className="h-5 w-5" /> Programmés
        </h2>
        {scheduled.isLoading ? (
          <div className="flex justify-center py-8">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : scheduled.isError ? (
          <ErrorCard
            message="Impossible de charger les lives programmés."
            onRetry={() => scheduled.refetch()}
            retrying={scheduled.isRefetching}
          />
        ) : scheduledStreams.length === 0 ? (
          <Card>
            <CardContent className="py-8 text-center text-muted-foreground">
              Aucun live programmé pour le moment.
            </CardContent>
          </Card>
        ) : (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {scheduledStreams.map((stream) => {
              const startsAt = stream.scheduledFor ? new Date(stream.scheduledFor) : null
              return (
                <Card key={stream.id} className="hover:shadow-md transition-shadow">
                  <CardContent className="pt-4 flex items-start gap-3">
                    <Link
                      href={`/${stream.creator.username}`}
                      className="flex-shrink-0"
                      aria-label={`Profil de ${stream.creator.displayName || stream.creator.username}`}
                    >
                      <Avatar>
                        <AvatarImage src={stream.creator.avatar || undefined} />
                        <AvatarFallback>{stream.creator.username.substring(0, 2).toUpperCase()}</AvatarFallback>
                      </Avatar>
                    </Link>
                    <div className="min-w-0 flex-1 space-y-1">
                      <Link href={`/live/${stream.id}`} className="font-medium truncate block hover:underline">
                        {stream.title}
                      </Link>
                      <p className="text-sm text-muted-foreground truncate">
                        <Link href={`/${stream.creator.username}`} className="hover:underline">
                          {stream.creator.displayName || `@${stream.creator.username}`}
                        </Link>
                        {startsAt && ` · ${format(startsAt, "EEE d MMM 'à' HH:mm", { locale: fr })}`}
                      </p>
                      <div className="flex flex-wrap items-center gap-2 pt-1">
                        <AccessBadge stream={stream} />
                        {startsAt && (
                          <Badge variant="secondary" className="tabular-nums">
                            {formatCountdown(startsAt.getTime() - now)}
                          </Badge>
                        )}
                      </div>
                      <TipGoalLine stream={stream} />
                    </div>
                  </CardContent>
                </Card>
              )
            })}
          </div>
        )}
      </section>
    </div>
  )
}
