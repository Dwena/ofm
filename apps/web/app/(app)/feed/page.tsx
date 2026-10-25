'use client'

import { useEffect, useRef, useState } from 'react'
import { formatFanPrice } from '@/lib/vat'
import Link from 'next/link'
import { useInfiniteQuery, useQueryClient } from '@tanstack/react-query'
import { contentApi } from '@/lib/api'
import { useAuth } from '@/contexts/auth-context'
import { Card, CardContent, CardFooter, CardHeader } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Lightbox } from '@/components/ui/lightbox'
import {
  Heart,
  MessageCircle,
  Lock,
  FileText,
  ChevronLeft,
  ChevronRight,
  Loader2,
  Share2,
  Music,
  Compass,
} from 'lucide-react'
import { formatDistanceToNow } from 'date-fns'
import { fr } from 'date-fns/locale'
import CommentsSection from '@/components/social/comments-section'
import ContentActionsMenu from '@/components/social/content-actions-menu'
import PpvUnlockDialog from '@/components/checkout/ppv-unlock-dialog'
import { shareContent, useToggleLike } from '@/hooks/use-content-actions'
import { cn, formatEuros } from '@/lib/utils'
import { StoriesBar } from '@/components/stories/stories-bar'
import { AgeGatedMedia } from '@/components/age-verification/age-gated-media'

// Shape returned by /content/feed and /content/feed/subscriptions
interface ContentFile {
  id: string
  type: 'IMAGE' | 'VIDEO' | 'AUDIO' | 'FILE'
  url: string
  thumbnailUrl?: string | null
  fileName?: string | null
}

interface ContentItem {
  id: string
  type: 'PHOTO' | 'VIDEO' | 'AUDIO' | 'TEXT' | 'ALBUM'
  visibility: 'PUBLIC' | 'SUBSCRIBERS_ONLY' | 'PREMIUM_SUBSCRIBERS' | 'PPV' | 'PRIVATE'
  title?: string | null
  description?: string | null
  caption?: string | null
  isPpv: boolean
  ppvPrice: number | null // euros
  isLocked: boolean
  /** Media URLs withheld until the visitor's age is verified */
  ageVerificationRequired?: boolean
  hasUnlocked: boolean
  isLiked: boolean
  mediaCount: number
  creator: {
    id: string
    username: string
    displayName?: string | null
    avatar?: string | null
  }
  files: ContentFile[]
  _count: {
    likes: number
    comments: number
  }
  publishedAt?: string | null
  createdAt: string
}

type FeedTab = 'all' | 'subscriptions'

const PAGE_SIZE = 10

const visibilityLabels: Record<ContentItem['visibility'], string> = {
  PUBLIC: 'Public',
  SUBSCRIBERS_ONLY: 'Abonnés',
  PREMIUM_SUBSCRIBERS: 'Premium',
  PPV: 'PPV',
  PRIVATE: 'Privé',
}

export default function FeedPage() {
  const [selectedTab, setSelectedTab] = useState<FeedTab>('all')
  const [unlocking, setUnlocking] = useState<ContentItem | null>(null)
  const queryClient = useQueryClient()

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      <h1 className="text-2xl sm:text-3xl font-bold">Feed</h1>

      <StoriesBar />

      <PpvUnlockDialog
        content={unlocking}
        onClose={() => setUnlocking(null)}
        onUnlocked={() => {
          queryClient.invalidateQueries({ queryKey: ['feed'] })
          if (unlocking) queryClient.invalidateQueries({ queryKey: ['content', unlocking.id] })
        }}
      />

      <Tabs value={selectedTab} onValueChange={(value) => setSelectedTab(value as FeedTab)}>
        <TabsList className="w-full">
          <TabsTrigger value="all" className="flex-1">Tout</TabsTrigger>
          <TabsTrigger value="subscriptions" className="flex-1">Mes abonnements</TabsTrigger>
        </TabsList>

        <TabsContent value="all" className="mt-6">
          <FeedList tab="all" onUnlock={setUnlocking} />
        </TabsContent>
        <TabsContent value="subscriptions" className="mt-6">
          <FeedList tab="subscriptions" onUnlock={setUnlocking} />
        </TabsContent>
      </Tabs>
    </div>
  )
}

