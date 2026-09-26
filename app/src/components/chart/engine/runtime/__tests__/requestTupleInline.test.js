// app/src/components/chart/engine/runtime/__tests__/requestTupleInline.test.js
//
// ─── ⭐⭐ A REQUEST THAT CARRIES SEVERAL VALUES, AND A HELPER THAT MAKES THEM ─
//
// The corpus idiom for a multi-symbol dashboard is one request per symbol
// carrying a whole row of metrics, computed by a helper:
//
//     [rv, cg, o, l, pc] = request.security(sym, "1D", calcDaily(lookback))
//
// Two things had to be true for that line, and neither was.
//
// ⛔ THE TUPLE. `admitRequest` could already carry several values — but only
// when they were written INLINE as `[a, b]`. A helper returning them refused
// with "`calcDaily` returns 5 values, so it can only be unpacked by a
// `[a, b] = …` line" — about a line that IS one. The machinery was there; the
// destructuring flag simply never reached the value.
//
// ⛔⛔ THE HELPER. A user function is compiled ONCE, against THIS chart's bars,
// so its columns hold THIS symbol's numbers. Called inside a request they would
// be served under another symbol's heading — which `carriesColumn` refuses, and
// rightly. The body is now lowered AT THE CALL SITE instead, in the caller's
// context, which is what that refusal names as the next step.
import { describe, it, expect } from 'vitest'

import { buildRuntimeIr } from '../../ast/pineRuntimeFrontend.js'

const head = '//@version=6\nindicator("t", overlay = true)\n'
const N = 4
const BARS = Array.from({ length: N }, (_, i) => (
  { t: 1700000000 + i * 86400, o: 99 + i, h: 101 + i, l: 98 + i, c: 100 + i, v: 1000 + i }))

const build = (src) => buildRuntimeIr(head + src, {
  bars: BARS, inputs: {}, newestBarIsForming: false,
})
const why = (r) => (r.ok ? 'OK' : `[${r.refusal.guard}] ${r.refusal.message}`)

describe('⭐⭐ a request can carry a TUPLE from a helper', () => {
  it('a helper returning two values unpacks from a request', () => {
    const r = build('f() =>\n    [close, open]\n'
      + '[a, b] = request.security("AAPL", "1D", f())\n'
      + 'plot(a + b)\n')
    expect(r.ok, why(r)).toBe(true)
  })

  it('⭐ five values, which is what a dashboard row actually is', () => {
    const r = build('f() =>\n    [close, open, high, low, volume]\n'
      + '[a, b, c, d, e] = request.security("AAPL", "1D", f())\n'
      + 'plot(a + b + c + d + e)\n')
    expect(r.ok, why(r)).toBe(true)
    expect(r.ir.requests.length).toBe(1)
    expect(r.ir.requests[0].results).toBe(5)
  })

  it('⛔ an INLINE tuple still works — the older path is not disturbed', () => {
    const r = build('[a, b] = request.security("AAPL", "1D", [close, open])\n'
      + 'plot(a + b)\n')
    expect(r.ok, why(r)).toBe(true)
  })

  it('⛔ a helper used OUTSIDE a destructuring still refuses by name', () => {
    // The permission is scoped to the destructuring, not granted globally: a
    // multi-value call anywhere else pushes values nothing pops.
    const r = build('f() =>\n    [close, open]\n'
      + 'plot(request.security("AAPL", "1D", f()))\n')
    expect(r.ok).toBe(false)
    expect(r.refusal.message).toMatch(/returns 2 values/)
  })
})

describe('⭐⭐ a helper called inside a request is lowered AT THE CALL SITE', () => {
  it('a helper reading the price series no longer carries this chart\'s columns', () => {
    // ⛔ THE CONTROL FOR THE WHOLE FEATURE. Compiled as a shared frame, `f`'s
    // `close` is a COLUMN over this chart's bars, and `carriesColumn` refuses
    // the request. Inlined, it is lowered inside the request where the columnar
    // lane is barred, so it reads the REQUESTED symbol's series.
    const r = build('f() =>\n    close * 2\n'
      + 'plot(request.security("AAPL", "1D", f()))\n')
    expect(r.ok, why(r)).toBe(true)
  })

  it('⭐ the helper\'s ARGUMENT is substituted, not passed in a frame', () => {
    const r = build('f(x) =>\n    x * 2\n'
      + 'plot(request.security("AAPL", "1D", f(close)))\n')
    expect(r.ok, why(r)).toBe(true)
  })

  it('⭐ a helper with several body bindings inlines in order', () => {
    const r = build('f(x) =>\n    a = x * 2\n    b = a + 1\n    b\n'
      + 'plot(request.security("AAPL", "1D", f(close)))\n')
    expect(r.ok, why(r)).toBe(true)
  })

  it('⛔ RECURSION is still refused, by name', () => {
    const r = build('f(x) =>\n    f(x)\n'
      + 'plot(request.security("AAPL", "1D", f(close)))\n')
    expect(r.ok).toBe(false)
    expect(['runtime:recursion', 'runtime:function']).toContain(r.refusal.guard)
  })

  // ⚰️ THIS ASSERTED A REFUSAL UNTIL 2026-09-20, and its reasoning was right
  // about SUBSTITUTION and wrong about the conclusion. "A `var` is state that
  // belongs to a frame; substituting it would make each use its own fresh
  // binding" — true, and that is why the body is no longer SUBSTITUTED. It is
  // LOWERED AS STATEMENTS into the request's own region, where `var` becomes a
  // real persistent slot rather than a macro. The hazard the refusal named is
  // avoided by not doing the thing it warned about, not by refusing the script.
  it('⭐⭐ a `var` body is lowered as STATEMENTS into the request region', () => {
    const r = build('f(x) =>\n    var acc = 0.0\n    acc := acc + x\n    acc\n'
      + 'plot(request.security("AAPL", "1D", f(close)))\n')
    expect(r.ok, why(r)).toBe(true)
    // ⭐ The statements are what shows the body went INTO the region rather than
    // being shared from a frame lowered against this chart's bars.
    expect(r.ir.requests[0].statements.length,
      'nothing was lowered into the region — the body took some other path')
      .toBeGreaterThan(0)
  })

  it('⛔⛔ TWO call sites of one helper do NOT share its `var`', () => {
    // ⛔ Pine's function-local `var` persists PER CALL SITE. Two calls sharing
    // one slot is a wrong number with nothing red anywhere — the exact defect
    // `ir.js`'s SLOT docstring names. Each call site lowers its own copy into
    // its own child scope, so the two accumulate independently.
    const r = build('f(x) =>\n    var acc = 0.0\n    acc := acc + x\n    acc\n'
      + 'a = request.security("AAPL", "1D", f(close))\n'
      + 'b = request.security("MSFT", "1D", f(volume))\n'
      + 'plot(a + b)\n')
    expect(r.ok, why(r)).toBe(true)
    const slots = r.ir.requests.flatMap((q) => (q.statements || [])
      .filter((s) => s.kind === 'declare').map((s) => s.slot))
    expect(new Set(slots).size,
      `both call sites declared into the same slot(s): ${slots.join(',')}`)
      .toBe(slots.length)
  })

  it('⛔ OUTSIDE a request nothing changed — the shared frame is still used', () => {
    const r = build('f(x) =>\n    x * 2\nplot(f(close))\n')
    expect(r.ok, why(r)).toBe(true)
    expect(r.ir.callSites.length, 'the call went through the shared frame')
      .toBeGreaterThan(0)
  })
})
