// app/src/components/chart/engine/__tests__/vendorHarness/curtainCensus.aapl1d.measure.test.js
// (e102) the off-listing curtain census on AAPL 1D (11,572 bars from the listing) (`curtainCensus.js`). ⛔ OPT-IN: RUNTIME_PERF_CENSUS=curtain
import { describe, it, expect, vi, afterEach } from 'vitest'
import { CURTAIN_CENSUS_ON, runCurtainCensus, expectNoWrongRelease } from './curtainCensus'

afterEach(() => { vi.unstubAllEnvs() })
describe.skipIf(!CURTAIN_CENSUS_ON)('the runtime curtain on AAPL 1D (11,572 bars from the listing) against a run from an earlier start (opt-in)', () => {
  it('AAPL 1D', () => {
    const series = { file: 'supertrend-strategy-deep-aapl-1d-2026-11-19.json', tf: 'D', fromListing: true,
      ticker: 'AAPL', exchange: 'NASDAQ', tails: [3500, 7000] }
    runCurtainCensus(series, { curtainOn: true })   // the record its re-enable must bring to wrong == 0
    expectNoWrongRelease(runCurtainCensus(series), expect)
  }, 2400000)
})
