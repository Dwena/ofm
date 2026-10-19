'use client'

import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { contentApi, subscriptionsApi, mediaApi } from '@/lib/api'
import { Card, CardContent, CardFooter, CardHeader } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import {
  Heart,
  MessageCircle,
  Lock,
  Image as ImageIcon,
  Video,
  Clock,
  ChevronLeft,
  ChevronRight
} from 'lucide-react'
import { formatDistanceToNow } from 'date-fns'
import { fr } from 'date-fns/locale'
import CommentsSection from '@/components/social/comments-section'

// Shape returned by /content/feed and /content/feed/subscriptions
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
  hasUnlocked: boolean
  isLiked: boolean
  mediaCount: number
  creator: {
    id: string
    username: string
    displayName?: string | null
    avatar?: string | null
  }
  files: Array<{
    id: string
    type: 'IMAGE' | 'VIDEO' | 'AUDIO' | 'FILE'
    url: string
    thumbnailUrl?: string | null
  }>
  _count: {
    likes: number
    comments: number
  }
  publishedAt?: string | null
  createdAt: string
}

const visibilityLabels: Record<ContentItem['visibility'], string> = {
  PUBLIC: 'Public',
  SUBSCRIBERS_ONLY: 'Abonnés',
  PREMIUM_SUBSCRIBERS: 'Premium',
  PPV: 'PPV',
  PRIVATE: 'Privé',
}

const formatPrice = (price: number | null) => `${(price ?? 0).toFixed(2)}€`

export default function FeedPage() {
  const [page, setPage] = useState(1)
  const [selectedTab, setSelectedTab] = useState('all')
  const queryClient = useQueryClient()

  // Fetch feed
  const { data: feedData, isLoading } = useQuery({
    queryKey: ['feed', page, selectedTab],
    queryFn: async () => {
      const endpoint = selectedTab === 'subscriptions'
        ? contentApi.getSubscriptionsFeed
        : contentApi.getFeed

      const response = await endpoint({ page, limit: 10 })
      return response.data
    },
  })

  // Like mutation
  const likeMutation = useMutation({
    mutationFn: async (contentId: string) => {
      const response = await contentApi.likeContent(contentId)
      return response.data
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['feed'] })
    },
  })

  // Unlock PPV mutation
  const unlockMutation = useMutation({
    mutationFn: async (contentId: string) => {
      const response = await contentApi.unlockPPV(contentId)
      return response.data
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['feed'] })
    },
    onError: (error: any) => {
      alert(error?.response?.data?.message || 'Impossible de débloquer ce contenu')
    },
  })

  const handleLike = (contentId: string) => {
    likeMutation.mutate(contentId)
  }

  const handleUnlock = (content: ContentItem) => {
    if (confirm(`Débloquer ce contenu pour ${formatPrice(content.ppvPrice)} ?`)) {
      unlockMutation.mutate(content.id)
    }
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary mx-auto"></div>
          <p className="mt-4 text-muted-foreground">Chargement du feed...</p>
        </div>
      </div>
    )
  }

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-3xl font-bold">Feed</h1>
      </div>

      {/* Tabs */}
      <Tabs value={selectedTab} onValueChange={setSelectedTab}>
        <TabsList className="w-full">
          <TabsTrigger value="all" className="flex-1">Tout</TabsTrigger>
          <TabsTrigger value="subscriptions" className="flex-1">Mes Abonnements</TabsTrigger>
        </TabsList>

        <TabsContent value={selectedTab} className="space-y-6 mt-6">
          {feedData && Array.isArray(feedData) && feedData.length > 0 ? (
            <>
              {feedData.map((content: ContentItem) => (
                <ContentCard
                  key={content.id}
                  content={content}
                  onLike={handleLike}
                  onUnlock={handleUnlock}
                />
              ))}

              {/* Pagination */}
              {false && (
                <div className="flex justify-center items-center space-x-4">
                  <Button
                    variant="outline"
                    onClick={() => setPage(p => Math.max(1, p - 1))}
                    disabled={page === 1}
                  >
                    <ChevronLeft className="h-4 w-4 mr-2" />
                    Précédent
                  </Button>
                  <span className="text-sm text-muted-foreground">
                    Page {page} sur {feedData.totalPages}
                  </span>
                  <Button
                    variant="outline"
                    onClick={() => setPage(p => Math.min(feedData.totalPages, p + 1))}
                    disabled={page === feedData.totalPages}
                  >
                    Suivant
                    <ChevronRight className="h-4 w-4 ml-2" />
                  </Button>
                </div>
              )}
            </>
          ) : (
            <Card>
              <CardContent className="py-12 text-center">
                <p className="text-muted-foreground">
                  {selectedTab === 'subscriptions'
                    ? 'Aucun contenu de vos abonnements'
                    : 'Aucun contenu disponible'}
                </p>
                <p className="text-sm text-muted-foreground mt-2">
                  Abonnez-vous à des créateurs pour voir leur contenu
                </p>
              </CardContent>
            </Card>
          )}
        </TabsContent>
      </Tabs>
    </div>
  )
}

