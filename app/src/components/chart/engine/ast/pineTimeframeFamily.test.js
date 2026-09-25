// app/src/components/chart/engine/ast/pineTimeframeFamily.test.js
//
// ─── ⭐⭐ `timeframe.period` · `.multiplier` · `.in_seconds` · `.change` ───────
//
// The four names that are NOT the dotted clock predicates `pineTimeframeAlias`
// owns. Those resolve to COLUMNS the manifest already declares; these do not
// resolve to anything the closed table holds, and they do not need to:
//
//   `timeframe.period`      a STRING — bind-time text, exactly like `syminfo.*`
//   `timeframe.multiplier`  an INT   — settled by the bars this translation is for
//   `timeframe.in_seconds`  an INT   — the same, with an optional argument
//   `timeframe.change`      a BOOL PER BAR — and therefore REFUSED, by name
//
// ⭐⭐ THE AUTHORITY IS `basePeriod`, AND IT IS NOT A NEW ONE. `ownTimeframeOf`
// has declared `timeframe.period` to name the chart's own timeframe since the
// `request.security` door was built, and `securityAsNode` folds
// `request.security(own, <basePeriod>, x)` to the identity on exactly that
// premise — the two spellings of one request. Handing the same code back as a
// VALUE states what that equation already assumed.
//
// ⛔⛔ AND IT IS SERVED IN BOTH LANES OR IT IS A DIFFERENT PRODUCT IN EACH. The
// columnar resolver answers it as bind-time text; the runtime front end lowers
// it to `EXPR.STR`, because `admitRequest` demands a string for a request's
// timeframe and text never reaches the columnar lane at all. Measured while this
// landed: with only the columnar half, four corpus scripts writing
// `request.security(<sym>, timeframe.period, close)` moved from a FALSE refusal
// to a MISLEADING one. Both halves read `basePeriodOf` and `OWN_TF_NAMES`, so
// they cannot disagree about one name in one script.

import { describe, it, expect } from 'vitest'
import {
  translatePine, timeframeMultiplier, timeframeSeconds, basePeriodOf,
  BUILTIN_TIMEFRAME_SCALAR, BUILTIN_TIMEFRAME_CALL, BUILTIN_TIMEFRAME_RULED,
  BUILTIN_TIMEFRAME_ALIAS, BUILTIN_SYMBOL_SCOPED, OWN_TF_NAMES,
} from './pine.js'
import { BASE_TF, TF_LADDER } from './interpret.js'
import { buildRuntimeIr } from './pineRuntimeFrontend.js'
import { timeframeFlags } from '../../indicators.js'

const H = '//@version=5\nindicator("t")\n'
const run = (body, opts = {}) => translatePine(`${H}${body}\n`, opts)
const okBoth = (body, extra = {}) => {
  for (const opts of [{ ...extra }, { ...extra, strict: true }]) {
    const r = run(body, opts)
    expect(r.ok, `${opts.strict ? 'host' : 'screener'}: ${r.refusal && r.refusal.message}`).toBe(true)
  }
}
const formula = (body, opts = {}) => {
  const r = run(body, opts)
  expect(r.ok, r.refusal && r.refusal.message).toBe(true)
  return r.outputs[r.selected].formula
}
const refusal = (body, opts = {}) => {
  const r = run(body, opts)
  expect(r.ok, `${body} was expected to refuse`).toBe(false)
  return r.refusal
}

