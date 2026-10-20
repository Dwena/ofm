/**
 * Creator side of the LiveKit transport: publish the camera + microphone
 * captured by the live page (the same tracks as the preview) with simulcast,
 * and keep the publication in sync when the creator switches device, quality
 * preset, or mutes the camera / microphone.
 */
import {
  LocalAudioTrack,
  LocalVideoTrack,
  Room,
  Track,
  VideoPreset,
  type RoomOptions,
  type TrackPublishOptions,
} from 'livekit-client'
import type { QualityPresetId } from '../webrtc/quality-presets'
import {
  LAYER_RIDS,
  LIVEKIT_AUDIO_MAX_BITRATE,
  LIVEKIT_PUBLISH_PLANS,
  layerEncodings,
  type LayerRid,
  type LiveKitLayer,
} from './presets'
import { BASE_ROOM_OPTIONS } from './room'

export const PUBLISHER_ROOM_OPTIONS: Partial<RoomOptions> = {
  // Only the simulcast layers somebody watches are encoded
  dynacast: true,
  adaptiveStream: false,
  // The tracks belong to the page (preview): never stopped by LiveKit
  stopLocalTrackOnUnpublish: false,
  ...BASE_ROOM_OPTIONS,
}

const toPreset = (layer: LiveKitLayer) =>
  new VideoPreset(layer.width, layer.height, layer.maxBitrateKbps * 1000, layer.maxFramerate)

export function videoPublishOptions(presetId: QualityPresetId): TrackPublishOptions {
  const plan = LIVEKIT_PUBLISH_PLANS[presetId]
  return {
    source: Track.Source.Camera,
    name: 'camera',
    simulcast: true,
    videoCodec: 'vp8',
    videoEncoding: { maxBitrate: plan.main.maxBitrateKbps * 1000, maxFramerate: plan.main.maxFramerate },
    // Lowest first
    videoSimulcastLayers: plan.simulcast.map(toPreset),
    degradationPreference: 'maintain-framerate',
  }
}

export const AUDIO_PUBLISH_OPTIONS: TrackPublishOptions = {
  source: Track.Source.Microphone,
  name: 'microphone',
  audioPreset: { maxBitrate: LIVEKIT_AUDIO_MAX_BITRATE },
  dtx: true,
  red: true,
}

export function publishedVideoTrack(room: Room | null | undefined): LocalVideoTrack | undefined {
  const track = room?.localParticipant.getTrackPublication(Track.Source.Camera)?.track
  return track instanceof LocalVideoTrack ? track : undefined
}

export function publishedAudioTrack(room: Room | null | undefined): LocalAudioTrack | undefined {
  const track = room?.localParticipant.getTrackPublication(Track.Source.Microphone)?.track
  return track instanceof LocalAudioTrack ? track : undefined
}

/**
 * Publish the page's camera and microphone tracks. A track the creator had
 * turned off is published muted.
 */
export async function publishBroadcastMedia(room: Room, media: MediaStream, presetId: QualityPresetId) {
  const video = media.getVideoTracks()[0]
  const audio = media.getAudioTracks()[0]
  if (video && !publishedVideoTrack(room)) {
    const enabled = video.enabled
    const publication = await room.localParticipant.publishTrack(video, videoPublishOptions(presetId))
    if (!enabled) await publication.mute()
  }
  if (audio && !publishedAudioTrack(room)) {
    const enabled = audio.enabled
    const publication = await room.localParticipant.publishTrack(audio, AUDIO_PUBLISH_OPTIONS)
    if (!enabled) await publication.mute()
  }
}

/**
 * After a device or preset switch the page may hold new MediaStreamTracks:
 * swap them into the publication (RTCRtpSender.replaceTrack: no
 * renegotiation, the viewers keep their subscription). The caller then
 * applies the preset (applyPublishPreset): a new camera may have another size.
 */
export async function syncPublishedMedia(room: Room, media: MediaStream) {
  const pairs: [LocalVideoTrack | LocalAudioTrack | undefined, MediaStreamTrack | undefined][] = [
    [publishedVideoTrack(room), media.getVideoTracks()[0]],
    [publishedAudioTrack(room), media.getAudioTracks()[0]],
  ]
  for (const [published, next] of pairs) {
    if (!published || !next || published.mediaStreamTrack === next) continue
    const muted = published.isMuted
    await published.replaceTrack(next, true)
    // replaceTrack keeps LiveKit's muted flag: apply it to the new track too
    if (muted) next.enabled = false
  }
}

/**
 * Apply a quality preset to the published camera without republishing:
 * every simulcast layer gets the preset's bitrate / frame rate and the
 * downscale matching the current capture size.
 */
export async function applyPublishPreset(room: Room, presetId: QualityPresetId) {
  const track = publishedVideoTrack(room)
  const sender = track?.sender
  if (!track || !sender) return

  const settings = track.mediaStreamTrack.getSettings()
  const width = settings.width ?? LIVEKIT_PUBLISH_PLANS[presetId].main.width
  const height = settings.height ?? LIVEKIT_PUBLISH_PLANS[presetId].main.height
  const encodings = layerEncodings(LIVEKIT_PUBLISH_PLANS[presetId], width, height)

  const params = sender.getParameters()
  if (!params.encodings?.length) return
  const single = params.encodings.length === 1
  params.encodings.forEach((encoding, index) => {
    const rid = (single ? 'f' : encoding.rid || LAYER_RIDS[index]) as LayerRid
    const next = encodings[rid] ?? encodings.f
    encoding.maxBitrate = next.maxBitrate
    encoding.maxFramerate = next.maxFramerate
    if (!single) encoding.scaleResolutionDownBy = next.scaleResolutionDownBy
  })
  await sender.setParameters(params)
}

/**
 * Camera / microphone off: LiveKit mutes the publication (viewers are told)
 * and disables the track; the camera stays open for a quick resume.
 */
export async function setPublishedTrackEnabled(room: Room, kind: 'video' | 'audio', enabled: boolean) {
  const track = kind === 'video' ? publishedVideoTrack(room) : publishedAudioTrack(room)
  if (!track) return
  if (enabled) await track.unmute()
  else await track.mute()
}

/** Both senders, for the "Santé du live" stats */
export function publishedSenders(room: Room | null | undefined): RTCRtpSender[] {
  return [publishedVideoTrack(room)?.sender, publishedAudioTrack(room)?.sender].filter(
    (sender): sender is RTCRtpSender => !!sender,
  )
}
