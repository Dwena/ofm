'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useParams, useRouter } from 'next/navigation'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import {
  ArrowLeft,
  Eye,
  FileText,
  Heart,
  Image as ImageIcon,
  Loader2,
  Lock,
  MessageCircle,
  Music,
  Share2,
  Video,
} from 'lucide-react'
import { contentApi } from '@/lib/api'
import { useAuth } from '@/contexts/auth-context'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Lightbox } from '@/components/ui/lightbox'
import { VideoPlayer } from '@/components/ui/video-player'
import CommentsSection from '@/components/social/comments-section'
import ContentActionsMenu from '@/components/social/content-actions-menu'
import PpvUnlockDialog from '@/components/checkout/ppv-unlock-dialog'
import { AgeGatedMedia } from '@/components/age-verification/age-gated-media'
import { shareContent, useToggleLike } from '@/hooks/use-content-actions'
import { cn, formatCurrency, formatRelativeTime } from '@/lib/utils'

// Shape returned by GET /content/:id
interface ContentFile {
  id: string
  type: 'IMAGE' | 'VIDEO' | 'AUDIO' | 'FILE'
  url: string
  thumbnailUrl?: string | null
  fileName?: string | null
  mimeType?: string | null
}

interface ContentDetail {
  id: string
  creatorId: string
  type: 'PHOTO' | 'VIDEO' | 'AUDIO' | 'TEXT' | 'ALBUM'
  visibility: string
  title?: string | null
  description?: string | null
  caption?: string | null
  isPpv: boolean
  ppvPrice: number | null
  viewCount: number
  likeCount: number
  commentCount: number
  publishedAt?: string | null
  createdAt: string
  files: ContentFile[]
  mediaCount: number
  isLocked: boolean
  /** Media URLs withheld until the visitor's age is verified */
  ageVerificationRequired?: boolean
  hasUnlocked: boolean
  isLiked: boolean
  isSubscribed: boolean
  creator: {
    id: string
    username: string
    displayName?: string | null
    avatar?: string | null
  }
}

const typeLabels: Record<ContentDetail['type'], string> = {
  PHOTO: 'Photo',
  ALBUM: 'Album',
  VIDEO: 'Vidéo',
  AUDIO: 'Audio',
  TEXT: 'Texte',
}

const typeIcons = {
  PHOTO: ImageIcon,
  ALBUM: ImageIcon,
  VIDEO: Video,
  AUDIO: Music,
  TEXT: FileText,
}

