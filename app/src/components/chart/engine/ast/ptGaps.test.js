// app/src/components/chart/engine/ast/ptGaps.test.js
//
// ─── PT-GAPS — the engine gaps `docs/pine/capture-queue-2026-10-31-prod-ternary.md`
// lists under "Known gaps" that needed no new vendor fact, one rail block each ──
//
//   L3  a nested arm's guard ANDs the enclosing stamped arms' run guards
//   L4  a `?:` arm's guard reads an `na` test as Pine's `?:` does (false arm runs)
//   L6  `armHistoryCallOf` answers once per parse node (no O(N²) walk of a chain)
//   G-c the run-length counter fold's copy keeps its arm stamps
//   G-d a withheld colour is said on the plot's info row
//   G-h a paint's / a fill's colour honours C48's block gates
import { describe, it, expect } from 'vitest'
import {
  printFormula, armHistoryCallOf, armHistoryWalkStats, armRunGates, stampArmRuns, copyKeepingArmRuns,
  colourBlockRunsOf, translatePine,
} from './pine'
import { TABLE } from './parse'
import { interpret } from './interpret'
import { firstRunAfterSkip } from '../blockRuns'
import { withheldColourOf, resolveInfoValue, INFO_VALUE_STATES } from '../infoValueResolve'

const num = (value) => ({ type: 'num', value })
const series = (name) => ({ type: 'series', name })
const op = (name, ...args) => ({ type: 'op', name, args })
const call = (name, ...args) => ({ type: 'call', name, args })
const RUN = { negate: false, what: 'that arm', why: 'W' }
const NEG = { negate: true, what: 'that arm', why: 'N' }

// bars whose close we choose per bar: `close > open` is `c > 1`
const barsOf = (closes) => closes.map((c, i) => ({ t: 1700000000 + i * 86400, o: 1, h: Math.max(1, c), l: 0, c, v: 1 }))
const column = (tree, bars, opts) => Array.from(interpret(tree, bars, {}, undefined, undefined, opts))

