// 🔴 THE NAMED-ARGUMENT RAIL.
//
// ⭐⭐ WHY THIS FILE EXISTS. `ta.sma(source = close, length = 20)` is ordinary
// Pine and this door refused every named argument outright, with one blanket
// loop that fired before a single argument had been looked at. The refusal was
// SAFE and it was too wide: it also refused the one mapping the corpus and
// TradingView's own docs both spell out.
//
// ⛔⛔ AND THE FAIL-CLOSED PROPERTY IS THE WHOLE POINT — IT MUST SURVIVE THIS.
// `closedTable.json` states what KIND each argument is and never what ROLE it
// plays, so matching `source =` onto a position by convention is how a member
// gets somebody else's number. `PINE_CALL_SHAPES`'s header records what that
// costs: `ta.stoch` mapped position-for-position was WRONG BY 126 POINTS of a
// 0-100 oscillator, with a plausible read-back and a green budget.
//
// ⭐ SO THE MECHANISM IS: a named call is turned into the POSITIONAL call it
// means, and then nothing downstream can tell it from one a member typed in
// order. A named argument can therefore never reach a mapping a positional call
// could not reach. The two facts a name needs are DIFFERENT and both must be
// present — a MEASURED ROLE ORDER (`PINE_CALL_SHAPES`) and MEASURED PARAMETER
// NAMES (`PINE_ARG_NAMES`). `ta.stoch` has the first and not the second, so it
// still refuses; that is the single most important assertion on this page.

import { describe, it, expect } from 'vitest'
import { interpret } from './interpret.js'
import { parseFormula, TABLE } from './parse.js'
import { translatePine, PINE_ARG_NAMES, PINE_CALL_SHAPES } from './pine.js'

const wrap = (body) => `//@version=5\nindicator("t")\nplot(${body})\n`

/** The formula a script translates to, or a failure carrying the refusal so a
 *  red test names the guard instead of `undefined`. */
function formula(body) {
  const out = translatePine(wrap(body))
  expect(out.ok, `${body} :: ${JSON.stringify(out.refusal)}`).toBe(true)
  return out.outputs[out.selected].formula
}

function refusal(body) {
  const out = translatePine(wrap(body))
  expect(out.ok, `${body} :: expected a refusal, got ${out.ok && out.outputs[out.selected].formula}`)
    .toBe(false)
  return out.refusal
}

// ⛔ ASYMMETRIC BARS, and for the same reason `pine.roles.test.js` uses them: on
// bars where high, low and close agree, every permutation of an argument list
// computes the same number and a permutation rail passes vacuously.
const N = 40
const BARS = Array.from({ length: N }, (_, i) => {
  const base = 100 + Math.sin(i / 3) * 10 + i * 0.4
  return {
    t: i,
    o: base - 1 + (i % 3),
    h: base + 3 + (i % 5),
    l: base - 4 - (i % 3),
    c: base + ((i % 7) - 3) * 0.5,
    v: 1000 + i * 13,
  }
})
const BUDGET = { maxNodes: 512, maxLookback: 500, maxSeriesRefs: 64 }

function values(src) {
  const parsed = parseFormula(src)
  expect(parsed.ok, `${src} :: ${parsed.error}`).toBe(true)
  return interpret(parsed.ast, BARS, {}, BUDGET)
}

// --------------------------------------------------------------------------- //
// what a declared mapping buys
// --------------------------------------------------------------------------- //

