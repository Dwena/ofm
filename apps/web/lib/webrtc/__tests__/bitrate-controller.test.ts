import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  INITIAL_UPLOAD_BUDGET_KBPS,
  LOW_MODE_MAX_KBPS,
  MAX_UPLOAD_BUDGET_KBPS,
  MIN_VIDEO_KBPS,
  WARMUP_TICKS,
  classifyNetwork,
  computePeerCap,
  estimateUploadBudget,
  initialPeerState,
  nextPeerState,
  type PeerNetworkSample,
  type PeerQualityState,
  type ViewerQualityMode,
} from '../bitrate-controller'

const healthy: PeerNetworkSample = { lossRate: 0, rttMs: 40, qualityLimitationReason: 'none', sendKbps: 2400 }
const lossy: PeerNetworkSample = { lossRate: 0.08, rttMs: 120, qualityLimitationReason: 'none', sendKbps: 2000 }
const severe: PeerNetworkSample = { lossRate: 0.2, rttMs: 900, qualityLimitationReason: 'bandwidth', sendKbps: 900 }

const run = (
  state: PeerQualityState,
  sample: PeerNetworkSample,
  times: number,
  cap = 2500,
  mode: ViewerQualityMode = 'auto',
) => {
  let current = state
  for (let i = 0; i < times; i += 1) current = nextPeerState(current, sample, cap, mode)
  return current
}

describe('computePeerCap', () => {
  it('uses the preset bitrate while the upload budget is large enough', () => {
    assert.equal(computePeerCap({ presetKbps: 2500, uploadBudgetKbps: 8000, viewerCount: 2 }), 2500)
  })

  it('shares the upload budget between viewers', () => {
    assert.equal(computePeerCap({ presetKbps: 2500, uploadBudgetKbps: 8000, viewerCount: 8 }), 1000)
  })

  it('never goes under the minimum video bitrate', () => {
    assert.equal(computePeerCap({ presetKbps: 2500, uploadBudgetKbps: 1000, viewerCount: 50 }), MIN_VIDEO_KBPS)
  })

  it('caps data saver viewers', () => {
    assert.equal(computePeerCap({ presetKbps: 4500, uploadBudgetKbps: 8000, viewerCount: 1, mode: 'low' }), LOW_MODE_MAX_KBPS)
    assert.equal(computePeerCap({ presetKbps: 1000, uploadBudgetKbps: 2000, viewerCount: 10, mode: 'low' }), 200)
  })

  it('treats zero viewers as one', () => {
    assert.equal(computePeerCap({ presetKbps: 4500, uploadBudgetKbps: 3000, viewerCount: 0 }), 3000)
  })
})

