// app/src/components/chart/engine/ast/pine.arityHints.test.js
//
// ─── ⭐ A COUNT MISMATCH WITH A KNOWN WAY ROUND IT SHOULD SAY SO ──────────────
//
// `ta.change(src)` is declared and `ta.change(src, n)` is not. That was recorded
// in `pine.derived.test.js::TA_VETTED` as "the n-arg form is refused by arity"
// and it was the whole story — until `ta.mom` landed. Pine defines both as
// `source - source[length]`, so the two-argument change now HAS an exact spelling
// that translates, and a member hitting the wall should be told it.
//
// ⛔⛔ AND A HINT IS A PROMISE ABOUT A RUN. A refusal that names a way forward
// which does not itself translate is worse than the bare count: it sends the
// member somewhere else to fail, and nothing goes red. So this file does not
// check the WORDING — it takes the spelling the message names and runs it.

import { describe, it, expect } from 'vitest'

import { translatePine } from './pine.js'

const screen = (body) =>
  translatePine(`//@version=6\nindicator("s")\nplot(${body} ? 1 : 0)\n`)

describe('the arity hint', () => {
  it('⭐ `ta.change(src, n)` refuses and names `ta.mom`', () => {
    const out = screen('ta.change(close, 5) > 0')
    expect(out.ok).toBe(false)
    expect(out.refusal.guard).toBe('pine:arity')
    expect(out.refusal.message).toMatch(/TO UNBLOCK/)
    expect(out.refusal.message).toContain('ta.mom(source, length)')
  })

  it('⭐⭐ and the spelling it names actually TRANSLATES — the promise, run', () => {
    // ⚠️ NOT A STRING COMPARISON. The message says `ta.mom(source, length)` is
    // "the same difference, `source - source[length]`"; both halves are checked
    // by translating it and reading the formula, so a hint that rotted into
    // advice about something this door no longer takes goes red here.
    const out = screen('ta.mom(close, 5) > 0')
    expect(out.ok, out.ok ? '' : out.refusal.message).toBe(true)
    expect(out.outputs[out.selected].formula).toBe('close - close[5] > 0 ? 1 : 0')
  })

  it('⛔ a name with NO exact alternative gets no hint', () => {
    // ⭐ THE NON-VACUITY HALF. Without it the first case would pass against a
    // door that appended the same sentence to every arity refusal, which would
    // send members writing `ta.rsi(close)` to a momentum function.
    const out = screen('ta.rsi(close) > 0')
    expect(out.ok).toBe(false)
    expect(out.refusal.guard).toBe('pine:arity')
    expect(out.refusal.message).not.toMatch(/TO UNBLOCK/)
    expect(out.refusal.message).not.toContain('ta.mom')
  })

  it('⛔ the one-argument `ta.change` is untouched', () => {
    const out = screen('ta.change(close) > 0')
    expect(out.ok).toBe(true)
    expect(out.outputs[out.selected].formula).toBe('change(close) > 0 ? 1 : 0')
  })
})
