'use client'

import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { usersApi, subscriptionsApi, contentApi } from '@/lib/api'
import { useParams, useRouter } from 'next/navigation'
import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import {
  MapPin,
  Globe,
  Calendar,
  Users,
  Image as ImageIcon,
  Video,
  Heart,
  MessageCircle,
  Lock,
  CheckCircle,
  ExternalLink
} from 'lucide-react'
import { useAuth } from '@/contexts/auth-context'
import { formatRelativeTime } from '@/lib/utils'

export default function CreatorProfilePage() {
  const params = useParams()
  const router = useRouter()
  const { user: currentUser } = useAuth()
  const username = params.username as string
  const queryClient = useQueryClient()

  const [selectedTier, setSelectedTier] = useState<string | null>(null)

  // Fetch creator profile
  const { data: creator, isLoading: loadingCreator, error: creatorError } = useQuery({
    queryKey: ['creator-profile', username],
    queryFn: async () => {
      const response = await usersApi.getByUsername(username)
      return response.data
    },
  })

  // Fetch creator's subscription tiers
  const { data: tiers, isLoading: loadingTiers } = useQuery({
    queryKey: ['creator-tiers', creator?.id],
    queryFn: async () => {
      if (!creator?.id) return []
      const response = await subscriptionsApi.getCreatorTiers(creator.id)
      return response.data
    },
    enabled: !!creator?.id,
  })

  // Fetch creator's content
  const { data: content, isLoading: loadingContent } = useQuery({
    queryKey: ['creator-content', creator?.id],
    queryFn: async () => {
      if (!creator?.id) return []
      const response = await contentApi.getCreatorContent(creator.id)
      return response.data
    },
    enabled: !!creator?.id,
  })

  const isOwnProfile = currentUser?.username === username

  if (loadingCreator) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary mx-auto"></div>
          <p className="mt-4 text-muted-foreground">Chargement du profil...</p>
        </div>
      </div>
    )
  }

  if (creatorError || !creator) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <Card className="max-w-md">
          <CardContent className="pt-6 text-center">
            <Users className="h-12 w-12 mx-auto mb-4 text-muted-foreground opacity-50" />
            <h2 className="text-xl font-semibold mb-2">Profil introuvable</h2>
            <p className="text-muted-foreground mb-4">
              Le créateur @{username} n'existe pas ou a été supprimé.
            </p>
            <Button onClick={() => router.push('/feed')}>
              Retour au fil d'actualité
            </Button>
          </CardContent>
        </Card>
      </div>
    )
  }

  const tierColors = {
    FREE: 'bg-gray-500',
    BASIC: 'bg-blue-500',
    PREMIUM: 'bg-purple-500',
    VIP: 'bg-amber-500',
  }

  return (
    <div className="space-y-6 max-w-7xl mx-auto">
      {/* Cover Image */}
      {creator.coverImage && (
        <div className="w-full h-48 md:h-64 rounded-lg overflow-hidden bg-muted">
          <img
            src={creator.coverImage}
            alt="Cover"
            className="w-full h-full object-cover"
          />
        </div>
      )}

      {/* Profile Header */}
      <div className="flex flex-col md:flex-row gap-6 items-start">
        {/* Avatar and Basic Info */}
        <div className="flex flex-col items-center md:items-start">
          <Avatar className="h-32 w-32 border-4 border-background">
            <AvatarImage src={creator.avatar} alt={creator.displayName || creator.username} />
            <AvatarFallback className="text-3xl">
              {(creator.displayName || creator.username).substring(0, 2).toUpperCase()}
            </AvatarFallback>
          </Avatar>
        </div>

        {/* Info Section */}
        <div className="flex-1 space-y-4">
          <div>
            <div className="flex items-center gap-3 flex-wrap">
              <h1 className="text-3xl font-bold">{creator.displayName || creator.username}</h1>
              {creator.role === 'CREATOR' && (
                <Badge variant="default" className="bg-blue-600">
                  <CheckCircle className="h-3 w-3 mr-1" />
                  Créateur Vérifié
                </Badge>
              )}
            </div>
            <p className="text-muted-foreground text-lg mt-1">@{creator.username}</p>
          </div>

          {creator.bio && (
            <p className="text-base leading-relaxed max-w-2xl">{creator.bio}</p>
          )}

          {/* Meta Info */}
          <div className="flex flex-wrap gap-4 text-sm text-muted-foreground">
            {creator.location && (
              <div className="flex items-center gap-1">
                <MapPin className="h-4 w-4" />
                <span>{creator.location}</span>
              </div>
            )}
            {creator.website && (
              <a
                href={creator.website}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-1 hover:text-primary transition-colors"
              >
                <Globe className="h-4 w-4" />
                <span>Site web</span>
                <ExternalLink className="h-3 w-3" />
              </a>
            )}
            <div className="flex items-center gap-1">
              <Calendar className="h-4 w-4" />
              <span>Inscrit {formatRelativeTime(new Date(creator.createdAt))}</span>
            </div>
          </div>

          {/* Stats */}
          {creator.creatorProfile && (
            <div className="flex gap-6 text-sm">
              <div>
                <span className="font-bold text-lg">
                  {creator.creatorProfile.totalSubscribers || 0}
                </span>
                <span className="text-muted-foreground ml-1">Abonnés</span>
              </div>
              <div>
                <span className="font-bold text-lg">
                  {creator.creatorProfile.totalContent || 0}
                </span>
                <span className="text-muted-foreground ml-1">Publications</span>
              </div>
              {creator.creatorProfile.averageRating && (
                <div>
                  <span className="font-bold text-lg">
                    {creator.creatorProfile.averageRating.toFixed(1)}
                  </span>
                  <span className="text-muted-foreground ml-1">/ 5.0</span>
                </div>
              )}
            </div>
          )}

          {/* Actions */}
          <div className="flex gap-3">
            {isOwnProfile ? (
              <Button onClick={() => router.push('/settings')}>
                Modifier le profil
              </Button>
            ) : (
              <>
                <Button size="lg" onClick={() => document.getElementById('tiers-section')?.scrollIntoView({ behavior: 'smooth' })}>
                  S'abonner
                </Button>
                {creator.creatorProfile?.allowMessages && (
                  <Button variant="outline" size="lg" onClick={() => router.push(`/messages?user=${creator.id}`)}>
                    <MessageCircle className="h-4 w-4 mr-2" />
                    Message
                  </Button>
                )}
              </>
            )}
          </div>
        </div>
      </div>

      {/* Subscription Tiers Section */}
      {!isOwnProfile && tiers && tiers.length > 0 && (
        <div id="tiers-section" className="scroll-mt-6">
          <h2 className="text-2xl font-bold mb-4">Plans d'Abonnement</h2>
          <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-4">
            {tiers.map((tier: any) => (
              <Card
                key={tier.id}
                className={`relative cursor-pointer transition-all ${
                  selectedTier === tier.id ? 'ring-2 ring-primary' : ''
                }`}
                onClick={() => setSelectedTier(tier.id)}
              >
                <div className={`absolute top-0 left-0 right-0 h-1 ${tierColors[tier.name as keyof typeof tierColors] || 'bg-gray-500'}`} />
                <CardHeader>
                  <div className="flex items-center justify-between">
                    <Badge variant="outline">{tier.name}</Badge>
                    {tier.isActive && <Badge variant="default" className="bg-green-600">Actif</Badge>}
                  </div>
                  <CardTitle className="mt-2">{tier.name}</CardTitle>
                  <CardDescription>{tier.description}</CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div>
                    <p className="text-3xl font-bold">
                      {tier.price === 0 ? 'Gratuit' : `${(tier.price / 100).toFixed(2)}€`}
                    </p>
                    {tier.price > 0 && (
                      <p className="text-sm text-muted-foreground">
                        par {tier.interval === 'year' ? 'an' : 'mois'}
                      </p>
                    )}
                  </div>

                  {tier.benefits && tier.benefits.length > 0 && (
                    <div className="space-y-2">
                      <p className="text-sm font-medium">Avantages:</p>
                      <ul className="text-sm space-y-1">
                        {tier.benefits.map((benefit: string, index: number) => (
                          <li key={index} className="flex items-start">
                            <CheckCircle className="h-4 w-4 text-green-500 mr-2 flex-shrink-0 mt-0.5" />
                            <span>{benefit}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                </CardContent>
                <CardFooter>
                  <Button
                    className="w-full"
                    variant={selectedTier === tier.id ? 'default' : 'outline'}
                  >
                    {tier.price === 0 ? 'Suivre' : 'S\'abonner'}
                  </Button>
                </CardFooter>
              </Card>
            ))}
          </div>
        </div>
      )}

      {/* Content Gallery */}
      <Tabs defaultValue="all" className="w-full">
        <TabsList>
          <TabsTrigger value="all">Tout</TabsTrigger>
          <TabsTrigger value="images">Photos</TabsTrigger>
          <TabsTrigger value="videos">Vidéos</TabsTrigger>
        </TabsList>

        <TabsContent value="all" className="mt-6">
          <ContentGallery content={content} isLoading={loadingContent} isOwnProfile={isOwnProfile} />
        </TabsContent>

        <TabsContent value="images" className="mt-6">
          <ContentGallery
            content={content?.filter((c: any) => c.type === 'IMAGE')}
            isLoading={loadingContent}
            isOwnProfile={isOwnProfile}
          />
        </TabsContent>

        <TabsContent value="videos" className="mt-6">
          <ContentGallery
            content={content?.filter((c: any) => c.type === 'VIDEO')}
            isLoading={loadingContent}
            isOwnProfile={isOwnProfile}
          />
        </TabsContent>
      </Tabs>
    </div>
  )
}

function ContentGallery({
  content,
  isLoading,
  isOwnProfile
}: {
  content: any[] | undefined
  isLoading: boolean
  isOwnProfile: boolean
}) {
  const router = useRouter()

  if (isLoading) {
    return (
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
        {[...Array(8)].map((_, i) => (
          <div key={i} className="aspect-square bg-muted animate-pulse rounded-lg" />
        ))}
      </div>
    )
  }

  if (!content || content.length === 0) {
    return (
      <Card>
        <CardContent className="py-12 text-center">
          <ImageIcon className="h-12 w-12 mx-auto mb-4 text-muted-foreground opacity-50" />
          <p className="text-muted-foreground">
            {isOwnProfile ? 'Vous n\'avez pas encore publié de contenu' : 'Aucun contenu disponible'}
          </p>
          {isOwnProfile && (
            <Button className="mt-4" onClick={() => router.push('/creator/upload')}>
              Créer du contenu
            </Button>
          )}
        </CardContent>
      </Card>
    )
  }

  return (
    <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
      {content.map((item: any) => (
        <Card
          key={item.id}
          className="group cursor-pointer overflow-hidden hover:shadow-lg transition-all"
          onClick={() => router.push(`/content/${item.id}`)}
        >
          <div className="relative aspect-square bg-muted">
            {/* Thumbnail */}
            {item.files && item.files[0] && (
              <>
                {item.type === 'IMAGE' && (
                  <img
                    src={item.files[0].thumbnailUrl || item.files[0].url}
                    alt={item.title || 'Content'}
                    className="w-full h-full object-cover"
                  />
                )}
                {item.type === 'VIDEO' && (
                  <div className="relative w-full h-full">
                    <img
                      src={item.files[0].thumbnailUrl || '/placeholder-video.jpg'}
                      alt={item.title || 'Video'}
                      className="w-full h-full object-cover"
                    />
                    <div className="absolute inset-0 flex items-center justify-center bg-black/30">
                      <Video className="h-12 w-12 text-white" />
                    </div>
                  </div>
                )}
              </>
            )}

            {/* PPV Lock Overlay */}
            {item.isPpv && !isOwnProfile && (
              <div className="absolute inset-0 bg-black/60 flex items-center justify-center">
                <div className="text-center text-white">
                  <Lock className="h-8 w-8 mx-auto mb-2" />
                  <p className="text-sm font-medium">{(item.ppvPrice / 100).toFixed(2)}€</p>
                </div>
              </div>
            )}

            {/* Hover Overlay */}
            <div className="absolute inset-0 bg-black/0 group-hover:bg-black/50 transition-all duration-200 flex items-end p-3 opacity-0 group-hover:opacity-100">
              <div className="flex gap-4 text-white text-sm">
                <div className="flex items-center gap-1">
                  <Heart className="h-4 w-4" />
                  <span>{item.likeCount || 0}</span>
                </div>
                <div className="flex items-center gap-1">
                  <MessageCircle className="h-4 w-4" />
                  <span>{item.commentCount || 0}</span>
                </div>
              </div>
            </div>
          </div>

          {item.title && (
            <CardContent className="p-3">
              <p className="text-sm font-medium line-clamp-2">{item.title}</p>
              {item.publishedAt && (
                <p className="text-xs text-muted-foreground mt-1">
                  {formatRelativeTime(new Date(item.publishedAt))}
                </p>
              )}
            </CardContent>
          )}
        </Card>
      ))}
    </div>
  )
}
