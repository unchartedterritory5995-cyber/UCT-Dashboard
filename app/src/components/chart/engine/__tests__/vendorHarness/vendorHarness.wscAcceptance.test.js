// app/src/components/chart/engine/__tests__/vendorHarness/vendorHarness.wscAcceptance.test.js
//
// ⭐⭐ engine 83 — WS-C, THE CONSTANT HALF, GRADED AS A MEMBER SEES IT, BOTH LANES.
// M1 / M4 / M5 (run wsc-mbb-2026-11-18, AMEX:SPY 1D from the listing, packet 6f54e4c81044, committed):
//   · M1 and M4 are drawn by the HOST lane on both lanes and MATCH (the host already served a constant offset
//     past a declared buffer, and `max_bars_back(x, 50)` + `x[60]`);
//   · M2 (`close[n]`, n = 25 past bar 100, under `max_bars_back = 20`) is drawn by the HOST lane on both lanes and
//     MATCHes: a declared buffer no longer shrinks the host's per-bar read window (`pine.js::historyReadBufferOf`,
//     coordinator ruling 2026-11-19; it DIVERGED on `na` from bar 101, the read withheld where TradingView draws);
//   · M5 (`close[6000]`) is refused by name on the PRODUCTION lane: the host lane's lookback budget is both its
//     warm-up cap and its bar-offset ceiling (`budget.js`, one number, unchanged by this build; coordinator
//     ruling 2026-11-19). The member door hands it to the RUNTIME lane, which draws it: MATCH, every row.
import { describe, it, expect, vi, afterEach } from 'vitest'
import path from 'node:path'
import { gradeCapture, loadCapture, HARNESS_DIR } from './harness'
import { runtimePaneEnabled } from '../../runtimePaneGate'
import { memberPaneDefinition } from '../../../builder/memberPane/memberPaneDefinition'

afterEach(() => { vi.unstubAllEnvs() })
const load = (id) => loadCapture(path.join(HARNESS_DIR, `${id}.json`)).capture
const LANES = {
  production: { VITE_PINE_OBJECTS_ONLY_PANE_ENABLED: '1', VITE_PINE_RUNTIME_PANE_ENABLED: '' },
  'runtime-on': { VITE_PINE_OBJECTS_ONLY_PANE_ENABLED: '1', VITE_PINE_RUNTIME_PANE_ENABLED: '1' },
}
const arm = (lane) => {
  for (const [k, v] of Object.entries(LANES[lane])) vi.stubEnv(k, v)
  expect(runtimePaneEnabled(), lane).toBe(lane === 'runtime-on')
}
const grade = (cap, lane) => { arm(lane); return gradeCapture(cap).verdict }
const laneOf = (cap, lane) => {
  arm(lane)
  const d = memberPaneDefinition({ source: cap.source.text, id: 'u_wsc-lane', name: 'lane' })
  return d.ok ? (d.lane || 'host') : `refused:${d.guard}`
}
const ID = (m) => `vw-w4-max-bars-back-${m}-spy-1d-2026-11-18`

for (const lane of Object.keys(LANES)) {
  describe(`WS-C constant offsets, ${lane} lane`, () => {
    it.each(['m1', 'm2', 'm4'])('%s: drawn by the host lane, every row MATCH', (m) => {
      const cap = load(ID(m))
      expect(laneOf(cap, lane)).toBe('host')
      const v = grade(cap, lane)
      for (const p of v.plots) expect(p.verdict, `${p.title}: ${p.reason}`).toBe('MATCH')
      expect(v.verdict).toBe('MATCH')
    })
  })
}

describe('M5 close[6000]: refused by name on the production lane, drawn by the runtime lane', () => {
  it('production: the host lane\'s lookback budget refuses it, by name', () => {
    const cap = load(ID('m5'))
    expect(laneOf(cap, 'production')).toBe('refused:budget:lookback')
    const v = grade(cap, 'production')
    expect(v.verdict).toBe('INCONCLUSIVE')
    expect(v.reason).toMatch(/budget:lookback/)
  })
  it('runtime-on: the door hands it to the runtime lane, and every row MATCHes', () => {
    const cap = load(ID('m5'))
    expect(laneOf(cap, 'runtime-on')).toBe('runtime')
    const v = grade(cap, 'runtime-on')
    expect(v.plots.length).toBe(2)
    for (const p of v.plots) expect(p.verdict, `${p.title}: ${p.reason}`).toBe('MATCH')
    expect(v.verdict).toBe('MATCH')
  })
})