// ───────────────────────────────────────────────────────────────────────────
describe('the arithmetic is derived, and it fails CLOSED', () => {
  it('⭐ the multiplier is the number in front of the unit', () => {
    expect(timeframeMultiplier('5')).toBe(5)
    expect(timeframeMultiplier('60')).toBe(60)
    expect(timeframeMultiplier('240')).toBe(240)
    // ⭐ `D`, `W` and `M` carry no number, so Pine's multiplier is 1.
    expect(timeframeMultiplier('D')).toBe(1)
    expect(timeframeMultiplier('W')).toBe(1)
    expect(timeframeMultiplier('M')).toBe(1)
  })

  it('⛔⛔ an unrecognised code is NULL, never a guessed 1', () => {
    // A guessed multiplier reads as "this is a daily chart" on a timeframe
    // nobody has classified — the wrong answer wearing a right one's clothes,
    // which is the rule `indicators.js::timeframeFlags` states for the clock.
    for (const bad of ['3', '2D', 'S', '', 'x', null, undefined, 5]) {
      expect(timeframeMultiplier(bad), String(bad)).toBeNull()
      expect(timeframeSeconds(bad), String(bad)).toBeNull()
    }
  })

  it('⭐ intraday seconds are minutes x 60 — an arithmetic, not a table', () => {
    expect(timeframeSeconds('1')).toBe(60)
    expect(timeframeSeconds('5')).toBe(300)
    expect(timeframeSeconds('15')).toBe(900)
    expect(timeframeSeconds('30')).toBe(1800)
    expect(timeframeSeconds('60')).toBe(3600)
    expect(timeframeSeconds('240')).toBe(14400)
  })

  it('⛔ D/W/M are PINE\'S CONVENTION, and the relation is what is pinned', () => {
    // ⚠️ NOT vendor-witnessed here. A month is 30 days because TradingView says
    // so, not because any calendar does — so the relation is asserted rather
    // than three magic numbers, and a reader can see the choice being made.
    const day = timeframeSeconds('D')
    expect(day).toBe(86400)
    expect(timeframeSeconds('W')).toBe(7 * day)
    expect(timeframeSeconds('M')).toBe(30 * day)
  })

  it('⛔ every code the SPELLING map can produce has both answers', () => {
    // Derived from the door's own vocabulary, so a spelling that lands tomorrow
    // is covered the day it lands rather than a release later. A code with a
    // multiplier and no length would be half-served, which is worse than
    // refused: `in_seconds` would fall through while `multiplier` answered.
    for (const code of TF_LADDER) {
      const m = timeframeMultiplier(code)
      const s = timeframeSeconds(code)
      expect(m === null, `${code} multiplier`).toBe(s === null)
      if (m !== null) expect(s).toBeGreaterThan(0)
    }
  })

  it('⛔ and the string it hands back is a code the CLOCK also recognises', () => {
    // ⭐ The one direction that can rot silently. `timeframe.period` and
    // `timeframe.isdaily` are two readings of ONE fact; if the string this door
    // returns were not a code `timeframeFlags` classifies, a script could see
    // `timeframe.period == "D"` true and `timeframe.isdaily` NaN in the same
    // breath. Derived from both sides rather than pinned to 'D'.
    expect(timeframeFlags(basePeriodOf({}))).not.toBeNull()
    expect(timeframeMultiplier(basePeriodOf({}))).not.toBeNull()
  })
})

// ───────────────────────────────────────────────────────────────────────────
describe('`basePeriodOf` is ONE reader for two lanes', () => {
  it('⭐ it defaults to the DERIVED base, and honours an override', () => {
    expect(basePeriodOf({})).toBe(BASE_TF)
    expect(basePeriodOf(undefined)).toBe(BASE_TF)
    expect(basePeriodOf({ basePeriod: '60' })).toBe('60')
    // ⛔ A non-string is "nobody told me", not a coercion target.
    expect(basePeriodOf({ basePeriod: 60 })).toBe(BASE_TF)
  })

  it('⛔⛔ the COLUMNAR lane and the RUNTIME lane answer the same string', () => {
    // The whole reason the helper exists. Two copies of `opts.basePeriod ||
    // BASE_TF` would let `tf == "60"` and `request.security(sym, tf, x)`
    // disagree about one name in one script, and nothing would report it.
    //
    // ⛔ THE RUNTIME HALF IS DRIVEN THROUGH `admitRequest`, which demands
    // `EXPR.STR` for a request's timeframe — that seam is the ONLY place in the
    // runtime lane where a wrong answer here is a refusal rather than a silent
    // one, so it is the one worth railing.
    // ⚠️ The symbol is a LITERAL on purpose: `syminfo.ticker` in a request's
    // symbol slot has a bind-time gate of its own in this lane, and a fixture
    // that tripped it would go red for a reason that has nothing to do with the
    // timeframe (measured — it did, first time).
    for (const code of ['D', '60']) {
      const opts = { basePeriod: code }
      // Columnar: the comparison folds to 1 only if the door read `code`.
      expect(formula(`plot(timeframe.period == "${code}" ? close : open)`, opts))
        .toBe('close')
      const ir = buildRuntimeIr(
        `${H}plot(request.security("SPY", timeframe.period, close))\n`,
        { bars: [], ...opts },
      )
      expect(ir.ok, ir.refusal && ir.refusal.message).toBe(true)
      expect(ir.ir.requests.map((r) => r.timeframe)).toEqual([code])
    }
  })

  it('⛔⛔ …and through a BINDING, which is how the corpus writes it', () => {
    // ⚰️ `tf = timeframe.period` then `request.security(sym, tf, x)` refused
    // *"this script uses a text feature our chart does not render yet"* until
    // `holdsText` learned the name: a bound name reads as NUMERIC, so the route
    // sent it to the columnar lane, which holds no strings. The bare-name case
    // below cannot catch that — the shapes differ.
    const ir = buildRuntimeIr(
      `${H}tf = timeframe.period\nplot(request.security("SPY", tf, close))\n`,
      { bars: [], basePeriod: 'W' },
    )
    expect(ir.ok, ir.refusal && ir.refusal.message).toBe(true)
    expect(ir.ir.requests.map((r) => r.timeframe)).toEqual(['W'])
  })
})

