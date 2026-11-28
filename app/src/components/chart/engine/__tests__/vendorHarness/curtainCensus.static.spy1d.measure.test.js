// app/src/components/chart/engine/__tests__/vendorHarness/curtainCensus.static.spy1d.measure.test.js
// ⭐⭐ E104 the static start-free release (`runtime/startFreeProof.js`) on spy1d, held to a run from an earlier start
// (`curtainCensus.js`): wrong == 0 on every bar it releases. ⛔ OPT-IN: RUNTIME_PERF_CENSUS=curtain
import { describe, it, expect, vi, afterEach } from 'vitest'
import { CURTAIN_CENSUS_ON, runCurtainCensus, expectStaticStartFreeExact } from './curtainCensus'

afterEach(() => { vi.unstubAllEnvs() })
describe.skipIf(!CURTAIN_CENSUS_ON)('the static start-free release on spy1d (opt-in)', () => {
  it('spy1d', () => {
    const series = { file: 'adx-and-di-for-v4-spy-1d-2026-11-17.json', tf: 'D', fromListing: true, ticker: 'SPY', exchange: 'NYSE Arca', tails: [2000, 5000] }
    expectStaticStartFreeExact(runCurtainCensus(series, { staticOn: true }), expect)
  }, 2400000)
})
