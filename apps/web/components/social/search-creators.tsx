'use client'

import { useState, useEffect, useRef } from 'react'
import { useQuery } from '@tanstack/react-query'
import { socialApi } from '@/lib/api'
import { Input } from '@/components/ui/input'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Badge } from '@/components/ui/badge'
import {
  Search,
  Loader2,
  CheckCircle,
  TrendingUp,
  Users,
  X
} from 'lucide-react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'

interface SearchResult {
  id: string
  username: string
  displayName?: string
  avatar?: string
  bio?: string
  role: string
  creatorProfile?: {
    totalSubscribers: number
    totalContent: number
  }
}

export default function SearchCreators() {
  const router = useRouter()
  const [query, setQuery] = useState('')
  const [showResults, setShowResults] = useState(false)
  const [debouncedQuery, setDebouncedQuery] = useState('')
  const searchRef = useRef<HTMLDivElement>(null)

  // Debounce search query
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedQuery(query)
    }, 300)

    return () => clearTimeout(timer)
  }, [query])

  // Fetch search results
  const { data: results, isLoading } = useQuery({
    queryKey: ['search-creators', debouncedQuery],
    queryFn: async () => {
      if (!debouncedQuery.trim()) return []
      const response = await socialApi.searchCreators(debouncedQuery)
      return response.data as SearchResult[]
    },
    enabled: debouncedQuery.length >= 2,
  })

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (searchRef.current && !searchRef.current.contains(event.target as Node)) {
        setShowResults(false)
      }
    }

    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  const handleResultClick = (username: string) => {
    router.push(`/${username}`)
    setQuery('')
    setShowResults(false)
  }

  const handleSeeAllResults = () => {
    router.push(`/discover?search=${encodeURIComponent(query)}`)
    setQuery('')
    setShowResults(false)
  }

  const handleClear = () => {
    setQuery('')
    setDebouncedQuery('')
  }

  return (
    <div className="relative w-full max-w-md" ref={searchRef}>
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input
          type="search"
          placeholder="Rechercher des créateurs..."
          value={query}
          onChange={(e) => {
            setQuery(e.target.value)
            setShowResults(true)
          }}
          onFocus={() => query && setShowResults(true)}
          className="pl-9 pr-9"
        />
        {query && (
          <button
            onClick={handleClear}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
          >
            <X className="h-4 w-4" />
          </button>
        )}
      </div>

      {/* Search Results Dropdown */}
      {showResults && debouncedQuery.length >= 2 && (
        <div className="absolute top-full mt-2 w-full bg-background border rounded-lg shadow-lg z-50 max-h-[400px] overflow-y-auto">
          {isLoading ? (
            <div className="p-8 text-center">
              <Loader2 className="h-6 w-6 animate-spin mx-auto text-muted-foreground" />
            </div>
          ) : results && results.length > 0 ? (
            <>
              {results.slice(0, 5).map((result) => (
                <div
                  key={result.id}
                  onClick={() => handleResultClick(result.username)}
                  className="flex items-center gap-3 p-3 hover:bg-accent cursor-pointer transition-colors border-b last:border-b-0"
                >
                  <Avatar className="h-12 w-12">
                    <AvatarImage src={result.avatar} alt={result.username} />
                    <AvatarFallback>
                      {result.username.substring(0, 2).toUpperCase()}
                    </AvatarFallback>
                  </Avatar>

                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <p className="font-medium truncate">
                        {result.displayName || result.username}
                      </p>
                      {result.role === 'CREATOR' && (
                        <Badge variant="outline" className="bg-blue-600 text-white border-blue-600 text-xs">
                          <CheckCircle className="h-3 w-3 mr-1" />
                          Créateur
                        </Badge>
                      )}
                    </div>
                    <p className="text-sm text-muted-foreground">@{result.username}</p>

                    {result.creatorProfile && (
                      <div className="flex gap-3 text-xs text-muted-foreground mt-1">
                        <span>
                          {result.creatorProfile.totalSubscribers} abonnés
                        </span>
                        <span>
                          {result.creatorProfile.totalContent} publications
                        </span>
                      </div>
                    )}
                  </div>
                </div>
              ))}

              {results.length > 5 && (
                <div className="p-3 border-t bg-muted/50">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={handleSeeAllResults}
                    className="w-full"
                  >
                    Voir tous les résultats ({results.length})
                  </Button>
                </div>
              )}
            </>
          ) : (
            <div className="p-8 text-center">
              <Users className="h-12 w-12 mx-auto mb-2 text-muted-foreground opacity-50" />
              <p className="text-sm text-muted-foreground">
                Aucun créateur trouvé pour "{debouncedQuery}"
              </p>
              <Button
                variant="link"
                size="sm"
                onClick={() => router.push('/discover')}
                className="mt-2"
              >
                Découvrir des créateurs
              </Button>
            </div>
          )}
        </div>
      )}

      {/* Search Suggestions (when empty) */}
      {showResults && !query && (
        <div className="absolute top-full mt-2 w-full bg-background border rounded-lg shadow-lg z-50">
          <div className="p-3 space-y-2">
            <p className="text-sm font-medium text-muted-foreground mb-2">Suggestions</p>
            <button
              onClick={() => router.push('/discover?sort=popular')}
              className="flex items-center gap-2 w-full p-2 hover:bg-accent rounded transition-colors text-left"
            >
              <TrendingUp className="h-4 w-4 text-muted-foreground" />
              <span className="text-sm">Créateurs populaires</span>
            </button>
            <button
              onClick={() => router.push('/discover?sort=new')}
              className="flex items-center gap-2 w-full p-2 hover:bg-accent rounded transition-colors text-left"
            >
              <Users className="h-4 w-4 text-muted-foreground" />
              <span className="text-sm">Nouveaux créateurs</span>
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
