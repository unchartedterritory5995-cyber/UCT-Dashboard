// 🔴 THE VARIABLES RAIL — `=>`, `:=`, `var`, and the line between them.
//
// ⭐⭐ THE WHOLE FEATURE IS ONE CLAIM AND THIS FILE IS WHERE IT IS TESTED:
// **most of what a screener script spells with a variable is not state.**
//
//     len   = input.int(14)                     a pure alias
//     isHot = ta.rsi(close, len) > 70           a pure alias
//     dir = 0 / if up / dir := 1 / else / -1    a ternary written across lines
//     f(x) => ta.sma(x, 20)                     a pure function
//
// Every one of those is SUBSTITUTION. Inlining them produces a tree the engine
// already evaluates, so none of them needed an engine change — `pine.js` stayed
// a front end onto the existing AST and `astHash` is byte-identical to what the
// same maths typed by hand would produce (asserted below, not asserted about).
//
// ⛔⛔ AND THE OTHER HALF IS THE HALF THAT MATTERS MORE. A real accumulator —
// `var count = 0` … `count := count + 1`, or `x = 0.0` … `x := x[1] + volume` —
// depends on the PREVIOUS BAR, and this engine holds no state. Folding one would
// emit a plausible formula, a plausible read-back, a `non-repainting` badge and a
// scan that is silently wrong. Those refuse BY NAME, at `pine:state`, and the
// cases are taken from REAL published scripts as well as written ones.
//
// ⭐ THE TEST THAT DECIDES IS "DOES THE VALUE CROSS A BAR", NEVER "WHICH TOKEN
// WAS TYPED", and getting that backwards fails in both directions. Judging by
// `:=` refuses `07-rsi.pine`, which is pure. Judging by `var` admits
// `x = 0.0` / `x := x[1] + volume`, which is an accumulator with no `var` in it.
// Both directions are measured here.

import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

import { translatePine } from './pine.js'
import { parseFormula, astHash } from './parse.js'
import { interpret, nodeCount } from './interpret.js'
import { maxLookback } from './lint.js'
import { seriesRefs, DEFAULT_BUDGET } from './budget.js'
import { sentenceFor } from './sentence.js'
import { evaluateFormula, canSaveFormula } from '../../builder/FormulaField.jsx'
import { BUILDER_INPUT_SCOPE } from '../../builder/builderInputs.js'

const HEAD = '//@version=5\nindicator("t")\n'

/** Asymmetric bars — high, low and close all different and none a monotone
 *  function of another, for the same reason `pine.roles.test.js` uses them: on
 *  flat bars a wrong fold and a right one agree. */
const BARS = Array.from({ length: 80 }, (_, i) => {
  const base = 100 + Math.sin(i / 3) * 10 + i * 0.4
  return {
    t: i,
    o: base - 1,
    h: base + 3 + (i % 5),
    l: base - 4 - (i % 3),
    c: base + ((i % 7) - 3) * 0.5,
    v: 1000 + i * 13,
  }
})

const BUDGET = { maxNodes: 512, maxLookback: 500, maxSeriesRefs: 64 }

const run = (src) => {
  const parsed = parseFormula(src)
  expect(parsed.ok, `${src} :: ${parsed.error}`).toBe(true)
  return interpret(parsed.ast, BARS, {}, BUDGET)
}

/** The one formula a script offers, or a loud failure naming its refusal. */
function formulaOf(script) {
  const out = translatePine(script)
  const chosen = out.selected >= 0 ? out.outputs[out.selected] : null
  expect(chosen && chosen.formula,
    out.refusal ? `${out.refusal.guard} @${out.refusal.line}:${out.refusal.column}` : 'no output')
    .toBeTruthy()
  return chosen.formula
}

const refusalOf = (script) => {
  const out = translatePine(script)
  expect(out.ok, `expected a refusal, got ${out.outputs.map((o) => o.formula).join(' | ')}`).toBe(false)
  return out.refusal
}

/** Bars where BOTH are finite, and how many — ⛔ the count is returned so a case
 *  cannot pass on zero comparisons. */
function agree(a, b) {
  let pairs = 0
  let worst = 0
  for (let i = 0; i < a.length; i += 1) {
    if (!Number.isFinite(a[i]) || !Number.isFinite(b[i])) continue
    pairs += 1
    worst = Math.max(worst, Math.abs(a[i] - b[i]))
  }
  return { pairs, worst }
}

