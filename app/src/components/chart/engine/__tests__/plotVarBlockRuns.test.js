// ⭐⭐ C48 (PLOT LANE, `var` form) — a `var` written from a `ta.*` call inside a
// block that does not run on every bar holds that call's value AT ITS LAST RUN,
// and the call's window counts the block's EXECUTIONS (capture
// `vw-call-site-history-rddt-1d-2026-10-01`, rows C01-C04 / D01-D02):
//
//   var float s = na
//   if close > open
//       s := ta.sma(close, 3)
//   plot(s)
//
// The non-`var` form is stamped (`meta.blockRuns`, `Resolver.noteBlockRun`) and the
// bind withholds it by name (`engine/blockRuns.js`). The `var` form goes through the
// fold's STATE path (`reassignState`), and the plot lane drew the EVERY-BAR value
// of the call: 145.7767 on RDDT 1D from the listing where TradingView draws
// 149.2033. The object lane's gate for the same shape (#604, `stateRuns`) is the
// one mechanism; this holds the PLOT lane to it: where the block runs after a bar
// it skipped the plot is withheld by name (`pine:block`); where the block runs on
// every bar, or runs and then stops for good, the every-bar value IS TradingView's
// and stays drawn.
//
// ⭐ BUG 2 — the same `var` re-read THROUGH a function or a block-valued right-hand
// side (`s := f()` with `f() => s`, `s := switch ... => s`, `s := if ... / s / else
// close`) drew NaN in both lanes: the inner read reached the var's SEED. Never NaN,
// never the every-bar number: withheld by name.
import { describe, it, expect, vi, afterEach } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

import { toProductBars, enterMemberDoor, HARNESS_DEF_ID } from './vendorHarness/ourSide'
import * as registry from '../nativeRegistry'
import { BLOCK_RUNS_GUARD } from '../blockRuns'
import { memberPaneDefinition } from '../../builder/memberPane/memberPaneDefinition'
import { objectReaderFor } from '../objectColumns'
import { evaluateObjects } from '../objectRuntime'
import { toRenderState } from '../objectRenderState'
import { buildRuntimeIr } from '../ast/pineRuntimeFrontend.js'

const DIR = path.resolve(process.cwd(), '..', 'tests/fixtures/vendor/harness')
const capture = (file) => JSON.parse(fs.readFileSync(path.join(DIR, file), 'utf8'))
const RDDT = capture('vw-call-site-history-rddt-1d-2026-10-01.json')
const SPY = capture('vw-call-site-history-spy-1d-2026-10-01.json')

afterEach(() => { vi.unstubAllEnvs() })

const H = '//@version=6\nindicator("P", overlay = true)\n'

/** The member door + the bind, over a capture's own bars: plot `value`. */
function bind(cap, source) {
  vi.stubEnv('VITE_PINE_OBJECTS_ONLY_PANE_ENABLED', '1')
  vi.stubEnv('VITE_PINE_RUNTIME_PANE_ENABLED', '')
  const door = enterMemberDoor(source)
  try {
    expect(door.def, door.refusal || '').toBeTruthy()
    const bars = toProductBars(cap)
    const cols = registry.computeFor(door.def, bars, undefined, {
      tf: 'D', symbol: { ticker: cap.symbol.name, exchange: cap.symbol.exchange },
      newestBarIsForming: cap.newestBarIsForming ?? null,
      historyFromListing: !!(cap.history && cap.history.startsAtBar0 === true),
    })
    const errors = registry.columnErrors(cols) || {}
    const col = cols.value ? Array.from(cols.value) : null
    return { door, col, err: errors.value || null, bars, cols, errors }
  } finally {
    registry.uninstallUserDefinition(HARNESS_DEF_ID)
  }
}
const lastFinite = (col) => { for (let i = col.length - 1; i >= 0; i -= 1) if (Number.isFinite(col[i])) return col[i]; return null }
const near = (a, b) => Math.abs(a - b) < 1e-6 * Math.max(1, Math.abs(b))

/** Withheld by name: no column, and `pine:block` with the bind's run-after-skip sentence. */
function expectWithheld(cap, source) {
  const { col, err, door } = bind(cap, source)
  expect(col, `drew ${col && lastFinite(col)}`).toBeNull()
  expect(err && err.guard, JSON.stringify({ err, out: door.built.translation.outputs[0] })).toBe(BLOCK_RUNS_GUARD)
  expect(err.message).toMatch(/runs again on bar \d+/)
  return { err, door }
}

/** The hidden condition column a drawn plot names (`colorMode: 'column:<key>'`). */
function colourColumnOf(door, key) {
  const spec = door.def.plots.find((p) => p.key === key)
  return spec && typeof spec.colorMode === 'string' && spec.colorMode.startsWith('column:')
    ? spec.colorMode.slice('column:'.length) : null
}

