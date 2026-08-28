// 🔴 THE CONSTANT-FOLDED WINDOW RAIL.
//
// ⭐⭐ WHY THIS FILE EXISTS. `wma(src, len / 2)` with `len = input(20)` is what
// half the published moving-average scripts are made of, and this door refused
// every one of them at `pine:window` — not because the length was unknowable, but
// because NOTHING in this translator folded arithmetic. Measured before the
// change: a WRITTEN literal expression refused identically (`sma(close, 20 / 2)`
// → `pine:window`), so this was never an "input" problem. It was a missing
// constant folder.
//
// ⛔⛔ AND THE DANGEROUS HALF IS A REFUSAL, EVIDENCED. TradingView's operators
// page says verbatim: "when using the division operator with \"int\" operands, if
// the two \"int\" values are not evenly divisible, the result of the division is
// always a number with a fractional value, e.g., 5/2 = 2.5". So `len / 2` with an
// ODD `len` is 10.5 — and no TradingView-hosted page states what `ta.wma` then
// does with a fractional length. Rounding it either way computes a DIFFERENT
// indicator that no chart announces. So the fold declines and the refusal names
// `round(len / 2)` as the fix.
//
// ⭐ THE STRUCTURAL SAFETY PROPERTY: `foldWindow` can only ever hand back an
// exact, non-negative whole number. Everything else — a fraction, a NaN, an
// Infinity, a negative, a series — comes back as the ORIGINAL node and meets the
// same guard, with the same sentence and the same token, that it met before this
// change. The fold can widen what is accepted; it can never round a length.

import { describe, it, expect } from 'vitest'
import { interpret } from './interpret.js'
import { parseFormula, TABLE, isPointwise } from './parse.js'
import { translatePine, constantValueOf, MAX_FOLD_NODES } from './pine.js'

const script = (body) => `//@version=5\nindicator("t")\n${body}\n`

function outcome(body) {
  const out = translatePine(script(body))
  return out.ok
    ? { ok: true, formula: out.outputs[out.selected].formula }
    : { ok: false, ...out.refusal }
}

function formula(body) {
  const o = outcome(body)
  expect(o.ok, `${body} :: ${JSON.stringify(o)}`).toBe(true)
  return o.formula
}

function refusal(body) {
  const o = outcome(body)
  expect(o.ok, `${body} :: expected a refusal, got ${o.formula}`).toBe(false)
  return o
}

const N = 30
const BARS = Array.from({ length: N }, (_, i) => ({
  t: i, o: 100 + i, h: 101 + i, l: 99 + i, c: 100.5 + i, v: 1000 + i,
}))
const BUDGET = { maxNodes: 4096, maxLookback: 500, maxSeriesRefs: 64 }

/** Evaluate a UCT formula through the shipped engine. */
function engineValue(src) {
  const parsed = parseFormula(src)
  expect(parsed.ok, `${src} :: ${parsed.error}`).toBe(true)
  return interpret(parsed.ast, BARS, {}, BUDGET)[0]
}

// --------------------------------------------------------------------------- //
// what the fold buys
// --------------------------------------------------------------------------- //

describe('a window that reduces to a whole number reaches the engine as one', () => {
  it('⭐ A1 — a folded input divided down', () => {
    expect(formula('len = input(20)\nplot(sma(close, len / 2))')).toBe('sma(close, 10)')
  })

  it('⭐ A2 — `round(sqrt(len))`, with the expected value DERIVED, never typed', () => {
    // ⛔ THE EXPECTED NUMBER COMES FROM THE ENGINE, not from this file's
    // arithmetic. `sqrt(20)` is 4.472…, and whether that rounds to 4 is Pine's
    // rounding rule — which the interpreter owns and this test must not restate
    // (`lesson_a_second_authority_over_one_value`).
    const want = engineValue('round(sqrt(20))')
    expect(Number.isInteger(want)).toBe(true)
    expect(formula('len = input(20)\nplot(sma(close, round(sqrt(len))))'))
      .toBe(`sma(close, ${want})`)
  })

  it('⭐ A3 — a WRITTEN literal expression folds too, so this is about constants', () => {
    // Measured before the change: `sma(close, 20 / 2)` refused at `pine:window`
    // exactly like `sma(close, len / 2)` did. If only inputs folded, this stays
    // red and the diagnosis in the header is wrong.
    expect(formula('plot(sma(close, 20 / 2))')).toBe('sma(close, 10)')
    expect(formula('plot(ta.sma(close, 10 + 4))')).toBe('sma(close, 14)')
  })

  it('⭐ A4 — the fixture line verbatim, from community/20-cm-ultimate-ma-mtf', () => {
    // tests/fixtures/pine_community/20-cm-ultimate-ma-mtf.pine:25
    //   hullma = wma(2*wma(src, len/2)-wma(src, len), round(sqrt(len)))
    const want = engineValue('round(sqrt(20))')
    const body = 'len = input(20)\nsrc = close\n'
      + 'plot(wma(2 * wma(src, len / 2) - wma(src, len), round(sqrt(len))))'
    expect(formula(body)).toBe(`wma(2 * wma(close, 10) - wma(close, 20), ${want})`)
  })

  it('⭐ U1 — the unblocker the odd-division refusal NAMES actually works', () => {
    // ⛔ A refusal that names a fix nobody can use is worse than one that names
    // none (`lesson_rail_the_sentence_not_just_the_guard`). C1 below prints
    // "write `round(len / 2)`"; this is the assertion that the advice is true.
    const want = engineValue('round(21 / 2)')
    expect(formula('len = input(21)\nplot(sma(close, round(len / 2)))'))
      .toBe(`sma(close, ${want})`)
    // …and it is 11, not 10 — Pine rounds a half AWAY from zero.
    expect(want).toBe(11)
  })
})

