// app/src/components/chart/engine/__tests__/vendorHarness/curtainCensus.static.nvda1w.measure.test.js
// ⭐⭐ E104 the static start-free release (`runtime/startFreeProof.js`) on nvda1w, held to a run from an earlier start
// (`curtainCensus.js`): wrong == 0 on every bar it releases. ⛔ OPT-IN: RUNTIME_PERF_CENSUS=curtain
import { describe, it, expect, vi, afterEach } from 'vitest'
import { CURTAIN_CENSUS_ON, runCurtainCensus, expectStaticStartFreeExact } from './curtainCensus'

afterEach(() => { vi.unstubAllEnvs() })
describe.skipIf(!CURTAIN_CENSUS_ON)('the static start-free release on nvda1w (opt-in)', () => {
  it('nvda1w', () => {
    const series = { file: 'rs-rating-fred6724-w-nvda-1w-2026-11-21.json', tf: 'W', fromListing: true, ticker: 'NVDA', exchange: 'NASDAQ', tails: [1000] }
    expectStaticStartFreeExact(runCurtainCensus(series, { staticOn: true }), expect)
  }, 2400000)
})
