'use client';

import { useState, useEffect, useLayoutEffect, useMemo, useRef, useCallback } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useQuery, useMutation, useQueryClient, useInfiniteQuery } from '@tanstack/react-query';
import { formatDistanceToNow } from 'date-fns';
import { fr } from 'date-fns/locale';
import {
  X,
  Heart,
  Send,
  Pause,
  Play,
  Eye,
  Trash2,
  Lock,
  Volume2,
  VolumeX,
  Loader2,
  ImageOff,
  Plus,
  Globe,
} from 'lucide-react';
import { storiesApi } from '@/lib/api';
import { AgeGatedMedia } from '@/components/age-verification/age-gated-media';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { useAuth } from '@/contexts/auth-context';
import { useConfirm } from '@/hooks/use-confirm';
import { toast } from '@/hooks/use-toast';
import { cn } from '@/lib/utils';
import {
  ApiStory,
  StoryCreator,
  StoryFeedGroup,
  DEFAULT_STORY_BACKGROUND,
  creatorInitials,
  creatorName,
  storyErrorMessage,
} from '@/components/stories/story-utils';

interface Story extends ApiStory {
  mediaType: 'IMAGE' | 'VIDEO' | 'TEXT';
  views: number;
  likes: number;
  user: StoryCreator;
}

interface StoryGroup {
  userId: string;
  user: StoryCreator;
  stories: Story[];
}

interface StoryViewer {
  id: string;
  viewerId: string;
  viewedAt: string;
  hasLiked: boolean;
  viewer: StoryCreator;
}

const STORY_DURATION = 5000; // 5 seconds for images, text and locked stories
const HOLD_DELAY = 200; // press longer than this pauses instead of navigating
const SWIPE_THRESHOLD = 60;

