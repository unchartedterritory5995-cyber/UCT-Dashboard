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

// ─── values read straight off the capture (no harness row reader) ────────────
//
// ⭐ qqe-signals and trendlines were graded DIVERGE on the runtime lane before this
// branch's `?:` rule (`pineTernaryNa.test.js`): QQE long drew a shape at bar 73 where
// TradingView draws none, and trendlines' `res_x1 := ph ? phb1 : res_x1[1]` lost its
// held value whenever `ph` was na, so both trendlines went na from bars 368 / 491.
// These rails read the vendor's values directly — a bar with NO study-store row is
// `na` (TradingView stores a row only where some plot is non-na, measured by
// `probe-sparse-rows-rddt-1d-2026-09-27` on pine/live-captures-2) — so they do not
// depend on which harness reader a tree carries.
function vendorValues(capture, title) {
  const plot = capture.study.plots.filter((p) => (p.title || p.name) === title)
  expect(plot.length, `vendor title ${title}`).toBe(1)
  const col = capture.plotValues.fields.indexOf(plot[0].id)
  const byTime = new Map(capture.plotValues.rows.map((r) => [r[0], r[col]]))
  return capture.bars.rows.map((b) => {
    const v = byTime.get(b[0])
    return v === null || v === undefined ? NaN : v
  })
}

describe('⭐ runtime-lane values that now agree with TradingView on every bar', () => {
  // ⭐ A SHAPE is drawn where its series is truthy, so for a `plotshape` title `0`
  // and `na` are the same drawing and are compared as such. ⚠️ RESIDUAL, STATED:
  // trendlines' `Long Break` is `crossover(close, res_y)`; on bar 367 `res_y[1]` is
  // na and TradingView stores 0 (false) where this engine's cross family answers na
  // ("not computable" — `interpret.js::crossing`, a shared ruling). No shape either way.
  const SHAPES = new Set(['QQE long', 'QQE short', 'Long Break', 'Short Break'])
  const asDrawn = (xs) => xs.map((v) => (Number.isFinite(v) && v !== 0 ? v : 0))
  for (const [file, titles] of [
    ['qqe-signals-rddt-1d-2026-09-27.json', ['QQE long', 'QQE short']],
    ['trendlines-rddt-1d-2026-09-27.json', ['Resistance Trendline', 'Support Trendline', 'Long Break', 'Short Break']],
  ]) {
    it(file, () => {
      vi.stubEnv('VITE_PINE_RUNTIME_LANE_ENABLED', '1')
      const capture = load(file)
      const ours = runOurSide(capture)
      expect(ours.ok, ours.refusal).toBe(true)
      for (const title of titles) {
        const mine = ours.plots.find((q) => q.title === title)
        expect(mine && mine.column, `${title}: no column`).toBeTruthy()
        let theirs = vendorValues(capture, title)
        let own = Array.from(mine.column)
        if (SHAPES.has(title)) { theirs = asDrawn(theirs); own = asDrawn(own) }
        const bad = disagreements(own, theirs, 1e-9)
        expect(bad, `${title} disagrees on ${bad.length} bars`).toEqual([])
        expect(theirs.filter((v) => Number.isFinite(v) && v !== 0).length, `${title}: vendor drew nothing`).toBeGreaterThan(0)
      }
    })
  }
})

