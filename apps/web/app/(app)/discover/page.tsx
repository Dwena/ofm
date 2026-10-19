'use client';

import { Suspense, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useInfiniteQuery, useMutation, useQueryClient, type InfiniteData } from '@tanstack/react-query';
import { useRouter, useSearchParams, usePathname } from 'next/navigation';
import { usersApi, socialApi } from '@/lib/api';
import { useAuth } from '@/contexts/auth-context';
import { useDebounce } from '@/hooks/use-debounce';
import { toast } from '@/hooks/use-toast';
import { cn, formatEuros } from '@/lib/utils';
import SearchCreators from '@/components/social/search-creators';
import StoriesBar from '@/components/social/stories-bar';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import {
  Search,
  Users,
  MapPin,
  Check,
  Loader2,
  Grid3x3,
  List,
  UserPlus,
  UserCheck,
  Image as ImageIcon,
  RefreshCw,
} from 'lucide-react';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

interface Creator {
  id: string;
  username: string;
  displayName?: string;
  avatar?: string;
  coverImage?: string;
  bio?: string;
  location?: string;
  subscriberCount: number;
  postCount: number;
  subscriptionPrice?: number;
  isVerified: boolean;
  isSubscribed?: boolean;
  isFollowing?: boolean;
}

interface CreatorsPage {
  items: Creator[];
  page: number;
  total: number;
  totalPages: number;
}

const PAGE_SIZE = 12;

// Values map to the API sortBy (see usersApi.discover)
const SORT_OPTIONS = [
  { value: 'popular', label: 'Plus populaires' },
  { value: 'recent', label: 'Plus récents' },
  { value: 'price-low', label: 'Prix croissant' },
  { value: 'price-high', label: 'Prix décroissant' },
];

// Filters on the creator's cheapest active subscription tier
const PRICE_OPTIONS: { value: string; label: string; minPrice?: number; maxPrice?: number }[] = [
  { value: 'all', label: 'Tous les prix' },
  { value: 'free', label: 'Gratuit', maxPrice: 0 },
  { value: 'under-10', label: 'Moins de 10 €', maxPrice: 9.99 },
  { value: '10-20', label: 'De 10 € à 20 €', minPrice: 10, maxPrice: 20 },
  { value: 'over-20', label: 'Plus de 20 €', minPrice: 20.01 },
];

const SORT_ALIASES: Record<string, string> = { new: 'recent', subscribers: 'popular' };
const normalizeSort = (value: string | null) => {
  const sort = value ? SORT_ALIASES[value] ?? value : 'popular';
  return SORT_OPTIONS.some((o) => o.value === sort) ? sort : 'popular';
};

const VIEW_STORAGE_KEY = 'discover-view-mode';

function priceLabel(price?: number) {
  if (price === undefined || price === null) return null;
  return price === 0 ? 'Gratuit' : formatEuros(price);
}

