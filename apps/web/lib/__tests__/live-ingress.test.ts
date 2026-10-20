import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  INGRESS_SERVICE_UNREACHABLE,
  INGRESS_UNAVAILABLE,
  ingressErrorMessage,
  isIngressUnavailable,
  isObsStatus,
  maskSecret,
  obsSetupSteps,
  obsStatusLabel,
} from '../live-ingress'
import { LIVEKIT_VIEWER_QUALITY_OPTIONS, viewerQualityOptionsFor } from '../livekit/presets'

const apiError = (message: string, status = 400) => ({ response: { status, data: { message } } })

describe('OBS ingress helpers', () => {
  it('masks the stream key but its first characters', () => {
    assert.equal(maskSecret('R4nPKcCGtF3q'), 'R4nP••••••••')
    assert.equal(maskSecret('abc'), '•••')
    assert.equal(maskSecret(''), '')
    assert.ok(!maskSecret('supersecretkey123').includes('secret'))
  })

  it('labels the OBS status, "En direct" only inside a live', () => {
    assert.equal(obsStatusLabel('offline', true), 'Hors ligne')
    assert.equal(obsStatusLabel('connecting', true), 'Connexion…')
    assert.equal(obsStatusLabel('live', true), 'En direct')
    assert.equal(obsStatusLabel('live', false), 'Signal reçu')
    assert.ok(isObsStatus('live') && isObsStatus('offline') && !isObsStatus('LIVE') && !isObsStatus(undefined))
  })

  it('maps the ingress API errors to French messages', () => {
    assert.ok(isIngressUnavailable(apiError(INGRESS_UNAVAILABLE)))
    assert.ok(!isIngressUnavailable(apiError('NOT_FOUND', 404)))
    assert.match(ingressErrorMessage(apiError(INGRESS_UNAVAILABLE)) ?? '', /LiveKit/)
    assert.match(ingressErrorMessage(apiError(INGRESS_SERVICE_UNREACHABLE, 503)) ?? '', /ne répond pas/)
    assert.equal(ingressErrorMessage(apiError('Title is required')), null)
  })

  it('guides WHIP (B-frames 0, bearer token) and RTMP (custom service, stream key) setups', () => {
    const whip = obsSetupSteps('WHIP')
    assert.ok(whip.some((step) => step.title.includes('WHIP')))
    assert.ok(whip.some((step) => step.title === 'Bearer Token' && step.copy === 'streamKey'))
    assert.ok(whip.some((step) => /B-frames : 0/.test(step.detail)))
    const rtmp = obsSetupSteps('RTMP')
    assert.ok(rtmp.some((step) => step.title.includes('Personnalisé')))
    assert.ok(rtmp.some((step) => step.title === 'Clé de stream' && step.copy === 'streamKey'))
    assert.ok(rtmp.some((step) => /4 500 à 6 000 kbit\/s/.test(step.detail)))
    for (const steps of [whip, rtmp]) {
      assert.ok(steps.some((step) => step.copy === 'serverUrl'))
      assert.ok(steps.some((step) => /images clés 2 s/.test(step.detail)))
    }
  })
})

describe('viewer quality choices per number of simulcast layers', () => {
  it('offers every choice with 3 layers (browser, OBS RTMP) or before the video arrives', () => {
    assert.deepEqual(viewerQualityOptionsFor(3), LIVEKIT_VIEWER_QUALITY_OPTIONS)
    assert.deepEqual(viewerQualityOptionsFor(null), LIVEKIT_VIEWER_QUALITY_OPTIONS)
  })

  it('only offers "Auto" for a single-layer video (OBS WHIP, forwarded as is)', () => {
    const options = viewerQualityOptionsFor(1)
    assert.deepEqual(
      options.map((option) => option.value),
      ['auto'],
    )
    assert.match(options[0].description, /Qualité unique/)
  })

  it('drops the medium layer with two layers', () => {
    assert.deepEqual(
      viewerQualityOptionsFor(2).map((option) => option.value),
      ['auto', 'high', 'low', 'data-saver'],
    )
  })
})