function FeedList({ tab, onUnlock }: { tab: FeedTab; onUnlock: (content: ContentItem) => void }) {
  const sentinelRef = useRef<HTMLDivElement>(null)

  const {
    data,
    isLoading,
    isError,
    refetch,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
    isFetchNextPageError,
  } = useInfiniteQuery({
    queryKey: ['feed', tab],
    initialPageParam: 1,
    queryFn: async ({ pageParam }) => {
      const endpoint = tab === 'subscriptions' ? contentApi.getSubscriptionsFeed : contentApi.getFeed
      const response = await endpoint({ page: pageParam, limit: PAGE_SIZE })
      return (Array.isArray(response.data) ? response.data : []) as ContentItem[]
    },
    // The feed endpoints return plain arrays: a full page means there may be more
    getNextPageParam: (lastPage, allPages) =>
      lastPage.length === PAGE_SIZE ? allPages.length + 1 : undefined,
  })

  // Infinite scroll: load the next page when the sentinel becomes visible
  useEffect(() => {
    const node = sentinelRef.current
    if (!node || !hasNextPage || isFetchNextPageError) return
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting && !isFetchingNextPage) fetchNextPage()
      },
      { rootMargin: '400px' },
    )
    observer.observe(node)
    return () => observer.disconnect()
  }, [hasNextPage, isFetchingNextPage, isFetchNextPageError, fetchNextPage])

  if (isLoading) {
    return (
      <div className="flex flex-col items-center justify-center py-16">
        <Loader2 className="h-10 w-10 animate-spin text-muted-foreground" />
        <p className="mt-4 text-muted-foreground">Chargement du feed...</p>
      </div>
    )
  }

  if (isError) {
    return (
      <Card>
        <CardContent className="py-12 text-center space-y-4">
          <p className="text-muted-foreground">Impossible de charger le feed pour le moment.</p>
          <Button variant="outline" onClick={() => refetch()}>
            Réessayer
          </Button>
        </CardContent>
      </Card>
    )
  }

  // Offset pagination can repeat an item when new content is published meanwhile
  const seen = new Set<string>()
  const items = (data?.pages ?? []).flat().filter((item) => {
    if (seen.has(item.id)) return false
    seen.add(item.id)
    return true
  })

  if (items.length === 0) {
    return (
      <Card>
        <CardContent className="py-12 text-center space-y-4">
          <Compass className="h-12 w-12 mx-auto text-muted-foreground opacity-50" />
          <div>
            <p className="font-medium">
              {tab === 'subscriptions' ? 'Aucun contenu de vos abonnements' : 'Aucun contenu disponible'}
            </p>
            <p className="text-sm text-muted-foreground mt-2">
              {tab === 'subscriptions'
                ? 'Abonnez-vous à des créateurs pour voir leurs publications ici.'
                : 'Les créateurs n’ont encore rien publié. Revenez bientôt !'}
            </p>
          </div>
          <Button asChild>
            <Link href="/discover">Découvrir des créateurs</Link>
          </Button>
        </CardContent>
      </Card>
    )
  }

  return (
    <div className="space-y-6">
      {items.map((content) => (
        <ContentCard key={content.id} content={content} onUnlock={onUnlock} />
      ))}

      <div ref={sentinelRef} />
      {hasNextPage ? (
        <div className="flex justify-center">
          <Button variant="outline" onClick={() => fetchNextPage()} disabled={isFetchingNextPage}>
            {isFetchingNextPage && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
            {isFetchNextPageError ? 'Réessayer' : 'Charger plus'}
          </Button>
        </div>
      ) : (
        <p className="text-center text-sm text-muted-foreground py-2">Vous avez tout vu</p>
      )}
    </div>
  )
}