// --------------------------------------------------------------------------- //
// 1. the pure alias — the bulk of it, and it is substitution
// --------------------------------------------------------------------------- //

describe('a binding is an alias, and an alias is substitution', () => {
  it('the brief\'s own example translates, and to exactly the hand-typed tree', () => {
    const script = `${HEAD}len   = input.int(14)
myRsi = ta.rsi(close, len)
isHot = myRsi > 70 and volume > ta.sma(volume, 20) * 2
plot(isHot ? 1 : 0)
`
    const formula = formulaOf(script)
    expect(formula).toBe('rsi(close, 14) > 70 && volume > sma(volume, 20) * 2 ? 1 : 0')
    // ⭐ THE HASH, NOT THE TEXT. `compute.fn` IS `astHash`, so this is the claim
    // that a Pine-authored definition and a typed one are the same stored object.
    expect(astHash(parseFormula(formula).ast))
      .toBe(astHash(parseFormula('rsi(close, 14) > 70 && volume > sma(volume, 20) * 2 ? 1 : 0').ast))
  })

  it('a chain of aliases nests, and the numbers match the flattened form', () => {
    const script = `${HEAD}a = ta.sma(close, 10)
b = a - ta.ema(close, 20)
c = b > 0
plot(c ? 1 : 0)
`
    const formula = formulaOf(script)
    const { pairs, worst } = agree(run(formula), run('sma(close, 10) - ema(close, 20) > 0 ? 1 : 0'))
    expect(pairs).toBeGreaterThan(50)
    expect(worst).toBe(0)
  })
})

// --------------------------------------------------------------------------- //
// 2. ⭐⭐ SUBSTITUTION AND THE BUDGET — the question the brief asked, MEASURED
// --------------------------------------------------------------------------- //

describe('what substituting a name TWICE does to the three budgets', () => {
  // ⭐ THE ANSWER IS "LOOKBACK NO, SIZE YES", AND IT IS NOT A GUESS. `lint.js`
  // takes the MAX of an operator's arguments and the SUM only along nesting, so
  // a shared sub-tree costs its lookback ONCE however many times it appears.
  // `nodeCount` and `seriesRefs` are plain counts and multiply.
  const script = `${HEAD}x = ta.sma(close, 50)
plot(x > x[1] ? 1 : 0)
`

  it('a name used twice does NOT double the lookback', () => {
    const formula = formulaOf(script)
    expect(formula).toBe('sma(close, 50) > sma(close, 50)[1] ? 1 : 0')
    const ast = parseFormula(formula).ast
    // `sma(close, 50)` reaches 50; `sma(close, 50)[1]` reaches 51; the `>` takes
    // the MAX of its arms, not the sum — 101 would be the doubling bug.
    expect(maxLookback(ast)).toBe(51)
    expect(maxLookback(parseFormula('sma(close, 50)[1]').ast)).toBe(51)
  })

  it('...it doubles the NODE COUNT, and that is the only budget substitution moves', () => {
    const ast = parseFormula(formulaOf(script)).ast
    const once = parseFormula('sma(close, 50)').ast
    expect(nodeCount(ast)).toBeGreaterThan(2 * nodeCount(once))

    // ⚰️ THIS ALSO ASSERTED `seriesRefs(ast) === 2 * seriesRefs(once)` AND CALLED
    // IT "the real cost", and it was true and it was a real, measured hazard: a
    // script reading five aliases over two bar fields translated cleanly and was
    // then refused by `budget:series` AT THE SAVE DOOR — the worst place to be
    // refused, because the member has already been told it worked.
    //
    // ⭐ IT IS NO LONGER TRUE, AND THE FIX WAS NOT TO THIS FILE. `seriesRefs` now
    // counts DISTINCT reads, which is what its own cap's rationale always meant —
    // eight reads are "the whole pane budget's worth of DATA", and `close` read
    // twice is one column fetched, held and walked. Substitution multiplies
    // MENTIONS; it cannot invent a column. So the hazard this case was written to
    // record is closed, and the case now records the closing.
    expect(seriesRefs(ast)).toBe(seriesRefs(once))
    expect(DEFAULT_BUDGET.maxSeriesRefs).toBe(8)

    // ⛔ AND THE WIDE ALIAS CHAIN THAT USED TO BE REFUSED NOW SAVES. This is the
    // half that makes the paragraph above a measurement rather than a claim: same
    // script, same budget, same cap, and the door says yes.
    const wide = `${HEAD}a = high - low
b = close - open
plot(a + b + a + b + a > 0 ? 1 : 0)
`
    const down = evaluateFormula(formulaOf(wide), BUILDER_INPUT_SCOPE)
    expect(down.ok, `${down.guard}: ${down.error}`).toBe(true)
    expect(seriesRefs(parseFormula(formulaOf(wide)).ast)).toBe(4)
  })
})