function DiscoverContent() {
  const { user } = useAuth();
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const queryClient = useQueryClient();

  const urlSearch = searchParams.get('search') ?? '';
  const urlSort = normalizeSort(searchParams.get('sort'));

  const [searchQuery, setSearchQuery] = useState(urlSearch);
  const [sortBy, setSortBy] = useState(urlSort);
  const [priceFilter, setPriceFilter] = useState('all');
  const [viewMode, setViewMode] = useState<'grid' | 'list'>('grid');

  const debouncedSearch = useDebounce(searchQuery.trim(), 400);

  // Follow external links like /discover?search=… or ?sort=… (e.g. from the
  // header search); URL updates written below match the state and are skipped
  useEffect(() => {
    if (urlSearch !== debouncedSearch) setSearchQuery(urlSearch);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [urlSearch]);
  useEffect(() => {
    if (urlSort !== sortBy) setSortBy(urlSort);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [urlSort]);

  useEffect(() => {
    try {
      const saved = localStorage.getItem(VIEW_STORAGE_KEY);
      if (saved === 'grid' || saved === 'list') setViewMode(saved);
    } catch {
      // storage unavailable: keep the default
    }
  }, []);

  const changeViewMode = (mode: 'grid' | 'list') => {
    setViewMode(mode);
    try {
      localStorage.setItem(VIEW_STORAGE_KEY, mode);
    } catch {
      // ignore
    }
  };

  const price =PRICE_OPTIONS.find((o) => o.value === priceFilter) ?? PRICE_OPTIONS[0];

  // Keep the URL shareable (search + sort) without adding history entries
  useEffect(() => {
    const params = new URLSearchParams();
    if (debouncedSearch) params.set('search', debouncedSearch);
    if (sortBy !== 'popular') params.set('sort', sortBy);
    const next = params.toString();
    if (next !== searchParams.toString()) {
      router.replace(next ? `${pathname}?${next}` : pathname, { scroll: false });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debouncedSearch, sortBy]);

  const queryKey = ['discover-creators', debouncedSearch, sortBy, priceFilter];

  const {
    data,
    isLoading,
    isError,
    refetch,
    isRefetching,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
  } = useInfiniteQuery({
    queryKey,
    initialPageParam: 1,
    queryFn: async ({ pageParam }): Promise<CreatorsPage> => {
      const response = await usersApi.discover({
        search: debouncedSearch || undefined,
        sortBy,
        minPrice: price.minPrice,
        maxPrice: price.maxPrice,
        page: pageParam,
        limit: PAGE_SIZE,
      });
      return {
        items: response.data as Creator[],
        page: response.pagination?.page ?? pageParam,
        total: response.pagination?.total ?? (response.data as Creator[]).length,
        totalPages: response.pagination?.totalPages ?? 1,
      };
    },
    getNextPageParam: (lastPage) =>
      lastPage.page < lastPage.totalPages ? lastPage.page + 1 : undefined,
  });

  const creators = useMemo(() => data?.pages.flatMap((p) => p.items) ?? [], [data]);
  const total = data?.pages[0]?.total ?? 0;
  const hasFilters = !!debouncedSearch || priceFilter !== 'all';

  const followMutation = useMutation({
    mutationFn: async ({ creator, follow }: { creator: Creator; follow: boolean }) => {
      const response = follow
        ? await socialApi.followCreator(creator.id)
        : await socialApi.unfollowCreator(creator.id);
      return response.data as { isFollowing: boolean; followersCount: number };
    },
    onSuccess: (result, { creator }) => {
      queryClient.setQueryData<InfiniteData<CreatorsPage>>(queryKey, (old) =>
        old
          ? {
              ...old,
              pages: old.pages.map((page) => ({
                ...page,
                items: page.items.map((c) =>
                  c.id === creator.id ? { ...c, isFollowing: result.isFollowing } : c,
                ),
              })),
            }
          : old,
      );
      queryClient.invalidateQueries({ queryKey: ['discover-creators'], refetchType: 'none' });
      queryClient.invalidateQueries({ queryKey: ['follow-status', creator.id] });
      queryClient.invalidateQueries({ queryKey: ['following'] });
      toast({
        title: result.isFollowing
          ? `Vous suivez ${creator.displayName || creator.username}`
          : `Vous ne suivez plus ${creator.displayName || creator.username}`,
      });
    },
    onError: (error: any) => {
      toast({
        title: 'Erreur',
        description: error?.response?.data?.message || 'Action impossible pour le moment.',
        variant: 'destructive',
      });
    },
  });

  const resetFilters = () => {
    setSearchQuery('');
    setPriceFilter('all');
  };

  const pendingFollowId = followMutation.isPending ? followMutation.variables?.creator.id : undefined;

  return (
    <div className="container mx-auto py-8 px-4">
      {/* Header */}
      <div className="mb-6">
        <h1 className="text-2xl sm:text-3xl font-bold flex items-center gap-2">
          <Search className="h-7 w-7 sm:h-8 sm:w-8" />
          Découvrir des créateurs
        </h1>
        <p className="text-muted-foreground mt-2">
          Explorez et abonnez-vous aux meilleurs créateurs de contenu
        </p>
      </div>

      {/* Stories of subscribed creators */}
      <StoriesBar className="mb-6" />

      {/* Search and Filters */}
      <div className="space-y-4 mb-6">
        <SearchCreators
          value={searchQuery}
          onValueChange={setSearchQuery}
          onSubmit={setSearchQuery}
          showSuggestions={false}
          inputClassName="h-12 text-base"
        />

        <div className="flex flex-wrap items-center gap-3">
          <div className="flex-1 min-w-[160px]">
            <Select value={sortBy} onValueChange={setSortBy}>
              <SelectTrigger aria-label="Trier par">
                <SelectValue placeholder="Trier par" />
              </SelectTrigger>
              <SelectContent>
                {SORT_OPTIONS.map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="flex-1 min-w-[160px]">
            <Select value={priceFilter} onValueChange={setPriceFilter}>
              <SelectTrigger aria-label="Prix de l'abonnement">
                <SelectValue placeholder="Prix" />
              </SelectTrigger>
              <SelectContent>
                {PRICE_OPTIONS.map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* View Mode Toggle */}
          <div className="flex gap-1 border rounded-lg p-1" role="group" aria-label="Affichage">
            <Button
              variant={viewMode === 'grid' ? 'default' : 'ghost'}
              size="icon"
              className="h-8 w-8"
              onClick={() => changeViewMode('grid')}
              aria-label="Affichage en grille"
              aria-pressed={viewMode === 'grid'}
            >
              <Grid3x3 className="h-4 w-4" />
            </Button>
            <Button
              variant={viewMode === 'list' ? 'default' : 'ghost'}
              size="icon"
              className="h-8 w-8"
              onClick={() => changeViewMode('list')}
              aria-label="Affichage en liste"
              aria-pressed={viewMode === 'list'}
            >
              <List className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </div>

      {/* Results Count */}
      {!isLoading && !isError && (
        <div className="mb-4 flex items-center justify-between gap-2 text-sm text-muted-foreground">
          <span>
            {total} créateur{total !== 1 ? 's' : ''} trouvé{total !== 1 ? 's' : ''}
          </span>
          {hasFilters && (
            <Button variant="link" size="sm" className="h-auto p-0" onClick={resetFilters}>
              Réinitialiser les filtres
            </Button>
          )}
        </div>
      )}

      {/* Creators Grid/List */}
      {isLoading ? (
        <div className="flex justify-center py-12">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </div>
      ) : isError ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12 text-center">
            <p className="text-lg font-medium">Impossible de charger les créateurs</p>
            <p className="text-sm text-muted-foreground mt-2">Vérifiez votre connexion puis réessayez.</p>
            <Button variant="outline" className="mt-4" onClick={() => refetch()} disabled={isRefetching}>
              {isRefetching ? (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              ) : (
                <RefreshCw className="h-4 w-4 mr-2" />
              )}
              Réessayer
            </Button>
          </CardContent>
        </Card>
      ) : creators.length > 0 ? (
        <>
          <div
            className={
              viewMode === 'grid'
                ? 'grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6'
                : 'space-y-3'
            }
          >
            {creators.map((creator) => (
              <CreatorCard
                key={creator.id}
                creator={creator}
                viewMode={viewMode}
                canFollow={!!user && user.id !== creator.id}
                followPending={pendingFollowId === creator.id}
                onToggleFollow={() =>
                  followMutation.mutate({ creator, follow: !creator.isFollowing })
                }
              />
            ))}
          </div>

          {hasNextPage && (
            <div className="flex justify-center mt-8">
              <Button
                variant="outline"
                onClick={() => fetchNextPage()}
                disabled={isFetchingNextPage}
              >
                {isFetchingNextPage && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                Charger plus
              </Button>
            </div>
          )}
        </>
      ) : (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12 text-center">
            <Search className="h-12 w-12 text-muted-foreground mb-4" />
            <p className="text-lg font-medium">Aucun créateur trouvé</p>
            <p className="text-sm text-muted-foreground mt-2">
              {hasFilters
                ? 'Essayez de modifier vos critères de recherche'
                : "Aucun créateur n'est encore inscrit"}
            </p>
            {hasFilters && (
              <Button variant="outline" className="mt-4" onClick={resetFilters}>
                Réinitialiser les filtres
              </Button>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function CreatorCard({
  creator,
  viewMode,
  canFollow,
  followPending,
  onToggleFollow,
}: {
  creator: Creator;
  viewMode: 'grid' | 'list';
  canFollow: boolean;
  followPending: boolean;
  onToggleFollow: () => void;
}) {
  const name = creator.displayName || creator.username;
  const profileHref = `/${creator.username}`;
  const priceText = priceLabel(creator.subscriptionPrice);

  const followButton = canFollow && (
    <Button
      variant={creator.isFollowing ? 'secondary' : 'outline'}
      size="sm"
      onClick={onToggleFollow}
      disabled={followPending}
      aria-label={creator.isFollowing ? `Ne plus suivre ${name}` : `Suivre ${name}`}
    >
      {followPending ? (
        <Loader2 className="h-4 w-4 animate-spin" />
      ) : creator.isFollowing ? (
        <UserCheck className="h-4 w-4" />
      ) : (
        <UserPlus className="h-4 w-4" />
      )}
      <span className="ml-1">{creator.isFollowing ? 'Suivi' : 'Suivre'}</span>
    </Button>
  );

  const subscribeButton = (
    <Button asChild size="sm" variant={creator.isSubscribed ? 'outline' : 'default'} className="flex-1">
      <Link href={profileHref}>
        {creator.isSubscribed
          ? 'Voir le profil'
          : creator.subscriptionPrice !== undefined
            ? "S'abonner"
            : 'Voir le profil'}
      </Link>
    </Button>
  );

  const stats = (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-muted-foreground">
      <span className="flex items-center gap-1" title="Abonnés">
        <Users className="h-4 w-4" />
        {creator.subscriberCount.toLocaleString('fr-FR')}
      </span>
      <span className="flex items-center gap-1" title="Publications">
        <ImageIcon className="h-4 w-4" />
        {creator.postCount.toLocaleString('fr-FR')}
      </span>
      {creator.location && (
        <span className="flex items-center gap-1 min-w-0">
          <MapPin className="h-4 w-4 flex-shrink-0" />
          <span className="truncate">{creator.location}</span>
        </span>
      )}
    </div>
  );

  const nameBlock = (
    <div className="min-w-0">
      <div className="flex items-center gap-2">
        <Link href={profileHref} className="font-bold truncate hover:underline">
          {name}
        </Link>
        {creator.isVerified && (
          <Badge
            variant="secondary"
            className="h-5 w-5 p-0 flex items-center justify-center flex-shrink-0"
            title="Créateur vérifié"
          >
            <Check className="h-3 w-3" />
          </Badge>
        )}
        {creator.isSubscribed && (
          <Badge variant="outline" className="text-xs flex-shrink-0">
            Abonné
          </Badge>
        )}
      </div>
      <p className="text-sm text-muted-foreground truncate">@{creator.username}</p>
    </div>
  );

  if (viewMode === 'list') {
    return (
      <Card className="hover:shadow-md transition-shadow">
        <CardContent className="p-4 flex flex-col sm:flex-row sm:items-center gap-4">
          <div className="flex items-center gap-3 flex-1 min-w-0">
            <Link href={profileHref} className="flex-shrink-0" aria-label={`Profil de ${name}`}>
              <Avatar className="h-14 w-14">
                <AvatarImage src={creator.avatar} alt={name} />
                <AvatarFallback>{creator.username.substring(0, 2).toUpperCase()}</AvatarFallback>
              </Avatar>
            </Link>
            <div className="min-w-0 flex-1 space-y-1">
              {nameBlock}
              {creator.bio && (
                <p className="text-sm text-muted-foreground line-clamp-1">{creator.bio}</p>
              )}
              {stats}
            </div>
          </div>
          <div className="flex items-center gap-2 sm:w-auto">
            {priceText && (
              <span className="font-bold text-primary whitespace-nowrap mr-2">
                {priceText}
                {creator.subscriptionPrice ? (
                  <span className="text-sm font-normal text-muted-foreground"> /mois</span>
                ) : null}
              </span>
            )}
            {followButton}
            {subscribeButton}
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="overflow-hidden hover:shadow-lg transition-shadow flex flex-col">
      <Link href={profileHref} className="relative h-36 block" aria-label={`Profil de ${name}`}>
        {creator.coverImage ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={creator.coverImage} alt="" className="w-full h-full object-cover" />
        ) : (
          <div className="w-full h-full bg-gradient-to-br from-purple-400 to-pink-400" />
        )}
        <Avatar className="absolute h-20 w-20 -bottom-10 left-4 border-4 border-background">
          <AvatarImage src={creator.avatar} alt={name} />
          <AvatarFallback>{creator.username.substring(0, 2).toUpperCase()}</AvatarFallback>
        </Avatar>
      </Link>

      <CardContent className="flex-1 flex flex-col pt-12 space-y-3">
        {nameBlock}
        {creator.bio && <p className="text-sm text-muted-foreground line-clamp-2">{creator.bio}</p>}
        {stats}
        <div className="flex-1" />
        <div className={cn('text-lg font-bold text-primary', !priceText && 'invisible')}>
          {priceText ?? '—'}
          {creator.subscriptionPrice ? (
            <span className="text-sm font-normal text-muted-foreground"> /mois</span>
          ) : null}
        </div>
        <div className="flex gap-2">
          {subscribeButton}
          {followButton}
        </div>
      </CardContent>
    </Card>
  );
}

export default function DiscoverPage() {
  return (
    <Suspense
      fallback={
        <div className="flex justify-center py-12">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </div>
      }
    >
      <DiscoverContent />
    </Suspense>
  );
}
