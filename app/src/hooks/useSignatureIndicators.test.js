// Contract test for the Signature indicators' SWR gating.
//
// StockChart is never rendered in vitest (house convention), so this covers the
// one thing a live click-through can silently pass over: the toggle KEY NAMES.
// `chart_settings.signature.<key>` is persisted by chartDefaults and read by the
// hook — a rename on either side turns every toggle into a permanent no-op with
// no error anywhere. Comparing against `Object.keys(CHART_DEFAULTS.signature)`
// (not a hard-coded list) is what makes this a real gate.
import { describe, it, expect } from 'vitest'
import { CHART_DEFAULTS } from '../components/chart/chartDefaults'
import { signatureUrls, SIGNATURE_TOGGLE } from './useSignatureIndicators'

const ALL_NULL = { dpl: null, gxw: null, fcb: null }

describe('signature toggle key contract', () => {
  it('drives exactly one fetch per CHART_DEFAULTS.signature key', () => {
    const keys = Object.keys(CHART_DEFAULTS.signature)
    expect(keys.length).toBeGreaterThan(0)

    const seen = new Set()
    for (const key of keys) {
      // Only THIS toggle on. If the hook read a different key name, the whole
      // result would be all-null and this fails.
      const urls = signatureUrls('AAPL', { [key]: true }, true, 'D')
      const live = Object.entries(urls).filter(([, v]) => v !== null)
      expect(live, `chart_settings.signature.${key} drives no request`).toHaveLength(1)
      seen.add(live[0][0])
    }
    // …and no two keys drive the same request.
    expect(seen.size).toBe(keys.length)
  })

  it('exposes exactly the persisted toggle keys, no more and no less', () => {
    expect(Object.values(SIGNATURE_TOGGLE).sort())
      .toEqual(Object.keys(CHART_DEFAULTS.signature).sort())
  })

  it('defaults every toggle OFF, so a default chart fetches nothing', () => {
    expect(signatureUrls('AAPL', CHART_DEFAULTS.signature, true, 'D')).toEqual(ALL_NULL)
  })
})

describe('signature request suppression', () => {
  const allOn = { darkPoolLevels: true, gexWalls: true, flowSignals: true }

  it('suppresses every request for an unpaid user', () => {
    expect(signatureUrls('AAPL', allOn, false, 'D')).toEqual(ALL_NULL)
  })

  it('suppresses every request without a symbol', () => {
    expect(signatureUrls('', allOn, true, 'D')).toEqual(ALL_NULL)
    expect(signatureUrls(null, allOn, true, 'D')).toEqual(ALL_NULL)
    expect(signatureUrls('   ', allOn, true, 'D')).toEqual(ALL_NULL)
  })

  it('suppresses every request when settings are missing entirely', () => {
    expect(signatureUrls('AAPL', undefined, true, 'D')).toEqual(ALL_NULL)
  })

  it('hits the paid signature endpoints with an encoded symbol', () => {
    expect(signatureUrls('BRK-B', allOn, true, 'D')).toEqual({
      dpl: '/api/signature/darkpool-levels?sym=BRK-B',
      gxw: '/api/signature/gex-walls?sym=BRK-B',
      fcb: '/api/signature/flow-breakout?sym=BRK-B',
    })
  })

  it('keeps price levels but drops flow signals on an intraday timeframe', () => {
    // FCB barTimes are daily calendar keys; lightweight-charts SNAPS an unknown
    // marker time to the nearest bar rather than dropping it, so an intraday
    // chart would show the arrow on an arbitrary candle.
    for (const tf of ['1', '5', '15', '30', '60']) {
      const urls = signatureUrls('AAPL', allOn, true, tf)
      expect(urls.fcb, `tf=${tf} still requests flow-breakout`).toBeNull()
      expect(urls.dpl).not.toBeNull()
      expect(urls.gxw).not.toBeNull()
    }
    for (const tf of ['D', 'W', 'M', undefined]) {
      expect(signatureUrls('AAPL', allOn, true, tf).fcb).not.toBeNull()
    }
  })
})