// --------------------------------------------------------------------------- //
// 3. `:=` — pure within the bar
// --------------------------------------------------------------------------- //

describe('a reassignment that never crosses a bar is folded, not refused', () => {
  it('an unconditional top-level := is the last value written', () => {
    expect(formulaOf(`${HEAD}x = close
x := ta.sma(close, 5)
plot(x)
`)).toBe('sma(close, 5)')
  })

  it('x := x * 2 reads the binding that was in scope, not itself', () => {
    expect(formulaOf(`${HEAD}x = close
x := x * 2
plot(x)
`)).toBe('close * 2')
  })

  it('a compound assignment is the same thing wearing a plus sign', () => {
    expect(formulaOf(`${HEAD}x = close
x += 1
plot(x)
`)).toBe('close + 1')
  })

  it('...and inside a block, where it is a DIFFERENT code path', () => {
    // ⚠️ THE HARNESS FOUND THIS. `G15` breaks the compound-assignment desugaring
    // inside `foldStatements` and the top-level case above SURVIVED it, because
    // the top level has its own copy. Two paths, two cases.
    expect(formulaOf(`${HEAD}x = close
if close > open
    x += 1
plot(x)
`)).toBe('close > open ? close + 1 : close')
  })

  it('⭐ a conditional reassignment is a ternary, and the NUMBERS say so', () => {
    const folded = formulaOf(`${HEAD}dir = 0
if close > open
    dir := 1
else
    dir := -1
plot(dir)
`)
    expect(folded).toBe('close > open ? 1 : -1')
    const { pairs, worst } = agree(run(folded), run('close > open ? 1 : -1'))
    expect(pairs).toBe(BARS.length)
    expect(worst).toBe(0)
  })

  it('an `if` with no `else` falls through to the value the name already held', () => {
    expect(formulaOf(`${HEAD}v = close
if close > open
    v := high
plot(v)
`)).toBe('close > open ? high : close')
  })

  it('else-if chains nest right, and a later branch cannot win over an earlier one', () => {
    const folded = formulaOf(`${HEAD}s = 0
if close > open
    s := 1
else if close < open
    s := -1
else
    s := 2
plot(s)
`)
    expect(folded).toBe('close > open ? 1 : close < open ? -1 : 2')
    // ⛔ EVALUATED, because "it printed the right string" and "it computes the
    // right column" are different claims and this repo has shipped the first
    // while failing the second.
    const values = run(folded)
    for (let i = 0; i < BARS.length; i += 1) {
      const want = BARS[i].c > BARS[i].o ? 1 : (BARS[i].c < BARS[i].o ? -1 : 2)
      expect(values[i], `bar ${i}`).toBe(want)
    }
  })

  it('a branch-local is used inside the branch and does not escape it', () => {
    expect(formulaOf(`${HEAD}t = close
if close > open
    t2 = high
    t := t2
plot(t)
`)).toBe('close > open ? high : close')
  })

  it('⛔ and a name that ONLY a branch declares does not exist outside it', () => {
    // ⭐⭐ THIS ONE IS A WRONG-ANSWER CASE, NOT A REFUSAL-LOCATION ONE, AND THE
    // MUTATION HARNESS IS WHY IT IS HERE. `G5` deletes the `before.has(name)`
    // test in `foldIfChain`, and the case above SURVIVED it: leaking `t2` changed
    // nothing, because nothing read `t2`. Here both branches declare `g`, so a
    // leak produces `close > open ? high : low` — a plausible column for a name
    // Pine says is undeclared. The assertion had to be about a name read AFTER
    // the block, and the harness is the only thing that said so.
    expect(refusalOf(`${HEAD}t = close
if close > open
    g = high
    t := g
else
    g = low
    t := g
plot(g)
`).guard).toBe('pine:undefined')
  })

  it('a block-valued binding (`v = if …`) is a ternary too', () => {
    expect(formulaOf(`${HEAD}v = if close > open
    high
else
    low
plot(v)
`)).toBe('close > open ? high : low')
  })
})

