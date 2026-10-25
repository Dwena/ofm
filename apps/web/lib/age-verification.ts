import { useQuery } from '@tanstack/react-query'
import { api } from '@/lib/api'

/**
 * Age verification of visitors before any explicit media is shown (law
 * n° 2024-449 of 21 May 2024 "SREN", Arcom référentiel). The API keeps only
 * the outcome: for a logged-in user on the account (ageVerifiedAt), and for
 * the browser as an anonymous signed token (no identity) stored here and sent
 * by lib/api.ts in the `X-Age-Verification` header.
 */

/** Read by the request interceptor of lib/api.ts (keep the key in sync) */
export const AGE_TOKEN_STORAGE_KEY = 'ageVerificationToken'
const AGE_TOKEN_EXPIRES_KEY = 'ageVerificationExpiresAt'
const INTERSTITIAL_DISMISSED_KEY = 'ageGateDismissed'

/** API error code (403 message, socket ack reason) when media needs a verified age */
export const AGE_VERIFICATION_REQUIRED = 'AGE_VERIFICATION_REQUIRED'

export const AGE_VERIFICATION_STATUS_KEY = ['age-verification', 'status'] as const

export interface AgeVerificationStatus {
  verified: boolean
  expiresAt: string | null
  source: 'user' | 'token' | 'staff' | null
  provider: string
}

// ---------------------------------------------------------------------------
// Anonymous token (localStorage)
// ---------------------------------------------------------------------------

export function getStoredAgeToken(): string | null {
  if (typeof window === 'undefined') return null
  try {
    const token = localStorage.getItem(AGE_TOKEN_STORAGE_KEY)
    const expiresAt = Number(new Date(localStorage.getItem(AGE_TOKEN_EXPIRES_KEY) || 0))
    if (!token) return null
    if (!expiresAt || expiresAt <= Date.now()) {
      clearAgeToken()
      return null
    }
    return token
  } catch {
    return null
  }
}

export function storeAgeToken(token: string, expiresAt: string) {
  try {
    localStorage.setItem(AGE_TOKEN_STORAGE_KEY, token)
    localStorage.setItem(AGE_TOKEN_EXPIRES_KEY, expiresAt)
  } catch {
    // Private browsing with storage disabled: the account check still works when logged in
  }
}

export function clearAgeToken() {
  try {
    localStorage.removeItem(AGE_TOKEN_STORAGE_KEY)
    localStorage.removeItem(AGE_TOKEN_EXPIRES_KEY)
  } catch {
    // ignore
  }
}

// ---------------------------------------------------------------------------
// API
// ---------------------------------------------------------------------------

export const ageVerificationApi = {
  /** Creates an attempt; the browser must then go to `redirectUrl` (third party) */
  start: (returnTo: string) =>
    api.post<{ redirectUrl: string }>('/age-verification/start', { returnTo: sanitizeReturnTo(returnTo) }),
  status: () => api.get<AgeVerificationStatus>('/age-verification/status'),
}

/** Start the verification and leave for the provider's page */
export async function startAgeVerification(returnTo: string) {
  const { data } = await ageVerificationApi.start(returnTo)
  window.location.assign(data.redirectUrl)
}

/** Status of the current visitor (account and/or stored token) */
export function useAgeVerificationStatus({ enabled = true, userId }: { enabled?: boolean; userId?: string | null } = {}) {
  return useQuery({
    queryKey: [...AGE_VERIFICATION_STATUS_KEY, userId ?? 'anonymous'],
    queryFn: async () => (await ageVerificationApi.status()).data,
    enabled,
    staleTime: 60 * 1000,
    retry: 1,
  })
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Local path only ("/feed?x=1"), never an absolute or protocol-relative URL */
export function sanitizeReturnTo(path: string | null | undefined): string {
  if (!path || !path.startsWith('/') || path.startsWith('//') || path.includes('\\')) return '/'
  if (/^\/verification-age(\/|\?|#|$)/.test(path)) return '/'
  return path
}

/** URL of the page explaining the verification, coming back to `returnTo` */
export function buildAgeVerificationUrl(returnTo?: string | null): string {
  const target = sanitizeReturnTo(
    returnTo ?? (typeof window !== 'undefined' ? window.location.pathname + window.location.search : '/'),
  )
  return target === '/' ? '/verification-age' : `/verification-age?returnTo=${encodeURIComponent(target)}`
}

/** 403 AGE_VERIFICATION_REQUIRED from the API (axios error) */
export function isAgeVerificationRequiredError(error: any): boolean {
  if (error?.response?.data?.code === AGE_VERIFICATION_REQUIRED) return true
  const message = error?.response?.data?.message ?? error?.message
  return (
    message === AGE_VERIFICATION_REQUIRED ||
    (Array.isArray(message) && message.includes(AGE_VERIFICATION_REQUIRED))
  )
}

/** Outcome sent by the API in the URL fragment of /verification-age/retour */
export interface AgeVerificationCallbackResult {
  status: 'verified' | 'failed'
  token: string | null
  expiresAt: string | null
  returnTo: string
  reason: string | null
}

export function parseAgeVerificationFragment(hash: string): AgeVerificationCallbackResult {
  const params = new URLSearchParams(hash.replace(/^#/, ''))
  return {
    status: params.get('status') === 'verified' ? 'verified' : 'failed',
    token: params.get('token'),
    expiresAt: params.get('expiresAt'),
    returnTo: sanitizeReturnTo(params.get('returnTo')),
    reason: params.get('reason'),
  }
}

/** French explanation of a failed verification */
export function describeAgeVerificationFailure(reason: string | null): string {
  switch (reason) {
    case 'UNDERAGE':
      return 'La vérification n’a pas confirmé que vous êtes majeur(e). L’accès aux contenus réservés aux adultes reste bloqué.'
    case 'EXPIRED':
    case 'UNKNOWN_ATTEMPT':
      return 'Cette vérification a expiré ou a déjà été utilisée. Merci de recommencer.'
    case 'PROVIDER_REFUSED':
      return 'La vérification a été annulée ou refusée par le service de vérification.'
    default:
      return 'La vérification de votre âge n’a pas abouti. Merci de réessayer.'
  }
}

/** API URL the dev simulator sends the browser back to (dev provider only) */
export function buildDevCallbackUrl(state: string, nonce: string, result: 'adult' | 'minor'): string {
  const base = (api.defaults.baseURL || '').replace(/\/$/, '')
  const params = new URLSearchParams({ state, nonce, result })
  return `${base}/age-verification/callback?${params.toString()}`
}

/** The warning interstitial was dismissed in this browser session */
export function isInterstitialDismissed(): boolean {
  try {
    return sessionStorage.getItem(INTERSTITIAL_DISMISSED_KEY) === '1'
  } catch {
    return false
  }
}

export function dismissInterstitial() {
  try {
    sessionStorage.setItem(INTERSTITIAL_DISMISSED_KEY, '1')
  } catch {
    // ignore
  }
}
