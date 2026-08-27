// ⭐ THE DERIVED PINE CALLS, AND THE TWO THAT REFUSE INSTEAD.
//
// `ta.roc` and `ta.avg` are EXACT expansions in this table's own vocabulary, so
// they cost the closed table zero new names — the same rule that governs `tr` and
// the four derived logical operators. `ta.cum` and `ta.barssince` are NOT
// expressible here, and they refuse BY NAME with the reason rather than resolving
// to a neighbour that would parse, lint, save, scan and be wrong.

import { describe, it, expect } from 'vitest'
import { translatePine, PINE_INEXPRESSIBLE } from './pine.js'
import { parseFormula, astHash, TABLE } from './parse.js'
import { interpret } from './interpret.js'

/** A one-plot script, so the translator's own door is the thing under test. */
const script = (expr) => `//@version=5
indicator("t")
plot(${expr})
`

const treeOf = (expr) => {
  const r = translatePine(script(expr))
  const out = (r.outputs || []).find((o) => o.ast)
  if (!out) {
    const ref = (r.outputs || []).map((o) => o.refusal).find(Boolean) || r.refusal
    throw new Error(`refused: ${ref ? ref.guard + ' — ' + ref.message : 'no output'}`)
  }
  return out.ast
}

const refusalOf = (expr) => {
  const r = translatePine(script(expr))
  return (r.outputs || []).map((o) => o.refusal).find(Boolean) || r.refusal || null
}

const BARS = Array.from({ length: 40 }, (_, i) => {
  const c = 100 + i
  return { o: c - 1, h: c + 1, l: c - 2, c, v: 1000 + i * 10 }
})
const col = (tree) => [...interpret(tree, BARS, {})]

describe('ta.roc — an exact expansion, not a new name', () => {
  it('IS the native tree, by astHash', () => {
    // TradingView's own definition: 100 * (src - src[n]) / src[n]
    const native = parseFormula('100 * (close - close[10]) / close[10]')
    expect(native.ok).toBe(true)
    expect(astHash(treeOf('ta.roc(close, 10)'))).toBe(astHash(native.ast))
  })

  it('computes the percentage change, checked by hand', () => {
    const out = col(treeOf('ta.roc(close, 10)'))
    // close rises by exactly 1 per bar, so at bar 20: 100*(120-110)/110
    expect(out[20]).toBeCloseTo((100 * 10) / 110, 9)
    // ⛔ AND THE LEFT EDGE IS NOT COMPUTABLE, never 0 — a zero would read as
    // "no change" and match every `roc < 1` screen on a stock's first bars.
    expect(Number.isNaN(out[9])).toBe(true)
  })

  it('a length that is not a written number REFUSES rather than guessing', () => {
    expect(refusalOf('ta.roc(close, close)')).toBeTruthy()
  })
})

describe('ta.avg — the mean of its ARGUMENTS, which is not a moving average', () => {
  it('IS the native tree, by astHash', () => {
    const native = parseFormula('(high + low) / 2')
    expect(native.ok).toBe(true)
    expect(astHash(treeOf('ta.avg(high, low)'))).toBe(astHash(native.ast))
  })

  it('⛔ IS NOT `sma`, AND THAT IS THE TRAP', () => {
    // Reading `ta.avg(a, b)` as a 2-bar moving average of `a` parses, scans and
    // is wrong on every bar. The hashes must differ.
    const wrong = parseFormula('sma(high, 2)')
    expect(astHash(treeOf('ta.avg(high, low)'))).not.toBe(astHash(wrong.ast))
  })

  it('averages three arguments too', () => {
    const out = col(treeOf('ta.avg(high, low, close)'))
    const b = BARS[15]
    expect(out[15]).toBeCloseTo((b.h + b.l + b.c) / 3, 9)
  })

  it('one argument REFUSES — an average of one thing is a typo, not a mean', () => {
    expect(refusalOf('ta.avg(close)')).toBeTruthy()
  })
})

