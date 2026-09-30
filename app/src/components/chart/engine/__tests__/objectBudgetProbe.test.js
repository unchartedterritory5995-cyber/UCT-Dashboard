// app/src/components/chart/engine/__tests__/objectBudgetProbe.test.js
//
// ─── ⭐⭐ C19 — A PROBE IS CHARGED FOR WHAT IT COMPUTES, AND A REFUSED PROBE PUBLISHES NOTHING ─
//
// The node budget counts what an `interpret` call actually computes
// (`interpret.js::evaluationUnits`): a column the pass already holds is one read.
// The object lane's pass admits a tree against the pass memo; its PROBES
// (`objectColumns.js::unknownMask`) run with memos of their own, so:
//   1. a probe may read the pass's column of a subtree that holds NO recurrence
//      (`probeBase`, `interpret.js::passView`) — no probe value can move it — and
//      is charged one read for it;
//   2. it may NEVER read a column that holds one: that column is exactly what
//      the probe exists to move;
//   3. a probe the budget still refuses proves nothing, so every bar is
//      withheld — the safe direction — never `null` (which publishes them all).
import { describe, it, expect } from 'vitest'
import { unknownMask } from '../objectColumns'
import { parseFormula } from '../ast/parse.js'
import { interpret, nodeCount } from '../ast/interpret'

const closes = [10, 12, 11, 10, 14, 13, 12, 16, 15, 17, 16, 15]
const bars = closes.map((c, i) => ({ t: 1_700_000_000 + i * 86400, o: c - (i % 3 === 1 ? 1 : -1), h: c + 1, l: c - 1, c, v: 1 }))
const num = (value) => ({ type: 'num', value })
const series = (name) => ({ type: 'series', name })
const op = (name, ...args) => ({ type: 'op', name, args })
const bits = (m) => (m === null ? null : [...m])

/** A recurrence-free sum of `n` different terms — `3n` units. */
function wide(n) {
  let t = op('*', series('close'), num(1))
  for (let k = 2; k <= n; k += 1) t = op('+', t, op('*', series('close'), num(k)))
  return t
}

describe('C19 — `unknownMask` under the budget', () => {
  // `level` needs 12 bars of warm-up, so on these 12 bars every bar is its prefix
  // and the probe runs over the WHOLE series (the case `probeBase` serves)
  const level = parseFormula('accum(0/0, close > open ? close : self, 12)').ast

  it('⛔ a probe never reads the pass\'s column of a RECURRENCE: every prefix bar is still unknown', () => {
    const tree = op('>=', series('close'), level)
    const memo = new Map()
    const col = interpret(tree, bars, {}, undefined, undefined, { crossMemo: memo })
    expect(memo.has(level)).toBe(true) // the pass holds the recurrence's column…
    const mask = unknownMask(tree, col, bars, {}, undefined, { probeBase: memo })
    expect(bits(mask)).toEqual(bars.map(() => 1)) // …and the probe moved it anyway
  })

  // The window `sma(close, 15)` makes the tree's reach 15 on 12 bars, so its probe
  // runs over the WHOLE series (where `probeBase` serves), while the recurrence's
  // own prefix is 3 bars: the exact mask is bars 0–2, not every bar.
  const call = (name, ...args) => ({ type: 'call', name, args })
  const short = parseFormula('accum(0/0, close > open ? close : self, 3)').ast
  const heavy = () => {
    const big = op('+', wide(40), op('?:', call('na', call('sma', series('close'), num(15))), num(1), num(0)))
    return { big, tree: op('>=', op('+', big, short), num(0)) }
  }

  it('⭐ a probe reads the pass recurrence-FREE column for one unit, so an admitted tree gets its EXACT mask', () => {
    const { big, tree } = heavy()
    const memo = new Map()
    interpret(big, bars, {}, undefined, undefined, { crossMemo: memo })
    // standalone over the cap; against the pass it is the tree's own work
    expect(nodeCount(tree)).toBeGreaterThan(128)
    expect(nodeCount(tree, memo)).toBeLessThanOrEqual(128)
    const col = interpret(tree, bars, {}, undefined, undefined, { crossMemo: memo })
    const mask = unknownMask(tree, col, bars, {}, undefined, { probeBase: memo })
    expect(bits(mask)).toEqual(bars.map((_, i) => (i < 3 ? 1 : 0)))
  })

  it('⛔ …and WITHOUT the pass columns the probe is refused — and every bar is withheld, never published', () => {
    const { big, tree } = heavy()
    const memo = new Map()
    interpret(big, bars, {}, undefined, undefined, { crossMemo: memo })
    const col = interpret(tree, bars, {}, undefined, undefined, { crossMemo: memo })
    // the probe is charged standalone (no `probeBase`) and refuses at `budget:nodes`
    const mask = unknownMask(tree, col, bars, {}, undefined, {})
    expect(mask).not.toBeNull()
    expect(bits(mask)).toEqual(bars.map(() => 1))
  })
})
