'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { formatDistanceToNow } from 'date-fns';
import { fr } from 'date-fns/locale';
import { Clock, Eye, Globe, Heart, ImageOff, Loader2, Lock, Play, Plus, Trash2, Type } from 'lucide-react';
import { storiesApi } from '@/lib/api';
import { useAuth } from '@/contexts/auth-context';
import { useConfirm } from '@/hooks/use-confirm';
import { toast } from '@/hooks/use-toast';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { CreateStoryDialog } from '@/components/stories/create-story-dialog';
import {
  ApiStory,
  DEFAULT_STORY_BACKGROUND,
  storyErrorMessage,
  timeLeftLabel,
} from '@/components/stories/story-utils';

export default function CreatorStoriesPage() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const { confirm } = useConfirm();
  const [createOpen, setCreateOpen] = useState(false);
  const isCreator = user?.role === 'CREATOR';

  const { data: stories = [], isLoading, isError, refetch } = useQuery({
    queryKey: ['my-stories'],
    queryFn: async () => {
      const response = await storiesApi.getMine();
      return (Array.isArray(response.data) ? response.data : []) as ApiStory[];
    },
    enabled: isCreator,
  });

  const deleteMutation = useMutation({
    mutationFn: (storyId: string) => storiesApi.delete(storyId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['my-stories'] });
      queryClient.invalidateQueries({ queryKey: ['stories-feed'] });
      queryClient.invalidateQueries({ queryKey: ['story-group'] });
      toast({ title: 'Story supprimée' });
    },
    onError: (error: any) => {
      toast({
        title: 'Suppression impossible',
        description: storyErrorMessage(error, "La story n'a pas pu être supprimée."),
        variant: 'destructive',
      });
    },
  });

  const handleDelete = async (story: ApiStory) => {
    const ok = await confirm({
      title: 'Supprimer cette story ?',
      description: 'Elle ne sera plus visible par vos abonnés. Cette action est irréversible.',
      confirmText: 'Supprimer',
      variant: 'destructive',
    });
    if (ok) deleteMutation.mutate(story.id);
  };

  if (!isCreator) {
    return (
      <div className="mx-auto max-w-md py-16 text-center space-y-4">
        <h1 className="text-2xl font-bold">Stories</h1>
        <p className="text-muted-foreground">Seuls les créateurs peuvent publier des stories.</p>
        <Button asChild variant="outline">
          <Link href="/feed">Retour au feed</Link>
        </Button>
      </div>
    );
  }

  const totalViews = stories.reduce((sum, story) => sum + (story._count?.views ?? story.viewCount ?? 0), 0);
  const totalLikes = stories.reduce((sum, story) => sum + (story._count?.likes ?? 0), 0);

  return (
    <div className="max-w-5xl mx-auto space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-3xl font-bold">Mes stories</h1>
          <p className="text-muted-foreground mt-1">
            Vos stories restent visibles 24 heures après leur publication.
          </p>
        </div>
        <Button onClick={() => setCreateOpen(true)} className="w-full sm:w-auto">
          <Plus className="h-4 w-4 mr-2" />
          Nouvelle story
        </Button>
      </div>

      {stories.length > 0 && (
        <div className="grid grid-cols-3 gap-3">
          <Stat label="Stories actives" value={stories.length} />
          <Stat label="Vues" value={totalViews} />
          <Stat label="J'aime" value={totalLikes} />
        </div>
      )}

      {isLoading ? (
        <div className="flex justify-center py-16">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </div>
      ) : isError ? (
        <Card>
          <CardContent className="py-12 text-center space-y-3">
            <p className="text-muted-foreground">Impossible de charger vos stories.</p>
            <Button variant="outline" onClick={() => refetch()}>
              Réessayer
            </Button>
          </CardContent>
        </Card>
      ) : stories.length === 0 ? (
        <Card>
          <CardContent className="py-16 text-center space-y-4">
            <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-muted">
              <Clock className="h-7 w-7 text-muted-foreground" />
            </div>
            <div>
              <p className="font-semibold">Aucune story active</p>
              <p className="text-sm text-muted-foreground">
                Partagez un moment avec vos abonnés : photo, vidéo ou simple texte.
              </p>
            </div>
            <Button onClick={() => setCreateOpen(true)}>
              <Plus className="h-4 w-4 mr-2" />
              Publier ma première story
            </Button>
          </CardContent>
        </Card>
      ) : (
        <ul className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
          {stories.map((story) => (
            <li key={story.id} className="space-y-2">
              <Link
                href={`/stories/${story.creatorId}?story=${story.id}`}
                className="group relative block aspect-[9/16] overflow-hidden rounded-lg bg-muted"
                aria-label="Voir la story"
              >
                <StoryThumbnail story={story} />
                <div className="absolute inset-x-0 top-0 flex items-center justify-between p-2">
                  <Badge variant="secondary" className="gap-1 bg-black/60 text-white hover:bg-black/60">
                    {story.visibility === 'PUBLIC' ? <Globe className="h-3 w-3" /> : <Lock className="h-3 w-3" />}
                    {story.visibility === 'PUBLIC' ? 'Public' : 'Abonnés'}
                  </Badge>
                </div>
                <div className="absolute inset-x-0 bottom-0 flex items-center gap-3 bg-gradient-to-t from-black/80 to-transparent p-2 pt-6 text-xs text-white">
                  <span className="flex items-center gap-1">
                    <Eye className="h-3.5 w-3.5" />
                    {story._count?.views ?? story.viewCount}
                  </span>
                  <span className="flex items-center gap-1">
                    <Heart className="h-3.5 w-3.5" />
                    {story._count?.likes ?? 0}
                  </span>
                </div>
              </Link>
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0 text-xs text-muted-foreground">
                  <p>{formatDistanceToNow(new Date(story.createdAt), { addSuffix: true, locale: fr })}</p>
                  <p>{timeLeftLabel(story.expiresAt)}</p>
                </div>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8 shrink-0 text-destructive hover:text-destructive"
                  onClick={() => handleDelete(story)}
                  disabled={deleteMutation.isPending && deleteMutation.variables === story.id}
                  aria-label="Supprimer la story"
                >
                  {deleteMutation.isPending && deleteMutation.variables === story.id ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Trash2 className="h-4 w-4" />
                  )}
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}

      <CreateStoryDialog open={createOpen} onOpenChange={setCreateOpen} />
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <Card>
      <CardContent className="p-4">
        <p className="text-2xl font-bold">{value}</p>
        <p className="text-xs text-muted-foreground">{label}</p>
      </CardContent>
    </Card>
  );
}

function StoryThumbnail({ story }: { story: ApiStory }) {
  if (story.type === 'TEXT') {
    return (
      <div
        className="flex h-full w-full items-center justify-center p-3"
        style={{ backgroundColor: story.backgroundColor || DEFAULT_STORY_BACKGROUND }}
      >
        <Type className="absolute right-2 bottom-8 h-4 w-4 text-white/60" />
        <p className="line-clamp-6 text-center text-sm font-semibold text-white break-words">{story.text}</p>
      </div>
    );
  }

  return <MediaThumbnail story={story} />;
}

function MediaThumbnail({ story }: { story: ApiStory }) {
  const [broken, setBroken] = useState(false);
  const src = story.type === 'VIDEO' ? story.thumbnailUrl : story.mediaUrl;
  return (
    <>
      {broken ? (
        <div className="flex h-full w-full items-center justify-center text-muted-foreground">
          <ImageOff className="h-8 w-8" />
        </div>
      ) : src ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={src}
          alt={story.caption || 'Story'}
          className="h-full w-full object-cover transition-transform group-hover:scale-105"
          onError={() => setBroken(true)}
        />
      ) : story.type === 'VIDEO' && story.mediaUrl ? (
        <video src={story.mediaUrl} className="h-full w-full object-cover" muted playsInline preload="metadata" />
      ) : null}
      {story.type === 'VIDEO' && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <Play className="h-8 w-8 fill-white/80 text-white/80" />
        </div>
      )}
    </>
  );
}
