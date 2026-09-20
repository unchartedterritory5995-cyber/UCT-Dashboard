// app/src/components/chart/engine/runtime/__tests__/strBuiltins.test.js
//
// ─── THE TEXT OPERATIONS A WATCHLIST IS PARSED WITH ─────────────────────────
//
// ⛔⛔ THESE ARE TEXT **PRODUCERS**, AND THAT IS WHY THEY LIVE HERE RATHER THAN
// IN THE COLUMNAR LANE. `pine.js::PINE_TEXT_PREDICATE` admits exactly four
// `str.*` names — `contains`, `startswith`, `endswith`, `length` — on the
// stated ground that each CONSUMES text and answers with a NUMBER, so nothing
// textual survives the fold. It says in the same breath that a producer "is the
// step that would make text a value". This plan is that step, and it is taken
// in the runtime, where a slot can hold a value. The columnar lane's rule is
// not being relaxed; it is being left exactly as it is.
//
// ⛔ THE ASSERTIONS EXECUTE. Checking only that `buildRuntimeIr(...).ok` is true
// would pass for an implementation that compiles and then computes the wrong
// string — which is the entire risk in `replace_all`. Every case below runs the
// program and reads the plotted number.
import { describe, it, expect } from 'vitest'

import { buildRuntimeIr } from '../../ast/pineRuntimeFrontend.js'
import { lowerIrProgram } from '../lowerIr.js'
import { execute } from '../vm.js'

const N = 8
// ⛔ `close > open` ON EVERY BAR, DELIBERATELY. The `mutated` fixtures below
// drive their assignment off that condition, and `ones()` reads as "the string
// expression held on every bar" only if the branch actually ran. The first
// version of this file had `o === c`, so the condition was false throughout and
// every case passed on the INITIAL value — true by accident, and blind to the
// assignment it was meant to exercise.
const BARS = Array.from({ length: N }, (_, i) => (
  { t: 1700000000 + i * 86400, o: 99 + i, h: 101 + i, l: 98 + i, c: 100 + i, v: 1000 + i }))
const SERIES = ['o', 'h', 'l', 'c', 'v'].map((k) => Float64Array.from(BARS.map((b) => b[k])))
const head = '//@version=6\nindicator("t", overlay = true)\n'

/** Run a script and return output 0 as a plain array. */
function runPine(src) {
  const built = buildRuntimeIr(head + src, { bars: BARS, inputs: {} })
  if (!built.ok) throw new Error(`refused: ${built.refusal.message}`)
  const program = lowerIrProgram(built.ir)
  const { outputs } = execute(program, {
    bars: N, series: SERIES, columns: program.columns, confirmed: true,
  })
  return Array.from(outputs[0])
}

/** Every bar plots 1 — i.e. the string expression held on every bar. */
const ones = () => new Array(N).fill(1)

const refusalOf = (src) => {
  const built = buildRuntimeIr(head + src, { bars: BARS, inputs: {} })
  expect(built.ok, 'expected a refusal, got a program').toBe(false)
  return built.refusal
}

// ⛔ EVERY FIXTURE MUTATES, for the reason `strings.test.js` records at length:
// a pure text subtree is handed to the columnar lane first, so an immutable one
// would not prove the runtime did anything.
//
// ⛔⛔ AND THE INITIAL VALUE IS A SENTINEL THAT MUST FAIL EVERY ASSERTION. `s`
// starts as a string no case below can be satisfied by, so `ones()` is
// reachable ONLY if the assignment ran and the builtin then answered correctly.
// An earlier version passed the same string as both the initial and the
// assigned value, which held whether or not the branch was ever taken — a
// fixture that cannot distinguish is not a rail.
const NEVER = '"!none"'
const mutated = (then, expr) => (
  `string s = ${NEVER}\n`
  + 'if close > open\n'
  + `    s := ${then}\n`
  + `plot(${expr} ? 1 : 0)\n`)