// --------------------------------------------------------------------------- //
// 4. ⛔⛔ STATE — refused BY NAME, and the refusal is the deliverable
// --------------------------------------------------------------------------- //

describe('a value that survives the bar refuses, and it refuses by name', () => {
  it('var + := — the textbook accumulator', () => {
    const r = refusalOf(`${HEAD}var count = 0
count := count + 1
plot(count)
`)
    expect(r.guard).toBe('pine:state')
  })

  it('⭐ the SAME accumulator with no `var` anywhere still refuses', () => {
    // ⛔ THIS IS THE CASE A `var`-KEYED TEST WOULD WAVE THROUGH, and the fold
    // would have emitted `0 + volume` — a plausible column that is not OBV.
    const r = refusalOf(`${HEAD}x = 0.0
x := x[1] + volume
plot(x)
`)
    expect(r.guard).toBe('pine:state')
    expect(r.line).toBe(4)
  })

  it('...and so does a previous-bar read taken BEFORE the last assignment', () => {
    // ⛔ PINE RECORDS ONE VALUE PER BAR AND IT IS THE ONE THE BAR FINISHES WITH.
    // Here `m[1]` is the previous bar's post-`if` value, and the binding in scope
    // at line 4 is the pre-`if` one — offsetting that would answer with a
    // different number on every bar the branch fired.
    const r = refusalOf(`${HEAD}m = ta.sma(close, 5)
z = m[1]
if close > open
    m := high
plot(z)
`)
    expect(r.guard).toBe('pine:state')
    expect(r.line).toBe(4)
  })

  it('⭐ ...but the SAME read after the last assignment is exact, and is allowed', () => {
    // The guard is not a blanket ban on `[n]` over a reassigned name: once the
    // binding in scope IS the last word on the name, offsetting it and offsetting
    // Pine's recorded series are the same thing.
    expect(formulaOf(`${HEAD}m = ta.sma(close, 5)
if close > open
    m := high
z = m[1]
plot(z)
`)).toBe('(close > open ? high : sma(close, 5))[1]')
  })

  it('a var that is never reassigned is still a bar-0 value, not an alias', () => {
    expect(refusalOf(`${HEAD}var float anchor = close
plot(anchor)
`).guard).toBe('pine:state')
  })

  it('⭐ and it fires on a REAL published script, not only on written ones', () => {
    const DIR = path.resolve(process.cwd(), '../tests/fixtures/pine')
    const src = fs.readFileSync(path.join(DIR, '10-supertrend.pine'), 'utf8')
    const out = translatePine(src)
    const guards = out.outputs.filter((o) => o.refusal).map((o) => o.refusal.guard)
    // `longStopPrev = nz(longStop[1], longStop)` then `longStop := …` — a trailing
    // stop is state by construction, and five of this script's plots say so.
    expect(guards.length).toBeGreaterThan(0)
    expect(new Set(guards)).toEqual(new Set(['pine:state']))
    // ⚠️ AND THE SCRIPT STILL TRANSLATES. Refusing a stateful plot is not the same
    // as refusing the script — the column that is pure is still offered.
    expect(out.ok).toBe(true)
  })
})

// --------------------------------------------------------------------------- //
// 5. ⛔⛔ THE SAFETY NET — a mutation the walker never read
// --------------------------------------------------------------------------- //