describe('L3 — a nested arm runs where every enclosing stamped arm is taken', () => {
  const a = op('>', series('close'), num(5))
  const b = op('>', series('close'), num(2))
  const nested = () => {
    const inner = stampArmRuns(op('?:', b, call('sma', series('close'), num(3)), series('close')), [{ ...RUN, why: 'inner' }])
    return stampArmRuns(op('?:', a, inner, series('open')), [{ ...RUN, why: 'outer' }])
  }

  it('⭐ the inner gate is `a ? b : 0`; the outer keeps its own test', () => {
    const gates = armRunGates([nested()], TABLE)
    expect(gates.map((g) => [g.why, printFormula(g.guard)])).toEqual([
      ['outer', 'close > 5'],
      ['inner', printFormula(op('?:', a, b, num(0)))],
    ])
  })

  it('⭐ the false arm adds the NEGATED test; a v6 `and` / `or` right side adds its left (negated for `or`)', () => {
    const inner = stampArmRuns(op('?:', b, call('sma', series('close'), num(3)), series('close')), [{ ...RUN, why: 'inner' }])
    const outer = stampArmRuns(op('?:', a, series('open'), inner), [{ ...NEG, why: 'outer' }])
    expect(printFormula(armRunGates([outer], TABLE)[1].guard)).toBe(printFormula(op('?:', op('!', a), b, num(0))))
    const inner2 = stampArmRuns(op('?:', b, call('sma', series('close'), num(3)), num(0)), [{ ...RUN, why: 'inner' }])
    const or = stampArmRuns(op('||', a, inner2), [{ ...NEG, what: 'that right side', why: 'or' }])
    expect(printFormula(armRunGates([or], TABLE)[1].guard)).toBe(printFormula(op('?:', op('!', a), b, num(0))))
  })

  it('⭐ a `b` that varies only where `a` is false no longer refuses — the over-withhold L3 named', () => {
    // a: true on bars 0..4, false after (true then false for good: exact).
    // b: varies everywhere. The inner call runs on bars where a and b — b true on 0..4.
    const closes = [9, 9, 9, 9, 9, 3, 1, 3, 1, 3, 1]
    const bars = barsOf(closes)
    const [outer, inner] = armRunGates([nested()], TABLE)
    expect(firstRunAfterSkip(column(outer.guard, bars))).toBeNull()
    expect(firstRunAfterSkip(column(inner.guard, bars))).toBeNull()
    // 🔴 CONTROL — `b` alone, the guard the inner arm carried before, refuses here
    expect(firstRunAfterSkip(column(b, bars))).not.toBeNull()
  })

  it('⛔ not through an `offset`, nor into a recurrence: the nested guard is its own test there, as before', () => {
    const inner = () => stampArmRuns(op('?:', b, call('sma', series('close'), num(3)), series('close')), [{ ...RUN, why: 'inner' }])
    const viaOffset = stampArmRuns(op('?:', a, { type: 'offset', value: 1, args: [inner()] }, series('open')), [{ ...RUN, why: 'outer' }])
    expect(printFormula(armRunGates([viaOffset], TABLE)[1].guard)).toBe('close > 2')
    const viaAccum = stampArmRuns(op('?:', a, call('accum', num(0), op('+', series('self'), inner()), num(250)), series('open')),
      [{ ...RUN, why: 'outer' }])
    expect(printFormula(armRunGates([viaAccum], TABLE)[1].guard)).toBe('close > 2')
  })

  it('⛔ r1 — nor into a MULTI-STATE recurrence (`accumK`): the nested guard is its own test there', () => {
    const name = Object.keys(TABLE.functions).find((k) => TABLE.functions[k] && TABLE.functions[k].multiState)
    expect(name).toBeTruthy()
    const ms = TABLE.functions[name].multiState
    const inner = stampArmRuns(op('?:', b, call('sma', series('close'), num(3)), series('close')), [{ ...RUN, why: 'inner' }])
    const args = []
    args[ms.output] = num(0)
    args[ms.warmup] = num(250)
    ms.seeds.forEach((i) => { args[i] = num(0) })
    ms.updates.forEach((i, k) => { args[i] = k === 0 ? op('+', series(ms.binds[k]), inner) : series(ms.binds[k]) })
    const outer = stampArmRuns(op('?:', a, call(name, ...args), series('open')), [{ ...RUN, why: 'outer' }])
    const gates = armRunGates([outer], TABLE)
    expect(gates.map((g) => [g.why, printFormula(g.guard)])).toEqual([['outer', 'close > 5'], ['inner', 'close > 2']])
  })

  it('one inner node under two different enclosing arms carries both gates', () => {
    const inner = stampArmRuns(op('?:', b, call('sma', series('close'), num(3)), series('close')), [{ ...RUN, why: 'inner' }])
    const x = stampArmRuns(op('?:', a, inner, num(0)), [{ ...RUN, why: 'x' }])
    const c = op('<', series('close'), num(1))
    const y = stampArmRuns(op('?:', c, inner, num(0)), [{ ...RUN, why: 'y' }])
    const texts = armRunGates([op('+', x, y)], TABLE).map((g) => printFormula(g.guard))
    expect(texts).toContain(printFormula(op('?:', a, b, num(0))))
    expect(texts).toContain(printFormula(op('?:', c, b, num(0))))
  })

  it('⭐ through the translator: a nested v6 `?:`', () => {
    const t = translatePine(['//@version=6', 'indicator("l3")', 'a = close > open', 'b = close > close[1]',
      'plot(a ? (b ? ta.sma(close, 5) : close) : open, "P")'].join('\n'), { strict: true, paramManifest: true })
    const gates = t.blockRuns.outputs[0].gates.map((g) => printFormula(g.guard))
    expect(gates).toEqual(['close > open', 'close > open ? close > close[1] : 0'])
  })
})

