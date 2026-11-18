// app/src/components/chart/engine/ast/condTaLanes.test.js
//
// ─── ⭐⭐ COND-TA (plan unit U2, engine 58) — A `ta.*` CALL THAT RUNS ONLY ON SOME BARS, ON EVERY DOOR ──
//
// Pine keeps a `ta.*` call's history PER CALL SITE: a call written in an `if` block, in one
// arm of a `?:`, in an `if` expression's branch, in a helper called from one, or on the right
// of a v6 `and` / `or`, advances only on the bars that code runs. THE WITNESS:
// `vw-call-site-history-rddt-1d-2026-10-01` (NYSE:RDDT 1D from the listing), row C03 —
// `if close > open` / `c_sma := ta.sma(close, 3)`; and the v4 User Manual for Pine v4's bare
// spellings ("The history of series variables used inside Pine functions is created through
// each successive call to the function … `barssince` is not called on every bar because it
// is inside a ternary operator's conditional branch … This leads to incorrect results").
//
// WHAT EACH DOOR DID BEFORE THIS FILE (measured on master 2c37c37f9a, the probe shapes below):
//   · screener lane (`translatePine(src)`, the Import tab's Apply → a saved screen / alert)
//     translated EVERY shape `ok` as the every-bar formula — wrong on 242 of 635 RDDT bars;
//   · host / pane lane (`strict: true`, `memberPaneDefinition`): v5 / v6 gated (`meta.blockRuns`,
//     withheld at the bind where the code runs after a skip) — but a v1-v4 BARE call (`sma`)
//     was not read as a history call at all (gap G-b), and a v1-v4 `?:` arm was not stamped,
//     so both drew the every-bar number with no gate;
//   · runtime lane (`buildRuntimeIr`): exact where it serves (per-call-site state) and refused
//     by name elsewhere — except that it served v1-v3 bare calls per call site, a reading no
//     manual and no capture speaks for;
//   · Python (`ast_interpret` + `block_runs`): evaluates the saved trees and honours whatever
//     gates the document carries, so it was wrong exactly where the documents above were.
//
// ⭐ WHAT IS PINNED (each guard mutation-proved, `docs/pine/evidence/2026-11-15-cond-ta/EVIDENCE.md`):
//   1. the screener lane REFUSES each such value by name (`pine:block`, the gate's own sentence +
//      `SCREEN_GATE_SENTENCE`), and keeps what is exact: an arm an input decides, an every-bar
//      call, a one-run (`barstate.islast`) block, v4 `iff`;
//   2. ⚰️ the every-bar formula it served differs from TradingView's C03 on the capture's bars,
//      while the runtime lane's per-call-site reading equals it on every bar;
//   3. v1-v4 bare calls are history calls (G-b): a v4 block, `?:` arm, `if` expression and
//      helper are gated on the host lane and WITHHELD BY NAME at the bind on RDDT;
//   4. the runtime lane serves the v4 bare block exactly and refuses v1-v3 by name;
//   5. the legacy roster is the server detector's (`pine_capabilities._COND_TA_BARE`).
import { describe, it, expect, vi, afterEach } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

import { translatePine, SCREEN_GATE_SENTENCE } from './pine'
import { interpret } from './interpret'
import { isTaCallName } from './objectFnInline'
import { LEGACY_TA_NAMES, legacyTaCallFor } from './legacyTaNames'
import { buildRuntimeIr } from './pineRuntimeFrontend.js'
import { lowerIrProgram } from '../runtime/lowerIr.js'
import { execute } from '../runtime/vm.js'
import * as registry from '../nativeRegistry'
import { BLOCK_RUNS_GUARD } from '../blockRuns'
import { toProductBars, enterMemberDoor, HARNESS_DEF_ID } from '../__tests__/vendorHarness/ourSide'

const ROOT = path.resolve(process.cwd(), '..')
const CAP = JSON.parse(fs.readFileSync(path.join(ROOT, 'tests/fixtures/vendor/harness/vw-call-site-history-rddt-1d-2026-10-01.json'), 'utf8'))
const BARS = CAP.bars.rows.map(([t, o, h, l, c, v]) => ({ t, o, h, l, c, v: v == null ? 0 : v }))
const SERIES = ['o', 'h', 'l', 'c', 'v'].map((k) => Float64Array.from(BARS.map((b) => b[k])))

afterEach(() => { vi.unstubAllEnvs() })
/** Section 8: bars of this capture where the served `up and close > ta.sma(close, 5)` differs from the per-run reading. */
const DIFFER_AND_SMA5 = 53

/** The capture's own column for `title`, aligned to its bars (`undefined`: no row). */
const vendorColumn = (title) => {
  const i = CAP.study.plots.findIndex((p) => p.title === title)
  const byTime = new Map(CAP.plotValues.rows.map((r) => [r[0], r[1 + i]]))
  return CAP.bars.rows.map((b) => (byTime.has(b[0]) ? byTime.get(b[0]) : undefined))
}
const sameValue = (ours, theirs) => (theirs === null ? !Number.isFinite(ours)
  : Number.isFinite(ours) && Math.abs(ours - theirs) <= 1e-9 * Math.max(1, Math.abs(theirs)))
