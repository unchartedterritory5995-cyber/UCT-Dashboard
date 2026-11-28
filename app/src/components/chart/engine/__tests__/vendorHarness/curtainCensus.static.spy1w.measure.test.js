// app/src/components/chart/engine/__tests__/vendorHarness/curtainCensus.static.spy1w.measure.test.js
// ⭐⭐ E104 the static start-free release (`runtime/startFreeProof.js`) on spy1w, held to a run from an earlier start
// (`curtainCensus.js`): wrong == 0 on every bar it releases. ⛔ OPT-IN: RUNTIME_PERF_CENSUS=curtain
import { describe, it, expect, vi, afterEach } from 'vitest'
import { CURTAIN_CENSUS_ON, runCurtainCensus, expectStaticStartFreeExact } from './curtainCensus'

afterEach(() => { vi.unstubAllEnvs() })
describe.skipIf(!CURTAIN_CENSUS_ON)('the static start-free release on spy1w (opt-in)', () => {
  it('spy1w', () => {
    const series = { file: 'vw-lower-tf-spy-1w-2026-09-30.json', tf: 'W', fromListing: true, ticker: 'SPY', exchange: 'NYSE Arca', tails: [800, 1400] }
    expectStaticStartFreeExact(runCurtainCensus(series, { staticOn: true }), expect)
  }, 2400000)
})
