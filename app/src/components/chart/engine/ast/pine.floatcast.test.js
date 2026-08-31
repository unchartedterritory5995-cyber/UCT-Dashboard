// app/src/components/chart/engine/ast/pine.floatcast.test.js
//
// ─── ⭐ THE SAFEST OF THE THREE CASTS, AND THE LAST TO SHIP ──────────────────
//
// Pine's three explicit casts land very differently on an engine that holds ONE
// numeric column type:
//
//   bool(x)   changes meaning     → `x != 0`, published verbatim by TradingView
//   int(x)    changes the VALUE   → stays NARROW: the vendor does not publish
//                                   whether a fractional float truncates, rounds
//                                   or floors, so folding it would invent a
//                                   rounding direction
//   float(x)  changes NOTHING     → the identity
//
// ⭐ `float` has no question to answer. Widening an int to a float moves no
// value; a bool is already carried as 0/1, which is what TradingView says
// `float(true)` is; and `float(na)` is `na`, which this door already expands to
// `0 / 0`. That is why it can fold where `int` cannot, and the asymmetry is the
// point of this file — a reader who sees `float` fold and assumes `int` should
// too has the reasoning backwards.
//
// ⚰️ IT WAS DESIGNED, MEASURED AND PARKED. `pine.js` carried the note for weeks:
// "`float(x)` is the identity in an engine with one numeric column type … 
// MEASURED they take `02-ict`'s four `pine:function` output refusals to the
// `pine:state` that is actually blocking them" — held back because the corpus
// snapshot "was outside the lane that wrote this", and recorded in prose rather
// than left half-shipped behind a dead flag. That was the right call and this is
// the other half of it.
//
// ⭐ WHAT SHIPPING IT ACTUALLY BOUGHT IS NOT A COLUMN. 02-ict's four outputs went
// from refusing at a CAST to refusing at their real walls (`pine:state` ×2 at
// line 105, `pine:cycle` ×2 at line 112), and `pine:cycle` left the "no published
// script reaches this guard" census. A refusal nobody reaches is a sentence
// nobody has checked; that is the gain here, and it is worth more than the
// headline count that did not move.

import { describe, it, expect } from 'vitest'
import { translatePine } from './pine.js'

const formulaOf = (out) => {
  expect(out.refusal, out.refusal && out.refusal.message).toBe(null)
  return out.outputs[out.selected].formula
}
const wrap = (body) => translatePine(`//@version=6\nindicator("t")\n${body}\n`)

describe('float(x) is the identity, and int(x) still is not', () => {
  it('⭐ a float cast over a series disappears entirely', () => {
    expect(formulaOf(wrap('plot(float(close))'))).toBe('close')
    expect(formulaOf(wrap('plot(float(close - open))'))).toBe('close - open')
  })

  it('⭐⭐ float(na) is `na`, which this engine already spells `0 / 0`', () => {
    // ⚠️ THE CASE THE CORPUS ACTUALLY USES. `02-ict` writes `var x = float(na)`
    // five times; it is the type-annotated nothing, not a conversion.
    const out = wrap('var float s = float(na)\ns := close\nplot(s)')
    expect(formulaOf(out)).toContain('0 / 0')
  })

  it('⛔⛔ int(x) is NOT folded alongside it, and that asymmetry is deliberate', () => {
    // The whole reason `float` is safe and `int` is not. If this ever goes green
    // somebody has widened `int` on the assumption that the three casts are one
    // family — they are not, and TradingView publishes no rounding direction.
    const out = wrap('plot(int(close))')
    expect(out.refusal).toBeTruthy()
    expect(out.refusal.guard).toBe('pine:function')
    expect(out.refusal.token).toBe('int')
  })

  it('⛔ a member’s OWN float() wins over the fold', () => {
    // Same guard `bool` carries. A script that defines the name means its own
    // function, and shadowing is checked rather than assumed.
    expect(formulaOf(wrap('float(a) => a + 1\nplot(float(close))'))).toBe('close + 1')
  })

  it('⛔ a WRONG ARITY falls through to the ordinary vocabulary sentence', () => {
    // Not a bespoke complaint about `float` — the general refusal names the whole
    // declared vocabulary, which is more use to a member than a note about one cast.
    const out = wrap('plot(float(close, 2))')
    expect(out.refusal).toBeTruthy()
    expect(out.refusal.guard).toBe('pine:function')
  })

  it('⭐ and the real corpus script reaches its ACTUAL walls now', () => {
    // ⛔ THROUGH THE SHIPPED DOOR, and asserting what changed rather than that
    // something changed: the four outputs that stopped at `pine:function` on the
    // cast now carry the guards that are genuinely in their way.
    const fs = require('node:fs')
    const path = require('node:path')
    const src = fs.readFileSync(path.resolve(process.cwd(),
      '../tests/fixtures/pine/02-ict-retracement-to-order-block-screener.pine'), 'utf8')
    expect(src).toMatch(/var prev_high_when_crossover = float\(na\)/)
    const out = translatePine(src)
    const per = {}
    for (const o of out.outputs) if (o.refusal) per[o.refusal.guard] = (per[o.refusal.guard] || 0) + 1
    expect(per).toEqual({ 'pine:state': 2, 'pine:cycle': 2 })
    // …and no output refuses on the cast any more.
    expect(per['pine:function']).toBeUndefined()
  })
})
