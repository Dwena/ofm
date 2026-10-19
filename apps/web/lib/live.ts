import { io, Socket } from 'socket.io-client'
import { usersApi } from './api'

const SOCKET_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001'

const DEFAULT_ICE_SERVERS: RTCIceServer[] = [{ urls: 'stun:stun.l.google.com:19302' }]

/**
 * ICE servers for WebRTC. Override with NEXT_PUBLIC_ICE_SERVERS, a JSON array
 * of RTCIceServer objects, e.g.
 * [{"urls":"stun:stun.l.google.com:19302"},{"urls":"turn:turn.example.com:3478","username":"u","credential":"p"}]
 */
export function getIceServers(): RTCIceServer[] {
  const raw = process.env.NEXT_PUBLIC_ICE_SERVERS
  if (!raw) return DEFAULT_ICE_SERVERS

  try {
    const parsed = JSON.parse(raw)
    if (Array.isArray(parsed) && parsed.length > 0) {
      return parsed as RTCIceServer[]
    }
  } catch (error) {
    console.error('Invalid NEXT_PUBLIC_ICE_SERVERS, using default STUN server', error)
  }
  return DEFAULT_ICE_SERVERS
}

/**
 * Socket connected to the API's /streaming namespace (JWT in the handshake)
 */
export function createLiveSocket(options: { onAuthError?: () => void } = {}): Socket {
  const socket = io(`${SOCKET_URL}/streaming`, {
    // Read at every (re)connection, so a refreshed access token is used
    auth: (cb) => cb({ token: typeof window !== 'undefined' ? localStorage.getItem('accessToken') : null }),
    transports: ['websocket', 'polling'],
  })

  // The server refuses the handshake ("Unauthorized") when the access token
  // expired: refresh it through the API client (its 401 interceptor) and
  // reconnect once. socket.active is false when the server refused it.
  let refreshed = false
  socket.on('connect', () => {
    refreshed = false
  })
  socket.on('connect_error', (error) => {
    if (socket.active) return // network error: socket.io retries by itself
    if (error.message !== 'Unauthorized' || refreshed) {
      options.onAuthError?.()
      return
    }
    refreshed = true
    usersApi
      .getMe()
      .then(() => {
        if (!closedSockets.has(socket) && !socket.connected) socket.connect()
      })
      .catch(() => {
        if (!closedSockets.has(socket)) options.onAuthError?.()
      })
  })

  return socket
}

const closedSockets = new WeakSet<Socket>()

/**
 * Close a live socket for good (no automatic reconnection or token refresh)
 */
export function closeLiveSocket(socket: Socket | null | undefined) {
  if (!socket) return
  closedSockets.add(socket)
  socket.removeAllListeners()
  socket.disconnect()
}

export interface LiveChatMessage {
  id: string
  userId: string
  username: string
  displayName?: string | null
  avatar?: string | null
  message: string
  timestamp: string
  type: 'MESSAGE' | 'TIP' | 'SYSTEM'
  isCreator?: boolean
  tipAmount?: number
}

export type LiveAck = {
  success?: boolean
  error?: string
  reason?: string
  viewerCount?: number
  broadcasterOnline?: boolean
  messages?: LiveChatMessage[]
  /** join-live-stream: the creator muted this user in the chat */
  muted?: boolean
  /** start-broadcast: users muted in the chat */
  mutedUserIds?: string[]
}

/** Chat errors returned in the acknowledgement of `send-chat-message` */
export const CHAT_ERROR_MESSAGES: Record<string, string> = {
  RATE_LIMITED: 'Doucement ! Attendez un instant avant de renvoyer un message.',
  MUTED: 'Le créateur vous a rendu muet dans ce chat.',
}

/** Socket acknowledgement timeout (ms) */
export const LIVE_ACK_TIMEOUT = 8000

