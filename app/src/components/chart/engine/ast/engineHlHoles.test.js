// app/src/components/chart/engine/ast/engineHlHoles.test.js
//
// ─── ⭐⭐ ENGINE HL — `ta.highest` / `ta.lowest` OVER A SOURCE WITH `na` HOLES (S10, 2026-11-15) ─────
//
// WITNESSED: TradingView's `ta.highest(x, n)` / `ta.lowest(x, n)` read the LAST `n` FINITE values of
// `x`, reaching back past every `na`, and keep answering on the `na` bar itself; `na` before bar
// `n - 1`. Six captures pin it, all committed (probes written in this repo,
// `tools/visual_conformance/probes/vw-cs2-holed-highest-{v5,v6,stoch-v6}.pine`, run on NYSE:RDDT 1D
// and AMEX:SPY 1D from the listing): `x = bar_index % 50 == 30 ? na : close`, 12 columns (H01 / H02
// of each), 0 mismatches. The RESTART rule this engine held since 2026-09-08 ("the window begins
// again after a hole") misses 70 / 68 bars on RDDT and 824 / 1,034 on SPY — TradingView keeps
// 47.7 / 40.88 on RDDT's hole bar 30, where RESTART drew nothing.
//
// What no capture pins is withheld BY NAME, never guessed:
//   - `window-extreme:left-edge`: off the listing, a `highest` / `lowest` window holding fewer than
//     `n` finite values (it would reach bars this chart does not hold);
//   - `arg-extreme:holed-window`: `highestbars` / `lowestbars` keep RESTART (their only hole witness
//     is the refuted 2026-09-08 probe), and a window whose `na` the two rules read differently is
//     withheld; the runtime VM stops by the same code.
// The four doors (screen, pane strict, `buildRuntimeIr`, `memberPaneDefinition`) and both lanes
// (host, runtime) are asked of each.
import { describe, it, expect, beforeEach } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { translatePine } from './pine.js'
import {
  interpret, FN, FINITE_WINDOW, CHART_CLOCK_WITHHELD, WINDOW_EXTREME_LEFT_EDGE, ARG_EXTREME_HOLED,
  argExtremeHoled, finiteWindowCount,
} from './interpret.js'
import { buildRuntimeIr } from './pineRuntimeFrontend.js'
import { memberPaneDefinition } from '../../builder/memberPane/memberPaneDefinition'
import * as registry from '../nativeRegistry'
import { computeRuntimeColumns, resetRuntimeSessions, resetRuntimeLedgers } from '../runtime/runtimeColumns.js'

const REPO = path.resolve(process.cwd(), '..')
const FIX = (id) => JSON.parse(fs.readFileSync(path.join(REPO, 'tests/fixtures/vendor/harness', `${id}.json`), 'utf8'))
const PROBE = (name) => fs.readFileSync(path.join(REPO, 'tools/visual_conformance/probes', `${name}.pine`), 'utf8')
const CAPTURES = [
  ['vw-cs2-holed-highest-v5', 'rddt'], ['vw-cs2-holed-highest-v5', 'spy'],
  ['vw-cs2-holed-highest-v6', 'rddt'], ['vw-cs2-holed-highest-v6', 'spy'],
  ['vw-cs2-holed-highest-stoch-v6', 'rddt'], ['vw-cs2-holed-highest-stoch-v6', 'spy'],
]
const load = (probe, sym) => {
  const d = FIX(`${probe}-${sym}-1d-2026-11-15`)
  const bars = d.bars.rows.map(([t, o, h, l, c, v]) => ({ t, o, h, l, c, v }))
  const col = (k) => d.plotValues.rows.map((r) => (r[k + 1] === null ? NaN : r[k + 1]))
  return { d, bars, tv: [col(0), col(1)] }
}
const RDDT = load('vw-cs2-holed-highest-v6', 'rddt')
const LISTING = { historyFromListing: true }
const CTX = { tf: 'D', newestBarIsForming: false, historyFromListing: true }

beforeEach(() => { resetRuntimeSessions(); resetRuntimeLedgers() })