describe('a named argument this door has MEASURED names for', () => {
  it('⭐ translates to exactly the tree the positional call gives', () => {
    // ⚠️ THE POSITIONAL FORM IS THE ORACLE, not a hand-typed expectation string.
    // A test that only asserted `sma(close, 20)` would still pass if BOTH forms
    // drifted; comparing them pins that the named path is a de-sugaring and
    // nothing else.
    expect(formula('ta.sma(source = close, length = 20)')).toBe(formula('ta.sma(close, 20)'))
    expect(formula('ta.ema(source = close, length = 9)')).toBe(formula('ta.ema(close, 9)'))
    expect(formula('ta.wma(source = close, length = 5)')).toBe(formula('ta.wma(close, 5)'))
    expect(formula('ta.rsi(source = close, length = 14)')).toBe(formula('ta.rsi(close, 14)'))
  })

  it('⭐ the fixture line that motivated this — community/26 — reads its own arguments', () => {
    // tests/fixtures/pine_community/26-spy-to-es-qqq-to-nq.pine:47
    //   line_pt1 = ta.sma(source = (opening_strike * Diff), length = input_smoothing)
    // reduced here to the shape, with the input folded the way that door folds it.
    const src = '//@version=5\nindicator("t")\n'
      + 'n = input(9)\n'
      + 'plot(ta.sma(source = (close * 2), length = n))\n'
    const out = translatePine(src)
    expect(out.ok, JSON.stringify(out.refusal)).toBe(true)
    expect(out.outputs[out.selected].formula).toBe('sma(close * 2, 9)')
  })

  it('reordered arguments are accepted, because Pine accepts them when ALL are named', () => {
    // https://www.tradingview.com/pine-script-docs/language/built-ins/ verbatim:
    // "You can change the position of arguments when using keyword arguments,
    //  but only if you use them for all your arguments".
    expect(formula('ta.sma(length = 20, source = close)')).toBe(formula('ta.sma(close, 20)'))
  })

  it('a positional PREFIX followed by named arguments is accepted, as Pine allows', () => {
    // Same page: "you can also forego keyword arguments for the first arguments,
    // as long as you don't skip any."
    expect(formula('ta.sma(close, length = 20)')).toBe(formula('ta.sma(close, 20)'))
  })
})

// --------------------------------------------------------------------------- //
// ⛔ THE CONTROLS. These matter more than the accepts.
// --------------------------------------------------------------------------- //