/** Bars where `ours` differs from the vendor column (bars with no vendor row skipped). */
const wrongBars = (ours, theirs) => theirs.filter((v, i) => v !== undefined && !sameValue(ours[i], v)).length
/** `ta.sma(close, 3)` over the RUNS of `close > open`, `close` elsewhere (an arm's reading). */
const armTruth = () => {
  const ring = []
  return BARS.map((b) => {
    if (!(b.c > b.o)) return b.c
    ring.push(b.c)
    if (ring.length > 3) ring.shift()
    return ring.length === 3 ? (ring[0] + ring[1] + ring[2]) / 3 : NaN
  })
}
const pine = (v, ...body) => [`//@version=${v}`, 'indicator("cond-ta")', ...body].join('\n')
const lenient = (src) => translatePine(src, { paramManifest: true })
const strict = (src) => translatePine(src, { strict: true, paramManifest: true })
// ⭐ HIST-S3 — `stop`: the run's own named stop (`callSiteRuns`): a region this lane does not step per
// call site is drawn only while it has run on every bar, and stops at the first skip
const runtime = (src) => {
  const b = buildRuntimeIr(src, { bars: BARS, inputs: {} })
  if (!b.ok) return { refusal: b.refusal }
  const program = lowerIrProgram(b.ir)
  let r
  try {
    r = execute(program, { bars: BARS.length, series: SERIES, columns: program.columns, confirmed: true })
  } catch (e) { return { stop: e } }
  return { column: Array.from(r.outputs[0]) }
}
/** The build's refusal, else the run's stop (HIST-S3). */
const notDrawn = (r) => r.refusal || r.stop || null
/** The member door + the bind over the capture's own bars (`vendorHarness.c48CallSite`'s). */
function bind(source) {
  vi.stubEnv('VITE_PINE_OBJECTS_ONLY_PANE_ENABLED', '1')
  const door = enterMemberDoor(source)
  try {
    if (!door.def) return { door, cols: null, errors: {} }
    const cols = registry.computeFor(door.def, toProductBars(CAP), undefined, {
      tf: 'D', symbol: { ticker: CAP.symbol.name, exchange: CAP.symbol.exchange },
      newestBarIsForming: CAP.newestBarIsForming ?? null, historyFromListing: true,
    })
    return { door, cols, errors: registry.columnErrors(cols) || {} }
  } finally {
    registry.uninstallUserDefinition(HARNESS_DEF_ID)
  }
}

const BLOCK = (v, call) => pine(v, `${v >= 4 ? 'float ' : ''}v = na`, 'if close > open', `    v := ${call}`, 'plot(v, "v")')
/** Every shape whose value is a call that runs only on some bars, per version. */
const GATED = {
  'v6 block ta.sma': [BLOCK(6, 'ta.sma(close, 3)'), /`v` calls `ta\.sma` inside a block that does not run on every bar/],
  'v5 block ta.ema': [BLOCK(5, 'ta.ema(close, 3)'), /`v` calls `ta\.ema` inside a block/],
  'v4 block bare sma': [BLOCK(4, 'sma(close, 3)'), /`v` calls `sma` inside a block that does not run on every bar/],
  'v3 block bare highest': [BLOCK(3, 'highest(high, 3)'), /`v` calls `highest` inside a block/],
  'v6 arm': [pine(6, 'plot(close > open ? ta.sma(close, 3) : close, "v")'), /`ta\.sma` is called in one arm of a `\?:`/],
  'v5 arm': [pine(5, 'plot(close > open ? ta.sma(close, 3) : close, "v")'), /`ta\.sma` is called in one arm of a `\?:`/],
  'v4 arm bare': [pine(4, 'plot(close > open ? sma(close, 3) : close, "v")'), /`sma` is called in one arm of a `\?:`/],
  'v6 if expression': [pine(6, 'y = if close > open', '    ta.sma(close, 3)', 'else', '    close', 'plot(y, "v")'), /one branch of an `if`/],
  'v4 if expression bare': [pine(4, 'y = if close > open', '    sma(close, 3)', 'else', '    close', 'plot(y, "v")'), /`sma` is called in one branch of an `if`/],
  'v6 helper in a block': [pine(6, 'f() => ta.sma(close, 3)', 'float v = na', 'if close > open', '    v := f()', 'plot(v, "v")'), /calls `f`, a function that reads its own history/],
  'v4 helper bare in a block': [pine(4, 'f() => sma(close, 3)', 'float v = na', 'if close > open', '    v := f()', 'plot(v, "v")'), /calls `f`, a function that reads its own history/],
  'v6 block local [1]': [pine(6, 'float v = na', 'if close > open', '    cx = close * 2', '    v := cx[1]', 'plot(v, "v")'), /`cx\[1\]` reads the history of a name declared inside a block/],
  'v6 var filled in a block': [pine(6, 'var float s = na', 'if close > open', '    s := ta.sma(close, 3)', 'plot(s, "v")'), /`s` calls `ta\.sma` inside a block/],
  // F1 (the #1326 review; WITNESSED, `vw-call-site-history` H01_param_src1_cond): a USER FUNCTION
  // reading its parameter's history, called in a block — the previous RUN's value, not the bar's
  "v6 helper reading a parameter's history (F1)": [pine(6, 'h(s) => s[1]', 'float p = na', 'if close > open', '    p := h(close)', 'plot(p, "v")'), /calls `h`, a function that reads its own history/],
  // F2 (the #1326 review): an EXPRESSION's history over a block local — fail closed
  'v6 expression history over a block local (F2)': [pine(6, 'float p = na', 'if close > open', '    x = close * 2', '    p := (x + 0)[1]', 'plot(p, "v")'), /the history of an expression over `x`/],
  // ⛔ the right side of a v6 `and` / `or` is NOT in this list: the screener lane still serves it (interim, section 8)
}

