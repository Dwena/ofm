'use client'

import { useState, useEffect, useRef } from 'react'
import Link from 'next/link'
import { useQuery } from '@tanstack/react-query'
import { socialApi } from '@/lib/api'
import { cn } from '@/lib/utils'
import { useDebounce } from '@/hooks/use-debounce'
import { Input } from '@/components/ui/input'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Search, Loader2, TrendingUp, Users, Sparkles, X } from 'lucide-react'
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

const MAX_QUICK_RESULTS = 5

interface SearchCreatorsProps {
  /** Controlled value (e.g. the discover page, which also filters its grid with it) */
  value?: string
  onValueChange?: (value: string) => void
  /**
   * Called on Enter / "Voir tous les résultats". Defaults to opening
   * /discover?search=<query>.
   */
  onSubmit?: (query: string) => void
  /** Show the "popular / new creators" shortcuts when the field is empty */
  showSuggestions?: boolean
  placeholder?: string
  className?: string
  inputClassName?: string
}

/**
 * Creator search field with an instant results dropdown (GET /social/search).
 * Picking a result opens the creator's profile.
 */
export default function SearchCreators({
  value,
  onValueChange,
  onSubmit,
  showSuggestions = true,
  placeholder = 'Rechercher des créateurs...',
  className,
  inputClassName,
}: SearchCreatorsProps) {
  const router = useRouter()
  const [innerQuery, setInnerQuery] = useState('')
  const query = value ?? innerQuery
  const setQuery = (next: string) => {
    if (value === undefined) setInnerQuery(next)
    onValueChange?.(next)
  }
  const [showResults, setShowResults] = useState(false)
  const [activeIndex, setActiveIndex] = useState(-1)
  const debouncedQuery = useDebounce(query.trim(), 300)
  const searchRef = useRef<HTMLDivElement>(null)

  const { data: results = [], isFetching, isError } = useQuery({
    queryKey: ['search-creators', debouncedQuery],
    queryFn: async () => {
      const response = await socialApi.searchCreators(debouncedQuery, MAX_QUICK_RESULTS + 1)
      return (Array.isArray(response.data) ? response.data : []) as SearchResult[]
    },
    enabled: debouncedQuery.length >= 2,
    staleTime: 30000,
  })

  const quickResults = debouncedQuery.length >= 2 ? results.slice(0, MAX_QUICK_RESULTS) : []

  useEffect(() => {
    setActiveIndex(-1)
  }, [debouncedQuery])

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

  const close = () => {
    setShowResults(false)
    setActiveIndex(-1)
  }

  const openProfile = (username: string) => {
    close()
    if (value === undefined) setInnerQuery('')
    router.push(`/${username}`)
  }

  const submit = () => {
    const trimmed = query.trim()
    close()
    if (onSubmit) {
      onSubmit(trimmed)
    } else if (trimmed) {
      setInnerQuery('')
      router.push(`/discover?search=${encodeURIComponent(trimmed)}`)
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Escape') {
      // Close the dropdown without the native "clear the search field" behavior
      if (showResults) e.preventDefault()
      close()
    } else if (e.key === 'ArrowDown' && quickResults.length > 0) {
      e.preventDefault()
      setShowResults(true)
      setActiveIndex((i) => (i + 1) % quickResults.length)
    } else if (e.key === 'ArrowUp' && quickResults.length > 0) {
      e.preventDefault()
      setActiveIndex((i) => (i <= 0 ? quickResults.length - 1 : i - 1))
    } else if (e.key === 'Enter') {
      e.preventDefault()
      if (showResults && activeIndex >= 0 && quickResults[activeIndex]) {
        openProfile(quickResults[activeIndex].username)
      } else {
        submit()
      }
    }
  }

  const waitingForDebounce = query.trim() !== debouncedQuery
  const dropdownOpen = showResults && debouncedQuery.length >= 2

  return (
    <div className={cn('relative w-full', className)} ref={searchRef}>
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input
          type="search"
          role="combobox"
          aria-expanded={dropdownOpen}
          aria-autocomplete="list"
          aria-label="Rechercher des créateurs"
          placeholder={placeholder}
          value={query}
          onChange={(e) => {
            setQuery(e.target.value)
            setShowResults(true)
          }}
          onFocus={() => setShowResults(true)}
          onKeyDown={handleKeyDown}
          className={cn('pl-9 pr-9 [&::-webkit-search-cancel-button]:hidden', inputClassName)}
        />
        {query && (
          <button
            type="button"
            onClick={() => {
              setQuery('')
              close()
            }}
            aria-label="Effacer la recherche"
            className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
          >
            <X className="h-4 w-4" />
          </button>
        )}
      </div>

      {/* Search Results Dropdown */}
      {dropdownOpen && (
        <div
          role="listbox"
          className="absolute top-full mt-2 w-full bg-background border rounded-lg shadow-lg z-50 max-h-[400px] overflow-y-auto"
        >
          {isFetching && quickResults.length === 0 ? (
            <div className="p-8 text-center">
              <Loader2 className="h-6 w-6 animate-spin mx-auto text-muted-foreground" />
            </div>
          ) : isError ? (
            <p className="p-6 text-center text-sm text-muted-foreground">
              La recherche est indisponible pour le moment.
            </p>
          ) : quickResults.length > 0 ? (
            <>
              {quickResults.map((result, index) => (
                <button
                  type="button"
                  role="option"
                  aria-selected={index === activeIndex}
                  key={result.id}
                  onClick={() => openProfile(result.username)}
                  onMouseEnter={() => setActiveIndex(index)}
                  className={cn(
                    'flex w-full items-center gap-3 p-3 text-left hover:bg-accent transition-colors border-b last:border-b-0',
                    index === activeIndex && 'bg-accent',
                  )}
                >
                  <Avatar className="h-10 w-10">
                    <AvatarImage src={result.avatar} alt={result.username} />
                    <AvatarFallback>
                      {result.username.substring(0, 2).toUpperCase()}
                    </AvatarFallback>
                  </Avatar>

                  <div className="flex-1 min-w-0">
                    <p className="font-medium truncate">
                      {result.displayName || result.username}
                    </p>
                    <p className="text-sm text-muted-foreground truncate">@{result.username}</p>

                    {result.creatorProfile && (
                      <div className="flex gap-3 text-xs text-muted-foreground mt-0.5">
                        <span>
                          {result.creatorProfile.totalSubscribers.toLocaleString('fr-FR')} abonné
                          {result.creatorProfile.totalSubscribers !== 1 ? 's' : ''}
                        </span>
                        <span>
                          {result.creatorProfile.totalContent.toLocaleString('fr-FR')} publication
                          {result.creatorProfile.totalContent !== 1 ? 's' : ''}
                        </span>
                      </div>
                    )}
                  </div>
                </button>
              ))}

              <div className="p-2 border-t bg-muted/50">
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={submit}
                  className="w-full"
                >
                  {results.length > MAX_QUICK_RESULTS
                    ? 'Voir tous les résultats'
                    : 'Afficher les résultats'}
                </Button>
              </div>
            </>
          ) : waitingForDebounce || isFetching ? (
            <div className="p-8 text-center">
              <Loader2 className="h-6 w-6 animate-spin mx-auto text-muted-foreground" />
            </div>
          ) : (
            <div className="p-6 text-center">
              <Users className="h-10 w-10 mx-auto mb-2 text-muted-foreground opacity-50" />
              <p className="text-sm text-muted-foreground">
                Aucun créateur trouvé pour &laquo;&nbsp;{debouncedQuery}&nbsp;&raquo;
              </p>
            </div>
          )}
        </div>
      )}

      {/* Search Suggestions (when empty) */}
      {showSuggestions && showResults && !query && (
        <div className="absolute top-full mt-2 w-full bg-background border rounded-lg shadow-lg z-50">
          <div className="p-3 space-y-1">
            <p className="text-sm font-medium text-muted-foreground mb-2">Suggestions</p>
            <Link
              href="/discover?sort=popular"
              onClick={close}
              className="flex items-center gap-2 w-full p-2 hover:bg-accent rounded transition-colors text-left"
            >
              <TrendingUp className="h-4 w-4 text-muted-foreground" />
              <span className="text-sm">Créateurs populaires</span>
            </Link>
            <Link
              href="/discover?sort=recent"
              onClick={close}
              className="flex items-center gap-2 w-full p-2 hover:bg-accent rounded transition-colors text-left"
            >
              <Sparkles className="h-4 w-4 text-muted-foreground" />
              <span className="text-sm">Nouveaux créateurs</span>
            </Link>
          </div>
        </div>
      )}
    </div>
  )
}
