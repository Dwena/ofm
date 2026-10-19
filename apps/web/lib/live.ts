import { io, Socket } from 'socket.io-client'

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
export function createLiveSocket(): Socket {
  return io(`${SOCKET_URL}/streaming`, {
    auth: {
      token: typeof window !== 'undefined' ? localStorage.getItem('accessToken') : null,
    },
    transports: ['websocket', 'polling'],
  })
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