describe('COND-TA — 1. the screener lane refuses by name what no chart is bound to withhold', () => {
  // ⭐ A block local's own `x[k]` may refuse at the read (#1326's early screener throw,
  // `Resolver.blockLocalHistory`) before the value's gates are asked: either named sentence is a
  // refusal by name (coordinator ruling 2026-11-15), so those shapes need not carry the screener's.
  const EARLY_READ = new Set(['v6 block local [1]', 'v6 expression history over a block local (F2)'])
  it.each(Object.entries(GATED))('%s', (name, [src, why]) => {
    const t = lenient(src)
    expect(t.mode).toBe('screener')
    const o = t.outputs[0]
    expect(o.refusal && o.refusal.guard, o.formula || '').toBe('pine:block')
    expect(o.refusal.message).toMatch(why)
    if (!EARLY_READ.has(name)) expect(o.refusal.message).toContain(SCREEN_GATE_SENTENCE)
    // ⛔ nothing is stamped on that lane: there is no bind to read a stamp
    expect(t.blockRuns).toBeUndefined()
  })

  it('⭐ what stays served: an input-decided arm, an every-bar call, a one-run block, v4 `iff`', () => {
    const keep = {
      'input arm': [pine(6, 'u = input.bool(true, "u")', 'plot(u ? ta.sma(close, 3) : close, "v")'), 'sma(close, 3)'],
      'every bar': [pine(6, 'plot(ta.sma(close, 3), "v")'), 'sma(close, 3)'],
      // C48 A03: `ta.sma(close, 3)` on its ONE run reads `na` — the screener now reads that run
      'one run': [pine(6, 'float v = na', 'if barstate.islast', '    v := ta.sma(close, 3)', 'plot(v, "v")'), null],
      // the to-v5 guide: `iff` "always evaluated both values" — the every-bar reading
      'v4 iff': [pine(4, 'plot(iff(close > open, sma(close, 3), close), "v")'), 'close > open ? sma(close, 3) : close'],
      'a bound call read in a block': [pine(6, 'ma = ta.sma(close, 3)', 'float v = na', 'if close > open', '    v := ma', 'plot(v, "v")'), null],
      // a screen reads the VALUE: a colour whose own call runs only on some bars is no reason to refuse it
      'a conditional call in the colour only': [pine(6, 'plot(close, "v", color = close > open ? (ta.rsi(close, 14) > 50 ? color.red : color.blue) : color.gray)'), 'close'],
      // …and a colour that can HIDE the plot (an `na` entry): the host keeps that gate on the plot
      // (withheld whole, `colourWithholdsAlone`), but a screen's value is still every bar's close
      'a hiding colour with a conditional call': [pine(6, 'plot(close, "v", color = close > open and ta.rsi(close, 14) > 50 ? color.red : na)'), 'close'],
      'a conditional var read only by the colour': [pine(6, 'float s = na', 'if close > open', '    s := ta.sma(close, 3)', 'plot(close, "v", color = close > s ? color.red : color.blue)'), 'close'],
    }
    for (const [name, [src, formula]] of Object.entries(keep)) {
      const o = lenient(src).outputs[0]
      expect(o.refusal, name).toBeFalsy()
      if (formula) expect(o.formula, name).toBe(formula)
    }
    const once = interpret(lenient(keep['one run'][0]).outputs[0].ast, BARS, {})
    expect(Array.from(once).every((x) => !Number.isFinite(x))).toBe(true)
  })
})

describe('COND-TA — 2. ⚰️ the number the screener lane served, against the capture', () => {
  it('the every-bar formula is wrong on 242 of 635 bars of C03; the runtime lane\'s per-call-site reading is right on all of them', () => {
    const c03 = vendorColumn('C03_sma3_cond')
    // the formula the screener lane printed for C03's shape (still the host tree, gated there)
    const host = strict(BLOCK(6, 'ta.sma(close, 3)')).outputs[0]
    expect(host.formula).toBe('close > open ? sma(close, 3) : 0 / 0')
    expect(wrongBars(Array.from(interpret(host.ast, BARS, {})), c03)).toBe(242)
    const rt = runtime(BLOCK(6, 'ta.sma(close, 3)'))
    expect(rt.refusal).toBeFalsy()
    expect(wrongBars(rt.column, c03)).toBe(0)
  })
})

// ⭐⭐ v1 (no pragma) `?:` IS EAGER — WITNESSED. `cci-coded-obv` and `trade-archer-obv-mas-v1` (no
// pragma, NYSE:RDDT 1D from the listing, held store s2 / s4; licence-held, numbers transcribed):
// TradingView's OBV equals the EAGER (every-bar) reading on 666 / 666 bars; the LAZY reading
// mismatches 662 / 666 from bar 4. So a v1 arm is drawn as before, on every lane.
const OBV_V1 = ['study("v1 obv")', 'src = close',
  'obv(src) => ', '    cum(change(src) > 0 ? volume : change(src) < 0 ? -volume : 0*volume)',
  'o = obv(src)', 'plot(o, title="OBV")'].join('\n')
