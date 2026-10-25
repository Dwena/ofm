'use client'

import { Suspense, useEffect, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { AlertTriangle, CheckCircle2, Users, XCircle } from 'lucide-react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { toast } from '@/hooks/use-toast'
import {
  EmptyState,
  ErrorState,
  KycStatusBadge,
  LoadingState,
  PaginationControls,
  ReasonDialog,
  getErrorMessage,
  timeAgo,
} from '@/components/admin/admin-shared'
import { IdentityDocumentsViewer } from '@/components/admin/identity-documents-viewer'
import {
  CO_PERFORMER_STATUS_LABELS,
  CoPerformerStatus,
  STATUS_VARIANT,
  ageFrom,
  coPerformerName,
  formatBirthDate,
  verificationAdminApi,
} from '@/lib/verification'

function CoPerformerDetail({ id, onDone }: { id: string; onDone: () => void }) {
  const queryClient = useQueryClient()
  const [rejectOpen, setRejectOpen] = useState(false)
  const [reason, setReason] = useState('')

  // Each load is audit-logged by the API (identity documents viewed)
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['admin-co-performer', id],
    queryFn: async () => (await verificationAdminApi.getCoPerformer(id)).data,
    staleTime: 4 * 60_000,
    refetchOnWindowFocus: false,
  })

  const decide = useMutation({
    mutationFn: (decision: 'APPROVE' | 'REJECT') =>
      verificationAdminApi.reviewCoPerformer(id, { decision, reason: decision === 'REJECT' ? reason.trim() : undefined }),
    onSuccess: (_res, decision) => {
      toast({ title: decision === 'APPROVE' ? 'Co-participant vérifié' : 'Co-participant refusé' })
      setRejectOpen(false)
      setReason('')
      queryClient.invalidateQueries({ queryKey: ['admin-co-performers'] })
      queryClient.invalidateQueries({ queryKey: ['admin-co-performer', id] })
      onDone()
    },
    onError: (err) => toast({ title: 'Décision impossible', description: getErrorMessage(err), variant: 'destructive' }),
  })

  if (isLoading) return <LoadingState />
  if (error || !data) return <ErrorState error={error} onRetry={() => refetch()} />

  const { coPerformer } = data
  const age = ageFrom(coPerformer.dateOfBirth)
  const minor = age !== null && age < 18
  const hasRelease = data.documents.some((doc) => doc.type === 'RELEASE_FORM')

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-lg font-semibold">
          {coPerformer.legalFirstName} {coPerformer.legalLastName}
        </span>
        {coPerformer.stageName && <span className="text-muted-foreground">« {coPerformer.stageName} »</span>}
        <Badge variant={STATUS_VARIANT[coPerformer.status]}>{CO_PERFORMER_STATUS_LABELS[coPerformer.status]}</Badge>
      </div>
      <dl className="grid gap-2 text-sm sm:grid-cols-2">
        <div>
          <dt className="text-muted-foreground">Date de naissance</dt>
          <dd className={minor ? 'font-semibold text-red-600' : ''}>
            {formatBirthDate(coPerformer.dateOfBirth)} ({age} ans)
          </dd>
        </div>
        <div>
          <dt className="text-muted-foreground">Autorisation signée le</dt>
          <dd>{formatBirthDate(coPerformer.consentSignedAt)}</dd>
        </div>
        <div>
          <dt className="text-muted-foreground">Déclaré(e) par</dt>
          <dd className="flex items-center gap-2">
            @{coPerformer.creator.username} <KycStatusBadge status={coPerformer.creator.kycStatus} />
          </dd>
        </div>
        <div>
          <dt className="text-muted-foreground">E-mail</dt>
          <dd>{coPerformer.email || '—'}</dd>
        </div>
      </dl>

      <div className="rounded-md bg-muted/50 p-3 text-xs text-muted-foreground">
        À vérifier : pièce officielle lisible au nom indiqué, majorité (18 ans révolus), autorisation de tournage et de
        diffusion datée et signée par cette personne, mentionnant FanVIP.
      </div>

      <IdentityDocumentsViewer documents={data.documents} expiresInSeconds={data.urlExpiresInSeconds} />

      {!hasRelease && (
        <p className="flex items-center gap-2 text-sm text-red-600">
          <AlertTriangle className="h-4 w-4" />
          Aucune autorisation signée au dossier.
        </p>
      )}
      {minor && (
        <p className="flex items-center gap-2 text-sm font-medium text-red-600">
          <AlertTriangle className="h-4 w-4" />
          Personne mineure : refus obligatoire.
        </p>
      )}

      {coPerformer.status === 'PENDING' && (
        <div className="flex flex-wrap gap-2">
          <Button onClick={() => decide.mutate('APPROVE')} disabled={decide.isPending || minor || !hasRelease}>
            <CheckCircle2 className="mr-2 h-4 w-4" />
            Approuver
          </Button>
          <Button variant="destructive" onClick={() => setRejectOpen(true)} disabled={decide.isPending}>
            <XCircle className="mr-2 h-4 w-4" />
            Refuser
          </Button>
        </div>
      )}

      <ReasonDialog
        open={rejectOpen}
        onOpenChange={setRejectOpen}
        title="Refuser ce co-participant"
        description="Le motif est envoyé au créateur, qui pourra corriger la déclaration."
        confirmLabel="Refuser"
        destructive
        reason={reason}
        onReasonChange={setReason}
        isPending={decide.isPending}
        onConfirm={() => decide.mutate('REJECT')}
        reasonPlaceholder="Ex. : autorisation non signée, pièce illisible, nom différent..."
      />
    </div>
  )
}

