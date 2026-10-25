// Identity verification (KYC), co-performers and pre-publication review
import { api } from '@/lib/api'

export type KycStatus = 'NOT_STARTED' | 'PENDING' | 'UNDER_REVIEW' | 'VERIFIED' | 'REJECTED' | 'RESUBMIT_REQUIRED'
export type IdentityDocumentType = 'ID_CARD' | 'PASSPORT' | 'DRIVING_LICENSE' | 'RESIDENCE_PERMIT'
export type CoPerformerStatus = 'PENDING' | 'VERIFIED' | 'REJECTED'
export type MediaScanStatus = 'PENDING' | 'CLEAN' | 'FLAGGED' | 'SKIPPED'

/** Sent by the API (403, code KYC_REQUIRED) when an unverified creator tries to publish */
export const KYC_REQUIRED_MESSAGE = 'Vérifiez votre identité pour publier'

export const IDENTITY_DOCUMENT_LABELS: Record<IdentityDocumentType, string> = {
  ID_CARD: "Carte d'identité",
  PASSPORT: 'Passeport',
  DRIVING_LICENSE: 'Permis de conduire',
  RESIDENCE_PERMIT: 'Titre de séjour',
}

/** Documents whose back is required */
export const TWO_SIDED_DOCUMENTS: IdentityDocumentType[] = ['ID_CARD', 'RESIDENCE_PERMIT']

export const KYC_STATUS_LABELS: Record<KycStatus, string> = {
  NOT_STARTED: 'Non vérifiée',
  PENDING: 'En cours de vérification',
  UNDER_REVIEW: 'En cours de vérification',
  VERIFIED: 'Vérifiée',
  REJECTED: 'Refusée',
  RESUBMIT_REQUIRED: 'Nouveaux documents demandés',
}

export const CO_PERFORMER_STATUS_LABELS: Record<CoPerformerStatus, string> = {
  PENDING: 'En cours de vérification',
  VERIFIED: 'Vérifié(e)',
  REJECTED: 'Refusé(e)',
}

export const STATUS_VARIANT: Record<string, 'success' | 'secondary' | 'destructive' | 'outline' | 'default'> = {
  NOT_STARTED: 'outline',
  PENDING: 'secondary',
  UNDER_REVIEW: 'secondary',
  VERIFIED: 'success',
  REJECTED: 'destructive',
  RESUBMIT_REQUIRED: 'destructive',
}

export const SCAN_STATUS_LABELS: Record<MediaScanStatus, string> = {
  PENDING: 'Analyse en attente',
  CLEAN: 'Analyse OK',
  FLAGGED: 'Média signalé',
  SKIPPED: 'Non analysé',
}

export const ACCEPTED_IDENTITY_FILES = 'image/jpeg,image/png,image/webp,image/heic,image/heif,application/pdf'
export const ACCEPTED_SELFIE_FILES = 'image/jpeg,image/png,image/webp,image/heic,image/heif'
export const IDENTITY_FILE_MAX_SIZE = 10 * 1024 * 1024

/** Client-side check of an identity file (the API checks the real content) */
export function identityFileError(file: File | null | undefined, accept = ACCEPTED_IDENTITY_FILES): string | null {
  if (!file) return null
  if (file.size > IDENTITY_FILE_MAX_SIZE) return 'Fichier trop volumineux (10 Mo maximum)'
  if (file.type && !accept.split(',').includes(file.type)) {
    return accept.includes('pdf') ? 'Formats acceptés : JPG, PNG, WEBP, HEIC ou PDF' : 'Formats acceptés : JPG, PNG, WEBP ou HEIC'
  }
  return null
}

/** 18 years old today (date as YYYY-MM-DD) */
export function isAdultDate(value: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value)
  if (!match) return false
  const [, y, m, d] = match.map(Number)
  const eighteenth = Date.UTC(y + 18, m - 1, d)
  const now = new Date()
  return eighteenth <= Date.UTC(now.getFullYear(), now.getMonth(), now.getDate())
}

export interface IdentityDocumentInfo {
  id: string
  type: IdentityDocumentType | 'SELFIE' | 'RELEASE_FORM'
  side: 'front' | 'back' | 'selfie' | 'release' | null
  mimeType: string
  createdAt: string
  /** Signed URL, only in back-office answers */
  url?: string
  size?: number
}

export interface KycState {
  kycStatus: KycStatus
  kycSubmittedAt: string | null
  kycVerifiedAt: string | null
  kycRejectedAt: string | null
  kycRejectionReason: string | null
  dateOfBirth: string | null
  canPublish: boolean
  canSubmit: boolean
  documents: IdentityDocumentInfo[]
}

