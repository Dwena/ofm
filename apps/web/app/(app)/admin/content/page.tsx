'use client'

import { Suspense, useState } from 'react'
import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import { useMutation, useQuery, useQueryClient, keepPreviousData } from '@tanstack/react-query'
import { adminApi } from '@/lib/api'
import { useDebounce } from '@/hooks/use-debounce'
import { useToast } from '@/hooks/use-toast'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import {
  ContentStatusBadge,
  EmptyState,
  ErrorState,
  LoadingState,
  Paginated,
  PaginationControls,
  ReasonDialog,
  getErrorMessage,
  timeAgo,
} from '@/components/admin/admin-shared'
import { AlertTriangle, ExternalLink, FileText, RotateCcw, Search, Trash2 } from 'lucide-react'

type ContentFilter = 'ALL' | 'FLAGGED' | 'REMOVED'

interface AdminContent {
  id: string
  title?: string | null
  description?: string | null
  type: string
  status: string
  visibility: string
  isPpv: boolean
  ppvPrice: number | null
  viewCount: number
  likeCount: number
  commentCount: number
  moderationNotes?: string | null
  moderatedAt?: string | null
  createdAt: string
  deletedAt?: string | null
  pendingReports: number
  creator: { id: string; username: string; displayName?: string | null }
}

const typeLabels: Record<string, string> = {
  PHOTO: 'Photo',
  VIDEO: 'Vidéo',
  AUDIO: 'Audio',
  TEXT: 'Texte',
  ALBUM: 'Album',
}

const FILTERS: ContentFilter[] = ['ALL', 'FLAGGED', 'REMOVED']

