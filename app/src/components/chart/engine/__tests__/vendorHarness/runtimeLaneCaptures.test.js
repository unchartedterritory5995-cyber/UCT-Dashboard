// app/src/components/chart/engine/__tests__/vendorHarness/runtimeLaneCaptures.test.js
//
// ─── THREE LIVE TRADINGVIEW CAPTURES OF RUNTIME-LANE SCRIPTS (NYSE:RDDT 1D) ───
//
// Captured 2026-09-27 from listing day (631 bars, `history.startsAtBar0`), each
// capture's source byte-identical to the committed corpus file. All three are
// host-refused and reach a member only through the runtime-lane fallback, so these
// are the first vendor readings of the runtime lane's OWN state machinery.
//
//   · `adx-and-di-for-v4` — DI+, DI-, ADX: MATCH on all 631 bars (regression rail).
//   · `fvg-trend`         — fvgCounter, the trend plot: MATCH on all 631 bars.
//   · `pivot-point-supertrend` — the trailing line DIVERGES, and this file
//     LOCALISES the whole divergence to exactly two shared-engine rulings, neither
//     of which is the runtime lane's:
//       (a) `ta.atr` — TradingView seeds on bar n-1 with bar 0's true range =
//           high-low (`ta.rma(ta.tr(true), n)`); `computeATR` seeds on bar n. The
//           OWED owner ruling recorded in `runtime/__tests__/seedWarmup.test.js`.
//       (b) `ta.pivothigh`/`ta.pivotlow` — TradingView accepts a TIE with a LEFT
//           neighbour (bar 474: high 152.44 equals bar 473's and is a pivot);
//           `interpret.js::pivotCol` is strict on both sides by an engine ruling
//           (`closedTable.json::_functions_pivots`).
//     Proof: an independent re-implementation of the script below reproduces the
//     vendor's 631 bars EXACTLY under (a)+(b), and reproduces OUR runtime-lane
//     column EXACTLY under the engine's current rulings — so nothing else differs.
//     The right-hand tie rule is NOT exercised by this capture; it is queued as a
//     probe (docs/pine/capture-queue-2026-09-27.md).
//
// Duplicate untitled vendor titles ('Plot' ×3, 'Shapes' ×2) are INCONCLUSIVE by the
// harness's own design and are ignored here; so is the objects verdict (these three
// draw no objects and the `drawsObjects === false` rule is not on this base).
import { describe, it, expect, vi, afterEach } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { validateCapture } from '../../../../../../../tools/vendor_harness/schema.mjs'
import { compareCapture } from '../../../../../../../tools/vendor_harness/compare.mjs'
import { runOurSide } from './ourSide'
import { HARNESS_DIR } from './harness'

afterEach(() => { vi.unstubAllEnvs() })

const load = (name) => JSON.parse(fs.readFileSync(path.join(HARNESS_DIR, name), 'utf8'))

function grade(name) {
  vi.stubEnv('VITE_PINE_RUNTIME_LANE_ENABLED', '1')
  const capture = load(name)
  const integrity = validateCapture(capture)
  expect(integrity.ok, `${name} failed validation`).toBe(true)
  const ours = runOurSide(capture)
  expect(ours.ok, ours.refusal).toBe(true)
  return { capture, ours, verdict: compareCapture(capture, ours, { integrity }) }
}

const titled = (v) => (v.plots || []).filter((p) => p.title !== 'objects' && !/not unique/.test(String(p.reason)))

describe('⭐ runtime-lane scripts that MATCH TradingView on every mappable plot', () => {
  for (const [file, expected] of [
    ['adx-and-di-for-v4-rddt-1d-2026-09-27.json', ['DI+', 'DI-', 'ADX']],
    ['fvg-trend-rddt-1d-2026-09-27.json', ['fvgCounter', 'Plot']],
  ]) {
    it(file, () => {
      const { verdict } = grade(file)
      const plots = titled(verdict)
      expect(plots.map((p) => p.title)).toEqual(expected)
      for (const p of plots) {
        expect(p.verdict, `${p.title}: ${p.reason}`).toBe('MATCH')
        expect(p.stats.steady.compared, p.title).toBe(631)
      }
    })
  }
})

// ─── the independent re-implementation ───────────────────────────────────────
const PP = 'pivot-point-supertrend-rddt-1d-2026-09-27.json'

/** Pivot Point SuperTrend (prd 2, factor 3, ATR 10), written from the Pine source
 *  with the two rulings as switches. Pine's `?:` takes the else arm on `na`, and a
 *  comparison against `na` is false — both of which the engine now also does. */