// --------------------------------------------------------------------------- //
// ⛔ THE CONTROLS. Ten of them, and they matter more than the five accepts.
// --------------------------------------------------------------------------- //

describe('and everything that is not exactly a whole number still refuses', () => {
  it('⛔⛔ C1 — ODD DIVISION refuses, and the sentence says 10.5 and names the fix', () => {
    // ⛔⛔ THE MOST IMPORTANT REFUSAL IN THIS CHANGE, and the reason the fold does
    // not simply round. TradingView's operators page (verbatim): "if the two
    // \"int\" values are not evenly divisible, the result of the division is
    // always a number with a fractional value, e.g., 5/2 = 2.5". So this length
    // IS 10.5 in Pine. What `ta.sma` does with a fractional length is stated by
    // NO TradingView-hosted page the investigation could read — only third-party
    // summaries assert "rounded to nearest", and they do not say which way a .5
    // tie goes. Picking a direction here computes a different indicator under the
    // member's title, and no chart announces the substitution.
    const r = refusal('len = input(21)\nplot(sma(close, len / 2))')
    expect(r.guard).toBe('pine:window')
    expect(r.message).toContain('10.5')
    expect(r.message).toContain('round(')
  })

  it('⛔ C2 — a window read off a BAR refuses', () => {
    // THE control for the whole fold. If `constantValueOf` ever accepted a
    // `series`, this is the shape that would go wrong: a length that changes bar
    // to bar, which the repaint linter cannot bound and the engine cannot run.
    expect(refusal('plot(sma(close, round(close)))').guard).toBe('pine:window')
  })

  it('⛔ C3 — an OFFSET is a bar read even over a constant child', () => {
    // `close[1]` names bar i-1. Its index is a constant; the value is not.
    expect(refusal('plot(sma(close, round(close[1])))').guard).toBe('pine:window')
  })

  it('⛔ C4 — Infinity is not a window', () => {
    expect(refusal('len = input(20)\nplot(sma(close, len / 0))').guard).toBe('pine:window')
  })

  it('⛔ C5 — NaN is not a window, and the fold inherits the ENGINE\'s domain rule', () => {
    // JS answers `NaN` for `Math.sqrt(-1)`; Python RAISES. The interpreter
    // deliberately answers NaN in both lanes. Whatever it answers, it is not a
    // number of bars — and this pins that the fold asks the engine rather than
    // asking JavaScript.
    expect(refusal('len = input(20)\nplot(sma(close, sqrt(0 - len)))').guard).toBe('pine:window')
  })

  it('⛔ C6 — a NEGATIVE window refuses at the pine door', () => {
    // `cNum(-20)` mints `u-(num 20)`, not a `num`, so the existing whole-number
    // check declines it — byte-identical to how a WRITTEN `-20` behaves today.
    expect(refusal('len = input(20)\nplot(sma(close, 0 - len))').guard).toBe('pine:window')
  })

  it('⛔ C7 — a per-bar ternary is not a constant', () => {
    expect(refusal('plot(sma(close, close > open ? 10 : 20))').guard).toBe('pine:window')
  })

  it('⛔ C8 — a NON-POINTWISE call never folds, even over constant arguments', () => {
    // `highest(close, 5)` reads a window of bars. If the fold ever admitted it, a
    // rolling maximum would silently become a length.
    expect(refusal('plot(sma(close, highest(close, 5)))').guard).toBe('pine:window')
  })

  it('⛔ C9 — a constant expression past the node ceiling refuses rather than folding', () => {
    // The compute-bomb control. `1 + 1 + … + 1` six hundred times IS a constant
    // and IS a whole number, so a fold with no ceiling would accept it — and a
    // translate-time fold must not be a place to spend unbounded work. Written as
    // an assertion about the CEILING rather than about 600, so raising the
    // ceiling does not silently make this pass for the wrong reason.
    const terms = MAX_FOLD_NODES * 3
    const r = refusal(`plot(sma(close, ${Array(terms).fill('1').join(' + ')}))`)
    expect(r.guard).toBe('pine:window')
    // …and the control that keeps it honest: the SAME shape under the ceiling folds.
    expect(formula(`plot(sma(close, ${Array(5).fill('1').join(' + ')}))`)).toBe('sma(close, 5)')
  })

  it('⛔⛔ C10 — THE SEAM. A folded ZERO passes this door and the ENGINE refuses it', () => {
    // ⭐ `interpret.js::windowLiteral` owns the "at least 1" bound and NAMES it.
    // Restating that bound in pine.js would be a second authority over one value,
    // so `foldWindow` accepts `>= 0` and lets the engine answer — which is
    // byte-identical to what a WRITTEN `sma(close, 0)` does today (measured).
    // ⛔ THIS TEST GOES RED THE DAY SOMEBODY RESTATES THE BOUND HERE.
    expect(formula('len = input(20)\nplot(sma(close, len - 20))')).toBe('sma(close, 0)')

    const parsed = parseFormula('sma(close, 0)')
    expect(parsed.ok).toBe(true)
    let thrown = null
    try { interpret(parsed.ast, BARS, {}, BUDGET) } catch (e) { thrown = e }
    expect(thrown, 'the engine must be the one that refuses a zero window').toBeTruthy()
    expect(thrown.guard).toBe('resolve:window')
    expect(thrown.message).toContain('at least 1')
  })
})