describe('COND-TA — 2c. `?:` arms: eager in v1-v3, lazy from v4 (both witnessed, run s17)', () => {
  it('the OBV construct: not stamped, served on the screener lane, drawn on the host lane, equal to the eager reading', () => {
    const t = strict(OBV_V1)
    expect(t.outputs[0].refusal).toBeFalsy()
    expect(t.blockRuns).toBeUndefined()
    // the screener lane refuses `cum` for its own reason (no anchor: `pine:function`), never this rule's
    const lr = lenient(OBV_V1).outputs[0].refusal
    expect(lr && lr.guard).not.toBe('pine:block')
    const { cols, errors } = bind(OBV_V1)
    expect(errors.value).toBeUndefined()
    // the eager OBV, by hand: every bar's change decides the bar's signed volume
    let acc = 0
    const want = BARS.map((b, i) => {
      if (i === 0) return NaN
      const ch = b.c - BARS[i - 1].c
      acc += ch > 0 ? b.v : ch < 0 ? -b.v : 0
      return acc
    })
    const got = Array.from(cols.value)
    const off = want.map((w, i) => (i === 0 || sameValue(got[i], w) ? null : i)).filter((i) => i !== null)
    expect(off).toEqual([])
  })

  // ⭐⭐ run s17-2026-11-15 (NYSE:RDDT 1D from the listing; licence-held, numbers transcribed):
  //   P2 `vw-ternary-arm-legacy-v1/v2/v3`: `t ? close : sma(close, 5)` (and change / ema / rma /
  //   barssince / cum) equal the EVERY-BAR values on every bar — v1-v3 arms are EAGER;
  //   probe 10 `vw-cs2-v4-ternary-lazy`: `up ? sma(close, 5) : close` is LAZY in v4 — bar 7:
  //   TradingView na, the eager `sma` 53.72; v4 `iff` is eager.
  // ⛔ The P2 probe reads `n`, which this engine refuses (`pine:undefined`), and `cum` has no
  // anchor on the screener lane (`pine:function`): railed on the same arm under `close > open`.
  it('v1 / v2 / v3 `?:` arms are eager: not stamped, drawn on the host and screener lanes, equal to the every-bar reading', () => {
    const t3 = 'close > open ? close : sma(close, 5)'
    for (const head of [['study("p2 v1")'], ['//@version=2', 'study("p2 v2")'], ['//@version=3', 'study("p2 v3")']]) {
      const src = [...head, `plot(${t3}, title="B_sma")`].join('\n')
      const t = strict(src)
      expect(t.outputs[0].refusal, head[0]).toBeFalsy()
      expect(t.blockRuns, head[0]).toBeUndefined()
      expect(lenient(src).outputs[0].refusal, head[0]).toBeFalsy()
      const { cols, errors } = bind(src)
      expect(errors.value, head[0]).toBeUndefined()
      const want = Array.from(interpret(t.outputs[0].ast, BARS, {}))
      expect(Array.from(cols.value).every((x, i) => sameValue(x, Number.isFinite(want[i]) ? want[i] : null)), head[0]).toBe(true)
    }
  })

  it('a v4 `?:` arm is lazy (probe 10): stamped and withheld by name on RDDT, refused on the screener lane and stopped by name on the runtime lane (HIST-S3); v4 `iff` is eager and drawn', () => {
    const src = ['//@version=4', 'study("p10 v4")', 'up = close > open', 'plot(up ? sma(close, 5) : close, title="T00")'].join('\n')
    // the witness ties to these bars: at bar 7 the EAGER sma is 53.72, where TradingView reads na
    expect(BARS.slice(3, 8).reduce((a, b) => a + b.c, 0) / 5).toBeCloseTo(53.72, 2)
    expect(strict(src).blockRuns).toBeTruthy()
    const { cols, errors } = bind(src)
    expect(cols.value).toBeUndefined()
    expect(errors.value.guard).toBe(BLOCK_RUNS_GUARD)
    expect(lenient(src).outputs[0].refusal.guard).toBe('pine:block')
    // ⭐ HIST-S3 — the runtime lane draws it only while the arm has run on every bar: on RDDT it stops by name
    expect(runtime(src).stop.guard).toBe('runtime:conditional-history')
    const iff = ['//@version=4', 'study("p10 iff")', 'up = close > open', 'plot(iff(up, sma(close, 5), close), title="C00")'].join('\n')
    expect(strict(iff).blockRuns).toBeUndefined()
    expect(bind(iff).errors.value).toBeUndefined()
  })
})

describe("COND-TA — 2b. the #1326 review's sibling shapes on the host lane (F1, F2)", () => {
  it('F1: gated on the host lane, withheld by name at the bind; its every-bar formula is wrong against H01', () => {
    const src = pine(6, 'h(s) => s[1]', 'float p = na', 'if close > open', '    p := h(close)', 'plot(p, "v")')
    const t = strict(src)
    expect(t.outputs[0].refusal).toBeFalsy()
    expect(t.blockRuns.outputs.map((x) => x.index)).toEqual([0])
    // the previous BAR's close on the bars the block runs: what the screener lane used to serve
    expect(wrongBars(Array.from(interpret(t.outputs[0].ast, BARS, {})), vendorColumn('H01_param_src1_cond'))).toBe(163)
    const { errors } = bind(src)
    expect(errors.value.guard).toBe(BLOCK_RUNS_GUARD)
  })

  it('F2: `(x + 0)[1]` over a block local is gated on the host lane (it was read as the previous bar, ungated)', () => {
    const t = strict(pine(6, 'float p = na', 'if close > open', '    x = close * 2', '    p := (x + 0)[1]', 'plot(p, "v")'))
    expect(t.outputs[0].refusal).toBeFalsy()
    expect(t.blockRuns && t.blockRuns.outputs.map((x) => x.index)).toEqual([0])
    expect(t.blockRuns.outputs[0].gates[0].why).toMatch(/the history of an expression over `x`/)
    // ⛔ CONTROL: the same expression over the CHART's series is the chart's history, not gated
    expect(strict(pine(6, 'float p = na', 'if close > open', '    p := (close + 0)[1]', 'plot(p, "v")')).blockRuns).toBeUndefined()
  })
})