export default function StoriesViewerPage({
  params,
  searchParams,
}: {
  params: { id: string };
  searchParams?: { story?: string };
}) {
  const { user } = useAuth();
  const router = useRouter();
  const queryClient = useQueryClient();
  const { confirm } = useConfirm();
  const groupKey = ['story-group', params.id];

  const [currentStoryIndex, setCurrentStoryIndex] = useState(0);
  const [progress, setProgress] = useState(0);
  const [manualPaused, setManualPaused] = useState(false);
  const [holding, setHolding] = useState(false);
  const [replyFocused, setReplyFocused] = useState(false);
  const [viewersOpen, setViewersOpen] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [pageHidden, setPageHidden] = useState(false);
  const [mediaReady, setMediaReady] = useState(false);
  const [mediaError, setMediaError] = useState(false);
  const [muted, setMuted] = useState(false);
  const [replyText, setReplyText] = useState('');

  const videoRef = useRef<HTMLVideoElement>(null);
  const elapsedRef = useRef(0);
  const initializedRef = useRef(false);

  // Fetch story group (chronological)
  const {
    data: storyGroup,
    isLoading,
    isError,
    refetch,
  } = useQuery({
    queryKey: groupKey,
    queryFn: async () => {
      const response = await storiesApi.getGroup(params.id);
      return response.data as StoryGroup;
    },
  });

  // Stories feed: used to move on to the next creator's stories. Never refetched while
  // watching so the order does not shift as stories get marked as seen.
  const { data: feedGroups } = useQuery({
    queryKey: ['stories-feed'],
    queryFn: async () => {
      const response = await storiesApi.getFeed();
      return (Array.isArray(response.data) ? response.data : []) as StoryFeedGroup[];
    },
    staleTime: Infinity,
  });

  const stories = useMemo(() => storyGroup?.stories ?? [], [storyGroup]);
  const currentStory: Story | undefined = stories[Math.min(currentStoryIndex, stories.length - 1)];
  const isVideo = currentStory?.mediaType === 'VIDEO' && !currentStory.isLocked;
  const isOwnStory = !!user && (storyGroup?.userId === user.id || !!currentStory?.isOwn);
  const creator = currentStory?.creator ?? storyGroup?.user;

  const isPaused =
    manualPaused || holding || replyFocused || viewersOpen || confirmOpen || pageHidden || !mediaReady;

  // Start on the requested story, or on the first one not yet seen
  useEffect(() => {
    if (!storyGroup || initializedRef.current) return;
    initializedRef.current = true;
    const requested = searchParams?.story
      ? storyGroup.stories.findIndex((story) => story.id === searchParams.story)
      : -1;
    const firstUnseen = storyGroup.stories.findIndex((story) => !story.isViewed);
    setCurrentStoryIndex(requested >= 0 ? requested : firstUnseen >= 0 ? firstUnseen : 0);
  }, [storyGroup, searchParams?.story]);

  const close = useCallback(() => {
    if (typeof window !== 'undefined' && window.history.length > 1) {
      router.back();
    } else {
      router.push('/feed');
    }
  }, [router]);

  const adjacentGroupId = useCallback(
    (offset: 1 | -1) => {
      if (!feedGroups?.length) return null;
      const index = feedGroups.findIndex((group) => group.creator.id === params.id);
      if (index === -1) return null;
      return feedGroups[index + offset]?.creator.id ?? null;
    },
    [feedGroups, params.id],
  );

  const goToNextGroup = useCallback(() => {
    const nextId = adjacentGroupId(1);
    if (nextId && nextId !== params.id) {
      router.replace(`/stories/${nextId}`);
    } else {
      close();
    }
  }, [adjacentGroupId, close, params.id, router]);

  const goToPrevGroup = useCallback(() => {
    const prevId = adjacentGroupId(-1);
    if (prevId) router.replace(`/stories/${prevId}`);
  }, [adjacentGroupId, router]);

  const restartStory = useCallback(() => {
    elapsedRef.current = 0;
    setProgress(0);
    if (videoRef.current) videoRef.current.currentTime = 0;
  }, []);

  const handleNextStory = useCallback(() => {
    if (!storyGroup) return;
    if (currentStoryIndex < storyGroup.stories.length - 1) {
      setCurrentStoryIndex((prev) => prev + 1);
    } else {
      goToNextGroup();
    }
  }, [currentStoryIndex, goToNextGroup, storyGroup]);

  const handlePrevStory = useCallback(() => {
    if (currentStoryIndex > 0) {
      setCurrentStoryIndex((prev) => prev - 1);
    } else {
      restartStory();
    }
  }, [currentStoryIndex, restartStory]);

  // Latest handlers for timers and listeners
  const nextRef = useRef(handleNextStory);
  const prevRef = useRef(handlePrevStory);
  nextRef.current = handleNextStory;
  prevRef.current = handlePrevStory;

  // Reset playback state when the story changes (layout effect: runs before the media load events)
  useLayoutEffect(() => {
    elapsedRef.current = 0;
    setProgress(0);
    setMediaError(false);
    setMediaReady(!currentStory || currentStory.isLocked || currentStory.mediaType === 'TEXT' || !currentStory.mediaUrl);
  }, [currentStory?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // Progress for images, text and locked stories (videos follow their own playback)
  useEffect(() => {
    if (!currentStory || isPaused || isVideo) return;

    let last = performance.now();
    let frame = 0;
    const tick = (now: number) => {
      elapsedRef.current += now - last;
      last = now;
      const pct = Math.min(100, (elapsedRef.current / STORY_DURATION) * 100);
      setProgress(pct);
      if (pct >= 100) {
        nextRef.current();
        return;
      }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [currentStory?.id, isPaused, isVideo]); // eslint-disable-line react-hooks/exhaustive-deps

  // Video playback control
  useEffect(() => {
    const video = videoRef.current;
    if (!video || !isVideo) return;
    if (isPaused && mediaReady) {
      video.pause();
    } else if (!isPaused) {
      video.play().catch(() => {
        // Autoplay with sound blocked by the browser: retry muted
        if (!video.muted) {
          video.muted = true;
          setMuted(true);
          video.play().catch(() => undefined);
        }
      });
    }
  }, [isPaused, isVideo, mediaReady, currentStory?.id]);

  useEffect(() => {
    if (videoRef.current) videoRef.current.muted = muted;
  }, [muted]);

  // Preload the next image
  useEffect(() => {
    const next = stories[currentStoryIndex + 1];
    if (next?.mediaType === 'IMAGE' && next.mediaUrl) {
      const img = new window.Image();
      img.src = next.mediaUrl;
    }
  }, [currentStoryIndex, stories]);

  // Pause while the tab is hidden
  useEffect(() => {
    const onVisibility = () => setPageHidden(document.hidden);
    document.addEventListener('visibilitychange', onVisibility);
    return () => document.removeEventListener('visibilitychange', onVisibility);
  }, []);

  const updateStoryInCache = useCallback(
    (storyId: string, patch: Partial<Story>) => {
      queryClient.setQueryData<StoryGroup>(groupKey, (old) =>
        old
          ? { ...old, stories: old.stories.map((story) => (story.id === storyId ? { ...story, ...patch } : story)) }
          : old,
      );
    },
    [queryClient, params.id], // eslint-disable-line react-hooks/exhaustive-deps
  );

  // Mark story as viewed
  const markViewedMutation = useMutation({
    mutationFn: (storyId: string) => storiesApi.markAsViewed(storyId),
    onSuccess: (_data, storyId) => {
      updateStoryInCache(storyId, { isViewed: true });
      // Update the stories bar in place (no reorder while watching)
      queryClient.setQueryData<StoryFeedGroup[]>(['stories-feed'], (old) =>
        old?.map((group) => {
          if (group.creator.id !== params.id) return group;
          const groupStories = group.stories.map((story) =>
            story.id === storyId ? { ...story, isViewed: true } : story,
          );
          return { ...group, stories: groupStories, hasUnviewed: groupStories.some((story) => !story.isViewed) };
        }),
      );
    },
  });

  useEffect(() => {
    if (currentStory && !currentStory.isOwn && !currentStory.isLocked && !currentStory.isViewed && !isOwnStory) {
      markViewedMutation.mutate(currentStory.id);
    }
  }, [currentStory?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // Like toggle (optimistic)
  const likeStoryMutation = useMutation({
    mutationFn: async (story: Story) => {
      const response = await storiesApi.like(story.id);
      return response.data as { liked: boolean; likesCount: number };
    },
    onMutate: (story) => {
      updateStoryInCache(story.id, {
        isLiked: !story.isLiked,
        likes: Math.max(0, story.likes + (story.isLiked ? -1 : 1)),
      });
    },
    onSuccess: (result, story) => {
      updateStoryInCache(story.id, { isLiked: result.liked, likes: result.likesCount });
    },
    onError: (error: any, story) => {
      updateStoryInCache(story.id, { isLiked: story.isLiked, likes: story.likes });
      toast({
        title: "Impossible d'aimer cette story",
        description: storyErrorMessage(error, 'Réessayez dans un instant.'),
        variant: 'destructive',
      });
    },
  });

  // Reply: sent as a direct message to the creator
  const sendReplyMutation = useMutation({
    mutationFn: ({ storyId, message }: { storyId: string; message: string }) =>
      storiesApi.reply(storyId, message),
    onSuccess: () => {
      setReplyText('');
      toast({
        title: 'Réponse envoyée',
        description: `Votre message a été envoyé en privé à ${creatorName(creator)}.`,
      });
    },
    onError: (error: any) => {
      toast({
        title: "Impossible d'envoyer la réponse",
        description: storyErrorMessage(error, 'Réessayez dans un instant.'),
        variant: 'destructive',
      });
    },
  });

  // Delete own story
  const deleteMutation = useMutation({
    mutationFn: (storyId: string) => storiesApi.delete(storyId),
    onSuccess: (_data, storyId) => {
      const remaining = stories.filter((story) => story.id !== storyId);
      queryClient.setQueryData<StoryGroup>(groupKey, (old) => (old ? { ...old, stories: remaining } : old));
      queryClient.invalidateQueries({ queryKey: ['my-stories'] });
      queryClient.setQueryData<StoryFeedGroup[]>(['stories-feed'], (old) =>
        old
          ?.map((group) =>
            group.creator.id === params.id
              ? { ...group, stories: group.stories.filter((story) => story.id !== storyId) }
              : group,
          )
          .filter((group) => group.stories.length > 0),
      );
      toast({ title: 'Story supprimée' });
      if (remaining.length === 0) {
        close();
      } else {
        setCurrentStoryIndex((index) => Math.min(index, remaining.length - 1));
      }
    },
    onError: (error: any) => {
      toast({
        title: 'Suppression impossible',
        description: storyErrorMessage(error, "La story n'a pas pu être supprimée."),
        variant: 'destructive',
      });
    },
  });

  const handleDelete = async () => {
    if (!currentStory) return;
    setConfirmOpen(true);
    const ok = await confirm({
      title: 'Supprimer cette story ?',
      description: 'Elle ne sera plus visible par vos abonnés. Cette action est irréversible.',
      confirmText: 'Supprimer',
      variant: 'destructive',
    });
    setConfirmOpen(false);
    if (ok) deleteMutation.mutate(currentStory.id);
  };

  const handleLike = () => {
    if (!currentStory || currentStory.isLocked || likeStoryMutation.isPending) return;
    likeStoryMutation.mutate(currentStory);
  };

  const handleReply = () => {
    const message = replyText.trim();
    if (!currentStory || !message || sendReplyMutation.isPending) return;
    sendReplyMutation.mutate({ storyId: currentStory.id, message });
  };

  // Tap (left third: previous, elsewhere: next), hold to pause, swipe to change creator / close
  const pointerRef = useRef<{ x: number; y: number; timer?: ReturnType<typeof setTimeout>; held: boolean } | null>(
    null,
  );

  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    const state = { x: e.clientX, y: e.clientY, held: false } as NonNullable<typeof pointerRef.current>;
    state.timer = setTimeout(() => {
      state.held = true;
      setHolding(true);
    }, HOLD_DELAY);
    pointerRef.current = state;
  };

  const endPointer = (e: React.PointerEvent<HTMLDivElement>, cancelled = false) => {
    const state = pointerRef.current;
    pointerRef.current = null;
    if (!state) return;
    clearTimeout(state.timer);
    setHolding(false);
    if (cancelled) return;

    const dx = e.clientX - state.x;
    const dy = e.clientY - state.y;
    if (Math.abs(dx) > SWIPE_THRESHOLD && Math.abs(dx) > Math.abs(dy)) {
      if (dx < 0) goToNextGroup();
      else goToPrevGroup();
      return;
    }
    if (dy > SWIPE_THRESHOLD * 1.5 && Math.abs(dy) > Math.abs(dx)) {
      close();
      return;
    }
    if (state.held) return;

    const rect = e.currentTarget.getBoundingClientRect();
    if (e.clientX - rect.left < rect.width / 3) {
      handlePrevStory();
    } else {
      handleNextStory();
    }
  };

  // Keyboard navigation
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) return;
      if (viewersOpen || confirmOpen) return;
      if (e.key === 'ArrowLeft') prevRef.current();
      if (e.key === 'ArrowRight') nextRef.current();
      if (e.key === 'Escape') close();
      if (e.key === ' ') {
        e.preventDefault();
        setManualPaused((paused) => !paused);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [close, confirmOpen, viewersOpen]);

  if (isLoading) {
    return (
      <div className="fixed inset-0 bg-black flex items-center justify-center z-50">
        <Loader2 className="h-10 w-10 animate-spin text-white" aria-label="Chargement" />
      </div>
    );
  }

  if (isError || !storyGroup || !currentStory) {
    const ownEmpty = !isError && user?.id === params.id && user?.role === 'CREATOR';
    return (
      <div className="fixed inset-0 bg-black z-50 flex flex-col items-center justify-center gap-4 px-6 text-center text-white">
        <Button
          variant="ghost"
          size="icon"
          className="absolute right-4 top-4 text-white hover:bg-white/20 hover:text-white"
          onClick={close}
          aria-label="Fermer"
        >
          <X className="h-5 w-5" />
        </Button>
        <ImageOff className="h-12 w-12 text-white/60" />
        <div>
          <p className="text-lg font-semibold">
            {isError ? 'Impossible de charger les stories' : 'Aucune story disponible'}
          </p>
          <p className="mt-1 text-sm text-white/70">
            {isError
              ? 'Vérifiez votre connexion puis réessayez.'
              : searchParams?.story
                ? 'Cette story a expiré ou a été supprimée.'
                : "Ce créateur n'a pas de story active pour le moment."}
          </p>
        </div>
        <div className="flex flex-wrap justify-center gap-2">
          {isError && (
            <Button variant="secondary" onClick={() => refetch()}>
              Réessayer
            </Button>
          )}
          {ownEmpty && (
            <Button asChild variant="secondary">
              <Link href="/creator/stories">
                <Plus className="mr-2 h-4 w-4" />
                Publier une story
              </Link>
            </Button>
          )}
          <Button variant="outline" className="border-white/40 bg-transparent text-white hover:bg-white/10 hover:text-white" onClick={close}>
            Fermer
          </Button>
        </div>
      </div>
    );
  }

  const profileHref = creator?.username ? `/${creator.username}` : null;

  return (
    <div className="fixed inset-0 bg-black z-50 flex items-center justify-center">
      <div className="relative h-full w-full overflow-hidden sm:h-[calc(100vh-2rem)] sm:max-w-[calc((100vh-2rem)*9/16)] sm:rounded-xl bg-neutral-950">
        {/* Progress bars */}
        <div className="absolute top-0 left-0 right-0 z-20 flex gap-1 p-2">
          {stories.map((story, index) => (
            <div key={story.id} className="flex-1 h-1 bg-white/30 rounded-full overflow-hidden">
              <div
                className="h-full bg-white"
                style={{
                  width:
                    index < currentStoryIndex ? '100%' : index === currentStoryIndex ? `${progress}%` : '0%',
                }}
              />
            </div>
          ))}
        </div>

        {/* Header */}
        <div className="absolute top-3 left-0 right-0 z-20 px-3 pt-3 flex items-center justify-between gap-2 bg-gradient-to-b from-black/50 to-transparent pb-6">
          <div className="flex min-w-0 items-center gap-3">
            {profileHref ? (
              <Link href={profileHref} className="flex min-w-0 items-center gap-3">
                <HeaderIdentity creator={creator} createdAt={currentStory.createdAt} />
              </Link>
            ) : (
              <HeaderIdentity creator={creator} createdAt={currentStory.createdAt} />
            )}
            {isOwnStory && (
              <span className="flex shrink-0 items-center gap-1 rounded-full bg-white/20 px-2 py-0.5 text-xs text-white">
                {currentStory.visibility === 'PUBLIC' ? <Globe className="h-3 w-3" /> : <Lock className="h-3 w-3" />}
                {currentStory.visibility === 'PUBLIC' ? 'Public' : 'Abonnés'}
              </span>
            )}
          </div>

          <div className="flex shrink-0 items-center gap-1">
            {isVideo && (
              <Button
                variant="ghost"
                size="icon"
                className="text-white hover:bg-white/20 hover:text-white"
                onClick={() => setMuted((m) => !m)}
                aria-label={muted ? 'Activer le son' : 'Couper le son'}
              >
                {muted ? <VolumeX className="h-5 w-5" /> : <Volume2 className="h-5 w-5" />}
              </Button>
            )}
            <Button
              variant="ghost"
              size="icon"
              className="text-white hover:bg-white/20 hover:text-white"
              onClick={() => setManualPaused((paused) => !paused)}
              aria-label={manualPaused ? 'Lecture' : 'Pause'}
            >
              {manualPaused ? <Play className="h-5 w-5" /> : <Pause className="h-5 w-5" />}
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="text-white hover:bg-white/20 hover:text-white"
              onClick={close}
              aria-label="Fermer"
            >
              <X className="h-5 w-5" />
            </Button>
          </div>
        </div>

        {/* Story content */}
        <div
          className="absolute inset-0 flex items-center justify-center select-none touch-none"
          onPointerDown={handlePointerDown}
          onPointerUp={(e) => endPointer(e)}
          onPointerCancel={(e) => endPointer(e, true)}
          onPointerLeave={(e) => pointerRef.current && endPointer(e, true)}
          onContextMenu={(e) => e.preventDefault()}
        >
          {currentStory.isLocked ? (
            <div className="flex h-full w-full flex-col items-center justify-center gap-4 bg-gradient-to-br from-neutral-800 to-neutral-950 px-8 text-center text-white">
              <div className="rounded-full bg-white/10 p-4">
                <Lock className="h-10 w-10" />
              </div>
              <div>
                <p className="text-lg font-semibold">Story réservée aux abonnés</p>
                <p className="mt-1 text-sm text-white/70">
                  Abonnez-vous à {creatorName(creator)} pour voir cette story.
                </p>
              </div>
              {profileHref && (
                <Button
                  asChild
                  variant="secondary"
                  onPointerDown={(e) => e.stopPropagation()}
                  onPointerUp={(e) => e.stopPropagation()}
                >
                  <Link href={profileHref}>S&apos;abonner</Link>
                </Button>
              )}
            </div>
          ) : currentStory.ageVerificationRequired ? (
            <div className="flex h-full w-full items-center justify-center bg-neutral-950 p-6">
              {/* Taps on the placeholder must not switch to the next story */}
              <div
                className="w-full max-w-sm"
                onPointerDown={(e) => e.stopPropagation()}
                onPointerUp={(e) => e.stopPropagation()}
              >
                <AgeGatedMedia label="Story réservée aux adultes" />
              </div>
            </div>
          ) : currentStory.mediaType === 'TEXT' ? (
            <div
              className="flex h-full w-full items-center justify-center px-8"
              style={{ backgroundColor: currentStory.backgroundColor || DEFAULT_STORY_BACKGROUND }}
            >
              <p className="max-w-md text-center text-2xl font-semibold text-white whitespace-pre-wrap break-words">
                {currentStory.text}
              </p>
            </div>
          ) : mediaError || !currentStory.mediaUrl ? (
            <div className="flex flex-col items-center gap-2 text-white/70">
              <ImageOff className="h-10 w-10" />
              <p className="text-sm">Média indisponible</p>
            </div>
          ) : isVideo ? (
            <video
              key={currentStory.id}
              ref={videoRef}
              src={currentStory.mediaUrl}
              poster={currentStory.thumbnailUrl ?? undefined}
              className="h-full w-full object-contain"
              autoPlay
              playsInline
              muted={muted}
              onCanPlay={() => setMediaReady(true)}
              onTimeUpdate={(e) => {
                const v = e.currentTarget;
                if (v.duration) setProgress((v.currentTime / v.duration) * 100);
              }}
              onEnded={() => nextRef.current()}
              onError={() => {
                setMediaError(true);
                setMediaReady(true);
              }}
            />
          ) : (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              key={currentStory.id}
              src={currentStory.mediaUrl}
              alt={currentStory.caption || `Story de ${creatorName(creator)}`}
              className="h-full w-full object-contain"
              draggable={false}
              onLoad={() => setMediaReady(true)}
              onError={() => {
                setMediaError(true);
                setMediaReady(true);
              }}
            />
          )}

          {!mediaReady && (
            <div className="absolute inset-0 flex items-center justify-center">
              <Loader2 className="h-8 w-8 animate-spin text-white/80" />
            </div>
          )}

          {(manualPaused || holding) && mediaReady && (
            <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
              {manualPaused && <Pause className="h-14 w-14 text-white/70" />}
            </div>
          )}

          {/* Caption */}
          {currentStory.caption && !currentStory.isLocked && (
            <div className="pointer-events-none absolute bottom-24 left-4 right-4 text-center text-white">
              <p className="inline-block rounded-lg bg-black/40 px-3 py-1.5 text-sm">{currentStory.caption}</p>
            </div>
          )}
        </div>

        {/* Owner bar: viewers, likes, delete */}
        {isOwnStory ? (
          <div className="absolute bottom-0 left-0 right-0 z-20 flex items-center justify-between gap-2 bg-gradient-to-t from-black/80 to-transparent p-4">
            <Button
              variant="ghost"
              className="text-white hover:bg-white/20 hover:text-white"
              onClick={() => setViewersOpen(true)}
            >
              <Eye className="mr-2 h-5 w-5" />
              Vu par {currentStory.views}
            </Button>
            <div className="flex items-center gap-2">
              <span className="flex items-center gap-1 text-sm text-white" aria-label={`${currentStory.likes} j'aime`}>
                <Heart className="h-4 w-4" />
                {currentStory.likes}
              </span>
              <Button
                variant="ghost"
                size="icon"
                className="text-white hover:bg-white/20 hover:text-white"
                onClick={handleDelete}
                disabled={deleteMutation.isPending}
                aria-label="Supprimer la story"
              >
                {deleteMutation.isPending ? <Loader2 className="h-5 w-5 animate-spin" /> : <Trash2 className="h-5 w-5" />}
              </Button>
            </div>
          </div>
        ) : (
          !currentStory.isLocked && (
            <div className="absolute bottom-0 left-0 right-0 z-20 p-4 bg-gradient-to-t from-black/80 to-transparent">
              <form
                className="flex items-center gap-2"
                onSubmit={(e) => {
                  e.preventDefault();
                  handleReply();
                }}
              >
                <input
                  type="text"
                  placeholder={`Répondre à ${creatorName(creator)}…`}
                  value={replyText}
                  maxLength={1000}
                  onChange={(e) => setReplyText(e.target.value)}
                  onFocus={() => setReplyFocused(true)}
                  onBlur={() => setReplyFocused(false)}
                  disabled={sendReplyMutation.isPending}
                  className="min-w-0 flex-1 bg-white/20 text-white placeholder:text-white/60 border border-white/30 rounded-full px-4 py-2 outline-none focus:bg-white/30"
                  aria-label="Répondre à la story"
                />
                {replyText.trim() ? (
                  <Button
                    type="submit"
                    variant="ghost"
                    size="icon"
                    className="text-white hover:bg-white/20 hover:text-white"
                    disabled={sendReplyMutation.isPending}
                    aria-label="Envoyer"
                  >
                    {sendReplyMutation.isPending ? (
                      <Loader2 className="h-5 w-5 animate-spin" />
                    ) : (
                      <Send className="h-5 w-5" />
                    )}
                  </Button>
                ) : (
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className={cn('hover:bg-white/20', currentStory.isLiked ? 'text-red-500 hover:text-red-500' : 'text-white hover:text-white')}
                    onClick={handleLike}
                    aria-pressed={currentStory.isLiked}
                    aria-label={currentStory.isLiked ? "Je n'aime plus" : "J'aime"}
                  >
                    <Heart className={cn('h-6 w-6', currentStory.isLiked && 'fill-current')} />
                  </Button>
                )}
              </form>
            </div>
          )
        )}
      </div>

      {isOwnStory && (
        <ViewersDialog
          storyId={viewersOpen ? currentStory.id : null}
          total={currentStory.views}
          onClose={() => setViewersOpen(false)}
        />
      )}
    </div>
  );
}

function HeaderIdentity({ creator, createdAt }: { creator?: StoryCreator; createdAt: string }) {
  return (
    <>
      <Avatar className="h-9 w-9 shrink-0 border-2 border-white">
        <AvatarImage src={creator?.avatar ?? undefined} />
        <AvatarFallback className="bg-white text-black text-xs">{creatorInitials(creator)}</AvatarFallback>
      </Avatar>
      <div className="min-w-0 text-white">
        <p className="truncate text-sm font-semibold">{creator?.displayName || `@${creator?.username ?? ''}`}</p>
        <p className="text-xs text-white/80">
          {formatDistanceToNow(new Date(createdAt), { addSuffix: true, locale: fr })}
        </p>
      </div>
    </>
  );
}

function ViewersDialog({
  storyId,
  total,
  onClose,
}: {
  storyId: string | null;
  total: number;
  onClose: () => void;
}) {
  const { data, isLoading, isError, refetch, hasNextPage, fetchNextPage, isFetchingNextPage } = useInfiniteQuery({
    queryKey: ['story-viewers', storyId],
    queryFn: async ({ pageParam }) => {
      const response = await storiesApi.getViewers(storyId as string, pageParam);
      return response.data as { items: StoryViewer[]; total: number; page: number; totalPages: number };
    },
    initialPageParam: 1,
    getNextPageParam: (last) => (last.page < last.totalPages ? last.page + 1 : undefined),
    enabled: !!storyId,
  });

  const viewers = data?.pages.flatMap((page) => page.items) ?? [];
  const count = data?.pages[0]?.total ?? total;

  return (
    <Dialog open={!!storyId} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[80vh] overflow-y-auto sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Vu par {count}</DialogTitle>
          <DialogDescription>Les personnes qui ont vu cette story.</DialogDescription>
        </DialogHeader>
        {isLoading ? (
          <div className="flex justify-center py-8">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : isError ? (
          <div className="py-6 text-center text-sm text-muted-foreground">
            <p>Impossible de charger la liste.</p>
            <Button variant="outline" size="sm" className="mt-3" onClick={() => refetch()}>
              Réessayer
            </Button>
          </div>
        ) : viewers.length === 0 ? (
          <p className="py-8 text-center text-sm text-muted-foreground">Personne n&apos;a encore vu cette story.</p>
        ) : (
          <ul className="divide-y">
            {viewers.map((view) => (
              <li key={view.id} className="flex items-center gap-3 py-2">
                <Avatar className="h-9 w-9">
                  <AvatarImage src={view.viewer.avatar ?? undefined} />
                  <AvatarFallback>{creatorInitials(view.viewer)}</AvatarFallback>
                </Avatar>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{view.viewer.displayName || view.viewer.username}</p>
                  <p className="text-xs text-muted-foreground">
                    @{view.viewer.username} ·{' '}
                    {formatDistanceToNow(new Date(view.viewedAt), { addSuffix: true, locale: fr })}
                  </p>
                </div>
                {view.hasLiked && <Heart className="h-4 w-4 fill-red-500 text-red-500" aria-label="A aimé" />}
              </li>
            ))}
          </ul>
        )}
        {hasNextPage && (
          <Button variant="outline" onClick={() => fetchNextPage()} disabled={isFetchingNextPage}>
            {isFetchingNextPage && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Voir plus
          </Button>
        )}
      </DialogContent>
    </Dialog>
  );
}
