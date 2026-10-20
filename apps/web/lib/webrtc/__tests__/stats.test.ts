import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readReceiverStats, readSenderStats } from '../stats'
import { classifyViewerQuality, describeReceiverSample, formatKbps } from '../connection-quality'

const report = (entries: Record<string, unknown>[]) => new Map(entries.map((entry) => [entry.id as string, entry]))

describe('readSenderStats', () => {
  const senderReport = (bytes: number, packets: number, lost: number) =>
    report([
      {
        id: 'out-v',
        type: 'outbound-rtp',
        kind: 'video',
        bytesSent: bytes,
        packetsSent: packets,
        qualityLimitationReason: 'bandwidth',
        frameWidth: 1280,
        frameHeight: 720,
        framesPerSecond: 30,
      },
      { id: 'out-a', type: 'outbound-rtp', kind: 'audio', bytesSent: 1000, packetsSent: 50 },
      { id: 'rin-v', type: 'remote-inbound-rtp', kind: 'video', packetsLost: lost, fractionLost: 0.5, roundTripTime: 0.08 },
      { id: 'pair-old', type: 'candidate-pair', state: 'failed', availableOutgoingBitrate: 1 },
      { id: 'pair', type: 'candidate-pair', state: 'succeeded', availableOutgoingBitrate: 3_000_000, currentRoundTripTime: 0.1 },
      { id: 'transport', type: 'transport', selectedCandidatePairId: 'pair' },
    ])

  it('reads the instant values on the first call', () => {
    const { sample, snapshot } = readSenderStats(senderReport(100_000, 1000, 0), undefined, 1000)
    assert.equal(sample.availableOutgoingKbps, 3000)
    assert.equal(sample.rttMs, 80)
    assert.equal(sample.qualityLimitationReason, 'bandwidth')
    assert.equal(sample.frameHeight, 720)
    // No previous snapshot: RTCP fractionLost is the only loss figure
    assert.equal(sample.lossRate, 0.5)
    assert.equal(sample.sendKbps, undefined)
    assert.deepEqual(snapshot, { timestamp: 1000, bytesSent: 101_000, videoPacketsSent: 1000, videoPacketsLost: 0 })
  })

  it('computes the bitrate and loss over the interval', () => {
    const first = readSenderStats(senderReport(100_000, 1000, 0), undefined, 1000)
    const { sample } = readSenderStats(senderReport(600_000, 1450, 50), first.snapshot, 3000)
    // 500 kB in 2 s = 2000 kbit/s
    assert.equal(sample.sendKbps, 2000)
    assert.equal(sample.lossRate, 50 / 500)
  })
})

describe('readReceiverStats', () => {
  const receiverReport = (bytes: number, received: number, lost: number) =>
    report([
      {
        id: 'in-v',
        type: 'inbound-rtp',
        kind: 'video',
        bytesReceived: bytes,
        packetsReceived: received,
        packetsLost: lost,
        frameWidth: 854,
        frameHeight: 480,
        framesPerSecond: 29.7,
        jitter: 0.004,
      },
      { id: 'in-a', type: 'inbound-rtp', kind: 'audio', bytesReceived: 2000, packetsReceived: 100, packetsLost: 30 },
      { id: 'pair', type: 'candidate-pair', state: 'succeeded', nominated: true, currentRoundTripTime: 0.05 },
    ])

  it('reads resolution, fps and loss of the video', () => {
    const first = readReceiverStats(receiverReport(0, 0, 0), undefined, 0)
    assert.equal(first.sample.lossRate, undefined)
    const { sample } = readReceiverStats(receiverReport(250_000, 990, 10), first.snapshot, 1000)
    assert.equal(sample.width, 854)
    assert.equal(sample.height, 480)
    assert.equal(sample.framesPerSecond, 29.7)
    assert.equal(sample.rttMs, 50)
    assert.equal(sample.jitterMs, 4)
    assert.equal(sample.lossRate, 0.01)
    assert.equal(sample.bitrateKbps, 2000)
  })
})

describe('viewer connection quality', () => {
  it('classifies the incoming video', () => {
    assert.equal(classifyViewerQuality({ lossRate: 0, framesPerSecond: 30, rttMs: 40, height: 720 }), 'excellent')
    assert.equal(classifyViewerQuality({ lossRate: 0.02, framesPerSecond: 30, height: 720 }), 'good')
    assert.equal(classifyViewerQuality({ lossRate: 0, framesPerSecond: 18, height: 720 }), 'good')
    assert.equal(classifyViewerQuality({ lossRate: 0.08, framesPerSecond: 30 }), 'poor')
    assert.equal(classifyViewerQuality({ lossRate: 0, framesPerSecond: 8 }), 'poor')
    // Data saver resolution is not penalised
    assert.equal(classifyViewerQuality({ lossRate: 0, framesPerSecond: 30, height: 360 }), 'excellent')
  })

  it('describes a sample in French', () => {
    assert.equal(
      describeReceiverSample({ width: 1280, height: 720, framesPerSecond: 29.6, lossRate: 0.004, rttMs: 120.4 }),
      '1280×720 · 30 i/s · perte 0,4 % · 120 ms',
    )
    assert.equal(formatKbps(850), '850 kbit/s')
    assert.equal(formatKbps(2500), '2,5 Mbit/s')
  })
})
