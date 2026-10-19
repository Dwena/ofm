'use client'

import Link from 'next/link'
import { useQuery } from '@tanstack/react-query'
import { storiesApi } from '@/lib/api'
import { cn } from '@/lib/utils'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'

interface StoryGroup {
  creator: {
    id: string
    username: string
    displayName?: string | null
    avatar?: string | null
  }
  stories: { id: string; isViewed?: boolean }[]
  hasUnviewed?: boolean
  isOwn?: boolean
}

interface StoriesBarProps {
  className?: string
}

/**
 * Story rings of the creators the user is subscribed to (plus the user's own
 * stories), linking to the stories viewer. Renders nothing when there is no
 * active story.
 */
export default function StoriesBar({ className }: StoriesBarProps) {
  const { data: groups = [], isLoading } = useQuery({
    queryKey: ['stories-feed'],
    queryFn: async () => {
      const response = await storiesApi.getFeed()
      return (Array.isArray(response.data) ? response.data : []) as StoryGroup[]
    },
    refetchInterval: 60000,
  })

  if (isLoading) {
    return (
      <div className={cn('flex gap-4 overflow-hidden', className)} aria-hidden>
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="flex flex-col items-center gap-2 flex-shrink-0">
            <div className="h-16 w-16 rounded-full bg-muted animate-pulse" />
            <div className="h-3 w-12 rounded bg-muted animate-pulse" />
          </div>
        ))}
      </div>
    )
  }

  const visibleGroups = groups.filter((group) => group.creator?.id && group.stories?.length > 0)
  if (visibleGroups.length === 0) return null

  return (
    <section className={className} aria-label="Stories">
      <div className="flex gap-4 overflow-x-auto pb-2 -mx-1 px-1">
        {visibleGroups.map((group) => {
          const name = group.isOwn
            ? 'Votre story'
            : group.creator.displayName || group.creator.username
          const unseen = !!group.hasUnviewed
          return (
            <Link
              key={group.creator.id}
              href={`/stories/${group.creator.id}`}
              className="flex flex-col items-center gap-1 flex-shrink-0 w-[72px] group focus:outline-none"
              title={
                unseen
                  ? `${name} · nouvelle${group.stories.length > 1 ? 's' : ''} story`
                  : name
              }
            >
              <span
                className={cn(
                  'rounded-full p-[3px] transition-transform group-hover:scale-105 group-focus-visible:ring-2 group-focus-visible:ring-ring',
                  unseen
                    ? 'bg-gradient-to-tr from-yellow-400 via-pink-500 to-purple-600'
                    : 'bg-muted-foreground/30',
                )}
              >
                <Avatar className="h-16 w-16 border-2 border-background">
                  <AvatarImage src={group.creator.avatar || undefined} alt={name} />
                  <AvatarFallback>
                    {(group.creator.username || '?').substring(0, 2).toUpperCase()}
                  </AvatarFallback>
                </Avatar>
              </span>
              <span
                className={cn(
                  'text-xs truncate w-full text-center',
                  unseen ? 'font-medium' : 'text-muted-foreground',
                )}
              >
                {name}
              </span>
            </Link>
          )
        })}
      </div>
    </section>
  )
}