describe('and everything the mapping was NOT measured for still refuses, by name', () => {
  it('⛔⛔ `ta.stoch` named STILL refuses — a role order and parameter NAMES are different facts', () => {
    // ⛔⛔ THE MOST IMPORTANT ASSERTION IN THIS CHANGE. `PINE_CALL_SHAPES` holds a
    // MEASURED permutation for `ta.stoch` — Pine's (source, high, low, length)
    // onto this table's (h, l, c, n). That measurement says nothing whatever
    // about what Pine CALLS those parameters, and no TradingView-hosted page the
    // investigation could read spells them; only third-party sites assert them.
    // Accepting `source =` here on the strength of the role order would be
    // matching by convention, which is the exact move that was wrong by 126
    // points last time.
    const r = refusal('ta.stoch(source = close, high = high, low = low, length = 14)')
    expect(r.guard).toBe('pine:named-argument')
    expect(r.message).toContain('stoch')

    // ⭐ THE OTHER HALF, WITHOUT WHICH THIS PROVES NOTHING: the positional form
    // is accepted. A refusal that fired because `ta.stoch` is broken everywhere
    // would satisfy the assertion above and mean nothing.
    expect(formula('ta.stoch(close, high, low, 14)')).toBeTruthy()
  })

  it('⛔ a parameter name that is not the measured one refuses and LISTS the names it takes', () => {
    // `src`/`len` are what a member reaches for from memory; Pine calls them
    // `source`/`length`. Refusing without printing the real names sends them
    // guessing — house rule 1 is that a refusal names its unblocker.
    const r = refusal('ta.sma(src = close, len = 20)')
    expect(r.guard).toBe('pine:named-argument')
    expect(r.message).toContain('src')
    expect(r.message).toContain('source')
    expect(r.message).toContain('length')
  })

  it('⛔ the same parameter given twice refuses — Pine v6 forbids duplicate parameters', () => {
    // https://www.tradingview.com/pine-script-docs/migration-guides/to-pine-version-6/
    // verbatim: "Function calls cannot include duplicate parameters".
    // ⚠️ Written as position-0-then-`source=`, which is how a duplicate actually
    // reaches this door: the positional prefix already filled the slot.
    const r = refusal('ta.sma(close, source = open, length = 20)')
    expect(r.guard).toBe('pine:named-argument')
    expect(r.message).toContain('source')
    expect(r.message.toLowerCase()).toContain('twice')
  })

  it('⛔ a positional argument AFTER a named one refuses, quoting Pine\'s own rule', () => {
    // Pine's own invalid example is `indicator(precision = 3, "Example")` —
    // "Compilation error!". Accepting it would mean inventing a slot for the
    // trailing value, and the slot we invented would be a convention.
    const r = refusal('ta.sma(source = close, 20)')
    expect(r.guard).toBe('pine:named-argument')
    expect(r.message).toContain('20')
  })

  it('⛔ a HOLE is arity\'s business, and arity keeps one authority', () => {
    // `ta.sma(length = 20)` names a real parameter and leaves `source` empty.
    // Refusing here with a bespoke sentence would be a second authority over
    // "how many arguments does this take" — so the fill declines to invent one
    // and the EXISTING arity check answers, with the count the member wrote.
    const r = refusal('ta.sma(length = 20)')
    expect(r.guard).toBe('pine:arity')
    expect(r.message).toContain('1')
  })

  it('⛔ a function with NO measured names refuses even where the role order IS measured', () => {
    // `ta.atr` and `ta.wpr` both have `PINE_CALL_SHAPES` entries. The v5
    // migration guide lists `ta.atr()` with EMPTY parentheses — it evidences the
    // namespace move and nothing about parameter names — and no corpus script
    // writes either one named.
    for (const body of ['ta.atr(length = 14)', 'ta.wpr(length = 14)']) {
      const r = refusal(body)
      expect(r.guard, body).toBe('pine:named-argument')
    }
  })

  it('⛔ a function with several price series and no measured order is untouched by this change', () => {
    // These reach the door with a name and leave with the same guard they had
    // before it: nothing about the fail-closed branch moved.
    for (const body of [
      'math.max(x = close, y = open)',
      'ta.highest(source = close, length = 10)',
      'ta.change(source = close)',
      'nz(source = close, replacement = 0)',
    ]) {
      const r = refusal(body)
      expect(r.guard, body).toBe('pine:named-argument')
    }
  })

  it('⛔ `ta.crossunder` is NOT assumed to mirror `ta.crossover`', () => {
    // ⚠️ THE TEMPTING ONE. `ta.crossover(source1, source2)` is doc-evidenced in
    // the v5 rename table; `ta.crossunder` is listed there with no parameter
    // names at all. "It surely mirrors its twin" is a guess, and a guess about
    // an ORDER-SENSITIVE pair is the guess that costs the most.
    expect(Object.prototype.hasOwnProperty.call(PINE_ARG_NAMES, 'crossunder')).toBe(false)
    expect(refusal('ta.crossunder(source1 = close, source2 = open)').guard)
      .toBe('pine:named-argument')
  })
})

// --------------------------------------------------------------------------- //
// 🔴 THE EXPANSION DOOR — a LIVE silent mistranslation, found by a control
// --------------------------------------------------------------------------- //