/** The value drawn exactly (every bar's close), and its colour's condition column
 *  withheld by name (`pine:block`) — the plot draws in its series colour (H1). */
function expectColourWithheld(source) {
  const { cols, errors, door, bars } = bind(RDDT, source)
  expect(errors.value, JSON.stringify(errors.value)).toBeUndefined()
  expect(Array.from(cols.value)).toEqual(bars.map((b) => b.c))
  const ck = colourColumnOf(door, 'value')
  expect(ck, 'the colour rides a condition column').toBeTruthy()
  expect(cols[ck]).toBeUndefined()
  expect(errors[ck].guard).toBe(BLOCK_RUNS_GUARD)
  expect(errors[ck].message).toMatch(/runs again on bar \d+/)
  expect(door.def.meta.blockRuns.keys.map((k) => k.key)).toEqual([ck])
  return { door, cols }
}

const condVar = (guard, call, tail = 'plot(s)\n') => `${H}var float s = na\nif ${guard}\n    s := ${call}\n${tail}`

describe('C48 plot lane — a var written from a ta.* call in a block that skips', () => {
  it('🔴 RDDT: the every-bar 145.7767 is never drawn; withheld by name (TradingView 149.2033)', () => {
    const { err, door } = expectWithheld(RDDT, condVar('close > open', 'ta.sma(close, 3)'))
    // the plot carries the block's guard, beside the non-var form's stamp
    expect(door.def.meta.blockRuns.keys.map((k) => k.key)).toEqual(['value'])
    expect(err.message).toContain('skips bar 1 and runs again on bar 2')
  })

  for (const [name, call] of [['ema', 'ta.ema(close, 3)'], ['highest', 'ta.highest(high, 10)'], ['lowest', 'ta.lowest(low, 10)']]) {
    for (const [sym, cap] of [['RDDT', RDDT], ['SPY', SPY]]) {
      it(`${sym} ${name}: withheld by name`, () => { expectWithheld(cap, condVar('close > open', call)) })
    }
  }
  it('bar_index % 2 == 0 (D01 / D02 shape): withheld by name', () => {
    expectWithheld(RDDT, condVar('bar_index % 2 == 0', 'ta.sma(close, 3)'))
  })
  it('a value only partly read from the var is withheld with it', () => {
    expectWithheld(RDDT, condVar('close > open', 'ta.sma(close, 3)', 'plot(s + 1)\n'))
  })
  it('a later write that READS s keeps the gate (s := nz(s))', () => {
    expectWithheld(RDDT, condVar('close > open', 'ta.sma(close, 3)', 's := nz(s)\nplot(s)\n'))
  })
  it('a later write in a block that skips keeps the gate', () => {
    expectWithheld(RDDT, condVar('close > open', 'ta.sma(close, 3)', 'if volume < 0\n    s := close\nplot(s)\n'))
  })
  it('a nested block (and, not or): withheld', () => {
    expectWithheld(RDDT, `${H}var float s = na\nif close > 0\n    if close > open\n        s := ta.sma(close, 3)\nplot(s)\n`)
  })
  it('an else-if arm: withheld', () => {
    expectWithheld(RDDT, `${H}var float s = na\nif close < 0\n    s := close\nelse if close > open\n    s := ta.sma(close, 3)\nplot(s)\n`)
  })
  // ⛔⛔ F2 (review, after merging fix/prod-ternary-history) — A COLOUR READ OF THE
  // GATED VAR WITHHOLDS THE COLOUR ALONE, never the value it colours: one policy
  // with H1 (`colourBlockRunsOf`). ⚰️ This rail used to say the opposite ("the
  // plot's COLOUR read from the gated var withholds the plot too"), and `close`
  // — TradingView's own value on every bar — was not drawn.
  it('⭐ the plot\'s COLOUR read from the gated var withholds that colour alone: the value (close) is drawn', () => {
    expectColourWithheld(condVar('close > open', 'ta.sma(close, 3)', 'plot(close, color = s > close ? color.red : color.green)\n'))
  })
  it('⭐ the same for the non-`var` conditional-call form (master\'s `condCall` path)', () => {
    expectColourWithheld(`${H}float m = na\nif close > open\n    m := ta.sma(close, 3)\nplot(close, color = close > m ? color.green : color.red)\n`)
  })
  // ⛔⛔ H1 (re-review of F2) — A COLOUR THAT CAN HIDE THE PLOT IS PART OF ITS
  // VALUE. `cond ? color.green : na` is a palette with a transparent entry: Pine
  // draws nothing on the bars it picks `na`. Withholding that colour alone made the
  // binder draw the line in the pane's colour on EVERY bar, where TradingView leaves
  // gaps. So a gated colour rule whose palette holds a hiding entry (an `na` leaf,
  // a fully transparent colour) keeps the gate on the PLOT: withheld whole, as
  // master withheld it. Only an all-real-colour palette is withheld alone.
  for (const [name, source] of [
    ['var form, `? color.green : na`', condVar('close > open', 'ta.sma(close, 3)', 'plot(close, color = close > s ? color.green : na)@n')],
    ['non-`var` form, `? color.green : na`', `${H}float m = na@nif close > open@n    m := ta.sma(close, 3)@nplot(close, color = close > m ? color.green : na)@n`],
    ['an `na` FIRST arm', condVar('close > open', 'ta.sma(close, 3)', 'plot(close, color = close > s ? na : color.red)@n')],
    ['a fully transparent arm (`color.new(c, 100)`)', condVar('close > open', 'ta.sma(close, 3)', 'plot(close, color = close > s ? color.new(color.green, 100) : color.red)@n')],
    ['both arms fully transparent', condVar('close > open', 'ta.sma(close, 3)', 'plot(close, color = close > s ? color.new(color.green, 100) : color.new(color.red, 100))@n')],
    ['a three-way chain with an `na` leaf', condVar('close > open', 'ta.sma(close, 3)', 'plot(close, color = close > s ? color.green : close < s * 0.9 ? color.red : na)@n')],
    ['a plotshape whose colour hides it', condVar('close > open', 'ta.sma(close, 3)', 'plotshape(close > open, color = close > s ? color.red : na)@n')],
  ]) {
    it(`⛔ ${name}: the colour can hide the plot, so the plot is withheld whole`, () => {
      expectWithheld(RDDT, source.split('@n').join(String.fromCharCode(10)))
    })
  }
  // ⛔⛔ F-A (re-review) — A GRADIENT CAN HIDE THE PLOT TOO. `color.from_gradient`'s
  // end colour baked fully transparent (`color.new(c, 100)`), or the whole gradient
  // wrapped in `color.new(…, 100)`, draws nothing at that end: withheld whole.
  for (const [name, source] of [
    ['var form, a gradient whose bottom colour is transparent', condVar('close > open', 'ta.sma(close, 3)', 'plot(close, color = color.from_gradient(s, 140, 160, color.new(color.green, 100), color.green))\n')],
    ['non-`var` form, a gradient whose bottom colour is transparent', `${H}float m = na\nif close > open\n    m := ta.sma(close, 3)\nplot(close, color = color.from_gradient(m, 140, 160, color.new(color.green, 100), color.green))\n`],
    ['a gradient whose TOP colour is transparent', condVar('close > open', 'ta.sma(close, 3)', 'plot(close, color = color.from_gradient(s, 140, 160, color.red, color.new(color.green, 100)))\n')],
    ['a gradient wrapped in `color.new(…, 100)`', condVar('close > open', 'ta.sma(close, 3)', 'plot(close, color = color.new(color.from_gradient(s, 140, 160, color.red, color.green), 100))\n')],
    ['a plotchar whose colour hides it (`? color.red : na`)', condVar('close > open', 'ta.sma(close, 3)', 'plotchar(close > open, char = "x", color = close > s ? color.red : na)\n')],
  ]) {
    it(`⛔ ${name}: the colour can hide the plot, so the plot is withheld whole`, () => {
      expectWithheld(RDDT, source)
    })
  }
  it('⛔ #674\'s ARM path, the same rule: a `?:` arm in a gradient whose bottom colour is transparent withholds the plot whole', () => {
    expectWithheld(RDDT, `${H}up = close > open\nplot(close, color = color.from_gradient(up ? ta.sma(close, 3) : close, 140, 160, color.new(color.green, 100), color.green))\n`)
  })
  it('🔴 CONTROL — a gradient between two real colours is withheld as a colour alone', () => {
    expectColourWithheld(condVar('close > open', 'ta.sma(close, 3)', 'plot(close, color = color.from_gradient(s, 140, 160, color.red, color.green))\n'))
  })
  it('🔴 CONTROL — a three-way chain of real colours is withheld as a colour alone', () => {
    expectColourWithheld(condVar('close > open', 'ta.sma(close, 3)', 'plot(close, color = close > s ? color.green : close < s * 0.9 ? color.red : color.gray)\n'))
  })
  it('a plot whose VALUE and colour both read the var is still withheld whole', () => {
    expectWithheld(RDDT, condVar('close > open', 'ta.sma(close, 3)', 'plot(s, color = s > close ? color.red : color.green)\n'))
  })
  it('a second plot\'s colour reading the var a first plot drew keeps its own colour gate', () => {
    const { cols, errors, door, bars } = bind(RDDT, condVar('close > open', 'ta.sma(close, 3)', 'plot(close, color = s > close ? color.red : color.green)\nplot(s)\n'))
    expect(errors.value).toBeUndefined()
    expect(Array.from(cols.value)).toEqual(bars.map((b) => b.c))
    expect(errors.out2.guard).toBe(BLOCK_RUNS_GUARD)
    const ck = colourColumnOf(door, 'value')
    expect(ck).toBeTruthy()
    expect(errors[ck].guard).toBe(BLOCK_RUNS_GUARD)
  })

  // ⛔ NEVER STOP DRAWING A VALUE THAT IS TRADINGVIEW'S.
  for (const guard of ['bar_index >= 0', 'close > 0']) {
    it(`a block that runs on every bar (${guard}) still draws the every-bar value exactly`, () => {
      const { col, err, bars } = bind(RDDT, condVar(guard, 'ta.sma(close, 3)'))
      expect(err).toBeNull()
      const n = bars.length
      expect(near(col[n - 1], (bars[n - 1].c + bars[n - 2].c + bars[n - 3].c) / 3)).toBe(true)
    })
  }
  it('a block that runs then stops for good is exact too, and drawn', () => {
    const n = RDDT.bars.rows.length
    const { col, err, bars } = bind(RDDT, condVar(`bar_index < ${n - 5}`, 'ta.sma(close, 3)'))
    expect(err).toBeNull()
    const c = bars.slice(n - 8, n - 5).map((b) => b.c)
    expect(near(col[n - 1], (c[0] + c[1] + c[2]) / 3)).toBe(true)
  })
  it('a later unconditional write that replaces s drops the gate (exact, drawn)', () => {
    const { col, err, door, bars } = bind(RDDT, condVar('close > open', 'ta.sma(close, 3)', 's := close\nplot(s)\n'))
    expect(err).toBeNull()
    expect(door.def.meta.blockRuns).toBeUndefined()
    expect(col[bars.length - 1]).toBe(bars[bars.length - 1].c)
  })
  it('a var written in the block from no call is untouched (nothing to gate, drawn exactly)', () => {
    const { col, err, door, bars } = bind(RDDT, condVar('close > open', 'close'))
    expect(err).toBeNull()
    expect(door.def.meta.blockRuns).toBeUndefined()
    let held = null
    for (const b of bars) if (b.c > b.o) held = b.c
    expect(col[bars.length - 1]).toBe(held)
  })
  it('a plot that does not read the var keeps drawing beside a withheld one', () => {
    const src = condVar('close > open', 'ta.sma(close, 3)', 'plot(s)\nplot(close)\n')
    vi.stubEnv('VITE_PINE_OBJECTS_ONLY_PANE_ENABLED', '1')
    const door = enterMemberDoor(src)
    try {
      const bars = toProductBars(RDDT)
      const cols = registry.computeFor(door.def, bars, undefined, { tf: 'D', symbol: { ticker: 'RDDT', exchange: 'NYSE' }, newestBarIsForming: false, historyFromListing: true })
      const errors = registry.columnErrors(cols) || {}
      expect(errors.value.guard).toBe(BLOCK_RUNS_GUARD)
      expect(errors.out2).toBeUndefined()
      expect(Array.from(cols.out2)[bars.length - 1]).toBe(bars[bars.length - 1].c)
    } finally {
      registry.uninstallUserDefinition(HARNESS_DEF_ID)
    }
  })
})

