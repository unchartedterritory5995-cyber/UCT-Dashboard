// app/src/components/chart/engine/__tests__/vendorHarness/curtainCensus.static.jpm1d.measure.test.js
// ⭐⭐ E104 the static start-free release (`runtime/startFreeProof.js`) on jpm1d, held to a run from an earlier start
// (`curtainCensus.js`): wrong == 0 on every bar it releases. ⛔ OPT-IN: RUNTIME_PERF_CENSUS=curtain
import { describe, it, expect, vi, afterEach } from 'vitest'
import { CURTAIN_CENSUS_ON, runCurtainCensus, expectStaticStartFreeExact } from './curtainCensus'

afterEach(() => { vi.unstubAllEnvs() })
describe.skipIf(!CURTAIN_CENSUS_ON)('the static start-free release on jpm1d (opt-in)', () => {
  it('jpm1d', () => {
    const series = { file: 'black-scholes-option-pricing-model-w-greeks-loxx-jpm-1d-2026-11-15.json', tf: 'D', fromListing: false, ticker: 'JPM', exchange: 'NYSE', tails: [12500, 5000] }
    expectStaticStartFreeExact(runCurtainCensus(series, { staticOn: true }), expect)
  }, 2400000)
})
