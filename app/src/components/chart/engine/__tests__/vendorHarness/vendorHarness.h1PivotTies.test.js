// app/src/components/chart/engine/__tests__/vendorHarness/vendorHarness.h1PivotTies.test.js
//
// ─── H1 — A PLATEAU PIVOTS ON ITS LAST BAR: `pivothigh` / `pivotlow` ties ─────
//
// `pivotCol` (interpret.js, and `_pivot_col` in the Python lane) required the pivot
// bar to beat EVERY bar of its window strictly, so two equal highs made neither a
// pivot. TradingView does not read it that way, and two kinds of capture say so:
//
//   · a tie on the LEFT pivots — `pivot-point-supertrend-rddt-1d-2026-09-27`:
//     bars 473 and 474 both print a 152.44 high, and TradingView's center line (a
//     running average of `pivothigh(2, 2)` / `pivotlow(2, 2)`) moves at bar 476,
//     which only bar 474 being a pivot explains. The script's own supertrend line,
//     replayed by hand on the engine's pivot column, matches TradingView on all 631
//     bars with the tie admitted, and diverges from bar 476 without it;
//   · a tie on the RIGHT does not — `liquidity-pools` and
//     `price-action-as-in-book-…` plot their pivots, and both go DIVERGE when a
//     right tie is admitted too (measured 2026-10-02: one bar each).
//
// So a plateau pivots once, on its last bar.
import { describe, it, expect, vi, afterEach } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

import { FN } from '../../ast/interpret'
import { loadCapture, gradeCapture } from './harness'

const H = path.resolve(process.cwd(), '..', 'tests/fixtures/vendor/harness')
const cap = (f) => JSON.parse(fs.readFileSync(path.join(H, f), 'utf8'))

afterEach(() => { vi.unstubAllEnvs() })

const PPST = cap('pivot-point-supertrend-rddt-1d-2026-09-27.json')
const rows = PPST.bars.rows
const high = Float64Array.from(rows.map((r) => r[2]))
const low = Float64Array.from(rows.map((r) => r[3]))
const close = rows.map((r) => r[4])
const vendorLine = (() => {
  const at = PPST.plotValues.fields.indexOf('plot_4')
  return PPST.plotValues.rows.map((r) => r[at])
})()

/** The script's arithmetic written out by hand from its source (prd 2, factor 3,
 *  ATR 10), reading the pivots it is HANDED — so the only thing this replay does
 *  not compute itself is the pivot rule under test. The engine's `pivothigh`
 *  answers ON the pivot bar and Pine's at its confirmation, `prd` bars later
 *  (`pine.js::pivotAtConfirmation`), so the replay reads it `[2]`. */
function supertrendFrom(onPivotH, onPivotL) {
  const n = rows.length
  const ph = Array.from({ length: n }, (_, i) => (i >= 2 ? onPivotH[i - 2] : NaN))
  const pl = Array.from({ length: n }, (_, i) => (i >= 2 ? onPivotL[i - 2] : NaN))
  const tr = rows.map((r, i) => (i === 0 ? r[2] - r[3]
    : Math.max(r[2] - r[3], Math.abs(r[2] - rows[i - 1][4]), Math.abs(r[3] - rows[i - 1][4]))))
  const atr = new Array(n).fill(NaN)
  for (let i = 9; i < n; i++) {
    atr[i] = i === 9 ? tr.slice(0, 10).reduce((a, b) => a + b, 0) / 10 : (atr[i - 1] * 9 + tr[i]) / 10
  }
  const isNa = (x) => x !== x
  let center = NaN
  const up = new Array(n).fill(NaN)
  const dn = new Array(n).fill(NaN)
  const out = new Array(n).fill(NaN)
  let trend = NaN
  for (let i = 0; i < n; i++) {
    const p = !isNa(ph[i]) && ph[i] !== 0 ? ph[i] : (!isNa(pl[i]) && pl[i] !== 0 ? pl[i] : NaN)
    if (!isNa(p)) center = isNa(center) ? p : (center * 2 + p) / 3
    const Up = center - 3 * atr[i]
    const Dn = center + 3 * atr[i]
    const pu = i > 0 ? up[i - 1] : NaN
    const pd = i > 0 ? dn[i - 1] : NaN
    up[i] = i > 0 && close[i - 1] > pu ? Math.max(Up, pu) : Up
    dn[i] = i > 0 && close[i - 1] < pd ? Math.min(Dn, pd) : Dn
    trend = close[i] > pd ? 1 : close[i] < pu ? -1 : (isNa(trend) ? 1 : trend)
    out[i] = trend === 1 ? up[i] : dn[i]
  }
  return out
}
const disagreements = (line) => {
  const bad = []
  line.forEach((v, i) => {
    const t = vendorLine[i]
    if (t === null && v !== v) return
    if (t === null || v !== v || Math.abs(v - t) > 1e-9 * Math.max(1, Math.abs(t))) bad.push(i)
  })
  return bad
}
/** The old rule, for the control: strict on both sides. */
function strictPivot(series, beats) {
  const out = new Array(series.length).fill(NaN)
  for (let i = 2; i < series.length - 2; i++) {
    let ok = true
    for (let j = i - 2; j <= i + 2; j++) if (j !== i && !beats(series[i], series[j])) ok = false
    if (ok) out[i] = series[i]
  }
  return out
}

describe('H1 — a tie on the LEFT is a pivot (pivot-point-supertrend, NYSE:RDDT 1D)', () => {
  it('⭐ the witness bar: 473 and 474 tie at 152.44, and 474 pivots', () => {
    expect([high[473], high[474]]).toEqual([152.44, 152.44])
    const ph = FN.pivothigh(high, 2, 2)
    expect(ph[474]).toBe(152.44)
    expect(ph[473]).toBeNaN() // a tie on its RIGHT
  })

  it('⭐ replayed on the engine\'s pivots, the script\'s line is TradingView\'s on all 631 bars', () => {
    const line = supertrendFrom(FN.pivothigh(high, 2, 2), FN.pivotlow(low, 2, 2))
    expect(disagreements(line)).toEqual([])
    expect(line.filter((v) => v === v).length).toBeGreaterThan(600) // non-vacuity
  })

  it('⛔ control: on STRICT pivots the same replay leaves TradingView at bar 476', () => {
    const line = supertrendFrom(strictPivot(high, (v, w) => v > w), strictPivot(low, (v, w) => v < w))
    const bad = disagreements(line)
    expect(bad[0]).toBe(476)
    expect(bad.length).toBeGreaterThan(50)
  })
})

describe('H1 — a tie on the RIGHT is not (two captures that plot their pivots)', () => {
  it.each([
    ['liquidity-pools-rddt-1d-2026-09-28.json', ['Swing High', 'Swing Low']],
    ['price-action-as-in-book-fibonacci-supportresistant-trendline-rddt-1d-2026-09-28.json', ['Pivot High', 'Pivot Low']],
  ])('⭐ %s: every pivot plot MATCHES TradingView', (f, titles) => {
    vi.stubEnv('VITE_PINE_OBJECTS_ONLY_PANE_ENABLED', '1')
    const loaded = loadCapture(path.join(H, f))
    const { verdict } = gradeCapture(loaded.capture)
    for (const t of titles) {
      const p = (verdict.plots || []).find((x) => x.title === t)
      expect(p, t).toBeTruthy()
      expect(p.verdict, `${t}: ${p.reason || ''}`).toBe('MATCH')
    }
  })
})