function ContentCard({
  content,
  onLike,
  onUnlock
}: {
  content: ContentItem
  onLike: (id: string) => void
  onUnlock: (content: ContentItem) => void
}) {
  const [currentMediaIndex, setCurrentMediaIndex] = useState(0)
  const [showComments, setShowComments] = useState(false)
  const media = content.files
  const currentMedia = media[currentMediaIndex]

  const nextMedia = () => {
    setCurrentMediaIndex(i => (i + 1) % media.length)
  }

  const prevMedia = () => {
    setCurrentMediaIndex(i => (i - 1 + media.length) % media.length)
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-3">
            <Avatar>
              <AvatarImage src={content.creator.avatar ?? undefined} />
              <AvatarFallback>
                {content.creator.username.substring(0, 2).toUpperCase()}
              </AvatarFallback>
            </Avatar>
            <div>
              <p className="font-semibold">
                {content.creator.displayName || content.creator.username}
              </p>
              <p className="text-xs text-muted-foreground">
                {formatDistanceToNow(new Date(content.publishedAt || content.createdAt), {
                  addSuffix: true,
                  locale: fr,
                })}
              </p>
            </div>
          </div>
          <div className="flex items-center space-x-2">
            <Badge variant="outline">{visibilityLabels[content.visibility] ?? content.visibility}</Badge>
            {content.isPpv && (
              <Badge variant="secondary">
                PPV {formatPrice(content.ppvPrice)}
              </Badge>
            )}
          </div>
        </div>
      </CardHeader>

      <CardContent className="space-y-4">
        {/* Title and description */}
        <div>
          {content.title && <h3 className="font-semibold text-lg">{content.title}</h3>}
          {content.description && (
            <p className="text-sm text-muted-foreground mt-1">
              {content.description}
            </p>
          )}
        </div>

        {/* Media viewer */}
        {(content.isLocked || media.length > 0) && (
          <div className="relative bg-muted rounded-lg overflow-hidden">
            {content.isLocked ? (
              <div className="aspect-video flex items-center justify-center">
                <div className="text-center space-y-4">
                  <Lock className="h-16 w-16 mx-auto text-muted-foreground" />
                  <div>
                    <p className="font-semibold">Contenu verrouillé</p>
                    <p className="text-sm text-muted-foreground">
                      {content.isPpv
                        ? `Débloquez pour ${formatPrice(content.ppvPrice)}`
                        : 'Abonnez-vous à ce créateur pour voir ce contenu'}
                    </p>
                    {content.mediaCount > 0 && (
                      <p className="text-xs text-muted-foreground mt-1">
                        {content.mediaCount} média{content.mediaCount > 1 ? 's' : ''}
                      </p>
                    )}
                  </div>
                  {content.isPpv && (
                    <Button onClick={() => onUnlock(content)}>
                      Débloquer maintenant
                    </Button>
                  )}
                </div>
              </div>
            ) : (
              <>
                {currentMedia.type === 'IMAGE' ? (
                  <img
                    src={currentMedia.url}
                    alt={content.title || 'Contenu'}
                    className="w-full aspect-video object-cover"
                  />
                ) : currentMedia.type === 'VIDEO' ? (
                  <video
                    src={currentMedia.url}
                    controls
                    className="w-full aspect-video"
                  />
                ) : (
                  <div className="aspect-video flex items-center justify-center">
                    <div className="text-center">
                      <ImageIcon className="h-12 w-12 mx-auto text-muted-foreground" />
                      <p className="text-sm text-muted-foreground mt-2">
                        Type de média non supporté
                      </p>
                    </div>
                  </div>
                )}

                {/* Media navigation */}
                {media.length > 1 && (
                  <>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="absolute left-2 top-1/2 -translate-y-1/2 bg-background/80 hover:bg-background"
                      onClick={prevMedia}
                    >
                      <ChevronLeft className="h-4 w-4" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="absolute right-2 top-1/2 -translate-y-1/2 bg-background/80 hover:bg-background"
                      onClick={nextMedia}
                    >
                      <ChevronRight className="h-4 w-4" />
                    </Button>
                    <div className="absolute bottom-2 left-1/2 -translate-x-1/2 bg-background/80 px-3 py-1 rounded-full text-xs">
                      {currentMediaIndex + 1} / {media.length}
                    </div>
                  </>
                )}
              </>
            )}
          </div>
        )}
      </CardContent>

      <CardFooter className="flex items-center justify-between">
        <div className="flex items-center space-x-4">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => onLike(content.id)}
            className={content.isLiked ? 'text-red-500' : ''}
          >
            <Heart className={`h-4 w-4 mr-2 ${content.isLiked ? 'fill-current' : ''}`} />
            {content._count.likes}
          </Button>
          <Button variant="ghost" size="sm" onClick={() => setShowComments(v => !v)}>
            <MessageCircle className="h-4 w-4 mr-2" />
            {content._count.comments}
          </Button>
        </div>
      </CardFooter>

      {showComments && (
        <div className="px-6 pb-6">
          <CommentsSection contentId={content.id} initialCount={content._count.comments} />
        </div>
      )}
    </Card>
  )
}
