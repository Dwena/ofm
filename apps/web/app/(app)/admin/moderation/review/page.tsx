'use client'

import { Suspense, useState } from 'react'
import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  AlertTriangle,
  CalendarClock,
  CheckCircle2,
  ClipboardCheck,
  FileText,
  Radio,
  RefreshCw,
  ShieldAlert,
  StopCircle,
  User,
  Users,
  XCircle,
} from 'lucide-react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { toast } from '@/hooks/use-toast'
import { liveApi } from '@/lib/api'
import {
  EmptyState,
  ErrorState,
  KycStatusBadge,
  LoadingState,
  ReasonDialog,
  formatDateTime,
  getErrorMessage,
  timeAgo,
} from '@/components/admin/admin-shared'
import {
  CO_PERFORMER_STATUS_LABELS,
  ReviewContent,
  SCAN_STATUS_LABELS,
  STATUS_VARIANT,
  ageFrom,
  contentReviewApi,
} from '@/lib/verification'

const PAGE_SIZE = 10

type Decision = { content: ReviewContent; kind: 'approve' | 'reject' } | null

function ReviewItem({
  content,
  highlighted,
  onDecide,
  onRescan,
  rescanning,
}: {
  content: ReviewContent
  highlighted: boolean
  onDecide: (decision: Decision) => void
  onRescan: () => void
  rescanning: boolean
}) {
  const flagged = content.files.some((file) => file.scanStatus === 'FLAGGED')
  const pendingScan = content.files.some((file) => file.scanStatus === 'PENDING')
  const unverifiedPeople = content.coPerformers.filter((cp) => cp.status !== 'VERIFIED' || cp.deletedAt)
  const creatorUnverified = content.creator.kycStatus !== 'VERIFIED'
  const blocked = flagged || creatorUnverified || (!content.soloContent && (content.coPerformers.length === 0 || unverifiedPeople.length > 0))

  return (
    <Card className={highlighted ? 'ring-2 ring-primary' : ''} data-testid="review-item">
      <CardHeader className="space-y-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <CardTitle className="text-lg">{content.title || 'Sans titre'}</CardTitle>
          <div className="flex flex-wrap gap-2">
            <Badge variant="outline">{content.type}</Badge>
            <Badge variant="outline">{content.isPpv && content.ppvPrice != null ? `PPV ${content.ppvPrice} €` : content.visibility}</Badge>
          </div>
        </div>
        <CardDescription className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <span className="flex items-center gap-1">
            <User className="h-3.5 w-3.5" />@{content.creator.username}
          </span>
          <KycStatusBadge status={content.creator.kycStatus} />
          <span>Soumis {timeAgo(content.submittedForReviewAt ?? content.createdAt)}</span>
          {content.scheduledFor && (
            <span className="flex items-center gap-1">
              <CalendarClock className="h-3.5 w-3.5" />
              Programmé le {formatDateTime(content.scheduledFor)}
            </span>
          )}
          {content.publishedAt && <span>Déjà publié le {formatDateTime(content.publishedAt)} (re-vérification)</span>}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {(content.description || content.caption) && (
          <p className="whitespace-pre-line text-sm">{[content.description, content.caption].filter(Boolean).join('\n')}</p>
        )}

        {content.moderationNotes && (
          <p className="rounded-md bg-orange-50 p-2 text-sm text-orange-800 dark:bg-orange-950/30 dark:text-orange-300">
            {content.moderationNotes}
          </p>
        )}
        {content.textCheck.matches.length > 0 && (
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <span className="text-muted-foreground">Termes repérés :</span>
            {content.textCheck.matches.map((match) => (
              <Badge key={`${match.severity}-${match.term}`} variant={match.severity === 'BLOCK' ? 'destructive' : 'secondary'}>
                {match.term}
              </Badge>
            ))}
          </div>
        )}

        {/* Media */}
        {content.files.length === 0 ? (
          <p className="text-sm text-muted-foreground">Aucun média (contenu texte)</p>
        ) : (
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            {content.files.map((file) => (
              <div key={file.id} className="overflow-hidden rounded-md border">
                {file.scanStatus === 'FLAGGED' || !file.url ? (
                  <div className="flex h-40 flex-col items-center justify-center gap-1 bg-red-50 p-2 text-center text-xs text-red-700 dark:bg-red-950/30">
                    <ShieldAlert className="h-6 w-6" />
                    Média signalé par l’analyse : non affiché, conservé comme preuve
                  </div>
                ) : file.type === 'VIDEO' ? (
                  <video src={file.url} poster={file.thumbnailUrl ?? undefined} controls preload="metadata" className="h-40 w-full bg-black object-contain" />
                ) : file.type === 'IMAGE' ? (
                  <a href={file.url} target="_blank" rel="noopener noreferrer">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={file.url} alt="" className="h-40 w-full bg-muted object-contain" />
                  </a>
                ) : file.type === 'AUDIO' ? (
                  <audio src={file.url} controls className="w-full p-2" />
                ) : (
                  <a href={file.url} target="_blank" rel="noopener noreferrer" className="flex h-40 items-center justify-center gap-1 text-sm text-primary">
                    <FileText className="h-4 w-4" /> Ouvrir le fichier
                  </a>
                )}
                <div className="px-2 py-1 text-xs text-muted-foreground">{SCAN_STATUS_LABELS[file.scanStatus]}</div>
              </div>
            ))}
          </div>
        )}

        {/* People */}
        <div className="space-y-1 text-sm">
          <p className="flex items-center gap-1.5 font-medium">
            <Users className="h-4 w-4" />
            {content.soloContent ? 'Déclaré : seulement le créateur' : 'Déclaré : avec d’autres personnes'}
          </p>
          {content.coPerformers.length > 0 && (
            <ul className="space-y-1 pl-6">
              {content.coPerformers.map((cp) => (
                <li key={cp.id} className="flex flex-wrap items-center gap-2">
                  <span>
                    {cp.legalFirstName} {cp.legalLastName}
                    {cp.stageName ? ` (« ${cp.stageName} »)` : ''} · {ageFrom(cp.dateOfBirth)} ans
                  </span>
                  <Badge variant={STATUS_VARIANT[cp.status]}>{CO_PERFORMER_STATUS_LABELS[cp.status]}</Badge>
                  {cp.deletedAt && <Badge variant="destructive">Retiré(e)</Badge>}
                  {cp.status !== 'VERIFIED' && (
                    <Link href={`/admin/moderation/co-performers?id=${cp.id}`} className="text-xs text-primary hover:underline">
                      Vérifier
                    </Link>
                  )}
                </li>
              ))}
            </ul>
          )}
          <p className="text-xs text-muted-foreground">
            Vérifiez que seules ces personnes apparaissent et qu’elles sont visiblement majeures.
          </p>
        </div>

        {blocked && (
          <p className="flex items-center gap-2 text-sm text-red-600">
            <AlertTriangle className="h-4 w-4" />
            {flagged
              ? 'Média signalé : approbation impossible. Signalement PHAROS et conservation des preuves requis.'
              : creatorUnverified
                ? 'Identité du créateur non vérifiée : approbation impossible.'
                : 'Co-participants manquants ou non vérifiés : approbation impossible.'}
          </p>
        )}

        <div className="flex flex-wrap gap-2">
          <Button onClick={() => onDecide({ content, kind: 'approve' })} disabled={blocked}>
            <CheckCircle2 className="mr-2 h-4 w-4" />
            {content.scheduledFor && new Date(content.scheduledFor) > new Date() ? 'Approuver (reste programmé)' : 'Approuver et publier'}
          </Button>
          <Button variant="destructive" onClick={() => onDecide({ content, kind: 'reject' })}>
            <XCircle className="mr-2 h-4 w-4" />
            Refuser
          </Button>
          {pendingScan && (
            <Button variant="outline" onClick={onRescan} disabled={rescanning}>
              <RefreshCw className={`mr-2 h-4 w-4 ${rescanning ? 'animate-spin' : ''}`} />
              Relancer l’analyse
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  )
}

/** Lives in progress: monitored in real time, moderators can cut them */
function LiveMonitor() {
  const queryClient = useQueryClient()
  const [target, setTarget] = useState<{ id: string; title: string } | null>(null)
  const [reason, setReason] = useState('')

  const { data: lives = [], isLoading } = useQuery({
    queryKey: ['admin-live-monitor'],
    queryFn: async () => {
      const response = await liveApi.getLiveStreams()
      return (Array.isArray(response.data) ? response.data : []) as any[]
    },
    refetchInterval: 30_000,
  })

  const endLive = useMutation({
    mutationFn: () => contentReviewApi.endLive(target!.id, reason.trim() || undefined),
    onSuccess: () => {
      toast({ title: 'Live interrompu' })
      setTarget(null)
      setReason('')
      queryClient.invalidateQueries({ queryKey: ['admin-live-monitor'] })
    },
    onError: (err) => toast({ title: 'Action impossible', description: getErrorMessage(err), variant: 'destructive' }),
  })

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-lg">
          <Radio className="h-5 w-5 text-red-500" />
          Lives en cours
        </CardTitle>
        <CardDescription>
          Les lives ne peuvent pas être validés à l’avance : surveillez-les en direct et coupez tout live non conforme.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <LoadingState />
        ) : lives.length === 0 ? (
          <EmptyState>Aucun live en cours</EmptyState>
        ) : (
          <ul className="divide-y">
            {lives.map((live) => (
              <li key={live.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                <span className="min-w-0">
                  <span className="block truncate font-medium">{live.title}</span>
                  <span className="block text-xs text-muted-foreground">
                    @{live.creator?.username} · {live.viewerCount ?? 0} spectateur(s) · depuis {timeAgo(live.startedAt)}
                  </span>
                </span>
                <span className="flex gap-2">
                  <Button asChild variant="outline" size="sm">
                    <Link href={`/live/${live.id}`} target="_blank">
                      Regarder
                    </Link>
                  </Button>
                  <Button variant="destructive" size="sm" onClick={() => setTarget({ id: live.id, title: live.title })}>
                    <StopCircle className="mr-1 h-4 w-4" />
                    Couper
                  </Button>
                </span>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
      <ReasonDialog
        open={!!target}
        onOpenChange={(open) => !open && setTarget(null)}
        title={`Couper le live « ${target?.title ?? ''} »`}
        description="Le live est arrêté immédiatement pour tous les spectateurs. Le motif est envoyé au créateur."
        confirmLabel="Couper le live"
        destructive
        reason={reason}
        onReasonChange={setReason}
        reasonRequired={false}
        isPending={endLive.isPending}
        onConfirm={() => endLive.mutate()}
      />
    </Card>
  )
}

function ContentReviewQueue() {
  const searchParams = useSearchParams()
  const highlightedId = searchParams.get('content')
  const queryClient = useQueryClient()
  const [page, setPage] = useState(1)
  const [decision, setDecision] = useState<Decision>(null)
  const [reason, setReason] = useState('')
  const [rescanningId, setRescanningId] = useState<string | null>(null)

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['content-review-queue', page],
    queryFn: async () => (await contentReviewApi.queue({ page, limit: PAGE_SIZE })).data,
    refetchInterval: 60_000,
    // Signed media URLs expire after 15 minutes
    staleTime: 5 * 60_000,
  })

  const decide = useMutation({
    mutationFn: () =>
      decision!.kind === 'approve'
        ? contentReviewApi.approve(decision!.content.id, reason.trim() || undefined)
        : contentReviewApi.reject(decision!.content.id, reason.trim()),
    onSuccess: () => {
      toast({ title: decision!.kind === 'approve' ? 'Contenu validé' : 'Contenu refusé' })
      setDecision(null)
      setReason('')
      queryClient.invalidateQueries({ queryKey: ['content-review-queue'] })
    },
    onError: (err) => toast({ title: 'Décision impossible', description: getErrorMessage(err), variant: 'destructive' }),
  })

  const rescan = useMutation({
    mutationFn: (id: string) => {
      setRescanningId(id)
      return contentReviewApi.rescan(id)
    },
    onSuccess: () => {
      toast({ title: 'Analyse relancée' })
      queryClient.invalidateQueries({ queryKey: ['content-review-queue'] })
    },
    onError: (err) => toast({ title: 'Analyse impossible', description: getErrorMessage(err), variant: 'destructive' }),
    onSettled: () => setRescanningId(null),
  })

  return (
    <div className="space-y-6">
      <div>
        <h1 className="flex items-center gap-2 text-3xl font-bold">
          <ClipboardCheck className="h-7 w-7" />
          Validation des contenus
        </h1>
        <p className="mt-1 text-muted-foreground">
          Chaque contenu est vérifié avant sa mise en ligne : personnes présentes majeures et déclarées, aucun contenu
          interdit (mineurs, absence de consentement, inceste, zoophilie, prostitution...).
        </p>
      </div>

      <LiveMonitor />

      {isLoading ? (
        <LoadingState />
      ) : error ? (
        <ErrorState error={error} onRetry={() => refetch()} />
      ) : !data?.items.length ? (
        <Card>
          <CardContent>
            <EmptyState>Aucun contenu en attente de validation</EmptyState>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-4">
          <p className="text-sm text-muted-foreground">{data.total} contenu(s) en attente, les plus anciens d’abord</p>
          {data.items.map((content) => (
            <ReviewItem
              key={content.id}
              content={content}
              highlighted={content.id === highlightedId}
              onDecide={(next) => {
                setReason('')
                setDecision(next)
              }}
              onRescan={() => rescan.mutate(content.id)}
              rescanning={rescanningId === content.id}
            />
          ))}
          {data.totalPages > 1 && (
            <div className="flex items-center justify-between">
              <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage(page - 1)}>
                Précédent
              </Button>
              <span className="text-sm text-muted-foreground">
                Page {page} / {data.totalPages}
              </span>
              <Button variant="outline" size="sm" disabled={page >= data.totalPages} onClick={() => setPage(page + 1)}>
                Suivant
              </Button>
            </div>
          )}
        </div>
      )}

      <ReasonDialog
        open={!!decision}
        onOpenChange={(open) => !open && setDecision(null)}
        title={decision?.kind === 'approve' ? 'Valider ce contenu' : 'Refuser ce contenu'}
        description={
          decision?.kind === 'approve'
            ? 'Le contenu sera publié (ou restera programmé à sa date) et le créateur notifié.'
            : 'Le motif est envoyé au créateur, qui pourra corriger et renvoyer son contenu.'
        }
        confirmLabel={decision?.kind === 'approve' ? 'Valider' : 'Refuser'}
        destructive={decision?.kind === 'reject'}
        reason={reason}
        onReasonChange={setReason}
        reasonRequired={decision?.kind === 'reject'}
        reasonLabel={decision?.kind === 'approve' ? 'Note interne' : 'Motif du refus'}
        isPending={decide.isPending}
        onConfirm={() => decide.mutate()}
      />
    </div>
  )
}

export default function AdminContentReviewPage() {
  return (
    <Suspense fallback={<LoadingState />}>
      <ContentReviewQueue />
    </Suspense>
  )
}
