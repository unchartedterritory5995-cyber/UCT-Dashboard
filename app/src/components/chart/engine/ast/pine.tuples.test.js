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

// ─── A STATE VARIABLE READING ITS OWN PAST ──────────────────────────────────
//
// ⭐ `entry_signal := cond ? 1 : entry_signal[1]` is the most common `pine:state`
// refusal in the corpus. The ENGINE has taken `self[n]` since the multi-lag
// recurrence landed; only the translator was missing.
//
// ⛔⛔ PINE COUNTS FROM ONE AND THIS ENGINE COUNTS FROM ZERO. Inside `s`'s own
// update, Pine's `s[1]` is the value `s` held on the PREVIOUS BAR — which is
// exactly what the accumulator's `self` already is. `s[1]` is `self`; `s[2]` is
// `self[1]`. An off-by-one here reads one bar too far back on every single bar
// and nothing about the output would look wrong.
describe('a `var` may read its own previous bar inside its own update', () => {
  const state = (update, plot = 's') =>
    one(`${head}var s = 0\ns := ${update}\nplot(${plot})`)

  it('🔴 `s[1]` IS `self` — the identical tree to the bare spelling', () => {
    // ⛔ THE OFF-BY-ONE, ASSERTED AS AN EQUALITY rather than by eyeballing a
    // formula. Two spellings of one thing must produce one tree.
    const bare = state('close > open ? 1 : s')
    const indexed = state('close > open ? 1 : s[1]')
    expect(bare.ok && indexed.ok).toBe(true)
    expect(indexed.formula).toBe(bare.formula)
    expect(indexed.formula).toContain(': self,')
  })

  it('`s[2]` is `self[1]` — one further back, not two', () => {
    expect(state('close > open ? 1 : s[2]').formula).toContain(': self[1],')
  })

  it("⭐ the corpus's `exrem` shape translates, both halves of it", () => {
    // `entry_signal := c1 ? 1 : c2 ? -1 : entry_signal[1]` and then
    // `entry_signal != entry_signal[1]` — the second reads the state's past from
    // OUTSIDE the update, which already worked by inlining the whole column.
    const r = one(`${head}var e = 0\ne := close > open ? 1 : close < open ? -1 : e[1]\n`
      + 'plot(e != e[1] ? 1 : 0)')
    expect(r.ok, r.guard).toBe(true)
    expect(r.formula).toContain('accum(')
  })

  it('⛔ a name reassigned LATER still refuses its own `[1]` — order matters', () => {
    // Pine's `x[1]` is the previous bar's LAST assignment. When a read happens
    // before a reassignment further down, offsetting the binding in scope would
    // answer a different question, so it keeps refusing at `pine:state`.
    const r = one(`${head}x = close + open\ny = nz(x[1], x)\nif close > 0\n    x := close\nplot(y)`)
    expect(r.ok).toBe(false)
    expect(r.guard).toBe('pine:state')
  })
})

