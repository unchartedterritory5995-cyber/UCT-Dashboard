// ⭐⭐ TUPLE RETURNS — the last structural gap between a pasted script and this
// engine, and the one that had to be built carefully rather than quickly.
//
// User-defined functions already inlined (multi-statement bodies and locals
// included), so all a tuple needed was somewhere to put its parts and a way to
// hand them out by position.
//
// ⛔⛔ THE DANGER IS NOT "IT DOES NOT WORK" — IT IS "IT WORKS ON THE WRONG THING".
// 42 of the 63 destructures in the corpus bind `request.security`. Handing its
// FIRST element to a name expecting its third produces a formula that parses,
// lints, saves, scans and is silently wrong. Every test below that refuses is
// worth more than every test that translates.

import { describe, it, expect } from 'vitest'
import { translatePine } from './pine.js'

const head = '//@version=5\nindicator("t")\n'
const one = (src) => {
  const r = translatePine(src)
  const out = (r.outputs || [])[0] || {}
  return {
    ok: !!r.ok,
    formula: out.formula || null,
    guard: (out.refusal || r.refusal || {}).guard || null,
  }
}

describe('a tuple-returning user function hands out its parts by position', () => {
  const twoPart = `${head}c(p) =>\n    a = p * 2\n    [a, a + 1]\n`

  it('the FIRST name is element 0', () => {
    expect(one(`${twoPart}[q, r] = c(close)\nplot(q)`).formula).toBe('close * 2')
  })

  it('🔴 the SECOND name is element 1 — not element 0 again', () => {
    // ⛔ The assertion that catches the obvious wrong implementation. A version
    // that resolved every name to the first part would pass the test above.
    expect(one(`${twoPart}[q, r] = c(close)\nplot(r)`).formula).toBe('close * 2 + 1')
  })

  it('a third element is reachable too, at its own index', () => {
    const three = `${head}k(x) =>\n    [x, x * 2, x * 3]\n[a, b, c] = k(close)\n`
    expect(one(`${three}plot(c)`).formula).toBe('close * 3')
    expect(one(`${three}plot(b)`).formula).toBe('close * 2')
  })

  it('both parts can appear in one expression, each inlined with its own call', () => {
    expect(one(`${twoPart}[q, r] = c(close)\nplot(q + r)`).ok).toBe(true)
  })

  it('a part may itself be a call the table declares', () => {
    const src = `${head}c(p) =>\n    [ta.sma(p, 10), p]\n[m, n] = c(close)\nplot(m)`
    expect(one(src).formula).toBe('sma(close, 10)')
  })

  it('the argument reaches the part — a part is not evaluated in the wrong scope', () => {
    // `f(high)` and `f(low)` must differ, or the frame is being read from
    // somewhere other than the call site.
    const f = `${head}f(x) =>\n    [x * 2, x]\n`
    expect(one(`${f}[a, b] = f(high)\nplot(a)`).formula).toBe('high * 2')
    expect(one(`${f}[a, b] = f(low)\nplot(a)`).formula).toBe('low * 2')
  })
})

describe('what a tuple destructure still refuses, and why that matters more', () => {
  it('🔴🔴 `request.security` REFUSES — 42 of 63 destructures in the corpus', () => {
    // ⛔ THE SAFETY OF THIS WHOLE FEATURE. Without the `kind === 'tuple'` check
    // this binds `a` to the first element of a call this engine cannot evaluate
    // at all, and the result parses and saves.
    const r = one(`${head}[a, b] = request.security(syminfo.tickerid, "D", [close, open])\nplot(a)`)
    expect(r.ok).toBe(false)
    expect(r.guard).toBe('pine:tuple')
  })

  it('a one-element `[x]` is not a tuple', () => {
    // Pine does not write a 1-tuple; treating `[x]` as one would give a
    // destructure a shape the member never authored.
    expect(one(`${head}c(p) =>\n    [p * 2]\n[q] = c(close)\nplot(q)`).ok).toBe(false)
  })

  it('🔴 a user function returning a SCALAR refuses — it has no parts to hand out', () => {
    // ⛔ THIS is what the `kind === 'tuple'` check actually protects, and the
    // mutation harness proved it: `request.security` is safe for a DIFFERENT
    // reason (it is a builtin, so it is not in `env` as a user function at all),
    // so a test aimed only at that one left this arm unmeasured.
    const r = one(`${head}f(x) =>
    x * 2
[a, b] = f(close)
plot(a)`)
    expect(r.ok).toBe(false)
    expect(r.guard).toBe('pine:tuple')
  })

  it('a destructure of something that is not a function refuses', () => {
    expect(one(`${head}x = close\n[a, b] = x\nplot(a)`).ok).toBe(false)
  })

  it('MORE names than the function returns refuses rather than binding undefined', () => {
    const src = `${head}c(p) =>\n    [p, p * 2]\n[a, b, d] = c(close)\nplot(d)`
    expect(one(src).ok).toBe(false)
  })
})