function simulate(bars, { leftTie, atrBar0 }) {
  const prd = 2
  const n = bars.length
  const H = bars.map((b) => b.h)
  const L = bars.map((b) => b.l)
  const piv = (arr, i, high) => {
    const c = i - prd
    if (c - prd < 0) return NaN
    const v = arr[c]
    const beatsLeft = (w) => (high ? (leftTie ? w > v : w >= v) : (leftTie ? w < v : w <= v))
    const beatsRight = (w) => (high ? w >= v : w <= v)
    for (let k = 1; k <= prd; k += 1) if (beatsLeft(arr[c - k])) return NaN
    for (let k = 1; k <= prd; k += 1) if (beatsRight(arr[c + k])) return NaN
    return v
  }
  const atr = new Array(n).fill(NaN)
  let a = NaN; let seen = 0; let sum = 0
  for (let i = 0; i < n; i += 1) {
    const tr = i === 0
      ? (atrBar0 ? bars[0].h - bars[0].l : NaN)
      : Math.max(bars[i].h - bars[i].l, Math.abs(bars[i].h - bars[i - 1].c), Math.abs(bars[i].l - bars[i - 1].c))
    if (!Number.isFinite(tr)) continue
    if (Number.isNaN(a)) { sum += tr; seen += 1; if (seen === 10) a = sum / 10 } else a = (a * 9 + tr) / 10
    atr[i] = a
  }
  const truthy = (x) => Number.isFinite(x) && x !== 0
  let center = NaN; let tup = NaN; let tdn = NaN; let trend = NaN
  const out = []
  for (let i = 0; i < n; i += 1) {
    const ph = piv(H, i, true)
    const pl = piv(L, i, false)
    const lastpp = truthy(ph) ? ph : (truthy(pl) ? pl : NaN)
    if (truthy(lastpp)) center = Number.isNaN(center) ? lastpp : (center * 2 + lastpp) / 3
    const up = center - 3 * atr[i]
    const dn = center + 3 * atr[i]
    const c1 = i > 0 ? bars[i - 1].c : NaN
    const nTup = c1 > tup ? Math.max(up, tup) : up
    const nTdn = c1 < tdn ? Math.min(dn, tdn) : dn
    const nTrend = bars[i].c > tdn ? 1 : (bars[i].c < tup ? -1 : (Number.isNaN(trend) ? 1 : trend))
    tup = nTup; tdn = nTdn; trend = nTrend
    out.push(trend === 1 ? tup : tdn)
  }
  return out
}

/** Bars that disagree beyond `tol` (relative), `na` against a number counting. */
function disagreements(a, b, tol) {
  const bad = []
  for (let i = 0; i < a.length; i += 1) {
    const x = a[i]; const y = b[i]
    const xn = !Number.isFinite(x); const yn = !Number.isFinite(y)
    if (xn !== yn) { bad.push(i); continue }
    if (!xn && Math.abs(x - y) > tol * Math.max(1, Math.abs(x))) bad.push(i)
  }
  return bad
}

describe('⭐ pivot-point-supertrend — the divergence is two shared rulings and nothing else', () => {
  const capture = load(PP)
  const bars = capture.bars.rows.map((r) => ({ t: r[0], o: r[1], h: r[2], l: r[3], c: r[4] }))
  const col = capture.plotValues.fields.indexOf(
    (capture.study.plots.find((p) => (p.title || p.name) === 'PP SuperTrend') || {}).id)
  const vendor = capture.plotValues.rows.map((r) => (r[col] === null ? NaN : r[col]))

  it('the re-implementation under TradingView\'s rulings reproduces all 631 vendor bars', () => {
    expect(col).toBeGreaterThan(0)
    expect(vendor.filter(Number.isFinite).length).toBe(622)
    expect(disagreements(simulate(bars, { leftTie: true, atrBar0: true }), vendor, 1e-9)).toEqual([])
  })

  it('⛔ CONTROL — each ruling is load-bearing: drop either and the vendor disagrees', () => {
    const noSeed = disagreements(simulate(bars, { leftTie: true, atrBar0: false }), vendor, 1e-9)
    const noTie = disagreements(simulate(bars, { leftTie: false, atrBar0: true }), vendor, 1e-9)
    expect(noSeed[0]).toBe(9)          // TradingView's first ATR is on bar 9
    expect(noTie[0]).toBe(476)         // the left-tie pivot at bar 474 confirms on 476
  })

  it('OUR runtime-lane column equals the re-implementation under the ENGINE\'s rulings', () => {
    const { ours } = grade(PP)
    const plot = ours.plots.find((p) => p.title === 'PP SuperTrend')
    expect(plot && plot.column, 'the runtime door did not carry the PP SuperTrend plot').toBeTruthy()
    const mine = Array.from(plot.column)
    expect(disagreements(simulate(bars, { leftTie: false, atrBar0: false }), mine, 1e-9)).toEqual([])
    // and it is NOT the vendor's yet — flip this when rulings (a) and (b) land.
    expect(disagreements(mine, vendor, 1e-9).length).toBeGreaterThan(0)
  })
})
