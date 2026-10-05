import { describe, it, expect } from 'vitest'

import { translatePine } from './pine.js'

/**
 * ⭐⭐ W19-H1 — `x := switch` (NO SUBJECT) WHEN `x` IS A `var`.
 *
 *     var float TP = na
 *     if TradeFire and not TradeisON
 *         TP := switch                 — smart-money-breakouts-chartprime:208
 *             Long  => close + (RR1 * longDiffSL)
 *             Short => close - (RR1 * longDiffSL2)
 *
 * H2 (step 69) read the block-valued reassignment for a plain name; a `var` took
 * the `reassignState` path, which parsed `switch` as an expression and refused
 * `pine:block` — a refusal that cost every top-level name the block writes. Pine
 * defines the subject-less switch as the ternary chain it spells (no matching arm
 * and no default => `na`), so the rail is equality with that chain written out,
 * trees compared whole, at the top level and inside a branch.
 */
const src = (body) => `//@version=5\nindicator("t")\n${body}\n`
const shapeOf = (out) => JSON.stringify({
  ok: out.ok,
  refusal: out.refusal && out.refusal.guard,
  outputs: (out.outputs || []).map((o) => ({ kind: o.kind, ast: o.ast || null, refusal: o.refusal && o.refusal.guard })),
})
const same = (block, ternary) => {
  const a = translatePine(src(block), { strict: true })
  const b = translatePine(src(ternary), { strict: true })
  expect(b.refusal, 'the written-out form must itself translate').toBe(null)
  expect(b.outputs.length).toBeGreaterThan(0)
  for (const o of b.outputs) expect(o.refusal, JSON.stringify(o.refusal)).toBe(null) // non-vacuity
  expect(shapeOf(a)).toBe(shapeOf(b))
  return a
}

describe('W19-H1 — `var x` / `x := switch` is the ternary it spells', () => {
  it('⭐ top level, with a default arm', () => {
    same([
      'var float x = 0.0',
      'x := switch',
      '    close > open => high',
      '    close < open => low',
      '    => x[1]',
      'plot(x)',
    ].join('\n'), [
      'var float x = 0.0',
      'x := close > open ? high : close < open ? low : x[1]',
      'plot(x)',
    ].join('\n'))
  })

  it('⭐ inside a branch, no default (no arm matched => `na`), the smart-money-breakouts shape', () => {
    same([
      'Long = close > open',
      'Short = close < open',
      'var float tp = na',
      'if Long or Short',
      '    tp := switch',
      '        Long => close + 1',
      '        Short => close - 1',
      'plot(tp, "tp")',
    ].join('\n'), [
      'Long = close > open',
      'Short = close < open',
      'var float tp = na',
      'if Long or Short',
      // the arm reader reads a bare bool arm as `nz(cond)` (H2's `asCondition`)
      '    tp := nz(Long) ? close + 1 : nz(Short) ? close - 1 : na',
      'plot(tp, "tp")',
    ].join('\n'))
  })

  it('⛔ the arms still answer for themselves: a refused arm refuses the name', () => {
    const t = translatePine(src([
      'var float x = 0.0',
      'x := switch',
      '    close > open => ta.vwap(close, false, 1)',
      '    => low',
      'plot(x, "x")',
    ].join('\n')), { strict: true })
    expect(t.ok).toBe(false)
    expect(t.outputs[0].refusal).toBeTruthy()
  })

  it('⛔ a switch WITH a subject on a `var` is not this reader\'s: it refuses as it did', () => {
    const t = translatePine(src([
      'mode = input.string("A", "m", options = ["A", "B"])',
      'var float x = 0.0',
      'x := switch mode',
      '    "A" => high',
      '    => low',
      'plot(x, "x")',
    ].join('\n')), { strict: true })
    expect(t.ok).toBe(false)
    expect(t.outputs[0].refusal.guard).toBe('pine:block')
  })
})
