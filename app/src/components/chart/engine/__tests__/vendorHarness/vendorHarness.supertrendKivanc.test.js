// app/src/components/chart/engine/__tests__/vendorHarness/vendorHarness.supertrendKivanc.test.js
//
// ─── CAP round 4 — KivancOzbilgic SuperTrend, AGAINST TRADINGVIEW ──────────────
//
//     up := close[1] > up1 ? max(up, up1) : up
//     dn := close[1] < dn1 ? min(dn, dn1) : dn
//     trend := trend == -1 and close > dn1 ? 1 : trend == 1 and close < up1 ? -1 : trend
//
// `high_engagement__03-supertrend-kivancozbilgic` was re-admitted by H1 (the ratchet)
// on CROSS-LANE evidence only: host vs runtime agreeing on RDDT, and the same ratchet
// shape graded on `pivot-point-supertrend`. No TradingView capture of the script itself
// existed. This rail grades the member door against one.
//
// ⭐ THE CAPTURE: `supertrend-kivancozbilgic-rddt-1d-2026-10-02` (NYSE:RDDT 1D, 636 bars,
// the whole listing from 2024-03-21, default inputs, `source.sha256` equal to the
// committed corpus file). Read off TradingView's own chart model with
// `tools/vendor_harness/tv_capture.js`, moved by the hash-verified clipboard path.
//
// Measured 2026-10-02: TradingView draws Up Trend on 375 bars, Down Trend on 252,
// UpTrend Begins / Buy on 5, DownTrend Begins / Sell on 6 — and the member door
// draws exactly those bars at exactly those values (rel 1e-9).
//
// Every one of the six drawn rows is compared bar for bar in BOTH directions: a value
// we draw must be TradingView's, and a bar TradingView draws must not be one we leave
// empty (from the listing there is no warm-up excuse).
import { describe, it, expect, vi, afterEach } from 'vitest'
import path from 'node:path'

import { loadCapture } from './harness'
import { runOurSide } from './ourSide'

const H = path.resolve(process.cwd(), '..', 'tests/fixtures/vendor/harness')
const CAP = loadCapture(path.join(H, 'supertrend-kivancozbilgic-rddt-1d-2026-10-02.json')).capture

afterEach(() => { vi.unstubAllEnvs() })

const ROWS = ['Up Trend', 'Down Trend', 'UpTrend Begins', 'Buy', 'DownTrend Begins', 'Sell']

function vendor(title) {
  const plot = CAP.study.plots.find((p) => p.title === title)
  const at = CAP.plotValues.fields.indexOf(plot.id)
  const byTime = new Map(CAP.plotValues.rows.map((r) => [r[0], r[at]]))
  return CAP.bars.rows.map((r) => (byTime.has(r[0]) ? byTime.get(r[0]) : null))
}

function grade(listing, title, vendorTitle = title) {
  vi.stubEnv('VITE_PINE_OBJECTS_ONLY_PANE_ENABLED', '1')
  const ours = runOurSide({ ...CAP, history: { ...CAP.history, startsAtBar0: listing } })
  expect(ours.ok, ours.refusal).toBe(true)
  const p = ours.plots.find((x) => x.title === title)
  expect(p && p.column, title).toBeTruthy()
  const v = vendor(vendorTitle)
  let drawn = 0
  const wrong = []
  Array.from(p.column).forEach((a, i) => {
    const b = v[i]
    if (a !== a) {
      if (listing && b !== null && b !== undefined) wrong.push(`#${i} ours na tv ${b}`)
      return
    }
    drawn += 1
    if (b === null || b === undefined || Math.abs(a - b) > 1e-9 * Math.max(1, Math.abs(b))) wrong.push(`#${i} ours ${a} tv ${b}`)
  })
  return { drawn, wrong, tvDrawn: v.filter((x) => x !== null && x !== undefined).length }
}

describe('CAP round 4 — KivancOzbilgic SuperTrend is TradingView\'s', () => {
  it('⭐ the capture starts at the listing, at default inputs, from the corpus source', () => {
    expect(CAP.history.startsAtBar0).toBe(true)
    expect(CAP.bars.count).toBe(636)
    expect(CAP.source.sha256).toBe('3ddd7b5dc61b285ff7c3932255bd0d66ce427a9e17edcca87322b05a384a6ce8')
    for (const t of ROWS) expect(CAP.study.plots.some((p) => p.title === t), t).toBe(true)
  })

  it.each(ROWS)('⭐ from the listing: %s on every bar, both directions', (title) => {
    const { drawn, wrong, tvDrawn } = grade(true, title)
    expect(wrong).toEqual([])
    expect(drawn).toBe(tvDrawn)
    expect(drawn).toBeGreaterThan(title.endsWith('Trend') ? 100 : 3)
  })

  it("control: the comparison can fail (our Up Trend against TradingView's Down Trend)", () => {
    const { wrong } = grade(true, 'Up Trend', 'Down Trend')
    expect(wrong.length).toBeGreaterThan(100)
  })

  it.each(['Up Trend', 'Down Trend'])('⛔ behind the curtain: %s never drawn wrong', (title) => {
    const { wrong } = grade(false, title)
    expect(wrong).toEqual([])
  })
})
