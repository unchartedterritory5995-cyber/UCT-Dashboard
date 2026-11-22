// app/src/components/chart/engine/ast/engine57Builtins.test.js
//
// ─── ⭐⭐ ENGINE 57 — THREE TRADINGVIEW BUILT-INS, MADE EXACT BY FRESH CAPTURES (2026-11-14) ─────
//
// Every vendor number pinned below is read off a TradingView capture of NYSE:RDDT 1D taken from
// the listing (the S6 capture session: the builtin `supertrend`, `stochastic-rsi`,
// `rank-correlation-index` and `rci-ribbon`). Those captures are licence-held and stay out of git;
// their BARS are the same 666 RDDT sessions as the committed
// `support-and-resistance-5f95e90f-rddt-1d-2026-11-13` fixture (checked bar for bar), so the
// scripts below — written here, in this file's own words, from each built-in's public definition —
// run on committed bars and are graded against the vendor's numbers.
//
//   SUPERTREND  Pine's `nz(band[1])` seeds and `na(atr[1]) ? 1` arm: from the listing it drew
//               NOTHING (a `na` seed latched in the ratchet); now every bar TradingView draws.
//   STOCHASTIC  `ta.stoch` lands on `stochPine`: the last n FINITE highs / lows, the previous
//               value held where the formula has none: K from bar 17, D from bar 19 (the house
//               column started 10 bars late); probe P2 pins holes and flat runs.
//   RCI         Pearson of AVERAGE ranks, first value on bar `length`, an `na` ranked lowest, a
//               flat window `na` (probe P1); the no-ties shortcut differed on windows with ties.
// What no capture pins is withheld BY NAME on the bars it touches (`stoch:flat-window`), and
// the four doors (screen, pane strict, `buildRuntimeIr`, `memberPaneDefinition`) and both lanes
// (host, runtime) are asked of it.
// Probe captures (S1, licence-held like the rest): `vw-cs1-rci-p1-rddt-1d-2026-11-14`,
// `vw-cs1-stoch-p2-rddt-1d-2026-11-14`; the scripts below are written here, not copied.
import { describe, it, expect, beforeEach } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { translatePine } from './pine.js'
import { parseFormula } from './parse.js'
import {
  interpret, FN, CHART_CLOCK_WITHHELD, STOCH_FLAT_WINDOW, STOCH_LEFT_EDGE, RCI_LEFT_EDGE, stochFlatPinned,
  rciCol, stochPineCol, stochPineScan,
} from './interpret.js'
import { buildRuntimeIr } from './pineRuntimeFrontend.js'
import { memberPaneDefinition } from '../../builder/memberPane/memberPaneDefinition'
import * as registry from '../nativeRegistry'
import { computeRuntimeColumns, resetRuntimeSessions, resetRuntimeLedgers } from '../runtime/runtimeColumns.js'

const REPO = path.resolve(process.cwd(), '..')
const RDDT_FIXTURE = path.join(REPO, 'tests/fixtures/vendor/harness/support-and-resistance-5f95e90f-rddt-1d-2026-11-13.json')
const RDDT = JSON.parse(fs.readFileSync(RDDT_FIXTURE, 'utf8')).bars.rows
  .map(([t, o, h, l, c, v]) => ({ t, o, h, l, c, v }))
const N = RDDT.length
const LISTING = { historyFromListing: true }
const CTX = { tf: 'D', newestBarIsForming: false, historyFromListing: true }

beforeEach(() => { resetRuntimeSessions(); resetRuntimeLedgers() })

/** The host lane's column for output `k`, as the chart computes it from the listing. */
function hostColumn(src, k = 0, opts = LISTING, bars = RDDT) {
  const t = translatePine(src, { strict: true, basePeriod: 'D' })
  expect(t.ok, JSON.stringify(t.refusal || (t.outputs || []).map((o) => o.refusal))).toBe(true)
  const outs = t.outputs.filter((o) => o.kind !== 'alertcondition')
  const clock = new Map()
  const col = interpret(outs[k].ast, bars, undefined, undefined, undefined, { ...opts, tf: 'D', chartClockSink: clock })
  return { col: Array.from(col), clock: [...clock.keys()].sort(), formula: outs[k].formula }
}
const runtimeDoc = (src, outputs) => ({
  id: 'e57', meta: { runtimeHistory: 'listing' },
  compute: { kind: 'runtime', fn: 'runtime:e57', outputs, source: src },
})
/** The runtime lane's columns (output name -> column), or `{ err }`. */
const runtimeRun = (src, outputs = { a: 0 }, bars = RDDT) => {
  try {
    const cols = computeRuntimeColumns(runtimeDoc(src, outputs), bars, CTX)
    return Object.fromEntries(Object.keys(outputs).map((k) => [k, Array.from(cols[k])]))
  } catch (e) { return { err: e } }
}
/** guard per door: screen / pane (strict) / runtime (buildRuntimeIr over bars) / member door */
function doors(src, bars = RDDT) {
  const g = (t) => (t.ok ? 'OK' : (t.refusal || ((t.outputs || []).find((o) => o && o.refusal) || {}).refusal || { guard: '?' }).guard)
  const rt = buildRuntimeIr(src, { bars, inputs: {}, pane: true, historyFromListing: true })
  const d = memberPaneDefinition({ source: src, id: 'u_e57', name: 'e57' })
  return [g(translatePine(src)), g(translatePine(src, { strict: true })), rt.ok ? 'OK' : rt.refusal.guard, d.ok ? 'OK' : d.guard]
}
/** the member door's served columns, by plot order, and the codes it withheld by name */
function doorColumns(src, bars = RDDT, ctx = CTX) {
  const d = memberPaneDefinition({ source: src, id: 'u_e57', name: 'e57' })
  expect(d.ok, d.reason).toBe(true)
  const cols = registry.computeFor(d.definition, bars, undefined, ctx)
  const keys = (d.definition.plots || []).filter((p) => p && p.style !== 'hlines').map((p) => p.key)
  return { cols: keys.map((k) => Array.from(cols[k])),
    clock: ((registry.chartClockReport(cols) || { withheld: [] }).withheld || []).map((r) => r.code).sort() }
}
const near = (a, b, rel = 1e-9) => Number.isFinite(a) && Math.abs(a - b) <= rel * Math.max(1, Math.abs(b))
const drawn = (col) => col.filter(Number.isFinite).length
const firstDrawn = (col) => col.findIndex(Number.isFinite)