describe('a reassignment the fold could not read still makes the name refuse', () => {
  // ⭐ THIS IS THE ONE THAT MAKES LAZY SUBSTITUTION SAFE. `reassignedNames` scans
  // RAW TOKENS before a statement is parsed, the walk records every mutator it
  // folded, and whatever is left over overrules the binding the walk produced.
  // So a construct this module never learned cannot hide a mutation from it.
  const CASES = [
    ['a for loop', `${HEAD}x = close\nfor i = 0 to 3\n    x := x + 1\nplot(x)\n`],
    ['a while loop', `${HEAD}x = close\nwhile x < 10\n    x := x + 1\nplot(x)\n`],
    ['a switch', `${HEAD}x = close\nswitch 1\n    1 =>\n        x := high\nplot(x)\n`],
  ]
  for (const [label, script] of CASES) {
    it(`${label} — the name is opaque even though the walk folded nothing`, () => {
      const r = refusalOf(script)
      expect(['pine:reassign', 'pine:block', 'pine:state']).toContain(r.guard)
    })
  }

  it('⛔ and the CONTROL: the same script with the mutation removed DOES translate', () => {
    // Without this the block above would pass for a translator that refuses
    // everything containing the word `for`.
    expect(formulaOf(`${HEAD}x = close\nfor i = 0 to 3\n    y = 1\nplot(x)\n`)).toBe('close')
  })

  it('the token scan sees a mutation inside a shape the parser never understood', () => {
    // A user-defined-type method body — no branch of this walker reads it, and
    // the raw scan is the only thing that can.
    const r = refusalOf(`${HEAD}x = close
type Foo
    float f
method bump(Foo self) =>
    x := high
plot(x)
`)
    expect(r.guard).toBe('pine:reassign')
  })
})

// --------------------------------------------------------------------------- //
// 6. `f(x) =>` — a pure function is a binding with arguments
// --------------------------------------------------------------------------- //

describe('a single-expression user function is inlined at its call site', () => {
  it('the body substitutes, and the tree is the hand-typed one', () => {
    const formula = formulaOf(`${HEAD}f(x) => ta.sma(x, 20)\nplot(f(close))\n`)
    expect(formula).toBe('sma(close, 20)')
    expect(astHash(parseFormula(formula).ast)).toBe(astHash(parseFormula('sma(close, 20)').ast))
  })

  it('arguments are evaluated in the CALLER\'s scope, so a shadowed name is not captured', () => {
    // The body's `x` is the parameter; the caller's `x` is a different thing, and
    // reading the body's `x` out of the caller's scope would return `low`.
    expect(formulaOf(`${HEAD}f(x) => x * 2
x = low
plot(f(high))
`)).toBe('high * 2')
  })

  it('a call inside a call keeps the frames straight', () => {
    expect(formulaOf(`${HEAD}f(x) => x + 1\nplot(f(f(close)))\n`)).toBe('close + 1 + 1')
  })

  it('⭐ ...and so does a call whose ARGUMENT mentions the caller\'s own parameter', () => {
    // ⚠️ THE HARNESS FOUND THIS ONE TOO. `G11` turns the frame POP into a PEEK,
    // and every case above survived it — a peek and a pop agree until an argument
    // reaches back past the frame it was written in. Here `g`'s argument is
    // `x + 1`, whose `x` belongs to `f`'s frame, so the frame must genuinely come
    // OFF while the argument resolves.
    expect(formulaOf(`${HEAD}g(y) => y * 3
f(x) => g(x + 1)
plot(f(close))
`)).toBe('(close + 1) * 3')
  })

  it('two parameters land in the right positions', () => {
    expect(formulaOf(`${HEAD}f(a, b) => a - b\nplot(f(high, low))\n`)).toBe('high - low')
  })

  it('a multi-statement body that is local bindings plus one value still inlines', () => {
    // ⭐ THE SAME INSIGHT ONE LEVEL DOWN: a function body is also "one expression
    // with names attached". `05-mtf-structure-bias.pine` is written exactly so.
    expect(formulaOf(`${HEAD}f_struct(len) =>
    hh = ta.highest(high, len)
    ll = ta.lowest(low, len)
    hh - ll
plot(f_struct(20))
`)).toBe('highest(high, 20) - lowest(low, 20)')
  })

  it('a folded `if` inside a function body comes out as a ternary', () => {
    expect(formulaOf(`${HEAD}f(x) =>
    v = 0
    if x > 50
        v := 1
    v
plot(f(ta.rsi(close, 14)))
`)).toBe('rsi(close, 14) > 50 ? 1 : 0')
  })

  it('the wrong number of arguments refuses at the script\'s OWN signature', () => {
    const r = refusalOf(`${HEAD}f(a, b) => a - b\nplot(f(close))\n`)
    expect(r.guard).toBe('pine:arity')
    expect(r.message).toContain('this script defines it with 2')
  })

  it('⛔ a function body with a statement this walker cannot read refuses BY NAME', () => {
    expect(refusalOf(`${HEAD}f(x) =>\n    var s = 0\n    s := s + x\n    s\nplot(f(close))\n`).guard)
      .toBe('pine:state')
  })

  it('a function nothing reaches is a NOTE, never a refusal', () => {
    // The module's whole resolution order: an unreadable definition the outputs
    // never touch must not cost a member their script.
    const out = translatePine(`${HEAD}junk(x) =>\n    array.new_float(x)\nplot(ta.sma(close, 5))\n`)
    expect(out.ok).toBe(true)
    expect(out.outputs[0].formula).toBe('sma(close, 5)')
  })
})

