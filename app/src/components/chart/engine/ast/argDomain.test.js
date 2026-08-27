// W9k.1 / X41 — the DECLARED argument domain, refused at the resolve pass.
//
// 🔴 THE DEFECT. `closedTable.json::_functions_domain` declares an argument domain
// the `int` kind cannot express: `macd`'s `lookback: 'arg2'` is an upper bound only
// while `slow >= fast`, and every line of the Ichimoku family starts at the LONGEST
// of its three periods. Both walkers enforced that as an ALL-NaN COLUMN and never
// as an exception — so `macd(close, 26, 12)`, a 12/26 transposition one keystroke
// away, produced nothing, and `close > macd(close, 26, 12)` measured 0.0 on all 60
// bars, one distinct value: a definite NO at full coverage, on a savable screen,
// with nothing anywhere saying the formula was meaningless.
//
// ⭐ THE RULING. `fast > slow` is true of that TREE on every bar, for every symbol,
// forever — so it is decided where the formula is ADMITTED, once, exactly as
// `avwap`'s sub-1990 anchor is refused BY NAME while "no bar precedes the anchor"
// stays a quiet per-row column.
//
// ⛔ THIS IS THE JS HALF, AND IT EXISTS BECAUSE THE TWO LANES ARE A MIRROR. A fix
// railed only in `tests/test_ast_arg_domain.py` leaves this lane green and
// unguarded — which is how a guard on one side of a mirrored pair has shipped in
// this repo before. That file asserts the refusal SENTENCE is byte-identical to
// this lane's, read out of this module through node.
import { describe, it, expect } from 'vitest'

import { TABLE, ARG_DOMAINS, ARG_DOMAIN, argDomainsOf, LOOKBACK_RE } from './parse.js'
import { interpret, maxLookback, FN, TableRefusal, REFUSALS } from './interpret.js'
import { checkBudget } from './budget.js'

/** 60 synthetic daily bars — the fixture the defect was measured on. */
const BARS = Array.from({ length: 60 }, (_, i) => ({
  t: 1780000000 + i * 86400,
  o: 100 + i, h: 101 + i, l: 99 + i, c: 100 + i + (i % 5), v: 1000 + i,
}))

const NUM = (v) => ({ type: 'num', value: v })
const SER = (n) => ({ type: 'series', name: n })
const OP = (n, ...a) => ({ type: 'op', name: n, args: a })
const CALL = (n, ...a) => ({ type: 'call', name: n, args: a })

/** ⛔ THE PARAMETRISED SET COMES FROM THE MANIFEST, NOT FROM `ARG_DOMAINS`.
 *
 *  Deriving it from the constant under test lets a narrowed roster DELETE its own
 *  cases: a hand-list of one name would shrink `it.each` from six to one and the
 *  survivors would all pass — a rail that measures a population it pinned itself
 *  (`lesson_a_rail_can_pin_the_scarcity_that_creates_false_claims`). Reading the
 *  entries keeps every case alive and makes the roster-equality assertion below
 *  the thing that fails, BY NAME. */
const NAMES = Object.entries(TABLE.functions)
  .filter(([, spec]) => typeof spec[ARG_DOMAIN] === 'string')
  .map(([name]) => name).sort()

const ceilingOf = (name) => Number(LOOKBACK_RE.exec(String(ARG_DOMAINS[name]))[2])
const intSlots = (name) => TABLE.functions[name].args
  .map((kind, i) => (kind === 'int' ? i : -1)).filter((i) => i >= 0)

/** The bar field for a series slot, read off `argRoles` when it names one.
 *
 *  ⚠️ NOT ALWAYS `close`: the Ichimoku family declares `high`/`low`, and a flat
 *  column would make its window midpoints degenerate. */
function seriesFor(name, index) {
  const roles = TABLE.functions[name].argRoles || []
  const role = roles[index]
  return Object.prototype.hasOwnProperty.call(TABLE.series, role) ? role : 'close'
}

function callWith(name, periods) {
  const args = TABLE.functions[name].args.map((kind, i) => (kind === 'int'
    ? NUM(periods[i]) : SER(seriesFor(name, i))))
  return CALL(name, ...args)
}

