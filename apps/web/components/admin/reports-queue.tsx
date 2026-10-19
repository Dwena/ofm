'use client'

import { useState } from 'react'
import { useMutation, useQuery, useQueryClient, keepPreviousData } from '@tanstack/react-query'
import { adminApi } from '@/lib/api'
import { useToast } from '@/hooks/use-toast'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import {
  EmptyState,
  LoadingState,
  Paginated,
  PaginationControls,
  ReasonDialog,
  ReportStatusBadge,
  getErrorMessage,
  timeAgo,
} from '@/components/admin/admin-shared'
import { CheckCircle, Eye, XCircle } from 'lucide-react'

type ReportStatus = 'PENDING' | 'REVIEWING' | 'RESOLVED' | 'REJECTED'
type UserAction = 'WARN' | 'SUSPEND' | 'BAN'

interface ReportUser {
  id: string
  username: string
  displayName?: string | null
  avatar?: string | null
}

interface AdminReport {
  id: string
  reportedType: 'USER' | 'CONTENT' | 'COMMENT' | 'MESSAGE' | string
  reportedId: string
  reason: string
  description?: string | null
  status: ReportStatus
  resolution?: string | null
  reviewedAt?: string | null
  createdAt: string
  reporter: ReportUser
  reportedUser: ReportUser | null
  reportedEntity: any
}

const typeLabels: Record<string, string> = {
  USER: 'Utilisateur',
  CONTENT: 'Contenu',
  COMMENT: 'Commentaire',
  MESSAGE: 'Message',
}

const reasonLabels: Record<string, string> = {
  SPAM: 'Spam',
  HARASSMENT: 'Harcèlement',
  HATE_SPEECH: 'Discours haineux',
  NUDITY: 'Nudité',
  VIOLENCE: 'Violence',
  FAKE_NEWS: 'Fausse information',
  COPYRIGHT: 'Droits d\'auteur',
  UNDERAGE: 'Mineur',
  ILLEGAL_CONTENT: 'Contenu illégal',
  OTHER: 'Autre',
}

function describeEntity(report: AdminReport) {
  const entity = report.reportedEntity
  if (!entity) return 'Élément introuvable (supprimé ?)'
  switch (report.reportedType) {
    case 'CONTENT':
      return `${entity.type ?? 'Contenu'} : ${entity.title || 'Sans titre'}${entity.deletedAt ? ' (retiré)' : ''}`
    case 'COMMENT':
      return `« ${String(entity.text ?? '').slice(0, 140)} »`
    case 'MESSAGE':
      return `« ${String(entity.content ?? '').slice(0, 140)} »`
    default:
      return `@${entity.username}`
  }
}

/**
 * Report queue shared by /admin/reports and the « Signalements » tab of /admin/moderation.
 * Uses the admin API only (uppercase statuses PENDING | REVIEWING | RESOLVED | REJECTED).
 */