describe('the committed bars are the captures\' bars', () => {
  it('666 RDDT sessions from the listing', () => {
    expect(N).toBe(666)
    expect(RDDT[0]).toEqual({ t: 1711027800, o: 47, h: 57.8, l: 45.05, c: 50.44, v: 48705533 })
    expect(near((RDDT[665].o + RDDT[665].c) / 2, 98.6)).toBe(true)   // the capture's Body Middle on bar 665
  })
})

// ─── SUPERTREND ──────────────────────────────────────────────────────────────────────────
// TradingView (builtin `supertrend`, v6, `ta.supertrend(3, 10)`): Up Trend drawn on 348 bars,
// Down Trend on 309 (first Down bar 9: 73.13044, first Up bar 36); from bar 200, 221 Up and 245
// Down — every one of those 466 bars holds one of the two. Spot values below.
const ST_SRC = [
  '//@version=6',
  'indicator("e57 supertrend", overlay = true)',
  '[st, dir] = ta.supertrend(3, 10)',
  // the builtin hides bar 0 the same way (`barstate.isfirst ? na : …`): Pine's own value there is
  // the upper band's `nz` seed, 0
  'plot(barstate.isfirst ? na : dir < 0 ? st : na, "Up")',
  'plot(barstate.isfirst ? na : dir < 0 ? na : st, "Down")',
].join('\n')
const ST_UP = { 200: 147.16968774256839, 300: 94.93528988958025, 590: 166.2824391021958 }
const ST_DOWN = { 227: 227.99807482398026, 400: 229.76119713864293, 500: 158.97495175458036, 665: 122.33191288924613 }

/** Pine's published `ta.supertrend`, line for line over the whole series (st.py's rule, 0
 *  mismatches against the capture on both plots over 666 bars). Not built from the expansion. */
function pineSupertrend(bars, factor, n) {
  const atr = new Array(bars.length).fill(NaN)
  let sum = 0
  for (let i = 0; i < bars.length; i += 1) {
    const b = bars[i]
    const tr = i === 0 ? b.h - b.l : Math.max(b.h - b.l, Math.abs(b.h - bars[i - 1].c), Math.abs(b.l - bars[i - 1].c))
    if (i < n - 1) { sum += tr; continue }
    atr[i] = i === n - 1 ? (sum + tr) / n : (atr[i - 1] * (n - 1) + tr) / n
  }
  const up = []
  const down = []
  let pU = NaN; let pL = NaN; let pST = NaN
  for (let i = 0; i < bars.length; i += 1) {
    const src = (bars[i].h + bars[i].l) / 2
    let U = src + factor * atr[i]
    let L = src - factor * atr[i]
    const pl = Number.isNaN(pL) ? 0 : pL
    const pu = Number.isNaN(pU) ? 0 : pU
    const c1 = i > 0 ? bars[i - 1].c : NaN
    L = (L > pl || c1 < pl) ? L : pl
    U = (U < pu || c1 > pu) ? U : pu
    const d = (i === 0 || Number.isNaN(atr[i - 1])) ? 1 : pST === pU ? (bars[i].c > U ? -1 : 1) : (bars[i].c < L ? 1 : -1)
    const st = d === -1 ? L : U
    up.push(i > 0 && d < 0 ? st : NaN)
    down.push(i > 0 && d >= 0 ? st : NaN)
    pU = U; pL = L; pST = st
  }
  return { up, down }
}

describe('supertrend from the listing (S6 builtin `supertrend`)', () => {
  it('the reference reproduces the capture\'s spot values (non-vacuity of the grade below)', () => {
    const ref = pineSupertrend(RDDT, 3, 10)
    for (const [i, v] of Object.entries(ST_UP)) expect(near(ref.up[i], v), `Up ${i}`).toBe(true)
    for (const [i, v] of Object.entries(ST_DOWN)) expect(near(ref.down[i], v), `Down ${i}`).toBe(true)
    expect(near(ref.down[9], 73.13044)).toBe(true)
    expect(firstDrawn(ref.up)).toBe(36)
    expect(drawn(ref.up)).toBe(348)
    expect(drawn(ref.down)).toBe(309)
  })

  it('draws every bar TradingView draws (348 Up + 309 Down), each equal to the vendor; it drew 0 before', () => {
    const ref = pineSupertrend(RDDT, 3, 10)
    const up = hostColumn(ST_SRC, 0).col
    const down = hostColumn(ST_SRC, 1).col
    expect(drawn(up)).toBe(348)
    expect(drawn(down)).toBe(309)
    expect(firstDrawn(down)).toBe(9)
    expect(firstDrawn(up)).toBe(36)
    for (let i = 0; i < N; i += 1) {
      for (const [ours, want, k] of [[up[i], ref.up[i], 'Up'], [down[i], ref.down[i], 'Down']]) {
        if (Number.isNaN(want)) expect(Number.isNaN(ours), `${k} ${i}`).toBe(true)
        else expect(near(ours, want), `${k} ${i}: ${ours} vs ${want}`).toBe(true)
      }
    }
    expect(near(down[9], 73.13044)).toBe(true)
    for (const [i, v] of Object.entries(ST_UP)) expect(near(up[i], v), `Up ${i}`).toBe(true)
    for (const [i, v] of Object.entries(ST_DOWN)) expect(near(down[i], v), `Down ${i}`).toBe(true)
  })

  it('the member door serves the same columns, and off the listing it still withholds bars < 400', () => {
    const on = doorColumns(ST_SRC)
    const host = [hostColumn(ST_SRC, 0).col, hostColumn(ST_SRC, 1).col]
    for (let k = 0; k < 2; k += 1) for (let i = 0; i < N; i += 1) expect(Object.is(on.cols[k][i], host[k][i]) || (Number.isNaN(on.cols[k][i]) && Number.isNaN(host[k][i])), `plot ${k} bar ${i}`).toBe(true)
    // off the listing `barstate.isfirst` is withheld by name (`bar-index:first-bar`), so the replay
    // comparison runs on the same plots without it
    const plain = ST_SRC.replace(/barstate\.isfirst \? na : /g, '')
    const onPlain = doorColumns(plain)
    const off = doorColumns(plain, RDDT, { ...CTX, historyFromListing: false })
    for (let k = 0; k < 2; k += 1) {
      expect(off.cols[k].slice(0, 400).every(Number.isNaN)).toBe(true)
      // wherever the off-listing replay draws, the listing replay draws the same number
      for (let i = 0; i < N; i += 1) if (Number.isFinite(off.cols[k][i])) expect(onPlain.cols[k][i], `plot ${k} bar ${i}`).toBe(off.cols[k][i])
    }
    expect(drawn(off.cols[0]) + drawn(off.cols[1])).toBeGreaterThan(200)
    // (the screen refuses `barstate.isfirst` by name, `pine:window-dependent`, as on master; the
    // supertrend itself translates at all four doors)
    expect(doors(plain)).toEqual(['OK', 'OK', 'OK', 'OK'])
  })
})