function CoPerformersReviewPage() {
  const searchParams = useSearchParams()
  const [status, setStatus] = useState<CoPerformerStatus>('PENDING')
  const [page, setPage] = useState(1)
  const [selected, setSelected] = useState<string | null>(searchParams.get('id'))

  useEffect(() => setPage(1), [status])

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['admin-co-performers', status, page],
    queryFn: async () => (await verificationAdminApi.listCoPerformers({ status, page, limit: 20 })).data,
  })

  return (
    <div className="space-y-6">
      <div>
        <h1 className="flex items-center gap-2 text-3xl font-bold">
          <Users className="h-7 w-7" />
          Co-participants
        </h1>
        <p className="mt-1 text-muted-foreground">
          Personnes apparaissant dans les contenus des créateurs : identité, majorité et autorisation signée.
        </p>
      </div>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)]">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0">
            <CardTitle className="text-lg">Déclarations</CardTitle>
            <Select value={status} onValueChange={(value) => setStatus(value as CoPerformerStatus)}>
              <SelectTrigger className="w-40">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="PENDING">À vérifier</SelectItem>
                <SelectItem value="VERIFIED">Vérifiés</SelectItem>
                <SelectItem value="REJECTED">Refusés</SelectItem>
              </SelectContent>
            </Select>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <LoadingState />
            ) : error ? (
              <ErrorState error={error} onRetry={() => refetch()} />
            ) : !data?.items.length ? (
              <EmptyState>Aucune déclaration</EmptyState>
            ) : (
              <ul className="divide-y">
                {data.items.map((item) => (
                  <li key={item.id}>
                    <button
                      type="button"
                      onClick={() => setSelected(item.id)}
                      className={`flex w-full items-center justify-between gap-2 px-2 py-3 text-left hover:bg-accent ${
                        selected === item.id ? 'bg-accent' : ''
                      }`}
                    >
                      <span className="min-w-0">
                        <span className="block truncate font-medium">{coPerformerName(item)}</span>
                        <span className="block text-xs text-muted-foreground">
                          par @{item.creator.username} · {item.documentCount} document(s) · {timeAgo(item.createdAt)}
                        </span>
                      </span>
                      {item.isAdult === false && <AlertTriangle className="h-4 w-4 text-red-600" aria-label="Mineur" />}
                    </button>
                  </li>
                ))}
              </ul>
            )}
            <PaginationControls pagination={data?.pagination} onPageChange={setPage} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Dossier</CardTitle>
            <CardDescription>Sélectionnez une déclaration pour afficher les documents</CardDescription>
          </CardHeader>
          <CardContent>
            {selected ? (
              <CoPerformerDetail key={selected} id={selected} onDone={() => refetch()} />
            ) : (
              <EmptyState>Aucun dossier sélectionné</EmptyState>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  )
}

export default function AdminCoPerformersPage() {
  return (
    <Suspense fallback={<LoadingState />}>
      <CoPerformersReviewPage />
    </Suspense>
  )
}