describe('L4 — an `na` test takes the false arm, and the gate reads it so', () => {
  // a test that is `na` on bars 0..2 (`close[3] > 0` is `0` there: comparisons are never `na`;
  // `nz`-free arithmetic is) — `close - close[3]` is `na` on 0..2, then the bar's change.
  const t = op('-', series('close'), { type: 'offset', value: 3, args: [series('close')] })
  const stamped = () => stampArmRuns(op('?:', t, call('sma', series('close'), num(3)), num(0)), [RUN, NEG])

  it('⭐ the guard is the `?:` itself — `t ? 1 : 0` / `t ? 0 : 1` — for a test that can be `na`', () => {
    expect(armRunGates([stamped()], TABLE).map((g) => printFormula(g.guard))).toEqual([
      printFormula(op('?:', t, num(1), num(0))), printFormula(op('?:', t, num(0), num(1)))])
  })

  it('⭐ from the listing, in a document that declares it: `na` is a SKIP of the true arm, a RUN of the false one', () => {
    const bars = barsOf([5, 5, 5, 6, 7, 8, 9])                  // t: na, na, na, 1, 2, 3, 4
    const [yes, no] = armRunGates([stamped()], TABLE)
    const pine = { historyFromListing: true, naConditionFalse: true }
    expect(column(yes.guard, bars, pine).slice(0, 4)).toEqual([0, 0, 0, 1])
    expect(firstRunAfterSkip(column(yes.guard, bars, pine))).toEqual({ skipped: 0, bar: 3 })
    // the false arm ran on 0..2 and never again: exact
    expect(firstRunAfterSkip(column(no.guard, bars, pine))).toBeNull()
    // 🔴 CONTROL — the bare test, the guard before L4, sees no skip at all
    expect(firstRunAfterSkip(column(t, bars, pine))).toBeNull()
  })

  it('⛔ off the listing (every server lane), `na` stays neither a run nor a skip — as before', () => {
    const bars = barsOf([5, 5, 5, 6, 7, 8, 9])
    const [yes] = armRunGates([stamped()], TABLE)
    expect(column(yes.guard, bars).slice(0, 3).every(Number.isNaN)).toBe(true)
    expect(firstRunAfterSkip(column(yes.guard, bars))).toBeNull()
  })

  it('⛔ a test that is never `na`, and a v6 `and` / `or` stamp, keep their trees byte for byte', () => {
    const cmp = op('>', series('close'), series('open'))
    const node = stampArmRuns(op('?:', cmp, call('sma', series('close'), num(3)), num(0)), [RUN, NEG])
    expect(armRunGates([node], TABLE).map((g) => printFormula(g.guard))).toEqual(['close > open', '!(close > open)'])
    const and = stampArmRuns(op('&&', t, call('sma', series('close'), num(3))), [{ ...RUN, what: 'that right side' }])
    expect(printFormula(armRunGates([and], TABLE)[0].guard)).toBe('close - close[3]')
  })
})

describe('L6 — one answer per parse node per translation', () => {
  const sma = () => ({ type: 'call', name: 'ta.sma', args: [] })
  const chain = (n) => {
    let node = { type: 'name', name: 'close' }
    const levels = []
    for (let i = 0; i < n; i += 1) {
      node = { type: 'ternary', test: { type: 'name', name: `c${i}` }, yes: i === 0 ? sma() : { type: 'name', name: 'x' }, no: node }
      levels.push(node)
    }
    return levels
  }

  it('⭐ asking every level of an N-deep chain visits each node once, not N²/2 times', () => {
    const fns = new Set()
    const levels = chain(40)
    const before = armHistoryWalkStats.visits
    for (const lv of levels) { expect(armHistoryCallOf(lv.no, fns)).toEqual(levels.indexOf(lv) === 0 ? null : { name: 'ta.sma', udf: false }) }
    const visits = armHistoryWalkStats.visits - before
    // 40 ternaries, each with a test, a yes and (at the bottom) the leaf: ~121 nodes
    expect(visits).toBeLessThanOrEqual(130)
    // 🔴 CONTROL — a fresh roster (a new translation) walks again
    const again = armHistoryWalkStats.visits
    armHistoryCallOf(levels[39], new Set())
    expect(armHistoryWalkStats.visits - again).toBeGreaterThan(100)
  })

  it('⛔ a `null` the depth cap produced is not remembered: a shallower start still finds the call', () => {
    const fns = new Set()
    const levels = chain(80)
    // from the top the call sits 80 levels down, past the cap of 64
    expect(armHistoryCallOf(levels[79], fns)).toBeNull()
    // from 20 levels down it is within reach, and the earlier capped walk did not poison it
    expect(armHistoryCallOf(levels[20], fns)).toEqual({ name: 'ta.sma', udf: false })
  })
})

