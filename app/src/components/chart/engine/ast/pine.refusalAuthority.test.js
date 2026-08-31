// app/src/components/chart/engine/ast/pine.refusalAuthority.test.js
//
// ─── 🔴 A TRUE TAIL DOES NOT RESCUE A FALSE PREFIX ───────────────────────────
//
// Both refusals here appended a correct, specific reason to a shared opening
// clause that was FALSE of the case in front of it. A member reads the sentence
// in order, and the first half sent them to the wrong place.
//
//   `barstate.islast`  →  "this Pine built-in names something the engine grammar
//                          does not hold" … and the grammar holds its siblings:
//                          `barstate.isconfirmed` translates to `close`.
//   `atr(h, l, x, 14)` →  "the engine grammar declares a different signature for
//                          that name — … and Pine's own signature takes 1". The
//                          engine grammar declares EXACTLY the four-argument call
//                          the member wrote; `ta.atr(14)` reads back as
//                          `atr(high, low, close, 14)`. The two halves of one
//                          sentence contradicted each other.
//
// ⛔ THE FIRST WAS ALREADY ADJUDICATED IN THIS REPO, IN PROSE, AND SHIPPED ANYWAY.
// `BUILTIN_REQUEST_DEPENDENT`'s docblock reads: "A GENERIC `pine:builtin` HERE
// WOULD BE THE WRONG SENTENCE. 'This engine has no home for that name' is false:
// it has a home for its three siblings." The throw interpolated exactly that
// sentence. A ruling written above the code does not enforce itself.
//
// ⭐ THE AUTHORITY IS THE POINT, not the wording. "The engine grammar" means
// `closedTable.json` — pine.js says so where it refuses to hand-type an answer
// about a declared name. Sent there, a member finds their own call declared and
// nothing to fix. Told it is PINE's signature, they can count the arguments in
// their script and act.
//
// ⚠️ THE LAST CASE IS WHY THIS IS A FIX AND NOT A DELETION. The OTHER arity
// branch — a real mismatch against this table — still opens with the shared
// clause, because there it is true. A blanket strip would pass every assertion
// above it and lose a sentence that was doing its job.

import { describe, it, expect } from 'vitest'
import { translatePine } from './pine.js'

const run = (body) => translatePine(`//@version=5\nindicator("t")\n${body}\n`)
const refusalOf = (body) => {
  const out = run(body)
  expect(out.ok, `${body} was expected to refuse`).toBe(false)
  return String(out.refusal.message || '')
}

describe('a refusal names the authority that actually disagrees', () => {
  it('⭐⭐ a request-dependent built-in is not called unknown — its siblings are held', () => {
    const msg = refusalOf('plot(barstate.islast ? close : open)')
    expect(msg).toMatch(/holds its siblings/i)
    expect(msg).toMatch(/depends on how many bars/i)
    // ⛔ THE CLAUSE THIS FILE EXISTS TO KEEP OUT.
    expect(msg).not.toMatch(/names something the engine grammar does not hold/i)
  })

  it('⛔ …and the sibling really does translate, so "does not hold" was false', () => {
    // Without this the assertion above is a preference about wording. With it,
    // the old prefix is a measurable falsehood.
    const out = run('plot(barstate.isconfirmed ? close : open)')
    expect(out.ok).toBe(true)
    expect(out.outputs[out.selected].formula).toBe('close')
  })

  it('⭐⭐ a Pine-shape arity mismatch blames PINE, not the table that agrees', () => {
    const msg = refusalOf('plot(atr(high, low, sma(close,3), 14))')
    expect(msg).toMatch(/Pine's own signature takes 1/)
    expect(msg).toMatch(/in Pine's shape before mapping it onto the table/)
    expect(msg).not.toMatch(/the engine grammar declares a different signature/i)
  })

  it('⛔ …and the table really does declare that four-argument call', () => {
    // The measurement that makes the old prefix false rather than merely clumsy:
    // the shape the member wrote is the shape the engine reads back.
    const out = run('plot(ta.atr(14))')
    expect(out.ok).toBe(true)
    expect(out.outputs[out.selected].formula).toBe('atr(high, low, close, 14)')
  })

  it('⭐⭐ THE CONTROL — a real table mismatch STILL opens with the shared clause', () => {
    // ⛔ This is what separates a fix from a deletion. `ta.sma(close)` is one
    // argument against a table entry that takes two, so "the engine grammar
    // declares a different signature" is exactly right and must survive.
    const msg = refusalOf('plot(ta.sma(close))')
    expect(msg).toMatch(/the engine grammar declares a different signature/i)
    expect(msg).toMatch(/this table takes 2/i)
  })
})
