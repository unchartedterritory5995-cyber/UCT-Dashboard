// app/src/components/chart/engine/ast/pine.windowAdvice.test.js
//
// ─── 🔴 A REFUSAL'S ADVICE IS A CLAIM ABOUT A NUMBER, AND IT WAS A SECOND
//     AUTHORITY OVER ONE THE MANIFEST ALREADY DECLARES ─────────────────────────
//
// `fractionalWindowAdvice` told every member whose length reduced to a fraction:
// *"Write `round(…)` if that is the length you mean."* One name, no alternative,
// no mention that the choice changes the indicator.
//
// ⛔ AND FOR THE ONE SHAPE THIS ENGINE HAS A DECLARED CONVENTION FOR, THAT NAME
// IS THE WRONG ONE. `closedTable.json::_functions_hull` states Hull's half-window
// as `floor(n / 2)`, and both lanes implement it. A member hand-expanding
// `ta.hma(close, 55)` and following the advice wrote `round(55 * 1/2)` = 28 where
// the declared `hma` uses 27 — a different column, under the member's own title,
// with nothing on the chart announcing the substitution.
//
// ⭐ THE POINT OF THIS FILE IS THAT THE DISAGREEMENT IS MEASURED, NOT ASSERTED.
// A test that only read the advice STRING would pin the words and still let the
// words be wrong. So the load-bearing case below computes both expansions through
// the real `interpret` and proves which one IS `hma` — the advice is checked
// against arithmetic, which is the only thing that cannot drift.
//
// ⛔ THE FIX WAS NOT TO SWAP ONE NAME FOR THE OTHER. No TradingView-hosted page
// states a rounding for `ta.sma`'s length, so PICKING one here would be the same
// defect pointing the other way. What the sentence owes a member is both
// spellings, both values, and — where this engine has a declared convention for
// the shape they are writing — which way its own entry goes.

import { describe, it, expect } from 'vitest'

import { translatePine } from './pine.js'
import { parseFormula, TABLE } from './parse.js'
import { interpret } from './interpret.js'

const refusalFor = (src) => {
  const out = translatePine(`//@version=5\nindicator("t")\n${src}\n`)
  return out.refusal || (out.outputs || []).map((o) => o.refusal).find(Boolean) || null
}

/** A deterministic series with real curvature, so two nearby windows differ. */
const CLOSES = Array.from({ length: 200 }, (_, i) => 100 + Math.sin(i / 9) * 12 + (i % 11) * 0.4)
const BARS = CLOSES.map((c, i) => ({ t: 20260101 + i, o: c, h: c, l: c, c, v: 1000 }))
const col = (src) => interpret(parseFormula(src).ast, BARS)

const maxAbsDiff = (a, b) => {
  let worst = 0
  let compared = 0
  for (let i = 0; i < a.length; i += 1) {
    if (!Number.isFinite(a[i]) || !Number.isFinite(b[i])) continue
    worst = Math.max(worst, Math.abs(a[i] - b[i]))
    compared += 1
  }
  return { worst, compared }
}

describe('🔴 the half-window the advice names is the one the manifest declares', () => {
  it('⭐⭐ MEASURED: `hma(close, 55)` IS the floor-27 expansion and is NOT the round-28 one', () => {
    // ⛔ THIS IS THE WHOLE FILE. Both expansions are legal formulas; only one is
    // the declared Hull average, and the difference is large enough for a member
    // to see on a chart.
    const hull = col('hma(close, 55)')
    const floor27 = col('wma(2 * wma(close, 27) - wma(close, 55), 7)')
    const round28 = col('wma(2 * wma(close, 28) - wma(close, 55), 7)')

    const down = maxAbsDiff(hull, floor27)
    const up = maxAbsDiff(hull, round28)

    expect(down.compared, 'bars compared').toBeGreaterThan(100)
    // The downward spelling is `hma`, to the bit.
    expect(down.worst).toBeLessThan(1e-9)
    // ⭐ AND THE CONTROL THAT MAKES THAT MEAN SOMETHING: the upward spelling is a
    // DIFFERENT column. Without this, an engine where both expansions collapsed
    // to the same numbers would pass the assertion above and the advice would be
    // harmless — the assertion only carries weight because this one fails.
    expect(up.worst).toBeGreaterThan(0.1)
  })

  it('⛔ `floor` is NOT declared, so `idiv` is the only downward spelling a member can type', () => {
    // The reason the advice offers `idiv` rather than the mathematically obvious
    // name: advising `floor(…)` would hand a member a formula that refuses.
    expect(Object.keys(TABLE.functions)).not.toContain('floor')
    expect(Object.keys(TABLE.functions)).toContain('idiv')
    expect(Object.keys(TABLE.functions)).toContain('round')
    // …and `idiv(x, 1)` really is the floor for a positive x — the value the
    // advice prints. Derived through the engine, not asserted.
    expect(col('idiv(27.5, 1)')[199]).toBe(27)
  })

  it('⭐ the advice names BOTH whole numbers, with their values, when they differ', () => {
    const r = refusalFor('plot(ta.wma(close, 55 * 1/2))')
    expect(r.guard).toBe('pine:window')
    expect(r.message).toContain('reduces to 27.5')
    // Both spellings, both answers — the member can see that a choice exists.
    expect(r.message).toContain('idiv(55 * 1 / 2, 1)` is 27')
    expect(r.message).toContain('round(55 * 1 / 2)` is 28')
  })

  it('⭐ …and on a HALF-INTEGER it names which way this engine`s own `hma` goes', () => {
    const r = refusalFor('plot(ta.wma(close, 55 * 1/2))')
    expect(r.message).toContain('_functions_hull')
    expect(r.message).toMatch(/DOWNWARD/)
    // ⛔ It points at the declared function rather than at the expansion, because
    // `hma` already ships and re-deriving Hull by hand is how a second copy of one
    // formula enters the repo.
    expect(r.message).toContain('`hma` is already declared')
  })

  it('⛔ CONTROL — a NON-half fraction gets no Hull sentence', () => {
    // `10 / 3` is 3.333: floor and round agree at 3, so there is no choice to
    // describe and nothing about Hull to say. Without this control the Hull
    // paragraph could be appended to every fractional window and the test above
    // would not notice.
    const r = refusalFor('plot(ta.sma(close, 10 / 3))')
    expect(r.guard).toBe('pine:window')
    expect(r.message).toContain('reduces to 3.33')
    expect(r.message).not.toContain('_functions_hull')
    expect(r.message).not.toContain('DOWNWARD')
  })

  it('⛔ CONTROL — a whole-number length is not refused at all, so the advice never fires', () => {
    expect(refusalFor('plot(ta.sma(close, 10 + 4))')).toBe(null)
  })
})