/** TradingView's `s` on the last bar: the mean of the last 3 closes of the bars
 *  where `test` holds (the block's EXECUTIONS), held from the last of them —
 *  `vw-call-site-history` C03, re-derived from the bars. */
function condMean3(bars, test) {
  const runs = bars.filter(test).map((b) => b.c)
  const k = runs.length
  return (runs[k - 1] + runs[k - 2] + runs[k - 3]) / 3
}
const RDDT_BARS = toProductBars(RDDT)
const TRUTH_UP = condMean3(RDDT_BARS, (b) => b.c > b.o)
const TRUTH_EVERY = condMean3(RDDT_BARS, (b) => b.c > 0)
const truthOf = (body) => (body.includes('close > open') ? TRUTH_UP : TRUTH_EVERY)

/** Never NaN, never the every-bar number: TradingView's value, or withheld by
 *  name — a row the bind refuses, a row the translation refuses, or a door that
 *  refuses the script, each with its guard. */
function expectTrueOrWithheld(cap, source) {
  vi.stubEnv('VITE_PINE_OBJECTS_ONLY_PANE_ENABLED', '1')
  vi.stubEnv('VITE_PINE_RUNTIME_PANE_ENABLED', '')
  const door = enterMemberDoor(source)
  if (!door.def) {
    expect(door.refusal).toMatch(/\((pine:[a-z-]+)\)/)
    return { door }
  }
  try {
    const bars = toProductBars(cap)
    const cols = registry.computeFor(door.def, bars, undefined, { tf: 'D', symbol: { ticker: cap.symbol.name, exchange: cap.symbol.exchange },
      newestBarIsForming: cap.newestBarIsForming ?? null, historyFromListing: true })
    const err = (registry.columnErrors(cols) || {}).value
    const row = door.built.translation.outputs[0]
    if (cols.value) {
      const v = cols.value[cols.value.length - 1]
      expect(Number.isFinite(v), `drew ${v}`).toBe(true)
      expect(v, `drew ${v}`).toBeCloseTo(truthOf(source), 6)
    } else {
      expect((err && err.guard) || (row.refusal && row.refusal.guard), JSON.stringify({ err, row })).toMatch(/^pine:/)
    }
    return { door, err }
  } finally {
    registry.uninstallUserDefinition(HARNESS_DEF_ID)
  }
}