describe('the rewrite-into-our-vocabulary door refuses names too', () => {
  // ⛔⛔ THESE THREE ARE THE MEASURED OUTPUT OF THE BUILD BEFORE THE GUARD LANDED.
  // `BUILTIN_CALL_TREE` and `PINE_NAMESPACED_TREE` read their arguments as
  // `a.value !== undefined ? a.value : a` — which strips the NAME off a wrapper
  // and then uses the argument's WRITTEN POSITION. Nothing in either table
  // measures what Pine calls those parameters, so this was matching by
  // convention through a second door while the table door was refusing to.
  //
  // ⭐ Each case records what it USED to produce, because "it refuses now" is not
  // by itself evidence that anything was wrong. The wrong answers are the reason.

  it('⛔⛔ `ta.pivothigh` named — it used to SWAP left and right and say nothing', () => {
    // BEFORE: ta.pivothigh(source = high, rightbars = 3, leftbars = 7)
    //           → pivothigh(high, 3, 7)[7]
    // The member asked for 7 bars left and 3 right; they were handed 3 left and 7
    // right, confirmed seven bars late. Both numbers are legal, the read-back
    // reads perfectly, and the column is a different indicator.
    const r = refusal('ta.pivothigh(source = high, rightbars = 3, leftbars = 7)')
    expect(r.guard).toBe('pine:named-argument')
    expect(r.message).toContain('in order')
    // …and the CONTROL: the positional form is untouched.
    expect(formula('ta.pivothigh(high, 7, 3)')).toBe('pivothigh(high, 7, 3)[3]')
  })

  it('⛔⛔ `iff` named — it used to swap the CONDITION with an arm', () => {
    // BEFORE: iff(then = close, condition = close > open, otherwise = open)
    //           → close ? close > open : open
    // The test became a PRICE — always non-zero, so always true — and the column
    // answered a 0/1 comparison where the member asked for a price.
    const r = refusal('iff(then = close, condition = close > open, otherwise = open)')
    expect(r.guard).toBe('pine:named-argument')
    expect(formula('iff(close > open, close, open)')).toBe('close > open ? close : open')
  })

  it('⛔ `ta.highestbars` named — it used to put a SERIES in an int slot', () => {
    // BEFORE: ta.highestbars(length = 5, source = close) → -highestbars(5, close)
    // This branch builds its call node directly, so it never reaches the window
    // guard: the pine door said yes to a formula the engine cannot run.
    expect(refusal('ta.highestbars(length = 5, source = close)').guard)
      .toBe('pine:named-argument')
    expect(formula('ta.highestbars(close, 5)')).toBe('-highestbars(close, 5)')
  })

  it('⚠️ and the cost is stated: a correctly-ORDERED named call now refuses too', () => {
    // `roc(source = close, length = 5)` translated correctly before this guard —
    // by luck, because Pine's order and the written order happened to agree. A
    // door that is right only while the member types in order is not a mapping,
    // and the same script with two names swapped is what the guard is for. When a
    // TradingView-hosted signature evidences these names they belong in
    // `PINE_ARG_NAMES`, and this refusal stops applying to them.
    expect(refusal('roc(source = close, length = 5)').guard).toBe('pine:named-argument')
    expect(formula('roc(close, 5)')).toBe('100 * (close - close[5]) / close[5]')
  })
})

// --------------------------------------------------------------------------- //
// ⛔ THE PERMUTATION HALF — a fixture that cannot distinguish is not a rail
// --------------------------------------------------------------------------- //

describe('a named mapping onto a MEASURED role order computes the measured thing', () => {
  it('⭐ named `ta.crossover` equals the positional call AND a swapped one differs', () => {
    // ⛔ THE SECOND HALF IS THE RAIL. `lesson_an_identity_join_is_not_a_correctness_check`:
    // "the named form equals the positional form" is satisfied forever by a
    // mapping that ignores the names entirely and fills left to right. Only the
    // SWAP shows the names are being read — and `crossover` is the entry where a
    // swap changes the answer, because "a crossed above b" is not "b crossed
    // above a".
    const straight = formula('ta.crossover(source1 = close, source2 = ta.sma(close, 5))')
    const positional = formula('ta.crossover(close, ta.sma(close, 5))')
    const swapped = formula('ta.crossover(source2 = close, source1 = ta.sma(close, 5))')

    expect(straight).toBe(positional)
    expect(swapped).not.toBe(straight)

    // ...and the NUMBERS differ, not merely the printed text. A read-back can
    // agree with itself; the column is what a member scans on.
    const a = values(straight)
    const b = values(swapped)
    const differing = a.filter((v, i) => v !== b[i] && !(Number.isNaN(v) && Number.isNaN(b[i])))
    expect(differing.length).toBeGreaterThan(0)
  })
})

