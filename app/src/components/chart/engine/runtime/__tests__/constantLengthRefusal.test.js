// app/src/components/chart/engine/runtime/__tests__/constantLengthRefusal.test.js
//
// ─── ⛔⛔ "YOUR SCRIPT NEVER DEFINED THIS" — SAID ABOUT A PARAMETER ─────────
//
// A window length and a history offset are sized BEFORE BAR 0: the ring has to
// be allocated before any data arrives, so the number has to be known when the
// formula is built. `foldConstNode` asks the frozen resolver for it, that
// resolver sees only the top-level environment, and a name it cannot find
// raises `pine:undefined` — *"this Pine name was never given a value in the
// pasted script"*. `foldConstNode` then re-throws it verbatim, deliberately:
// "a refusal from the value lane keeps its own name … re-dressing a
// `pine:undefined` as a dynamic offset would send an engineer to build ring
// machinery for a typo."
//
// ⛔ THAT RULE IS RIGHT FOR A TYPO AND WRONG FOR EVERY OTHER CASE ON THE ROW.
// Measured over the committed corpus: **15 scripts** die at `pine:undefined`,
// and the name is almost never undefined —
//
//   `drmEngine(series float src, simple int len, …) => ta.highest(src, len)`
//   `per := autowish ? setper : input.int(…)`  …  `ta.atr(per)`
//   `for i = 0 to 3` … `close[i]`
//
// — a PARAMETER, a REASSIGNED name, a LOOP COUNTER. Each is given a value; none
// is given one the ring can be sized from. Telling the member their script
// never defined `len` is the `dayofweek` defect this engine already records:
// *"it was giving the wrong one of its own two sentences."*
//
// ⭐ WHAT THIS DOES **NOT** DO, and the distinction is the whole point: it does
// not make any of these compile. A parameter's value is known per CALL SITE and
// a loop counter's per ITERATION; serving them is monomorphisation and a
// dynamic ring read, which are capabilities, not sentences. This changes which
// sentence a member reads, and nothing else.
import { describe, it, expect } from 'vitest'

import { buildRuntimeIr } from '../../ast/pineRuntimeFrontend.js'

const BARS = Array.from({ length: 10 }, (_, i) => ({
  t: 1700000000 + i * 86400, o: 100, h: 102 + i, l: 98, c: 100 + i, v: 1000,
}))
const head = '//@version=5\nindicator("t")\n'
const refusalOf = (src) => {
  const b = buildRuntimeIr(src, { bars: BARS, inputs: {} })
  expect(b.ok, 'expected a refusal').toBe(false)
  return b.refusal
}

