'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { adminApi } from '@/lib/api'
import { formatEuros } from '@/lib/utils'
import { useToast } from '@/hooks/use-toast'
import { useConfirm } from '@/hooks/use-confirm'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  ACTION_LABELS,
  ContentStatusBadge,
  EmptyState,
  ErrorState,
  KYC_REVIEWABLE_STATUSES,
  KycStatusBadge,
  LoadingState,
  REPORT_REASON_LABELS,
  ReasonDialog,
  ReportStatusBadge,
  RoleBadge,
  UserStatusBadge,
  formatDateTime,
  getErrorMessage,
  timeAgo,
} from '@/components/admin/admin-shared'
import {
  AlertTriangle,
  Ban,
  BadgeCheck,
  CheckCircle,
  Clock,
  ExternalLink,
  Loader2,
  Trash2,
  XCircle,
} from 'lucide-react'

interface UserRef {
  id: string
  username: string
  displayName?: string | null
  avatar?: string | null
}

export interface UserDetails {
  user: UserRef & {
    email: string
    role: string
    status: string
    emailVerified: boolean
    createdAt: string
    lastLoginAt?: string | null
    bio?: string | null
    kycStatus?: string
    kycSubmittedAt?: string | null
    kycVerifiedAt?: string | null
    kycRejectedAt?: string | null
    kycRejectionReason?: string | null
    twoFactorEnabled?: boolean
    stripeOnboarded?: boolean
    bannedAt?: string | null
    banReason?: string | null
    suspendedUntil?: string | null
    suspensionReason?: string | null
  }
  stats: {
    contentCount: number
    subscriptionCount: number
    subscriberCount?: number
    totalTransactionAmount: number
    reportCount: number
  }
  subscriptions?: {
    id: string
    status: string
    currentPeriodEnd: string
    cancelAtPeriodEnd: boolean
    createdAt: string
    tier: { id: string; name: string; price: number; creator: UserRef } | null
  }[]
  contents?: {
    id: string
    title?: string | null
    type: string
    status: string
    isPpv: boolean
    viewCount: number
    likeCount: number
    createdAt: string
    deletedAt?: string | null
  }[]
  transactions?: {
    id: string
    type: string
    status: string
    amount: number
    platformFee: number
    netAmount: number
    direction: 'IN' | 'OUT'
    createdAt: string
    fromUser: UserRef | null
    toUser: UserRef | null
  }[]
  reports?: {
    id: string
    reportedType: string
    reason: string
    description?: string | null
    status: string
    resolution?: string | null
    createdAt: string
    reporter: UserRef | null
  }[]
  auditLogs?: {
    id: string
    action: string
    metadata: Record<string, unknown> | null
    createdAt: string
    actor: UserRef | null
  }[]
}

type UserActionType = 'SUSPEND' | 'BAN' | 'ACTIVATE' | 'WARN' | 'DELETE' | 'KYC_REJECT'

const actionConfig: Record<
  UserActionType,
  { title: string; confirm: string; destructive?: boolean; success: string; reasonRequired: boolean }
> = {
  SUSPEND: { title: 'Suspendre le compte', confirm: 'Suspendre', destructive: true, success: 'Utilisateur suspendu', reasonRequired: true },
  BAN: { title: 'Bannir le compte', confirm: 'Bannir', destructive: true, success: 'Utilisateur banni', reasonRequired: true },
  ACTIVATE: { title: 'Réactiver le compte', confirm: 'Réactiver', success: 'Utilisateur réactivé', reasonRequired: false },
  WARN: { title: "Avertir l'utilisateur", confirm: "Envoyer l'avertissement", success: 'Avertissement envoyé', reasonRequired: true },
  DELETE: { title: 'Supprimer le compte', confirm: 'Supprimer définitivement', destructive: true, success: 'Compte supprimé', reasonRequired: true },
  KYC_REJECT: { title: "Refuser la vérification d'identité", confirm: 'Refuser', destructive: true, success: 'Vérification refusée', reasonRequired: true },
}