/** The host lane's column for output `k`, as the chart computes it. */
function hostColumn(src, k = 0, opts = LISTING, bars = RDDT.bars) {
  const t = translatePine(src, { strict: true, basePeriod: 'D' })
  expect(t.ok, JSON.stringify(t.refusal || (t.outputs || []).map((o) => o.refusal))).toBe(true)
  const outs = t.outputs.filter((o) => o.kind !== 'alertcondition')
  const clock = new Map()
  const col = interpret(outs[k].ast, bars, undefined, undefined, undefined, { ...opts, tf: 'D', chartClockSink: clock })
  return { col: Array.from(col), clock: [...clock.keys()].sort() }
}
const runtimeDoc = (src, outputs) => ({
  id: 'ehl', meta: { runtimeHistory: 'listing' },
  compute: { kind: 'runtime', fn: 'runtime:ehl', outputs, source: src },
})
/** The runtime lane's columns (output name -> column), or `{ err }`. */
const runtimeRun = (src, outputs = { a: 0 }, bars = RDDT.bars) => {
  try {
    const cols = computeRuntimeColumns(runtimeDoc(src, outputs), bars, CTX)
    return Object.fromEntries(Object.keys(outputs).map((k) => [k, Array.from(cols[k])]))
  } catch (e) { return { err: e } }
}
/** guard per door: screen / pane (strict) / runtime (buildRuntimeIr over bars) / member door */
function doors(src, bars = RDDT.bars) {
  const g = (t) => (t.ok ? 'OK' : (t.refusal || ((t.outputs || []).find((o) => o && o.refusal) || {}).refusal || { guard: '?' }).guard)
  const rt = buildRuntimeIr(src, { bars, inputs: {}, pane: true, historyFromListing: true })
  const d = memberPaneDefinition({ source: src, id: 'u_ehl', name: 'ehl' })
  return [g(translatePine(src)), g(translatePine(src, { strict: true })), rt.ok ? 'OK' : rt.refusal.guard, d.ok ? 'OK' : d.guard]
}
/** the member door's served columns, by plot order, and the codes it withheld by name */
function doorColumns(src, bars = RDDT.bars, ctx = CTX) {
  const d = memberPaneDefinition({ source: src, id: 'u_ehl', name: 'ehl' })
  expect(d.ok, d.reason).toBe(true)
  const cols = registry.computeFor(d.definition, bars, undefined, ctx)
  const keys = (d.definition.plots || []).filter((p) => p && p.style !== 'hlines').map((p) => p.key)
  return { cols: keys.map((k) => Array.from(cols[k])),
    clock: ((registry.chartClockReport(cols) || { withheld: [] }).withheld || []).map((r) => r.code).sort() }
}
const same = (a, b) => (Number.isFinite(a) || Number.isFinite(b)
  ? Number.isFinite(a) && Number.isFinite(b) && Math.abs(a - b) <= 1e-12 * Math.max(1, Math.abs(b)) : true)
const mismatches = (ours, tv) => tv.reduce((k, v, i) => k + (same(ours[i], v) ? 0 : 1), 0)

/** The rule, written out over a plain array: the last `n` finite values, fewer while fewer exist. */
function lastFinite(x, n, fn) {
  const out = []
  const keep = []
  for (let i = 0; i < x.length; i += 1) {
    if (Number.isFinite(x[i])) { keep.push(x[i]); if (keep.length > n) keep.shift() }
    out.push(i >= n - 1 && keep.length ? fn(...keep) : NaN)
  }
  return out
}
const HOLED = (bars) => bars.map((b, i) => (i % 50 === 30 ? NaN : b.c))

