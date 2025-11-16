'use client';

import { useState, useEffect, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { usersApi } from '@/lib/api';
import { Card, CardContent, CardFooter } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import {
  Search,
  Filter,
  TrendingUp,
  Users,
  Star,
  MapPin,
  Check,
  Loader2,
  Grid3x3,
  List,
  SlidersHorizontal
} from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/contexts/auth-context';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { useDebounce } from '@/hooks/use-debounce';

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
  categories: string[];
}

const CATEGORIES = [
  'Fitness',
  'Cuisine',
  'Mode',
  'Art',
  'Musique',
  'Gaming',
  'Beauté',
  'Voyage',
  'Tech',
  'Lifestyle',
];

const SORT_OPTIONS = [
  { value: 'popular', label: 'Plus populaires' },
  { value: 'recent', label: 'Plus récents' },
  { value: 'price-low', label: 'Prix croissant' },
  { value: 'price-high', label: 'Prix décroissant' },
  { value: 'subscribers', label: 'Plus d\'abonnés' },
];

export default function DiscoverPage() {
  const { user } = useAuth();
  const router = useRouter();

  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<string>('all');
  const [sortBy, setSortBy] = useState('popular');
  const [viewMode, setViewMode] = useState<'grid' | 'list'>('grid');
  const [priceRange, setPriceRange] = useState<[number, number]>([0, 100]);

  const debouncedSearch = useDebounce(searchQuery, 500);

  // Fetch creators
  const { data: creators, isLoading } = useQuery({
    queryKey: ['discover-creators', debouncedSearch, selectedCategory, sortBy],
    queryFn: async () => {
      const response = await usersApi.discover({
        search: debouncedSearch,
        category: selectedCategory === 'all' ? undefined : selectedCategory,
        sortBy,
      });
      return response.data as Creator[];
    },
  });

  // Filter creators by price range
  const filteredCreators = useMemo(() => {
    if (!creators) return [];
    return creators.filter((creator) => {
      const price = creator.subscriptionPrice || 0;
      return price >= priceRange[0] && price <= priceRange[1];
    });
  }, [creators, priceRange]);

  const handleSubscribe = (creator: Creator) => {
    router.push(`/${creator.username}`);
  };

  return (
    <div className="container mx-auto py-8 px-4">
      {/* Header */}
      <div className="mb-8">
        <h1 className="text-3xl font-bold flex items-center gap-2">
          <Search className="h-8 w-8" />
          Découvrir des créateurs
        </h1>
        <p className="text-muted-foreground mt-2">
          Explorez et abonnez-vous aux meilleurs créateurs de contenu
        </p>
      </div>

      {/* Search and Filters */}
      <div className="space-y-4 mb-8">
        {/* Search Bar */}
        <div className="relative">
          <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-5 w-5 text-muted-foreground" />
          <Input
            placeholder="Rechercher des créateurs..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-10 h-12 text-lg"
          />
        </div>

        {/* Filters Row */}
        <div className="flex flex-wrap items-center gap-4">
          {/* Categories */}
          <div className="flex-1 min-w-[200px]">
            <Select value={selectedCategory} onValueChange={setSelectedCategory}>
              <SelectTrigger>
                <SelectValue placeholder="Catégorie" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Toutes les catégories</SelectItem>
                {CATEGORIES.map((category) => (
                  <SelectItem key={category} value={category.toLowerCase()}>
                    {category}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Sort */}
          <div className="flex-1 min-w-[200px]">
            <Select value={sortBy} onValueChange={setSortBy}>
              <SelectTrigger>
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

          {/* Price Range Filter */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" className="gap-2">
                <SlidersHorizontal className="h-4 w-4" />
                Prix: {priceRange[0]}€ - {priceRange[1]}€
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent className="w-64">
              <DropdownMenuLabel>Fourchette de prix</DropdownMenuLabel>
              <DropdownMenuSeparator />
              <div className="p-4 space-y-4">
                <div className="flex gap-4">
                  <Input
                    type="number"
                    placeholder="Min"
                    value={priceRange[0]}
                    onChange={(e) => setPriceRange([Number(e.target.value), priceRange[1]])}
                    min={0}
                  />
                  <Input
                    type="number"
                    placeholder="Max"
                    value={priceRange[1]}
                    onChange={(e) => setPriceRange([priceRange[0], Number(e.target.value)])}
                    min={0}
                  />
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  className="w-full"
                  onClick={() => setPriceRange([0, 100])}
                >
                  Réinitialiser
                </Button>
              </div>
            </DropdownMenuContent>
          </DropdownMenu>

          {/* View Mode Toggle */}
          <div className="flex gap-1 border rounded-lg p-1">
            <Button
              variant={viewMode === 'grid' ? 'default' : 'ghost'}
              size="icon"
              onClick={() => setViewMode('grid')}
            >
              <Grid3x3 className="h-4 w-4" />
            </Button>
            <Button
              variant={viewMode === 'list' ? 'default' : 'ghost'}
              size="icon"
              onClick={() => setViewMode('list')}
            >
              <List className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </div>

      {/* Results Count */}
      <div className="mb-4 text-sm text-muted-foreground">
        {filteredCreators.length} créateur{filteredCreators.length !== 1 ? 's' : ''} trouvé{filteredCreators.length !== 1 ? 's' : ''}
      </div>

      {/* Creators Grid/List */}
      {isLoading ? (
        <div className="flex justify-center py-12">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </div>
      ) : filteredCreators.length > 0 ? (
        <div
          className={
            viewMode === 'grid'
              ? 'grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6'
              : 'space-y-4'
          }
        >
          {filteredCreators.map((creator) => (
            <Card
              key={creator.id}
              className={`overflow-hidden cursor-pointer hover:shadow-lg transition-shadow ${
                viewMode === 'list' ? 'flex flex-row' : ''
              }`}
              onClick={() => router.push(`/${creator.username}`)}
            >
              {/* Cover Image */}
              <div className={viewMode === 'grid' ? 'relative h-40' : 'relative w-48 flex-shrink-0'}>
                {creator.coverImage ? (
                  <img
                    src={creator.coverImage}
                    alt={creator.displayName || creator.username}
                    className="w-full h-full object-cover"
                  />
                ) : (
                  <div className="w-full h-full bg-gradient-to-br from-purple-400 to-pink-400" />
                )}

                {/* Avatar (overlapping) */}
                <Avatar
                  className={`absolute border-4 border-background ${
                    viewMode === 'grid'
                      ? 'h-20 w-20 -bottom-10 left-4'
                      : 'h-16 w-16 -bottom-8 left-4'
                  }`}
                >
                  <AvatarImage src={creator.avatar} />
                  <AvatarFallback>
                    {creator.username.substring(0, 2).toUpperCase()}
                  </AvatarFallback>
                </Avatar>
              </div>

              <CardContent className={`flex-1 ${viewMode === 'grid' ? 'pt-12' : 'pt-4'}`}>
                <div className="flex items-start justify-between mb-2">
                  <div>
                    <div className="flex items-center gap-2">
                      <h3 className="font-bold">
                        {creator.displayName || creator.username}
                      </h3>
                      {creator.isVerified && (
                        <Badge variant="secondary" className="h-5 w-5 p-0 flex items-center justify-center">
                          <Check className="h-3 w-3" />
                        </Badge>
                      )}
                    </div>
                    <p className="text-sm text-muted-foreground">@{creator.username}</p>
                  </div>
                </div>

                {creator.bio && (
                  <p className="text-sm text-muted-foreground line-clamp-2 mb-3">
                    {creator.bio}
                  </p>
                )}

                {/* Stats */}
                <div className="flex items-center gap-4 text-sm text-muted-foreground mb-3">
                  <div className="flex items-center gap-1">
                    <Users className="h-4 w-4" />
                    <span>{creator.subscriberCount.toLocaleString()}</span>
                  </div>
                  <div className="flex items-center gap-1">
                    <Grid3x3 className="h-4 w-4" />
                    <span>{creator.postCount}</span>
                  </div>
                  {creator.location && (
                    <div className="flex items-center gap-1">
                      <MapPin className="h-4 w-4" />
                      <span>{creator.location}</span>
                    </div>
                  )}
                </div>

                {/* Categories */}
                {creator.categories.length > 0 && (
                  <div className="flex flex-wrap gap-1 mb-3">
                    {creator.categories.slice(0, 3).map((category) => (
                      <Badge key={category} variant="outline" className="text-xs">
                        {category}
                      </Badge>
                    ))}
                  </div>
                )}

                {/* Price */}
                {creator.subscriptionPrice && (
                  <div className="text-lg font-bold text-primary mb-3">
                    {creator.subscriptionPrice}€ <span className="text-sm font-normal text-muted-foreground">/mois</span>
                  </div>
                )}
              </CardContent>

              <CardFooter className={viewMode === 'list' ? 'items-center' : ''}>
                <Button
                  className="w-full"
                  onClick={(e) => {
                    e.stopPropagation();
                    handleSubscribe(creator);
                  }}
                >
                  Voir le profil
                </Button>
              </CardFooter>
            </Card>
          ))}
        </div>
      ) : (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12">
            <Search className="h-12 w-12 text-muted-foreground mb-4" />
            <p className="text-lg font-medium">Aucun créateur trouvé</p>
            <p className="text-sm text-muted-foreground mt-2">
              Essayez de modifier vos critères de recherche
            </p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