describe('COND-TA — 3. Pine v1-v4 bare calls are history calls on the host lane (gap G-b)', () => {
  it.each([
    ['v4 block', BLOCK(4, 'sma(close, 3)')],
    ['v3 block', BLOCK(3, 'highest(high, 3)')],
    ['v4 arm', pine(4, 'plot(close > open ? sma(close, 3) : close, "v")')],
    ['v4 if expression', pine(4, 'y = if close > open', '    sma(close, 3)', 'else', '    close', 'plot(y, "v")')],
    ['v4 helper', pine(4, 'f() => sma(close, 3)', 'float v = na', 'if close > open', '    v := f()', 'plot(v, "v")')],
  ])('%s: translated, gated, and withheld by name at the bind on RDDT', (_, src) => {
    const t = strict(src)
    expect(t.outputs[0].refusal).toBeFalsy()
    expect(t.blockRuns && t.blockRuns.outputs.map((x) => x.index)).toEqual([0])
    const { door, cols, errors } = bind(src)
    expect(door.def, door.refusal || '').toBeTruthy()
    expect(cols.value).toBeUndefined()
    expect(errors.value.guard).toBe(BLOCK_RUNS_GUARD)
    expect(errors.value.message).toMatch(/skips bar \d+ and runs again on bar \d+/)
  })

  it('⛔ what is not gated: v4 `iff` (both values every bar), an input-decided v4 arm, a v5 bare name (not Pine v5\'s spelling)', () => {
    expect(strict(pine(4, 'plot(iff(close > open, sma(close, 3), close), "v")')).blockRuns).toBeUndefined()
    expect(strict(pine(4, 'u = input(true, "u")', 'plot(u ? sma(close, 3) : close, "v")')).blockRuns).toBeUndefined()
    expect(legacyTaCallFor(5)).toBeNull()
    expect(legacyTaCallFor(6)).toBeNull()
    expect(legacyTaCallFor(4)('sma')).toBe(true)
    expect(legacyTaCallFor(null)('sma')).toBe(true)
  })

  it('a v4 tuple part that calls a bare `ema` is gated; its neighbour reading the chart\'s own `volume[1]` is not (C48 H06\'s rule)', () => {
    const src = pine(4, 'f() =>', '    q = close * 2', '    [q[1], volume[1] * 2, ema(close, 3)]',
      'float a = na', 'float b = na', 'float c = na', 'if close > open',
      '    [p, r, s] = f()', '    a := p', '    b := r', '    c := s', 'plot(a, "A")', 'plot(b, "B")', 'plot(c, "C")')
    const t = strict(src)
    expect(t.outputs.map((o) => (o.refusal ? o.refusal.guard : 'ok'))).toEqual(['ok', 'ok', 'ok'])
    // P0 a body local at an offset, P2 the bare `ema`: gated. P1 the chart's own `volume[1]`: not.
    expect(t.blockRuns.outputs.map((x) => x.index)).toEqual([0, 2])
  })

  it('a v4 drawing colour whose arm calls a bare `sma` is HELD by name, never painted off the every-bar call', () => {
    vi.stubEnv('VITE_PINE_OBJECTS_ONLY_PANE_ENABLED', '1')
    const t = translatePine([
      '//@version=4', 'study("cond-ta colour", overlay = true, max_labels_count = 500)',
      'if barstate.islast',
      '    label.new(bar_index, high, "x", color = close > open ? (sma(close, 3) > close ? color.red : color.green) : color.blue)',
    ].join('\n'), { strict: true, objects: true })
    expect((t.objectDiagnostics && t.objectDiagnostics.heldColours) || []).not.toEqual([])
  })

  it('⛔ the bare-name rule lasts one translation: nothing outside it hears a bare name', () => {
    strict(BLOCK(4, 'sma(close, 3)'))
    expect(isTaCallName('sma')).toBe(false)
    expect(isTaCallName('ta.sma')).toBe(true)
  })
})

describe('COND-TA — 4. the runtime lane: v4 served per call site, v1-v3 never drawn per run', () => {
  it('a v4 bare block equals the per-run reading on every bar; v3 is drawn only while the block runs every bar (HIST-S3)', () => {
    const c03 = vendorColumn('C03_sma3_cond')
    const v4 = runtime(BLOCK(4, 'sma(close, 3)'))
    expect(v4.refusal).toBeFalsy()
    expect(wrongBars(v4.column, c03)).toBe(0)
    const v3 = runtime(BLOCK(3, 'sma(close, 3)'))
    // ⭐ HIST-S3 — no manual and no capture says v1-v3 keep a block's history per call site, so the block is
    // checked: on RDDT it skips, and the run stops by name (it was refused at build)
    expect(notDrawn(v3) && notDrawn(v3).guard).toBe('runtime:conditional-history')
    expect(v3.column).toBeUndefined()
  })

  it('a v6 arm is served per call site and equals the arm\'s reading on every bar (vw-arm-history T03\'s rule)', () => {
    const rt = runtime(pine(6, 'plot(close > open ? ta.sma(close, 3) : close, "v")'))
    expect(rt.refusal).toBeFalsy()
    const truth = armTruth()
    expect(truth.filter((x, i) => !sameValue(rt.column[i], Number.isFinite(x) ? x : null)).length).toBe(0)
  })
})