/** ⭐⭐ THE ORACLE, AND IT IS NOT THE GUARD'S OWN PREDICATE. Asking
 *  `Math.max(others) > ceiling` here would be the guard re-typed, and a mutation
 *  to both would pass. `FN[name]` is the walker's binding table — the same maths
 *  the chart draws — so this asks "does this call actually compute nothing?" */
function adapterIsAllNaN(name, periods) {
  const field = { high: 'h', low: 'l', close: 'c', open: 'o', volume: 'v' }
  const args = TABLE.functions[name].args.map((kind, i) => (kind === 'int'
    ? periods[i]
    : BARS.map((b) => b[field[seriesFor(name, i)]])))
  const column = FN[name](...args)
  return [...column].every((v) => !Number.isFinite(v))
}

function guardVerdict(fire) {
  try { fire(); return null } catch (e) {
    if (!(e instanceof TableRefusal)) throw e
    return e
  }
}

const product = (values, width) => Array.from({ length: values.length ** width },
  (_, n) => Array.from({ length: width }, (_, k) => values[Math.floor(n / values.length ** k) % values.length]))

// ══════════════════════════════════════════════════════════════════════════════
// 1. THE ROSTER IS DERIVED, AND ITS ABSENCES HAVE REASONS
// ══════════════════════════════════════════════════════════════════════════════

describe('the argument domain is READ OFF THE MANIFEST', () => {
  it('⛔ every roster entry resolves through its OWN declaration, never a typed slot', () => {
    expect(NAMES.length, 'no entry declares an argument domain; this file is vacuous')
      .toBeGreaterThan(0)
    // ⛔ THE CENSUS ASSERTS THE SIZE OF WHAT IT READ. `ARG_DOMAINS` must be
    // exactly the entries the manifest declares — no more (an invented name) and
    // no fewer (a hand-list that quietly drops the Ichimoku five).
    expect(Object.keys(ARG_DOMAINS).sort(),
      'the shipped roster is not the set the manifest declares').toEqual(NAMES)
    for (const name of NAMES) {
      const spec = TABLE.functions[name]
      expect(ARG_DOMAINS[name], name).toBe(spec[spec[ARG_DOMAIN]])
      expect(spec.args[ceilingOf(name)], `${name}'s ceiling is not an int slot`).toBe('int')
      expect(intSlots(name).length, `${name} declares a domain with nothing to compare`)
        .toBeGreaterThanOrEqual(2)
    }
  })

  it('⭐ a PLANTED entry is picked up and a REMOVED declaration drops out', () => {
    // A derivation nobody can plant a manifest against is indistinguishable from
    // a hand-list that happens to be right today — the reason `barReadersOf` is
    // exported as a pure reader.
    const functions = Object.fromEntries(
      Object.entries(TABLE.functions).map(([k, v]) => [k, { ...v }]))
    expect(argDomainsOf({ functions }).macd).toBe(TABLE.functions.macd.lookback)

    functions.sma = { ...functions.sma, [ARG_DOMAIN]: 'lookback' }
    expect(argDomainsOf({ functions }).sma).toBe(TABLE.functions.sma.lookback)

    delete functions.macd[ARG_DOMAIN]
    expect(argDomainsOf({ functions }).macd).toBeUndefined()
  })

  it('⛔ every UNDECLARED int period has a REASON — a roster, not a count', () => {
    // An entry carrying a second `int` period is a candidate for this defect. It
    // is accounted for in exactly one of two ways: it DECLARES a domain, or the
    // manifest declares that period as its `forward` reach. `pivothigh(close, 2, 5)`
    // — 2 bars back, 5 ahead — is the live counter-example, which is why a rule
    // inferred from "an entry with two periods" would be an over-refusal.
    const unaccounted = []
    const byForward = []
    for (const [name, spec] of Object.entries(TABLE.functions).sort()) {
      const m = LOOKBACK_RE.exec(String(spec.lookback))
      if (!m) continue
      const ceiling = Number(m[2])
      const others = spec.args.map((k, i) => (k === 'int' ? i : -1))
        .filter((i) => i >= 0 && i !== ceiling)
      if (!others.length || ARG_DOMAINS[name] !== undefined) continue
      const fm = spec.forward ? LOOKBACK_RE.exec(String(spec.forward)) : null
      if (fm && others.every((i) => i === Number(fm[2]))) { byForward.push(name); continue }
      unaccounted.push(`${name} args ${others.join(',')}`)
    }
    expect(unaccounted,
      'these entries carry an int period outside their declared lookback and neither '
      + 'declare a `domain` nor name it as their `forward` reach — each is a live X41')
      .toEqual([])
    expect(byForward.length,
      'no entry is excused by its `forward` reach any more — the discriminator this '
      + 'census rests on is gone, so it now proves nothing').toBeGreaterThan(0)
  })
})

