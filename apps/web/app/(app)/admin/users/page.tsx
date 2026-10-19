'use client'

import { useState } from 'react'
import { useMutation, useQuery, useQueryClient, keepPreviousData } from '@tanstack/react-query'
import { adminApi } from '@/lib/api'
import { useDebounce } from '@/hooks/use-debounce'
import { useToast } from '@/hooks/use-toast'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  EmptyState,
  LoadingState,
  Paginated,
  PaginationControls,
  ReasonDialog,
  RoleBadge,
  UserStatusBadge,
  formatDateTime,
  getErrorMessage,
  timeAgo,
} from '@/components/admin/admin-shared'
import { AlertTriangle, Ban, CheckCircle, Clock, Search, Trash2, Users } from 'lucide-react'

interface AdminUser {
  id: string
  email: string
  username: string
  displayName?: string | null
  role: string
  status: string
  avatar?: string | null
  emailVerified: boolean
  createdAt: string
  lastLoginAt?: string | null
  creatorProfile?: { totalSubscribers: number; totalContent: number } | null
}

interface UserDetails {
  user: AdminUser & {
    bio?: string | null
    kycStatus?: string
    twoFactorEnabled?: boolean
    bannedAt?: string | null
    banReason?: string | null
    suspendedUntil?: string | null
    suspensionReason?: string | null
  }
  stats: {
    contentCount: number
    subscriptionCount: number
    totalTransactionAmount: number
    reportCount: number
  }
}

type UserActionType = 'SUSPEND' | 'BAN' | 'ACTIVATE' | 'WARN' | 'DELETE'

const actionConfig: Record<UserActionType, { title: string; confirm: string; destructive?: boolean; success: string }> = {
  SUSPEND: { title: 'Suspendre le compte', confirm: 'Suspendre', destructive: true, success: 'Utilisateur suspendu' },
  BAN: { title: 'Bannir le compte', confirm: 'Bannir', destructive: true, success: 'Utilisateur banni' },
  ACTIVATE: { title: 'Réactiver le compte', confirm: 'Réactiver', success: 'Utilisateur réactivé' },
  WARN: { title: 'Avertir l\'utilisateur', confirm: 'Envoyer l\'avertissement', success: 'Avertissement envoyé' },
  DELETE: { title: 'Supprimer le compte', confirm: 'Supprimer', destructive: true, success: 'Utilisateur supprimé' },
}