describe('COND-TA — 5. one roster on both sides of the wire', () => {
  it('the legacy bare names are `pine_capabilities._COND_TA_BARE`, name for name', () => {
    const py = fs.readFileSync(path.join(ROOT, 'api/services/pine_capabilities.py'), 'utf8')
    const m = py.match(/_COND_TA_BARE = \(([\s\S]*?)\)\r?\n/)
    expect(m).toBeTruthy()
    const names = [...m[1].matchAll(/"([^"]*)"/g)].map((x) => x[1]).join('').split('|').filter(Boolean)
    expect([...LEGACY_TA_NAMES].sort()).toEqual([...new Set(names)].sort())
  })
})

// ─── ⭐⭐ COND-TA 6 — BAR-CONSTANT PARAMETER GUARDS (`objectFnInline.barInvariantParams`) ──────────
// A helper whose `if` guard reads a PARAMETER that every call site fixes to a bar-invariant value
// (the v4 MA-type selector: `get_MA(typ, len)` / `if (typ == "EMA")` / `maVal := ema(src, len)`,
// macd-with-filter-visual-backtest-module-sample; `is_newbar(res)` in fib-pivot-points-alerts).
// The guard holds on every bar or on none at each call site, so the call's per-call-site history
// IS the every-bar history: drawn, as master drew it (both scripts MATCH there). G-b made the v4
// bare call a history call, and the guard check knew only top-level names: an over-refusal.
describe('COND-TA — 6. a guard on a parameter every call site fixes is bar-constant', () => {
  const MA = (v, call, site) => pine(v,
    `typ = input${v >= 5 ? '.string' : ''}("EMA", "type")`,
    `len = input${v >= 5 ? '.int' : ''}(3, "len")`,
    'get_MA(t, n) =>',
    '    float maVal = na',
    '    if (t == "EMA")',
    `        maVal := ${call}(close, n)`,
    '    maVal',
    `plot(${site}, "v")`)

  it.each([
    ['v4 bare ema', MA(4, 'ema', 'get_MA(typ, len)')],
    ['v5 ta.ema', MA(5, 'ta.ema', 'get_MA(typ, len)')],
    ['v6 ta.ema, literal arguments', MA(6, 'ta.ema', 'get_MA("EMA", 3)')],
  ])('%s: served on the screener lane, ungated on the host lane, equal to the every-bar call', (_, src) => {
    const o = lenient(src).outputs[0]
    expect(o.refusal, o.refusal && o.refusal.message).toBeFalsy()
    const t = strict(src)
    expect(t.outputs[0].refusal).toBeFalsy()
    expect(t.blockRuns).toBeUndefined()
    const ours = Array.from(interpret(o.ast, BARS, {}))
    const every = Array.from(interpret(lenient(pine(6, 'plot(ta.ema(close, 3), "v")')).outputs[0].ast, BARS, {}))
    expect(ours.filter((x, i) => !sameValue(x, Number.isFinite(every[i]) ? every[i] : null)).length).toBe(0)
  })

  // ⛔ Numeric selectors, so nothing but this rule can refuse them (a text `?:` refuses on its own).
  const SEL = (site, extra = []) => pine(6,
    'm = input.int(1, "mode")',
    'pick(k) =>',
    '    float maVal = na',
    '    if (k == 1)',
    '        maVal := ta.ema(close, 3)',
    '    maVal',
    ...extra,
    `plot(${site}, "v")`)
  it('control: the numeric selector over an input is served', () => {
    expect(lenient(SEL('pick(m)')).outputs[0].refusal).toBeFalsy()
  })
  it.each([
    ['an argument that varies', SEL('pick(close > open ? 1 : 0)')],
    ['one call site of two varies', `${SEL('pick(m)')}\nplot(pick(close > open ? 1 : 0), "w")`],
    // `outer`'s parameter hides the input `m`: the argument `m` written in its body is that call's value
    ["an argument that is another function's parameter", SEL('outer(close > open ? 1 : 0)', ['outer(m) => pick(m)'])],
    ['a parameter that hides an input of the same name', SEL('pick(close > open ? 1 : 0)').replace('pick(k) =>', 'pick(m) =>').replace('(k == 1)', '(m == 1)')],
  ])("⛔ still refused on the screener lane, by this rule's sentence: %s", (_, src) => {
    const o = lenient(src).outputs[0]
    expect(o.refusal && o.refusal.guard, o.formula || '').toBe('pine:block')
    expect(o.refusal.message).toMatch(/inside a block that does not run on every bar|a function that reads its own history/)
  })
  // ⭐ fib-pivot-points-alerts: `pp_period = input(title = "Period", type = input.string, defval = "Day", …)`
  // feeds the guard. A v3 / v4 `input(…)` written with NAMED arguments is a simple input when its
  // `type =` says so (or its default is a literal); the SOURCE form is a series and stays gated.
  it('a v4 input written with named arguments fixes the guard; a source input does not', () => {
    const named = pine(4,
      'p = input(title = "Period", type = input.string, defval = "Day", options = ["Day", "Year"])',
      'res = p == "Day" ? "D" : "Y"',
      'nb(r) =>',
      '    ch = 0',
      '    if (r == "Y")',
      '        ch := change(close) != 0 ? 1 : 0',
      '    else',
      '        ch := change(open) != 0 ? 1 : 0',
      '    ch',
      'plot(nb(res), "v")')
    expect(lenient(named).outputs[0].refusal).toBeFalsy()
    expect(strict(named).blockRuns).toBeUndefined()
    const source = pine(4,
      's = input(title = "Source", type = input.source, defval = close)',
      'float v = na',
      'if s > 10',   // ⛔ the guard reads ONLY the input, so nothing else can make it vary
      '    v := sma(close, 3)',
      'plot(v, "v")')
    expect(lenient(source).outputs[0].refusal.guard).toBe('pine:block')
    expect(strict(source).blockRuns.outputs.map((x) => x.index)).toEqual([0])
    // a default that is a name, with no type written, is not known to be simple
    const unknown = source.replace('type = input.source, ', '')
    expect(lenient(unknown).outputs[0].refusal.guard).toBe('pine:block')
    // the `type =` argument decides even where the default is not one literal
    const typed = pine(4,
      'n = input(title = "n", type = input.integer, defval = 10 + 5)',
      'float v = na',
      'if n > 3',
      '    v := sma(close, 3)',
      'plot(v, "v")')
    expect(lenient(typed).outputs[0].refusal).toBeFalsy()
    expect(strict(typed).blockRuns).toBeUndefined()
  })
  // ⭐ 19-strategy-supertrend-atr: `filterLong(enable)` calls `filter(enable)`. A parameter passed
  // on is fixed where the caller's own parameter is, at every call of the caller.
  it('a parameter passed through another function is fixed only when that function’s is', () => {
    const through = (site) => SEL(site, ['outer(q) => pick(q)'])
    expect(lenient(through('outer(m)')).outputs[0].refusal).toBeFalsy()
    expect(lenient(through('outer(close > open ? 1 : 0)')).outputs[0].refusal.guard).toBe('pine:block')
    // a function nothing calls never runs: the call in its body is not a call site …
    const dead = (site) => SEL(site, ['unused(q) => pick(q)'])
    expect(lenient(dead('pick(m)')).outputs[0].refusal).toBeFalsy()
    // … but one reached through a function that IS called counts
    const chain = SEL('a(close > open ? 1 : 0)', ['b(q) => pick(q)', 'a(q) => b(q)']) + '\nplot(pick(m), "w")'
    expect(lenient(chain).outputs[1].refusal.guard).toBe('pine:block')
  })
})

