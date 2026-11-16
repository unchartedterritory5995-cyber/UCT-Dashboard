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
// ⭐⭐ S17 (2026-11-15) — `ta.highestbars` / `ta.lowestbars` read the SAME last `n` finite values, with
// the offset counted in BARS (`vw-cs2-holed-highestbars-rddt-1d-2026-11-15`, probe
// `tools/visual_conformance/probes/vw-cs2-holed-highestbars.pine`, 4 columns, 0 mismatches; bar 30,
// the hole: -1; bar 37: `ta.lowestbars` -10). ⚰️ #1332 had withheld that case
// (`arg-extreme:holed-window`) on 130 bars; the code is gone.
// What no capture pins is withheld BY NAME, never guessed:
//   - `window-extreme:left-edge`: off the listing, a `highest` / `lowest` / `highestbars` /
//     `lowestbars` window holding fewer than `n` finite values (it would reach bars this chart does
//     not hold).
// The four doors (screen, pane strict, `buildRuntimeIr`, `memberPaneDefinition`) and both lanes
// (host, runtime) are asked of each.
import { describe, it, expect, beforeEach } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { translatePine } from './pine.js'
import {
  interpret, FN, FINITE_WINDOW, CHART_CLOCK_WITHHELD, WINDOW_EXTREME_LEFT_EDGE, finiteWindowCount,
} from './interpret.js'
import * as interpretModule from './interpret.js'
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

describe('⭐⭐ the S17 witness: ta.highestbars / ta.lowestbars over a holed source, offsets in BARS', () => {
  // `vw-cs2-holed-highestbars-rddt-1d-2026-11-15` (probe written in this repo, NYSE:RDDT 1D from the
  // listing): plots A00 bar_index, A01 na(x), B00 highestbars(x, 10), B01 lowestbars(x, 10), W00..W03
  // the same over `close` (no hole).
  const HB = FIX('vw-cs2-holed-highestbars-rddt-1d-2026-11-15')
  const HB_BARS = HB.bars.rows.map(([t, o, h, l, c, v]) => ({ t, o, h, l, c, v }))
  const HB_TV = (k) => HB.plotValues.rows.map((r) => (r[k + 1] === null ? NaN : r[k + 1]))
  const COLS = [2, 3, 6, 7]
  const HB_SRC = PROBE('vw-cs2-holed-highestbars')

  it('the committed capture is what it says: from the listing, the hole on bar_index % 50 == 30', () => {
    expect(HB.history.startsAtBar0).toBe(true)
    expect(HB_BARS.length).toBe(666)
    expect(HB.study.plots.map((p) => p.title)).toEqual(['A00_bar_index_CONTROL', 'A01_x_is_na',
      'B00_highestbars_x_10', 'B01_lowestbars_x_10', 'W00_highest_close_10', 'W01_lowest_close_10',
      'W02_highestbars_close_10', 'W03_lowestbars_close_10'])
    expect(HB_TV(1)[30]).toBe(1)
    // the signature: on the hole bar an offset, not 0; past it the offset reaches -10 (in BARS)
    expect(HB_TV(2)[30]).toBe(-1)
    expect(HB_TV(3)[30]).toBe(-10)
    expect(HB_TV(3)[37]).toBe(-10)
    // 130 bars hold the hole in their 10-bar window (#1332 withheld every one)
    let holed = 0
    for (let i = 9; i < HB_BARS.length; i += 1) if (HB_TV(1).slice(i - 9, i + 1).includes(1)) holed += 1
    expect(holed).toBe(130)
  })

  it('⭐ the rule (last 10 finite values, offset in bars, ties to the older) reproduces all four columns', () => {
    const x = HB_BARS.map((b, i) => (i % 50 === 30 ? NaN : b.c))
    const c = HB_BARS.map((b) => b.c)
    const rule = (s, better) => s.map((_, i) => {
      if (i < 9) return NaN
      const idx = []
      for (let j = i; j >= 0 && idx.length < 10; j -= 1) if (Number.isFinite(s[j])) idx.unshift(j)
      let best = idx[0]
      for (const j of idx) if (better(s[j], s[best])) best = j
      return best - i
    })
    expect(mismatches(rule(x, (a, b) => a > b), HB_TV(2))).toBe(0)
    expect(mismatches(rule(x, (a, b) => a < b), HB_TV(3))).toBe(0)
    expect(mismatches(rule(c, (a, b) => a > b), HB_TV(6))).toBe(0)
    expect(mismatches(rule(c, (a, b) => a < b), HB_TV(7))).toBe(0)
  })

  it('⭐⭐ the host lane draws all eight columns exactly, nothing withheld', () => {
    for (let k = 0; k < 8; k += 1) {
      const { col, clock } = hostColumn(HB_SRC, k, LISTING, HB_BARS)
      expect(mismatches(col, HB_TV(k)), `plot ${k}`).toBe(0)
      expect(clock).toEqual([])
    }
  })

  it('⭐⭐ the runtime lane draws them too', () => {
    const run = runtimeRun(HB_SRC, { b0: 2, b1: 3, w2: 6, w3: 7 }, HB_BARS)
    expect(run.err, run.err && run.err.message).toBeUndefined()
    for (const [key, k] of [['b0', 2], ['b1', 3], ['w2', 6], ['w3', 7]]) {
      expect(mismatches(run[key], HB_TV(k)), key).toBe(0)
    }
  })

  it('⭐⭐ and all four doors admit the probe; the member door serves the columns', () => {
    expect(doors(HB_SRC, HB_BARS)).toEqual(['OK', 'OK', 'OK', 'OK'])
    const { cols, clock } = doorColumns(HB_SRC, HB_BARS)
    for (const k of COLS) expect(mismatches(cols[k], HB_TV(k)), `door plot ${k}`).toBe(0)
    expect(clock).toEqual([])
  })
})