describe('🔴 the two that CANNOT be expressed, and say so by name', () => {
  it('ta.cum refuses, and names the running-total reason', () => {
    const r = refusalOf('ta.cum(volume)')
    expect(r).toBeTruthy()
    expect(r.message).toMatch(/running total/i)
    // ⭐ AND IT POINTS AT THE HONEST ALTERNATIVE rather than just saying no.
    expect(r.message).toMatch(/sum\(source, n\)/)
  })

  it('ta.barssince refuses, and names the UNBOUNDED reason', () => {
    const r = refusalOf('ta.barssince(close > open)')
    expect(r).toBeTruthy()
    expect(r.message).toMatch(/unbounded/i)
  })

  it('⛔ NEITHER RESOLVES TO A NEIGHBOUR — the whole point of naming them', () => {
    // If `cum` ever silently became `sum`, this is what would catch it.
    for (const expr of ['ta.cum(volume)', 'ta.barssince(close > open)']) {
      expect(() => treeOf(expr)).toThrow(/refused/)
    }
  })

  it('⛔⛔ …AND A TABLE ENTRY OF THE SAME SPELLING DOES NOT LET ONE THROUGH', () => {
    // ⚰️ THE MEASURED REGRESSION. `barssince` landed in `closedTable.json` on
    // 2026-08-26 as the BOUNDED `barssince(condition, n)`. `PINE_INEXPRESSIBLE`
    // was consulted only when the table had NO such name, so `ta.barssince(cond)`
    // stopped reporting the unbounded reason and started reporting an ARITY
    // message — *"this table takes 2"* — which reads as "just add a number", and
    // the number a member adds silently CAPS a count Pine leaves uncapped.
    //
    // ⭐ THE SUBJECT IS DERIVED: every inexpressible name the table ALSO declares
    // is exercised, so the next collision is covered on the day it lands.
    const collisions = [...Object.keys(PINE_INEXPRESSIBLE)]
      .filter((n) => Object.prototype.hasOwnProperty.call(TABLE.functions, n))
    // NON-VACUITY — a rail about collisions with none to look at proves nothing.
    expect(collisions, 'no inexpressible name collides with the table any more; '
      + 'if that is deliberate, delete this rail rather than letting it pass '
      + 'vacuously').toContain('barssince')

    for (const name of collisions) {
      const spec = TABLE.functions[name]
      // The PINE spelling, with PINE's arity — one argument for `ta.barssince`.
      const r = refusalOf(`ta.${name}(close > open)`)
      expect(r, `ta.${name} resolved instead of refusing`).toBeTruthy()
      expect(r.guard, `ta.${name} refused at the wrong door`).toBe('pine:function')
      expect(r.message, `ta.${name}'s refusal lost its REASON and reports arity`)
        .not.toMatch(/different signature/i)
      // …and the reason names the engine's own bounded entry, so the member is
      // told what to write rather than only what not to.
      expect(r.message).toContain(`${name}(`)
      expect(spec.args.length, `${name} is a collision only while the arities differ`)
        .toBeGreaterThan(1)
    }
  })
})