describe('C48 — BUG 2: the var re-read through a function or a block-valued right-hand side', () => {
  const SHAPES = [
    ['a function', `${H}var float s = na\nf() => s\nif close > open\n    s := ta.sma(close, 3)\ns := f()\n`],
    ['a switch', `${H}var float s = na\nif close > open\n    s := ta.sma(close, 3)\ns := switch\n    close > 0 => s\n    => close\n`],
    ['an if expression', `${H}var float s = na\nif close > open\n    s := ta.sma(close, 3)\ns := if close > 0\n    s\nelse\n    close\n`],
  ]
  for (const [name, body] of SHAPES) {
    it(`plot lane, ${name}: never NaN, never the every-bar value — withheld by name`, () => {
      expectTrueOrWithheld(RDDT, `${body}plot(s)\n`)
      // and beside a plot that reads nothing of it, which keeps the door open
      expectTrueOrWithheld(RDDT, `${body}plot(s)\nplot(close)\n`)
    })
    it(`object lane, ${name}: never NaN, never the every-bar value — withheld by name`, () => {
      vi.stubEnv('VITE_PINE_OBJECTS_ONLY_PANE_ENABLED', '1')
      vi.stubEnv('VITE_PINE_MEMBER_PANE_ENABLED', '1')
      vi.stubEnv('VITE_PINE_RUNTIME_PANE_ENABLED', '')
      const src = `${body}if barstate.islast\n    label.new(bar_index, s, str.tostring(s))\n`
      const built = memberPaneDefinition({ source: src, id: 'u_plotvar', name: 'P' })
      const bars = toProductBars(RDDT)
      // ⛔ P3 WS-A (#676): the C18 object door refuses a block-valued `:=` that reads
      // its own name, by name (Q-A2). With nothing else to draw the script then offers
      // no pane at all — withheld by name, never a wrong number.
      const door = buildRuntimeIr(src, { bars, inputs: {}, objectTrees: [], objectTreesAt: [], objectDoor: true })
      const doorNamed = !door.ok && door.refusal.guard === 'runtime:object-door'
        && /reads `s` inside its own block.*Q-A2/.test(door.refusal.message)
      if (!built.ok) {
        expect(doorNamed, JSON.stringify({ reason: built.reason, door: door.refusal })).toBe(true)
        return
      }
      const reader = objectReaderFor(built.definition, bars, { tf: 'D', symbol: { ticker: 'RDDT', exchange: 'NYSE' }, newestBarIsForming: false, historyFromListing: true })
      const run = evaluateObjects(reader.program, { barCount: bars.length, readNode: reader.readNode,
        readTime: reader.readTime, readUnknown: reader.readUnknown, offListing: false })
      const labels = (toRenderState(run.live, { bars, tf: 'D', pineVersion: reader.program.pineVersion }).labels || []).map((l) => l.text)
      const diag = (built.translation && built.translation.objectDiagnostics) || {}
      const why = JSON.stringify({ r: reader.refusals, drop: diag.dropReasons, notes: diag.dropNotes })
      // never NaN, never the every-bar number: TradingView's, or withheld by name
      // (at the bind, `pine:block`; at translation, the drawing dropped with its reason;
      // or — merged with P3 WS-A, #676 — the C18 object door refusing a block-valued
      // `:=` that reads its own name, `runtime:object-door` (Q-A2), until a capture)
      if (labels.length) {
        expect(labels.length, why).toBe(1)
        expect(Number(labels[0]), why).toBeCloseTo(truthOf(body), 6)
      } else {
        const named = (reader.refusals || []).some((r) => r.guard === 'pine:block')
        const dropped = Object.values(diag.dropReasons || {}).reduce((a, b) => a + b, 0) > 0
        expect(named || dropped || doorNamed, why).toBe(true)
      }
    })
  }
  it('the same shapes, where the block runs on every bar: the every-bar value (the true one), or withheld by name', () => {
    for (const [, body] of SHAPES) {
      expectTrueOrWithheld(RDDT, `${body.replace('close > open', 'close > 0')}plot(s)\nplot(close)\n`)
    }
  })
})