function ContentCard({ content, onUnlock }: { content: ContentItem; onUnlock: (content: ContentItem) => void }) {
  const { user } = useAuth()
  const [showComments, setShowComments] = useState(false)
  const likeMutation = useToggleLike(content)
  const isOwner = user?.id === content.creator.id
  const creatorName = content.creator.displayName || content.creator.username
  const profileUrl = `/${content.creator.username}`
  const detailUrl = `/content/${content.id}`

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between gap-3">
          <Link href={profileUrl} className="flex items-center gap-3 min-w-0 group">
            <Avatar>
              <AvatarImage src={content.creator.avatar ?? undefined} alt={creatorName} />
              <AvatarFallback>{content.creator.username.substring(0, 2).toUpperCase()}</AvatarFallback>
            </Avatar>
            <div className="min-w-0">
              <p className="font-semibold truncate group-hover:underline">{creatorName}</p>
              <p className="text-xs text-muted-foreground truncate">
                @{content.creator.username} ·{' '}
                {formatDistanceToNow(new Date(content.publishedAt || content.createdAt), {
                  addSuffix: true,
                  locale: fr,
                })}
              </p>
            </div>
          </Link>
          <div className="flex items-center gap-1 sm:gap-2 flex-shrink-0">
            {!content.isPpv && (
              <Badge variant="outline" className="hidden sm:inline-flex">
                {visibilityLabels[content.visibility] ?? content.visibility}
              </Badge>
            )}
            {content.isPpv && (
              <Badge variant="secondary">
                {content.hasUnlocked || isOwner ? 'PPV' : `PPV ${formatFanPrice(content.ppvPrice)}`}
              </Badge>
            )}
            <ContentActionsMenu content={content} isOwner={isOwner} />
          </div>
        </div>
      </CardHeader>

      <CardContent className="space-y-4">
        {(content.title || content.description) && (
          <div>
            {content.title && (
              <Link href={detailUrl} className="hover:underline">
                <h3 className="font-semibold text-lg">{content.title}</h3>
              </Link>
            )}
            {content.description && (
              <p className="text-sm text-muted-foreground mt-1 whitespace-pre-line line-clamp-4">
                {content.description}
              </p>
            )}
          </div>
        )}

        {content.isLocked ? (
          <LockedMedia content={content} onUnlock={onUnlock} />
        ) : content.ageVerificationRequired ? (
          <AgeGatedMedia className="aspect-video rounded-none" />
        ) : content.files.length > 0 ? (
          <MediaCarousel files={content.files} title={content.title || `Média de ${creatorName}`} />
        ) : null}

        {content.caption && <p className="text-sm whitespace-pre-line">{content.caption}</p>}
      </CardContent>

      <CardFooter className="flex items-center gap-1 sm:gap-4 pb-4">
        <Button
          variant="ghost"
          size="sm"
          onClick={() => likeMutation.mutate()}
          disabled={likeMutation.isPending}
          aria-pressed={content.isLiked}
          aria-label={content.isLiked ? "Je n'aime plus" : "J'aime"}
          className={content.isLiked ? 'text-red-500 hover:text-red-600' : ''}
        >
          <Heart className={cn('h-4 w-4 mr-2', content.isLiked && 'fill-current')} />
          {content._count.likes}
        </Button>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setShowComments((value) => !value)}
          aria-expanded={showComments}
          aria-label={showComments ? 'Masquer les commentaires' : 'Afficher les commentaires'}
          className={showComments ? 'text-primary' : ''}
        >
          <MessageCircle className={cn('h-4 w-4 mr-2', showComments && 'fill-current')} />
          {content._count.comments}
        </Button>
        <Button variant="ghost" size="sm" onClick={() => shareContent(content)} className="ml-auto">
          <Share2 className="h-4 w-4 sm:mr-2" />
          <span className="hidden sm:inline">Partager</span>
        </Button>
      </CardFooter>

      {showComments && (
        <div className="px-4 sm:px-6 pb-6">
          <CommentsSection
            contentId={content.id}
            contentCreatorId={content.creator.id}
            initialCount={content._count.comments}
          />
        </div>
      )}
    </Card>
  )
}

function LockedMedia({ content, onUnlock }: { content: ContentItem; onUnlock: (content: ContentItem) => void }) {
  const isPremium = content.visibility === 'PREMIUM_SUBSCRIBERS'
  return (
    <div className="relative rounded-lg overflow-hidden bg-gradient-to-br from-muted to-muted-foreground/20">
      <div className="aspect-video flex items-center justify-center px-4">
        <div className="text-center space-y-3">
          <div className="mx-auto h-14 w-14 rounded-full bg-background/80 flex items-center justify-center">
            <Lock className="h-7 w-7" />
          </div>
          <div>
            <p className="font-semibold">{content.isPpv ? 'Contenu payant' : 'Contenu verrouillé'}</p>
            <p className="text-sm text-muted-foreground">
              {content.isPpv
                ? `Débloquez ce contenu pour ${formatFanPrice(content.ppvPrice)}`
                : isPremium
                  ? 'Réservé aux abonnés premium de ce créateur'
                  : 'Abonnez-vous à ce créateur pour voir ce contenu'}
            </p>
            {content.mediaCount > 0 && (
              <p className="text-xs text-muted-foreground mt-1">
                {content.mediaCount} média{content.mediaCount > 1 ? 's' : ''}
              </p>
            )}
          </div>
          {content.isPpv ? (
            <Button onClick={() => onUnlock(content)}>Débloquer pour {formatFanPrice(content.ppvPrice)}</Button>
          ) : (
            <Button asChild>
              <Link href={`/${content.creator.username}#tiers-section`}>
                {isPremium ? 'Voir les abonnements' : "S'abonner"}
              </Link>
            </Button>
          )}
        </div>
      </div>
    </div>
  )
}

