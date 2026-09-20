// app/src/components/chart/engine/runtime/__tests__/strings.test.js
//
// ─── A STRING REACHES A SLOT, FROM A MEMBER'S OWN SCRIPT ────────────────────
//
// Task 1 made a slot able to HOLD a string. This is the half that puts one
// there from Pine source. Scope is deliberate: a string literal, `+` between
// two strings, and `==` / `!=`. Every other text construct keeps refusing BY
// NAME.
//
// ⛔⛔ EVERY STRING HERE IS MUTATED, AND THAT IS THE WHOLE DESIGN OF THE
// FIXTURE. The first version of this file used `string s = "ab"` and asked only
// whether the build succeeded — and it PASSED before a single line of this
// task was written. Measured with a probe: an immutable string is a PURE
// subtree, so the front end hands the whole comparison to the columnar lane as
// a COLUMN and no string ever reaches the runtime at all (`JSON.stringify(ir)`
// did not contain `"ab"`). A fixture that cannot distinguish is not a rail.
// Only a name the script ASSIGNS gets a slot, so only a mutated string can
// prove a slot carried one.
//
// ⛔ `str.tostring(x, "#")` IS NOT HERE. Vendor measurement M6 answered its
// rounding on 2026-09-19 — half away from zero, identical to `math.round` — so
// it is no longer blocked; it is simply the NEXT plan's scope, and widening a
// task to absorb a newly-unblocked builtin is how a task stops being
// reviewable.
import { describe, it, expect } from 'vitest'

import { buildRuntimeIr } from '../../ast/pineRuntimeFrontend.js'
import { lowerIrProgram } from '../lowerIr.js'
import { execute } from '../vm.js'

const N = 40
const BARS = (() => {
  const out = []
  let p = 100
  for (let i = 0; i < N; i += 1) {
    p += Math.sin(i / 4) * 1.7
    out.push({ t: 1700000000 + i * 86400, o: p - Math.cos(i / 3) * 1.1, h: p + 1, l: p - 1, c: p, v: 1000 + i })
  }
  return out
})()
const C = BARS.map((b) => b.c)
const O = BARS.map((b) => b.o)
const SERIES = ['o', 'h', 'l', 'c', 'v'].map((k) => Float64Array.from(BARS.map((b) => b[k])))

const head = '//@version=6\nindicator("t", overlay = true)\n'

/** Pine source → executed output series, the whole path in one call. */
function runPine(src) {
  const built = buildRuntimeIr(head + src, { bars: BARS, inputs: {} })
  if (!built.ok) throw new Error(`refused: ${built.refusal.message}`)
  const program = lowerIrProgram(built.ir)
  const { outputs } = execute(program, {
    bars: N, series: SERIES, columns: program.columns, confirmed: true,
  })
  return { out: Array.from(outputs[0]), program }
}

const refusalOf = (src) => {
  const built = buildRuntimeIr(head + src, { bars: BARS, inputs: {} })
  expect(built.ok, 'expected a refusal, got a program').toBe(false)
  return built.refusal
}