export default function ContentDetailPage() {
  const params = useParams()
  const router = useRouter()
  const queryClient = useQueryClient()
  const { user } = useAuth()
  const contentId = params.id as string
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null)

  const queryKey = ['content', contentId]

  const { data: content, isLoading, error } = useQuery({
    queryKey,
    queryFn: async () => {
      const response = await contentApi.getById(contentId)
      return response.data as ContentDetail
    },
    retry: (count, err: any) => err?.response?.status !== 404 && count < 2,
    // Each fetch counts as a view
    refetchOnWindowFocus: false,
  })

  const [unlockOpen, setUnlockOpen] = useState(false)
  const likeMutation = useToggleLike({ id: contentId, isLiked: content?.isLiked ?? false })

  const goBack = () => {
    // Opened from a shared link: there is no in-app page to go back to
    if (window.history.length > 1) router.back()
    else router.push('/feed')
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    )
  }

  if (error || !content) {
    const notFound = (error as any)?.response?.status === 404
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <Card className="max-w-md w-full">
          <CardContent className="pt-6 text-center">
            <FileText className="h-12 w-12 mx-auto mb-4 text-muted-foreground opacity-50" />
            <h2 className="text-xl font-semibold mb-2">
              {notFound ? 'Contenu introuvable' : 'Erreur de chargement'}
            </h2>
            <p className="text-muted-foreground mb-4">
              {notFound
                ? "Ce contenu n'existe pas ou n'est plus disponible."
                : 'Impossible de charger ce contenu pour le moment.'}
            </p>
            <Button onClick={() => router.push('/feed')}>Retour au fil d&apos;actualité</Button>
          </CardContent>
        </Card>
      </div>
    )
  }

  const creatorName = content.creator.displayName || content.creator.username
  const isOwner = user?.id === content.creatorId
  const TypeIcon = typeIcons[content.type] ?? FileText
  const images = content.files.filter((file) => file.type === 'IMAGE')
  const lightboxItems = images.map((file) => ({
    type: 'image' as const,
    url: file.url,
    thumbnail: file.thumbnailUrl ?? undefined,
    title: content.title ?? undefined,
  }))

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      <PpvUnlockDialog
        content={unlockOpen ? content : null}
        onClose={() => setUnlockOpen(false)}
        onUnlocked={() => {
          queryClient.invalidateQueries({ queryKey })
          queryClient.invalidateQueries({ queryKey: ['feed'] })
        }}
      />

      <Button variant="ghost" onClick={goBack} className="-ml-2">
        <ArrowLeft className="h-4 w-4 mr-2" />
        Retour
      </Button>

      {/* Creator header */}
      <div className="flex items-center justify-between gap-4">
        <Link href={`/${content.creator.username}`} className="flex items-center gap-3 min-w-0 group">
          <Avatar className="h-12 w-12">
            <AvatarImage src={content.creator.avatar ?? undefined} alt={creatorName} />
            <AvatarFallback>{creatorName.substring(0, 2).toUpperCase()}</AvatarFallback>
          </Avatar>
          <div className="min-w-0">
            <p className="font-semibold truncate group-hover:underline">{creatorName}</p>
            <p className="text-sm text-muted-foreground truncate">
              @{content.creator.username} · {formatRelativeTime(content.publishedAt || content.createdAt)}
            </p>
          </div>
        </Link>
        <div className="flex items-center gap-2 flex-shrink-0">
          <Badge variant="secondary" className="gap-1">
            <TypeIcon className="h-3 w-3" />
            {content.mediaCount > 1 ? `${content.mediaCount} médias` : typeLabels[content.type] ?? content.type}
          </Badge>
          {content.isPpv && (
            <Badge className="bg-amber-500 hover:bg-amber-500">
              {content.hasUnlocked || isOwner
                ? 'PPV'
                : formatCurrency(content.ppvPrice ?? 0)}
            </Badge>
          )}
          <ContentActionsMenu content={content} isOwner={isOwner} showOpen={false} />
        </div>
      </div>

      {content.title && <h1 className="text-2xl font-bold">{content.title}</h1>}

      {/* Media */}
      {content.isLocked ? (
        <Card className="overflow-hidden">
          <div className="relative aspect-video bg-gradient-to-br from-muted to-muted-foreground/20 flex items-center justify-center">
            <div className="text-center px-6 space-y-4">
              <div className="mx-auto h-16 w-16 rounded-full bg-background/80 flex items-center justify-center">
                <Lock className="h-8 w-8" />
              </div>
              {content.isPpv ? (
                <>
                  <div>
                    <p className="text-lg font-semibold">Contenu payant</p>
                    <p className="text-sm text-muted-foreground">
                      Débloquez {content.mediaCount > 1 ? `ces ${content.mediaCount} médias` : 'ce contenu'} pour{' '}
                      {formatCurrency(content.ppvPrice ?? 0)}
                    </p>
                  </div>
                  <Button size="lg" onClick={() => setUnlockOpen(true)}>
                    Débloquer pour {formatCurrency(content.ppvPrice ?? 0)}
                  </Button>
                </>
              ) : (
                <>
                  <div>
                    <p className="text-lg font-semibold">
                      {content.visibility === 'PREMIUM_SUBSCRIBERS' ? 'Réservé aux abonnés premium' : 'Réservé aux abonnés'}
                    </p>
                    <p className="text-sm text-muted-foreground">
                      Abonnez-vous à {creatorName} pour accéder à ce contenu
                    </p>
                  </div>
                  <Button asChild size="lg">
                    <Link href={`/${content.creator.username}#tiers-section`}>Voir les abonnements</Link>
                  </Button>
                </>
              )}
            </div>
          </div>
        </Card>
      ) : content.ageVerificationRequired ? (
        <AgeGatedMedia className="aspect-video" />
      ) : content.files.length > 0 ? (
        <div className={content.files.length > 1 ? 'grid gap-2 sm:grid-cols-2' : ''}>
          {content.files.map((file) => {
            if (file.type === 'VIDEO') {
              return (
                <div key={file.id} className="rounded-lg overflow-hidden bg-black sm:col-span-2">
                  <VideoPlayer src={file.url} poster={file.thumbnailUrl ?? undefined} />
                </div>
              )
            }
            if (file.type === 'IMAGE') {
              const imageIndex = images.findIndex((image) => image.id === file.id)
              return (
                <button
                  key={file.id}
                  type="button"
                  onClick={() => setLightboxIndex(imageIndex)}
                  className="block w-full rounded-lg overflow-hidden bg-muted focus:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={file.url}
                    alt={content.title || `Média de ${creatorName}`}
                    className={`w-full object-cover ${content.files.length > 1 ? 'aspect-square' : 'max-h-[80vh] object-contain'}`}
                  />
                </button>
              )
            }
            if (file.type === 'AUDIO') {
              return (
                <div key={file.id} className="rounded-lg border p-4 sm:col-span-2">
                  <audio src={file.url} controls className="w-full" />
                </div>
              )
            }
            return (
              <a
                key={file.id}
                href={file.url}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-2 rounded-lg border p-4 hover:bg-accent sm:col-span-2"
              >
                <FileText className="h-5 w-5" />
                <span className="truncate">{file.fileName || 'Télécharger le fichier'}</span>
              </a>
            )
          })}
        </div>
      ) : null}

      {/* Text */}
      {(content.description || content.caption) && (
        <div className="space-y-2">
          {content.description && <p className="whitespace-pre-line leading-relaxed">{content.description}</p>}
          {content.caption && <p className="text-muted-foreground whitespace-pre-line">{content.caption}</p>}
        </div>
      )}

      {/* Actions */}
      <div className="flex items-center gap-1 sm:gap-4 border-y py-3">
        <Button
          variant="ghost"
          size="sm"
          onClick={() => likeMutation.mutate()}
          disabled={likeMutation.isPending}
          aria-pressed={content.isLiked}
          className={cn('gap-2', content.isLiked && 'text-red-500 hover:text-red-600')}
        >
          <Heart className={cn('h-5 w-5', content.isLiked && 'fill-current')} />
          <span>{content.likeCount}</span>
          <span className="sr-only">{content.isLiked ? "Je n'aime plus" : "J'aime"}</span>
        </Button>
        <Button
          variant="ghost"
          size="sm"
          className="gap-2"
          onClick={() => document.getElementById('comments')?.scrollIntoView({ behavior: 'smooth' })}
        >
          <MessageCircle className="h-5 w-5" />
          <span>{content.commentCount}</span>
          <span className="sr-only">Voir les commentaires</span>
        </Button>
        <Button variant="ghost" size="sm" className="gap-2" onClick={() => shareContent(content)}>
          <Share2 className="h-5 w-5" />
          <span className="hidden sm:inline">Partager</span>
        </Button>
        <div className="flex items-center gap-2 text-sm text-muted-foreground ml-auto">
          <Eye className="h-4 w-4" />
          <span>{content.viewCount} vues</span>
        </div>
      </div>

      {/* Comments */}
      <div id="comments" className="scroll-mt-6">
        <CommentsSection
          contentId={content.id}
          contentCreatorId={content.creatorId}
          initialCount={content.commentCount}
        />
      </div>

      {lightboxItems.length > 0 && (
        <Lightbox
          items={lightboxItems}
          initialIndex={lightboxIndex ?? 0}
          isOpen={lightboxIndex !== null}
          onClose={() => setLightboxIndex(null)}
        />
      )}
    </div>
  )
}