function MediaCarousel({ files, title }: { files: ContentFile[]; title: string }) {
  const [index, setIndex] = useState(0)
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null)
  const touchStartX = useRef<number | null>(null)
  const current = files[Math.min(index, files.length - 1)]
  const images = files.filter((file) => file.type === 'IMAGE')

  const go = (delta: number) => setIndex((i) => (i + delta + files.length) % files.length)

  if (!current) return null

  return (
    <>
      <div
        className="relative bg-muted rounded-lg overflow-hidden"
        onTouchStart={(e) => {
          touchStartX.current = e.touches[0]?.clientX ?? null
        }}
        onTouchEnd={(e) => {
          if (touchStartX.current === null || files.length < 2) return
          const delta = (e.changedTouches[0]?.clientX ?? touchStartX.current) - touchStartX.current
          if (Math.abs(delta) > 50) go(delta < 0 ? 1 : -1)
          touchStartX.current = null
        }}
      >
        {current.type === 'IMAGE' ? (
          <button
            type="button"
            className="block w-full focus:outline-none focus-visible:ring-2 focus-visible:ring-primary"
            onClick={() => setLightboxIndex(images.findIndex((image) => image.id === current.id))}
            aria-label="Agrandir l'image"
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={current.url} alt={title} className="w-full aspect-video object-cover" loading="lazy" />
          </button>
        ) : current.type === 'VIDEO' ? (
          <video
            key={current.id}
            src={current.url}
            poster={current.thumbnailUrl ?? undefined}
            controls
            playsInline
            preload="metadata"
            className="w-full aspect-video bg-black"
          />
        ) : current.type === 'AUDIO' ? (
          <div className="aspect-video flex flex-col items-center justify-center gap-4 px-6">
            <Music className="h-12 w-12 text-muted-foreground" />
            <audio key={current.id} src={current.url} controls preload="metadata" className="w-full max-w-md" />
          </div>
        ) : (
          <a
            href={current.url}
            target="_blank"
            rel="noopener noreferrer"
            className="aspect-video flex flex-col items-center justify-center gap-2 hover:bg-accent"
          >
            <FileText className="h-12 w-12 text-muted-foreground" />
            <span className="text-sm text-muted-foreground">{current.fileName || 'Ouvrir le fichier'}</span>
          </a>
        )}
  
        {files.length > 1 && (
          <>
            <Button
              variant="ghost"
              size="icon"
              className="absolute left-2 top-1/2 -translate-y-1/2 h-8 w-8 rounded-full bg-background/80 hover:bg-background"
              onClick={() => go(-1)}
              aria-label="Média précédent"
            >
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="absolute right-2 top-1/2 -translate-y-1/2 h-8 w-8 rounded-full bg-background/80 hover:bg-background"
              onClick={() => go(1)}
              aria-label="Média suivant"
            >
              <ChevronRight className="h-4 w-4" />
            </Button>
            <div className="absolute top-2 right-2 bg-background/80 px-2 py-0.5 rounded-full text-xs">
              {index + 1} / {files.length}
            </div>
            <div className="absolute bottom-2 left-1/2 -translate-x-1/2 flex gap-1.5">
              {files.map((file, i) => (
                <button
                  key={file.id}
                  type="button"
                  onClick={() => setIndex(i)}
                  aria-label={`Aller au média ${i + 1}`}
                  className={cn(
                    'h-2 w-2 rounded-full transition-colors',
                    i === index ? 'bg-white' : 'bg-white/50 hover:bg-white/80',
                  )}
                />
              ))}
            </div>
          </>
        )}
      </div>

      {images.length > 0 && (
        <Lightbox
          items={images.map((image) => ({
            type: 'image' as const,
            url: image.url,
            thumbnail: image.thumbnailUrl ?? undefined,
            title,
          }))}
          initialIndex={lightboxIndex ?? 0}
          isOpen={lightboxIndex !== null}
          onClose={() => setLightboxIndex(null)}
        />
      )}
    </>
  )
}