describe('C48 — a function reads a var where it is CALLED (Pine), refused where this engine would not', () => {
  const last = (col) => col[col.length - 1]
  const B = RDDT_BARS
  const n = B.length
  /** The plot lane over RDDT: `{col, err, refusal}` for plot `value`. */
  function plotOf(body) {
    vi.stubEnv('VITE_PINE_OBJECTS_ONLY_PANE_ENABLED', '1')
    vi.stubEnv('VITE_PINE_RUNTIME_PANE_ENABLED', '')
    const door = enterMemberDoor(`${H}${body}plot(close, "ctl")\n`)
    if (!door.def) {
      // the door refused the script: by name, with the row's own sentence
      const row = door.built.translation && (door.built.translation.outputs || [])[0]
      expect(door.refusal).toMatch(/\(pine:[a-z-]+\)/)
      return { col: null, err: null, refusal: (row && row.refusal) || null }
    }
    try {
      const cols = registry.computeFor(door.def, B, undefined, { tf: 'D', symbol: { ticker: 'RDDT', exchange: 'NYSE' }, newestBarIsForming: false, historyFromListing: true })
      const err = (registry.columnErrors(cols) || {}).value || null
      const row = door.built.translation.outputs[0]
      return { col: cols.value ? Array.from(cols.value) : null, err, refusal: row.refusal || null }
    } finally {
      registry.uninstallUserDefinition(HARNESS_DEF_ID)
    }
  }
  const expectRefusedReassign = (body) => {
    const { col, refusal } = plotOf(body)
    expect(col, `drew ${col && last(col)}`).toBeNull()
    expect(refusal && refusal.guard).toBe('pine:reassign')
    expect(refusal.message).toMatch(/reads `s`, a `var` written after/)
  }

  it('⚰️ `s := close` then `plot(f())`: the previous bar\'s close is no longer drawn (TradingView: this bar\'s)', () => {
    expect(B[n - 2].c).not.toBe(B[n - 1].c)
    expectRefusedReassign('var float s = na\nf() => s\ns := close\nplot(f())\n')
  })
  it('a function that calls a function that reads the var is refused the same way', () => {
    expectRefusedReassign('var float s = na\ng() => s\nh() => g() * 1\ns := close\nplot(h())\n')
  })
  it('a function whose local reads the var is refused the same way', () => {
    expectRefusedReassign('var float s = na\nf() =>\n    a = s * 2\n    a\ns := close\nplot(f())\n')
  })
  // ⛔⛔ F1 (review) — AN OFFSET READ IS NOT THE STALE READ. `f() => s[1]` reads the
  // var's HISTORY, the same series wherever the function is declared, so the stale-read
  // guard must not claim it. ⚖️ MEASURED 2026-11-01 (RDDT, member door): master does
  // NOT draw these — the fold refuses them itself (`pine:state`, the offset read of a
  // var written later in the script), on the plot lane and the object lane alike; the
  // review's "master drew close[1]" was read, not run. So the rail is the refusal's
  // OWNER: master's own `pine:state`, never this branch's `pine:reassign` sentence
  // ("`f` reads `s`, a `var` written after"), which is false of a history read.
  for (const body of [
    'var float s = na\nf() => s[1]\ns := close\nplot(f())\n',
    'var float s = 0\nf() => nz(s[1])\ns := s * 0.5 + close\nplot(f())\n',
    'var float s = 0\nf() => s[ 2 ]\ns := s + close\nplot(f())\n',
    'var float s = na\nf() =>\n    a = s[1]\n    a * 1\ns := close\nplot(f())\n',
  ]) {
    it(`⭐ ${JSON.stringify(body.split(String.fromCharCode(10))[1])} reads the var's history: not refused as a stale read (master's refusal stands)`, () => {
      const { col, refusal } = plotOf(body)
      expect(col).toBeNull()
      expect(refusal && refusal.guard, JSON.stringify(refusal)).toBe('pine:state')
    })
  }
  it('🔴 CONTROL — the same history read declared AFTER the write is drawn exactly (accum[1])', () => {
    const { col, refusal } = plotOf('var float s = 0\ns := s * 0.5 + close\nf() => s[1]\nplot(f())\n')
    expect(refusal).toBeNull()
    let prev = NaN
    let cur = 0
    for (const b of B) { prev = cur; cur = cur * 0.5 + b.c }
    expect(last(col)).toBeCloseTo(prev, 9)
  })
  it('a body that reads `s[1]` AND `s` is still refused (the bare read is stale)', () => {
    expectRefusedReassign('var float s = na\nf() => s[1] + s\ns := close\nplot(f())\n')
  })
  it('`s[0]` is the bare read: refused', () => {
    expectRefusedReassign('var float s = na\nf() => s[0]\ns := close\nplot(f())\n')
  })
  it('`s[k]` with an offset that may be 0 is refused', () => {
    expectRefusedReassign('var float s = na\nk = bar_index % 2\nf() => s[k]\ns := close\nplot(f())\n')
  })
  // ⛔ LOW (re-review) — A NAMED ARGUMENT IS NOT A READ. `ta.sma(close, length = 3)`
  // names the built-in's parameter `length`; it reads nothing called `length`, so a
  // later write of a var `length` makes nothing stale. (A named argument to a USER
  // function is refused on its own, `pine:named-argument`, so a built-in is the
  // shape that reaches this guard.)
  it('a named argument that shares a var\'s name is not a read of it: drawn exactly', () => {
    const { col, refusal } = plotOf('var float length = na\nf() => ta.sma(close, length = 3)\nlength := open\nplot(f())\n')
    expect(refusal).toBeNull()
    expect(last(col)).toBeCloseTo((B[n - 1].c + B[n - 2].c + B[n - 3].c) / 3, 9)
  })
  it('🔴 CONTROL — the same var passed POSITIONALLY is a read: refused as stale', () => {
    expectRefusedReassign('var float s = na\nf() => nz(s, close)\ns := open\nplot(f())\n')
  })
  it('🔴 CONTROL — `s == close` inside a call is a comparison that reads `s`: refused', () => {
    expectRefusedReassign('var float s = na\nf() => nz(s == close ? 1 : 0)\ns := open\nplot(f())\n')
  })
  it('a function called BEFORE the write reads the value there, and is drawn exactly', () => {
    // `s` before the write on this bar is the previous bar's close
    const { col, refusal } = plotOf('var float s = na\nf() => s\nx = f()\ns := close\nplot(x)\n')
    expect(refusal).toBeNull()
    expect(last(col)).toBe(B[n - 2].c)
  })
  it('a function declared AFTER the last write reads the value it was folded with, and is drawn exactly', () => {
    const { col, refusal } = plotOf('var float s = na\ns := close\nf() => s\nplot(f())\n')
    expect(refusal).toBeNull()
    expect(last(col)).toBe(B[n - 1].c)
  })
  it('a parameter that shares the var\'s name is the argument, not the var: drawn exactly', () => {
    const { col, refusal } = plotOf('var float s = na\nf(s) => s * 2\ns := close\nplot(f(open))\n')
    expect(refusal).toBeNull()
    expect(last(col)).toBe(B[n - 1].o * 2)
  })
  it('a local that shares the var\'s name is the function\'s own, not the var: drawn exactly', () => {
    const { col, refusal } = plotOf('var float s = na\nf() =>\n    s = close * 2\n    s\ns := open\nplot(f())\n')
    expect(refusal).toBeNull()
    expect(last(col)).toBe(B[n - 1].c * 2)
  })
  it('`s := f() * 0.5 + close * 0.5` reads the running value both ways (its own next write): drawn exactly', () => {
    const { col, refusal } = plotOf('var float s = 0\nf() => s\ns := f() * 0.5 + close * 0.5\nplot(s)\n')
    expect(refusal).toBeNull()
    let s = 0
    for (const b of B) s = s * 0.5 + b.c * 0.5
    expect(last(col)).toBeCloseTo(s, 9)
  })
})