export interface CoPerformer {
  id: string
  legalFirstName: string
  legalLastName: string
  stageName: string | null
  dateOfBirth: string
  email: string | null
  platformUserId: string | null
  status: CoPerformerStatus
  consentSignedAt: string
  rejectionReason: string | null
  reviewedAt: string | null
  createdAt: string
  contentCount?: number
  documentCount?: number
}

export const coPerformerName = (coPerformer: Pick<CoPerformer, 'stageName' | 'legalFirstName' | 'legalLastName'>) =>
  coPerformer.stageName || `${coPerformer.legalFirstName} ${coPerformer.legalLastName ?? ''}`.trim()

const multipart = { headers: { 'Content-Type': 'multipart/form-data' } }

function toFormData(fields: Record<string, string | File | null | undefined>) {
  const form = new FormData()
  for (const [key, value] of Object.entries(fields)) {
    if (value === null || value === undefined || value === '') continue
    form.append(key, value)
  }
  return form
}

// ==================== Creator ====================

export const verificationApi = {
  getStatus: () => api.get<KycState>('/creator/verification'),
  submit: (data: {
    documentType: IdentityDocumentType
    dateOfBirth: string
    documentFront: File
    documentBack?: File | null
    selfie: File
  }) => api.post<KycState>('/creator/verification', toFormData(data), multipart),
}

export const coPerformersApi = {
  list: (status?: CoPerformerStatus) =>
    api.get<CoPerformer[]>('/creator/co-performers', { params: status ? { status } : {} }),
  get: (id: string) => api.get<CoPerformer & { documents: IdentityDocumentInfo[] }>(`/creator/co-performers/${id}`),
  create: (data: {
    legalFirstName: string
    legalLastName: string
    stageName?: string
    dateOfBirth: string
    email?: string
    platformUsername?: string
    documentType: IdentityDocumentType
    consentSignedAt: string
    documentFront: File
    documentBack?: File | null
    releaseForm: File
    selfie?: File | null
  }) => api.post<CoPerformer>('/creator/co-performers', toFormData(data), multipart),
  update: (
    id: string,
    data: Partial<{
      legalFirstName: string
      legalLastName: string
      stageName: string
      dateOfBirth: string
      email: string
      documentType: IdentityDocumentType
      consentSignedAt: string
      documentFront: File | null
      documentBack: File | null
      releaseForm: File | null
      selfie: File | null
    }>,
  ) => api.put<CoPerformer>(`/creator/co-performers/${id}`, toFormData(data), multipart),
  remove: (id: string) => api.delete(`/creator/co-performers/${id}`),
}

/** Content creation / update with the co-performer fields (see contentApi in lib/api.ts) */
export const contentCoPerformersApi = {
  create: (data: {
    type: 'PHOTO' | 'VIDEO' | 'AUDIO' | 'TEXT' | 'ALBUM'
    visibility?: 'PUBLIC' | 'SUBSCRIBERS_ONLY' | 'PREMIUM_SUBSCRIBERS' | 'PPV' | 'PRIVATE'
    title?: string
    description?: string
    caption?: string
    fileIds?: string[]
    isPpv?: boolean
    ppvPrice?: number
    scheduledFor?: string
    publish?: boolean
    soloContent: boolean
    coPerformerIds?: string[]
  }) => api.post('/content', data),
  update: (id: string, data: { soloContent?: boolean; coPerformerIds?: string[] } & Record<string, unknown>) =>
    api.put(`/content/${id}`, data),
}

// ==================== Back-office ====================

export interface KycQueueItem {
  id: string
  username: string
  displayName: string | null
  email: string
  avatar: string | null
  status: string
  kycStatus: KycStatus
  kycSubmittedAt: string | null
  kycRejectionReason: string | null
  dateOfBirth: string | null
  isAdult: boolean | null
  documentCount: number
}

export interface Paginated<T> {
  items: T[]
  pagination: { page: number; limit: number; total: number; totalPages: number }
}

export interface CoPerformerReviewItem extends CoPerformer {
  isAdult: boolean
  creator: { id: string; username: string; displayName: string | null; avatar: string | null; kycStatus: KycStatus }
}

export interface ReviewMedia {
  id: string
  type: 'IMAGE' | 'VIDEO' | 'AUDIO' | 'FILE'
  mimeType: string
  size: number
  scanStatus: MediaScanStatus
  url: string | null
  thumbnailUrl: string | null
}

