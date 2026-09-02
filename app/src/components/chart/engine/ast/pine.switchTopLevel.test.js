// app/src/components/chart/engine/ast/pine.switchTopLevel.test.js
//
// ─── ⚰️ `switch` WORKED INSIDE A FUNCTION AND REFUSED WHERE PEOPLE WRITE IT ───
//
// The reducer was built and commented for exactly the member case — "Published
// indicators lean on this hard: `f_smooth(x, len, mode)` with `mode` an
// `input.string("EMA", …)` is a menu a member picks from once" — and it lived
// inside `foldStatements`, whose call sites are all function bodies and `if`
// branches. So the same three lines translated in a `f() =>` body and returned
// `pine:block` one indent level out, which is where a member actually writes
// `ma = switch mode`.
//
// ⛔ `if` WAS GIVEN BOTH DOORS AND `switch` WAS GIVEN ONE. `foldIfChain` is called
// from the function walker AND the top-level walker; the switch reducer was
// called from one of the two. The fix is a shared `switchBinding`, not new
// reduction logic — the arm is still picked at RESOLVE time, by the same code.
//
// ⚠️ AND NO FIXTURE CAUGHT IT because none contained `switch`, which is why one
// is added alongside this file.

import { describe, it, expect } from 'vitest'

import { translatePine } from './pine.js'

const formulaOf = (out) => {
  expect(out.ok, out.ok ? '' : `${out.refusal.guard}@${out.refusal.line}: ${out.refusal.message}`)
    .toBe(true)
  return out.outputs[out.selected].formula
}

/** The member's script, with only the DEFAULT of the input changed. */
const withMode = (mode) => `//@version=6
indicator("s")
mode = input.string("${mode}", "Smoothing", options=["EMA","SMA"])
ma = switch mode
    "EMA" => ta.ema(close, 20)
    "SMA" => ta.sma(close, 20)
plot(close > ma ? 1 : 0)
`

describe('a `switch` bound at the top level', () => {
  it('⭐⭐ picks the arm the member’s input names', () => {
    // ⛔ TWO INPUTS, TWO DIFFERENT COLUMNS. One case would pass against a door
    // that always took the first arm; the whole point of the reducer is that it
    // reads the subject.
    expect(formulaOf(translatePine(withMode('EMA')))).toBe('close > ema(close, 20) ? 1 : 0')
    expect(formulaOf(translatePine(withMode('SMA')))).toBe('close > sma(close, 20) ? 1 : 0')
  })

  it('⭐ the default arm is taken when nothing matches', () => {
    expect(formulaOf(translatePine(`//@version=6
indicator("s")
mode = input.string("OTHER", "Smoothing", options=["EMA","OTHER"])
ma = switch mode
    "EMA" => ta.ema(close, 20)
    => ta.sma(close, 50)
plot(close > ma ? 1 : 0)
`))).toBe('close > sma(close, 50) ? 1 : 0')
  })

  it('⛔ INSIDE a function still works — the older door is untouched', () => {
    expect(formulaOf(translatePine(`//@version=6
indicator("s")
mode = input.string("SMA", "Smoothing", options=["EMA","SMA"])
f() =>
    switch mode
        "EMA" => ta.ema(close, 20)
        "SMA" => ta.sma(close, 20)
plot(close > f() ? 1 : 0)
`))).toBe('close > sma(close, 20) ? 1 : 0')
  })

  it('⛔⛔ a subject that MOVES bar to bar still refuses', () => {
    // ⭐ THE GUARDRAIL THE REDUCER EXISTS BEHIND: "the whole basis for reducing it
    // is that the branch does not move bar to bar. Anything else and every arm
    // would have to exist at once, which is a menu rather than a column."
    // Widening the top-level door must not widen that.
    const out = translatePine(`//@version=6
indicator("s")
ma = switch close > open
    true => ta.ema(close, 20)
    => ta.sma(close, 20)
plot(close > ma ? 1 : 0)
`)
    expect(out.ok).toBe(false)
    expect(out.refusal.guard).toBe('pine:block')
  })

  it('⛔ `x = for` still refuses — the catch-all still catches', () => {
    // ⚠️ NON-VACUITY FOR THE PLACEMENT. The new branch sits AHEAD of the
    // BLOCK_KEYWORDS catch-all; if it had replaced it, every block keyword would
    // now fall through silently.
    const out = translatePine(`//@version=6
indicator("s")
x = for i = 0 to 3
    i
plot(x > 0 ? 1 : 0)
`)
    expect(out.ok).toBe(false)
    expect(out.refusal.guard).toBe('pine:block')
  })
})