describe('⭐⭐ the S10 witness: 12 columns, 0 mismatches, on both lanes and at the member door', () => {
  it('the committed captures are what they say: from the listing, holes on bar_index % 50 == 30', () => {
    for (const [probe, sym] of CAPTURES) {
      const { d, bars } = load(probe, sym)
      expect(d.history.startsAtBar0, `${probe} ${sym}`).toBe(true)
      expect(bars.length).toBe(sym === 'rddt' ? 666 : 8507)
      const xAt = 1 + d.study.plots.findIndex((p) => p.title === 'C01_x_holed')
      expect(xAt).toBeGreaterThan(0)
      const x = d.plotValues.rows.map((r) => r[xAt])
      expect(x[30]).toBe(null)
      expect(x[29]).toBe(bars[29].c)
    }
  })

  it('⭐ the rule reproduces every captured column, and RESTART does not', () => {
    for (const [probe, sym] of CAPTURES) {
      const { bars, tv } = load(probe, sym)
      const x = HOLED(bars)
      expect(mismatches(lastFinite(x, 10, Math.max), tv[0]), `${probe} ${sym} H01`).toBe(0)
      expect(mismatches(lastFinite(x, 10, Math.min), tv[1]), `${probe} ${sym} H02`).toBe(0)
    }
    // the signature on the hole bar: TradingView keeps the window it had
    expect(RDDT.tv[0][30]).toBe(47.7)
    expect(RDDT.tv[1][30]).toBe(40.88)
  })

  it('⭐⭐ the host lane draws all 12 columns exactly, nothing withheld', () => {
    for (const [probe, sym] of CAPTURES) {
      const { bars, tv } = load(probe, sym)
      const src = PROBE(probe)
      for (const k of [0, 1]) {
        const { col, clock } = hostColumn(src, k, LISTING, bars)
        expect(mismatches(col, tv[k]), `${probe} ${sym} H0${k + 1}`).toBe(0)
        expect(clock).toEqual([])
      }
    }
  })

  it('⭐⭐ the runtime lane draws them too', () => {
    for (const [probe, sym] of CAPTURES) {
      const { bars, tv } = load(probe, sym)
      const run = runtimeRun(PROBE(probe), { h: 0, l: 1 }, bars)
      expect(run.err, `${probe} ${sym}: ${run.err && run.err.message}`).toBeUndefined()
      expect(mismatches(run.h, tv[0]), `${probe} ${sym} H01`).toBe(0)
      expect(mismatches(run.l, tv[1]), `${probe} ${sym} H02`).toBe(0)
    }
  })

  it('⭐⭐ and the member door serves them, all four doors admitting the probes', () => {
    for (const probe of ['vw-cs2-holed-highest-v5', 'vw-cs2-holed-highest-v6']) {
      expect(doors(PROBE(probe))).toEqual(['OK', 'OK', 'OK', 'OK'])
      const { cols, clock } = doorColumns(PROBE(probe))
      expect(mismatches(cols[0], RDDT.tv[0]), `${probe} door H01`).toBe(0)
      expect(mismatches(cols[1], RDDT.tv[1]), `${probe} door H02`).toBe(0)
      expect(clock).toEqual([])
    }
  })
})

describe('⭐ the rule, on synthetic series', () => {
  it('the table declares it for highest / lowest and only them', () => {
    expect(FINITE_WINDOW.highest.na).toBe('finite')
    expect(FINITE_WINDOW.lowest.na).toBe('finite')
    expect(FINITE_WINDOW.highestbars.na).toBe('restart')
    expect(FINITE_WINDOW.lowestbars.na).toBe('restart')
    expect(Object.entries(FINITE_WINDOW).filter(([, s]) => s.na === 'finite').map(([k]) => k).sort())
      .toEqual(['highest', 'lowest'])
  })

  it('reaches back past a hole and answers on the hole bar', () => {
    const src = Float64Array.from([5, 9, 7, NaN, 6, NaN, NaN, 4])
    expect(Array.from(FN.highest(src, 3))).toEqual([NaN, NaN, 9, 9, 9, 9, 9, 7])
    expect(Array.from(FN.lowest(src, 3))).toEqual([NaN, NaN, 5, 5, 6, 6, 6, 4])
  })

  it('fewer while fewer exist (a warm-up source), na before bar n-1 and before the first value', () => {
    const src = Float64Array.from([NaN, NaN, NaN, NaN, 3, 8, NaN, 2])
    expect(Array.from(FN.highest(src, 3))).toEqual([NaN, NaN, NaN, NaN, 3, 8, 8, 8])
    expect(Array.from(FN.lowest(src, 3))).toEqual([NaN, NaN, NaN, NaN, 3, 3, 3, 2])
    const early = Float64Array.from([4, 1, 2, 3])
    expect(Array.from(FN.highest(early, 3))).toEqual([NaN, NaN, 4, 3])
  })

  it('a clean source is unchanged (the plain n-bar window)', () => {
    const clean = Float64Array.from({ length: 30 }, (_, i) => 100 + Math.sin(i / 3) * 8)
    const hi = FN.highest(clean, 5)
    for (let i = 4; i < 30; i += 1) expect(hi[i]).toBe(Math.max(...clean.slice(i - 4, i + 1)))
  })

  it('finiteWindowCount counts the window it served', () => {
    expect(Array.from(finiteWindowCount(Float64Array.from([NaN, 1, NaN, 2, 3, 4]), 3))).toEqual([0, 1, 1, 2, 3, 3])
  })
})

