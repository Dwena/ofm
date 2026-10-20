/**
 * RTCRtpSender helpers for the broadcaster: tracks are added as send-only
 * transceivers with an initial bitrate cap, and later caps go through
 * setParameters (no renegotiation). Every call is guarded: browsers differ in
 * what they accept (degradationPreference, encodings before negotiation...).
 */

export interface SenderEncoding {
  maxBitrateKbps: number
  maxFramerate?: number
  scaleResolutionDownBy?: number
}

// Last encoding applied per sender, to skip redundant setParameters calls
const applied = new WeakMap<RTCRtpSender, string>()
// setParameters calls must not overlap on one sender (transactionId)
const queues = new WeakMap<RTCRtpSender, Promise<unknown>>()
let degradationPreferenceSupported = true

/**
 * Add the local tracks to a viewer's connection as send-only transceivers.
 * Falls back to addTrack when addTransceiver/sendEncodings is refused.
 */
export function addBroadcastTracks(
  pc: RTCPeerConnection,
  media: MediaStream,
  initial: { video: SenderEncoding; audio: SenderEncoding },
) {
  for (const track of media.getTracks()) {
    const encoding = track.kind === 'video' ? initial.video : initial.audio
    try {
      pc.addTransceiver(track, {
        direction: 'sendonly',
        streams: [media],
        sendEncodings: [toEncodingParameters(encoding, track.kind)],
      })
    } catch {
      pc.addTrack(track, media)
    }
  }
  preferLightVideoCodecs(pc)
}

function toEncodingParameters(encoding: SenderEncoding, kind: string): RTCRtpEncodingParameters {
  const params: RTCRtpEncodingParameters = { maxBitrate: Math.round(encoding.maxBitrateKbps * 1000) }
  if (kind === 'video') {
    if (encoding.maxFramerate) params.maxFramerate = encoding.maxFramerate
    params.scaleResolutionDownBy = encoding.scaleResolutionDownBy ?? 1
  }
  return params
}

/**
 * Every viewer gets its own encoder in a mesh, so prefer the cheapest widely
 * supported codecs (VP8, then H.264) over VP9/AV1. The list is only
 * reordered, never filtered, so negotiation cannot fail because of it.
 */
export function preferLightVideoCodecs(pc: RTCPeerConnection) {
  try {
    if (typeof RTCRtpSender === 'undefined' || typeof RTCRtpSender.getCapabilities !== 'function') return
    const codecs = RTCRtpSender.getCapabilities('video')?.codecs
    if (!codecs?.length) return
    const rank = (mimeType: string) => {
      const type = mimeType.toLowerCase()
      if (type === 'video/vp8') return 0
      if (type === 'video/h264') return 1
      return 2
    }
    const ordered = [...codecs].sort((a, b) => rank(a.mimeType) - rank(b.mimeType))
    for (const transceiver of pc.getTransceivers()) {
      if (transceiver.sender.track?.kind !== 'video') continue
      if (typeof transceiver.setCodecPreferences !== 'function') continue
      transceiver.setCodecPreferences(ordered)
    }
  } catch {
    // Keep the browser's default order
  }
}

/**
 * Apply an encoding to a sender. Resolves to true when it is in place.
 */
export function applySenderEncoding(sender: RTCRtpSender, encoding: SenderEncoding): Promise<boolean> {
  const key = JSON.stringify(encoding)
  if (applied.get(sender) === key) return Promise.resolve(true)

  const previous = queues.get(sender) ?? Promise.resolve()
  const run = previous.then(() => setEncoding(sender, encoding, key)).catch(() => false)
  queues.set(sender, run)
  return run
}

async function setEncoding(sender: RTCRtpSender, encoding: SenderEncoding, key: string): Promise<boolean> {
  if (applied.get(sender) === key) return true
  const kind = sender.track?.kind
  if (!kind) return false

  const params = sender.getParameters()
  // Some browsers expose no encoding before the negotiation: retried later
  if (!params.encodings || params.encodings.length === 0) return false

  const target = toEncodingParameters(encoding, kind)
  params.encodings = params.encodings.map((current, index) =>
    index === 0 ? { ...current, ...target } : current,
  )

  const withPreference = kind === 'video' && degradationPreferenceSupported
  if (withPreference) {
    ;(params as RTCRtpSendParameters & { degradationPreference?: string }).degradationPreference =
      'maintain-framerate'
  }

  try {
    await sender.setParameters(params)
  } catch (error) {
    if (!withPreference) throw error
    // degradationPreference is not supported everywhere: retry without it
    degradationPreferenceSupported = false
    const retry = sender.getParameters()
    if (!retry.encodings?.length) return false
    retry.encodings = retry.encodings.map((current, index) => (index === 0 ? { ...current, ...target } : current))
    await sender.setParameters(retry)
  }
  applied.set(sender, key)
  return true
}

/** Forget what was applied (e.g. after replaceTrack the sender keeps its params, so rarely needed) */
export function resetAppliedEncoding(sender: RTCRtpSender) {
  applied.delete(sender)
}
