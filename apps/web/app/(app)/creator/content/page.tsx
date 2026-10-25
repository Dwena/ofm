'use client'

import { Suspense, useEffect, useState } from 'react'
import Link from 'next/link'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  AlertCircle,
  Archive,
  ArchiveRestore,
  Calendar,
  Eye,
  FileText,
  Heart,
  Image as ImageIcon,
  Loader2,
  MessageCircle,
  Mic,
  Pencil,
  Plus,
  Search,
  Send,
  Trash2,
  Unlock,
  Video,
} from 'lucide-react'
import { format } from 'date-fns'
import { fr } from 'date-fns/locale'
import { contentApi } from '@/lib/api'
import { formatEuros } from '@/lib/utils'
import { toast } from '@/hooks/use-toast'
import { useConfirm } from '@/hooks/use-confirm'
import { useDebounce } from '@/hooks/use-debounce'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { EditContentDialog } from '@/components/creator/edit-content-dialog'
import {
  ContentStatusFilter,
  CreatorContentItem,
  CreatorContentPage,
  STATUS_BADGE_VARIANT,
  STATUS_LABELS,
  contentErrorMessage,
  displayStatus,
  visibilityLabel,
} from '@/lib/creator-content'

const PAGE_SIZE = 12

const FILTERS: { value: ContentStatusFilter; label: string }[] = [
  { value: 'ALL', label: 'Tous' },
  { value: 'PUBLISHED', label: 'Publiés' },
  { value: 'DRAFT', label: 'Brouillons' },
  { value: 'SCHEDULED', label: 'Programmés' },
  { value: 'ARCHIVED', label: 'Archivés' },
  { value: 'REVIEW', label: 'Modération' },
]

const TYPE_ICONS = { PHOTO: ImageIcon, ALBUM: ImageIcon, VIDEO: Video, AUDIO: Mic, TEXT: FileText }

type Action = 'publish' | 'archive' | 'unarchive' | 'delete'

const formatDate = (date: string) => format(new Date(date), "d MMM yyyy 'à' HH:mm", { locale: fr })

function ContentThumbnail({ item }: { item: CreatorContentItem }) {
  const file = item.files?.[0]
  const src = file?.thumbnailUrl || (file?.type === 'IMAGE' ? file.url : null)
  const Icon = TYPE_ICONS[item.type] ?? FileText

  return (
    <div className="relative h-20 w-20 flex-shrink-0 overflow-hidden rounded-md bg-muted sm:h-24 sm:w-24">
      {src ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={src} alt="" className="h-full w-full object-cover" />
      ) : (
        <div className="flex h-full w-full items-center justify-center">
          <Icon className="h-8 w-8 text-muted-foreground" />
        </div>
      )}
      {item.mediaCount > 1 && (
        <span className="absolute bottom-1 right-1 rounded bg-black/60 px-1.5 text-[10px] font-medium text-white">
          {item.mediaCount}
        </span>
      )}
    </div>
  )
}

