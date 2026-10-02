// app/src/components/chart/engine/__tests__/vendorHarness/vendorHarness.h1Ratchet.test.js
//
// ─── H1 — A RATCHET, AGAINST TRADINGVIEW: pivot-point-supertrend ──────────────
//
//     TUp   := close[1] > TUp[1]   ? max(Up, TUp[1])   : Up
//     TDown := close[1] < TDown[1] ? min(Dn, TDown[1]) : Dn
//
// Both stops reset on a test that reads the stop, so `forgetsOnReset` refused them
// (`pine:state`) and the script never reached the member door. H1 admits the test
// (an ordering comparison of the state against price) and `interpret.js` decides it
// with the RANGE window — published only where every earlier history gives one value.
//
// ⭐ WHAT IS PINNED, against `pivot-point-supertrend-rddt-1d-2026-09-27` (NYSE:RDDT 1D,
// 631 bars, the whole listing):
//   - from the listing (C12w) the PP SuperTrend line is TradingView's on every bar it
//     draws (622 — the rest are TradingView's own `na`), and so are the Buy / Sell
//     labels' prices;
//   - behind the curtain (a chart that does not start at the listing) every bar it
//     draws is TradingView's, and it draws a real stretch of them (the center line
//     is a bounded 250-bar window, so the curtain can start only past that).
// (The pivots it reads are TradingView's because of `vendorHarness.h1PivotTies`.)
import { describe, it, expect, vi, afterEach } from 'vitest'
import path from 'node:path'

import { loadCapture } from './harness'
import { runOurSide } from './ourSide'

const H = path.resolve(process.cwd(), '..', 'tests/fixtures/vendor/harness')
const CAP = loadCapture(path.join(H, 'pivot-point-supertrend-rddt-1d-2026-09-27.json')).capture

afterEach(() => { vi.unstubAllEnvs() })

const vendor = (title) => {
  const plot = CAP.study.plots.find((p) => p.title === title)
  const at = CAP.plotValues.fields.indexOf(plot.id)
  return CAP.plotValues.rows.map((r) => r[at])
}
function grade(listing, title) {
  vi.stubEnv('VITE_PINE_OBJECTS_ONLY_PANE_ENABLED', '1')
  const ours = runOurSide({ ...CAP, history: { ...CAP.history, startsAtBar0: listing } })
  expect(ours.ok, ours.refusal).toBe(true)
  const p = ours.plots.find((x) => x.title === title)
  expect(p && p.column, title).toBeTruthy()
  const col = Array.from(p.column)
  const v = vendor(title)
  let drawn = 0
  const wrong = []
  col.forEach((a, i) => {
    if (a !== a) return
    drawn += 1
    const b = v[i]
    if (b === null || Math.abs(a - b) > 1e-9 * Math.max(1, Math.abs(b))) wrong.push(`#${i} ours ${a} tv ${b}`)
  })
  return { drawn, wrong }
}

describe('H1 — pivot-point-supertrend is TradingView\'s', () => {
  it('⭐ the capture starts at the listing', () => {
    expect(CAP.history.startsAtBar0).toBe(true)
  })

  it('⭐ from the listing: the PP SuperTrend line on all 622 bars TradingView draws', () => {
    const { drawn, wrong } = grade(true, 'PP SuperTrend')
    expect(wrong).toEqual([])
    expect(drawn).toBe(vendor('PP SuperTrend').filter((x) => x !== null).length)
  })

  it.each(['Buy', 'Sell'])('⭐ from the listing: every %s label sits at TradingView\'s price', (title) => {
    const { drawn, wrong } = grade(true, title)
    expect(wrong).toEqual([])
    expect(drawn).toBeGreaterThan(3)
  })

  it('⭐ behind the curtain: every bar drawn is TradingView\'s, and there are well over a hundred', () => {
    const { drawn, wrong } = grade(false, 'PP SuperTrend')
    expect(wrong).toEqual([])
    expect(drawn).toBeGreaterThan(100)
  })
})