function AdminContentInner() {
  const searchParams = useSearchParams()
  const initialFilter = searchParams.get('filter') as ContentFilter | null
  const [filter, setFilter] = useState<ContentFilter>(
    initialFilter && FILTERS.includes(initialFilter) ? initialFilter : 'FLAGGED',
  )
  const [search, setSearch] = useState(searchParams.get('q') ?? '')
  const [type, setType] = useState('all')
  const [page, setPage] = useState(1)
  const [target, setTarget] = useState<{ content: AdminContent; action: 'remove' | 'restore' } | null>(null)
  const [reason, setReason] = useState('')

  const debouncedSearch = useDebounce(search, 400)
  const { toast } = useToast()
  const queryClient = useQueryClient()

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['admin-content', filter, debouncedSearch, type, page],
    queryFn: async () => {
      const response = await adminApi.getContent({
        filter,
        query: debouncedSearch.trim() || undefined,
        type: type !== 'all' ? type : undefined,
        page,
        limit: 20,
      })
      return response.data as Paginated<AdminContent>
    },
    placeholderData: keepPreviousData,
  })

  const mutation = useMutation({
    mutationFn: ({ id, action }: { id: string; action: 'remove' | 'restore' }) =>
      action === 'remove' ? adminApi.removeContent(id, reason) : adminApi.restoreContent(id, reason || undefined),
    onSuccess: (_data, { action }) => {
      toast({ title: action === 'remove' ? 'Contenu retiré' : 'Contenu restauré' })
      queryClient.invalidateQueries({ queryKey: ['admin-content'] })
      queryClient.invalidateQueries({ queryKey: ['content-moderation'] })
      queryClient.invalidateQueries({ queryKey: ['admin-stats'] })
      queryClient.invalidateQueries({ queryKey: ['moderation-stats'] })
      queryClient.invalidateQueries({ queryKey: ['admin-audit-logs'] })
      queryClient.invalidateQueries({ queryKey: ['admin-user-details'] })
      setTarget(null)
      setReason('')
    },
    onError: (error) => {
      toast({ title: 'Erreur', description: getErrorMessage(error), variant: 'destructive' })
    },
  })

  const items = data?.items ?? []

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold flex items-center gap-2">
          <FileText className="h-7 w-7" />
          Modération des contenus
        </h1>
        <p className="text-muted-foreground mt-1">
          Contenus signalés ou en révision, retraits et restaurations
        </p>
      </div>

      <Card>
        <CardHeader className="space-y-4">
          <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
            <div>
              <CardTitle>Contenus</CardTitle>
              <CardDescription>{data?.pagination.total ?? 0} contenu(s)</CardDescription>
            </div>
            <div className="flex flex-col gap-2 sm:flex-row">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  placeholder="Titre, description, @créateur..."
                  value={search}
                  onChange={(e) => { setSearch(e.target.value); setPage(1) }}
                  className="pl-9 sm:w-64"
                />
              </div>
              <Select value={type} onValueChange={(v) => { setType(v); setPage(1) }}>
                <SelectTrigger className="sm:w-36">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Tous types</SelectItem>
                  {Object.entries(typeLabels).map(([value, label]) => (
                    <SelectItem key={value} value={value}>{label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <Tabs
            value={filter}
            onValueChange={(v) => { setFilter(v as ContentFilter); setPage(1) }}
            className="overflow-x-auto"
          >
            <TabsList>
              <TabsTrigger value="FLAGGED">
                <AlertTriangle className="h-4 w-4 mr-1" />
                Signalés / en révision
              </TabsTrigger>
              <TabsTrigger value="ALL">Tous</TabsTrigger>
              <TabsTrigger value="REMOVED">Retirés</TabsTrigger>
            </TabsList>
          </Tabs>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <LoadingState />
          ) : error ? (
            <ErrorState error={error} onRetry={() => refetch()} label="Impossible de charger les contenus" />
          ) : items.length === 0 ? (
            <EmptyState>
              {filter === 'FLAGGED' ? 'Aucun contenu signalé — tout est en ordre' : 'Aucun contenu'}
            </EmptyState>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Contenu</TableHead>
                    <TableHead>Créateur</TableHead>
                    <TableHead>Statut</TableHead>
                    <TableHead>Signalements</TableHead>
                    <TableHead>Engagement</TableHead>
                    <TableHead>Créé</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {items.map((content) => {
                    const removed = !!content.deletedAt
                    const restorable = removed || content.status === 'REJECTED' || content.status === 'UNDER_REVIEW'
                    return (
                      <TableRow key={content.id}>
                        <TableCell className="max-w-xs">
                          <div className="flex items-center gap-2">
                            <Badge variant="outline">{typeLabels[content.type] || content.type}</Badge>
                            {content.isPpv && <Badge variant="secondary">PPV</Badge>}
                          </div>
                          <p className="mt-1 font-medium truncate">{content.title || 'Sans titre'}</p>
                          {content.moderationNotes && (
                            <p className="text-xs text-muted-foreground truncate">Note : {content.moderationNotes}</p>
                          )}
                        </TableCell>
                        <TableCell className="text-sm whitespace-nowrap">
                          {content.creator ? (
                            <Link href={`/admin/users?user=${content.creator.id}`} className="hover:underline">
                              @{content.creator.username}
                            </Link>
                          ) : (
                            '—'
                          )}
                        </TableCell>
                        <TableCell>
                          {removed ? <Badge variant="destructive">Retiré</Badge> : <ContentStatusBadge status={content.status} />}
                        </TableCell>
                        <TableCell>
                          {content.pendingReports > 0 ? (
                            <Badge className="bg-orange-500 text-white">{content.pendingReports} en attente</Badge>
                          ) : (
                            <span className="text-muted-foreground text-sm">—</span>
                          )}
                        </TableCell>
                        <TableCell className="text-xs text-muted-foreground whitespace-nowrap">
                          {content.viewCount} vues • {content.likeCount} j&apos;aime • {content.commentCount} com.
                        </TableCell>
                        <TableCell className="text-xs text-muted-foreground whitespace-nowrap">
                          {timeAgo(content.createdAt)}
                        </TableCell>
                        <TableCell className="text-right">
                          <div className="flex justify-end gap-2">
                            {!removed && (
                              <Button size="sm" variant="ghost" asChild>
                                <Link href={`/content/${content.id}`} target="_blank" aria-label="Voir le contenu">
                                  <ExternalLink className="h-4 w-4" />
                                </Link>
                              </Button>
                            )}
                            {restorable && (
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() => { setReason(''); setTarget({ content, action: 'restore' }) }}
                              >
                                <RotateCcw className="h-4 w-4 mr-1" />
                                {removed ? 'Restaurer' : 'Approuver'}
                              </Button>
                            )}
                            {!removed && (
                              <Button
                                size="sm"
                                variant="destructive"
                                onClick={() => { setReason(''); setTarget({ content, action: 'remove' }) }}
                              >
                                <Trash2 className="h-4 w-4 mr-1" />
                                Retirer
                              </Button>
                            )}
                          </div>
                        </TableCell>
                      </TableRow>
                    )
                  })}
                </TableBody>
              </Table>
            </div>
          )}
          <PaginationControls pagination={data?.pagination} onPageChange={setPage} />
        </CardContent>
      </Card>

      {target && (
        <ReasonDialog
          open={!!target}
          onOpenChange={(open) => !open && setTarget(null)}
          title={target.action === 'remove' ? 'Retirer le contenu' : 'Restaurer le contenu'}
          description={`« ${target.content.title || 'Sans titre'} » de @${target.content.creator?.username}. Le créateur sera notifié.`}
          confirmLabel={target.action === 'remove' ? 'Retirer' : 'Restaurer'}
          destructive={target.action === 'remove'}
          reason={reason}
          onReasonChange={setReason}
          reasonRequired={target.action === 'remove'}
          reasonLabel={target.action === 'remove' ? 'Raison (envoyée au créateur)' : 'Note'}
          isPending={mutation.isPending}
          onConfirm={() => mutation.mutate({ id: target.content.id, action: target.action })}
        />
      )}
    </div>
  )
}

export default function AdminContentPage() {
  return (
    <Suspense fallback={<LoadingState />}>
      <AdminContentInner />
    </Suspense>
  )
}
