// app/src/components/chart/engine/__tests__/vendorHarness/curtainCensus.static.spy60.measure.test.js
// ⭐⭐ E104 the static start-free release (`runtime/startFreeProof.js`) on spy60, held to a run from an earlier start
// (`curtainCensus.js`): wrong == 0 on every bar it releases. ⛔ OPT-IN: RUNTIME_PERF_CENSUS=curtain
import { describe, it, expect, vi, afterEach } from 'vitest'
import { CURTAIN_CENSUS_ON, runCurtainCensus, expectStaticStartFreeExact } from './curtainCensus'

afterEach(() => { vi.unstubAllEnvs() })
describe.skipIf(!CURTAIN_CENSUS_ON)('the static start-free release on spy60 (opt-in)', () => {
  it('spy60', () => {
    const series = { file: '3-level-zigzag-semafor-spy-60-2026-11-14.json', tf: '60', fromListing: false, ticker: 'SPY', exchange: 'NYSE Arca', tails: [3000, 8000] }
    expectStaticStartFreeExact(runCurtainCensus(series, { staticOn: true }), expect)
  }, 2400000)
})
