// app/src/components/chart/engine/__tests__/vendorHarness/curtainCensus.static.aapl1d.measure.test.js
// ⭐⭐ E104 the static start-free release (`runtime/startFreeProof.js`) on aapl1d, held to a run from an earlier start
// (`curtainCensus.js`): wrong == 0 on every bar it releases. ⛔ OPT-IN: RUNTIME_PERF_CENSUS=curtain
import { describe, it, expect, vi, afterEach } from 'vitest'
import { CURTAIN_CENSUS_ON, runCurtainCensus, expectStaticStartFreeExact } from './curtainCensus'

afterEach(() => { vi.unstubAllEnvs() })
describe.skipIf(!CURTAIN_CENSUS_ON)('the static start-free release on aapl1d (opt-in)', () => {
  it('aapl1d', () => {
    const series = { file: 'supertrend-strategy-deep-aapl-1d-2026-11-19.json', tf: 'D', fromListing: true, ticker: 'AAPL', exchange: 'NASDAQ', tails: [3500, 7000] }
    expectStaticStartFreeExact(runCurtainCensus(series, { staticOn: true }), expect)
  }, 2400000)
})