// --------------------------------------------------------------------------- //
// the derived census — never a hand-typed count beside the list it describes
// --------------------------------------------------------------------------- //

describe('the declared name table, derived', () => {
  // ⚠️ `|| {}` SO A MISSING EXPORT IS A NAMED RED, NOT A SUITE THAT WILL NOT
  // LOAD. The vacuity assertion immediately below is what turns an empty table
  // into a failure, so nothing is softened by the fallback.
  const KEYS = Object.keys(PINE_ARG_NAMES || {})

  it('is not vacuous, and every entry carries the evidence that admitted it', () => {
    // ⛔ THE CONTROL FOR EVERY OTHER ASSERTION IN THIS BLOCK. A `for` loop over
    // an empty table passes perfectly.
    expect(KEYS.length).toBeGreaterThan(0)
    const missing = KEYS.filter((k) => typeof PINE_ARG_NAMES[k].evidence !== 'string'
      || PINE_ARG_NAMES[k].evidence.length < 10)
    expect(missing).toEqual([])
  })

  it('⭐ every key names a function this table really declares, and the ARITIES agree', () => {
    // ⛔ WHY THE ARITY IS CHECKED RATHER THAN TRUSTED — the same reasoning the
    // stale-shape check in `resolveTableCall` carries. A names list that no
    // longer matches what the manifest declares would fill the first N slots and
    // drop the rest, which is a mistranslation wearing a declaration.
    const index = new Map(Object.keys(TABLE.functions)
      .map((k) => [k.toLowerCase().replace(/_/g, ''), k]))
    const rows = []
    for (const k of KEYS) {
      const shape = PINE_CALL_SHAPES[k] || null
      const key = index.get((shape ? shape.table : k).toLowerCase().replace(/_/g, ''))
      const spec = key ? TABLE.functions[key] : null
      const arity = shape ? shape.pineArity : (spec ? spec.args.length : -1)
      rows.push([k, key !== undefined && key !== null, PINE_ARG_NAMES[k].names.length === arity])
    }
    // ⚠️ THE SIZE OF WHAT WAS READ IS ASSERTED — `lesson_a_rail_can_be_green_alone_and_red_in_company`.
    expect(rows.length).toBe(KEYS.length)
    expect(rows.filter(([, declared]) => !declared)).toEqual([])
    expect(rows.filter(([, , agrees]) => !agrees)).toEqual([])
  })

  it('⛔⛔ no entry can reach a mapping a POSITIONAL call could not reach', () => {
    // The structural invariant, derived rather than reviewed: a table function
    // with more than one `series` slot has no positional mapping either, unless
    // `PINE_CALL_SHAPES` measured one. So a names entry for such a function must
    // be accompanied by a shape — otherwise naming the arguments would be the
    // only way to reach a role order nobody measured.
    const index = new Map(Object.keys(TABLE.functions)
      .map((k) => [k.toLowerCase().replace(/_/g, ''), k]))
    const offenders = KEYS.filter((k) => {
      const shape = PINE_CALL_SHAPES[k] || null
      if (shape) return false
      const key = index.get(k.toLowerCase().replace(/_/g, ''))
      const spec = key ? TABLE.functions[key] : null
      const seriesSlots = spec ? spec.args.filter((a) => a === 'series').length : 99
      return seriesSlots > 1
    })
    expect(offenders).toEqual([])
  })

  it('⛔⛔ `stoch` has a measured ORDER and deliberately no measured NAMES', () => {
    // Pinned as a decision rather than left as an absence, so that adding it
    // later is a conscious act with evidence attached rather than a tidy-up.
    expect(PINE_CALL_SHAPES.stoch).toBeTruthy()
    expect(Object.prototype.hasOwnProperty.call(PINE_ARG_NAMES, 'stoch')).toBe(false)
  })
})

// --------------------------------------------------------------------------- //
// the SECOND door: `request.security`
// --------------------------------------------------------------------------- //

