'use client'

import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { socialApi, usersApi } from '@/lib/api'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import {
  Search,
  TrendingUp,
  Users,
  Star,
  Loader2,
  UserPlus,
  CheckCircle,
  MapPin,
  ExternalLink
} from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useAuth } from '@/contexts/auth-context'

interface Creator {
  id: string
  username: string
  displayName?: string
  bio?: string
  avatar?: string
  location?: string
  creatorProfile?: {
    totalSubscribers: number
    totalContent: number
    averageRating?: number
  }
  isFollowing?: boolean
}

export default function DiscoverPage() {
  const router = useRouter()
  const { user } = useAuth()
  const queryClient = useQueryClient()

  const [searchQuery, setSearchQuery] = useState('')
  const [sortBy, setSortBy] = useState('popular')
  const [page, setPage] = useState(1)

  // Fetch discover creators
  const { data: creatorsData, isLoading } = useQuery({
    queryKey: ['discover-creators', sortBy, searchQuery, page],
    queryFn: async () => {
      const response = await socialApi.discoverCreators({
        search: searchQuery || undefined,
        sort: sortBy,
        page,
        limit: 12,
      })
      return response.data
    },
  })

  const creators = creatorsData?.data || []
  const pagination = creatorsData?.pagination

  // Follow mutation
  const followMutation = useMutation({
    mutationFn: async (creatorId: string) => {
      await socialApi.followCreator(creatorId)
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['discover-creators'] })
    },
  })

  // Unfollow mutation
  const unfollowMutation = useMutation({
    mutationFn: async (creatorId: string) => {
      await socialApi.unfollowCreator(creatorId)
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['discover-creators'] })
    },
  })

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault()
    setPage(1)
  }

  const handleFollowToggle = (creator: Creator) => {
    if (creator.isFollowing) {
      unfollowMutation.mutate(creator.id)
    } else {
      followMutation.mutate(creator.id)
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold">Découvrir</h1>
        <p className="text-muted-foreground mt-2">
          Trouvez de nouveaux créateurs à suivre
        </p>
      </div>

      {/* Search Bar */}
      <Card>
        <CardContent className="pt-6">
          <form onSubmit={handleSearch} className="flex gap-2">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                type="search"
                placeholder="Rechercher des créateurs..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-9"
              />
            </div>
            <Button type="submit">
              Rechercher
            </Button>
          </form>
        </CardContent>
      </Card>

      {/* Sort Tabs */}
      <Tabs value={sortBy} onValueChange={setSortBy}>
        <TabsList>
          <TabsTrigger value="popular">
            <TrendingUp className="h-4 w-4 mr-2" />
            Populaire
          </TabsTrigger>
          <TabsTrigger value="new">
            <Star className="h-4 w-4 mr-2" />
            Nouveau
          </TabsTrigger>
          <TabsTrigger value="recommended">
            <Users className="h-4 w-4 mr-2" />
            Recommandé
          </TabsTrigger>
        </TabsList>
      </Tabs>

      {/* Creators Grid */}
      {isLoading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </div>
      ) : creators.length > 0 ? (
        <>
          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
            {creators.map((creator: Creator) => (
              <Card key={creator.id} className="overflow-hidden hover:shadow-lg transition-shadow">
                <CardHeader className="pb-4">
                  <div className="flex items-start justify-between">
                    <div
                      className="flex gap-3 cursor-pointer flex-1"
                      onClick={() => router.push(`/${creator.username}`)}
                    >
                      <Avatar className="h-16 w-16">
                        <AvatarImage src={creator.avatar} alt={creator.username} />
                        <AvatarFallback className="text-xl">
                          {creator.username.substring(0, 2).toUpperCase()}
                        </AvatarFallback>
                      </Avatar>

                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <h3 className="font-semibold truncate">
                            {creator.displayName || creator.username}
                          </h3>
                          <Badge variant="outline" className="bg-blue-600 text-white border-blue-600">
                            <CheckCircle className="h-3 w-3 mr-1" />
                            Créateur
                          </Badge>
                        </div>
                        <p className="text-sm text-muted-foreground">
                          @{creator.username}
                        </p>
                      </div>
                    </div>
                  </div>
                </CardHeader>

                <CardContent className="space-y-4">
                  {creator.bio && (
                    <p className="text-sm line-clamp-2">{creator.bio}</p>
                  )}

                  {creator.location && (
                    <div className="flex items-center gap-1 text-sm text-muted-foreground">
                      <MapPin className="h-3 w-3" />
                      <span>{creator.location}</span>
                    </div>
                  )}

                  {creator.creatorProfile && (
                    <div className="flex gap-4 text-sm">
                      <div>
                        <span className="font-bold">
                          {creator.creatorProfile.totalSubscribers || 0}
                        </span>
                        <span className="text-muted-foreground ml-1">Abonnés</span>
                      </div>
                      <div>
                        <span className="font-bold">
                          {creator.creatorProfile.totalContent || 0}
                        </span>
                        <span className="text-muted-foreground ml-1">Publications</span>
                      </div>
                      {creator.creatorProfile.averageRating && (
                        <div>
                          <span className="font-bold">
                            {creator.creatorProfile.averageRating.toFixed(1)}
                          </span>
                          <span className="text-muted-foreground ml-1">/ 5.0</span>
                        </div>
                      )}
                    </div>
                  )}

                  <div className="flex gap-2">
                    <Button
                      variant={creator.isFollowing ? 'outline' : 'default'}
                      size="sm"
                      className="flex-1"
                      onClick={() => handleFollowToggle(creator)}
                      disabled={followMutation.isPending || unfollowMutation.isPending}
                    >
                      {followMutation.isPending || unfollowMutation.isPending ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : creator.isFollowing ? (
                        <>
                          <CheckCircle className="h-4 w-4 mr-2" />
                          Suivi
                        </>
                      ) : (
                        <>
                          <UserPlus className="h-4 w-4 mr-2" />
                          Suivre
                        </>
                      )}
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => router.push(`/${creator.username}`)}
                    >
                      <ExternalLink className="h-4 w-4" />
                    </Button>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>

          {/* Pagination */}
          {pagination && pagination.totalPages > 1 && (
            <div className="flex items-center justify-between">
              <p className="text-sm text-muted-foreground">
                Page {pagination.page} sur {pagination.totalPages}
              </p>
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  onClick={() => setPage(p => Math.max(1, p - 1))}
                  disabled={page === 1}
                >
                  Précédent
                </Button>
                <Button
                  variant="outline"
                  onClick={() => setPage(p => p + 1)}
                  disabled={page >= pagination.totalPages}
                >
                  Suivant
                </Button>
              </div>
            </div>
          )}
        </>
      ) : (
        <Card>
          <CardContent className="py-12 text-center">
            <Users className="h-12 w-12 mx-auto mb-4 text-muted-foreground opacity-50" />
            <p className="text-muted-foreground">
              {searchQuery
                ? `Aucun créateur trouvé pour "${searchQuery}"`
                : 'Aucun créateur disponible pour le moment'}
            </p>
          </CardContent>
        </Card>
      )}
    </div>
  )
}
