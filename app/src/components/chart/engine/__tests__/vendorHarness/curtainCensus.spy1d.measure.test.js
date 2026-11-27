// app/src/components/chart/engine/__tests__/vendorHarness/curtainCensus.spy1d.measure.test.js
// (e102) the off-listing curtain census on SPY 1D (8,509 bars from the listing) (`curtainCensus.js`). ⛔ OPT-IN: RUNTIME_PERF_CENSUS=curtain
import { describe, it, expect, vi, afterEach } from 'vitest'
import { CURTAIN_CENSUS_ON, runCurtainCensus, expectNoWrongRelease } from './curtainCensus'

afterEach(() => { vi.unstubAllEnvs() })
describe.skipIf(!CURTAIN_CENSUS_ON)('the runtime curtain on SPY 1D (8,509 bars from the listing) against a run from an earlier start (opt-in)', () => {
  it('SPY 1D', () => {
    expectNoWrongRelease(runCurtainCensus({ file: 'adx-and-di-for-v4-spy-1d-2026-11-17.json', tf: 'D', fromListing: true,
      ticker: 'SPY', exchange: 'NYSE Arca', tails: [2000, 5000] }), expect)
  }, 2400000)
})
