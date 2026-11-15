// app/src/components/chart/engine/ast/condTaLanes.test.js
//
// ─── ⭐⭐ COND-TA (plan unit U2, engine 55) — A `ta.*` CALL THAT RUNS ONLY ON SOME BARS, ON EVERY DOOR ──
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
const runtime = (src) => {
  const b = buildRuntimeIr(src, { bars: BARS, inputs: {} })
  if (!b.ok) return { refusal: b.refusal }
  const program = lowerIrProgram(b.ir)
  const r = execute(program, { bars: BARS.length, series: SERIES, columns: program.columns, confirmed: true })
  return { column: Array.from(r.outputs[0]) }
}
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
  'v3 arm bare': [pine(3, 'plot(close > open ? rsi(close, 14) : 50, "v")'), /`rsi` is called in one arm of a `\?:`/],
  'v6 if expression': [pine(6, 'y = if close > open', '    ta.sma(close, 3)', 'else', '    close', 'plot(y, "v")'), /one branch of an `if`/],
  'v4 if expression bare': [pine(4, 'y = if close > open', '    sma(close, 3)', 'else', '    close', 'plot(y, "v")'), /`sma` is called in one branch of an `if`/],
  'v6 helper in a block': [pine(6, 'f() => ta.sma(close, 3)', 'float v = na', 'if close > open', '    v := f()', 'plot(v, "v")'), /calls `f`, a function that reads its own history/],
  'v4 helper bare in a block': [pine(4, 'f() => sma(close, 3)', 'float v = na', 'if close > open', '    v := f()', 'plot(v, "v")'), /calls `f`, a function that reads its own history/],
  'v6 block local [1]': [pine(6, 'float v = na', 'if close > open', '    cx = close * 2', '    v := cx[1]', 'plot(v, "v")'), /`cx\[1\]` reads the history of a name declared inside a block/],
  'v6 var filled in a block': [pine(6, 'var float s = na', 'if close > open', '    s := ta.sma(close, 3)', 'plot(s, "v")'), /`s` calls `ta\.sma` inside a block/],
  'v6 and right side': [pine(6, 'plot(close > open and ta.rsi(close, 14) > 50 ? 1 : 0, "v")'), /on the right of a Pine v6 `and`/],
}

describe('COND-TA — 1. the screener lane refuses by name what no chart is bound to withhold', () => {
  it.each(Object.entries(GATED))('%s', (_, [src, why]) => {
    const t = lenient(src)
    expect(t.mode).toBe('screener')
    const o = t.outputs[0]
    expect(o.refusal && o.refusal.guard, o.formula || '').toBe('pine:block')
    expect(o.refusal.message).toMatch(why)
    expect(o.refusal.message).toContain(SCREEN_GATE_SENTENCE)
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

describe('COND-TA — 3. Pine v1-v4 bare calls are history calls on the host lane (gap G-b)', () => {
  it.each([
    ['v4 block', BLOCK(4, 'sma(close, 3)')],
    ['v3 block', BLOCK(3, 'highest(high, 3)')],
    ['v4 arm', pine(4, 'plot(close > open ? sma(close, 3) : close, "v")')],
    ['v3 arm', pine(3, 'plot(close > open ? rsi(close, 14) : 50, "v")')],
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

describe('COND-TA — 4. the runtime lane: v4 served per call site, v1-v3 refused by name', () => {
  it('a v4 bare block equals the per-run reading on every bar; v3 is refused', () => {
    const c03 = vendorColumn('C03_sma3_cond')
    const v4 = runtime(BLOCK(4, 'sma(close, 3)'))
    expect(v4.refusal).toBeFalsy()
    expect(wrongBars(v4.column, c03)).toBe(0)
    const v3 = runtime(BLOCK(3, 'sma(close, 3)'))
    expect(v3.refusal && v3.refusal.guard).toBe('runtime:conditional-history')
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