describe('C48 — the object lane: a helper reads a var where it is CALLED', () => {
  function labelsOf(body) {
    vi.stubEnv('VITE_PINE_OBJECTS_ONLY_PANE_ENABLED', '1')
    vi.stubEnv('VITE_PINE_MEMBER_PANE_ENABLED', '1')
    vi.stubEnv('VITE_PINE_RUNTIME_PANE_ENABLED', '')
    const built = memberPaneDefinition({ source: `${H}${body}plot(close)\n`, id: 'u_plotvar', name: 'P' })
    expect(built.ok, built.reason).toBe(true)
    if (!built.definition.objects) {
      // the drawing was dropped at translation, with its reason
      const drop = (built.translation.objectDiagnostics || {}).dropReasons || {}
      expect(Object.keys(drop).length, JSON.stringify(built.translation.objectDiagnostics)).toBeGreaterThan(0)
      return []
    }
    const reader = objectReaderFor(built.definition, RDDT_BARS, { tf: 'D', symbol: { ticker: 'RDDT', exchange: 'NYSE' }, newestBarIsForming: false, historyFromListing: true })
    const run = evaluateObjects(reader.program, { barCount: RDDT_BARS.length, readNode: reader.readNode,
      readTime: reader.readTime, readUnknown: reader.readUnknown, offListing: false })
    return (toRenderState(run.live, { bars: RDDT_BARS, tf: 'D', pineVersion: reader.program.pineVersion }).labels || []).map((l) => l.text)
  }
  const n = RDDT_BARS.length
  const prev = String(RDDT_BARS[n - 2].c)
  const now = String(RDDT_BARS[n - 1].c)
  for (const [name, body] of [
    ['a value helper', 'var float s = na\nf() => s\ns := close\nif barstate.islast\n    label.new(bar_index, f(), str.tostring(f()))\n'],
    ['a text helper', 'var float s = na\nf() => str.tostring(s)\ns := close\nif barstate.islast\n    label.new(bar_index, close, f())\n'],
  ]) {
    it(`${name}: never the previous bar's value (TradingView: this bar's), or withheld`, () => {
      const labels = labelsOf(body)
      expect(labels).not.toContain(prev)
      for (const t of labels) expect(t).toBe(now)
    })
  }
  // ⛔⛔ (coordinator final run, 2026-11-02) — A `var` WRITTEN FROM A GETTER is opaque to
  // the fold, and its read is the object lane's own machinery, as on master. The
  // stale-read refusal fired on it and took rsi-swing-indicator's whole drawing program
  // down (35 TradingView-exact objects, `vendorHarness.c17RsiSwing`). Its shape:
  it('a helper reading a var written from `label.get_y` (opaque) keeps the drawings: each label\'s text as Pine reads it at the call', () => {
    const body = 'var float p = 0.0\nvar label lb = na\ntxt() => p < high ? "HH" : "LH"\nif close > open\n    lb := label.new(bar_index, high, txt())\n    p := label.get_y(lb)\n'
    const labels = labelsOf(body)
    const want = []
    let p = 0
    for (const b of RDDT_BARS) {
      if (b.c > b.o) { want.push(p < b.h ? 'HH' : 'LH'); p = b.h }
    }
    expect(labels.length).toBeGreaterThan(0)
    expect(labels).toEqual(want.slice(-labels.length))
  })
})