// ─── ta.cross — the EITHER-direction crossing ────────────────────────────────
//
// `ta.crossover` and `ta.crossunder` already mapped; `ta.cross` did not, and it
// was the single blocker on a real published script in the corpus. The table
// declares both directions, so this costs zero new names — the `roc`/`avg` bar.
describe('ta.cross — either direction, spelled out', () => {
  it('IS the native either-direction tree, by astHash', () => {
    const native = parseFormula('crossOver(sma(close, 9), sma(close, 200))'
      + ' || crossUnder(sma(close, 9), sma(close, 200))')
    expect(native.ok, native.error).toBe(true)
    expect(astHash(treeOf('ta.cross(ta.sma(close, 9), ta.sma(close, 200))')))
      .toBe(astHash(native.ast))
  })

  it('🔴 IS NOT `crossover` ALONE — the near-miss that would answer half the question', () => {
    // ⛔ THE WHOLE REASON THIS IS WRITTEN DOWN. Resolving `ta.cross` to
    // `crossOver` parses, lints, saves and scans; it just silently drops every
    // downward cross. A member screening "the 9 crossed the 200" would get a
    // shorter list with nothing to indicate what was missing from it.
    expect(astHash(treeOf('ta.cross(close, ta.sma(close, 10))')))
      .not.toBe(astHash(treeOf('ta.crossover(close, ta.sma(close, 10))')))
  })

  it('fires on a DOWNWARD cross, which is the half a near-miss would lose', () => {
    // A series that rises, then falls back through its own average. `crossover`
    // alone is 0 on every bar of the fall; `cross` is not.
    const bars = []
    for (let i = 0; i < 30; i++) { const c = 100 + i; bars.push({ o: c, h: c + 1, l: c - 1, c, v: 1000 }) }
    for (let i = 0; i < 30; i++) { const c = 130 - i * 2; bars.push({ o: c, h: c + 1, l: c - 1, c, v: 1000 }) }
    const run = (e) => [...interpret(treeOf(e), bars, {})]
    const both = run('ta.cross(close, ta.sma(close, 10))')
    const up = run('ta.crossover(close, ta.sma(close, 10))')
    expect(both.filter((x) => x === 1).length).toBeGreaterThan(up.filter((x) => x === 1).length)
  })

  it('needs both series — arity refuses before the expansion builds', () => {
    const ref = refusalOf('ta.cross(close)')
    expect(ref && ref.guard).toBe('pine:arity')
    expect(ref.message).toContain('needs both')
  })
})

// ─── A `var` SEEDED `na` THAT NOTHING UPDATES ───────────────────────────────
//
// 🔴 THE WORST OUTCOME AVAILABLE IS NOT A REFUSAL — IT IS A SAVEABLE DEAD
// COLUMN. `accum(0/0, self, n)` never leaves its seed, so every bar is blank;
// it parses, budgets, lints `non-repainting` and clears the save gate. A member
// gets a scan that returns nothing and reads it as a quiet market.
//
// ⚠️ This was unreachable until `ta.cross` landed — the same expression refused
// earlier for the missing function, so the dead accumulator sat behind a louder
// refusal. Closing one gap is what exposed it.
describe('a `var` seeded `na` that nothing updates refuses, rather than going blank', () => {
  const anchored = `//@version=5
indicator("t")
var float acc = na
plot(ta.cross(close, acc) ? 1 : 0)
`

  it('refuses by name at pine:state, naming the variable', () => {
    const r = translatePine(anchored)
    const ref = (r.outputs || []).map((o) => o.refusal).find(Boolean) || r.refusal
    expect(ref, 'something must refuse').toBeTruthy()
    expect(ref.guard).toBe('pine:state')
    expect(ref.message).toContain('acc')
    expect(ref.message).toContain('blank')
  })

  it('⛔ …and the thing it prevents is a column that is NaN on EVERY bar', () => {
    // The proof the refusal is worth having: build the tree the translator would
    // have emitted and run it. Not one bar of 200 carries a value.
    const dead = parseFormula('accum(0 / 0, self, 250)')
    expect(dead.ok, dead.error).toBe(true)
    const bars = Array.from({ length: 200 }, (_, i) => ({ o: 10, h: 11, l: 9, c: 10 + i * 0.1, v: 1000 }))
    const col = [...interpret(dead.ast, bars, {})]
    expect(col.every((x) => x === null || Number.isNaN(x))).toBe(true)
  })

  it('a `var` with a CONSTANT seed is still unwrapped, not refused', () => {
    // ⛔ The guard must be narrow. `var k = 5` is a legitimate constant and was
    // already unwrapped; catching it here would refuse working scripts.
    const r = translatePine(`//@version=5
indicator("t")
var float k = 5
plot(close > k ? 1 : 0)
`)
    expect(r.ok, JSON.stringify((r.outputs || []).map((o) => o.refusal))).toBe(true)
  })

  it('…and a `var` seeded from a SERIES still keeps its accumulator', () => {
    // `var anchor = close` really does mean a bar in the past — it is not dead,
    // and refusing it would be the over-reach this narrowness exists to avoid.
    const r = translatePine(`//@version=5
indicator("t")
var float anchor = close
plot(close > anchor ? 1 : 0)
`)
    expect(r.ok, JSON.stringify((r.outputs || []).map((o) => o.refusal))).toBe(true)
  })
})