// ─── STOCHASTIC ──────────────────────────────────────────────────────────────────────────
// TradingView (builtin `stochastic-rsi`, v6, S6): K = sma(stoch(rsi, rsi, rsi, 14), 3) drawn on
// 649 bars from bar 17, D = sma(K, 3) on 647 from bar 19. Probe P2 (S1,
// `vw-cs1-stoch-p2-rddt-1d-2026-11-14`, v6): x = `bar_index % 50 == 30 ? na : close`,
// y = `bar_index >= 100 and bar_index < 120 ? 50.0 : close`, every column from bar 9.
const SR_SRC = [
  '//@version=6',
  'indicator("e57 stoch rsi")',
  'r = ta.rsi(close, 14)',
  'k = ta.sma(ta.stoch(r, r, r, 14), 3)',
  'd = ta.sma(k, 3)',
  'plot(k, "K")',
  'plot(d, "D")',
].join('\n')
const SR_K = { 17: 11.81834460004229, 18: 11.81834460004229, 19: 37.159810733515634, 20: 44.011448293144525,
  100: 67.88432951934263, 400: 75.84483631298703, 665: 84.01157347795736 }
const SR_D = { 19: 20.26549997786674, 20: 30.996534542234148, 100: 52.05208033208319, 400: 78.19026425931453,
  665: 71.77142513859626 }
const P2_SRC = [
  '//@version=6',
  'indicator("e57 stoch probe")',
  'float x = bar_index % 50 == 30 ? na : close',
  'float y = bar_index >= 100 and bar_index < 120 ? 50.0 : close',
  'plot(ta.stoch(x, x, x, 10), "xxx")',
  'plot(ta.stoch(x, high, low, 10), "x high low")',
  'plot(ta.stoch(y, y, y, 10), "yyy")',
].join('\n')
// read off probe P2: a hole holds the previous value (bars 30, 80); across a hole the window is
// the last 10 FINITE values (bars 34, 38, 81); the flat run (109..119) holds the 0 before it
const P2_XXX = { 29: 100, 30: 100, 34: 85.58659217877096, 38: 83.53584447144593, 39: 59.2896174863388,
  79: 23.370786516853812, 80: 23.370786516853812, 81: 0, 87: 2.5445292620864914 }
const P2_XHL = { 28: 73.98091934084997, 29: 79.52265286725103, 30: 79.52265286725103, 31: 82.2625527999202,
  79: 38.535800482703095, 80: 38.535800482703095, 81: 14.90552834149757 }
const P2_YYY = { 108: 0, 109: 0, 115: 0, 119: 0, 120: 100, 121: 94.392523364486 }