// --------------------------------------------------------------------------- //
// R1-R3 — the derivation rails, which are what stop a second authority
// --------------------------------------------------------------------------- //

/** Every table function a body may call one bar at a time, derived from the
 *  manifest's own window declaration rather than from a list of names. */
const POINTWISE_KEYS = Object.keys(TABLE.functions)
  .filter((k) => isPointwise(TABLE.functions[k]))
  .sort()

const cNumNode = (v) => ({ type: 'num', value: v })
const cCallNode = (name, args) => ({ type: 'call', name, args })

describe('the fold computes what the ENGINE computes, derived', () => {
  it('⛔⛔ R1 — for every pointwise function, the fold agrees with `interpret` or declines', () => {
    // ⭐⭐ THIS IS THE ANTI-SECOND-AUTHORITY RAIL. The fold does not own any
    // arithmetic of its own: it reaches the interpreter's `FN` for calls, and the
    // four arithmetic operators it applies are asserted here against the
    // interpreter evaluating the SAME canonical tree. If anyone ever spells a
    // second `round` — `Math.round`, which rounds a half toward +∞ while Pine
    // rounds it AWAY FROM ZERO — this goes red on the `0 - 2.5` probe.
    //
    // ⚠️ The contract is asymmetric on purpose: where the engine answers a finite
    // number the fold must answer EXACTLY that; where it does not, the fold must
    // answer `null` (fail closed). "Fold anything the engine can compute" would
    // be the wrong contract — a NaN is computable and is not a length.
    const PROBE_1 = ['2', '2.5', '0 - 2.5', '0', '0 - 1', '7']
    const PROBE_2 = [['2', '3'], ['2.5', '2'], ['0 - 7', '2'], ['0', '0'], ['7', '2']]

    const checked = []
    for (const name of POINTWISE_KEYS) {
      const arity = TABLE.functions[name].args.length
      const probes = arity === 1 ? PROBE_1.map((a) => [a]) : PROBE_2
      for (const args of probes) {
        if (args.length !== arity) continue
        const src = `${name}(${args.join(', ')})`
        const parsed = parseFormula(src)
        expect(parsed.ok, `${src} :: ${parsed.error}`).toBe(true)
        const want = interpret(parsed.ast, BARS, {}, BUDGET)[0]
        const got = constantValueOf(parsed.ast)
        if (Number.isFinite(want)) expect(got, src).toBe(want)
        else expect(got, `${src} — a non-finite value must fail closed`).toBe(null)
        checked.push(src)
      }
    }
    // ⛔ THE SIZE OF WHAT WAS READ IS ASSERTED — a loop over an empty key set
    // passes perfectly (`lesson_a_rail_can_be_green_alone_and_red_in_company`).
    expect(POINTWISE_KEYS.length).toBeGreaterThan(10)
    expect(checked.length).toBeGreaterThanOrEqual(POINTWISE_KEYS.length)
  })

  it('⭐ R1b — the `.5` tie is a REAL discriminator, not a probe that cannot fail', () => {
    // `lesson_a_fixture_that_cannot_distinguish_is_not_a_rail`. If the probe set
    // above only ever hit values where `Math.round` and Pine's round agree, R1
    // would pass with the wrong rounding wired in. `-2.5` is where they differ:
    // Pine (and the engine) say -3; `Math.round` says -2.
    expect(engineValue('round(0 - 2.5)')).toBe(-3)
    expect(Math.round(-2.5)).toBe(-2)
    expect(constantValueOf(parseFormula('round(0 - 2.5)').ast)).toBe(-3)
  })

  it('⛔⛔ R2 — the foldable call set EQUALS the derived pointwise set, both directions', () => {
    // ⭐ So the day the manifest declares `floor`, this folds it with no edit
    // here; and a name LEAVING the manifest turns this red instead of leaving the
    // fold holding a name the engine dropped.
    const accepted = []
    for (const name of Object.keys(TABLE.functions)) {
      const spec = TABLE.functions[name]
      const args = (spec.args || []).map(() => cNumNode(2))
      const v = constantValueOf(cCallNode(name, args))
      if (v !== null) accepted.push(name)
    }
    expect(accepted.sort()).toEqual(POINTWISE_KEYS)
  })

  it('⛔ R3 — the fold NEVER changes the guard, token or position of a refusal it declines', () => {
    // ⚠️ CAPTURED FROM THE BUILD BEFORE THE FOLD LANDED, by running each script
    // through `translatePine` and recording the four values. A fold that widened
    // what is accepted is the point; a fold that moved a refusal a member already
    // sees is a regression that no roster count would show.
    const PINNED = [
      ['len = input(21)\nplot(sma(close, len / 2))', 'pine:window', 'len', 4, 17],
      ['plot(sma(close, round(close)))', 'pine:window', 'round', 3, 17],
      ['plot(sma(close, round(close[1])))', 'pine:window', 'round', 3, 17],
      ['len = input(20)\nplot(sma(close, len / 0))', 'pine:window', 'len', 4, 17],
      ['len = input(20)\nplot(sma(close, sqrt(0 - len)))', 'pine:window', 'sqrt', 4, 17],
      ['len = input(20)\nplot(sma(close, 0 - len))', 'pine:window', '0', 4, 17],
      ['plot(sma(close, close > open ? 10 : 20))', 'pine:window', 'close', 3, 17],
      ['plot(sma(close, highest(close, 5)))', 'pine:window', 'highest', 3, 17],
      ['len = input(20)\nplot(sma(close, floor(len / 2)))', 'pine:function', 'floor', 4, 17],
    ]
    const got = PINNED.map(([body]) => {
      const r = refusal(body)
      return [body, r.guard, r.token, r.line, r.column]
    })
    expect(got).toEqual(PINNED)
  })
})

