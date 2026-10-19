'use client'

import Link from 'next/link'
import { useQuery } from '@tanstack/react-query'
import { format, formatDistanceToNow } from 'date-fns'
import { fr } from 'date-fns/locale'
import { Radio, Users, CalendarClock } from 'lucide-react'
import { liveApi } from '@/lib/api'
import { VISIBILITY_LABELS } from '@/lib/live'
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
  viewerCount: number
  startedAt?: string | null
  scheduledFor?: string | null
  creator: {
    id: string
    username: string
    displayName?: string | null
    avatar?: string | null
  }
}

const toList = (data: unknown) => (Array.isArray(data) ? (data as StreamSummary[]) : [])

export default function LiveStreamsPage() {
  const { user } = useAuth()

  const { data: liveStreams = [], isLoading } = useQuery({
    queryKey: ['live-streams'],
    queryFn: async () => toList((await liveApi.getLiveStreams()).data),
    refetchInterval: 15000,
  })

  const { data: scheduledStreams = [] } = useQuery({
    queryKey: ['scheduled-streams'],
    queryFn: async () => toList((await liveApi.getScheduledStreams()).data),
  })

  return (
    <div className="space-y-8">
      <div className="flex items-center justify-between flex-wrap gap-4">
        <div>
          <h1 className="text-3xl font-bold flex items-center gap-2">
            <Radio className="h-7 w-7 text-red-500" />
            Lives
          </h1>
          <p className="text-muted-foreground">Les créateurs en direct en ce moment</p>
        </div>
        {user?.role === 'CREATOR' && (
          <Link href="/creator/live">
            <Button>
              <Radio className="h-4 w-4 mr-2" /> Lancer un live
            </Button>
          </Link>
        )}
      </div>

      <section className="space-y-4">
        <h2 className="text-xl font-semibold">En direct</h2>
        {isLoading ? (
          <div className="flex justify-center py-12">
            <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-primary"></div>
          </div>
        ) : liveStreams.length === 0 ? (
          <Card>
            <CardContent className="py-12 text-center text-muted-foreground">
              Aucun live en cours pour le moment.
            </CardContent>
          </Card>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {liveStreams.map((stream) => (
              <Link key={stream.id} href={`/live/${stream.id}`}>
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
                    <div className="absolute top-2 right-2 flex items-center gap-1 bg-black/60 text-white text-xs px-2 py-1 rounded-full">
                      <Users className="h-3 w-3" />
                      {(stream.viewerCount ?? 0).toLocaleString('fr-FR')}
                    </div>
                  </div>
                  <CardContent className="pt-4 space-y-1">
                    <p className="font-semibold truncate">{stream.title}</p>
                    <p className="text-sm text-muted-foreground truncate">
                      {stream.creator.displayName || `@${stream.creator.username}`}
                    </p>
                    <div className="flex items-center justify-between text-xs text-muted-foreground">
                      <Badge variant="outline">
                        {stream.isPpv ? 'Pay-per-view' : VISIBILITY_LABELS[stream.visibility] ?? stream.visibility}
                      </Badge>
                      {stream.startedAt && (
                        <span>
                          depuis {formatDistanceToNow(new Date(stream.startedAt), { locale: fr })}
                        </span>
                      )}
                    </div>
                  </CardContent>
                </Card>
              </Link>
            ))}
          </div>
        )}
      </section>

      {scheduledStreams.length > 0 && (
        <section className="space-y-4">
          <h2 className="text-xl font-semibold flex items-center gap-2">
            <CalendarClock className="h-5 w-5" /> Programmés
          </h2>
          <div className="grid gap-3 sm:grid-cols-2">
            {scheduledStreams.map((stream) => (
              <Card key={stream.id}>
                <CardContent className="pt-4 flex items-center gap-3">
                  <Avatar>
                    <AvatarImage src={stream.creator.avatar || undefined} />
                    <AvatarFallback>{stream.creator.username.substring(0, 2).toUpperCase()}</AvatarFallback>
                  </Avatar>
                  <div className="min-w-0 flex-1">
                    <p className="font-medium truncate">{stream.title}</p>
                    <p className="text-sm text-muted-foreground truncate">
                      <Link href={`/${stream.creator.username}`} className="hover:underline">
                        {stream.creator.displayName || `@${stream.creator.username}`}
                      </Link>
                      {stream.scheduledFor &&
                        ` · ${format(new Date(stream.scheduledFor), "d MMM 'à' HH:mm", { locale: fr })}`}
                    </p>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </section>
      )}
    </div>
  )
}
