'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useQuery } from '@tanstack/react-query'
import { Plus } from 'lucide-react'
import { storiesApi } from '@/lib/api'
import { useAuth } from '@/contexts/auth-context'
import { cn } from '@/lib/utils'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { CreateStoryDialog } from './create-story-dialog'
import { creatorInitials, StoryFeedGroup } from './story-utils'

/**
 * Horizontal list of active stories (own stories first, unseen next).
 * Creators get a "Votre story" button to publish a new one.
 */
export function StoriesBar() {
  const { user } = useAuth()
  const [createOpen, setCreateOpen] = useState(false)
  const isCreator = user?.role === 'CREATOR'

  const { data: groups = [], isLoading } = useQuery({
    queryKey: ['stories-feed'],
    queryFn: async () => {
      const response = await storiesApi.getFeed()
      return (Array.isArray(response.data) ? response.data : []) as StoryFeedGroup[]
    },
    staleTime: 30_000,
  })

  const ownGroup = groups.find((group) => group.isOwn)
  const otherGroups = groups.filter((group) => !group.isOwn)

  if (isLoading) {
    return (
      <div className="flex gap-4 overflow-hidden" aria-hidden>
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="flex flex-col items-center gap-1">
            <div className="h-16 w-16 animate-pulse rounded-full bg-muted" />
            <div className="h-3 w-12 animate-pulse rounded bg-muted" />
          </div>
        ))}
      </div>
    )
  }

  if (!isCreator && otherGroups.length === 0) return null

  return (
    <div className="-mx-4 overflow-x-auto px-4 pb-1 sm:mx-0 sm:px-0">
      <ul className="flex gap-4" aria-label="Stories">
        {isCreator && (
          <li className="flex w-16 shrink-0 flex-col items-center gap-1">
            <div className="relative">
              {ownGroup ? (
                <Link href={`/stories/${ownGroup.creator.id}`} aria-label="Voir votre story">
                  <StoryRing seen={!ownGroup.hasUnviewed} avatar={user?.avatar} fallback={creatorInitials(user)} />
                </Link>
              ) : (
                <button type="button" onClick={() => setCreateOpen(true)} aria-label="Publier une story">
                  <StoryRing none avatar={user?.avatar} fallback={creatorInitials(user)} />
                </button>
              )}
              <button
                type="button"
                onClick={() => setCreateOpen(true)}
                className="absolute -bottom-0.5 -right-0.5 flex h-6 w-6 items-center justify-center rounded-full border-2 border-background bg-primary text-primary-foreground"
                aria-label="Nouvelle story"
              >
                <Plus className="h-3.5 w-3.5" />
              </button>
            </div>
            <span className="w-full truncate text-center text-xs">Votre story</span>
          </li>
        )}

        {otherGroups.map((group) => (
          <li key={group.creator.id} className="w-16 shrink-0">
            <Link
              href={`/stories/${group.creator.id}`}
              className="flex flex-col items-center gap-1"
              aria-label={`Stories de ${group.creator.displayName || group.creator.username}`}
            >
              <StoryRing
                seen={!group.hasUnviewed}
                avatar={group.creator.avatar}
                fallback={creatorInitials(group.creator)}
              />
              <span className={cn('w-full truncate text-center text-xs', !group.hasUnviewed && 'text-muted-foreground')}>
                {group.creator.displayName || group.creator.username}
              </span>
            </Link>
          </li>
        ))}
      </ul>

      {isCreator && <CreateStoryDialog open={createOpen} onOpenChange={setCreateOpen} />}
    </div>
  )
}

function StoryRing({
  avatar,
  fallback,
  seen,
  none,
}: {
  avatar?: string | null
  fallback: string
  seen?: boolean
  none?: boolean
}) {
  return (
    <span
      className={cn(
        'block rounded-full p-[2px]',
        none ? 'bg-muted' : seen ? 'bg-muted-foreground/30' : 'bg-gradient-to-tr from-amber-400 via-pink-500 to-purple-600',
      )}
    >
      <span className="block rounded-full bg-background p-[2px]">
        <Avatar className="h-14 w-14">
          <AvatarImage src={avatar ?? undefined} />
          <AvatarFallback>{fallback}</AvatarFallback>
        </Avatar>
      </span>
    </span>
  )
}