export function ReportsQueue({ initialStatus = 'PENDING' }: { initialStatus?: string }) {
  const [status, setStatus] = useState<string>(initialStatus)
  const [type, setType] = useState<string>('all')
  const [page, setPage] = useState(1)

  const [selected, setSelected] = useState<AdminReport | null>(null)
  const [decision, setDecision] = useState<ReportStatus>('RESOLVED')
  const [notes, setNotes] = useState('')
  const [userAction, setUserAction] = useState<'none' | UserAction>('none')
  const [durationDays, setDurationDays] = useState('7')
  const [removeContent, setRemoveContent] = useState(false)

  const { toast } = useToast()
  const queryClient = useQueryClient()

  const { data, isLoading } = useQuery({
    queryKey: ['admin-reports', status, type, page],
    queryFn: async () => {
      const response = await adminApi.getReports({
        status: status !== 'all' ? status : undefined,
        type: type !== 'all' ? type : undefined,
        page,
        limit: 20,
      })
      return response.data as Paginated<AdminReport>
    },
    placeholderData: keepPreviousData,
    refetchInterval: 30000,
  })

  const handleMutation = useMutation({
    mutationFn: () =>
      adminApi.handleReport({
        reportId: selected!.id,
        status: decision,
        adminNotes: notes || undefined,
        action: decision === 'RESOLVED' && userAction !== 'none' ? userAction : undefined,
        durationDays:
          decision === 'RESOLVED' && userAction === 'SUSPEND' ? Number(durationDays) : undefined,
        removeContent: decision === 'RESOLVED' && selected?.reportedType === 'CONTENT' ? removeContent : undefined,
      }),
    onSuccess: () => {
      toast({ title: 'Signalement traité' })
      queryClient.invalidateQueries({ queryKey: ['admin-reports'] })
      queryClient.invalidateQueries({ queryKey: ['admin-pending-reports'] })
      queryClient.invalidateQueries({ queryKey: ['admin-stats'] })
      queryClient.invalidateQueries({ queryKey: ['admin-content'] })
      queryClient.invalidateQueries({ queryKey: ['moderation-stats'] })
      queryClient.invalidateQueries({ queryKey: ['moderation-statistics'] })
      setSelected(null)
    },
    onError: (error) => {
      toast({ title: 'Erreur', description: getErrorMessage(error), variant: 'destructive' })
    },
  })

  const openHandle = (report: AdminReport, nextDecision: ReportStatus) => {
    setSelected(report)
    setDecision(nextDecision)
    setNotes('')
    setUserAction('none')
    setDurationDays('7')
    setRemoveContent(report.reportedType === 'CONTENT')
  }

  const reports = data?.items ?? []

  return (
    <>
      <Card data-testid="reports-queue">
        <CardHeader>
          <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
            <div>
              <CardTitle>File d&apos;attente</CardTitle>
              <CardDescription>{data?.pagination.total ?? 0} signalement(s)</CardDescription>
            </div>
            <div className="flex flex-col gap-2 sm:flex-row">
              <Select value={status} onValueChange={(v) => { setStatus(v); setPage(1) }}>
                <SelectTrigger className="sm:w-44">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Tous les statuts</SelectItem>
                  <SelectItem value="PENDING">En attente</SelectItem>
                  <SelectItem value="REVIEWING">En examen</SelectItem>
                  <SelectItem value="RESOLVED">Résolus</SelectItem>
                  <SelectItem value="REJECTED">Rejetés</SelectItem>
                </SelectContent>
              </Select>
              <Select value={type} onValueChange={(v) => { setType(v); setPage(1) }}>
                <SelectTrigger className="sm:w-44">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Tous les types</SelectItem>
                  <SelectItem value="USER">Utilisateurs</SelectItem>
                  <SelectItem value="CONTENT">Contenus</SelectItem>
                  <SelectItem value="COMMENT">Commentaires</SelectItem>
                  <SelectItem value="MESSAGE">Messages</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <LoadingState />
          ) : reports.length === 0 ? (
            <EmptyState>Aucun signalement à afficher</EmptyState>
          ) : (
            <div className="space-y-3">
              {reports.map((report) => {
                const open = report.status === 'PENDING' || report.status === 'REVIEWING'
                return (
                  <div
                    key={report.id}
                    data-testid="report-item"
                    className={`rounded-lg border border-l-4 p-4 ${open ? 'border-l-orange-500' : 'border-l-muted'}`}
                  >
                    <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                      <div className="flex items-start gap-3 min-w-0">
                        <Avatar className="h-10 w-10">
                          <AvatarImage src={report.reportedUser?.avatar || undefined} />
                          <AvatarFallback>
                            {(report.reportedUser?.username || '??').substring(0, 2).toUpperCase()}
                          </AvatarFallback>
                        </Avatar>
                        <div className="min-w-0 space-y-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="font-medium">
                              {report.reportedUser ? `@${report.reportedUser.username}` : 'Utilisateur inconnu'}
                            </span>
                            <Badge variant="outline">{typeLabels[report.reportedType] || report.reportedType}</Badge>
                            <Badge variant="secondary">{reasonLabels[report.reason] || report.reason}</Badge>
                            <ReportStatusBadge status={report.status} />
                          </div>
                          <p className="text-sm break-words">{describeEntity(report)}</p>
                          {report.description && (
                            <p className="text-sm text-muted-foreground break-words">{report.description}</p>
                          )}
                          <p className="text-xs text-muted-foreground">
                            Signalé par @{report.reporter?.username} • {timeAgo(report.createdAt)}
                          </p>
                          {report.resolution && (
                            <p className="text-xs text-muted-foreground">
                              Décision : {report.resolution}
                              {report.reviewedAt && ` (${timeAgo(report.reviewedAt)})`}
                            </p>
                          )}
                        </div>
                      </div>
                      {open && (
                        <div className="flex flex-shrink-0 flex-wrap gap-2">
                          <Button size="sm" onClick={() => openHandle(report, 'RESOLVED')}>
                            <CheckCircle className="h-4 w-4 mr-1" />
                            Résoudre
                          </Button>
                          <Button size="sm" variant="outline" onClick={() => openHandle(report, 'REJECTED')}>
                            <XCircle className="h-4 w-4 mr-1" />
                            Rejeter
                          </Button>
                          {report.status === 'PENDING' && (
                            <Button size="sm" variant="secondary" onClick={() => openHandle(report, 'REVIEWING')}>
                              <Eye className="h-4 w-4 mr-1" />
                              En examen
                            </Button>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
          )}
          <PaginationControls pagination={data?.pagination} onPageChange={setPage} />
        </CardContent>
      </Card>

      {selected && (
        <ReasonDialog
          open={!!selected}
          onOpenChange={(open) => !open && setSelected(null)}
          title={
            decision === 'RESOLVED'
              ? 'Résoudre le signalement'
              : decision === 'REJECTED'
                ? 'Rejeter le signalement'
                : 'Marquer en examen'
          }
          description={describeEntity(selected)}
          confirmLabel="Confirmer"
          destructive={decision === 'RESOLVED' && (userAction === 'BAN' || removeContent)}
          reason={notes}
          onReasonChange={setNotes}
          reasonRequired={decision !== 'REVIEWING'}
          isPending={handleMutation.isPending}
          onConfirm={() => handleMutation.mutate()}
        >
          {decision === 'RESOLVED' && (
            <div className="space-y-4">
              {selected.reportedUser && (
                <div className="space-y-2">
                  <Label>Sanction pour @{selected.reportedUser.username}</Label>
                  <Select value={userAction} onValueChange={(v) => setUserAction(v as 'none' | UserAction)}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">Aucune sanction</SelectItem>
                      <SelectItem value="WARN">Avertissement</SelectItem>
                      <SelectItem value="SUSPEND">Suspension</SelectItem>
                      <SelectItem value="BAN">Bannissement</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              )}
              {userAction === 'SUSPEND' && (
                <div className="space-y-2">
                  <Label>Durée de la suspension</Label>
                  <Select value={durationDays} onValueChange={setDurationDays}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="1">1 jour</SelectItem>
                      <SelectItem value="3">3 jours</SelectItem>
                      <SelectItem value="7">7 jours</SelectItem>
                      <SelectItem value="30">30 jours</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              )}
              {selected.reportedType === 'CONTENT' && selected.reportedEntity && !selected.reportedEntity.deletedAt && (
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={removeContent}
                    onChange={(e) => setRemoveContent(e.target.checked)}
                    className="h-4 w-4"
                  />
                  Retirer le contenu signalé
                </label>
              )}
            </div>
          )}
        </ReasonDialog>
      )}
    </>
  )
}