export interface ReviewContent {
  id: string
  type: string
  title: string | null
  description: string | null
  caption: string | null
  status: string
  visibility: string
  isPpv: boolean
  ppvPrice: number | null
  scheduledFor: string | null
  publishedAt: string | null
  submittedForReviewAt: string | null
  createdAt: string
  moderationNotes: string | null
  soloContent: boolean
  creator: { id: string; username: string; displayName: string | null; avatar: string | null; kycStatus: KycStatus; status: string }
  files: ReviewMedia[]
  coPerformers: {
    id: string
    legalFirstName: string
    legalLastName: string
    stageName: string | null
    dateOfBirth: string
    status: CoPerformerStatus
    consentSignedAt: string
    deletedAt: string | null
  }[]
  textCheck: { blocked: boolean; needsReview: boolean; matches: { term: string; category: string; severity: 'BLOCK' | 'REVIEW' }[] }
}

export const verificationAdminApi = {
  listKyc: (params: { status?: KycStatus; page?: number; limit?: number } = {}) =>
    api.get<Paginated<KycQueueItem>>('/admin/verification/kyc', { params }),
  getKyc: (userId: string) =>
    api.get<{ user: KycQueueItem & { createdAt: string }; documents: IdentityDocumentInfo[]; urlExpiresInSeconds: number }>(
      `/admin/verification/kyc/${userId}`,
    ),
  reviewKyc: (userId: string, data: { decision: 'APPROVE' | 'REJECT'; reason?: string }) =>
    api.post(`/admin/users/${userId}/kyc`, data),
  listCoPerformers: (params: { status?: CoPerformerStatus; page?: number; limit?: number } = {}) =>
    api.get<Paginated<CoPerformerReviewItem>>('/admin/verification/co-performers', { params }),
  getCoPerformer: (id: string) =>
    api.get<{ coPerformer: CoPerformerReviewItem; documents: IdentityDocumentInfo[]; urlExpiresInSeconds: number }>(
      `/admin/verification/co-performers/${id}`,
    ),
  reviewCoPerformer: (id: string, data: { decision: 'APPROVE' | 'REJECT'; reason?: string }) =>
    api.post(`/admin/verification/co-performers/${id}/review`, data),
}

export const contentReviewApi = {
  queue: (params: { page?: number; limit?: number } = {}) =>
    api.get<{ items: ReviewContent[]; total: number; page: number; limit: number; totalPages: number }>(
      '/moderation/content/queue',
      { params },
    ),
  get: (id: string) => api.get<ReviewContent>(`/moderation/content/${id}`),
  approve: (id: string, notes?: string) => api.post(`/moderation/content/${id}/approve`, notes ? { notes } : {}),
  reject: (id: string, reason: string) => api.post(`/moderation/content/${id}/reject`, { reason }),
  rescan: (id: string) => api.post(`/moderation/content/${id}/rescan`),
  /** Moderators cut a live in progress (real-time monitoring of lives) */
  endLive: (streamId: string, reason?: string) =>
    api.post(`/streaming/${streamId}/moderation/end`, reason ? { reason } : {}),
}

export const DOCUMENT_SIDE_LABELS: Record<string, string> = {
  front: 'Recto',
  back: 'Verso',
  selfie: 'Selfie avec la pièce',
  release: 'Autorisation signée',
}

export const documentLabel = (doc: Pick<IdentityDocumentInfo, 'type' | 'side'>) => {
  if (doc.type === 'SELFIE') return 'Selfie avec la pièce'
  if (doc.type === 'RELEASE_FORM') return 'Autorisation signée (release)'
  const base = IDENTITY_DOCUMENT_LABELS[doc.type as IdentityDocumentType] ?? doc.type
  return doc.side === 'back' ? `${base} (verso)` : doc.side === 'front' ? `${base} (recto)` : base
}

/** Age in years at today's date */
export function ageFrom(dateOfBirth: string | null | undefined): number | null {
  if (!dateOfBirth) return null
  const date = new Date(dateOfBirth)
  if (isNaN(date.getTime())) return null
  const now = new Date()
  let age = now.getUTCFullYear() - date.getUTCFullYear()
  const beforeBirthday =
    now.getUTCMonth() < date.getUTCMonth() ||
    (now.getUTCMonth() === date.getUTCMonth() && now.getUTCDate() < date.getUTCDate())
  if (beforeBirthday) age--
  return age
}

/** Date of birth (stored at UTC midnight) as DD/MM/YYYY, without timezone shift */
export const formatBirthDate = (value: string) => value.slice(0, 10).split('-').reverse().join('/')