describe('C48 / P3 WS-A — the runtime lane: a block-valued `:=` that reads its own name', () => {
  // ⛔⛔ CHANGED with the merge of P3 WS-A (#676), which is LIVE and the one authority
  // for this lowering (a hidden temp, then `x`): on the C18 object DOOR a block-valued
  // `:=` that reads its own name is REFUSED by name until a TradingView capture
  // (Q-A2). This rail used to expect the door to DRAW the text (`[t]`); master drew it
  // wrong before either branch, so no value production drew correctly is lost. The
  // runtime PANE still builds it.
  it('a TEXT var written from an `if` that reads it: the door refuses it by name (Q-A2); the pane builds it', () => {
    vi.stubEnv('VITE_PINE_OBJECTS_ONLY_PANE_ENABLED', '1')
    vi.stubEnv('VITE_PINE_MEMBER_PANE_ENABLED', '1')
    vi.stubEnv('VITE_PINE_RUNTIME_PANE_ENABLED', '')
    const src = `${H}var string t = "none"\nt := if close > open * 1.03\n    "big"\nelse if close < open\n    "down"\nelse\n    t\nif barstate.islast\n    label.new(bar_index, close, t)\nplot(close)\n`
    const built = memberPaneDefinition({ source: src, id: 'u_plotvar', name: 'P' })
    expect(built.ok, built.reason).toBe(true)
    // no drawing reaches the chart: the label is dropped at translation (its text is a
    // block value the plot lane cannot hold) and the door that would draw it refuses
    expect(built.definition.objects, JSON.stringify(built.translation.objectDiagnostics)).toBeFalsy()
    expect(built.translation.objectDiagnostics.dropReasons).toEqual({ 'create:label': 1 })
    const door = buildRuntimeIr(src, { bars: RDDT_BARS, inputs: {}, objectTrees: [], objectTreesAt: [], objectDoor: true })
    expect(door.ok).toBe(false)
    expect(door.refusal.guard).toBe('runtime:object-door')
    expect(door.refusal.message).toMatch(/reads `t` inside its own block.*Q-A2/)
    expect(buildRuntimeIr(src, { bars: RDDT_BARS, inputs: {}, objectTrees: [], objectTreesAt: [] }).ok).toBe(true)
  })
})
