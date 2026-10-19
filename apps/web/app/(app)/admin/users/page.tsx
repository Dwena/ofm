'use client'

import { Suspense, useEffect, useState } from 'react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { useQuery, keepPreviousData } from '@tanstack/react-query'
import { adminApi } from '@/lib/api'
import { useDebounce } from '@/hooks/use-debounce'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import {
  EmptyState,
  ErrorState,
  KycStatusBadge,
  LoadingState,
  Paginated,
  PaginationControls,
  RoleBadge,
  UserStatusBadge,
  timeAgo,
} from '@/components/admin/admin-shared'
import { UserDetailDialog } from '@/components/admin/user-detail-dialog'
import { Search, Users } from 'lucide-react'

interface AdminUser {
  id: string
  email: string
  username: string
  displayName?: string | null
  role: string
  status: string
  avatar?: string | null
  emailVerified: boolean
  kycStatus?: string
  createdAt: string
  lastLoginAt?: string | null
  creatorProfile?: { totalSubscribers: number; totalContent: number } | null
}

const ROLES = ['CREATOR', 'SUBSCRIBER', 'MODERATOR', 'ADMIN']
const STATUSES = ['ACTIVE', 'SUSPENDED', 'BANNED', 'PENDING_VERIFICATION']
const KYC_STATUSES = ['PENDING', 'UNDER_REVIEW', 'VERIFIED', 'REJECTED', 'NOT_STARTED']

const pick = (value: string | null, allowed: string[]) => (value && allowed.includes(value) ? value : 'all')

function AdminUsersContent() {
  const searchParams = useSearchParams()
  const router = useRouter()
  const pathname = usePathname()

  // Filters can be preset from links (dashboard cards, KYC widget…)
  const [search, setSearch] = useState(searchParams.get('q') ?? '')
  const [role, setRole] = useState(pick(searchParams.get('role'), ROLES))
  const [status, setStatus] = useState(pick(searchParams.get('status'), STATUSES))
  const [kycStatus, setKycStatus] = useState(pick(searchParams.get('kyc'), KYC_STATUSES))
  const [page, setPage] = useState(1)
  const [selectedUserId, setSelectedUserId] = useState<string | null>(searchParams.get('user'))

  const debouncedSearch = useDebounce(search, 400)

  // Keep ?user= in sync so a user detail can be linked to and closed with « back »
  useEffect(() => {
    const current = searchParams.get('user')
    if (current === selectedUserId) return
    const params = new URLSearchParams(searchParams.toString())
    if (selectedUserId) params.set('user', selectedUserId)
    else params.delete('user')
    const query = params.toString()
    router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false })
  }, [selectedUserId, searchParams, router, pathname])

  const { data, isLoading, isFetching, error, refetch } = useQuery({
    queryKey: ['admin-users', debouncedSearch, role, status, kycStatus, page],
    queryFn: async () => {
      const response = await adminApi.getUsers({
        query: debouncedSearch.trim() || undefined,
        role: role !== 'all' ? role : undefined,
        status: status !== 'all' ? status : undefined,
        kycStatus: kycStatus !== 'all' ? kycStatus : undefined,
        page,
        limit: 20,
      })
      return response.data as Paginated<AdminUser>
    },
    placeholderData: keepPreviousData,
  })

  const resetPage = <T,>(setter: (v: T) => void) => (value: T) => {
    setter(value)
    setPage(1)
  }

  const users = data?.items ?? []

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
          <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
            <div>
              <CardTitle>Utilisateurs</CardTitle>
              <CardDescription>
                {data?.pagination.total ?? 0} compte(s){isFetching && !isLoading ? ' • mise à jour...' : ''}
              </CardDescription>
            </div>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:flex">
              <div className="relative sm:col-span-2 lg:col-span-1">
                <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  placeholder="Nom, email, @username..."
                  value={search}
                  onChange={(e) => resetPage(setSearch)(e.target.value)}
                  className="pl-9 lg:w-64"
                  aria-label="Rechercher un utilisateur"
                />
              </div>
              <Select value={role} onValueChange={resetPage(setRole)}>
                <SelectTrigger className="lg:w-40" aria-label="Rôle">
                  <SelectValue placeholder="Rôle" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Tous les rôles</SelectItem>
                  <SelectItem value="CREATOR">Créateurs</SelectItem>
                  <SelectItem value="SUBSCRIBER">Abonnés</SelectItem>
                  <SelectItem value="MODERATOR">Modérateurs</SelectItem>
                  <SelectItem value="ADMIN">Admins</SelectItem>
                </SelectContent>
              </Select>
              <Select value={status} onValueChange={resetPage(setStatus)}>
                <SelectTrigger className="lg:w-44" aria-label="Statut">
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
              <Select value={kycStatus} onValueChange={resetPage(setKycStatus)}>
                <SelectTrigger className="lg:w-44" aria-label="Vérification d'identité">
                  <SelectValue placeholder="KYC" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Tous les KYC</SelectItem>
                  <SelectItem value="PENDING">KYC à vérifier</SelectItem>
                  <SelectItem value="UNDER_REVIEW">KYC en examen</SelectItem>
                  <SelectItem value="VERIFIED">KYC vérifié</SelectItem>
                  <SelectItem value="REJECTED">KYC refusé</SelectItem>
                  <SelectItem value="NOT_STARTED">KYC non commencé</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <LoadingState />
          ) : error ? (
            <ErrorState error={error} onRetry={() => refetch()} label="Impossible de charger les utilisateurs" />
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
                    <TableHead>KYC</TableHead>
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
                      tabIndex={0}
                      onClick={() => setSelectedUserId(u.id)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault()
                          setSelectedUserId(u.id)
                        }
                      }}
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
                      <TableCell>
                        {u.role === 'CREATOR' ? <KycStatusBadge status={u.kycStatus} /> : <span className="text-muted-foreground">—</span>}
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {u.creatorProfile
                          ? `${u.creatorProfile.totalSubscribers} / ${u.creatorProfile.totalContent}`
                          : '—'}
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground whitespace-nowrap">{timeAgo(u.createdAt)}</TableCell>
                      <TableCell className="text-xs text-muted-foreground whitespace-nowrap">{timeAgo(u.lastLoginAt)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
          <PaginationControls pagination={data?.pagination} onPageChange={setPage} />
        </CardContent>
      </Card>

      <UserDetailDialog userId={selectedUserId} onOpenChange={(open) => !open && setSelectedUserId(null)} />
    </div>
  )
}

export default function AdminUsersPage() {
  return (
    <Suspense fallback={<LoadingState />}>
      <AdminUsersContent />
    </Suspense>
  )
}