// --------------------------------------------------------------------------- //
// the deliberate asymmetry, on the record
// --------------------------------------------------------------------------- //

describe('the BAR-OFFSET door is NOT folded, and that is a decision', () => {
  it('⛔ `close[20 / 2]` and `close[len / 2]` still refuse at `pine:offset-literal`', () => {
    // ⚠️ THE MIRROR LANE, DECLARED RATHER THAN FORGOTTEN
    // (`lesson_rail_the_mirror_not_just_the_lane`). `pine.js`'s `case 'offset'`
    // has the identical shape — resolve, then require a whole-number `num` — and
    // the identical fold would widen it. It is left alone in THIS change for two
    // reasons worth writing down:
    //
    //   1. It changes a refusal a gate already pins: `pine.offset.test.js` asserts
    //      `close[1 + 1]` refuses, and folding would make it translate. That is a
    //      ruling to make deliberately, not a side effect of a window fix.
    //   2. It makes a DELIBERATELY DEAD guard live. `pine.js`'s `folded.value < 0`
    //      check is documented as unreachable "until anything folds constant
    //      arithmetic", and its subject is `close[-1]` — NEXT BAR, the one
    //      construction the whole non-repainting guarantee rests on being
    //      inexpressible. Waking that guard deserves its own rails.
    //
    // ⛔ SO THIS TEST IS THE RECORD, NOT AN ENDORSEMENT. It goes red the day
    // somebody folds the offset lane, and whoever does that should delete it and
    // write the negative-offset rails in its place.
    expect(refusal('plot(close[20 / 2])').guard).toBe('pine:offset-literal')
    expect(refusal('len = input(20)\nplot(close[len / 2])').guard).toBe('pine:offset-literal')
  })
})