describe('a string reaches a runtime slot', () => {
  it('a mutated string decides a plotted number', () => {
    const { out } = runPine(
      'string s = "ab"\n'
      + 'if close > open\n'
      + '    s := "cd"\n'
      + 'plot(s == "cd" ? 1 : 0)\n')
    // ⭐ The oracle is written from Pine's semantics, not read back off the
    // program: a plain local resets every bar, so `s` is "cd" exactly on the
    // bars where the condition held.
    expect(out).toEqual(C.map((c, i) => (c > O[i] ? 1 : 0)))
  })

  it('⛔⛔ NON-VACUITY — the string is really in the program, not folded into a column', () => {
    const { program } = runPine(
      'string s = "ab"\n'
      + 'if close > open\n'
      + '    s := "cd"\n'
      + 'plot(s == "cd" ? 1 : 0)\n')
    // If the front end had handed this to the columnar lane, the const pool
    // would hold numbers only and the test above would pass for the wrong
    // reason — which is exactly what the first draft of this file did.
    expect(Array.from(program.consts)).toContain('cd')
    expect(Array.from(program.consts)).toContain('ab')
  })

  it('concatenates two strings', () => {
    const { out } = runPine(
      'string ex = "NASDAQ"\n'
      + 'if close > open\n'
      + '    ex := "NYSE"\n'
      + 'string s = ex + ":" + "AAPL"\n'
      + 'plot(s == "NASDAQ:AAPL" ? 1 : 0)\n')
    expect(out).toEqual(C.map((c, i) => (c > O[i] ? 0 : 1)))
  })

  it('an IMMUTABLE text binding reaches the runtime too', () => {
    // ⛔⛔ THIS CASE EXISTS BECAUSE A MUTATION PROOF FOUND IT MISSING. A name the
    // script never assigns is not given a slot at all — it binds as an
    // expression for the COLUMNAR resolver, which is right for a number and
    // impossible for a string. With only mutated strings under test, deleting
    // the inline-expansion branch left all eight green, and `string ex =
    // "NASDAQ"` is the commonest shape in the watchlist scripts this lane
    // exists to run.
    const { out } = runPine(
      'string ex = "NASDAQ"\n'
      + 'string t = "AAPL"\n'
      + 'if close > open\n'
      + '    t := "MSFT"\n'
      + 'plot((ex + ":" + t) == "NASDAQ:MSFT" ? 1 : 0)\n')
    expect(out).toEqual(C.map((c, i) => (c > O[i] ? 1 : 0)))
  })

  it('compares with !=', () => {
    const { out } = runPine(
      'string s = "ab"\n'
      + 'if close > open\n'
      + '    s := "cd"\n'
      + 'plot(s != "ab" ? 1 : 0)\n')
    expect(out).toEqual(C.map((c, i) => (c > O[i] ? 1 : 0)))
  })

  it('CONTROL: a mutated NUMBER is unaffected', () => {
    const { out } = runPine(
      'float x = 1.0\n'
      + 'if close > open\n'
      + '    x := 2.0\n'
      + 'plot(x)\n')
    expect(out).toEqual(C.map((c, i) => (c > O[i] ? 2 : 1)))
  })

  it('CONTROL: an unsupported text builtin over a mutated value still refuses BY NAME', () => {
    const r = refusalOf(
      'string s = "a,b"\n'
      + 'if close > open\n'
      + '    s := "c,d"\n'
      + 'string t = str.replace_all(s, ",", ";")\n'
      + 'plot(t == "a;b" ? 1 : 0)\n')
    expect(r.message).toMatch(/str\.replace_all/)
  })

  it('a text comparison with NO mutable side still runs', () => {
    // ⛔⛔ PURITY ALONE WOULD SEND THIS TO THE COLUMNAR LANE, which refuses text.
    // Measured: `(close > open ? "a" : "b") == "a"` refused at `pine:text-value`
    // while the same comparison against a mutable variable ran — an arbitrary
    // difference to a member, and an ordinary dashboard shape.
    const { out } = runPine('plot((close > open ? "up" : "dn") == "up" ? 1 : 0)\n')
    expect(out).toEqual(C.map((c, i) => (c > O[i] ? 1 : 0)))
  })

  it('CONTROL: string ORDERING is refused BY NAME, not given a JS answer', () => {
    // ⛔ This is the control that makes widening the route safe. Once a text
    // subtree reaches the runtime, `>` would lower to `GT` and JavaScript would
    // answer it lexicographically — an answer Pine never gives, arrived at in
    // silence. Pine compares strings with `==` and `!=` and nothing else.
    const r = refusalOf('plot("a" > "b" ? 1 : 0)\n')
    expect(r.message).toMatch(/`>` over text/)
  })

  it('CONTROL: text as a `?:` CONDITION is refused, not answered', () => {
    // ⛔⛔ FOUND BY PROBING, NOT BY REVIEW. `interpret`'s TERNARY is
    // `isNan(t) ? NaN : (t !== 0 ? a : b)` — `Number.isNaN('a')` is false and
    // `'a' !== 0` is true, so the moment text could reach the runtime this
    // compiled and plotted 1, for a script Pine does not accept at all.
    const r = refusalOf('plot("a" ? 1 : 2)\n')
    expect(r.message).toMatch(/text used as a condition/)
  })

  it('CONTROL: text inside a CALL still belongs to the columnar lane', () => {
    // ⛔ `touchesText` deliberately does not descend into a call. `str.length`
    // resolves in the columnar lane today and answers correctly; pulling it into
    // the runtime would refuse a script that currently works.
    const built = buildRuntimeIr(`${head}plot(str.length("abc"))\n`, { bars: BARS, inputs: {} })
    expect(built.ok, built.refusal && built.refusal.message).toBe(true)
  })

  it("CONTROL: a builtin handed text keeps the COLUMNAR lane's own refusal", () => {
    // ⛔⛔ THIS IS THE CASE THAT MAKES THE CALL-EXCLUSION LOAD-BEARING, and it
    // was missing: a mutation that made `touchesText` descend into calls left
    // every test in this file green and was caught only by a rail in another
    // one. `ta.sma("ab", 5)` DOES make the columnar lane raise `pine:text-value`
    // — so without the exclusion it falls through to the runtime, which has no
    // better answer for it and reports a worse-named one. A refusal belongs to
    // the lane that can actually explain it.
    const r = refusalOf('plot(ta.sma("ab", 5))\n')
    expect(r.guard).toBe('pine:text-value')
  })

  it('CONTROL: a string cannot become a plotted value — refused BY NAME, at build', () => {
    // Pine would not type-check this either. The point is that ours says so
    // with a line, rather than throwing out of the VM a bar into the run.
    const r = refusalOf(
      'string s = "ab"\n'
      + 'if close > open\n'
      + '    s := "cd"\n'
      + 'plot(s)\n')
    expect(r.message).toMatch(/text/)
    expect(r.line).toBe(6)
  })

  it('CONTROL: `+` across a string and a number refuses rather than coercing', () => {
    // ⛔ Pine's `+` on a string and a number is a TYPE ERROR, not an implicit
    // conversion. Accepting it would take a script TradingView rejects and then
    // disagree with TradingView about the answer.
    expect(() => runPine(
      'string s = "ab"\n'
      + 'if close > open\n'
      + '    s := "cd"\n'
      + 'string t = s + close\n'
      + 'plot(t == "ab" ? 1 : 0)\n')).toThrow()
  })
})
