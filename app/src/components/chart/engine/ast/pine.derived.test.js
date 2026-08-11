// ⭐ THE DERIVED PINE CALLS, AND THE TWO THAT REFUSE INSTEAD.
//
// `ta.roc` and `ta.avg` are EXACT expansions in this table's own vocabulary, so
// they cost the closed table zero new names — the same rule that governs `tr` and
// the four derived logical operators. `ta.cum` and `ta.barssince` are NOT
// expressible here, and they refuse BY NAME with the reason rather than resolving
// to a neighbour that would parse, lint, save, scan and be wrong.

import { describe, it, expect } from 'vitest'
import { translatePine } from './pine.js'
import { parseFormula, astHash } from './parse.js'
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
})