// ─── a DISPLACED plot's colour, read where the renderer drew it ──────────────
//
// ⭐ trendlines' pivot markers are `plotshape(ph, …, offset = -rightbars)`. The
// capture's rows are indexed by the COMPUTING bar (the value compare pairs them with
// our raw column and agreed), and the binder draws each point 15 bars LEFT of it —
// exactly where TradingView draws the circle. The harness read the drawn colour at
// the computing bar and so graded every vendor pivot "colour unresolved". The fix is
// in the harness (`ourSide.js::drawnColours`), not the product: this rail pins that
// the colour now resolves at every vendor pivot AND equals TradingView's.
describe('⭐ trendlines — a displaced marker\'s colour is graded where it is drawn', () => {
  // ⚠️ Read off the capture directly, not through `compareCapture`: on this base the
  // harness reader still counts a missing study-store row as a hole (the sparse-row
  // rule is on pine/live-captures-2), which would grade these INCONCLUSIVE for a
  // reason that has nothing to do with colour.
  it('Pivot High / Pivot Low carry the TradingView colour at every vendor pivot', () => {
    vi.stubEnv('VITE_PINE_RUNTIME_LANE_ENABLED', '1')
    const capture = load('trendlines-rddt-1d-2026-09-27.json')
    const ours = runOurSide(capture)
    expect(ours.ok, ours.refusal).toBe(true)
    for (const title of ['Pivot High', 'Pivot Low']) {
      const vp = capture.study.plots.find((p) => p.title === title)
      const hex = String(capture.study.styleState[vp.id].color).toLowerCase()
      expect(hex).toMatch(/^#[0-9a-f]{6}$/)
      const mine = ours.plots.find((p) => p.title === title)
      const vendor = vendorValues(capture, title)
      const pivots = vendor.map((x, i) => (Number.isFinite(x) ? i : -1)).filter((i) => i >= 0)
      // non-vacuity: the capture has pivots, and each one now carries OUR colour
      expect(pivots.length, `${title}: vendor drew no pivot`).toBeGreaterThan(2)
      for (const i of pivots) {
        expect(mine.colors && mine.colors[i], `${title} bar ${i}: no drawn colour`).toBeTruthy()
        expect(String(mine.colors[i]).toLowerCase().slice(0, 7), `${title} bar ${i}`).toBe(hex)
      }
    }
  })
})

// ⭐ cc-yata's `b1..b5`, `s1..s5`, `sc1`, `sc2` never fire on RDDT at the default
// inputs — na on EVERY bar on both sides — so neither side draws a point and there is
// no colour to disagree about. The harness used to report `colors: null` for them
// ("unresolvable"), which reads as a gap on our side; it now reports "drawn nowhere".
describe('⭐ cc-yata — a plot that draws nothing reports "drawn nowhere", not "unresolved"', () => {
  it('b1..b5, s1..s5, sc1, sc2: na on every bar on both sides, colours all null', () => {
    vi.stubEnv('VITE_PINE_RUNTIME_LANE_ENABLED', '1')
    const capture = load('cc-yata-rddt-1d-2026-09-27.json')
    const ours = runOurSide(capture)
    expect(ours.ok, ours.refusal).toBe(true)
    const titles = ['b1', 'b2', 'b3', 'b4', 'b5', 's1', 's2', 's3', 's4', 's5', 'sc1', 'sc2']
    for (const title of titles) {
      const mine = ours.plots.find((p) => p.title === title)
      expect(mine && mine.column, `${title}: no column`).toBeTruthy()
      // a shape draws where its series is truthy: TradingView stores `false` as 0
      const drawnAt = (xs) => xs.filter((v) => Number.isFinite(v) && v !== 0)
      expect(drawnAt(Array.from(mine.column)), `${title}: ours drew`).toEqual([])
      expect(drawnAt(vendorValues(capture, title)), `${title}: vendor drew`).toEqual([])
      expect(Array.isArray(mine.colors) && mine.colors.length === ours.bars.length, `${title}: colours`).toBe(true)
      expect(mine.colors.every((c) => c === null), title).toBe(true)
    }
    // ⛔ CONTROL — a plot that DOES draw still reports real colours, so the all-null
    // answer above is not what the reader returns for everything.
    const drawn = ours.plots.filter((p) => p.column && Array.from(p.column).some(Number.isFinite) && p.colors)
    expect(drawn.length).toBeGreaterThan(0)
    expect(drawn.some((p) => p.colors.some((c) => c !== null))).toBe(true)
  })
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

  it('OUR runtime-lane column equals the re-implementation under the ENGINE\'s OWN rulings, read off the engine', () => {
    // ⭐ THE RULINGS ARE MEASURED, NOT ASSUMED, so this rail stays true when either
    // lands (`pine/atr-seed-host` carries Pine's ATR seed): the engine's first ATR
    // bar says which seed it uses, and whether bar 474's tied high confirms as a
    // pivot on bar 476 says which tie rule it uses.
    vi.stubEnv('VITE_PINE_RUNTIME_LANE_ENABLED', '1')
    const probe = { ...capture, source: { ...capture.source, text: [
      '//@version=4', 'study("probe")', 'plot(atr(10))', 'plot(pivothigh(2, 2))', ''].join(String.fromCharCode(10)) } }
    const p = runOurSide(probe, { lane: 'runtime' })
    expect(p.ok, p.refusal).toBe(true)
    const atrCol = Array.from(p.plots[0].column)
    const phCol = Array.from(p.plots[1].column)
    const atrFirst = atrCol.findIndex(Number.isFinite)
    expect([9, 10]).toContain(atrFirst)
    const rulings = { atrBar0: atrFirst === 9, leftTie: Number.isFinite(phCol[476]) }
    const { ours } = grade(PP)
    const plot = ours.plots.find((q) => q.title === 'PP SuperTrend')
    expect(plot && plot.column, 'the runtime door did not carry the PP SuperTrend plot').toBeTruthy()
    const mine = Array.from(plot.column)
    expect(disagreements(simulate(bars, rulings), mine, 1e-9), JSON.stringify(rulings)).toEqual([])
    // …so whether it matches TradingView is exactly whether both rulings are Pine's.
    const vendorRulings = rulings.atrBar0 && rulings.leftTie
    expect(disagreements(mine, vendor, 1e-9).length === 0, JSON.stringify(rulings)).toBe(vendorRulings)
  })
})