// ───────────────────────────────────────────────────────────────────────────
describe('`timeframe.period` is BIND-TIME TEXT, on both contracts', () => {
  it('⭐⭐ a comparison against a literal folds to a CONSTANT', () => {
    expect(formula('plot(timeframe.period == "D" ? close : open)')).toBe('close')
    expect(formula('plot(timeframe.period == "60" ? close : open)')).toBe('open')
    expect(formula('plot(timeframe.period != "D" ? close : open)')).toBe('open')
  })

  it('⭐ through a BINDING, which is how the corpus writes it', () => {
    // ⛔ COMPUTED, NOT LITERAL-ONLY. `keltner-center-of-gravity-channel` writes
    // `tf = timeframe.period` then dispatches on `tf` six arms deep; a fixture
    // that only ever wrote the dotted name inline would leave the binding walk
    // unrailed.
    expect(formula('tf = timeframe.period\nplot(tf == "D" ? close : open)')).toBe('close')
    expect(formula('tf = timeframe.period\nplot(tf == "M" ? 14 : tf == "W" ? 14 : tf == "D" ? high : low)'))
      .toBe('high')
  })

  it('⭐ through a CONSTANT-SELECTOR TERNARY — the corpus\'s override idiom', () => {
    // `corr_tf = pick == "" ? timeframe.period : pick` is how a script says
    // "this timeframe, unless the member overrode it". Both arms are text and
    // the selector is decided, so the answer is too.
    expect(formula('pick = ""\ntf = pick == "" ? timeframe.period : pick\nplot(tf == "D" ? close : open)'))
      .toBe('close')
    expect(formula('pick = "W"\ntf = pick == "" ? timeframe.period : pick\nplot(tf == "W" ? close : open)'))
      .toBe('close')
  })

  it('⭐ and the `str.*` predicates answer over it', () => {
    expect(formula('plot(str.contains(timeframe.period, "D") ? close : open)')).toBe('close')
    // ⚠️ `str.length` yields a NUMBER, and two numbers compared are NOT folded
    // by this translator — only two STRINGS are. So the claim worth asserting is
    // that the count arrived, not that the comparison collapsed.
    expect(formula('plot(str.length(timeframe.period) == 1 ? close : open)'))
      .toBe('1 == 1 ? close : open')
  })

  it('⛔⛔ a BINDING still wins over the name — the fifth instance of one defect', () => {
    // `period` is a bare v2/v3 identifier a script may legally reassign, and
    // `period = "60"` means hourly. `ownSymbolNameOf`, `ownTimeframeOf`,
    // `resolveName` and the `request.security` carve-out each carry this note
    // after the same defect; this is the fifth reader that has to obey it.
    expect(formula('period = "60"\nplot(period == "60" ? close : open)')).toBe('close')
    expect(formula('period = "60"\nplot(period == "D" ? close : open)')).toBe('open')
  })

  it('⛔ a bare one in a VALUE slot refuses `pine:text-value`, not `pine:builtin`', () => {
    // ⭐ THE SENTENCE HAS TO BE TRUE ABOUT ITS NEIGHBOURS. "The engine grammar
    // does not hold this name" is false three lines after the name resolves;
    // what is unavailable is a NUMBER for a piece of text, which is exactly what
    // a bare string literal is already told.
    for (const opts of [{}, { strict: true }]) {
      expect(refusal('plot(timeframe.period)', opts).guard).toBe('pine:text-value')
    }
    // The control: a bare string gets the identical guard, so this is that rule
    // rather than a message invented for one name.
    expect(refusal('plot("D")').guard).toBe('pine:text-value')
  })

  it('⛔ and the `request.security` IDENTITY FOLD still works — unchanged', () => {
    // The premise this whole family rests on. If serving the name as a value had
    // broken the door that already treated it as the chart's own timeframe, the
    // two readings would have diverged in the same commit that unified them.
    expect(formula('plot(request.security(syminfo.tickerid, timeframe.period, close))'))
      .toBe('close')
  })
})