export default function AdminUsersPage() {
  const [search, setSearch] = useState('')
  const [role, setRole] = useState('all')
  const [status, setStatus] = useState('all')
  const [page, setPage] = useState(1)
  const [selectedUserId, setSelectedUserId] = useState<string | null>(null)
  const [pendingAction, setPendingAction] = useState<UserActionType | null>(null)
  const [reason, setReason] = useState('')
  const [durationDays, setDurationDays] = useState('7')

  const debouncedSearch = useDebounce(search, 400)
  const { toast } = useToast()
  const queryClient = useQueryClient()

  const { data, isLoading, isFetching } = useQuery({
    queryKey: ['admin-users', debouncedSearch, role, status, page],
    queryFn: async () => {
      const response = await adminApi.getUsers({
        query: debouncedSearch || undefined,
        role: role !== 'all' ? role : undefined,
        status: status !== 'all' ? status : undefined,
        page,
        limit: 20,
      })
      return response.data as Paginated<AdminUser>
    },
    placeholderData: keepPreviousData,
  })

  const { data: details, isLoading: detailsLoading } = useQuery({
    queryKey: ['admin-user-details', selectedUserId],
    queryFn: async () => {
      const response = await adminApi.getUserDetails(selectedUserId!)
      return response.data as UserDetails
    },
    enabled: !!selectedUserId,
  })

  const actionMutation = useMutation({
    mutationFn: async ({ userId, action }: { userId: string; action: UserActionType }) => {
      if (action === 'DELETE') {
        return adminApi.deleteUser(userId, reason)
      }
      return adminApi.moderateUser({
        userId,
        action,
        reason: reason || undefined,
        durationDays: action === 'SUSPEND' && durationDays !== 'indefinite' ? Number(durationDays) : undefined,
      })
    },
    onSuccess: (_data, { action }) => {
      toast({ title: actionConfig[action].success })
      queryClient.invalidateQueries({ queryKey: ['admin-users'] })
      queryClient.invalidateQueries({ queryKey: ['admin-user-details'] })
      queryClient.invalidateQueries({ queryKey: ['admin-stats'] })
      if (action === 'DELETE') setSelectedUserId(null)
      closeActionDialog()
    },
    onError: (error) => {
      toast({ title: 'Erreur', description: getErrorMessage(error), variant: 'destructive' })
    },
  })

  const openAction = (action: UserActionType) => {
    setReason('')
    setDurationDays('7')
    setPendingAction(action)
  }

  const closeActionDialog = () => {
    setPendingAction(null)
    setReason('')
  }

  const resetPage = <T,>(setter: (v: T) => void) => (value: T) => {
    setter(value)
    setPage(1)
  }

  const users = data?.items ?? []
  const detailUser = details?.user

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold flex items-center gap-2">
          <Users className="h-7 w-7" />
          Gestion des utilisateurs
        </h1>
        <p className="text-muted-foreground mt-1">
          Recherchez, consultez et modérez les comptes de la plateforme
        </p>
      </div>

      <Card>
        <CardHeader>
          <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
            <div>
              <CardTitle>Utilisateurs</CardTitle>
              <CardDescription>
                {data?.pagination.total ?? 0} compte(s){isFetching && !isLoading ? ' • mise à jour...' : ''}
              </CardDescription>
            </div>
            <div className="flex flex-col gap-2 sm:flex-row">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  placeholder="Nom, email, @username..."
                  value={search}
                  onChange={(e) => resetPage(setSearch)(e.target.value)}
                  className="pl-9 sm:w-64"
                />
              </div>
              <Select value={role} onValueChange={resetPage(setRole)}>
                <SelectTrigger className="sm:w-40">
                  <SelectValue placeholder="Rôle" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Tous les rôles</SelectItem>
                  <SelectItem value="CREATOR">Créateurs</SelectItem>
                  <SelectItem value="SUBSCRIBER">Abonnés</SelectItem>
                  <SelectItem value="ADMIN">Admins</SelectItem>
                </SelectContent>
              </Select>
              <Select value={status} onValueChange={resetPage(setStatus)}>
                <SelectTrigger className="sm:w-44">
                  <SelectValue placeholder="Statut" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Tous les statuts</SelectItem>
                  <SelectItem value="ACTIVE">Actifs</SelectItem>
                  <SelectItem value="SUSPENDED">Suspendus</SelectItem>
                  <SelectItem value="BANNED">Bannis</SelectItem>
                  <SelectItem value="PENDING_VERIFICATION">Non vérifiés</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <LoadingState />
          ) : users.length === 0 ? (
            <EmptyState>Aucun utilisateur ne correspond à ces critères</EmptyState>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Utilisateur</TableHead>
                    <TableHead>Rôle</TableHead>
                    <TableHead>Statut</TableHead>
                    <TableHead>Abonnés / contenus</TableHead>
                    <TableHead>Inscription</TableHead>
                    <TableHead>Dernière connexion</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {users.map((u) => (
                    <TableRow
                      key={u.id}
                      className="cursor-pointer hover:bg-muted/50"
                      onClick={() => setSelectedUserId(u.id)}
                    >
                      <TableCell>
                        <div className="flex items-center gap-3">
                          <Avatar className="h-8 w-8">
                            <AvatarImage src={u.avatar || undefined} />
                            <AvatarFallback>{u.username.substring(0, 2).toUpperCase()}</AvatarFallback>
                          </Avatar>
                          <div className="min-w-0">
                            <p className="font-medium truncate">{u.displayName || `@${u.username}`}</p>
                            <p className="text-xs text-muted-foreground truncate">
                              @{u.username} • {u.email}
                            </p>
                          </div>
                        </div>
                      </TableCell>
                      <TableCell><RoleBadge role={u.role} /></TableCell>
                      <TableCell><UserStatusBadge status={u.status} /></TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {u.creatorProfile
                          ? `${u.creatorProfile.totalSubscribers} / ${u.creatorProfile.totalContent}`
                          : '—'}
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">{timeAgo(u.createdAt)}</TableCell>
                      <TableCell className="text-xs text-muted-foreground">{timeAgo(u.lastLoginAt)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
          <PaginationControls pagination={data?.pagination} onPageChange={setPage} />
        </CardContent>
      </Card>

      {/* User detail dialog */}
      <Dialog open={!!selectedUserId} onOpenChange={(open) => !open && setSelectedUserId(null)}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Détails de l&apos;utilisateur</DialogTitle>
            <DialogDescription>Informations du compte et actions de modération</DialogDescription>
          </DialogHeader>

          {detailsLoading || !detailUser ? (
            <LoadingState />
          ) : (
            <div className="space-y-6">
              <div className="flex items-center gap-4">
                <Avatar className="h-14 w-14">
                  <AvatarImage src={detailUser.avatar || undefined} />
                  <AvatarFallback>{detailUser.username.substring(0, 2).toUpperCase()}</AvatarFallback>
                </Avatar>
                <div className="flex-1 min-w-0">
                  <p className="text-lg font-semibold truncate">
                    {detailUser.displayName || `@${detailUser.username}`}
                  </p>
                  <p className="text-sm text-muted-foreground truncate">
                    @{detailUser.username} • {detailUser.email}
                  </p>
                  <div className="flex gap-2 mt-1">
                    <RoleBadge role={detailUser.role} />
                    <UserStatusBadge status={detailUser.status} />
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
                {[
                  { label: 'Contenus', value: details.stats.contentCount },
                  { label: 'Abonnements', value: details.stats.subscriptionCount },
                  { label: 'Transactions', value: `${details.stats.totalTransactionAmount.toFixed(2)} €` },
                  { label: 'Signalements', value: details.stats.reportCount },
                ].map((stat) => (
                  <div key={stat.label} className="rounded-lg border p-3">
                    <p className="text-xs text-muted-foreground">{stat.label}</p>
                    <p className="text-lg font-semibold">{stat.value}</p>
                  </div>
                ))}
              </div>

              <dl className="grid grid-cols-1 gap-2 text-sm md:grid-cols-2">
                <div><dt className="text-muted-foreground">Inscrit le</dt><dd>{formatDateTime(detailUser.createdAt)}</dd></div>
                <div><dt className="text-muted-foreground">Dernière connexion</dt><dd>{formatDateTime(detailUser.lastLoginAt)}</dd></div>
                <div><dt className="text-muted-foreground">Email vérifié</dt><dd>{detailUser.emailVerified ? 'Oui' : 'Non'}</dd></div>
                <div><dt className="text-muted-foreground">KYC</dt><dd>{detailUser.kycStatus || '—'}</dd></div>
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

              {detailUser.role === 'ADMIN' ? (
                <p className="text-sm text-muted-foreground">
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

      {/* Action confirmation */}
      {pendingAction && detailUser && (
        <ReasonDialog
          open={!!pendingAction}
          onOpenChange={(open) => !open && closeActionDialog()}
          title={actionConfig[pendingAction].title}
          description={`@${detailUser.username}${
            pendingAction === 'DELETE' ? ' — le compte sera désactivé et masqué de la plateforme.' : ''
          }`}
          confirmLabel={actionConfig[pendingAction].confirm}
          destructive={actionConfig[pendingAction].destructive}
          reason={reason}
          onReasonChange={setReason}
          reasonRequired={pendingAction !== 'ACTIVATE'}
          isPending={actionMutation.isPending}
          onConfirm={() => actionMutation.mutate({ userId: detailUser.id, action: pendingAction })}
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
                  <SelectItem value="indefinite">Indéterminée</SelectItem>
                </SelectContent>
              </Select>
            </div>
          )}
        </ReasonDialog>
      )}
    </div>
  )
}
