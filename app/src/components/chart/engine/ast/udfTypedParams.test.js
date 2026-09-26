// app/src/components/chart/engine/ast/udfTypedParams.test.js
//
// ─── TYPED PARAMETERS, READ BY ONE PARSER ───────────────────────────────────
//
// ⚰️ MEASURED 2026-09-19: `f(float a) => a * 2` was refused by the runtime lane
// with "`f` takes 2 arguments, given 1" while the translator read the same
// header correctly. Two parsers for one grammar, and the divergence was
// invisible because each lane's own tests only ever asked its own parser. Every
// user function in both acceptance scripts of the RVOL slice is typed
// (`parseSymbols(string raw, string exch)`, `calcDaily(simple int N)`), so this
// was the first wall the wave hit.
//
// ⛔ THE CONTROL IS NOT OPTIONAL. An untyped header must keep working, or a
// "fix" that dropped parameters entirely would pass every other assertion here.
import { describe, it, expect } from 'vitest'
import { translatePine } from './pine.js'
import { buildRuntimeIr } from './pineRuntimeFrontend.js'

const H = '//@version=6\nindicator("t", overlay = true)\n'
const runtime = (body) => buildRuntimeIr(H + body + '\n')
const host = (body) => translatePine(H + body + '\n', { strict: true })

describe('typed function parameters', () => {
  it('reads an untyped header (control)', () => {
    expect(runtime('f(a) =>\n    a * 2\nplot(f(close))').ok).toBe(true)
  })

  it('reads a typed header in the runtime lane', () => {
    expect(runtime('f(float a) =>\n    a * 2\nplot(f(close))').ok).toBe(true)
  })

  it('reads a qualifier plus a type', () => {
    expect(runtime('f(simple int n) =>\n    n * 2\nplot(f(3))').ok).toBe(true)
  })

  it('reads several typed parameters', () => {
    expect(runtime('f(float a, float b, int n) =>\n    (a + b) * n\nplot(f(close, open, 2))').ok).toBe(true)
  })

  it('binds the parameter by its NAME, not by its type word', () => {
    // ⭐ THE ASSERTION THAT CATCHES "arity fixed, binding wrong": the body reads
    // `a`, so a parser that kept `float` as the first parameter would either
    // refuse the body or bind `a` to the wrong slot.
    const out = runtime('f(float a) =>\n    a * 3\nplot(f(close))')
    expect(out.ok).toBe(true)
    expect(String((out.refusal && out.refusal.message) || '')).not.toMatch(/float/)
  })

  it('still refuses a default value BY NAME, in both lanes', () => {
    const r = runtime('f(float a, int n = 2) =>\n    a * n\nplot(f(close))')
    expect(r.ok).toBe(false)
    expect(r.refusal.message).toMatch(/default value/i)
    expect(host('f(float a, int n = 2) =>\n    a * n\nplot(f(close))').ok).toBe(false)
  })

  it('leaves the translator unchanged on both spellings', () => {
    expect(host('f(a) =>\n    a * 2\nplot(f(close))').ok).toBe(true)
    expect(host('f(float a) =>\n    a * 2\nplot(f(close))').ok).toBe(true)
  })
})