describe('ta.stoch lands on `stochPine` (S6 builtin `stochastic-rsi`, S1 probe P2)', () => {
  it('K from bar 17, D from bar 19, the vendor\'s counts and values (the house %K started on bar 27)', () => {
    const k = hostColumn(SR_SRC, 0)
    const d = hostColumn(SR_SRC, 1)
    expect(k.formula).toMatch(/\bstochPine\(/)
    expect(firstDrawn(k.col)).toBe(17)
    expect(firstDrawn(d.col)).toBe(19)
    expect(drawn(k.col)).toBe(649)
    expect(drawn(d.col)).toBe(647)
    for (const [i, v] of Object.entries(SR_K)) expect(near(k.col[i], v), `K ${i}: ${k.col[i]}`).toBe(true)
    for (const [i, v] of Object.entries(SR_D)) expect(near(d.col[i], v), `D ${i}: ${d.col[i]}`).toBe(true)
    expect(k.clock).toEqual([])
  })

  it('probe P2: a hole holds the previous value, the window spans it, the flat run holds its 0', () => {
    for (const [k, want] of [[0, P2_XXX], [1, P2_XHL], [2, P2_YYY]]) {
      const { col, clock } = hostColumn(P2_SRC, k)
      expect(firstDrawn(col), `plot ${k}`).toBe(9)
      for (const [i, v] of Object.entries(want)) expect(near(col[i], v), `plot ${k} bar ${i}: ${col[i]} vs ${v}`).toBe(true)
      expect(clock).toEqual([])
    }
  })

  it('the runtime lane and the member door draw the same columns', () => {
    for (const [src, outs] of [[SR_SRC, { k: 0, d: 1 }], [P2_SRC, { a: 0, b: 1, c: 2 }]]) {
      const keys = Object.keys(outs)
      const host = keys.map((_, j) => hostColumn(src, j).col)
      const door = doorColumns(src)
      const rt = runtimeRun(src, outs)
      expect(rt.err, rt.err && rt.err.message).toBeUndefined()
      for (let j = 0; j < keys.length; j += 1) {
        for (let i = 0; i < N; i += 1) {
          for (const [a, what] of [[door.cols[j][i], 'door'], [rt[keys[j]][i], 'runtime']]) {
            if (Number.isNaN(host[j][i])) expect(Number.isNaN(a), `${what} ${keys[j]} ${i}`).toBe(true)
            else expect(near(a, host[j][i]), `${what} ${keys[j]} ${i}: ${a} vs ${host[j][i]}`).toBe(true)
          }
        }
      }
      expect(doors(src)).toEqual(['OK', 'OK', 'OK', 'OK'])
    }
  })

  it('the runtime KERNEL (a source the run computes) draws the same columns', () => {
    const sr = runtimeRun(SR_SRC.replace('r = ta.rsi(close, 14)', 'var float r = 0.0\nr := ta.rsi(close, 14)'), { k: 0, d: 1 })
    expect(sr.err, sr.err && sr.err.message).toBeUndefined()
    expect(firstDrawn(sr.k)).toBe(17)
    for (const [i, v] of Object.entries(SR_K)) expect(near(sr.k[i], v), `K ${i}: ${sr.k[i]}`).toBe(true)
    const p2 = runtimeRun(P2_SRC.replace('float x = bar_index % 50 == 30 ? na : close',
      'var float x = 0.0\nx := bar_index % 50 == 30 ? na : close'), { a: 0, b: 1, c: 2 })
    expect(p2.err, p2.err && p2.err.message).toBeUndefined()
    for (const [i, v] of Object.entries(P2_XXX)) expect(near(p2.a[i], v), `xxx ${i}: ${p2.a[i]}`).toBe(true)
    for (const [i, v] of Object.entries(P2_XHL)) expect(near(p2.b[i], v), `xhl ${i}: ${p2.b[i]}`).toBe(true)
  })

  it('a flat window with nothing before it is na; the house `stoch` keeps its 50', () => {
    const flat = Float64Array.from({ length: 12 }, () => 5)
    expect(Array.from(stochPineCol(flat, flat, flat, 4)).every(Number.isNaN)).toBe(true)
    expect(Array.from(FN.stoch(flat, flat, flat, 4)).slice(3)).toEqual(new Array(9).fill(50))
  })

  it('S10: a flat run after 100, the source on its level, keeps the 100 (served on every door)', () => {
    // S10 `vw-cs2-stoch-flat-window` (RDDT, three lead-ins into one flat run, 0 mismatches): y rises
    // into a flat run at its own high, the bar before the full window reads 100, and TradingView
    // keeps it through the run
    const src = [
      '//@version=6',
      'indicator("e57 stoch flat after 100")',
      'float y = bar_index >= 100 and bar_index < 120 ? 1000.0 : close',
      'plot(ta.stoch(y, y, y, 10))',
    ].join('\n')
    const { col, clock } = hostColumn(src)
    expect(clock).toEqual([])
    for (let i = 100; i <= 119; i += 1) expect(col[i], `bar ${i}`).toBe(100)
    expect(doors(src)).toEqual(['OK', 'OK', 'OK', 'OK'])
    const rt = runtimeRun(src)
    expect(rt.err, rt.err && rt.err.message).toBeUndefined()
    expect(rt.a.slice(100, 120)).toEqual(new Array(20).fill(100))
    expect(doorColumns(src).clock).toEqual([])
  })

  it('a flat window the captures do not pin (source off the level) is withheld by name; the runtime declines by the same code', () => {
    const src = [
      '//@version=6',
      'indicator("e57 stoch flat off level")',
      'float y = bar_index >= 100 and bar_index < 120 ? 1000.0 : close',
      'float s = bar_index == 108 ? 1000.0 : close',
      'plot(ta.stoch(s, y, y, 10))',
    ].join('\n')
    const { col, clock } = hostColumn(src)
    expect(clock).toEqual([STOCH_FLAT_WINDOW])
    // bar 108 reads 100 (the source at the window's high), so the flat windows (bars 109..119) keep
    // a 100 as the S10 run does, but with the source off the level: only the level tells them apart
    expect(col[108]).toBe(100)
    for (let i = 109; i <= 119; i += 1) expect(Number.isNaN(col[i]), `bar ${i}`).toBe(true)
    expect(Number.isFinite(col[120])).toBe(true)
    const [screen, pane, runtime, door] = doors(src)
    expect([screen, pane, door]).toEqual(['OK', 'OK', 'OK'])
    expect(runtime).toBe(STOCH_FLAT_WINDOW)
    expect(doorColumns(src).clock).toEqual([STOCH_FLAT_WINDOW])
    expect(CHART_CLOCK_WITHHELD[STOCH_FLAT_WINDOW]()).toMatch(/strictly between 0 and 100/)
  })

  it('`stochFlatPinned`: pinned only by provenance (the kept value computed at the high or low) with the source on the level', () => {
    expect(stochFlatPinned(true, true)).toBe(true)
    expect([stochFlatPinned(false, true), stochFlatPinned(true, false), stochFlatPinned(false, false)]).toEqual([false, false, false])
  })

  it('review N2: a kept 100 that is not the double 100 is pinned by provenance; a kept 40 is not', () => {
    // a (lo, hi) pair whose 100 * (hi - lo) / (hi - lo) is not exactly 100
    let pair = null
    for (let t = 0; t < 5000 && !pair; t += 1) {
      const lo = 1 + t * 0.37
      const hi = lo + 3.3 + t * 0.011
      if ((100 * (hi - lo)) / (hi - lo) !== 100) pair = { lo, hi }
    }
    expect(pair).not.toBe(null)
    const { lo, hi } = pair
    // n = 3: bars 0..2 at the high (≈100), then the lows rise to the high: flat on the level from bar 5
    const H = Float64Array.from([hi, hi, hi, hi, hi, hi, hi])
    const L = Float64Array.from([lo, lo, lo, hi, hi, hi, hi])
    const C = Float64Array.from([hi, hi, hi, hi, hi, hi, hi])
    const near100 = stochPineScan(H, L, C, 3)
    expect(near100.out[4]).not.toBe(100)
    expect(Math.abs(near100.out[4] - 100)).toBeLessThan(1e-12)
    expect(Array.from(near100.flags)).toEqual([0, 0, 0, 0, 0, 0, 0])
    expect(near100.out[5]).toBe(near100.out[4])
    // a 40 kept through two `na` sources, then a flat window on its level: no capture pins it
    const H2 = Float64Array.from([10, 10, 10, 5, 5, 5])
    const L2 = Float64Array.from([0, 0, 0, 5, 5, 5])
    const C2 = Float64Array.from([4, 4, 4, NaN, NaN, 5])
    const kept40 = stochPineScan(H2, L2, C2, 3)
    expect(kept40.out[5]).toBe(40)
    expect(Array.from(kept40.flags)).toEqual([0, 0, 0, 0, 0, 1])
  })
})

// ─── RCI ─────────────────────────────────────────────────────────────────────────────────
// TradingView (builtins `rank-correlation-index` and `rci-ribbon`, v6, S6): RCI(10) from bar 10 on
// 656 bars, its 14-bar SMA from bar 23 on 643, RCI(30) from bar 30 on 636, RCI(50) from bar 50 on
// 616. Bars 103 / 55 / 55 hold a tie in their window: the shortcut drew 45.151515151515156 /
// 67.77530589543937 / 78.54261704681873 there. Probe P1 (S1, `vw-cs1-rci-p1-rddt-1d-2026-11-14`).
const RCI_SRC = [
  '//@version=6',
  'indicator("e57 rci")',
  'r10 = ta.rci(close, 10)',
  'plot(r10, "RCI 10")',
  'plot(ta.sma(r10, 14), "RCI MA")',
  'plot(ta.rci(close, 30), "RCI 30")',
  'plot(ta.rci(close, 50), "RCI 50")',
].join('\n')
const RCI_VENDOR = [
  { first: 10, count: 656, at: { 10: -45.45454545454545, 11: -75.75757575757575, 103: 44.98501023232478, 300: 76.96969696969697, 665: 47.878787878787875 } },
  { first: 23, count: 643, at: { 23: -66.75324675324676, 24: -59.047619047619044, 300: -7.619047619047619, 665: -52.121212121212125 } },
  { first: 30, count: 636, at: { 30: -42.64738598442713, 55: 67.77172141169241, 300: -37.352614015572854, 665: -81.80200222469408 } },
  { first: 50, count: 616, at: { 50: 45.67106842737095, 55: 78.54210187382422, 300: 8.883766719648742, 665: -66.25210084033614 } },
]
const P1_SRC = [
  '//@version=6',
  'indicator("e57 rci probe")',
  'plot(ta.rci(ta.sma(close, 5), 10), "sma5")',
  'plot(ta.rci(math.round(close / 1000), 10), "flat")',
].join('\n')
// read off probe P1: the windows of bars 10..12 still hold the `sma`'s warm-up, ranked lowest
const P1_SMA = { 10: 30.0636128378526, 11: -1.2158110873601293, 12: -44.24242424242424, 13: -98.78787878787878 }

describe('ta.rci is the Pearson correlation of average ranks (S6 `rank-correlation-index`, `rci-ribbon`; S1 probe P1)', () => {
  it.each([0, 1, 2, 3])('plot %s: the vendor\'s first bar, count and values (tie bars included)', (k) => {
    const { col, clock } = hostColumn(RCI_SRC, k)
    const want = RCI_VENDOR[k]
    expect(firstDrawn(col)).toBe(want.first)
    expect(drawn(col)).toBe(want.count)
    for (const [i, v] of Object.entries(want.at)) expect(near(col[i], v), `bar ${i}: ${col[i]} vs ${v}`).toBe(true)
    expect(clock).toEqual([])
  })

  it('probe P1: a warm-up `na` in the window ranks lowest (bars 10..12 drawn), a flat window is na', () => {
    const sma = hostColumn(P1_SRC, 0)
    expect(firstDrawn(sma.col)).toBe(10)
    expect(drawn(sma.col)).toBe(656)
    for (const [i, v] of Object.entries(P1_SMA)) expect(near(sma.col[i], v), `bar ${i}: ${sma.col[i]} vs ${v}`).toBe(true)
    expect(sma.clock).toEqual([])
    const flat = hostColumn(P1_SRC, 1)
    expect(flat.col.every(Number.isNaN)).toBe(true)
    expect(flat.clock).toEqual([])
  })

  it('the member door and the runtime lane draw the same columns', () => {
    for (const [src, outs] of [[RCI_SRC, { a: 0, b: 1, c: 2, d: 3 }], [P1_SRC, { a: 0, b: 1 }]]) {
      const keys = Object.keys(outs)
      const door = doorColumns(src)
      const rt = runtimeRun(src, outs)
      expect(rt.err, rt.err && rt.err.message).toBeUndefined()
      for (let k = 0; k < keys.length; k += 1) {
        const host = hostColumn(src, k).col
        for (let i = 0; i < N; i += 1) {
          for (const [a, what] of [[door.cols[k][i], 'door'], [rt[keys[k]][i], 'runtime']]) {
            if (Number.isNaN(host[i])) expect(Number.isNaN(a), `${what} ${k} ${i}`).toBe(true)
            else expect(near(a, host[i]), `${what} ${k} ${i}`).toBe(true)
          }
        }
      }
      expect(doors(src)).toEqual(['OK', 'OK', 'OK', 'OK'])
    }
  })

  it('by hand: a tie shares the average rank; a rising window is +100, a falling one -100', () => {
    const rising = Float64Array.from([1, 2, 3, 4, 5, 6])
    expect(rciCol(rising, 5)[5]).toBeCloseTo(100, 12)
    expect(Number.isNaN(rciCol(rising, 5)[4])).toBe(true)             // first value on bar n
    expect(rciCol(Float64Array.from([6, 5, 4, 3, 2, 1]), 5)[5]).toBeCloseTo(-100, 12)
    // window [2, 1, 1] (oldest first), n = 3: time ranks 3, 2, 1; price ranks 1, 2.5, 2.5;
    // Pearson = cov / sqrt(var_t · var_p) = (-1.5) / sqrt(2 · 1.5) = -0.8660254...
    expect(rciCol(Float64Array.from([9, 2, 1, 1]), 3)[3]).toBeCloseTo(-100 * 1.5 / Math.sqrt(3), 12)
  })

  it('an `na` ranks below every value, ties with every other `na`, whatever the source (the coordinator\'s S1 ruling)', () => {
    // a source with negative values and a leading `na`: the change of a 5-bar average
    const src = '//@version=6\nindicator("e57 rci na lowest")\nplot(ta.rci(ta.change(ta.sma(close, 5)), 10))'
    const { col, clock } = hostColumn(src)
    expect(clock).toEqual([])
    expect(firstDrawn(col)).toBe(10)
    // by hand, bar 10: window bars 1..10, bars 1..4 `na` (lowest, tied), 5..10 the changes
    const sma = RDDT.map((_, i) => (i < 4 ? NaN : RDDT.slice(i - 4, i + 1).reduce((a, b) => a + b.c, 0) / 5))
    const ch = sma.map((v, i) => (i < 5 ? NaN : v - sma[i - 1]))
    const w = ch.slice(1, 11).map((v) => (Number.isFinite(v) ? v : -Infinity))   // oldest first
    const n = 10
    const m = (n + 1) / 2
    const rank = (v) => 1 + w.filter((x) => x > v).length + (w.filter((x) => x === v).length - 1) / 2
    let cov = 0
    let vp = 0
    for (let k = 0; k < n; k += 1) {
      const p = rank(w[n - 1 - k])
      cov += (k + 1 - m) * (p - m)
      vp += (p - m) * (p - m)
    }
    expect(col[10]).toBeCloseTo((100 * cov) / Math.sqrt(((n * (n * n - 1)) / 12) * vp), 10)
    expect(ch.slice(5, 11).some((v) => v < 0)).toBe(true)          // non-vacuity: negatives present
    expect(doors(src)).toEqual(['OK', 'OK', 'OK', 'OK'])
  })
})

// ─── downstream of a withheld bar ───────────────────────────────────────────────────────
describe('a withheld stochastic bar reaches every root bar that reads it', () => {
  const FLAT = 'float y = bar_index >= 100 and bar_index < 120 ? 1000.0 : close'
  it('a finite window withholds its reach; a smoother that never forgets withholds every later bar', () => {
    const wma = hostColumn(`//@version=6\nindicator("e57 stoch wma")\n${FLAT}\nplot(ta.wma(ta.stoch(close, y, y, 10), 3))`)
    expect(wma.clock).toEqual([STOCH_FLAT_WINDOW])
    for (let i = 109; i <= 121; i += 1) expect(Number.isNaN(wma.col[i]), `bar ${i}`).toBe(true)
    expect(wma.col.slice(125).every(Number.isFinite)).toBe(true)
    const ema = hostColumn(`//@version=6\nindicator("e57 stoch ema")\n${FLAT}\nplot(ta.ema(ta.stoch(close, y, y, 10), 3))`)
    expect(ema.clock).toEqual([STOCH_FLAT_WINDOW])
    expect(ema.col.slice(109).every(Number.isNaN)).toBe(true)
    expect(Number.isFinite(ema.col[108])).toBe(true)
  })

  it('a stochastic inside `request.security` is not analysed and is drawn (the stated residual)', () => {
    const src = '//@version=6\nindicator("e57 stoch htf")\nplot(request.security(syminfo.tickerid, "W", ta.stoch(close, high, low, 14)))'
    const { col, clock } = hostColumn(src)
    expect(clock).toEqual([])
    expect(drawn(col)).toBeGreaterThan(400)
  })
})

// ─── REVIEW #1294 (F1, F3, F5) ───────────────────────────────────────────────────────────
// The reviewer's measurements, re-run as rails: the member door on a chart that does NOT reach
// the listing (RDDT from bar 100), against the listing's own answer on the same bars.
describe('review #1294 — off the listing, the left edge of a warming-up source is withheld by name (F1)', () => {
  const K = 100
  const SUFFIX = RDDT.slice(K)
  const OFF = { ...CTX, historyFromListing: false }
  const V = (b) => `//@version=6\nindicator("e57 edge")\n${b}`
  const edgeOf = (body) => {
    const src = V(body)
    const on = doorColumns(src)
    const off = doorColumns(src, SUFFIX, OFF)
    return { on: on.cols[0], off: off.cols[0], clock: off.clock, onClock: on.clock }
  }
  it('`ta.rci(ta.sma(close, 5), 10)`: bars 10..12 withheld `rci:left-edge` (they served 97.55 / 98.48 against 98.79); every drawn bar equals the listing', () => {
    const { on, off, clock, onClock } = edgeOf('s = ta.sma(close, 5)\nplot(ta.rci(s, 10))')
    expect(clock).toEqual([RCI_LEFT_EDGE])
    expect(onClock).toEqual([])
    for (let i = 0; i <= 12; i += 1) expect(Number.isNaN(off[i]), `bar ${i}`).toBe(true)
    let drawnOff = 0
    for (let i = 13; i < SUFFIX.length; i += 1) {
      expect(near(off[i], on[i + K]), `bar ${i}: ${off[i]} vs ${on[i + K]}`).toBe(true)
      drawnOff += 1
    }
    expect(drawnOff).toBeGreaterThan(500)
  })
  it('`ta.stoch(s, s, s, 14)` over the same source: bars 13..16 (and every bar before 17) withheld `stoch:left-edge`; the rest equal the listing', () => {
    const { on, off, clock } = edgeOf('s = ta.sma(close, 5)\nplot(ta.stoch(s, s, s, 14))')
    expect(clock).toEqual([STOCH_LEFT_EDGE])
    for (let i = 0; i <= 16; i += 1) expect(Number.isNaN(off[i]), `bar ${i}`).toBe(true)
    for (let i = 17; i < SUFFIX.length; i += 1) expect(near(off[i], on[i + K]), `bar ${i}: ${off[i]} vs ${on[i + K]}`).toBe(true)
  })
  it('the control: a source with a value on every loaded bar names nothing and draws from bar 10', () => {
    const { off, clock } = edgeOf('plot(ta.rci(close, 10))')
    expect(clock).toEqual([])
    expect(firstDrawn(off)).toBe(10)
  })
})

describe('review #1294 N1 — a left-edge flag under a carried smoother reaches the tree\'s own lookback, never every later bar', () => {
  const K = 100
  const SUFFIX = RDDT.slice(K)
  const OFF = { ...CTX, historyFromListing: false }
  // the first bar drawn: the edge (the last window short of `n` finite values) plus the tree's own reach
  const FIRST = { [STOCH_LEFT_EDGE]: 30, [RCI_LEFT_EDGE]: 16 }
  const cases = [
    ['r = ta.rsi(close, 14)\nplot(ta.ema(ta.stoch(r, r, r, 14), 3))', STOCH_LEFT_EDGE],
    ['s = ta.sma(close, 5)\nplot(ta.ema(ta.rci(s, 10), 3))', RCI_LEFT_EDGE],
  ]
  for (const [body, code] of cases) {
    it(`off the listing \`${body.split('\n')[1]}\` draws, withholding only the edge's reach by \`${code}\``, () => {
      const src = `//@version=6\nindicator("e57 n1")\n${body}`
      const off = doorColumns(src, SUFFIX, OFF)
      expect(off.clock).toEqual([code])
      const col = off.cols[0]
      expect(drawn(col)).toBeGreaterThan(520)
      const f = firstDrawn(col)
      // the edge bars and their lookback reach are withheld, then every bar is drawn
      expect(f).toBeGreaterThan(10)
      expect(f).toBeLessThan(40)
      expect(col.slice(f).every(Number.isFinite)).toBe(true)
      expect(f).toBe(FIRST[code])
      // the runtime lane: drawn, or declined by a name; never a silent 0 (measured: the stoch case
      // declines `runtime:warmup-never-converges`, the rci case draws behind its own curtain)
      resetRuntimeSessions(); resetRuntimeLedgers()
      let rt = null
      let err = null
      try { rt = Array.from(computeRuntimeColumns(runtimeDoc(src, { a: 0 }), SUFFIX, OFF).a) } catch (e) { err = e }
      if (err) expect(typeof err.guard === 'string' && err.guard.length > 0, String(err.message)).toBe(true)
      else expect(drawn(rt)).toBeGreaterThan(300)
    })
  }
  // ⭐⭐ re-review R1 — under a call whose value a past bar sets FOR GOOD the edge reaches every later bar
  it('`ta.valuewhen` over an edge stochastic: every bar after the edge withheld by name; over a source with no edge, served', () => {
    const edge = '//@version=6\nindicator("e57 r1")\nr = ta.rsi(close, 14)\nk = ta.stoch(r, r, r, 14)\nplot(ta.valuewhen(ta.crossunder(k, 20), k, 0))'
    const off = doorColumns(edge, SUFFIX, OFF)
    expect(off.clock).toEqual([STOCH_LEFT_EDGE])
    expect(drawn(off.cols[0])).toBe(0)                      // it served an edge bar's k until the next cross
    // from the listing it draws (nothing is withheld there)
    const on = doorColumns(edge, RDDT, CTX)
    expect(on.clock).toEqual([])
    expect(drawn(on.cols[0])).toBeGreaterThan(400)
    // the runtime lane: declined by a name, never a silent 0 and never the edge value
    resetRuntimeSessions(); resetRuntimeLedgers()
    let err = null
    let rt = null
    try { rt = Array.from(computeRuntimeColumns(runtimeDoc(edge, { a: 0 }), SUFFIX, OFF).a) } catch (e) { err = e }
    expect(err && typeof err.guard === 'string' && err.guard.length > 0, rt ? `drew ${drawn(rt)}` : '').toBe(true)
    // control: the same `ta.valuewhen` over a stochastic of the chart's own high / low / close has no edge
    const plain = '//@version=6\nindicator("e57 r1 control")\nk = ta.stoch(close, high, low, 14)\nplot(ta.valuewhen(ta.crossunder(k, 20), k, 0))'
    const ctl = doorColumns(plain, SUFFIX, OFF)
    expect(ctl.clock).toEqual([])
    expect(drawn(ctl.cols[0])).toBeGreaterThan(400)
  })

  it('the runtime lane declines by the code a column the edge withholds on EVERY bar (never a silent 0)', () => {
    const src = '//@version=6\nindicator("e57 n1 short")\ns = ta.sma(close, 5)\nplot(ta.stoch(s, s, s, 14))'
    // 17 bars: bars 0..12 are the window's warm-up (`na` everywhere), bars 13..16 read fewer than 14
    // finite values of the 5-bar mean: every bar past the warm-up is edge, so nothing is drawn
    const SHORT = RDDT.slice(100, 117)
    const host = doorColumns(src, SHORT, { ...CTX, historyFromListing: false })
    expect(host.clock).toEqual([STOCH_LEFT_EDGE])
    expect(drawn(host.cols[0])).toBe(0)
    let err = null
    let rt = null
    try { rt = computeRuntimeColumns(runtimeDoc(src, { a: 0 }), SHORT, { ...CTX, historyFromListing: false }) } catch (e) { err = e }
    expect(err && err.guard, rt ? `drew ${drawn(Array.from(rt.a))}` : '').toBe(STOCH_LEFT_EDGE)
  })
})

describe('review #1294 — a held unpinned value stays withheld through the holds that keep it (F3)', () => {
  it('an `na` source right after a flagged flat run keeps the flat run\'s value: withheld, not served', () => {
    // the flat high / low run is unpinned (the source, close, is off its level); bar 215's source is `na`
    const body = 'float x = bar_index >= 200 and bar_index < 215 ? 5000.0 : close\nfloat y = bar_index == 215 ? na : close\nplot(ta.stoch(y, x, x, 10))'
    const { col, clock } = hostColumn(`//@version=6\nindicator("e57 hold chain")\n${body}`)
    expect(clock).toEqual([STOCH_FLAT_WINDOW])
    expect(Number.isFinite(col[208])).toBe(true)
    for (let i = 209; i <= 215; i += 1) expect(Number.isNaN(col[i]), `bar ${i}`).toBe(true)   // 215 served the held value
    expect(Number.isFinite(col[216])).toBe(true)
    // the scan itself: the hold after a flagged run carries the flag
    const x = Float64Array.from({ length: 40 }, (_, i) => (i >= 20 && i < 35 ? 50 : 10 + (i % 7)))
    x[35] = NaN
    const s = Float64Array.from(x)
    for (let i = 29; i < 35; i += 1) s[i] = 49                   // the source off the flat level
    const { out, flags } = stochPineScan(x, x, s, 10)
    expect(Array.from(flags.slice(29, 35))).toEqual([1, 1, 1, 1, 1, 1])
    expect(out[35]).toBe(out[34])
    expect(flags[35]).toBe(1)
    expect(flags[36]).toBe(0)
    // control, the S10 shape: on the level after a 100, nothing is flagged and the 100 is kept
    const pinned = stochPineScan(x, x, x, 10)
    expect(Array.from(pinned.out.slice(29, 36))).toEqual(new Array(7).fill(100))
    expect(Array.from(pinned.flags).every((f) => f === 0)).toBe(true)
  })
})

describe('review #1294 — a site on other bars is withheld there, by the same code, on both lanes (F5)', () => {
  it('an unpinned flat run inside a weekly `request.security` is withheld by name there; the runtime refuses the request by name', () => {
    const src = '//@version=6\nindicator("e57 htf flat")\nfloat y = bar_index >= 60 and bar_index < 75 ? 1000.0 : close\nplot(request.security(syminfo.tickerid, "W", ta.stoch(close, y, y, 5)))'
    const { col, clock } = hostColumn(src)
    expect(clock).toEqual([STOCH_FLAT_WINDOW])
    expect(drawn(col)).toBeGreaterThan(300)
    expect(col.filter(Number.isNaN).length).toBeGreaterThan(40)
    const [screen, pane, , door] = doors(src)
    expect([screen, pane, door]).toEqual(['OK', 'OK', 'OK'])
    // ⭐ LANDING TRAIN 1 — the runtime lane, as it stands on master since RS Rating L5 (#1342), which
    // SERVES a weekly self-request (⚰️ before it, every one refused `interpret:bind-time-text` on
    // `syminfo.tickerid`, and this rail pinned that): the site is reached there too, and an unpinned
    // flat run declines the run by the SAME code (the kernel's stop), never draws it.
    const SYMBOL = { ...CTX, symbol: { ticker: 'RDDT', exchange: 'NYSE' } }
    const runtimeGuard = (s) => {
      try { computeRuntimeColumns(runtimeDoc(s, { a: 0 }), RDDT, SYMBOL) } catch (e) { return e.guard || 'threw' }
      return 'OK'
    }
    // (this script's `bar_index` is not bound inside a request on that lane: a refusal by name)
    expect(runtimeGuard(src)).not.toBe('OK')
    // the same flat run counted with `ta.cum(1)` (weeks 13..20 of the weekly series, bars 77..96 here)
    const weekly = '//@version=6\nindicator("e57 htf flat cum")\nfloat k = ta.cum(1)\nfloat y = k > 12 and k <= 20 ? 1000.0 : close\nplot(request.security(syminfo.tickerid, "W", ta.stoch(close, y, y, 5)))'
    const hostWeekly = hostColumn(weekly)
    expect(hostWeekly.clock).toEqual([STOCH_FLAT_WINDOW])
    for (let i = 77; i <= 96; i++) expect(Number.isNaN(hostWeekly.col[i]), `bar ${i}`).toBe(true)
    expect(runtimeGuard(weekly)).toBe(STOCH_FLAT_WINDOW)
    // …and a weekly stochastic with no such run is served there, equal to the host lane on every bar
    const plain = '//@version=6\nindicator("e57 htf plain")\nplot(request.security(syminfo.tickerid, "W", ta.stoch(close, high, low, 5)))'
    const hostPlain = hostColumn(plain)
    expect(hostPlain.clock).toEqual([])
    const rt = Array.from(computeRuntimeColumns(runtimeDoc(plain, { a: 0 }), RDDT, SYMBOL).a)
    expect(drawn(rt)).toBe(drawn(hostPlain.col))
    expect(drawn(rt)).toBeGreaterThan(600)
    for (let i = 0; i < N; i++) {
      if (Number.isNaN(hostPlain.col[i])) expect(Number.isNaN(rt[i]), `bar ${i}`).toBe(true)
      else expect(rt[i], `bar ${i}`).toBeCloseTo(hostPlain.col[i], 9)
    }
  })

  // ⭐ LANDING TRAIN 1 (mutant F5b) — THE `tf` CHILD NAMES ITS OWN WITHHOLDING. The rail above reads
  // `request.security(…, "W", …)`, which is `tf_merge` since engine 56 (#1264), and `builtinWitnessMask`
  // does not list `tf_merge` among the nested reads: the ROOT analyses that site too and names the code
  // itself, so dropping the child's `chartClockSink` (F5b) left that rail green. A site under `tf` (the
  // formula language's last-closed-period read; `tf_live` shares the line) IS nested at the root, so its
  // code can only arrive through the child's own sink: the same tree, re-typed `tf`.
  it('the same site under `tf` is named by the child evaluated on the weekly bars, and only by it', () => {
    const src = '//@version=6\nindicator("e57 htf flat")\nfloat y = bar_index >= 60 and bar_index < 75 ? 1000.0 : close\nplot(request.security(syminfo.tickerid, "W", ta.stoch(close, y, y, 5)))'
    const t = translatePine(src, { strict: true, basePeriod: 'D' })
    expect(t.ok).toBe(true)
    const retype = (n) => {
      if (Array.isArray(n)) return n.map(retype)
      if (!n || typeof n !== 'object') return n
      const o = {}
      for (const k of Object.keys(n)) o[k] = k === 'type' && n[k] === 'tf_merge' ? 'tf' : retype(n[k])
      return o
    }
    const merged = t.outputs.filter((o) => o.kind !== 'alertcondition')[0].ast
    expect(JSON.stringify(merged)).toContain('"type":"tf_merge"')
    const tree = retype(merged)
    expect(JSON.stringify(tree)).not.toContain('tf_merge')
    const clock = new Map()
    const col = Array.from(interpret(tree, RDDT, undefined, undefined, undefined, { ...LISTING, tf: 'D', chartClockSink: clock }))
    expect([...clock.keys()]).toEqual([STOCH_FLAT_WINDOW])
    // the weekly flat run (weekly bars 60..74), read one closed week later: withheld on the daily bars
    // of those weeks, drawn on both sides of them
    for (let i = 309; i <= 361; i++) expect(Number.isNaN(col[i]), `bar ${i}`).toBe(true)
    expect(Number.isFinite(col[308]) && Number.isFinite(col[362])).toBe(true)
    expect(drawn(col)).toBeGreaterThan(550)
  })
})

describe('review #1294 — a site that reads a recurrence\'s own value never reaches the mask (F5)', () => {
  it('`stochPine` over `self` inside an `accum` body is refused by name by the interpreter itself', () => {
    const r = parseFormula('accum(0, stochPine(high, low, close + self * 0, 5), 20)')
    expect(r.ok, r.error).toBe(true)
    expect(() => interpret(r.ast, RDDT, {}, undefined, undefined, LISTING)).toThrow(/reads a window of bars/)
    // the control: the same tree without the self read draws
    const plain = parseFormula('accum(0, stochPine(high, low, close, 5), 20)')
    expect(Array.from(interpret(plain.ast, RDDT, {}, undefined, undefined, LISTING)).some(Number.isFinite)).toBe(true)
  })
})
