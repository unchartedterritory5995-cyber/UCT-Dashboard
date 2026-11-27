// app/src/components/chart/engine/__tests__/vendorHarness/curtainCensus.jpm1d.measure.test.js
// (e102) the off-listing curtain census on JPM 1D (14,546 bars, not from the listing; a 12.5k-row deep daily) (`curtainCensus.js`). ⛔ OPT-IN: RUNTIME_PERF_CENSUS=curtain
import { describe, it, expect, vi, afterEach } from 'vitest'
import { CURTAIN_CENSUS_ON, runCurtainCensus, expectNoWrongRelease } from './curtainCensus'

afterEach(() => { vi.unstubAllEnvs() })
describe.skipIf(!CURTAIN_CENSUS_ON)('the runtime curtain on JPM 1D (14,546 bars, not from the listing; a 12.5k-row deep daily) against a run from an earlier start (opt-in)', () => {
  it('JPM 1D', () => {
    const series = { file: 'black-scholes-option-pricing-model-w-greeks-loxx-jpm-1d-2026-11-15.json', tf: 'D',
      fromListing: false, ticker: 'JPM', exchange: 'NYSE', tails: [12500, 5000] }
    runCurtainCensus(series, { curtainOn: true })   // the record its re-enable must bring to wrong == 0
    expectNoWrongRelease(runCurtainCensus(series), expect)
  }, 2400000)
})