// ══════════════════════════════════════════════════════════════════════════════
// 2. THE GUARD AGREES WITH THE MATHS — the discriminating rail
// ══════════════════════════════════════════════════════════════════════════════

describe('the guard refuses EXACTLY what the shipped adapter answers all-NaN', () => {
  it.each(NAMES)('%s — both directions, against an independent oracle', (name) => {
    // A fixture that only feeds transposed arguments cannot tell a correct guard
    // from `return true`. The counts are asserted non-zero in BOTH classes.
    const slots = intSlots(name)
    const grid = product([3, 5, 9], slots.length).map((combo) => {
      const periods = {}
      slots.forEach((slot, i) => { periods[slot] = combo[i] })
      const refused = guardVerdict(() => maxLookback(callWith(name, periods))) !== null
      return { periods, refused, allNaN: adapterIsAllNaN(name, periods) }
    })
    const disagreed = grid.filter((r) => r.refused !== r.allNaN)
    expect(disagreed.map((r) => JSON.stringify(r.periods)).join(' '),
      `${name}: the guard and the shipped adapter disagree on ${disagreed.length} argument lists`)
      .toBe('')
    const refused = grid.filter((r) => r.refused).length
    expect(refused, `${name}: ${refused}/${grid.length} refused — a fixture that cannot `
      + 'produce both answers is not a rail').toBeGreaterThan(0)
    expect(refused).toBeLessThan(grid.length)
  })
})

// ══════════════════════════════════════════════════════════════════════════════
// 3. BOTH DIRECTIONS, PER FAMILY — and the SAVE DOOR
// ══════════════════════════════════════════════════════════════════════════════

describe('both directions, per declared family', () => {
  it.each(NAMES)('%s — the transposed call is refused BY NAME AT THE TOKEN', (name) => {
    const ceiling = ceilingOf(name)
    const over = intSlots(name).find((i) => i !== ceiling)
    const periods = Object.fromEntries(intSlots(name).map((i) => [i, 1]))
    periods[over] = 2
    const err = guardVerdict(() => maxLookback(callWith(name, periods)))
    expect(err, `${name} at a transposed period list resolved cleanly`).not.toBeNull()
    expect(err.guard).toBe('resolve:domain')
    const roles = TABLE.functions[name].argRoles
    expect(err.message).toContain(REFUSALS['resolve:domain'])
    expect(err.message).toContain(`${name} argument ${over} is its ${roles[over]} at 2`)
    expect(err.message).toContain(`argument ${ceiling}, its ${roles[ceiling]}, at 1`)
    // …and it names the FIX, not only the defect.
    expect(err.message).toContain(`put the larger one in argument ${ceiling}`)
  })

  it.each(NAMES)('%s — the WELL-ORDERED call still resolves and still computes', (name) => {
    // ⛔ THE CONTROL. A guard that refuses everything passes half of what matters.
    const ceiling = ceilingOf(name)
    const periods = Object.fromEntries(intSlots(name).map((i) => [i, i === ceiling ? 9 : 3]))
    const tree = callWith(name, periods)
    expect(maxLookback(tree)).toBeGreaterThanOrEqual(9)
    const column = interpret(tree, BARS, {})
    expect([...column].filter((v) => Number.isFinite(v)).length,
      `${name} computes nothing at well-ordered periods — the fixture, not the guard, `
      + 'is what this test would then be measuring').toBeGreaterThan(0)
  })
})

