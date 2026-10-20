import { liveApi } from '../api'

/** Video transport of a live, announced by the API (stream detail, join / broadcast acks) */
export type LiveTransport = 'livekit' | 'p2p'

export interface LiveKitToken {
  url: string
  token: string
  room: string
  identity: string
}

export class LiveKitTokenError extends Error {
  constructor(
    /** API reason code: NOT_FOUND, NOT_LIVE, SUBSCRIPTION_REQUIRED, PPV_PURCHASE_REQUIRED... */
    readonly reason: string,
    readonly status?: number,
  ) {
    super(reason)
    this.name = 'LiveKitTokenError'
  }

  /** Retrying does not help (access refused, live over, LiveKit disabled) */
  get final() {
    return this.status === 400 || this.status === 401 || this.status === 403 || this.status === 404
  }
}

/**
 * Fetch an access token for the live's LiveKit room. A fresh token is asked
 * for every (re)join: they expire after 2 h, a live can last longer.
 */
export async function fetchLiveKitToken(streamId: string, role?: 'publisher' | 'viewer'): Promise<LiveKitToken> {
  try {
    const response = await liveApi.livekitToken(streamId, role)
    const data = response.data as Partial<LiveKitToken>
    if (!data?.url || !data.token) throw new LiveKitTokenError('INVALID_RESPONSE')
    return data as LiveKitToken
  } catch (error) {
    if (error instanceof LiveKitTokenError) throw error
    const response = (error as { response?: { status?: number; data?: { message?: unknown } } })?.response
    const raw = response?.data?.message
    const message = Array.isArray(raw) ? raw[0] : raw
    throw new LiveKitTokenError(typeof message === 'string' && message ? message : 'NETWORK', response?.status)
  }
}