describe('G-c — the counter fold copy keeps its arm stamps', () => {
  it('⭐ `copyKeepingArmRuns` is the JSON copy, byte for byte, with every stamp carried', () => {
    const inner = stampArmRuns(op('&&', series('up'), call('rising', series('close'), num(2))), [{ ...RUN, what: 'that right side' }])
    const tree = op('!', op('*', inner, num(NaN)))
    const copy = copyKeepingArmRuns(tree)
    expect(JSON.stringify(copy)).toBe(JSON.stringify(JSON.parse(JSON.stringify(tree))))
    expect(copy.args[0].args[1].value).toBeNull()               // the JSON copy's own NaN → null
    expect(copy.args[0].args[0]).not.toBe(inner)
    expect(armRunGates([copy], TABLE)).toHaveLength(1)
    // 🔴 CONTROL — the plain JSON copy loses it
    expect(armRunGates([JSON.parse(JSON.stringify(tree))], TABLE)).toHaveLength(0)
  })

  it('⭐ through the translator: `n := up and ta.rising(close, 2) ? n + 1 : 0` read as a run of 3 is gated', () => {
    const t = translatePine(['//@version=6', 'indicator("gc")', 'up = close > open', 'var int n = 0',
      'n := up and ta.rising(close, 2) ? n + 1 : 0', 'plot(n >= 3 ? 1 : 0, "R")'].join('\n'), { strict: true, paramManifest: true })
    const row = t.outputs.find((o) => o && o.title === 'R')
    expect(row && row.ast).toBeTruthy()
    expect(JSON.stringify(row.ast)).not.toMatch(/accum/)         // the counter fold, not a recurrence
    const gates = ((t.blockRuns && t.blockRuns.outputs) || []).flatMap((o) => o.gates)
    expect(gates.map((g) => g.what)).toContain('that right side')
  })
})

describe('G-h — a paint\'s and a fill\'s colour honour C48\'s block gates', () => {
  const src = (...body) => ['//@version=6', 'indicator("gh", overlay = true)', 'var float s = na', 'if close > open',
    '    s := ta.sma(close, 3)', ...body].join('\n')

  it('⭐ `bgcolor(close > s ? … : …)` carries the block\'s guard on its colour rule', () => {
    const t = translatePine(src('plot(close, "C")', 'bgcolor(close > s ? color.red : color.green)'), { strict: true, paramManifest: true })
    const paint = t.presentation.paints[0]
    expect(paint.withheld).toBeUndefined()
    const colours = colourBlockRunsOf(t, TABLE)
    expect(colours).toHaveLength(1)
    expect(colours[0].formula).toBe(paint.colorCondition.formula)
    expect(printFormula(colours[0].gates[0].guard)).toMatch(/close > open/)
    // the plot it does not colour is untouched
    expect((t.blockRuns && t.blockRuns.outputs) || []).toEqual([])
  })

  it('⭐ a fill\'s colour too', () => {
    const t = translatePine(src('p1 = plot(close, "C")', 'p2 = plot(open, "O")', 'fill(p1, p2, color = close > s ? color.red : color.green)'),
      { strict: true, paramManifest: true })
    const colours = colourBlockRunsOf(t, TABLE)
    expect(colours.some((c) => c.gates.some((g) => /close > open/.test(printFormula(g.guard))))).toBe(true)
  })

  // a guard that reads the very `var` its block fills: no standalone guard can be carried
  const selfRef = (...body) => ['//@version=6', 'indicator("gh", overlay = true)', 'var float s = na',
    'if na(s) or s > s[1]', '    s := ta.sma(close, 3)', ...body].join('\n')

  it('⛔ r1 — a paint whose block gate has no guard to carry is WITHHELD by name (`pine:block`), never drawn', () => {
    const t = translatePine(selfRef('plot(close, "C")', 'bgcolor(close > s ? color.red : color.green)'), { strict: true, paramManifest: true })
    const paint = t.presentation.paints[0]
    expect(paint.withheld && paint.withheld.code).toBe('pine:block')
    expect(paint.withheld.reason).toMatch(/`ta\.sma` inside a block/)
    expect(paint.colorCondition).toBeUndefined()
  })

  it('⛔ r1 — a fill whose block gate has no guard to carry is not drawn, and the member is told WHY, by name', () => {
    const t = translatePine(selfRef('p1 = plot(close, "C")', 'p2 = plot(open, "O")', 'fill(p1, p2, color = close > s ? color.red : color.green)'),
      { strict: true, paramManifest: true })
    expect(t.presentation.fills || []).toEqual([])
    const msgs = []
    JSON.stringify(t, (k, v) => { if (typeof v === 'string' && v.startsWith('`fill`')) msgs.push(v); return v })
    expect(msgs).toHaveLength(1)
    expect(msgs[0]).toMatch(/^`fill` is not drawn: its colour is withheld — .*`ta\.sma` inside a block/)
    expect(msgs[0]).not.toMatch(/edges/)
    // 🔴 CONTROL — the same fill over a block that reads no call is drawn, and said so
    const ok = translatePine(['//@version=6', 'indicator("gh", overlay = true)', 'p1 = plot(close, "C")', 'p2 = plot(open, "O")',
      'fill(p1, p2, color = close > open ? color.red : color.green)'].join('\n'), { strict: true, paramManifest: true })
    expect(ok.presentation.fills).toHaveLength(1)
  })

  it('⭐ r1 — a paint reads a ONE-RUN block the way a plot does (C42): the one-run value, not the every-bar call', () => {
    const t = translatePine(['//@version=6', 'indicator("gh", overlay = true)', 'float s = na', 'if barstate.islast',
      '    s := ta.sma(close, 3)', 'plot(close > s ? 1 : 0, "P")', 'bgcolor(close > s ? color.red : color.green)'].join('\n'),
    { strict: true, paramManifest: true })
    const plotRule = t.outputs.find((o) => o.title === 'P').formula
    const paintRule = t.presentation.paints[0].colorCondition.formula
    expect(paintRule).not.toMatch(/sma/)
    expect(plotRule).toBe(`${paintRule} ? 1 : 0`)
  })

  it('🔴 CONTROL — a paint whose colour reads no block carries nothing; the screener lane is untouched', () => {
    const t = translatePine(src('plot(close, "C")', 'bgcolor(close > open ? color.red : color.green)'), { strict: true, paramManifest: true })
    expect(colourBlockRunsOf(t, TABLE)).toEqual([])
    const scr = translatePine(src('plot(close, "C")', 'bgcolor(close > s ? color.red : color.green)'), { paramManifest: true })
    expect(scr.blockRuns).toBeUndefined()
  })
})

