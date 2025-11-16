'use client';

import { useState, useEffect, useRef } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import { storiesApi } from '@/lib/api';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { X, ChevronLeft, ChevronRight, Heart, Send, MoreVertical, Pause, Play } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { formatDistanceToNow } from 'date-fns';
import { fr } from 'date-fns/locale';
import { useAuth } from '@/contexts/auth-context';

interface Story {
  id: string;
  userId: string;
  mediaUrl: string;
  mediaType: 'IMAGE' | 'VIDEO';
  caption?: string;
  createdAt: string;
  expiresAt: string;
  views: number;
  user: {
    id: string;
    username: string;
    avatar?: string;
  };
}

interface StoryGroup {
  userId: string;
  user: {
    id: string;
    username: string;
    avatar?: string;
  };
  stories: Story[];
}

const STORY_DURATION = 5000; // 5 seconds for images
const PROGRESS_INTERVAL = 50;

export default function StoriesViewerPage({ params }: { params: { id: string } }) {
  const { user } = useAuth();
  const router = useRouter();

  const [currentStoryIndex, setCurrentStoryIndex] = useState(0);
  const [progress, setProgress] = useState(0);
  const [isPaused, setIsPaused] = useState(false);
  const [isLiked, setIsLiked] = useState(false);
  const [replyText, setReplyText] = useState('');

  const videoRef = useRef<HTMLVideoElement>(null);
  const progressTimerRef = useRef<NodeJS.Timeout>();

  // Fetch story group
  const { data: storyGroup, isLoading } = useQuery({
    queryKey: ['story-group', params.id],
    queryFn: async () => {
      const response = await storiesApi.getGroup(params.id);
      return response.data as StoryGroup;
    },
  });

  // Mark story as viewed
  const markViewedMutation = useMutation({
    mutationFn: async (storyId: string) => {
      await storiesApi.markAsViewed(storyId);
    },
  });

  // Like story mutation
  const likeStoryMutation = useMutation({
    mutationFn: async (storyId: string) => {
      await storiesApi.like(storyId);
    },
  });

  // Send reply mutation
  const sendReplyMutation = useMutation({
    mutationFn: async ({ storyId, message }: { storyId: string; message: string }) => {
      await storiesApi.reply(storyId, message);
    },
    onSuccess: () => {
      setReplyText('');
    },
  });

  const currentStory = storyGroup?.stories[currentStoryIndex];
  const isVideo = currentStory?.mediaType === 'VIDEO';

  // Progress bar animation
  useEffect(() => {
    if (!currentStory || isPaused) return;

    const duration = isVideo
      ? (videoRef.current?.duration || STORY_DURATION / 1000) * 1000
      : STORY_DURATION;

    if (progress >= 100) {
      handleNextStory();
      return;
    }

    progressTimerRef.current = setInterval(() => {
      setProgress(prev => {
        const increment = (PROGRESS_INTERVAL / duration) * 100;
        return Math.min(prev + increment, 100);
      });
    }, PROGRESS_INTERVAL);

    return () => {
      if (progressTimerRef.current) {
        clearInterval(progressTimerRef.current);
      }
    };
  }, [currentStory, isPaused, progress]);

  // Mark current story as viewed
  useEffect(() => {
    if (currentStory) {
      markViewedMutation.mutate(currentStory.id);
      setProgress(0);
      setIsLiked(false);
    }
  }, [currentStory?.id]);

  // Video playback control
  useEffect(() => {
    if (videoRef.current) {
      if (isPaused) {
        videoRef.current.pause();
      } else {
        videoRef.current.play();
      }
    }
  }, [isPaused]);

  const handleNextStory = () => {
    if (!storyGroup) return;

    if (currentStoryIndex < storyGroup.stories.length - 1) {
      setCurrentStoryIndex(prev => prev + 1);
      setProgress(0);
    } else {
      router.back();
    }
  };

  const handlePrevStory = () => {
    if (currentStoryIndex > 0) {
      setCurrentStoryIndex(prev => prev - 1);
      setProgress(0);
    } else {
      router.back();
    }
  };

  const handleLike = () => {
    if (!currentStory) return;
    setIsLiked(!isLiked);
    likeStoryMutation.mutate(currentStory.id);
  };

  const handleReply = () => {
    if (!currentStory || !replyText.trim()) return;
    sendReplyMutation.mutate({
      storyId: currentStory.id,
      message: replyText,
    });
  };

  const handleTap = (e: React.MouseEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const isLeftSide = x < rect.width / 3;
    const isRightSide = x > (rect.width / 3) * 2;

    if (isLeftSide) {
      handlePrevStory();
    } else if (isRightSide) {
      handleNextStory();
    } else {
      setIsPaused(!isPaused);
    }
  };

  // Keyboard navigation
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'ArrowLeft') handlePrevStory();
      if (e.key === 'ArrowRight') handleNextStory();
      if (e.key === 'Escape') router.back();
      if (e.key === ' ') {
        e.preventDefault();
        setIsPaused(!isPaused);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [currentStoryIndex, isPaused]);

  // Touch swipe support
  const touchStartX = useRef(0);
  const touchEndX = useRef(0);

  const handleTouchStart = (e: React.TouchEvent) => {
    touchStartX.current = e.touches[0].clientX;
  };

  const handleTouchEnd = (e: React.TouchEvent) => {
    touchEndX.current = e.changedTouches[0].clientX;

    const swipeDistance = touchStartX.current - touchEndX.current;
    const threshold = 50;

    if (swipeDistance > threshold) {
      handleNextStory();
    } else if (swipeDistance < -threshold) {
      handlePrevStory();
    }
  };

  if (isLoading || !storyGroup || !currentStory) {
    return (
      <div className="fixed inset-0 bg-black flex items-center justify-center z-50">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-white"></div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 bg-black z-50 flex flex-col">
      {/* Progress bars */}
      <div className="absolute top-0 left-0 right-0 z-20 flex gap-1 p-2">
        {storyGroup.stories.map((story, index) => (
          <div
            key={story.id}
            className="flex-1 h-1 bg-white/30 rounded-full overflow-hidden"
          >
            <div
              className="h-full bg-white transition-all duration-100"
              style={{
                width: index < currentStoryIndex
                  ? '100%'
                  : index === currentStoryIndex
                    ? `$${progress}%`
                    : '0%'
              }}
            />
          </div>
        ))}
      </div>

      {/* Header */}
      <div className="absolute top-4 left-0 right-0 z-20 px-4 pt-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Avatar className="h-10 w-10 border-2 border-white">
            <AvatarImage src={storyGroup.user.avatar} />
            <AvatarFallback className="bg-white text-black">
              {storyGroup.user.username.substring(0, 2).toUpperCase()}
            </AvatarFallback>
          </Avatar>
          <div className="text-white">
            <p className="font-semibold">@{storyGroup.user.username}</p>
            <p className="text-xs text-white/80">
              {formatDistanceToNow(new Date(currentStory.createdAt), {
                addSuffix: true,
                locale: fr,
              })}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <Button
            variant="ghost"
            size="icon"
            className="text-white hover:bg-white/20"
            onClick={() => setIsPaused(!isPaused)}
          >
            {isPaused ? <Play className="h-5 w-5" /> : <Pause className="h-5 w-5" />}
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="text-white hover:bg-white/20"
            onClick={() => router.back()}
          >
            <X className="h-5 w-5" />
          </Button>
        </div>
      </div>

      {/* Story content */}
      <div
        className="flex-1 relative flex items-center justify-center cursor-pointer"
        onClick={handleTap}
        onTouchStart={handleTouchStart}
        onTouchEnd={handleTouchEnd}
      >
        {isVideo ? (
          <video
            ref={videoRef}
            src={currentStory.mediaUrl}
            className="max-h-full max-w-full object-contain"
            autoPlay
            muted={false}
            onEnded={handleNextStory}
          />
        ) : (
          <img
            src={currentStory.mediaUrl}
            alt="Story"
            className="max-h-full max-w-full object-contain"
          />
        )}

        {/* Navigation hints */}
        <div className="absolute inset-y-0 left-0 w-1/3 flex items-center justify-start pl-4 opacity-0 hover:opacity-100 transition-opacity">
          <ChevronLeft className="h-12 w-12 text-white/50" />
        </div>
        <div className="absolute inset-y-0 right-0 w-1/3 flex items-center justify-end pr-4 opacity-0 hover:opacity-100 transition-opacity">
          <ChevronRight className="h-12 w-12 text-white/50" />
        </div>

        {/* Caption */}
        {currentStory.caption && (
          <div className="absolute bottom-20 left-4 right-4 text-white">
            <p className="text-sm">{currentStory.caption}</p>
          </div>
        )}
      </div>

      {/* Action bar */}
      <div className="absolute bottom-0 left-0 right-0 z-20 p-4 bg-gradient-to-t from-black/80 to-transparent">
        <div className="flex items-center gap-2">
          <Button
            variant="ghost"
            size="icon"
            className={`text-white hover:bg-white/20 $${isLiked ? 'text-red-500' : ''}`}
            onClick={handleLike}
          >
            <Heart className={`h-6 w-6 $${isLiked ? 'fill-current' : ''}`} />
          </Button>

          <div className="flex-1 flex items-center gap-2">
            <input
              type="text"
              placeholder="Envoyer un message..."
              value={replyText}
              onChange={(e) => setReplyText(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleReply()}
              className="flex-1 bg-white/20 text-white placeholder:text-white/60 border border-white/30 rounded-full px-4 py-2 outline-none focus:bg-white/30"
            />
            <Button
              variant="ghost"
              size="icon"
              className="text-white hover:bg-white/20"
              onClick={handleReply}
              disabled={!replyText.trim() || sendReplyMutation.isPending}
            >
              <Send className="h-5 w-5" />
            </Button>
          </div>

          <Button
            variant="ghost"
            size="icon"
            className="text-white hover:bg-white/20"
          >
            <MoreVertical className="h-5 w-5" />
          </Button>
        </div>
      </div>
    </div>
  );
}