function CreatorContentPageInner() {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const queryClient = useQueryClient()
  const { confirm } = useConfirm()

  const initialStatus = (searchParams.get('status')?.toUpperCase() as ContentStatusFilter) || 'ALL'
  const [status, setStatus] = useState<ContentStatusFilter>(
    FILTERS.some((f) => f.value === initialStatus) ? initialStatus : 'ALL',
  )
  const [search, setSearch] = useState('')
  const debouncedSearch = useDebounce(search.trim(), 400)
  const [page, setPage] = useState(1)
  const [editing, setEditing] = useState<CreatorContentItem | null>(null)
  const [pending, setPending] = useState<{ id: string; action: Action } | null>(null)

  useEffect(() => setPage(1), [status, debouncedSearch])

  const { data, isLoading, isError, error, refetch, isFetching } = useQuery({
    queryKey: ['my-content', status, debouncedSearch, page],
    queryFn: async () => {
      const response = await contentApi.getMyContent({
        status,
        search: debouncedSearch || undefined,
        page,
        limit: PAGE_SIZE,
      })
      return response.data as CreatorContentPage
    },
    placeholderData: keepPreviousData,
  })

  // Go back a page when the last item of the current one was deleted or archived
  useEffect(() => {
    if (data && data.totalPages > 0 && page > data.totalPages) setPage(data.totalPages)
  }, [data, page])

  // ?edit=<id> (from the dashboard) opens the editor directly
  const editId = searchParams.get('edit')
  useEffect(() => {
    if (!editId) return
    const fromList = data?.items.find((item) => item.id === editId)
    if (fromList) {
      setEditing(fromList)
      return
    }
    let cancelled = false
    contentApi
      .getById(editId)
      .then((response) => !cancelled && setEditing(response.data))
      .catch((err) =>
        toast({ title: 'Contenu introuvable', description: contentErrorMessage(err), variant: 'destructive' }),
      )
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editId])

  const closeEditor = (open: boolean) => {
    if (open) return
    setEditing(null)
    if (editId) router.replace(pathname)
  }

  const changeStatus = (next: ContentStatusFilter) => {
    setStatus(next)
    router.replace(next === 'ALL' ? pathname : `${pathname}?status=${next.toLowerCase()}`)
  }

  const actionMutation = useMutation({
    mutationFn: async ({ id, action }: { id: string; action: Action }) => {
      setPending({ id, action })
      if (action === 'publish') return contentApi.publish(id)
      if (action === 'archive') return contentApi.archive(id)
      if (action === 'unarchive') return contentApi.unarchive(id)
      return contentApi.delete(id)
    },
    onSuccess: (result: any, { action }) => {
      const messages: Record<Action, string> = {
        publish: 'Contenu publié',
        archive: 'Contenu archivé',
        unarchive: 'Contenu de nouveau visible',
        delete: 'Contenu supprimé',
      }
      if (action === 'publish' && result?.data?.status === 'UNDER_REVIEW') {
        toast({
          title: 'Contenu envoyé en validation',
          description: 'Il sera visible par vos fans dès sa validation par notre équipe.',
        })
      } else {
        toast({ title: messages[action] })
      }
      queryClient.invalidateQueries({ queryKey: ['my-content'] })
      queryClient.invalidateQueries({ queryKey: ['creator-content'] })
      queryClient.invalidateQueries({ queryKey: ['creator-profile'] })
    },
    onError: (err) => {
      toast({ title: 'Action impossible', description: contentErrorMessage(err), variant: 'destructive' })
    },
    onSettled: () => setPending(null),
  })

  const runAction = async (item: CreatorContentItem, action: Action) => {
    const name = item.title || 'Sans titre'
    if (action === 'delete') {
      const ok = await confirm({
        title: 'Supprimer ce contenu ?',
        description: `« ${name} » sera définitivement retiré de votre profil et de l’accès de vos fans.${
          item.stats.unlocks > 0 ? ` ${item.stats.unlocks} fan(s) l’ont débloqué.` : ''
        }`,
        confirmText: 'Supprimer',
        variant: 'destructive',
      })
      if (!ok) return
    }
    if (action === 'archive') {
      const ok = await confirm({
        title: 'Archiver ce contenu ?',
        description: `« ${name} » ne sera plus visible par vos fans. Vous pourrez le désarchiver à tout moment.`,
        confirmText: 'Archiver',
      })
      if (!ok) return
    }
    if (action === 'publish') {
      const ok = await confirm({
        title: item.status === 'REJECTED' ? 'Renvoyer en validation ?' : 'Publier maintenant ?',
        description: item.scheduledFor
          ? `La programmation du ${formatDate(item.scheduledFor)} sera annulée et le contenu publié dès sa validation.`
          : `« ${name} » sera visible par vos fans (${visibilityLabel(item.visibility)}) après validation par notre équipe de modération.`,
        confirmText: item.status === 'REJECTED' ? 'Renvoyer' : 'Publier',
      })
      if (!ok) return
    }
    actionMutation.mutate({ id: item.id, action })
  }

  const counts = data?.counts
  const items = data?.items ?? []
  const isBusy = (item: CreatorContentItem, action: Action) =>
    pending?.id === item.id && pending.action === action

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-3xl font-bold">Mes contenus</h1>
          <p className="mt-2 text-muted-foreground">Gérez vos publications, brouillons et contenus programmés</p>
        </div>
        <Button asChild>
          <Link href="/creator/upload">
            <Plus className="mr-2 h-4 w-4" />
            Nouveau contenu
          </Link>
        </Button>
      </div>

      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex flex-wrap gap-2" role="tablist" aria-label="Filtrer par statut">
          {FILTERS.filter((f) => f.value !== 'REVIEW' || (counts?.REVIEW ?? 0) > 0 || status === 'REVIEW').map(
            (filter) => (
              <Button
                key={filter.value}
                role="tab"
                aria-selected={status === filter.value}
                data-testid={`content-filter-${filter.value.toLowerCase()}`}
                variant={status === filter.value ? 'default' : 'outline'}
                size="sm"
                onClick={() => changeStatus(filter.value)}
              >
                {filter.label}
                {counts && <span className="ml-1.5 text-xs opacity-75">{counts[filter.value] ?? 0}</span>}
              </Button>
            ),
          )}
        </div>
        <div className="relative w-full lg:w-72">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Rechercher un contenu…"
            aria-label="Rechercher un contenu"
            className="pl-9"
          />
        </div>
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center py-16">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
        </div>
      ) : isError ? (
        <Card className="border-red-300 bg-red-50 dark:bg-red-950/20">
          <CardContent className="flex flex-col items-center gap-3 py-8 text-center">
            <AlertCircle className="h-8 w-8 text-red-600" />
            <p className="text-sm text-red-600 dark:text-red-400">
              {contentErrorMessage(error, 'Impossible de charger vos contenus')}
            </p>
            <Button variant="outline" size="sm" onClick={() => refetch()}>
              Réessayer
            </Button>
          </CardContent>
        </Card>
      ) : items.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center text-muted-foreground">
            <FileText className="mx-auto mb-4 h-12 w-12 opacity-50" />
            {debouncedSearch ? (
              <p>Aucun contenu ne correspond à « {debouncedSearch} »</p>
            ) : status === 'ALL' ? (
              <>
                <p>Vous n’avez encore publié aucun contenu</p>
                <Button asChild className="mt-4">
                  <Link href="/creator/upload">Créer mon premier contenu</Link>
                </Button>
              </>
            ) : (
              <p>Aucun contenu dans cette catégorie</p>
            )}
          </CardContent>
        </Card>
      ) : (
        <div className={`space-y-3 transition-opacity ${isFetching ? 'opacity-70' : ''}`}>
          {items.map((item) => {
            const state = displayStatus(item)
            // Rejected content can be corrected and sent back to review
            const canPublish = item.status === 'DRAFT' || item.status === 'REJECTED'
            const canArchive = item.status === 'PUBLISHED'
            const canUnarchive = item.status === 'ARCHIVED'
            const canEdit = item.status !== 'UNDER_REVIEW'
            const busy = pending?.id === item.id

            return (
              <Card key={item.id} data-testid="creator-content-item">
                <CardContent className="flex flex-col gap-4 p-4 sm:flex-row">
                  <ContentThumbnail item={item} />

                  <div className="min-w-0 flex-1 space-y-2">
                    <div className="flex flex-wrap items-center gap-2">
                      <Link
                        href={`/content/${item.id}`}
                        className="truncate font-medium hover:underline"
                        data-testid="creator-content-title"
                      >
                        {item.title || 'Sans titre'}
                      </Link>
                      <Badge variant={STATUS_BADGE_VARIANT[state]}>{STATUS_LABELS[state]}</Badge>
                      <Badge variant="outline">
                        {item.isPpv && item.ppvPrice != null
                          ? `PPV · ${formatEuros(item.ppvPrice)}`
                          : visibilityLabel(item.visibility)}
                      </Badge>
                    </div>

                    {item.description && (
                      <p className="line-clamp-2 text-sm text-muted-foreground">{item.description}</p>
                    )}

                    <p className="flex items-center gap-1 text-xs text-muted-foreground">
                      <Calendar className="h-3 w-3" />
                      {state === 'SCHEDULED'
                        ? `Programmé pour le ${formatDate(item.scheduledFor!)}`
                        : item.publishedAt
                          ? `Publié le ${formatDate(item.publishedAt)}`
                          : `Créé le ${formatDate(item.createdAt)}`}
                    </p>

                    {item.status === 'REJECTED' && item.moderationNotes && (
                      <p className="text-xs text-red-600">Motif du refus : {item.moderationNotes}</p>
                    )}
                    {item.status === 'UNDER_REVIEW' && (
                      <p className="text-xs text-muted-foreground" data-testid="content-under-review">
                        En cours de validation par l’équipe de modération
                        {item.scheduledFor ? ` · publication prévue le ${formatDate(item.scheduledFor)}` : ''}
                      </p>
                    )}

                    <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-muted-foreground" data-testid="creator-content-stats">
                      <span className="flex items-center gap-1" title="Vues">
                        <Eye className="h-4 w-4" />
                        {item.stats.views.toLocaleString('fr-FR')}
                      </span>
                      <span className="flex items-center gap-1" title="J’aime">
                        <Heart className="h-4 w-4" />
                        {item.stats.likes.toLocaleString('fr-FR')}
                      </span>
                      <span className="flex items-center gap-1" title="Commentaires">
                        <MessageCircle className="h-4 w-4" />
                        {item.stats.comments.toLocaleString('fr-FR')}
                      </span>
                      {(item.isPpv || item.stats.unlocks > 0) && (
                        <span className="flex items-center gap-1" title="Déblocages PPV et revenus nets">
                          <Unlock className="h-4 w-4" />
                          {item.stats.unlocks} déblocage{item.stats.unlocks > 1 ? 's' : ''} ·{' '}
                          <span className="font-medium text-green-600">{formatEuros(item.stats.revenue)}</span>
                        </span>
                      )}
                    </div>
                  </div>

                  <div className="flex flex-wrap items-start gap-2 sm:w-40 sm:flex-col sm:items-stretch">
                    {canEdit && (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setEditing(item)}
                        disabled={busy}
                        data-testid="content-edit"
                      >
                        <Pencil className="mr-2 h-4 w-4" />
                        Modifier
                      </Button>
                    )}
                    {canPublish && (
                      <Button
                        size="sm"
                        onClick={() => runAction(item, 'publish')}
                        disabled={busy}
                        data-testid="content-publish"
                      >
                        {isBusy(item, 'publish') ? (
                          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        ) : (
                          <Send className="mr-2 h-4 w-4" />
                        )}
                        {item.status === 'REJECTED' ? 'Renvoyer' : 'Publier'}
                      </Button>
                    )}
                    {canArchive && (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => runAction(item, 'archive')}
                        disabled={busy}
                        data-testid="content-archive"
                      >
                        {isBusy(item, 'archive') ? (
                          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        ) : (
                          <Archive className="mr-2 h-4 w-4" />
                        )}
                        Archiver
                      </Button>
                    )}
                    {canUnarchive && (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => runAction(item, 'unarchive')}
                        disabled={busy}
                        data-testid="content-unarchive"
                      >
                        {isBusy(item, 'unarchive') ? (
                          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        ) : (
                          <ArchiveRestore className="mr-2 h-4 w-4" />
                        )}
                        Désarchiver
                      </Button>
                    )}
                    <Button
                      variant="outline"
                      size="sm"
                      className="text-red-600 hover:bg-red-50 hover:text-red-700 dark:hover:bg-red-950/30"
                      onClick={() => runAction(item, 'delete')}
                      disabled={busy}
                      data-testid="content-delete"
                    >
                      {isBusy(item, 'delete') ? (
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      ) : (
                        <Trash2 className="mr-2 h-4 w-4" />
                      )}
                      Supprimer
                    </Button>
                  </div>
                </CardContent>
              </Card>
            )
          })}

          {data && data.totalPages > 1 && (
            <div className="flex items-center justify-between pt-2">
              <Button variant="outline" size="sm" disabled={page <= 1 || isFetching} onClick={() => setPage(page - 1)}>
                Précédent
              </Button>
              <span className="text-sm text-muted-foreground">
                Page {data.page} sur {data.totalPages}
              </span>
              <Button
                variant="outline"
                size="sm"
                disabled={page >= data.totalPages || isFetching}
                onClick={() => setPage(page + 1)}
              >
                Suivant
              </Button>
            </div>
          )}
        </div>
      )}

      <EditContentDialog content={editing} open={!!editing} onOpenChange={closeEditor} />
    </div>
  )
}

export default function CreatorContentRoute() {
  return (
    <Suspense
      fallback={
        <div className="flex items-center justify-center py-16">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
        </div>
      }
    >
      <CreatorContentPageInner />
    </Suspense>
  )
}