// ─── ⛔ COND-TA 7 — KNOWN OVER-REFUSALS ON THE SCREENER LANE (coordinator ruling 2026-11-15) ──────
// Six outputs in three scripts are refused on the screener lane although master's number was
// RIGHT: smoothed-moving-average (1) and williams-alligator (3), whose seed arm
// `smma := na(smma[1]) ? ta.sma(src, len) : <recurrence>` runs on a PREFIX of bars (so the call's
// history is the every-bar history), and smart-money-concepts-by-welotrades (2), under
// `if barstate.isconfirmed and <input>` (constant on closed bars). No static proof exists that an
// arm runs on a prefix (a data gap can re-enter the seed arm); the host lane proves it per chart
// at the bind and DRAWS all three. The screener lane binds no chart, so it refuses by name.
// ⛔⛔ THIS BLOCK IS MEANT TO GO RED. The follow-up unit is the "screener-lane run check (the gate
// evaluated per symbol server-side)", next after the RS Rating admission. The day it lands these
// six are served and the first expectation of each case fails: flip them to served THEN, and
// delete the over-refusal section of docs/pine/evidence/2026-11-15-cond-ta/EVIDENCE.md with them.
describe('COND-TA — 7. ⛔ known over-refusals: refused by name on the screener lane, drawn on the host lane', () => {
  const SMMA = pine(6,
    'len = input.int(7, "Length")',
    'smma = 0.0',
    'smma := na(smma[1]) ? ta.sma(close, len) : (smma[1] * (len - 1) + close) / len',
    'plot(smma, "SMMA")')
  const ALLIGATOR = pine(6,
    'smma(src, length) =>',
    '    s = 0.0',
    '    s := na(s[1]) ? ta.sma(src, length) : (s[1] * (length - 1) + src) / length',
    '    s',
    'plot(smma(hl2, 13), "Jaw")',
    'plot(smma(hl2, 8), "Teeth")',
    'plot(smma(hl2, 5), "Lips")')

  it.each([
    ['the smoothed moving average seed arm (1 output)', SMMA, 1],
    ['the alligator, the same arm in a function (3 outputs)', ALLIGATOR, 3],
  ])('%s', (_, src, n) => {
    const screen = lenient(src)
    expect(screen.outputs).toHaveLength(n)
    for (const o of screen.outputs) {
      expect(o.refusal && o.refusal.guard, o.formula || '').toBe('pine:block')   // ← red when the run check lands
      expect(o.refusal.message).toMatch(/`ta\.sma` is called in one arm of a `\?:`/)
      expect(o.refusal.message).toContain(SCREEN_GATE_SENTENCE)
    }
    // the host lane: translated, gated, and DRAWN on RDDT (the arm never runs again after a skip)
    const host = strict(src)
    expect(host.outputs.every((o) => !o.refusal)).toBe(true)
    expect(host.blockRuns && host.blockRuns.outputs.map((x) => x.index)).toEqual(Array.from({ length: n }, (__, i) => i))
    const { door, cols, errors } = bind(src)
    expect(door.def, door.refusal || '').toBeTruthy()
    expect(Object.keys(errors)).toEqual([])
    const drawn = Object.values(cols).filter((c) => c && typeof c.length === 'number' && Array.from(c).some(Number.isFinite))
    expect(drawn).toHaveLength(n)
  })

  it('smart-money-concepts-by-welotrades: `high_eqh` / `low_eqh` (2 outputs)', () => {
    const src = fs.readFileSync(path.join(ROOT, 'corpus/committed/smart-money-concepts-by-welotrades__0bff41a2e5.pine'), 'utf8')
    const screen = lenient(src)
    const held = screen.outputs.map((o, i) => [i, o]).filter(([, o]) => o.refusal && o.refusal.guard === 'pine:block'
      && /`(high_eqh|low_eqh)` calls `ta\.pivot(high|low)` inside a block/.test(o.refusal.message))
    expect(held).toHaveLength(2)                                                  // ← red when the run check lands
    const host = strict(src)
    for (const [i] of held) expect(host.outputs[i].refusal).toBeFalsy()
    expect(host.blockRuns.outputs.map((x) => x.index)).toEqual(held.map(([i]) => i))
  })
})