describe('str.* in the runtime lane', () => {
  it('replace_all replaces EVERY occurrence', () => {
    // ⛔ JavaScript's `replace` with a STRING needle replaces only the FIRST.
    // The needle appears three times here precisely so that difference shows:
    // a `replace`-based implementation yields "a;b,c" and fails.
    expect(runPine(mutated('"a,b,c"',
      'str.replace_all(s, ",", ";") == "a;b;c"'))).toEqual(ones())
  })

  it('replace_all treats its needle LITERALLY, not as a regex', () => {
    // ⛔ A regex path gives `BRK.B`'s dot a meaning the member never asked for:
    // `.` would match `K`, yielding "BR--" instead of "BRK-B". Real tickers
    // carry dots, so this is a watchlist bug, not a theoretical one.
    expect(runPine(mutated('"BRK.B"',
      'str.replace_all(s, ".", "-") == "BRK-B"'))).toEqual(ones())
  })

  it('trim removes surrounding whitespace only', () => {
    expect(runPine(mutated('"  AA PL "',
      'str.trim(s) == "AA PL"'))).toEqual(ones())
  })

  it('contains, startswith', () => {
    expect(runPine(mutated('"NASDAQ:AAPL"',
      'str.contains(s, ":")'))).toEqual(ones())
    expect(runPine(mutated('"###note"',
      'str.startswith(s, "###")'))).toEqual(ones())
  })

  it('length, upper, lower', () => {
    expect(runPine(mutated('"AAPL"', 'str.length(s) == 4'))).toEqual(ones())
    expect(runPine(mutated('"aapl"', 'str.upper(s) == "AAPL"'))).toEqual(ones())
    expect(runPine(mutated('"AAPL"', 'str.lower(s) == "aapl"'))).toEqual(ones())
  })

  it('the result is a real string, usable by the next operation', () => {
    // ⭐ Composition is the point: a watchlist parser chains these. If
    // `replace_all` returned something that merely COMPARED equal, this would
    // be where it showed.
    expect(runPine(mutated('"a,b"',
      'str.upper(str.replace_all(s, ",", ";")) == "A;B"'))).toEqual(ones())
  })

  it('a PURE call works too — no mutable value needed', () => {
    // ⚰️ THIS SPLIT WAS REAL AND ARBITRARY. `str.upper(s)` over a mutable `s`
    // ran while `str.upper("aapl")` — identical semantics, no slot — was
    // refused *"the engine grammar does not hold `str.upper`"*, because a pure
    // subtree goes to the columnar lane and that lane does not hold the name.
    // A refusal that is false about its own neighbour is what teaches a reader
    // to distrust every refusal in the file.
    expect(runPine('plot(str.upper("aapl") == "AAPL" ? 1 : 0)\n')).toEqual(ones())
  })

  it('endswith is served, because startswith is', () => {
    // ⭐ Neither acceptance script uses it. It is here because it is the
    // declared pair of `startswith` in `PINE_TEXT_PREDICATE`, and shipping one
    // without the other is the same false-about-its-neighbour refusal.
    expect(runPine(mutated('"a.csv"', 'str.endswith(s, ".csv")'))).toEqual(ones())
  })

  it('a non-string operand is refused BY NAME AND POSITION, at the VM', () => {
    // ⛔ The kind is checked from the entry's own `args` declaration, so there
    // is ONE check site for all eight builtins. "a string was expected" would
    // send a member hunting through a whole watchlist parser; naming the
    // builtin and the argument points at the line.
    expect(() => runPine('plot(str.upper(close) == "A" ? 1 : 0)\n'))
      .toThrow(/`str\.upper` argument 1 takes a string, got number/)
  })

  it('a wrong argument count is refused BY NAME, at build', () => {
    const r = refusalOf(mutated('"y"', 'str.trim(s, "z") == "y"'))
    expect(r.message).toMatch(/`str\.trim` takes 1 argument, given 2/)
  })

  it("a text call's RESULT is text — `+` with a number refuses, it does not coerce", () => {
    // ⛔⛔ THIS IS WHAT MAKES THE FRONT END'S "does this call produce text?"
    // CHECK LOAD-BEARING, and a mutation proof is what found it missing: with
    // that check deleted, every other case in this file stayed green, because
    // `str.upper(s) + "!"` is `a + b` in JavaScript either way. The difference
    // only shows against a NUMBER — `ADD` would silently produce "A1" for an
    // expression Pine calls a type error.
    expect(() => runPine(mutated('"a"', '(str.upper(s) + 1) == "A1"')))
      .toThrow(/concat needs two strings/)
  })

  it('…and through a SLOT the call fed, not just inline', () => {
    // The same question one step later: `string t = str.upper(s)` has to mark
    // `t` as text, or `t + 1` reaches `ADD` with the check intact everywhere
    // else.
    expect(() => runPine(
      'string s = "!none"\n'
      + 'if close > open\n'
      + '    s := "a"\n'
      + 'string t = str.upper(s)\n'
      + 'plot((t + 1) == "A1" ? 1 : 0)\n')).toThrow(/concat needs two strings/)
  })

  it('CONTROL: two text results concatenate normally', () => {
    // Without this, "it throws" above would be satisfied by a `+` that refused
    // everything.
    expect(runPine(mutated('"a"', '(str.upper(s) + "!") == "A!"'))).toEqual(ones())
  })

  it('CONTROL: a str.* this task does not serve is refused BY NAME', () => {
    const r = refusalOf(mutated('"abcd"', 'str.substring(s, 1, 3) == "bc"'))
    expect(r.message).toMatch(/str\.substring/)
  })

  it('CONTROL: str.split is refused BY NAME — it returns a collection', () => {
    const r = refusalOf(mutated('"a,b"', 'str.length(str.split(s, ",")) == 2'))
    expect(r.message).toMatch(/str\.split/)
  })

  it('CONTROL: a numeric script is unaffected', () => {
    expect(runPine('plot(close > open ? 1 : 0)\n')).toEqual(ones())
  })
})
