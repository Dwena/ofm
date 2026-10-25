'use client'

import { Suspense, useEffect, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { AlertTriangle, CheckCircle2, ShieldCheck, XCircle } from 'lucide-react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { toast } from '@/hooks/use-toast'
import {
  EmptyState,
  ErrorState,
  KYC_REVIEWABLE_STATUSES,
  KycStatusBadge,
  LoadingState,
  PaginationControls,
  ReasonDialog,
  UserStatusBadge,
  getErrorMessage,
  timeAgo,
} from '@/components/admin/admin-shared'
import { IdentityDocumentsViewer } from '@/components/admin/identity-documents-viewer'
import { KycStatus, ageFrom, formatBirthDate, verificationAdminApi } from '@/lib/verification'

const STATUS_FILTERS: { value: 'WAITING' | KycStatus; label: string }[] = [
  { value: 'WAITING', label: 'À vérifier' },
  { value: 'RESUBMIT_REQUIRED', label: 'À renvoyer' },
  { value: 'REJECTED', label: 'Refusés' },
  { value: 'VERIFIED', label: 'Vérifiés' },
]

function KycDetail({ userId, onDone }: { userId: string; onDone: () => void }) {
  const queryClient = useQueryClient()
  const [rejectOpen, setRejectOpen] = useState(false)
  const [reason, setReason] = useState('')

  // Each load is audit-logged by the API (identity documents viewed)
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['admin-kyc', userId],
    queryFn: async () => (await verificationAdminApi.getKyc(userId)).data,
    staleTime: 4 * 60_000,
    refetchOnWindowFocus: false,
  })

  const decide = useMutation({
    mutationFn: (decision: 'APPROVE' | 'REJECT') =>
      verificationAdminApi.reviewKyc(userId, { decision, reason: decision === 'REJECT' ? reason.trim() : undefined }),
    onSuccess: (_res, decision) => {
      toast({ title: decision === 'APPROVE' ? 'Identité vérifiée' : 'Vérification refusée' })
      setRejectOpen(false)
      setReason('')
      queryClient.invalidateQueries({ queryKey: ['admin-kyc-queue'] })
      queryClient.invalidateQueries({ queryKey: ['admin-kyc', userId] })
      onDone()
    },
    onError: (err) => toast({ title: 'Décision impossible', description: getErrorMessage(err), variant: 'destructive' }),
  })

  if (isLoading) return <LoadingState />
  if (error || !data) return <ErrorState error={error} onRetry={() => refetch()} />

  const { user } = data
  const age = ageFrom(user.dateOfBirth)
  const reviewable = KYC_REVIEWABLE_STATUSES.includes(user.kycStatus)

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-lg font-semibold">@{user.username}</span>
        {user.displayName && <span className="text-muted-foreground">{user.displayName}</span>}
        <KycStatusBadge status={user.kycStatus} />
        <UserStatusBadge status={user.status} />
      </div>
      <dl className="grid gap-2 text-sm sm:grid-cols-2">
        <div>
          <dt className="text-muted-foreground">E-mail</dt>
          <dd>{user.email}</dd>
        </div>
        <div>
          <dt className="text-muted-foreground">Date de naissance déclarée</dt>
          <dd className={age !== null && age < 18 ? 'font-semibold text-red-600' : ''}>
            {user.dateOfBirth ? `${formatBirthDate(user.dateOfBirth)} (${age} ans)` : '—'}
          </dd>
        </div>
        <div>
          <dt className="text-muted-foreground">Envoyé</dt>
          <dd>{timeAgo(user.kycSubmittedAt)}</dd>
        </div>
        {user.kycRejectionReason && (
          <div>
            <dt className="text-muted-foreground">Dernier motif de refus</dt>
            <dd>{user.kycRejectionReason}</dd>
          </div>
        )}
      </dl>

      <div className="rounded-md bg-muted/50 p-3 text-xs text-muted-foreground">
        À vérifier : pièce officielle en cours de validité et lisible, même personne sur la pièce et le selfie, date de
        naissance identique à celle déclarée, majorité (18 ans révolus), absence de retouche.
      </div>

      <IdentityDocumentsViewer documents={data.documents} expiresInSeconds={data.urlExpiresInSeconds} />

      {reviewable && (
        <div className="flex flex-wrap gap-2">
          <Button onClick={() => decide.mutate('APPROVE')} disabled={decide.isPending || (age !== null && age < 18)}>
            <CheckCircle2 className="mr-2 h-4 w-4" />
            Approuver
          </Button>
          <Button variant="destructive" onClick={() => setRejectOpen(true)} disabled={decide.isPending}>
            <XCircle className="mr-2 h-4 w-4" />
            Refuser
          </Button>
        </div>
      )}
      {age !== null && age < 18 && (
        <p className="flex items-center gap-2 text-sm font-medium text-red-600">
          <AlertTriangle className="h-4 w-4" />
          Personne mineure : refus obligatoire.
        </p>
      )}

      <ReasonDialog
        open={rejectOpen}
        onOpenChange={setRejectOpen}
        title="Refuser la vérification"
        description="Le motif est envoyé au créateur, qui pourra renvoyer des documents."
        confirmLabel="Refuser"
        destructive
        reason={reason}
        onReasonChange={setReason}
        isPending={decide.isPending}
        onConfirm={() => decide.mutate('REJECT')}
        reasonPlaceholder="Ex. : document illisible, selfie sans la pièce, document expiré..."
      />
    </div>
  )
}