// ─── ⛔⛔ COND-TA 8 — A KNOWN TradingView DIFFERENCE, SERVED ON THE SCREENER LANE (INTERIM) ─────────
// Coordinator ruling 2026-11-16 (option B), put to the owner as a decision he can overturn.
// Pine v6 evaluates `and` / `or` lazily: the right side runs only on the bars where the left side
// has not decided the answer, so a `ta.*` call there keeps the history of those bars only.
// SOURCE: TradingView's to-v6 migration guide, whose own example is
// `close > open and ta.rsi(close, 14) > 50` ("the ta.rsi() call is not evaluated on every bar,
// which interferes with the internal history that the RSI function stores").
// ⚠️ EVIDENCE: stated by TradingView's to-v6 migration guide; NOT captured (probe
// `vw-andor-history` written 2026-10-31, never taken; queued as Q-CT1). The count pinned below is
// a difference from the PER-RUN REFERENCE, not from TradingView. ⛔ The follow-up must not switch
// the refusal on until Q-CT1 is captured and graded.
// The HOST lane gates such a plot (`stampLogicRight`). The SCREENER lane was built to refuse it by
// name, and that refusal is NOT switched on: it took `pine.screenerCorpus` 38 -> 32 and
// `pine.blindCorpus` ACCEPTED 37 -> 26 in one step (`close > ta.sma(close, 200) and
// ta.rsi(close, 14) < 30` is the most natural screen a member writes). So this lane serves the
// every-bar value, exactly as master does, and that value DIFFERS from TradingView's.
// ⛔⛔ THIS BLOCK IS MEANT TO GO RED. The follow-up unit (the screener-lane run check + the hoist
// offer) switches the refusal on with the accepted corpus intact: flip these expectations THEN,
// and delete the known-difference row in docs/pine/evidence/2026-11-15-cond-ta/EVIDENCE.md.
describe('COND-TA — 8. ⛔ known TradingView difference: a v6 `and` / `or` right side is served every-bar on the screener lane', () => {
  const AND = pine(6, 'plot(close > open and close > ta.sma(close, 5) ? 1 : 0, "v")')
  const OR = pine(6, 'plot(close > open or ta.rising(close, 2) ? 1 : 0, "v")')

  it.each([['and', AND], ['or', OR]])('`%s`: served on the screener lane, gated on the host lane', (_, src) => {
    const o = lenient(src).outputs[0]
    expect(o.refusal, o.refusal && o.refusal.message).toBeFalsy()              // ← red when the refusal is switched on
    expect(lenient(src).blockRuns).toBeUndefined()
    const host = strict(src)
    expect(host.outputs[0].refusal).toBeFalsy()
    expect(host.blockRuns && host.blockRuns.outputs.map((x) => x.index)).toEqual([0])
  })

  it('⚰️ the served number is not the lazy one: it differs from the per-run reading on RDDT', () => {
    // the per-run reference (the one `runtime()` equals on `vw-arm-history` T03): `ta.sma(close, 5)`
    // over the last five bars the right side RAN on (`close > open`), `false` where it did not run
    const ring = []
    const lazy = BARS.map((b) => {
      if (!(b.c > b.o)) return 0
      ring.push(b.c); if (ring.length > 5) ring.shift()
      return ring.length === 5 && b.c > ring.reduce((x, y) => x + y, 0) / 5 ? 1 : 0
    })
    const served = Array.from(interpret(lenient(AND).outputs[0].ast, BARS, {}))
    const differ = lazy.filter((v, i) => Number.isFinite(served[i]) && served[i] !== v).length
    expect(differ).toBe(DIFFER_AND_SMA5)
    expect(differ).toBeGreaterThan(0)
  })

  it('⛔ only the right side itself: a `?:` arm inside it, and a block, are still refused by name', () => {
    const armInside = pine(6, 'plot(close > open and (close > close[1] ? ta.sma(close, 5) : close) > 0 ? 1 : 0, "v")')
    const o = lenient(armInside).outputs[0]
    expect(o.refusal && o.refusal.guard, o.formula || '').toBe('pine:block')
    expect(o.refusal.message).toMatch(/one arm of a `\?:`/)
    expect(lenient(BLOCK(6, 'ta.sma(close, 3)')).outputs[0].refusal.guard).toBe('pine:block')
  })
})
