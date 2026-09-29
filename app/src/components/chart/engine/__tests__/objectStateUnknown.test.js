// app/src/components/chart/engine/__tests__/objectStateUnknown.test.js
//
// ─── ⭐⭐ C12 — A `var` BEFORE ITS WARM-UP IS UNKNOWN, AND AN UNKNOWN DRAWS NOTHING ─
//
// A translated `var` is `accum(seed, body, W)`, `NaN` on every bar before `W`,
// while Pine's `var` holds a real value there. Read as Pine's `na`, that `NaN`
// sends a comparison down its `else` and a label says the wrong word — measured
// on `market-structure-by-leviathan` (see `c12BlockState.vendor.test.js`).
//
// Two halves, each with the control that fails without it:
//   · `unknownMask` (objectColumns) says WHICH bars of a tree depend on a prefix
//   · `readUnknown` (objectRuntime) withholds an op that reads one on such a bar
import { describe, it, expect } from 'vitest'
import { evaluateObjects } from '../objectRuntime'
import { unknownMask, readsBoundedState } from '../objectColumns'
import { parseFormula } from '../ast/parse.js'
import { interpret } from '../ast/interpret'

const P = (over) => ({ programVersion: 1, regs: [], colls: [], ops: [], ...over })
const ctxOf = (barCount, cols, extra = {}) => ({
  barCount,
  readNode: (node, bar) => (cols[node] ? cols[node][bar] : NaN),
  readTime: (bar) => 1_700_000_000 + bar * 86400,
  ...extra,
})
const ones = (n) => Array.from({ length: n }, () => 1)

describe('C12 — the runtime withholds an op that reads an unknown node', () => {
  const label = (when, y) => ({
    k: 'create', family: 'label', site: 'a', into: null, when, props: { x: { v: 'bar' }, y },
  })

  it('⭐ a guard node unknown on bars 0–2 creates nothing there, and says how many it withheld', () => {
    const prog = P({ ops: [label({ v: 'graph', node: 0 }, { v: 'const', value: 1 })] })
    const run = evaluateObjects(prog, ctxOf(6, { 0: ones(6) }, { readUnknown: (node, bar) => node === 0 && bar < 3 }))
    expect(run.live.map((o) => o.createdBar)).toEqual([3, 4, 5])
    expect(run.stats.withheldUnknown).toBe(3)
  })

  it('⭐ a KNOWN guard with an unknown coordinate is withheld too — the object would be drawn off a guess', () => {
    const prog = P({ ops: [label({ v: 'graph', node: 0 }, { v: 'graph', node: 1 })] })
    const run = evaluateObjects(prog, ctxOf(6, { 0: ones(6), 1: ones(6) }, { readUnknown: (node, bar) => node === 1 && bar < 2 }))
    expect(run.live.map((o) => o.createdBar)).toEqual([2, 3, 4, 5])
  })

  it('⛔ CONTROL — with no `readUnknown` (the runtime lane, which runs `var`s from bar 0) every bar fires', () => {
    const prog = P({ ops: [label({ v: 'graph', node: 0 }, { v: 'graph', node: 1 })] })
    const run = evaluateObjects(prog, ctxOf(6, { 0: ones(6), 1: ones(6) }))
    expect(run.live).toHaveLength(6)
    expect(run.stats.withheldUnknown).toBeUndefined()
  })
})

describe('C12 — `unknownMask`: which bars of a tree depend on a recurrence prefix', () => {
  // up bars on 1, 4, 7, 9 — `level` is the close of the latest up bar
  const closes = [10, 12, 11, 10, 14, 13, 12, 16, 15, 17, 16, 15]
  const bars = closes.map((c, i) => ({ t: 1_700_000_000 + i * 86400, o: c - (i % 3 === 1 ? 1 : -1), h: c + 1, l: c - 1, c, v: 1 }))
  const W = 3
  const level = `accum(0/0, close > open ? close : self, ${W})`
  const maskOf = (src) => {
    const { ast } = parseFormula(src)
    const col = interpret(ast, bars, {}, undefined, undefined, {})
    return { mask: unknownMask(ast, col, bars, {}, undefined, {}), col }
  }

  it('⭐ the comparison against the state is unknown exactly on the prefix, and known after it', () => {
    const { mask } = maskOf(`close >= ${level}`)
    expect(mask).not.toBeNull()
    const unknown = [...mask].map((m, i) => (m ? i : -1)).filter((i) => i >= 0)
    // the prefix is bars 0..W-1; from W on the value is the window's own answer
    expect(unknown).toEqual([0, 1, 2])
  })

  it('⭐ `na(state)` is caught too — it is TRUE on a `NaN` prefix and false under either probe', () => {
    const { mask } = maskOf(`na(${level}) ? 1 : 0`)
    expect([...mask].slice(0, W)).toEqual([1, 1, 1])
  })

  it('⛔ CONTROL — a tree with no recurrence has no unknown bars: its warm-up `NaN` IS Pine\'s `na`', () => {
    const { ast } = parseFormula('close > sma(close, 5)')
    expect(readsBoundedState(ast)).toBe(false)
    const col = interpret(ast, bars, {}, undefined, undefined, {})
    expect(unknownMask(ast, col, bars, {}, undefined, {})).toBeNull()
  })

  it('⛔ CONTROL — the real column is never the probe\'s: the prefix still reads `NaN` to a member', () => {
    const { col } = maskOf(level)
    expect([...col].slice(0, W).every(Number.isNaN)).toBe(true)
  })
})