describe('⛔ withheld by name where no capture pins the answer', () => {
  const HOLE_SRC = [
    '//@version=6',
    'indicator("ehl holes")',
    'x = bar_index % 50 == 30 ? na : close',
    'plot(ta.highest(x, 10), "h")',
  ].join('\n')

  it('⭐ off the listing, a window of fewer than n finite values is withheld (window-extreme:left-edge)', () => {
    // a warm-up source: `ta.sma(close, 20)` is `na` on bars 0..18 of THIS chart (first value bar 19), where TradingView's
    // longer history has values, so `ta.highest` over it on bars 9..27 would be a shorter window
    const src = ['//@version=6', 'indicator("ehl edge")', 'plot(ta.highest(ta.sma(close, 20), 10), "h")'].join('\n')
    const bars = RDDT.bars.slice(100)
    const off = hostColumn(src, 0, { historyFromListing: false }, bars)
    expect(off.clock).toEqual([WINDOW_EXTREME_LEFT_EDGE])
    for (let i = 0; i < 28; i += 1) expect(Number.isFinite(off.col[i]), `bar ${i}`).toBe(false)
    // from the 10th finite value on, the off-listing answer is the listing's own
    const on = hostColumn(src, 0, LISTING, RDDT.bars)
    for (let i = 28; i < bars.length; i += 1) expect(off.col[i], `bar ${i}`).toBe(on.col[i + 100])
    expect(CHART_CLOCK_WITHHELD[WINDOW_EXTREME_LEFT_EDGE]()).toMatch(/fewer than `length`/)
  })

  it('⭐ from the listing the same short window is served (nothing named)', () => {
    const src = ['//@version=6', 'indicator("ehl edge")', 'plot(ta.highest(ta.sma(close, 20), 10), "h")'].join('\n')
    const on = hostColumn(src, 0, LISTING, RDDT.bars)
    expect(on.clock).toEqual([])
    // the sma's first value (bar 19) is a window of one, served as its own value
    expect(on.col[19]).toBe(FN.sma(Float64Array.from(RDDT.bars.map((b) => b.c)), 20)[19])
    expect(Number.isFinite(on.col[18])).toBe(false)
  })

  it('⭐ off the listing, a holed source past its first n finite values is served', () => {
    const bars = RDDT.bars.slice(50)
    const off = hostColumn(HOLE_SRC, 0, { historyFromListing: false }, bars)
    const on = hostColumn(HOLE_SRC, 0, LISTING, RDDT.bars)
    // bar_index restarts off the listing, so the holes sit on this chart's own % 50 == 30
    const want = lastFinite(bars.map((b, i) => (i % 50 === 30 ? NaN : b.c)), 10, Math.max)
    expect(mismatches(off.col, want)).toBe(0)
    expect(on.clock).toEqual([])
  })

  it('⭐⭐ highestbars / lowestbars: argExtremeHoled names exactly the bars the rules could split', () => {
    // bars 0..2 warm-up na, then values, a hole at 6, values
    const src = Float64Array.from([NaN, NaN, NaN, 4, 5, 6, NaN, 7, 8, 9, 10])
    // n = 3: bars 2..4 hold only a leading warm-up na (same bars under both rules): served, except
    // bar 2 itself, whose current value is na (RESTART answers 0 there, unwitnessed)
    expect(Array.from(argExtremeHoled(src, 3, false))).toEqual([0, 0, 1, 0, 0, 0, 1, 1, 1, 0, 0])
    // off the listing, every window holding an na
    expect(Array.from(argExtremeHoled(src, 3, true))).toEqual([0, 0, 1, 1, 1, 0, 1, 1, 1, 0, 0])
    // a clean source: nothing
    expect(Array.from(argExtremeHoled(Float64Array.from([1, 2, 3, 4]), 3, true))).toEqual([0, 0, 0, 0])
  })

  it('⭐⭐ a holed highestbars is withheld by name at every lane and door; a clean one is drawn', () => {
    const holed = ['//@version=6', 'indicator("ehl hb")', 'x = bar_index % 50 == 30 ? na : close', 'plot(ta.highestbars(x, 10), "hb")'].join('\n')
    const clean = ['//@version=6', 'indicator("ehl hb")', 'plot(ta.highestbars(close, 10), "hb")'].join('\n')
    const h = hostColumn(holed, 0)
    expect(h.clock).toEqual([ARG_EXTREME_HOLED])
    // the hole bar and the 9 bars whose window holds it, after a finite value: withheld
    for (const i of [30, 31, 39, 80, 89]) expect(Number.isFinite(h.col[i]), `bar ${i}`).toBe(false)
    for (const i of [9, 29, 40, 79]) expect(Number.isFinite(h.col[i]), `bar ${i}`).toBe(true)
    expect(hostColumn(clean, 0).clock).toEqual([])
    expect(doorColumns(holed).clock).toEqual([ARG_EXTREME_HOLED])
    // the screen, the pane and the member door admit it (the host lane withholds the bars by name);
    // the runtime door declines by the same code, because it has no per-bar withholding
    expect(doors(holed)).toEqual(['OK', 'OK', ARG_EXTREME_HOLED, 'OK'])
    expect(doors(clean)).toEqual(['OK', 'OK', 'OK', 'OK'])
    const run = runtimeRun(holed)
    expect(run.err && run.err.guard).toBe(ARG_EXTREME_HOLED)
    const runClean = runtimeRun(clean)
    expect(runClean.err).toBeUndefined()
    expect(runClean.a).toEqual(hostColumn(clean, 0).col)
    expect(CHART_CLOCK_WITHHELD[ARG_EXTREME_HOLED]()).toMatch(/highestbars/)
  })

  it('⭐ a highestbars over a warm-up source (no interior hole) is served, equal on both lanes', () => {
    const src = ['//@version=6', 'indicator("ehl hb")', 'plot(ta.lowestbars(ta.sma(close, 5), 10), "lb")'].join('\n')
    const h = hostColumn(src, 0)
    // bars 9..12 hold the sma's warm-up na before its first value (bar 4): the same bars either way
    expect(h.clock).toEqual([])
    expect(Number.isFinite(h.col[9])).toBe(true)
    const run = runtimeRun(src)
    expect(run.err).toBeUndefined()
    expect(run.a).toEqual(h.col)
  })

  it('⭐ the withholding reaches downstream: a comparison over a holed highestbars is withheld, not 1', () => {
    const src = ['//@version=6', 'indicator("ehl hb")', 'x = bar_index % 50 == 30 ? na : close',
      'plot(na(ta.highestbars(x, 10)) ? 1 : 0, "n")'].join('\n')
    const h = hostColumn(src, 0)
    expect(h.clock).toEqual([ARG_EXTREME_HOLED])
    expect(Number.isFinite(h.col[30])).toBe(false)
    expect(h.col[29]).toBe(0)
  })
})