// --------------------------------------------------------------------------- //
// 7. the constant fold — a branch the script cannot take is not on the path
// --------------------------------------------------------------------------- //

describe('a branch a constant condition never takes is never resolved', () => {
  it('a string-dispatched source folds to the arm the default selects', () => {
    // ⭐ THIS IS `07-rsi.pine` IN FOUR LINES, and without it the fold would drag
    // `cum`, `accdist` and `nz` — all in arms the default cannot reach — onto the
    // path and refuse a script for code it does not execute.
    expect(formulaOf(`${HEAD}srcIn = input(title="Source", defval="close", options=["open", "close"])
pick(k) =>
    s = 0.0
    if k == "open"
        s := open
    if k == "close"
        s := close
    s
plot(ta.rsi(pick(srcIn), 14))
`)).toBe('rsi(close, 14)')
  })

  it('an input.bool default drops the arm it turns off, `na` and all', () => {
    expect(formulaOf(`${HEAD}show = input.bool(true, "Show")
plot(show ? ta.sma(close, 5) : na)
`)).toBe('sma(close, 5)')
  })

  it('⛔ CONTROL — a condition that is NOT constant resolves both arms and refuses', () => {
    // Without this the case above would pass for a translator that simply never
    // looks at the `no` arm of a ternary.
    expect(refusalOf(`${HEAD}plot(close > open ? ta.sma(close, 5) : na)\n`).guard).toBe('pine:na')
  })

  it('⛔ CONTROL — a string that is NOT part of a constant comparison still refuses', () => {
    expect(refusalOf(`${HEAD}plot(close > 0 ? "up" : "down")\n`).guard).toBe('pine:text-value')
  })

  it('an unread collection literal is a note; a read one is still a refusal', () => {
    // `input(…, options=[…])` is the single most common `[…]` in published Pine
    // and no column ever reads it.
    expect(formulaOf(`${HEAD}n = input(20, "Len", options=[10, 20, 50])\nplot(ta.sma(close, n))\n`))
      .toBe('sma(close, 20)')
    expect(refusalOf(`${HEAD}a = array.new_float(0)\nplot(array.get(a, 0))\n`).guard)
      .toBe('pine:collection')
  })
})

// --------------------------------------------------------------------------- //
// 8. all the way through the SHIPPED doors
// --------------------------------------------------------------------------- //

describe('a variables-heavy script goes through the doors a typed formula goes through', () => {
  const script = `${HEAD}fastLen = input.int(10, "Fast")
slowLen = input.int(30, "Slow")
f_ma(src, len) => ta.ema(src, len)
fast = f_ma(close, fastLen)
slow = f_ma(close, slowLen)
bias = 0
if fast > slow
    bias := 1
plot(bias)
`

  it('parses, budgets, lints, reads back and may be SAVED', () => {
    const formula = formulaOf(script)
    expect(formula).toBe('ema(close, 10) > ema(close, 30) ? 1 : 0')
    const parsed = parseFormula(formula)
    expect(parsed.ok).toBe(true)
    const down = evaluateFormula(formula, BUILDER_INPUT_SCOPE)
    expect(down.ok, `${down.guard} ${down.error}`).toBe(true)
    expect(down.readback).toBe(sentenceFor(parsed.ast, BUILDER_INPUT_SCOPE))
    expect(down.verdict.mode).toBe('non-repainting')
    expect(canSaveFormula(down, false)).toBe(true)
  })

  it('and the saved tree is the one the same maths typed by hand would store', () => {
    expect(astHash(parseFormula(formulaOf(script)).ast))
      .toBe(astHash(parseFormula('ema(close, 10) > ema(close, 30) ? 1 : 0').ast))
  })
})
