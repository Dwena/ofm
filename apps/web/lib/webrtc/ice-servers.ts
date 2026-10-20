/**
 * ICE servers of a live session: fetched once from the API (STUN + short-lived
 * TURN credentials when the server has a TURN relay) and reused for every peer
 * connection of the session. Falls back to NEXT_PUBLIC_ICE_SERVERS / Google
 * STUN when the API cannot be reached.
 */
import { api } from '../api'
import { getIceServers } from '../live'

interface CachedIceServers {
  promise: Promise<RTCIceServer[]>
  expiresAt: number
}

let cache: CachedIceServers | null = null
// Refresh TURN credentials well before they expire
const SAFETY_MARGIN_MS = 10 * 60 * 1000
const FALLBACK_CACHE_MS = 60 * 1000

function isIceServer(value: unknown): value is RTCIceServer {
  if (!value || typeof value !== 'object') return false
  const urls = (value as { urls?: unknown }).urls
  return typeof urls === 'string' || (Array.isArray(urls) && urls.every((u) => typeof u === 'string'))
}

async function fetchIceServers(): Promise<{ servers: RTCIceServer[]; ttlMs: number }> {
  try {
    const response = await api.get('/streaming/ice-servers', { timeout: 5000 })
    const servers = (response.data?.iceServers as unknown[] | undefined)?.filter(isIceServer) ?? []
    if (servers.length === 0) throw new Error('No ICE servers')
    const ttl = Number(response.data?.ttl)
    // Without TURN (no ttl) the list does not expire; refetch hourly anyway
    const ttlMs = Number.isFinite(ttl) && ttl > 0 ? ttl * 1000 - SAFETY_MARGIN_MS : 60 * 60 * 1000
    return { servers, ttlMs: Math.max(ttlMs, FALLBACK_CACHE_MS) }
  } catch (error) {
    console.warn('ICE servers unavailable from the API, using the default list', error)
    return { servers: getIceServers(), ttlMs: FALLBACK_CACHE_MS }
  }
}

/**
 * ICE servers for a new RTCPeerConnection (cached for the live session)
 */
export function getLiveIceServers(): Promise<RTCIceServer[]> {
  const now = Date.now()
  if (cache && cache.expiresAt > now) return cache.promise

  const entry: CachedIceServers = {
    // Until the answer arrives, concurrent callers share the same request
    expiresAt: Number.POSITIVE_INFINITY,
    promise: fetchIceServers().then(({ servers, ttlMs }) => {
      entry.expiresAt = Date.now() + ttlMs
      return servers
    }),
  }
  cache = entry
  return entry.promise
}

/**
 * Start fetching at the beginning of a live session so the first peer
 * connection does not wait. `fresh` drops the cached list (new session).
 */
export function prefetchLiveIceServers(fresh = false) {
  if (fresh) cache = null
  void getLiveIceServers()
}
