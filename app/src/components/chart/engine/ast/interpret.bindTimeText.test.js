// app/src/components/chart/engine/ast/interpret.bindTimeText.test.js
//
// ─── ⭐⭐ R-K — BIND-TIME TEXT REFUSES BY NAME, NEVER AS "UNKNOWN" ───────────
//
// Owner ruling, 2026-09-12: "interpret:node rejects a type its own message lists
// as legal. That is a defect, not a feature gap — textop evaluates or refuses by
// the Kind-4 rule, never 'unknown'."
//
// ⚰️ WHAT IT COST. T5's pixels found three of `uncharted-volume-v2`'s four
// series absent from the member pane. Every one refused with
//
//   interpret:node — unknown node type "textop" —
//   legal types are num, series, op, call, offset, tf, sym, tf_live,
//                   str, symtext, textop
//
// naming the type inside its own list of accepted types. `lint.js` fixed the
// same sentence-contradicts-the-branch defect one lane over during R-G; the
// evaluator kept it, and the message read like an engine bug to anyone who got
// it.
//
// ⛔ THE POINT IS THE FIELD, NOT THE VERDICT. Both operands of the real script's
// predicate refuse, and they refuse for DIFFERENT reasons: `syminfo.ticker` is
// the string our own store is keyed by and is always resolvable once a binding
// hands one over, while `syminfo.tickerid` needs a witnessed exchange spelling.
// A member told "unknown node type" rewrites a script that is fine; a member
// told which field went unsettled knows it is the binding.
import { describe, it, expect } from 'vitest'
import { interpret, REFUSALS } from './interpret'
import { foldBound, bindingConstants } from './bind'

const BARS = Array.from({ length: 8 }, (_, i) => ({
  t: `2026-09-0${i + 1}`, o: 10 + i, h: 11 + i, l: 9 + i, c: 10 + i, v: 1000 + i,
}))

/** The exact shape T5 measured, 18 times, in v2's three refusing trees. */
const CONTAINS = (field) => ({
  type: 'textop',
  name: 'contains',
  args: [{ type: 'symtext', name: field }, { type: 'str', value: '/' }],
})

function refusalOf(fn) {
  try { fn(); return null } catch (err) { return err }
}

describe('R-K — a bind-time text node that survives the fold', () => {
  it('⛔⛔ refuses under its OWN guard, not as an unknown node type', () => {
    const err = refusalOf(() => interpret(CONTAINS('ticker'), BARS, {}, undefined, undefined, {}))
    expect(err, 'a textop reaching the evaluator must refuse').toBeTruthy()
    expect(err.guard).toBe('interpret:bind-time-text')
    expect(err.guard).not.toBe('interpret:node')
  })

  it('⭐⭐ and NAMES THE FIELD the binding did not settle', () => {
    const err = refusalOf(() => interpret(CONTAINS('tickerid'), BARS, {}, undefined, undefined, {}))
    expect(err.message).toContain('syminfo.tickerid')
    // The two operands are not interchangeable, and the message must not blur them.
    expect(err.message).not.toContain('syminfo.ticker,')
    const other = refusalOf(() => interpret(CONTAINS('ticker'), BARS, {}, undefined, undefined, {}))
    expect(other.message).toContain('syminfo.ticker')
    expect(other.message).not.toContain('syminfo.tickerid')
  })

  it('⛔ the old message is gone — no refusal names a type in its own legal list', () => {
    const err = refusalOf(() => interpret(CONTAINS('ticker'), BARS, {}, undefined, undefined, {}))
    expect(err.message).not.toMatch(/unknown node type/)
    // ⚰️ THE CONTROL FOR THE CONTROL: a type that really is unknown must still
    // say so, or this test would pass just as well against an evaluator that had
    // stopped refusing anything.
    const bogus = refusalOf(() => interpret({ type: 'not_a_type' }, BARS, {}, undefined, undefined, {}))
    expect(bogus.guard).toBe('interpret:node')
    expect(bogus.message).toMatch(/unknown node type/)
  })

  it('⭐ the guard is declared, so the refusal has a sentence a member can read', () => {
    expect(typeof REFUSALS['interpret:bind-time-text']).toBe('string')
    expect(REFUSALS['interpret:bind-time-text'].length).toBeGreaterThan(30)
  })

  it('⭐⭐ AND THE FOLD STILL TAKES PRECEDENCE — the refusal is the SECOND answer', () => {
    // Without this the whole ruling could be satisfied by an evaluator that
    // refuses every text node, including the ones the binding CAN settle. The
    // fold is the first answer and it must still win.
    const consts = bindingConstants({ symbol: { ticker: 'BTC/USD' } })
    const folded = foldBound(CONTAINS('ticker'), consts)
    expect(folded.type).toBe('num')
    expect(folded.value).toBe(1)
    const out = interpret(folded, BARS, {}, undefined, undefined, {})
    expect([...out]).toEqual(Array(BARS.length).fill(1))

    // and the negative case, so `1` is not simply what this node always folds to
    const plain = foldBound(CONTAINS('ticker'), bindingConstants({ symbol: { ticker: 'SPY' } }))
    expect(plain).toEqual({ type: 'num', value: 0 })
  })

  it('⛔ a bare `str` refuses too, and says the fold is what is missing', () => {
    const err = refusalOf(() => interpret({ type: 'str', value: 'x' }, BARS, {}, undefined, undefined, {}))
    expect(err.guard).toBe('interpret:bind-time-text')
    // No `symtext` under it, so there is no field to blame — and the sentence
    // says that rather than naming one.
    expect(err.message).toMatch(/no symbol field to blame/)
  })
})