// ───────────────────────────────────────────────────────────────────────────
describe('`timeframe.multiplier` and `timeframe.in_seconds` are numbers', () => {
  it('⭐ both fold, on both contracts', () => {
    okBoth('plot(timeframe.multiplier > 0 ? close : open)')
    okBoth('plot(timeframe.in_seconds() > 0 ? close : open)')
  })

  // ⚠️ THE READ-BACK IS THE ASSERTION, NOT A COLLAPSED TERNARY. Two NUMBERS
  // compared are left as an op by this translator (only two STRINGS fold), so
  // `2 == 1 ? …` would be just as "ok" as `1 == 1 ? …`. The number in the
  // printed formula is what says the door answered, and what it answered.
  const numberIn = (body, opts) => formula(body, opts)

  it('⭐ and they fold to the RIGHT numbers for the base they are given', () => {
    expect(numberIn('plot(close + timeframe.multiplier)')).toBe('close + 1')
    expect(numberIn('plot(close + timeframe.multiplier)', { basePeriod: '60' })).toBe('close + 60')
    expect(numberIn('plot(close + timeframe.multiplier)', { basePeriod: '15' })).toBe('close + 15')
    expect(numberIn('plot(close + timeframe.in_seconds())')).toBe('close + 86400')
    expect(numberIn('plot(close + timeframe.in_seconds())', { basePeriod: '60' })).toBe('close + 3600')
    expect(numberIn('plot(close + timeframe.in_seconds())', { basePeriod: 'W' })).toBe('close + 604800')
  })

  it('⭐⭐ `in_seconds` takes an OPTIONAL argument, and reads it as bind-time text', () => {
    expect(numberIn('plot(close + timeframe.in_seconds("60"))')).toBe('close + 3600')
    expect(numberIn('plot(close + timeframe.in_seconds("W"))')).toBe('close + 604800')
    expect(numberIn('plot(close + timeframe.in_seconds("M"))')).toBe('close + 2592000')
    // ⭐ A PINE SPELLING, not only the engine's own code — the spelling map is
    // asked rather than copied, so `1H` and `1D` work where `60` and `D` do.
    expect(numberIn('plot(close + timeframe.in_seconds("1H"))')).toBe('close + 3600')
    expect(numberIn('plot(close + timeframe.in_seconds("1D"))')).toBe('close + 86400')
    // ⛔ COMPUTED, NOT LITERAL-ONLY: through a binding, through an input default,
    // through a ternary, and through the sibling name.
    expect(numberIn('x = "15"\nplot(close + timeframe.in_seconds(x))')).toBe('close + 900')
    expect(numberIn('x = input.timeframe("30")\nplot(close + timeframe.in_seconds(x))'))
      .toBe('close + 1800')
    expect(numberIn('p = ""\nx = p == "" ? timeframe.period : p\nplot(close + timeframe.in_seconds(x))'))
      .toBe('close + 86400')
    expect(numberIn('plot(close + timeframe.in_seconds(timeframe.period))')).toBe('close + 86400')
  })

  it('⛔⛔ a NAMED argument is READ, never dropped — the trap is a WRONG NUMBER', () => {
    // ⚰️ `securityAsNode` records this exact defect one door over: *"THIS USED TO
    // BE `args.filter((a) => !a.name)`, WHICH DROPPED EVERY NAMED ARGUMENT ON THE
    // FLOOR."* Here the consequence is worse than a false refusal. Filtering the
    // named form away leaves ZERO positional arguments — which is the legal
    // no-argument spelling — so the call would answer the CHART'S OWN length,
    // silently, for a call the member wrote correctly.
    expect(numberIn('plot(close + timeframe.in_seconds(timeframe = "60"))'))
      .toBe('close + 3600')
    // ⛔ AND THE CONTROL THAT MAKES THAT ASSERTION MEAN SOMETHING: on a daily
    // base the dropped-argument bug answers 86400, so the two are distinguishable.
    expect(basePeriodOf({})).toBe('D')
    expect(timeframeSeconds('D')).toBe(86400)
    // A name Pine does not declare is a shape this door does not take.
    expect(refusal('plot(close + timeframe.in_seconds(tf = "60"))').guard).toBe('pine:builtin')
    // Two arguments is not Pine's signature either.
    expect(refusal('plot(close + timeframe.in_seconds("60", "D"))').guard).toBe('pine:builtin')
  })

  it('⛔ an argument this door cannot settle FALLS THROUGH to the namespace', () => {
    // ⭐ NULL, NEVER A REFUSAL OF ITS OWN — the contract `securityAsNode` states.
    // A shape this cannot take keeps the ONE sentence the namespace publishes,
    // rather than a second message that would have to be maintained twice.
    const r = refusal('plot(timeframe.in_seconds(close) > 0 ? close : open)')
    expect(r.guard).toBe('pine:builtin')
    expect(r.message).toMatch(/timeframe\.in_seconds/)
    // An unrecognised code likewise — and NOT a guessed length.
    expect(refusal('plot(timeframe.in_seconds("3") > 0 ? close : open)').guard).toBe('pine:builtin')
  })

  it('⛔ an unrecognised BASE refuses rather than answering', () => {
    // The fail-closed direction, driven end to end: a base outside the ladder
    // leaves every member of the family unanswerable, and each one says so.
    const o = { basePeriod: '3' }
    expect(refusal('plot(timeframe.multiplier > 0 ? close : open)', o).guard).toBe('pine:builtin')
    expect(refusal('plot(timeframe.in_seconds() > 0 ? close : open)', o).guard).toBe('pine:builtin')
  })

  it('⛔⛔ the BARE name `timeframe.in_seconds` is not a zero-argument call', () => {
    // Pine has no such variable. Without the call test in `resolveName` the bare
    // name folds to the chart's own length — a number for something a member
    // never wrote.
    expect(refusal('plot(timeframe.in_seconds > 0 ? close : open)').guard).toBe('pine:builtin')
  })

  it('⛔ and a USER DEFINITION of the name shadows ours', () => {
    // Consult what the script SAID before what the table knows — the rule the
    // `security` carve-out records, applied to this door.
    expect(formula('timeframe.in_seconds() => 5\nplot(close)')).toBe('close')
  })
})