// ─── ta.dmi — the one BUILTIN tuple in the corpus ───────────────────────────
//
// Pine answers `[+DI, -DI, ADX]` and this table declares all three by name, so
// this is an exact mapping rather than a judgement.
describe('`ta.dmi` hands out three legs the table already declares', () => {
  const dmi = (plot, args = '14, 14') =>
    one(`${head}[p, m, a] = ta.dmi(${args})\nplot(${plot})`)

  it('each leg resolves to its own declared function', () => {
    expect(dmi('p').formula).toBe('plusDI(high, low, close, 14)')
    expect(dmi('m').formula).toBe('minusDI(high, low, close, 14)')
    expect(dmi('a').formula).toBe('adx(high, low, close, 14)')
  })

  it('⛔ the three SERIES come from a declared role order, not from the mapper', () => {
    // Filling `high, low, close` inside the destructure refused at
    // `pine:role-order`, correctly — the manifest states what KIND each argument
    // is and never what ROLE it plays. The order is declared in
    // `PINE_CALL_SHAPES` and the read-back says the series out loud.
    expect(dmi('a').formula).toContain('high, low, close')
  })

  it('🔴 MISMATCHED periods REFUSE — no quietly-14/14 ADX', () => {
    // Pine smooths ADX over its SECOND argument while the DI legs use the first;
    // this table's `adx` takes one period for both. Identical decision to
    // `ADX14.20` on the TC2000 side, and the same reason: a member who asked for
    // 14/20 must not be handed a number that is not the indicator they asked for.
    expect(dmi('a', '14, 20').ok).toBe(false)
  })

  it('⭐ two DIFFERENT names that hold the SAME number are accepted', () => {
    // ⚠️ SUPERSEDED THE SAME DAY, AND THE OLD CLAIM IS WORTH KEEPING VISIBLE.
    // This asserted that `ta.dmi(diLen, adxSmooth)` must refuse because proving
    // two names equal "needs a constant folder". It got one: the comparison moved
    // from fold time — where a name is only a name, so the two were compared by
    // SPELLING — to resolve time, where both are values. Corpus script 06 makes
    // exactly this call and now translates.
    const r = one(`${head}a1 = input.int(14)\na2 = input.int(14)\n[p, m, a] = ta.dmi(a1, a2)\nplot(a)`)
    expect(r.ok, r.msg).toBe(true)
    expect(r.formula).toBe('adx(high, low, close, 14)')
  })

  it('🔴 …and two names holding DIFFERENT numbers still refuse', () => {
    // ⛔ The rule did not weaken, it got more precise. What must never happen is
    // a 14/20 request quietly answered with a 14/14 ADX.
    const r = one(`${head}a1 = input.int(14)\na2 = input.int(20)\n[p, m, a] = ta.dmi(a1, a2)\nplot(a)`)
    expect(r.ok).toBe(false)
    expect(r.guard).toBe('pine:tuple')
  })

  it('a destructure of some OTHER builtin is untouched', () => {
    expect(one(`${head}[a, b] = request.security(syminfo.tickerid, "D", [close, open])\nplot(a)`).ok)
      .toBe(false)
  })
})

// ─── a `switch` on a FIXED subject reduces to its one live arm ──────────────
//
// ⭐ Published indicators lean on this hard: `f_smooth(x, len, mode)` with `mode`
// an `input.string("EMA", …)` is a menu a member picks once, not a branch that
// moves bar to bar. Every arm but the chosen one is dead the moment it folds.
describe('a switch on a fixed subject picks exactly one arm', () => {
  const fn = 'f(x, len, mode) =>\n    switch mode\n'
    + '        "SMA" => ta.sma(x, len)\n'
    + '        "RMA" => ta.rma(x, len)\n'
    + '        =>       ta.ema(x, len)\n'
  const pick = (subject) =>
    one(`${head}${fn}m = input.string(${subject})\nplot(f(close, 10, m))`)

  it('🔴 a NAMED arm is chosen by its own label — not the first, not the default', () => {
    // ⛔ THE ASSERTION THE MUTATION HARNESS ASKED FOR. An implementation that
    // always took the default passed every other test here; two different named
    // labels landing on two different functions is what catches it.
    expect(pick('"SMA"').formula).toBe('sma(close, 10)')
    expect(pick('"RMA"').formula).toBe('rma(close, 10)')
  })

  it('a subject matching NO arm falls to the default', () => {
    // `"EMA"` is not a label in that switch — the corpus's ADX script relies on
    // exactly this, and it is why 06 reduces to `ema`.
    expect(pick('"EMA"').formula).toBe('ema(close, 10)')
  })

  it('a written literal subject works the same as an input', () => {
    expect(one(`${head}${fn}plot(f(close, 10, "SMA"))`).formula).toBe('sma(close, 10)')
  })

  it('🔴 a subject that MOVES bar to bar still refuses', () => {
    // ⛔ The basis for reducing at all is that the branch is fixed. If the subject
    // can change per bar then every arm would have to exist at once — a menu, not
    // a column — and `pine:block` is the honest answer.
    const r = one(`${head}${fn}plot(f(close, 10, close > open ? "SMA" : "RMA"))`)
    expect(r.ok).toBe(false)
    expect(r.guard).toBe('pine:block')
  })

  it('⛔ `for` and `while` are untouched — this closed ONE shape, not the guard', () => {
    for (const body of ['for i = 0 to 3\n        x := x + 1', 'while close > 0\n        x := 1']) {
      const r = one(`${head}g() =>\n    x = 0\n    ${body}\n    x\nplot(g())`)
      expect(r.ok, body).toBe(false)
    }
  })
})