describe('G-d — a withheld colour is said on the plot it colours', () => {
  const plot = { key: 'p0', style: 'line', colorMode: 'column:p9' }
  const errs = { p9: { guard: 'pine:block', message: 'GATE SENTENCE' } }

  it('⭐ the condition column\'s refusal, by the gate\'s own sentence', () => {
    expect(withheldColourOf(plot, errs)).toMatch(/GATE SENTENCE$/)
    expect(withheldColourOf(plot, {})).toBeNull()
    expect(withheldColourOf({ key: 'p0', colorMode: 'static' }, errs)).toBeNull()
  })

  it('⭐ the info row keeps the VALUE and carries the sentence as its reason', () => {
    const def = { id: 'd', meta: { name: 'D' }, plots: [plot, { key: 'p9', style: 'line', hidden: true }] }
    const cs = { indicatorInstances: [{ instanceId: 'i1', defId: 'd' }] }
    const env = {
      defOf: () => def,
      bindings: [{ instanceId: 'i1', plotKey: 'p0', frame: {}, lastValue: 12.5 }],
      columnErrorsOf: () => errs,
    }
    const r = resolveInfoValue(cs, { instanceId: 'i1', plotKey: 'p0' }, env)
    expect(r.state).toBe(INFO_VALUE_STATES.VALUE)
    expect(r.value).toBe(12.5)
    expect(r.colourWithheld).toBe(true)
    expect(r.reason).toMatch(/GATE SENTENCE/)
    // ⭐ r1 — and on a bar with no value (UNKNOWN) the sentence is said too
    const unknown = resolveInfoValue(cs, { instanceId: 'i1', plotKey: 'p0' },
      { ...env, bindings: [{ instanceId: 'i1', plotKey: 'p0', frame: {}, lastValue: NaN }] })
    expect(unknown.state).toBe(INFO_VALUE_STATES.UNKNOWN)
    expect(unknown.reason).toMatch(/unknown.*GATE SENTENCE/)
    // 🔴 CONTROL — no refusal on the column, no sentence
    const quiet = resolveInfoValue(cs, { instanceId: 'i1', plotKey: 'p0' }, { ...env, columnErrorsOf: () => ({}) })
    expect(quiet.reason).toBeUndefined()
    expect(quiet.colourWithheld).toBeUndefined()
  })
})