// ───────────────────────────────────────────────────────────────────────────
describe('`timeframe.change` is REFUSED, and the refusal teaches', () => {
  it('⛔⛔ by name, with the reason, on both contracts and as a CALL', () => {
    for (const opts of [{}, { strict: true }]) {
      const r = refusal('plot(timeframe.change("D") ? close : open)', opts)
      expect(r.guard).toBe('pine:builtin')
      expect(r.message).toMatch(/timeframe\.change/)
      expect(r.message).toMatch(/FIRST BAR OF EACH NEW PERIOD/)
      // ⛔ THE CLAUSE THIS FILE EXISTS TO KEEP OUT, for the same reason
      // `pine.refusalAuthority.test.js` keeps it out of `barstate.isfirst`: it
      // is FALSE about the three siblings that resolve one line away.
      expect(r.message).not.toMatch(/names something the engine grammar does not hold/i)
    }
  })

  it('⛔ …and the siblings really do resolve, so the old prefix was false', () => {
    okBoth('plot(timeframe.period == "D" ? close : open)')
    okBoth('plot(timeframe.multiplier > 0 ? close : open)')
    okBoth('plot(timeframe.in_seconds() > 0 ? close : open)')
  })

  it('⭐ CONTROL — a `timeframe.*` name nobody has ruled on keeps the shared clause', () => {
    // This is what separates a fix from a deletion: a name the engine genuinely
    // has not thought about must still get the generic sentence.
    //
    // ⚰️ THIS CONTROL USED `timeframe.isminutes` AND THE FIX BROKE IT — correctly.
    // `isminutes` shipped on 2026-09-22, so the fixture stopped being an example
    // of an unserved name and the control started asserting the opposite of the
    // truth. ⭐ A control whose fixture can be SERVED out from under it is a
    // control with an expiry date nobody wrote down
    // (`lesson_an_arming_condition_that_names_a_test_expires`).
    //
    // ⛔ SO THE FIXTURE CHECKS ITSELF FIRST. If a later wave serves this name
    // too, the assertion below fails with an instruction instead of a puzzle.
    const UNSERVED = 'timeframe.isdwm'
    for (const map of [BUILTIN_TIMEFRAME_SCALAR, BUILTIN_TIMEFRAME_ALIAS,
      BUILTIN_TIMEFRAME_CALL, BUILTIN_TIMEFRAME_RULED]) {
      expect(Object.prototype.hasOwnProperty.call(map, UNSERVED),
        `${UNSERVED} is now served or ruled — pick another unserved timeframe.* name for this control`)
        .toBe(false)
    }
    const r = refusal(`plot(${UNSERVED} ? close : open)`)
    expect(r.guard).toBe('pine:builtin')
    expect(r.message).toMatch(/names something the engine grammar does not hold/i)
  })
})