describe('⭐ the rule, on synthetic series', () => {
  it('the table declares it for highest / lowest / highestbars / lowestbars and only them', () => {
    expect(Object.entries(FINITE_WINDOW).filter(([, s]) => s.na === 'finite').map(([k]) => k).sort())
      .toEqual(['highest', 'highestbars', 'lowest', 'lowestbars'])
    // ⭐ S17 — the two offset members count in BARS (`arg`); no member keeps RESTART or `naCurrent`
    expect(Object.entries(FINITE_WINDOW).filter(([, s]) => s.arg === true).map(([k]) => k).sort())
      .toEqual(['highestbars', 'lowestbars'])
    expect(Object.values(FINITE_WINDOW).some((s) => s.na === 'restart' || 'naCurrent' in s)).toBe(false)
  })

  it('⭐⭐ highestbars / lowestbars: the offset is counted in BARS past a hole (S17)', () => {
    const src = Float64Array.from([5, 9, 7, NaN, 6, NaN, NaN, 4])
    // internal form: a non-negative distance back (`ta.highestbars` negates it)
    expect(Array.from(FN.highestbars(src, 3))).toEqual([NaN, NaN, 1, 2, 3, 4, 5, 5])
    expect(Array.from(FN.lowestbars(src, 3))).toEqual([NaN, NaN, 2, 3, 0, 1, 2, 0])
    // a tie names the OLDER bar, in bars (the 2026-09-08 tie rule, unchanged)
    expect(Array.from(FN.highestbars(Float64Array.from([3, NaN, 3, 1]), 2))).toEqual([NaN, 1, 2, 1])
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

  it('⚰️ `arg-extreme:holed-window` is gone from every lane (S17 measured the rule)', () => {
    expect(Object.keys(CHART_CLOCK_WITHHELD)).not.toContain('arg-extreme:holed-window')
    expect('ARG_EXTREME_HOLED' in interpretModule).toBe(false)
    expect('argExtremeHoled' in interpretModule).toBe(false)
    expect(CHART_CLOCK_WITHHELD[WINDOW_EXTREME_LEFT_EDGE]()).toMatch(/ta\.highestbars/)
  })

  it('⭐ off the listing, a highestbars window of fewer than n finite values is withheld (left edge)', () => {
    const src = ['//@version=6', 'indicator("ehl hb edge")', 'plot(ta.highestbars(ta.sma(close, 20), 10), "hb")'].join('\n')
    const bars = RDDT.bars.slice(100)
    const off = hostColumn(src, 0, { historyFromListing: false }, bars)
    expect(off.clock).toEqual([WINDOW_EXTREME_LEFT_EDGE])
    for (let i = 0; i < 28; i += 1) expect(Number.isFinite(off.col[i]), `bar ${i}`).toBe(false)
    const on = hostColumn(src, 0, LISTING, RDDT.bars)
    expect(on.clock).toEqual([])
    for (let i = 28; i < bars.length; i += 1) expect(off.col[i], `bar ${i}`).toBe(on.col[i + 100])
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

  it('⭐ a comparison over a holed highestbars is drawn, 0 on the hole bar (it has an offset there)', () => {
    const src = ['//@version=6', 'indicator("ehl hb")', 'x = bar_index % 50 == 30 ? na : close',
      'plot(na(ta.highestbars(x, 10)) ? 1 : 0, "n")'].join('\n')
    const h = hostColumn(src, 0)
    expect(h.clock).toEqual([])
    expect(h.col[30]).toBe(0)
    expect(h.col[29]).toBe(0)
  })
})
