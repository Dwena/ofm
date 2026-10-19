'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useParams, useRouter } from 'next/navigation'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
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
import { formatCurrency, formatRelativeTime } from '@/lib/utils'
import { toast } from '@/hooks/use-toast'

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
  })

  const likeMutation = useMutation({
    mutationFn: async () => {
      const response = await contentApi.likeContent(contentId)
      return response.data as { liked: boolean }
    },
    // Optimistic toggle
    onMutate: async () => {
      await queryClient.cancelQueries({ queryKey })
      const previous = queryClient.getQueryData<ContentDetail>(queryKey)
      if (previous) {
        queryClient.setQueryData<ContentDetail>(queryKey, {
          ...previous,
          isLiked: !previous.isLiked,
          likeCount: Math.max(0, previous.likeCount + (previous.isLiked ? -1 : 1)),
        })
      }
      return { previous }
    },
    onError: (err: any, _vars, context) => {
      if (context?.previous) {
        queryClient.setQueryData(queryKey, context.previous)
      }
      toast({
        title: 'Erreur',
        description: err?.response?.data?.message || "Impossible d'aimer ce contenu.",
        variant: 'destructive',
      })
    },
    onSuccess: (data) => {
      queryClient.setQueryData<ContentDetail>(queryKey, (current) =>
        current ? { ...current, isLiked: data.liked } : current,
      )
      queryClient.invalidateQueries({ queryKey: ['feed'] })
    },
  })

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

  const checkoutUrl =
    content.isPpv && content.ppvPrice
      ? `/checkout?${new URLSearchParams({
          type: 'ppv',
          itemId: content.id,
          amount: String(Math.round(content.ppvPrice * 100)),
          description: content.title || `Contenu de @${content.creator.username}`,
          returnUrl: `/content/${content.id}`,
        }).toString()}`
      : null

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      <Button variant="ghost" onClick={() => router.back()} className="-ml-2">
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
            {content.mediaCount > 1 ? `${content.mediaCount} médias` : content.type}
          </Badge>
          {content.isPpv && (
            <Badge className="bg-amber-500 hover:bg-amber-500">
              {content.hasUnlocked || isOwner
                ? 'PPV'
                : formatCurrency(content.ppvPrice ?? 0)}
            </Badge>
          )}
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
              {content.isPpv && checkoutUrl ? (
                <>
                  <div>
                    <p className="text-lg font-semibold">Contenu payant</p>
                    <p className="text-sm text-muted-foreground">
                      Débloquez {content.mediaCount > 1 ? `ces ${content.mediaCount} médias` : 'ce contenu'} pour{' '}
                      {formatCurrency(content.ppvPrice ?? 0)}
                    </p>
                  </div>
                  <Button asChild size="lg">
                    <Link href={checkoutUrl}>Débloquer pour {formatCurrency(content.ppvPrice ?? 0)}</Link>
                  </Button>
                </>
              ) : (
                <>
                  <div>
                    <p className="text-lg font-semibold">Réservé aux abonnés</p>
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
      <div className="flex items-center gap-4 border-y py-3">
        <Button
          variant="ghost"
          size="sm"
          onClick={() => likeMutation.mutate()}
          disabled={likeMutation.isPending}
          aria-pressed={content.isLiked}
          className="gap-2"
        >
          <Heart className={`h-5 w-5 ${content.isLiked ? 'fill-red-500 text-red-500' : ''}`} />
          <span>{content.likeCount}</span>
          <span className="sr-only">{content.isLiked ? "Je n'aime plus" : "J'aime"}</span>
        </Button>
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <MessageCircle className="h-5 w-5" />
          <span>{content.commentCount}</span>
        </div>
        <div className="flex items-center gap-2 text-sm text-muted-foreground ml-auto">
          <Eye className="h-4 w-4" />
          <span>{content.viewCount} vues</span>
        </div>
      </div>

      {/* Comments */}
      <CommentsSection contentId={content.id} initialCount={content.commentCount} />

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