// ───────────────────────────────────────────────────────────────────────────
describe('the maps stay disjoint and point at real things', () => {
  it('⛔ no name is in two of the timeframe maps', () => {
    // A name served AND ruled would be decided by whichever check runs first —
    // a second authority over one member-facing answer.
    const maps = {
      alias: Object.keys(BUILTIN_TIMEFRAME_ALIAS),
      scalar: Object.keys(BUILTIN_TIMEFRAME_SCALAR),
      call: Object.keys(BUILTIN_TIMEFRAME_CALL),
      ruled: Object.keys(BUILTIN_TIMEFRAME_RULED),
    }
    const seen = new Map()
    for (const [which, keys] of Object.entries(maps)) {
      for (const k of keys) {
        expect(seen.has(k), `${k} is in both ${seen.get(k)} and ${which}`).toBe(false)
        seen.set(k, which)
      }
    }
    expect(seen.size).toBe(Object.values(maps).reduce((a, k) => a + k.length, 0))
  })

  it('⛔ every key is spelled `timeframe.` + something, and none is empty', () => {
    for (const [which, m] of Object.entries({
      scalar: BUILTIN_TIMEFRAME_SCALAR,
      call: BUILTIN_TIMEFRAME_CALL,
      ruled: BUILTIN_TIMEFRAME_RULED,
    })) {
      const keys = Object.keys(m)
      expect(keys.length, `${which} is empty — the rails over it prove nothing`)
        .toBeGreaterThan(0)
      for (const k of keys) expect(k.startsWith('timeframe.'), k).toBe(true)
    }
  })

  it('⛔ a ruled name carries a REASON, not just a refusal', () => {
    for (const [k, why] of Object.entries(BUILTIN_TIMEFRAME_RULED)) {
      expect(typeof why, k).toBe('string')
      expect(why.length, `${k}'s reason is too short to teach anything`).toBeGreaterThan(80)
    }
  })

  it('⛔ and `OWN_TF_NAMES` still holds BOTH spellings, dotted and bare', () => {
    // The map is shared with `ownTimeframeOf`; losing the bare `period` would
    // silently narrow the request door as well as this one.
    expect(OWN_TF_NAMES.has('timeframe.period')).toBe(true)
    expect(OWN_TF_NAMES.has('period')).toBe(true)
    // ⛔ And it must not collide with the symbol-scoped roster — one name, one
    // kind.
    for (const n of OWN_TF_NAMES) {
      expect(Object.prototype.hasOwnProperty.call(BUILTIN_SYMBOL_SCOPED, n), n).toBe(false)
    }
  })
})
// ───────────────────────────────────────────────────────────────────────────
describe('`timeframe.isseconds` / `timeframe.isminutes` — the unit predicates', () => {
  // ⭐⭐ THE SIXTH AND SEVENTH NAMES IN THE FAMILY, and they are KIND 5 —
  // settled by the bars this translation is for, exactly like
  // `timeframe.multiplier`. They are NOT clock columns: the chart's timeframe
  // does not change bar to bar, so folding them is the same move `multiplier`
  // already makes and needs no manifest change.
  //
  // ⛔ DERIVED FROM THE SPELLING MAP, NEVER RESTATED. `isminutes` asks the same
  // `isMinuteCode` test that `timeframe.multiplier` asks, and `isseconds` asks
  // whether the code is a SECONDS spelling. The engine holds no seconds
  // spelling today, so `isseconds` is 0 everywhere — but it is 0 BECAUSE THE
  // MAP SAYS SO, so the day a seconds code lands it answers 1 without anyone
  // remembering this file. A hard-coded `0` would rot in the direction that
  // silently INVERTS a member's branch.
  //
  // ⚠️ NOT VENDOR-WITNESSED, AND SAYING SO IS THE POINT — the same label
  // `TF_SECONDS_DAILY_AND_ABOVE` carries. Pine documents these as "is the
  // chart's timeframe seconds / minutes"; no capture in this repo reads them.
  // What IS witnessed is the engine's own spelling map, which is what decides
  // the answer here.

  it('⭐ both fold, on both contracts', () => {
    okBoth('plot(timeframe.isminutes ? close : open)')
    okBoth('plot(timeframe.isseconds ? close : open)')
  })

  it('⭐⭐ `isminutes` is 1 on a minute code and 0 on D/W/M', () => {
    expect(formula('plot(close + timeframe.isminutes)', { basePeriod: '60' })).toBe('close + 1')
    expect(formula('plot(close + timeframe.isminutes)', { basePeriod: '5' })).toBe('close + 1')
    expect(formula('plot(close + timeframe.isminutes)', { basePeriod: 'D' })).toBe('close + 0')
    expect(formula('plot(close + timeframe.isminutes)', { basePeriod: 'W' })).toBe('close + 0')
    expect(formula('plot(close + timeframe.isminutes)', { basePeriod: 'M' })).toBe('close + 0')
  })

  it('⭐ `isseconds` is 0 on every code this engine holds — and that is DERIVED', () => {
    for (const base of ['1', '60', 'D', 'W', 'M']) {
      expect(formula('plot(close + timeframe.isseconds)', { basePeriod: base }),
        `isseconds on ${base}`).toBe('close + 0')
    }
  })

  it('⛔⛔ THE TWO ARE NOT THE SAME NAME — a fixture that cannot tell them apart', () => {
    // ⭐ THE LOAD-BEARING CASE. Both answer 0 on a daily chart, so a test that
    // only ever asked a daily base would pass with the two wired to one
    // function. The minute base is what separates them.
    expect(formula('plot(close + timeframe.isminutes)', { basePeriod: '60' }))
      .not.toBe(formula('plot(close + timeframe.isseconds)', { basePeriod: '60' }))
  })

  it('⛔ an UNKNOWN code refuses — it does not answer 0', () => {
    // ⛔ `null` FALLS THROUGH, exactly as `timeframe.multiplier` does. Answering
    // 0 for a timeframe nobody has classified would read as "not minutes" and
    // send a member's script down the daily branch.
    const r = refusal('plot(close + timeframe.isminutes)', { basePeriod: 'NOPE' })
    expect(r.guard).toBeTruthy()
  })

  it('⛔ the roster is CONSISTENT — both names are scalars, neither is an alias', () => {
    // ⭐ The two maps must not both claim a name: the alias path returns a
    // series and the scalar path folds a number, and a name in both would
    // resolve differently depending on which arm ran first.
    for (const n of ['timeframe.isseconds', 'timeframe.isminutes']) {
      expect(Object.prototype.hasOwnProperty.call(BUILTIN_TIMEFRAME_SCALAR, n), n).toBe(true)
      expect(Object.prototype.hasOwnProperty.call(BUILTIN_TIMEFRAME_ALIAS, n), n).toBe(false)
    }
  })
})
