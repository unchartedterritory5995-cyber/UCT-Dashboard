import { describe, it, expect } from 'vitest'

import { translatePine } from './pine.js'
import { translateThinkScript } from './thinkscript.js'
import { sentenceFor } from './sentence.js'
import { parseFormula } from './parse.js'
import { interpret } from './interpret.js'
import TABLE from './closedTable.json'

/**
 * `hma` — Alan Hull's average, declared ONCE and reached through every door.
 *
 * ⭐⭐ THIS IS "ONE ENGINE, THREE DOORS" DOING ITS JOB, and the proof is that
 * `thinkscript.js` needed no edit at all. `TS_AVERAGE_TYPES` has mapped
 * `AverageType.HULL` to the NAME `hma` since before the function existed, and
 * `dispatchEngine` refused with "would need `hma`, which this engine does not
 * declare" — DERIVED from the manifest rather than hard-coded — so the arm
 * stopped refusing the moment the table declared it. Pine's `ta.hma` arrives the
 * same way, through `functionIndex`. The English read-back comes from the
 * manifest's own `sentence`.
 *
 * ⛔ AND IT IS A COMPOSITION OF `wma`, NOT NEW MATHS. Expanding it inside each
 * translator instead would have put two copies of Hull's formula in the repo, and
 * two copies of one formula is how two doors come to disagree about one indicator.
 */
describe('the Hull average is declared once and reached from everywhere', () => {
  const pineOf = (src) => {
    const out = translatePine(`//@version=5\nindicator("t")\n${src}\n`)
    expect(out.refusal, out.refusal && out.refusal.message).toBe(null)
    return out.outputs.find((o) => !o.refusal).formula
  }
  const tsOf = (src) => {
    const out = translateThinkScript(src)
    expect(out.refusal, out.refusal && out.refusal.message).toBe(null)
    return out.outputs.find((o) => !o.refusal).formula
  }

  it('⭐⭐ Pine`s `ta.hma`, thinkorswim`s `AverageType.HULL` and the read-back agree', () => {
    expect(pineOf('plot(ta.hma(close, 9))')).toBe('hma(close, 9)')
    expect(tsOf('plot p = MovingAverage(AverageType.HULL, close, 9);\n')).toBe('hma(close, 9)')
    const r = parseFormula('hma(close, 9)')
    expect(r.ok).toBe(true)
    expect(sentenceFor(r.ast)).toBe('the 9-bar Hull average of close')
  })

  it('⭐ the manifest is what makes that true — the entry is a real declaration', () => {
    // ⛔ DERIVED, NOT RETYPED. If this entry is renamed or its arity changes, the
    // three doors above change with it and this test says so at the source.
    const spec = TABLE.functions.hma
    expect(spec, '`hma` is not declared').toBeTruthy()
    expect(spec.args).toEqual(['series', 'int'])
    expect(spec.argRoles).toEqual(['source', 'period'])
    // ⚠️ AN UPPER BOUND, like ADX's `2*arg3`. The true reach is
    // `n + round(sqrt(n)) - 1`; the budget may over-reserve and must never
    // under-reserve, so this is checked as an inequality against the real reach
    // rather than pinned as a string somebody could copy without meaning it.
    expect(spec.lookback).toBe('2*arg1')
    for (const n of [1, 2, 6, 9, 20, 200]) {
      const reach = n + Math.max(1, Math.round(Math.sqrt(n))) - 1
      expect(reach, `n=${n}`).toBeLessThanOrEqual(2 * n)
    }
  })

  it('⭐⭐ and the NUMBER matches an independent implementation of Hull`s formula', () => {
    // ⛔ THE ARITHMETIC, NOT THE WIRING. A function that resolved correctly and
    // computed a plain `wma` would pass every test above.
    const n = 9
    const closes = Array.from({ length: 120 }, (_, i) => 100 + Math.sin(i / 5) * 8 + (i % 7))
    const bars = closes.map((c, i) => ({ t: 20260101 + i, o: c, h: c, l: c, c, v: 100 }))
    const col = interpret(parseFormula(`hma(close, ${n})`).ast, bars)

    const wma = (xs, w) => xs.map((_, i) => {
      if (i < w - 1) return NaN
      let num = 0
      let den = 0
      for (let k = 0; k < w; k += 1) {
        const weight = k + 1
        num += xs[i - w + 1 + k] * weight
        den += weight
      }
      return num / den
    })
    const half = Math.floor(n / 2)
    const root = Math.round(Math.sqrt(n))
    const raw = wma(closes, half).map((v, i) => 2 * v - wma(closes, n)[i])
    const want = wma(raw, root)

    let compared = 0
    for (let i = 0; i < closes.length; i += 1) {
      if (Number.isNaN(want[i])) { expect(Number.isNaN(col[i]), `bar ${i}`).toBe(true); continue }
      expect(col[i], `bar ${i}`).toBeCloseTo(want[i], 9)
      compared += 1
    }
    // ⛔ THE NON-VACUITY FLOOR. Without it a column of all-NaN passes this loop.
    expect(compared, 'computable bars compared').toBeGreaterThan(100)
  })

  it('⛔ a period of ONE is the clamp — floor(1 / 2) is not a window', () => {
    // Both lanes clamp the two derived windows at 1. Without it one divides by
    // zero and the other returns an empty-window NaN — a cross-lane divergence
    // reachable by a member typing `1`.
    const bars = Array.from({ length: 10 }, (_, i) => {
      const c = 100 + i
      return { t: 20260101 + i, o: c, h: c, l: c, c, v: 100 }
    })
    const col = interpret(parseFormula('hma(close, 1)').ast, bars)
    // hma(x, 1) = wma(2*wma(x,1) - wma(x,1), 1) = x
    expect(col.filter((v) => Number.isFinite(v)).length).toBe(10)
    expect(col[9]).toBeCloseTo(109, 9)
  })

  it('⛔ …and 01-supertrend-mobius walks past HULL to its REAL final wall', () => {
    // ⭐ THE HONEST HALF. `AverageType.HULL` was the second of three walls on that
    // script; clearing it exposes the third, which is that `def ST = if close <
    // ST[1] then UP else DN` states no first-bar value. That refusal is measured
    // (see `thinkscript.selfref.test.js`), so the script is at its true end and
    // not at an accident of resolution order.
    const out = translateThinkScript(
      'input n = 4;\ndef ATR = MovingAverage(AverageType.HULL, TrueRange(high, close, low), n);\n'
      + 'def UP = HL2 + ATR;\ndef DN = HL2 - ATR;\n'
      + 'def ST = if close < ST[1] then UP else DN;\nplot p = ST;\n')
    const r = out.refusal || (out.outputs || []).map((o) => o.refusal).find(Boolean)
    expect(r.guard).toBe('thinkscript:state')
    expect(r.token).toBe('ST')
  })
})