const typeLabels: Record<string, string> = {
  PHOTO: 'Photo',
  VIDEO: 'Vidéo',
  AUDIO: 'Audio',
  TEXT: 'Texte',
  ALBUM: 'Album',
  USER: 'Compte',
  CONTENT: 'Contenu',
  COMMENT: 'Commentaire',
  MESSAGE: 'Message',
}

const transactionTypeLabels: Record<string, string> = {
  SUBSCRIPTION: 'Abonnement',
  TIP: 'Pourboire',
  PPV_UNLOCK: 'Contenu payant',
  PAYOUT: 'Versement',
  REFUND: 'Remboursement',
  PLATFORM_FEE: 'Commission',
}

const transactionStatusLabels: Record<string, string> = {
  PENDING: 'En attente',
  PROCESSING: 'En cours',
  COMPLETED: 'Réussie',
  FAILED: 'Échouée',
  CANCELLED: 'Annulée',
  REFUNDED: 'Remboursée',
  PARTIALLY_REFUNDED: 'Remb. partiel',
  DISPUTED: 'Litige',
}

const subscriptionStatusLabels: Record<string, string> = {
  ACTIVE: 'Actif',
  CANCELLED: 'Annulé',
  EXPIRED: 'Expiré',
  PAST_DUE: 'Impayé',
  PAUSED: 'En pause',
}

function summarizeMetadata(metadata: Record<string, unknown> | null) {
  if (!metadata) return ''
  const parts: string[] = []
  if (metadata.reason) parts.push(String(metadata.reason))
  if (metadata.notes) parts.push(String(metadata.notes))
  if (metadata.durationDays) parts.push(`${metadata.durationDays} jour(s)`)
  return parts.join(' • ')
}

/**
 * Back-office view of one account: details, related activity and every
 * moderation action (warn, suspend, ban, reactivate, delete, KYC review).
 */
