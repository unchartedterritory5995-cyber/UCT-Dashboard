// app/src/components/chart/engine/__tests__/vendorHarness/curtainCensus.weekly.measure.test.js
// (e102) the off-listing curtain census on SPY 1W and NVDA 1W (from the listing) (`curtainCensus.js`). ⛔ OPT-IN: RUNTIME_PERF_CENSUS=curtain
import { describe, it, expect, vi, afterEach } from 'vitest'
import { CURTAIN_CENSUS_ON, runCurtainCensus, expectNoWrongRelease } from './curtainCensus'

afterEach(() => { vi.unstubAllEnvs() })
describe.skipIf(!CURTAIN_CENSUS_ON)('the runtime curtain on SPY 1W and NVDA 1W (from the listing) against a run from an earlier start (opt-in)', () => {
  it('SPY 1W', () => {
    const series = { file: 'vw-lower-tf-spy-1w-2026-09-30.json', tf: 'W', fromListing: true,
      ticker: 'SPY', exchange: 'NYSE Arca', tails: [800, 1400] }
    runCurtainCensus(series, { curtainOn: true })   // the record its re-enable must bring to wrong == 0
    expectNoWrongRelease(runCurtainCensus(series), expect)
  }, 2400000)
  it('NVDA 1W', () => {
    const series = { file: 'rs-rating-fred6724-w-nvda-1w-2026-11-21.json', tf: 'W', fromListing: true,
      ticker: 'NVDA', exchange: 'NASDAQ', tails: [1000] }
    runCurtainCensus(series, { curtainOn: true })   // the record its re-enable must bring to wrong == 0
    expectNoWrongRelease(runCurtainCensus(series), expect)
  }, 2400000)
})
