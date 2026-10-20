import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  LIVEKIT_PUBLISH_PLANS,
  LIVEKIT_VIEWER_QUALITY_MODES,
  LIVEKIT_VIEWER_QUALITY_OPTIONS,
  isLiveKitViewerQualityMode,
  layerEncodings,
  viewerQualityRequest,
} from '../livekit/presets'
import { publisherConnectionLevel, readPublisherStats, viewerConnectionLevel } from '../livekit/stats'
import { QUALITY_PRESETS } from '../webrtc/quality-presets'

const report = (entries: Record<string, unknown>[]) => new Map(entries.map((entry) => [entry.id as string, entry]))

describe('LiveKit publish plans', () => {
  it('publishes each preset at its resolution and bitrate, with two lower simulcast layers', () => {
    for (const id of ['480p', '720p', '1080p'] as const) {
      const plan = LIVEKIT_PUBLISH_PLANS[id]
      assert.equal(plan.main.height, QUALITY_PRESETS[id].height)
      assert.equal(plan.main.maxBitrateKbps, QUALITY_PRESETS[id].maxBitrateKbps)
      assert.equal(plan.main.maxFramerate, 30)
      const [low, mid] = plan.simulcast
      assert.equal(low.height, 180)
      assert.ok(low.height < mid.height && mid.height < plan.main.height)
      assert.ok(low.maxBitrateKbps < mid.maxBitrateKbps && mid.maxBitrateKbps < plan.main.maxBitrateKbps)
    }
  })

  it('computes the layer downscale from the capture size', () => {
    const enc720 = layerEncodings(LIVEKIT_PUBLISH_PLANS['720p'], 1280, 720)
    assert.deepEqual(enc720.q, { maxBitrate: 160_000, maxFramerate: 30, scaleResolutionDownBy: 4 })
    assert.equal(enc720.h.scaleResolutionDownBy, 2)
    assert.deepEqual(enc720.f, { maxBitrate: 2_500_000, maxFramerate: 30, scaleResolutionDownBy: 1 })

    // 720p -> 480p while live: same three layers, smaller and cheaper
    const enc480 = layerEncodings(LIVEKIT_PUBLISH_PLANS['480p'], 854, 480)
    assert.equal(enc480.q.scaleResolutionDownBy, 2.667)
    assert.equal(enc480.h.scaleResolutionDownBy, 1.333)
    assert.equal(enc480.f.maxBitrate, 1_000_000)

    // Portrait camera: the short side drives the scale
    assert.equal(layerEncodings(LIVEKIT_PUBLISH_PLANS['720p'], 720, 1280).q.scaleResolutionDownBy, 4)
    // A camera smaller than the layer is never upscaled
    assert.equal(layerEncodings(LIVEKIT_PUBLISH_PLANS['1080p'], 640, 360).h.scaleResolutionDownBy, 1)
  })
})

describe('LiveKit viewer quality', () => {
  it('offers Auto / Haute / Moyenne / Basse / Économie de données', () => {
    assert.deepEqual(
      LIVEKIT_VIEWER_QUALITY_OPTIONS.map((option) => option.label),
      ['Auto', 'Haute', 'Moyenne', 'Basse', 'Économie de données'],
    )
    assert.deepEqual(LIVEKIT_VIEWER_QUALITY_MODES, LIVEKIT_VIEWER_QUALITY_OPTIONS.map((option) => option.value))
    assert.ok(isLiveKitViewerQualityMode('data-saver'))
    assert.ok(!isLiveKitViewerQualityMode('ultra'))
    assert.ok(!isLiveKitViewerQualityMode(null))
  })

  it('maps each choice to a simulcast layer and frame rate', () => {
    assert.deepEqual(viewerQualityRequest('auto'), { layer: 'high', fps: 30 })
    assert.deepEqual(viewerQualityRequest('high'), { layer: 'high', fps: 30 })
    assert.deepEqual(viewerQualityRequest('medium'), { layer: 'medium', fps: 30 })
    assert.deepEqual(viewerQualityRequest('low'), { layer: 'low', fps: 30 })
    assert.deepEqual(viewerQualityRequest('data-saver'), { layer: 'low', fps: 15 })
  })
})

describe('readPublisherStats', () => {
  const videoReport = (bytes: [number, number, number], frames: [number, number, number]) =>
    report([
      { id: 'q', type: 'outbound-rtp', kind: 'video', rid: 'q', bytesSent: bytes[0], framesEncoded: frames[0], frameWidth: 320, frameHeight: 180 },
      { id: 'f', type: 'outbound-rtp', kind: 'video', rid: 'f', bytesSent: bytes[2], framesEncoded: frames[2], frameWidth: 1280, frameHeight: 720, qualityLimitationReason: 'bandwidth' },
      { id: 'h', type: 'outbound-rtp', kind: 'video', rid: 'h', bytesSent: bytes[1], framesEncoded: frames[1], frameWidth: 640, frameHeight: 360 },
      { id: 'pair', type: 'candidate-pair', state: 'succeeded', nominated: true, currentRoundTripTime: 0.04, availableOutgoingBitrate: 5_000_000 },
    ])
  const audioReport = (bytes: number) => report([{ id: 'a', type: 'outbound-rtp', kind: 'audio', bytesSent: bytes }])

  it('sums the upload over all layers + audio and orders the layers', () => {
    const first = readPublisherStats([videoReport([1000, 5000, 20000], [10, 10, 10]), audioReport(800)], undefined, 1000)
    assert.equal(first.sample.uploadKbps, undefined)
    assert.deepEqual(
      first.sample.layers.map((layer) => layer.rid),
      ['q', 'h', 'f'],
    )

    const second = readPublisherStats(
      [videoReport([3000, 15000, 270000], [70, 10, 70]), audioReport(8800)],
      first.snapshot,
      3000,
      first.frames,
    )
    // (2000 + 10000 + 250000 + 8000) bytes in 2 s = 1080 kbit/s
    assert.equal(second.sample.uploadKbps, 1080)
    assert.equal(second.sample.layers[2].kbps, 1000)
    assert.equal(second.sample.layers[2].height, 720)
    // The medium layer encoded no frame: paused by dynacast
    assert.deepEqual(
      second.sample.layers.map((layer) => layer.active),
      [true, false, true],
    )
    assert.equal(second.sample.limitation, 'bandwidth')
    assert.equal(second.sample.rttMs, 40)
    assert.equal(second.sample.availableOutgoingKbps, 5000)
  })
})

describe('connection levels', () => {
  it('maps LiveKit connection quality for the creator', () => {
    assert.equal(publisherConnectionLevel('excellent'), 'good')
    assert.equal(publisherConnectionLevel('good'), 'fair')
    assert.equal(publisherConnectionLevel('poor'), 'poor')
    assert.equal(publisherConnectionLevel('lost'), 'poor')
    assert.equal(publisherConnectionLevel('unknown'), null)
  })

  it('keeps the worse of LiveKit and the inbound stats for viewers', () => {
    assert.equal(viewerConnectionLevel('excellent', 'excellent'), 'excellent')
    assert.equal(viewerConnectionLevel('excellent', 'poor'), 'poor')
    assert.equal(viewerConnectionLevel('poor', 'excellent'), 'poor')
    assert.equal(viewerConnectionLevel('good', undefined), 'good')
    assert.equal(viewerConnectionLevel('unknown', 'good'), 'good')
    assert.equal(viewerConnectionLevel('unknown', undefined), undefined)
  })
})
