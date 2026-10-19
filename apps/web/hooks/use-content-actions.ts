'use client'

import { InfiniteData, QueryClient, useMutation, useQueryClient } from '@tanstack/react-query'
import { contentApi } from '@/lib/api'
import { toast } from '@/hooks/use-toast'

/**
 * Counters carried by content items: feed items use `_count`, the detail
 * endpoint also exposes the denormalized `likeCount` / `commentCount`.
 */
interface CachedContent {
  id: string
  isLiked?: boolean
  likeCount?: number
  commentCount?: number
  _count?: { likes: number; comments: number }
}

export interface ContentPatch {
  isLiked?: boolean
  likeDelta?: number
  commentDelta?: number
}

const bump = (value: number, delta = 0) => Math.max(0, value + delta)

function applyPatch<T extends CachedContent>(item: T, patch: ContentPatch): T {
  const next: T = { ...item }
  if (patch.isLiked !== undefined) next.isLiked = patch.isLiked
  if (typeof next.likeCount === 'number') next.likeCount = bump(next.likeCount, patch.likeDelta)
  if (typeof next.commentCount === 'number') next.commentCount = bump(next.commentCount, patch.commentDelta)
  if (next._count) {
    next._count = {
      likes: bump(next._count.likes, patch.likeDelta),
      comments: bump(next._count.comments, patch.commentDelta),
    }
  }
  return next
}

/**
 * Patch one content everywhere it is cached: the feed tabs (infinite
 * queries of item arrays) and the content detail page.
 */
export function patchContentCaches(queryClient: QueryClient, contentId: string, patch: ContentPatch) {
  queryClient.setQueriesData<InfiniteData<CachedContent[]>>({ queryKey: ['feed'] }, (data) => {
    if (!data?.pages) return data
    return {
      ...data,
      pages: data.pages.map((page) =>
        Array.isArray(page) ? page.map((item) => (item.id === contentId ? applyPatch(item, patch) : item)) : page,
      ),
    }
  })
  queryClient.setQueryData<CachedContent>(['content', contentId], (data) =>
    data ? applyPatch(data, patch) : data,
  )
}

/**
 * Like / unlike with an optimistic update of the counters
 */
export function useToggleLike(content: { id: string; isLiked: boolean }) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async () => {
      const response = await contentApi.likeContent(content.id)
      return response.data as { liked: boolean }
    },
    onMutate: async () => {
      await Promise.all([
        queryClient.cancelQueries({ queryKey: ['feed'] }),
        queryClient.cancelQueries({ queryKey: ['content', content.id] }),
      ])
      const expected = !content.isLiked
      patchContentCaches(queryClient, content.id, { isLiked: expected, likeDelta: expected ? 1 : -1 })
      return { expected }
    },
    onError: (error: any, _vars, context) => {
      if (context) {
        // Roll back the optimistic toggle
        patchContentCaches(queryClient, content.id, {
          isLiked: !context.expected,
          likeDelta: context.expected ? -1 : 1,
        })
      }
      toast({
        title: 'Erreur',
        description: error?.response?.data?.message || "Impossible d'aimer ce contenu.",
        variant: 'destructive',
      })
    },
    onSuccess: (data, _vars, context) => {
      // The server state differed from what we displayed: resync from the source
      if (context && data.liked !== context.expected) {
        queryClient.invalidateQueries({ queryKey: ['feed'] })
        queryClient.invalidateQueries({ queryKey: ['content', content.id] })
      }
    },
  })
}

export function contentUrl(contentId: string) {
  const origin = typeof window !== 'undefined' ? window.location.origin : ''
  return `${origin}/content/${contentId}`
}

/**
 * Native share sheet when available, otherwise copy the link
 */
export async function shareContent(content: { id: string; title?: string | null }) {
  const url = contentUrl(content.id)
  if (typeof navigator !== 'undefined' && typeof navigator.share === 'function') {
    try {
      await navigator.share({ title: content.title || 'Publication', url })
      return
    } catch (error: any) {
      // The user closed the share sheet
      if (error?.name === 'AbortError') return
    }
  }
  await copyContentLink(content.id)
}

export async function copyContentLink(contentId: string) {
  try {
    await navigator.clipboard.writeText(contentUrl(contentId))
    toast({ title: 'Lien copié', description: 'Le lien de la publication est dans votre presse-papiers.' })
  } catch {
    toast({
      title: 'Copie impossible',
      description: contentUrl(contentId),
      variant: 'destructive',
    })
  }
}