describe('nextPeerState', () => {
  it('starts at the cap with full resolution', () => {
    assert.deepEqual(initialPeerState(2500), {
      targetKbps: 2500,
      scaleDownBy: 1,
      healthyTicks: 0,
      congestedTicks: 0,
      ageTicks: 0,
      level: 'good',
    })
    assert.equal(initialPeerState(500, 'low').scaleDownBy, 2)
  })

  it('stays at the cap on a healthy connection', () => {
    const state = run(initialPeerState(2500), healthy, 10)
    assert.equal(state.targetKbps, 2500)
    assert.equal(state.scaleDownBy, 1)
    assert.equal(state.level, 'good')
  })

  it('lowers the bitrate on packet loss', () => {
    const state = nextPeerState(initialPeerState(2500), lossy, 2500)
    assert.equal(state.targetKbps, 2000)
    assert.equal(state.level, 'poor')
  })

  it('lowers faster on severe loss or RTT', () => {
    const state = nextPeerState(initialPeerState(2500), severe, 2500)
    assert.equal(state.targetKbps, 1500)
  })

  it('lowers on high RTT alone', () => {
    const state = nextPeerState(initialPeerState(2500), { lossRate: 0, rttMs: 500 }, 2500)
    assert.equal(state.targetKbps, 2000)
  })

  it('scales the resolution down only as a last resort, step by step', () => {
    let state = initialPeerState(2500)
    const scales: number[] = []
    for (let i = 0; i < 12; i += 1) {
      state = nextPeerState(state, lossy, 2500)
      scales.push(state.scaleDownBy)
    }
    // Bitrate first: full resolution during the first drops
    assert.deepEqual(scales.slice(0, 4), [1, 1, 1, 1])
    assert.ok(scales.includes(1.5))
    assert.equal(scales[scales.length - 1], 2)
    assert.ok(state.targetKbps >= MIN_VIDEO_KBPS)
  })

  it('never goes under the floor nor above the cap', () => {
    const low = run(initialPeerState(2500), severe, 30)
    assert.equal(low.targetKbps, MIN_VIDEO_KBPS)
    const high = run({ ...initialPeerState(2500), targetKbps: 2400 }, healthy, 30, 1200)
    assert.equal(high.targetKbps, 1200)
  })

  it('recovers slowly once healthy again and restores the resolution', () => {
    const degraded = run(initialPeerState(2500), lossy, 12)
    assert.equal(degraded.scaleDownBy, 2)

    const afterTwo = run(degraded, healthy, 2)
    assert.equal(afterTwo.targetKbps, degraded.targetKbps, 'waits a few healthy samples before raising')

    const afterThree = run(degraded, healthy, 3)
    assert.ok(afterThree.targetKbps > degraded.targetKbps)
    assert.ok(afterThree.targetKbps < 2500, 'climbs gradually')

    const recovered = run(degraded, healthy, 40)
    assert.equal(recovered.targetKbps, 2500)
    assert.equal(recovered.scaleDownBy, 1)
  })

  it('holds the bitrate in the grey zone', () => {
    const start = { ...initialPeerState(2500), targetKbps: 1800 }
    const state = run(start, { lossRate: 0.03, rttMs: 100 }, 5)
    assert.equal(state.targetKbps, 1800)
    assert.equal(state.level, 'fair')
  })

  it('ignores a bandwidth-limited encoder while warming up', () => {
    const rampUp: PeerNetworkSample = {
      lossRate: 0,
      rttMs: 30,
      qualityLimitationReason: 'bandwidth',
      availableOutgoingKbps: 300,
    }
    const warming = run(initialPeerState(2500), rampUp, WARMUP_TICKS)
    assert.equal(warming.targetKbps, 2500)

    const after = nextPeerState(warming, rampUp, 2500)
    assert.ok(after.targetKbps < 2500)
    // Follows the estimate without collapsing below it
    assert.ok(after.targetKbps >= 270)
  })

  it('keeps data saver viewers at half resolution', () => {
    const state = run(initialPeerState(500, 'low'), healthy, 20, 500, 'low')
    assert.equal(state.scaleDownBy, 2)
    assert.equal(state.targetKbps, 500)
  })
})

describe('classifyNetwork', () => {
  it('classifies samples', () => {
    assert.equal(classifyNetwork(healthy), 'good')
    assert.equal(classifyNetwork({ lossRate: 0.03 }), 'fair')
    assert.equal(classifyNetwork({ lossRate: 0, rttMs: 300 }), 'fair')
    assert.equal(classifyNetwork(lossy), 'poor')
    assert.equal(classifyNetwork({}), 'good')
  })
})

describe('estimateUploadBudget', () => {
  it('keeps the budget without samples', () => {
    assert.equal(estimateUploadBudget(INITIAL_UPLOAD_BUDGET_KBPS, []), INITIAL_UPLOAD_BUDGET_KBPS)
  })

  it('grows toward the measured estimate when every peer is healthy', () => {
    const next = estimateUploadBudget(8000, [
      { ...healthy, availableOutgoingKbps: 6000 },
      { ...healthy, availableOutgoingKbps: 6000 },
    ])
    assert.equal(next, 10800)
    assert.equal(estimateUploadBudget(MAX_UPLOAD_BUDGET_KBPS, [healthy]), MAX_UPLOAD_BUDGET_KBPS)
  })

  it('shrinks when most peers suffer at the same time', () => {
    const next = estimateUploadBudget(8000, [
      { ...lossy, sendKbps: 1500, availableOutgoingKbps: 1500 },
      { ...lossy, sendKbps: 1500, availableOutgoingKbps: 1500 },
      { ...healthy, sendKbps: 1500, availableOutgoingKbps: 1500 },
    ])
    assert.ok(next < 8000)
    assert.ok(next > 4000, 'moves smoothly')
  })

  it('does not blame the uplink for a single struggling viewer', () => {
    assert.equal(estimateUploadBudget(8000, [lossy]), 8000)
  })
})