function KycReviewPage() {
  const searchParams = useSearchParams()
  const [filter, setFilter] = useState<'WAITING' | KycStatus>('WAITING')
  const [page, setPage] = useState(1)
  const [selected, setSelected] = useState<string | null>(searchParams.get('user'))

  useEffect(() => setPage(1), [filter])

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['admin-kyc-queue', filter, page],
    queryFn: async () =>
      (await verificationAdminApi.listKyc({ status: filter === 'WAITING' ? undefined : filter, page, limit: 20 })).data,
  })

  return (
    <div className="space-y-6">
      <div>
        <h1 className="flex items-center gap-2 text-3xl font-bold">
          <ShieldCheck className="h-7 w-7" />
          Vérification d’identité des créateurs
        </h1>
        <p className="mt-1 text-muted-foreground">
          Aucun créateur ne peut publier ni vendre avant la vérification de son identité et de sa majorité.
        </p>
      </div>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)]">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0">
            <CardTitle className="text-lg">Demandes</CardTitle>
            <Select value={filter} onValueChange={(value) => setFilter(value as typeof filter)}>
              <SelectTrigger className="w-40">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {STATUS_FILTERS.map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <LoadingState />
            ) : error ? (
              <ErrorState error={error} onRetry={() => refetch()} />
            ) : !data?.items.length ? (
              <EmptyState>Aucune demande</EmptyState>
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
                        <span className="block truncate font-medium">@{item.username}</span>
                        <span className="block text-xs text-muted-foreground">
                          {item.documentCount} document(s) · {timeAgo(item.kycSubmittedAt)}
                        </span>
                      </span>
                      <span className="flex items-center gap-2">
                        {item.isAdult === false && <AlertTriangle className="h-4 w-4 text-red-600" aria-label="Mineur" />}
                        <KycStatusBadge status={item.kycStatus} />
                      </span>
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
            <CardDescription>Sélectionnez une demande pour afficher les documents</CardDescription>
          </CardHeader>
          <CardContent>
            {selected ? (
              <KycDetail key={selected} userId={selected} onDone={() => refetch()} />
            ) : (
              <EmptyState>Aucun dossier sélectionné</EmptyState>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  )
}

export default function AdminKycPage() {
  return (
    <Suspense fallback={<LoadingState />}>
      <KycReviewPage />
    </Suspense>
  )
}