export function UserDetailDialog({
  userId,
  onOpenChange,
}: {
  userId: string | null
  onOpenChange: (open: boolean) => void
}) {
  const [pendingAction, setPendingAction] = useState<UserActionType | null>(null)
  const [reason, setReason] = useState('')
  const [durationDays, setDurationDays] = useState('7')
  const [typedUsername, setTypedUsername] = useState('')

  const { toast } = useToast()
  const { confirm } = useConfirm()
  const queryClient = useQueryClient()

  const { data: details, isLoading, error, refetch } = useQuery({
    queryKey: ['admin-user-details', userId],
    queryFn: async () => {
      const response = await adminApi.getUserDetails(userId!)
      return response.data as UserDetails
    },
    enabled: !!userId,
  })

  const refreshAll = () => {
    queryClient.invalidateQueries({ queryKey: ['admin-users'] })
    queryClient.invalidateQueries({ queryKey: ['admin-recent-users'] })
    queryClient.invalidateQueries({ queryKey: ['admin-user-details'] })
    queryClient.invalidateQueries({ queryKey: ['admin-stats'] })
    queryClient.invalidateQueries({ queryKey: ['admin-audit-logs'] })
    queryClient.invalidateQueries({ queryKey: ['moderation-stats'] })
  }

  const actionMutation = useMutation({
    mutationFn: async ({ id, action }: { id: string; action: UserActionType }) => {
      if (action === 'DELETE') return adminApi.deleteUser(id, reason.trim())
      if (action === 'KYC_REJECT') return adminApi.reviewKyc(id, { decision: 'REJECT', reason: reason.trim() })
      return adminApi.moderateUser({
        userId: id,
        action,
        reason: reason.trim() || undefined,
        durationDays: action === 'SUSPEND' && durationDays !== 'indefinite' ? Number(durationDays) : undefined,
      })
    },
    onSuccess: (_data, { action }) => {
      toast({ title: actionConfig[action].success })
      refreshAll()
      setPendingAction(null)
      if (action === 'DELETE') onOpenChange(false)
    },
    onError: (err) => {
      toast({ title: 'Action impossible', description: getErrorMessage(err), variant: 'destructive' })
    },
  })

  const approveKycMutation = useMutation({
    mutationFn: (id: string) => adminApi.reviewKyc(id, { decision: 'APPROVE' }),
    onSuccess: () => {
      toast({ title: 'Identité vérifiée', description: 'Le créateur a été notifié.' })
      refreshAll()
    },
    onError: (err) => {
      toast({ title: 'Action impossible', description: getErrorMessage(err), variant: 'destructive' })
    },
  })

  const openAction = (action: UserActionType) => {
    setReason('')
    setDurationDays('7')
    setTypedUsername('')
    setPendingAction(action)
  }

  const approveKyc = async () => {
    if (!details) return
    const ok = await confirm({
      title: "Valider la vérification d'identité ?",
      description: `@${details.user.username} pourra percevoir ses revenus. Il sera notifié de la décision.`,
      confirmText: 'Valider',
    })
    if (ok) approveKycMutation.mutate(details.user.id)
  }

  const detailUser = details?.user
  const kycReviewable = !!detailUser?.kycStatus && KYC_REVIEWABLE_STATUSES.includes(detailUser.kycStatus)

  return (
    <>
      <Dialog open={!!userId} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Détails de l&apos;utilisateur</DialogTitle>
            <DialogDescription>Informations du compte, activité et actions de modération</DialogDescription>
          </DialogHeader>

          {isLoading ? (
            <LoadingState />
          ) : error || !details || !detailUser ? (
            <ErrorState error={error} onRetry={() => refetch()} label="Impossible de charger ce compte" />
          ) : (
            <div className="space-y-6">
              <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
                <Avatar className="h-14 w-14">
                  <AvatarImage src={detailUser.avatar || undefined} />
                  <AvatarFallback>{detailUser.username.substring(0, 2).toUpperCase()}</AvatarFallback>
                </Avatar>
                <div className="flex-1 min-w-0">
                  <p className="text-lg font-semibold truncate">{detailUser.displayName || `@${detailUser.username}`}</p>
                  <p className="text-sm text-muted-foreground truncate">
                    @{detailUser.username} • {detailUser.email}
                  </p>
                  <div className="flex flex-wrap gap-2 mt-1">
                    <RoleBadge role={detailUser.role} />
                    <UserStatusBadge status={detailUser.status} />
                  </div>
                </div>
                <Button variant="outline" size="sm" asChild>
                  <Link href={`/${detailUser.username}`} target="_blank" rel="noopener noreferrer">
                    <ExternalLink className="h-4 w-4 mr-1" />
                    Voir le profil public
                  </Link>
                </Button>
              </div>

              <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
                {[
                  {
                    label: detailUser.role === 'CREATOR' ? 'Contenus / abonnés' : 'Contenus',
                    value:
                      detailUser.role === 'CREATOR'
                        ? `${details.stats.contentCount} / ${details.stats.subscriberCount ?? 0}`
                        : details.stats.contentCount,
                  },
                  { label: 'Abonnements', value: details.stats.subscriptionCount },
                  { label: 'Transactions', value: formatEuros(details.stats.totalTransactionAmount) },
                  { label: 'Signalements reçus', value: details.stats.reportCount },
                ].map((stat) => (
                  <div key={stat.label} className="rounded-lg border p-3">
                    <p className="text-xs text-muted-foreground">{stat.label}</p>
                    <p className="text-lg font-semibold">{stat.value}</p>
                  </div>
                ))}
              </div>

              <Tabs defaultValue="overview">
                <div className="overflow-x-auto">
                  <TabsList>
                    <TabsTrigger value="overview">Compte</TabsTrigger>
                    <TabsTrigger value="subscriptions">Abonnements</TabsTrigger>
                    <TabsTrigger value="content">Contenus</TabsTrigger>
                    <TabsTrigger value="transactions">Transactions</TabsTrigger>
                    <TabsTrigger value="reports">
                      Signalements{details.stats.reportCount ? ` (${details.stats.reportCount})` : ''}
                    </TabsTrigger>
                    <TabsTrigger value="history">Historique</TabsTrigger>
                  </TabsList>
                </div>

                <TabsContent value="overview" className="space-y-4">
                  <dl className="grid grid-cols-1 gap-3 text-sm md:grid-cols-2">
                    <div><dt className="text-muted-foreground">Inscrit le</dt><dd>{formatDateTime(detailUser.createdAt)}</dd></div>
                    <div><dt className="text-muted-foreground">Dernière connexion</dt><dd>{formatDateTime(detailUser.lastLoginAt)}</dd></div>
                    <div><dt className="text-muted-foreground">Email vérifié</dt><dd>{detailUser.emailVerified ? 'Oui' : 'Non'}</dd></div>
                    <div><dt className="text-muted-foreground">Double authentification</dt><dd>{detailUser.twoFactorEnabled ? 'Activée' : 'Désactivée'}</dd></div>
                    {detailUser.role === 'CREATOR' && (
                      <div><dt className="text-muted-foreground">Paiements Stripe</dt><dd>{detailUser.stripeOnboarded ? 'Configurés' : 'Non configurés'}</dd></div>
                    )}
                    <div>
                      <dt className="text-muted-foreground">Vérification d&apos;identité (KYC)</dt>
                      <dd className="flex flex-wrap items-center gap-2">
                        <KycStatusBadge status={detailUser.kycStatus} />
                        {detailUser.kycSubmittedAt && kycReviewable && (
                          <span className="text-xs text-muted-foreground">soumis {timeAgo(detailUser.kycSubmittedAt)}</span>
                        )}
                        {detailUser.kycStatus === 'VERIFIED' && detailUser.kycVerifiedAt && (
                          <span className="text-xs text-muted-foreground">le {formatDateTime(detailUser.kycVerifiedAt)}</span>
                        )}
                      </dd>
                      {detailUser.kycStatus === 'REJECTED' && detailUser.kycRejectionReason && (
                        <dd className="text-xs text-muted-foreground mt-1">Motif : {detailUser.kycRejectionReason}</dd>
                      )}
                    </div>
                    {detailUser.bio && (
                      <div className="md:col-span-2"><dt className="text-muted-foreground">Bio</dt><dd className="break-words">{detailUser.bio}</dd></div>
                    )}
                    {detailUser.status === 'SUSPENDED' && (
                      <div className="md:col-span-2">
                        <dt className="text-muted-foreground">Suspension</dt>
                        <dd>
                          {detailUser.suspendedUntil ? `Jusqu'au ${formatDateTime(detailUser.suspendedUntil)}` : 'Durée indéterminée'}
                          {detailUser.suspensionReason && ` — ${detailUser.suspensionReason}`}
                        </dd>
                      </div>
                    )}
                    {detailUser.status === 'BANNED' && (
                      <div className="md:col-span-2">
                        <dt className="text-muted-foreground">Bannissement</dt>
                        <dd>
                          {formatDateTime(detailUser.bannedAt)}
                          {detailUser.banReason && ` — ${detailUser.banReason}`}
                        </dd>
                      </div>
                    )}
                  </dl>

                  {kycReviewable && (
                    <div className="flex flex-col gap-3 rounded-lg border border-orange-300 p-3 sm:flex-row sm:items-center sm:justify-between">
                      <p className="text-sm">
                        <BadgeCheck className="mr-1 inline h-4 w-4 text-orange-500" />
                        Une vérification d&apos;identité attend votre décision.
                      </p>
                      <div className="flex gap-2">
                        <Button size="sm" onClick={approveKyc} disabled={approveKycMutation.isPending}>
                          {approveKycMutation.isPending ? (
                            <Loader2 className="h-4 w-4 mr-1 animate-spin" />
                          ) : (
                            <CheckCircle className="h-4 w-4 mr-1" />
                          )}
                          Valider
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => openAction('KYC_REJECT')}
                          disabled={approveKycMutation.isPending}
                        >
                          <XCircle className="h-4 w-4 mr-1" />
                          Refuser
                        </Button>
                      </div>
                    </div>
                  )}
                </TabsContent>

                <TabsContent value="subscriptions">
                  {!details.subscriptions?.length ? (
                    <EmptyState>Aucun abonnement</EmptyState>
                  ) : (
                    <ul className="space-y-2">
                      {details.subscriptions.map((sub) => (
                        <li key={sub.id} className="flex flex-col gap-1 rounded-lg border p-3 text-sm sm:flex-row sm:items-center sm:justify-between">
                          <div className="min-w-0">
                            <p className="font-medium truncate">
                              {sub.tier?.creator ? (
                                <Link href={`/${sub.tier.creator.username}`} className="hover:underline" target="_blank">
                                  @{sub.tier.creator.username}
                                </Link>
                              ) : (
                                'Créateur supprimé'
                              )}{' '}
                              <span className="text-muted-foreground">• {sub.tier?.name}</span>
                            </p>
                            <p className="text-xs text-muted-foreground">
                              Depuis {formatDateTime(sub.createdAt)} • {sub.cancelAtPeriodEnd ? 'se termine' : 'renouvellement'} le{' '}
                              {formatDateTime(sub.currentPeriodEnd)}
                            </p>
                          </div>
                          <div className="flex items-center gap-2">
                            {sub.tier && <span className="tabular-nums">{formatEuros(sub.tier.price)}/mois</span>}
                            <Badge variant={sub.status === 'ACTIVE' ? 'default' : 'secondary'}>
                              {subscriptionStatusLabels[sub.status] || sub.status}
                            </Badge>
                          </div>
                        </li>
                      ))}
                    </ul>
                  )}
                </TabsContent>

                <TabsContent value="content">
                  {!details.contents?.length ? (
                    <EmptyState>Aucun contenu publié</EmptyState>
                  ) : (
                    <ul className="space-y-2">
                      {details.contents.map((content) => (
                        <li key={content.id} className="flex flex-col gap-2 rounded-lg border p-3 text-sm sm:flex-row sm:items-center sm:justify-between">
                          <div className="min-w-0">
                            <div className="flex flex-wrap items-center gap-2">
                              <Badge variant="outline">{typeLabels[content.type] || content.type}</Badge>
                              {content.isPpv && <Badge variant="secondary">PPV</Badge>}
                              {content.deletedAt ? <Badge variant="destructive">Retiré</Badge> : <ContentStatusBadge status={content.status} />}
                            </div>
                            <p className="mt-1 font-medium truncate">{content.title || 'Sans titre'}</p>
                            <p className="text-xs text-muted-foreground">
                              {content.viewCount} vues • {content.likeCount} j&apos;aime • {timeAgo(content.createdAt)}
                            </p>
                          </div>
                          {!content.deletedAt && (
                            <Button size="sm" variant="ghost" asChild>
                              <Link href={`/content/${content.id}`} target="_blank">
                                <ExternalLink className="h-4 w-4 mr-1" />
                                Ouvrir
                              </Link>
                            </Button>
                          )}
                        </li>
                      ))}
                      {details.stats.contentCount > details.contents.length && (
                        <li>
                          <Button variant="link" size="sm" asChild className="px-0">
                            <Link href={`/admin/content?filter=ALL&q=${encodeURIComponent(detailUser.username)}`}>
                              Voir tous les contenus ({details.stats.contentCount})
                            </Link>
                          </Button>
                        </li>
                      )}
                    </ul>
                  )}
                </TabsContent>

                <TabsContent value="transactions">
                  {!details.transactions?.length ? (
                    <EmptyState>Aucune transaction</EmptyState>
                  ) : (
                    <ul className="space-y-2">
                      {details.transactions.map((tx) => {
                        const counterpart = tx.direction === 'OUT' ? tx.toUser : tx.fromUser
                        return (
                          <li key={tx.id} className="flex items-center justify-between gap-3 rounded-lg border p-3 text-sm">
                            <div className="min-w-0">
                              <p className="font-medium">
                                {transactionTypeLabels[tx.type] || tx.type}{' '}
                                <span className="text-muted-foreground font-normal">
                                  {tx.direction === 'OUT' ? 'vers' : 'de'} {counterpart ? `@${counterpart.username}` : 'la plateforme'}
                                </span>
                              </p>
                              <p className="text-xs text-muted-foreground">
                                {formatDateTime(tx.createdAt)} • {transactionStatusLabels[tx.status] || tx.status}
                              </p>
                            </div>
                            <span
                              className={`tabular-nums whitespace-nowrap font-medium ${tx.direction === 'IN' ? 'text-green-600' : ''}`}
                            >
                              {tx.direction === 'IN' ? '+' : '−'}
                              {formatEuros(tx.direction === 'IN' ? tx.netAmount : tx.amount)}
                            </span>
                          </li>
                        )
                      })}
                    </ul>
                  )}
                </TabsContent>

                <TabsContent value="reports">
                  {!details.reports?.length ? (
                    <EmptyState>Aucun signalement contre ce compte</EmptyState>
                  ) : (
                    <ul className="space-y-2">
                      {details.reports.map((report) => (
                        <li key={report.id} className="rounded-lg border p-3 text-sm space-y-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <Badge variant="outline">{typeLabels[report.reportedType] || report.reportedType}</Badge>
                            <Badge variant="secondary">{REPORT_REASON_LABELS[report.reason] || report.reason}</Badge>
                            <ReportStatusBadge status={report.status} />
                          </div>
                          {report.description && <p className="break-words">{report.description}</p>}
                          <p className="text-xs text-muted-foreground">
                            Par @{report.reporter?.username ?? 'inconnu'} • {timeAgo(report.createdAt)}
                            {report.resolution && ` • Décision : ${report.resolution}`}
                          </p>
                        </li>
                      ))}
                      <li>
                        <Button variant="link" size="sm" asChild className="px-0">
                          <Link href="/admin/reports">Ouvrir la file des signalements</Link>
                        </Button>
                      </li>
                    </ul>
                  )}
                </TabsContent>

                <TabsContent value="history">
                  {!details.auditLogs?.length ? (
                    <EmptyState>Aucune action de modération sur ce compte</EmptyState>
                  ) : (
                    <ul className="space-y-2">
                      {details.auditLogs.map((log) => (
                        <li key={log.id} className="flex items-start justify-between gap-3 rounded-lg border p-3 text-sm">
                          <div className="min-w-0">
                            <p className="font-medium">{ACTION_LABELS[log.action] || log.action}</p>
                            {summarizeMetadata(log.metadata) && (
                              <p className="text-xs text-muted-foreground break-words">{summarizeMetadata(log.metadata)}</p>
                            )}
                          </div>
                          <div className="text-right text-xs text-muted-foreground whitespace-nowrap">
                            <p>{log.actor ? `@${log.actor.username}` : 'Système'}</p>
                            <p>{formatDateTime(log.createdAt)}</p>
                          </div>
                        </li>
                      ))}
                    </ul>
                  )}
                </TabsContent>
              </Tabs>

              {detailUser.role === 'ADMIN' ? (
                <p className="border-t pt-4 text-sm text-muted-foreground">
                  Les comptes administrateurs ne peuvent pas être modérés.
                </p>
              ) : (
                <div className="flex flex-wrap gap-2 border-t pt-4">
                  {detailUser.status !== 'ACTIVE' && (
                    <Button size="sm" onClick={() => openAction('ACTIVATE')}>
                      <CheckCircle className="h-4 w-4 mr-1" />
                      Réactiver
                    </Button>
                  )}
                  <Button size="sm" variant="outline" onClick={() => openAction('WARN')}>
                    <AlertTriangle className="h-4 w-4 mr-1" />
                    Avertir
                  </Button>
                  {detailUser.status !== 'SUSPENDED' && detailUser.status !== 'BANNED' && (
                    <Button size="sm" variant="secondary" onClick={() => openAction('SUSPEND')}>
                      <Clock className="h-4 w-4 mr-1" />
                      Suspendre
                    </Button>
                  )}
                  {detailUser.status !== 'BANNED' && (
                    <Button size="sm" variant="destructive" onClick={() => openAction('BAN')}>
                      <Ban className="h-4 w-4 mr-1" />
                      Bannir
                    </Button>
                  )}
                  <Button size="sm" variant="destructive" onClick={() => openAction('DELETE')}>
                    <Trash2 className="h-4 w-4 mr-1" />
                    Supprimer
                  </Button>
                </div>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>

      {pendingAction && detailUser && (
        <ReasonDialog
          open={!!pendingAction}
          onOpenChange={(open) => !open && !actionMutation.isPending && setPendingAction(null)}
          title={actionConfig[pendingAction].title}
          description={
            pendingAction === 'DELETE'
              ? `@${detailUser.username} — le compte sera désactivé, masqué de la plateforme et ne pourra plus se connecter. Cette action est irréversible depuis le back-office.`
              : pendingAction === 'KYC_REJECT'
                ? `@${detailUser.username} sera notifié du refus et du motif.`
                : pendingAction === 'ACTIVATE'
                  ? `@${detailUser.username} retrouvera l'accès à son compte.`
                  : `@${detailUser.username} sera notifié de cette décision.`
          }
          confirmLabel={actionConfig[pendingAction].confirm}
          destructive={actionConfig[pendingAction].destructive}
          reason={reason}
          onReasonChange={setReason}
          reasonLabel={pendingAction === 'KYC_REJECT' ? 'Motif du refus' : pendingAction === 'WARN' ? 'Message' : 'Raison'}
          reasonRequired={actionConfig[pendingAction].reasonRequired}
          confirmDisabled={pendingAction === 'DELETE' && typedUsername.trim() !== detailUser.username}
          isPending={actionMutation.isPending}
          onConfirm={() => actionMutation.mutate({ id: detailUser.id, action: pendingAction })}
        >
          {pendingAction === 'SUSPEND' && (
            <div className="space-y-2">
              <Label>Durée</Label>
              <Select value={durationDays} onValueChange={setDurationDays}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="1">1 jour</SelectItem>
                  <SelectItem value="3">3 jours</SelectItem>
                  <SelectItem value="7">7 jours</SelectItem>
                  <SelectItem value="30">30 jours</SelectItem>
                  <SelectItem value="90">90 jours</SelectItem>
                  <SelectItem value="indefinite">Indéterminée</SelectItem>
                </SelectContent>
              </Select>
            </div>
          )}
          {pendingAction === 'DELETE' && (
            <div className="space-y-2">
              <Label htmlFor="confirm-username">
                Pour confirmer, saisissez <span className="font-mono font-semibold">{detailUser.username}</span>
              </Label>
              <Input
                id="confirm-username"
                autoComplete="off"
                value={typedUsername}
                onChange={(e) => setTypedUsername(e.target.value)}
                placeholder={detailUser.username}
              />
            </div>
          )}
        </ReasonDialog>
      )}
    </>
  )
}