describe('request.security reads its own parameter names', () => {
  const sec = (body) => translatePine(`//@version=5\nindicator("t")\nplot(${body})\n`)

  it('⭐ a fully-named request is the same tree as the positional one', () => {
    // ⛔ WHY THIS SHIPS IN THE SAME CHANGE AS THE TABLE FILL. `securityAsNode`
    // dropped every named argument on the floor (`args.filter((a) => !a.name)`),
    // so a fully-named request fell through to `pine:request` — "another symbol
    // or another timeframe is outside what one screened column reads" — which is
    // FALSE about a call this door provably takes when it is written in order.
    // Fixing the table fill alone would have swapped community/26's honest
    // refusal for that false sentence, one line further down the file.
    const named = sec('request.security(symbol = syminfo.ticker, timeframe = timeframe.period, expression = close)')
    const positional = sec('request.security(syminfo.ticker, timeframe.period, close)')
    expect(named.ok, JSON.stringify(named.refusal)).toBe(true)
    expect(positional.ok).toBe(true)
    expect(named.outputs[named.selected].formula)
      .toBe(positional.outputs[positional.selected].formula)
  })

  it('a positional prefix with the rest named works too, and `gaps` does not disturb it', () => {
    const out = sec('request.security(syminfo.tickerid, "W", expression = close, gaps = barmerge.gaps_off)')
    expect(out.ok, JSON.stringify(out.refusal)).toBe(true)
    expect(out.outputs[out.selected].formula).toBe("tf(close, 'W')")
  })

  it('⛔ the lookahead ruling is unchanged — named `lookahead_on` still becomes the LIVE node', () => {
    // ⚠️ THE CONTROL THAT MATTERS MOST HERE. Positionalising the arguments must
    // not cost the lookahead scan its answer: reading `lookahead` as "wherever
    // it appears" and reading it as "slot 4" have to agree, or a look-ahead
    // script quietly becomes a look-behind one that backtests beautifully.
    const on = sec('request.security(syminfo.tickerid, "W", close, lookahead = barmerge.lookahead_on)')
    expect(on.ok, JSON.stringify(on.refusal)).toBe(true)
    expect(on.outputs[on.selected].formula).toBe("tf_live(close, 'W')")

    const off = sec('request.security(syminfo.tickerid, "W", close, lookahead = barmerge.lookahead_off)')
    expect(off.ok).toBe(true)
    expect(off.outputs[off.selected].formula).toBe("tf(close, 'W')")
  })

  it('⛔ an unrecognised parameter name still falls through to the namespace refusal', () => {
    // ⚠️ A TIGHTENING, STATED. Before this change an unknown named argument was
    // silently DISCARDED as long as three positional ones were present. Reading
    // a request while ignoring a parameter we cannot name is exactly the silent
    // mistranslation this door exists against, so it now declines the shape and
    // `pine:request` answers — the same sentence every other unreadable request
    // gets, from the same declaration.
    const r = sec('request.security(syminfo.ticker, timeframe.period, close, wibble = 1)')
    expect(r.ok).toBe(false)
    expect(r.refusal.guard).toBe('pine:request')
  })

  it('the v4 spelling `resolution =` names the same slot v5 calls `timeframe =`', () => {
    // v4: security(symbol, resolution, expression, gaps, lookahead, ignore_invalid_symbol)
    // v5: request.security(symbol, timeframe, expression, gaps, lookahead, …)
    // ⚠️ SAME SLOT, DIFFERENT SPELLING — so this is a rename, not a reorder, and
    // one ordered list serves both versions. A version-aware table would be
    // needed only if some version moved a parameter, and none of the names here
    // does.
    const out = sec('security(syminfo.tickerid, resolution = "W", expression = close)')
    expect(out.ok, JSON.stringify(out.refusal)).toBe(true)
    expect(out.outputs[out.selected].formula).toBe("tf(close, 'W')")
  })
})