describe('the SAVE DOOR consequence', () => {
  it('🔴 `close > macd(close, 26, 12)` answered 0.0 on every bar — now it does not resolve', () => {
    const bad = CALL('macd', SER('close'), NUM(26), NUM(12))
    const tree = OP('>', SER('close'), bad)

    const evaluated = guardVerdict(() => interpret(tree, BARS, {}))
    expect(evaluated, 'the comparison still produces a column').not.toBeNull()
    expect(evaluated.guard).toBe('resolve:domain')

    // ⭐ THE BROWSER'S SAVE DOOR IS `checkBudget`, which `evaluateFormula` calls
    // second — and a `TableRefusal` propagates through it AS ITSELF rather than
    // being relabelled "over budget", which is the wrong-door defect this branch
    // has now found five separate times.
    const saved = guardVerdict(() => checkBudget(tree, null))
    expect(saved, 'the save door admitted a formula that computes nothing').not.toBeNull()
    expect(saved.guard).toBe('resolve:domain')
    expect(saved.message).toContain('macd argument 1 is its fastPeriod at 26')

    // ⛔ AND THE OTHER POLARITY — the face that hands a member the whole board.
    expect(guardVerdict(() => interpret(OP('!', tree), BARS, {})).guard).toBe('resolve:domain')
  })
})

// ══════════════════════════════════════════════════════════════════════════════
// 4. ADVERSARIAL INPUTS — a corpus is blind beside what it measures
// ══════════════════════════════════════════════════════════════════════════════

describe('the inputs a corpus would not have produced', () => {
  it('EQUAL periods are IN domain — the declaration is a bound, not an order', () => {
    // `macd(close, 26, 26)` computes a flat zero and is legitimate, if dull. A
    // strict `<` would have refused it — an over-refusal with no red test
    // anywhere, which is the shape `lesson_an_over_refusal_is_invisible` names.
    const equal = CALL('macd', SER('close'), NUM(26), NUM(26))
    expect(maxLookback(equal)).toBe(26)
    const values = [...interpret(equal, BARS, {})].filter((v) => Number.isFinite(v))
    expect(values.length).toBeGreaterThan(0)
    expect(new Set(values.map((v) => Math.round(v * 1e9) / 1e9))).toEqual(new Set([0]))
  })

  it('a NON-LITERAL period is still `resolve:window` — the EARLIER door wins', () => {
    // A call whose window cannot be READ has no periods to compare, so reporting
    // `resolve:domain` there would measure traversal order instead of the defect.
    for (const [tree, slot] of [
      [CALL('macd', SER('close'), SER('len'), NUM(12)), 1],
      [CALL('macd', SER('close'), NUM(26), SER('len')), 2],
    ]) {
      const err = guardVerdict(() => maxLookback(tree))
      expect(err.guard).toBe('resolve:window')
      expect(err.message).toContain(`argument ${slot} must be a whole number`)
    }
  })

  it('a NESTED occurrence refuses — the pass walks every call, not the root', () => {
    const err = guardVerdict(() => maxLookback(
      CALL('sma', CALL('macd', SER('close'), NUM(26), NUM(12)), NUM(5))))
    expect(err.guard).toBe('resolve:domain')
    expect(err.message).toContain('macd argument 1')
  })

  it('⚠️ an Ichimoku period out of order refuses even in the FORWARD slot', () => {
    // `ichimokuChikou` declares `forward: 'arg4'` (the kijun) AND uses that period
    // as a backward window, so the domain covers it. A rule inferred from
    // `forward` alone would have missed this one entirely.
    const err = guardVerdict(() => maxLookback(CALL(
      'ichimokuChikou', SER('high'), SER('low'), SER('close'),
      NUM(9), NUM(60), NUM(52))))
    expect(err.guard).toBe('resolve:domain')
    expect(err.message).toContain('argument 4 is its kijunPeriod at 60')
  })
})
