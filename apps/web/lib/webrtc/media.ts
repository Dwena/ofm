/**
 * Camera / microphone capture for the broadcaster, and live switching of the
 * device or quality preset without renegotiating the viewers' connections
 * (RTCRtpSender.replaceTrack).
 */
import { audioConstraints, presetTrackConstraints, videoConstraints, type QualityPreset } from './quality-presets'

export interface MediaDeviceChoice {
  videoDeviceId?: string | null
  audioDeviceId?: string | null
}

function prepareVideoTrack(track: MediaStreamTrack | undefined) {
  // Live camera: favour smooth motion over sharpness when the encoder must choose
  if (track && 'contentHint' in track) track.contentHint = 'motion'
}

export async function openBroadcastMedia(preset: QualityPreset, choice: MediaDeviceChoice = {}): Promise<MediaStream> {
  const media = await navigator.mediaDevices.getUserMedia({
    video: videoConstraints(preset, choice.videoDeviceId),
    audio: audioConstraints(choice.audioDeviceId),
  })
  prepareVideoTrack(media.getVideoTracks()[0])
  return media
}

/**
 * Put `track` in place of the local track of the same kind: on every peer
 * sender (no renegotiation) and in a new MediaStream that is returned (the
 * caller re-attaches it to the preview). The old track is stopped and the
 * enabled state (camera / mic off) is kept.
 */
export async function replaceLocalTrack(
  media: MediaStream,
  track: MediaStreamTrack,
  peers: Iterable<RTCPeerConnection>,
): Promise<MediaStream> {
  const old = media.getTracks().find((t) => t.kind === track.kind)
  if (old) track.enabled = old.enabled

  const replacements: Promise<void>[] = []
  for (const pc of peers) {
    if (pc.connectionState === 'closed') continue
    for (const sender of pc.getSenders()) {
      if (sender.track === old || (!sender.track && senderKind(pc, sender) === track.kind)) {
        replacements.push(sender.replaceTrack(track).catch((error) => console.error('replaceTrack error:', error)))
      }
    }
  }
  await Promise.all(replacements)

  const next = new MediaStream([...media.getTracks().filter((t) => t !== old), track])
  old?.stop()
  return next
}

function senderKind(pc: RTCPeerConnection, sender: RTCRtpSender) {
  const transceiver = pc.getTransceivers().find((t) => t.sender === sender)
  return transceiver?.receiver.track?.kind
}

/**
 * Switch the camera or the microphone while live
 */
export async function switchDevice(
  media: MediaStream,
  kind: 'video' | 'audio',
  deviceId: string,
  preset: QualityPreset,
  peers: Iterable<RTCPeerConnection>,
): Promise<MediaStream> {
  const constraints =
    kind === 'video' ? { video: videoConstraints(preset, deviceId) } : { audio: audioConstraints(deviceId) }
  const fresh = await navigator.mediaDevices.getUserMedia(constraints)
  const track = kind === 'video' ? fresh.getVideoTracks()[0] : fresh.getAudioTracks()[0]
  if (!track) throw Object.assign(new Error('No track'), { name: 'NotFoundError' })
  if (kind === 'video') prepareVideoTrack(track)
  return replaceLocalTrack(media, track, peers)
}

/**
 * Change the capture resolution of the live video track. applyConstraints is
 * tried first (instant, same track); if the camera refuses, a new track is
 * captured and swapped in. Resolves to the stream to keep using.
 */
export async function switchPreset(
  media: MediaStream,
  preset: QualityPreset,
  peers: Iterable<RTCPeerConnection>,
  videoDeviceId?: string | null,
): Promise<MediaStream> {
  const track = media.getVideoTracks()[0]
  if (!track) return media
  try {
    await track.applyConstraints(presetTrackConstraints(preset))
    return media
  } catch (error) {
    console.warn('applyConstraints refused, capturing a new video track', error)
  }
  const deviceId = videoDeviceId || track.getSettings().deviceId
  return switchDevice(media, 'video', deviceId ?? '', preset, peers)
}
