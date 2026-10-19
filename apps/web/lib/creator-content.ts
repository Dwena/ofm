// Shared helpers for the creator content screens (dashboard, upload, content management)

export type ContentVisibility = 'PUBLIC' | 'SUBSCRIBERS_ONLY' | 'PREMIUM_SUBSCRIBERS' | 'PPV' | 'PRIVATE'
export type ContentStatusFilter = 'ALL' | 'PUBLISHED' | 'DRAFT' | 'SCHEDULED' | 'ARCHIVED' | 'REVIEW'
export type DisplayStatus = 'PUBLISHED' | 'DRAFT' | 'SCHEDULED' | 'ARCHIVED' | 'UNDER_REVIEW' | 'REJECTED'

export interface CreatorContentStats {
  views: number
  likes: number
  comments: number
  unlocks: number
  revenue: number
}

export interface CreatorContentItem {
  id: string
  type: 'PHOTO' | 'VIDEO' | 'AUDIO' | 'TEXT' | 'ALBUM'
  title: string | null
  description: string | null
  status: 'DRAFT' | 'PUBLISHED' | 'ARCHIVED' | 'UNDER_REVIEW' | 'REJECTED'
  visibility: ContentVisibility
  isPpv: boolean
  ppvPrice: number | null
  scheduledFor: string | null
  publishedAt: string | null
  createdAt: string
  moderationNotes?: string | null
  mediaCount: number
  files: { id: string; type: string; url: string; thumbnailUrl?: string | null }[]
  stats: CreatorContentStats
}

export interface CreatorContentPage {
  items: CreatorContentItem[]
  total: number
  page: number
  limit: number
  totalPages: number
  counts: Record<ContentStatusFilter, number>
}

export const PPV_MIN_PRICE = 0.5
export const PPV_MAX_PRICE = 999.99

export const VISIBILITY_OPTIONS: { value: ContentVisibility; label: string; description: string }[] = [
  { value: 'PUBLIC', label: 'Public', description: 'Visible par tout le monde' },
  { value: 'SUBSCRIBERS_ONLY', label: 'Abonnés', description: 'Réservé à vos abonnés' },
  { value: 'PREMIUM_SUBSCRIBERS', label: 'Abonnés Premium', description: 'Réservé aux paliers premium' },
  { value: 'PPV', label: 'Pay-Per-View', description: 'Débloqué contre paiement' },
  { value: 'PRIVATE', label: 'Privé', description: 'Visible par vous seul(e)' },
]

export const visibilityLabel = (visibility: string) =>
  VISIBILITY_OPTIONS.find((option) => option.value === visibility)?.label ?? visibility

export function displayStatus(item: Pick<CreatorContentItem, 'status' | 'scheduledFor'>): DisplayStatus {
  if (item.status === 'DRAFT' && item.scheduledFor) return 'SCHEDULED'
  return item.status
}

export const STATUS_LABELS: Record<DisplayStatus, string> = {
  PUBLISHED: 'Publié',
  DRAFT: 'Brouillon',
  SCHEDULED: 'Programmé',
  ARCHIVED: 'Archivé',
  UNDER_REVIEW: 'En vérification',
  REJECTED: 'Refusé',
}

export const STATUS_BADGE_VARIANT: Record<DisplayStatus, 'success' | 'secondary' | 'outline' | 'destructive' | 'default'> = {
  PUBLISHED: 'success',
  DRAFT: 'secondary',
  SCHEDULED: 'default',
  ARCHIVED: 'outline',
  UNDER_REVIEW: 'secondary',
  REJECTED: 'destructive',
}

/**
 * Validate a PPV price typed by the creator. Returns an error message or null.
 */
export function validatePpvPrice(value: string): string | null {
  if (!value.trim()) return 'Indiquez un prix'
  const price = Number(value.replace(',', '.'))
  if (!Number.isFinite(price)) return 'Prix invalide'
  if (price < PPV_MIN_PRICE) return `Prix minimum : ${PPV_MIN_PRICE.toFixed(2).replace('.', ',')} €`
  if (price > PPV_MAX_PRICE) return `Prix maximum : ${PPV_MAX_PRICE.toFixed(2).replace('.', ',')} €`
  return null
}

export const parsePrice = (value: string) => Math.round(Number(value.replace(',', '.')) * 100) / 100

/**
 * Validate a schedule date coming from an <input type="datetime-local">.
 */
export function validateScheduleDate(value: string): string | null {
  if (!value) return 'Choisissez une date de publication'
  const date = new Date(value)
  if (isNaN(date.getTime())) return 'Date invalide'
  if (date.getTime() <= Date.now() + 60_000) return 'La date doit être dans le futur'
  return null
}

/** Date → value for <input type="datetime-local"> (local time) */
export function toDateTimeLocal(date: Date | string): string {
  const d = new Date(date)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

const API_ERRORS: Record<string, string> = {
  'PPV content must have a valid price': 'Un contenu Pay-Per-View doit avoir un prix valide',
  'The scheduled date must be in the future': 'La date de publication doit être dans le futur',
  'Only drafts can be scheduled': 'Seuls les brouillons peuvent être programmés',
  'Content is already published': 'Ce contenu est déjà publié',
  'Archived content must be unarchived': 'Ce contenu est archivé : désarchivez-le pour le republier',
  'Content under moderation cannot be published': 'Ce contenu est en cours de modération et ne peut pas être publié',
  'Only published content can be archived': 'Seul un contenu publié peut être archivé',
  'Content is not archived': "Ce contenu n'est pas archivé",
  'Content not found': 'Contenu introuvable',
  'Only creators can create content': 'Seuls les créateurs peuvent publier du contenu',
}

/** French message for an API error (axios error or Error) */
export function contentErrorMessage(error: any, fallback = 'Une erreur est survenue'): string {
  const raw = error?.response?.data?.message ?? error?.message
  const message = Array.isArray(raw) ? raw[0] : raw
  if (typeof message !== 'string' || !message) return fallback
  if (API_ERRORS[message]) return API_ERRORS[message]
  if (/^You can only/.test(message)) return "Vous ne pouvez modifier que vos propres contenus"
  if (error?.response?.status >= 500 || /Network Error/.test(message)) return fallback
  return message
}
