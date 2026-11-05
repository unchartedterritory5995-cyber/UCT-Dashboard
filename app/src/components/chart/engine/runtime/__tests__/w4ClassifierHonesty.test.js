// app/src/components/chart/engine/runtime/__tests__/w4ClassifierHonesty.test.js
//
// ─── ⭐⭐ W4 T1 — A REFUSAL NAMES THE REAL WALL ───────────────────────────────
//
// `builtinStateFamily` only LABELS a refusal for the census. Three shapes were
// filed under `runtime:call-undeclared-builtin-state` ("the CLOSED TABLE does not
// declare it") when the wall was somewhere else:
//
//   * the v1–v4 spelling of a request: `security(…)` is `request.security` (W7);
//   * a member of an imported library: `ml.n_rsi(…)` (W8);
//   * a user function the lane held: its own guard is what the member is told.
//
// ⛔ EVERY CASE BELOW ALSO ASSERTS `ok === false`. This task changes WHICH named
// reason a member reads, never whether a script draws: a refusal stays a refusal.
// The sources are written from scratch for this file.

import { describe, it, expect } from 'vitest'

import { buildRuntimeIr } from '../../ast/pineRuntimeFrontend.js'

const N = 40
const BARS = Array.from({ length: N }, (_, i) => ({
  t: 1700000000 + i * 86400, o: 100 + i * 0.1, h: 102 + i * 0.1, l: 98 + i * 0.1, c: 100.5 + i * 0.1, v: 1000 + i,
}))
const LIBS = { 'tester/fx/1': { source: '//@version=5\nlibrary("fx")\nexport mid(float h, float l) => (h + l) / 2\n' } }

const STATE = 'var float x = 0.0\nx := close\n'
const V5 = '//@version=5\nindicator("t")\n'
const V4 = '//@version=4\nstudy("t")\n'
const NOVER = 'study("t")\n'

const run = (src) => buildRuntimeIr(src, { bars: BARS, inputs: {}, libraries: LIBS })
const refusalOf = (src) => {
  const b = run(src)
  expect(b.ok, 'a refusal must stay a refusal').toBe(false)
  return b.refusal
}

describe('A — the v1–v4 spelling of a request is the request wall', () => {
  const CASES = [
    ['v4 `security` over state', `${V4}${STATE}plot(security(syminfo.tickerid, "D", sma(x, 3)))\n`],
    ['no version line (v1) `security`', `${NOVER}${STATE}plot(security(tickerid, "D", sma(x, 3)))\n`],
    ['v4 `security` bound to a name', `${V4}${STATE}y = security(syminfo.tickerid, "D", sma(x, 3))\nplot(y)\n`],
    ['`security_lower_tf` over state', `${V4}${STATE}plot(security_lower_tf(syminfo.tickerid, "1", sma(x, 3)))\n`],
    ['`financial` over state', `${V4}${STATE}plot(financial(syminfo.tickerid, "X", "FQ", sma(x, 3)))\n`],
  ]
  for (const [label, src] of CASES) {
    it(`${label} → runtime:request-with-state`, () => {
      expect(refusalOf(src).guard).toBe('runtime:request-with-state')
    })
  }

  it('the v5 spelling keeps the request wall it always had', () => {
    expect(refusalOf(`${V5}${STATE}plot(request.dividends(x))\n`).guard).toBe('runtime:request-with-state')
  })

  it('⛔ in a v5 script the bare spelling is no Pine function, so `undeclared` stays', () => {
    expect(refusalOf(`${V5}${STATE}plot(security(syminfo.tickerid, "D", sma(x, 3)))\n`).guard)
      .toBe('runtime:call-undeclared-builtin-state')
  })

  it('⛔ a script that DEFINES `security` is calling its own function, not a request', () => {
    const b = run(`${V4}security(a, b) => a + b\n${STATE}plot(security(x, 1))\n`)
    expect(b.ok).toBe(true)
  })

  it('a request the lane serves still builds (nothing newly refused)', () => {
    expect(run(`${V4}plot(security(syminfo.tickerid, "D", close))\n`).ok).toBe(true)
  })
})

describe('B — a library member says it is a library member', () => {
  const IMPORT = 'import tester/fx/1 as ml\n'

  it('`ml.nope(x)`, the library served but exporting no `nope` → runtime:library', () => {
    const r = refusalOf(`${V5}${IMPORT}${STATE}plot(ml.nope(x, 3))\n`)
    expect(r.guard).toBe('runtime:library')
  })

  it('a member the library does export still builds', () => {
    expect(run(`${V5}${IMPORT}${STATE}plot(ml.mid(x, 3))\n`).ok).toBe(true)
  })

  it('⛔ a dotted name whose head is NOT an alias stays `undeclared`', () => {
    expect(refusalOf(`${V5}${IMPORT}${STATE}plot(zz.nope(x, 3))\n`).guard)
      .toBe('runtime:call-undeclared-builtin-state')
  })

  it('⛔ no import line, no library: the same dotted name stays `undeclared`', () => {
    expect(refusalOf(`${V5}${STATE}plot(ml.nope(x, 3))\n`).guard)
      .toBe('runtime:call-undeclared-builtin-state')
  })

  it('⛔ a real missing builtin stays `undeclared`, with or without an import', () => {
    expect(refusalOf(`${V5}${STATE}plot(ta.cog(x, 3))\n`).guard).toBe('runtime:call-undeclared-builtin-state')
    expect(refusalOf(`${V5}${IMPORT}${STATE}plot(ta.cog(x, 3))\n`).guard).toBe('runtime:call-undeclared-builtin-state')
    expect(refusalOf(`${V5}${STATE}plot(foo(x, 3))\n`).guard).toBe('runtime:call-undeclared-builtin-state')
  })
})

describe('C — a user function the lane held answers with its OWN guard', () => {
  // `float[] arr` is a parameter this front end cannot read, so the DEFINITION is
  // held and re-raised at the call. Measured at the census: no step-0 row reached
  // `undeclared` through a held definition (the 13 that did were peel leftovers —
  // the peel had removed the definition), so this pins what already holds.
  const DEF = 'f(float[] arr) =>\n    arr.size() > 0 ? 1.0 : 2.0\nvar float[] a = array.new_float(0)\n' + STATE
  const SHAPES = [
    ['a plot argument', 'plot(f(a))\n'],
    ['a statement of its own', 'f(a)\nplot(x)\n'],
    ['inside a windowed builtin over state', 'plot(ta.sma(f(a) + x, 3))\n'],
    ['bound to a name, then windowed', 'y = f(a)\nplot(ta.ema(y + x, 3))\n'],
    ['a ternary arm', 'plot(x > 100 ? f(a) : 1.0)\n'],
    ['inside a request', 'plot(request.security(syminfo.tickerid, "D", f(a) + x))\n'],
    ['inside another function', 'g(q) =>\n    f(a) + q\nplot(g(x))\n'],
  ]
  for (const [label, tail] of SHAPES) {
    it(`${label} → the definition's runtime:function`, () => {
      const r = refusalOf(`${V5}${DEF}${tail}`)
      expect(r.guard).toBe('runtime:function')
      expect(r.message).toContain('`[`')
    })
  }

  it('⛔ a function that was never defined stays `undeclared` (the call is the only evidence)', () => {
    expect(refusalOf(`${V5}${STATE}plot(g(x))\ng(a) =>\n    a * 2\n`).guard)
      .toBe('runtime:call-undeclared-builtin-state')
  })
})
