// app/src/components/chart/engine/__tests__/vendorHarness/curtainCensus.spy60.measure.test.js
// (e102) the off-listing curtain census on SPY 60 (23,554 bars, not from the listing) (`curtainCensus.js`). ⛔ OPT-IN: RUNTIME_PERF_CENSUS=curtain
import { describe, it, expect, vi, afterEach } from 'vitest'
import { CURTAIN_CENSUS_ON, runCurtainCensus, expectNoWrongRelease } from './curtainCensus'

afterEach(() => { vi.unstubAllEnvs() })
describe.skipIf(!CURTAIN_CENSUS_ON)('the runtime curtain on SPY 60 (23,554 bars, not from the listing) against a run from an earlier start (opt-in)', () => {
  it('SPY 60', () => {
    expectNoWrongRelease(runCurtainCensus({ file: '3-level-zigzag-semafor-spy-60-2026-11-14.json', tf: '60', fromListing: false,
      ticker: 'SPY', exchange: 'NYSE Arca', tails: [3000, 8000] }), expect)
  }, 2400000)
})
