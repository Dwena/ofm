// Shared types and helpers for stories (viewer, stories bar, creator page)

export interface StoryCreator {
  id: string
  username: string
  displayName?: string | null
  avatar?: string | null
}

// Shape returned by /stories/feed, /stories/creator/:id and /stories/me
export interface ApiStory {
  id: string
  creatorId: string
  type: 'PHOTO' | 'VIDEO' | 'TEXT'
  mediaUrl?: string | null
  thumbnailUrl?: string | null
  text?: string | null
  caption?: string | null
  backgroundColor?: string | null
  duration?: number | null
  visibility: 'PUBLIC' | 'SUBSCRIBERS_ONLY' | 'PRIVATE'
  viewCount: number
  createdAt: string
  expiresAt: string
  creator: StoryCreator
  _count?: { views: number; likes: number }
  isOwn: boolean
  isLiked: boolean
  isViewed: boolean
  isLocked: boolean
}

export interface StoryFeedGroup {
  creator: StoryCreator
  stories: ApiStory[]
  hasUnviewed: boolean
  isOwn: boolean
}

export const STORY_BACKGROUNDS = [
  '#7c3aed',
  '#db2777',
  '#ea580c',
  '#16a34a',
  '#0891b2',
  '#2563eb',
  '#111827',
]

export const DEFAULT_STORY_BACKGROUND = STORY_BACKGROUNDS[0]

const API_MESSAGES: Record<string, string> = {
  'This creator does not accept messages': "Ce créateur n'accepte pas les messages privés.",
  'This story is reserved for subscribers': 'Cette story est réservée aux abonnés.',
  'Story not found': "Cette story n'existe plus.",
  'Story has expired': 'Cette story a expiré.',
  'You cannot reply to your own story': 'Vous ne pouvez pas répondre à votre propre story.',
  'Only creators can create stories': 'Seuls les créateurs peuvent publier des stories.',
  'You do not have permission to access this resource': "Vous n'avez pas les droits pour cette action.",
  'You can only publish your own media': 'Ce média ne vous appartient pas.',
  'You can only delete your own stories': 'Vous ne pouvez supprimer que vos propres stories.',
  'No file provided': 'Aucun fichier fourni.',
}

/**
 * French message for an API error (falls back to the given default)
 */
export function storyErrorMessage(error: any, fallback: string): string {
  const raw = error?.response?.data?.message
  const message = Array.isArray(raw) ? raw[0] : raw
  if (typeof message !== 'string' || !message) return fallback
  return API_MESSAGES[message] ?? (/[àâçéèêëîïôûùüÿœ]/i.test(message) ? message : fallback)
}

export function creatorName(creator?: StoryCreator | null) {
  return creator?.displayName || (creator?.username ? `@${creator.username}` : 'Créateur')
}

export function creatorInitials(creator?: StoryCreator | null) {
  return (creator?.displayName || creator?.username || '?').substring(0, 2).toUpperCase()
}

/**
 * "il reste 3 h" style label for the time left before a story expires
 */
export function timeLeftLabel(expiresAt: string) {
  const minutes = Math.max(0, Math.round((new Date(expiresAt).getTime() - Date.now()) / 60000))
  if (minutes < 60) return `expire dans ${minutes} min`
  return `expire dans ${Math.floor(minutes / 60)} h`
}