describe('⛔⛔ a length that is BOUND but not CONSTANT says so', () => {
  it('⭐⭐ a function PARAMETER used as a window length', () => {
    // The `artemis-oscillator-pro` / `machine-learning-moving-average` shape.
    const r = refusalOf(`${head}g(src, len) =>\n    ta.sma(src, len)\nplot(g(close, 5))\n`)
    expect(r.message, 'the member is still being told their script never defined it')
      .not.toContain('never given a value')
    // ⛔ IT NAMES THE NAME AND THE REASON, not just "unsupported".
    expect(r.message).toContain('len')
    expect(r.message).toMatch(/before bar 0|known when/i)
  })

  it('⭐ a REASSIGNED top-level name used as a window length', () => {
    // The `keltner-center-of-gravity-channel` shape: `per := …` then `ta.atr(per)`.
    const r = refusalOf(`${head}n = 5\nn := 6\nplot(ta.sma(close, n))\n`)
    expect(r.message).not.toContain('never given a value')
    expect(r.message).toContain('n')
  })

  it('⭐ a parameter length on a CARRIED function — `ta.ema`, a second site', () => {
    // ⛔⛔ A FIX IS ONLY AS WIDE AS THE LANE IT WAS MEASURED IN — this session's
    // dominant lesson, and it applies inside one function. `foldConstNode` is
    // reached from FIVE call sites: one for the FINITE-WINDOW family (sma, wma,
    // stdev, highest, …) and others for the CARRIED family (ema, rma, rising,
    // …), each with its own noun. `ta.sma` above exercises the first. Threading
    // the scope through that one alone would leave every `ta.ema(src, len)` in
    // the corpus still reading "your script never defined `len`", and every
    // assertion above would stay green while it did.
    const r = refusalOf(`${head}g(src, len) =>
    ta.ema(src, len)
plot(g(close, 5))
`)
    expect(r.message, 'the carried-state site still blames the member')
      .not.toContain('never given a value')
    expect(r.message).toContain('len')
  })

  it('⛔ CONTROL — a typo on the CARRIED path keeps its own sentence', () => {
    const r = refusalOf(`${head}g(src) =>
    ta.ema(src, zzNope)
plot(g(close))
`)
    expect(r.message).toContain('never given a value')
    expect(r.guard).toBe('pine:undefined')
  })

  it('⛔⛔ CONTROL — A REAL TYPO *ON THIS PATH* KEEPS THE REAL SENTENCE', () => {
    // ⭐⭐ THIS IS THE CASE THAT GUARDS THE RULE, and it took a mutation to find
    // out. The obvious control — a typo at the TOP LEVEL — is green whatever
    // this code does, because a top-level length never reaches this fold at
    // all: measured, dropping the scope test entirely left it saying
    // `pine:undefined` exactly as before. It could not distinguish the fix
    // from its absence (`lesson_a_fixture_that_cannot_distinguish_is_not_a_rail`).
    //
    // ⛔ A typo INSIDE A FUNCTION BODY takes the same road as the parameter
    // case above — same lowerer, same `foldConstNode`, same catch — and is the
    // only thing standing between a member with a misspelled name and a
    // sentence about ring machinery. Measured with the scope test removed:
    //
    //     typo in a body   pine:undefined → runtime:history-dynamic-offset
    //
    // which is precisely the defect `foldConstNode`'s re-throw rule exists to
    // prevent, arriving through the branch written to narrow that rule.
    const r = refusalOf(`${head}g(src) =>
    ta.sma(src, zzNope)
plot(g(close))
`)
    expect(r.message, 'a typo on the folding path lost its own sentence')
      .toContain('never given a value')
    expect(r.guard).toBe('pine:undefined')
  })

  it('⛔ CONTROL — a top-level typo keeps it too (a weaker statement)', () => {
    // ⚠️ KEPT, BUT IT IS NOT THE GUARD — see the case above. This asserts a
    // true thing about the product (a top-level typo says so) and is worth
    // holding; it simply cannot fail when this branch is wrong, because the
    // top-level path never reaches the fold this branch lives in.
    const r = refusalOf(`${head}plot(ta.sma(close, zzNope))\n`)
    expect(r.message, 'a typo lost its own sentence').toContain('never given a value')
  })

  it('⛔ CONTROL — a constant length still compiles', () => {
    // ⭐ NON-VACUITY: if everything refused, the cases above would pass for a
    // lane that had simply stopped working.
    const b = buildRuntimeIr(`${head}plot(ta.sma(close, 5))\n`, { bars: BARS, inputs: {} })
    expect(b.ok, b.ok ? '' : `${b.refusal.guard}: ${b.refusal.message}`).toBe(true)
  })

  it('⛔ CONTROL — an INPUT-driven length still compiles, because it folds', () => {
    // An input settles before bar 0, so it IS a constant here — which is
    // exactly the distinction the new sentence draws.
    const b = buildRuntimeIr(`${head}L = input.int(9)\nplot(ta.sma(close, L))\n`,
      { bars: BARS, inputs: {} })
    expect(b.ok, b.ok ? '' : `${b.refusal.guard}: ${b.refusal.message}`).toBe(true)
  })
})