// API error messages (English) shown in French
const API_ERROR_MESSAGES: Record<string, string> = {
  'Title is required': 'Le titre est obligatoire.',
  'Scheduled date must be in the future': 'La date de programmation doit être dans le futur.',
  'PPV streams must have a valid price': "Le prix d'accès doit être d'au moins 1 €.",
  'Payment account must be set up for PPV streams':
    'Configurez votre compte de paiement (Stripe) avant de proposer un live payant.',
  'You already have a live stream in progress':
    'Vous avez déjà un live en cours. Reprenez-le ou terminez-le avant d’en lancer un autre.',
  'Stream is already live': 'Ce live est déjà en cours.',
  'Cannot restart ended streams': 'Ce live est terminé et ne peut pas être relancé.',
  'Stream is already ended': 'Ce live est déjà terminé.',
  'Cannot delete live streams. End the stream first.': "Terminez le live avant de le supprimer.",
  'Stream not found': 'Ce live est introuvable.',
  'Only creators can create live streams': 'Seuls les créateurs peuvent lancer un live.',
}

/**
 * French message for an API error of the streaming endpoints
 */
export function liveErrorMessage(error: unknown, fallback: string): string {
  const raw = (error as { response?: { data?: { message?: unknown } } })?.response?.data?.message
  const message = Array.isArray(raw) ? raw[0] : raw
  if (typeof message !== 'string' || !message) return fallback
  return API_ERROR_MESSAGES[message] ?? fallback
}

/**
 * French message for a getUserMedia failure
 */
export function mediaErrorMessage(error: unknown): string {
  const name = (error as { name?: string })?.name
  switch (name) {
    case 'NotAllowedError':
    case 'SecurityError':
      return "L'accès à la caméra ou au micro a été refusé. Autorisez-le dans les paramètres du navigateur (icône à gauche de l'adresse), puis réessayez."
    case 'NotFoundError':
    case 'OverconstrainedError':
      return 'Aucune caméra ou aucun micro détecté. Branchez un appareil puis réessayez.'
    case 'NotReadableError':
    case 'AbortError':
      return 'La caméra ou le micro est déjà utilisé par une autre application. Fermez-la puis réessayez.'
    case 'InsecureContext':
      return "La caméra n'est disponible que sur une connexion sécurisée (HTTPS)."
    default:
      return "Impossible d'accéder à la caméra ou au micro. Vérifiez les autorisations du navigateur."
  }
}

export type StreamVisibility = 'PUBLIC' | 'SUBSCRIBERS_ONLY' | 'PREMIUM_SUBSCRIBERS' | 'PRIVATE'

export const VISIBILITY_LABELS: Record<string, string> = {
  PUBLIC: 'Public',
  SUBSCRIBERS_ONLY: 'Abonnés',
  PREMIUM_SUBSCRIBERS: 'Abonnés premium',
  PPV: 'Pay-per-view',
  PRIVATE: 'Privé',
}

export const ACCESS_DENIED_MESSAGES: Record<string, string> = {
  PRIVATE: 'Ce live est privé.',
  SUBSCRIPTION_REQUIRED: 'Ce live est réservé aux abonnés du créateur.',
  PREMIUM_SUBSCRIPTION_REQUIRED: 'Ce live est réservé aux abonnés premium du créateur.',
  PPV_PURCHASE_REQUIRED: 'Ce live est payant (pay-per-view).',
  NOT_LIVE: "Ce live n'a pas encore commencé.",
  NOT_FOUND: 'Ce live est introuvable.',
}

/** Duration in seconds → "1 h 15 min" */
export function formatStreamDuration(seconds?: number | null): string | null {
  if (!seconds || seconds <= 0) return null
  const hours = Math.floor(seconds / 3600)
  const minutes = Math.floor((seconds % 3600) / 60)
  if (hours > 0) return `${hours} h ${minutes.toString().padStart(2, '0')} min`
  if (minutes > 0) return `${minutes} min`
  return `${seconds} s`
}
