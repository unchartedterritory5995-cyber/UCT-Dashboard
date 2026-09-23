// app/src/components/chart/engine/runtime/__tests__/requestOwnTimeframeLookahead.test.js
//
// ─── ⭐⭐ `request.security(OWN SYMBOL, OWN PERIOD, x)` IS `x` ───────────────
//
// ⛔⛔ THE SAME PROGRAM, TWO SPELLINGS, TWO ANSWERS. Measured on a daily chart,
// with the symbol supplied:
//
//     plot(security(syminfo.tickerid, 'D', close))            ✅ compiles
//     plot(request.security(syminfo.tickerid, 'D', close))    ⛔ refused
//
// `request.security` is the CANONICAL v5/v6 spelling — **76 of 266 corpus
// scripts use it across 370 call sites**, against 26 for the deprecated bare
// form — and it refused where the legacy name worked. A member pasting a modern
// script was told the engine could not do a thing it does for the old spelling.
//
// ⭐⭐ THE CAUSE IS A LANE, NOT A CAPABILITY. `pineRuntimeFrontend` dispatches
// ONLY the namespaced name to its own request path; the bare name falls through
// to the columnar lane, which folds a self-request structurally. And the runtime
// path lowers the SYMBOL ARGUMENT AS A VALUE — so `syminfo.tickerid` has to
// become a string, and this engine's value model has none:
//
//     a value that a symbol settles reached the evaluator unsettled
//     — this binding did not settle syminfo.tickerid
//
// That refusal is correct about what it was asked. It was asked the wrong
// question: a SELF request never needs the symbol's text, only the knowledge
// that it IS this chart's symbol. `pine.js::ownSymbolNameOf` has matched it
// structurally all along.
//
// ⭐ SO THIS IS RC-H's RULING REACHING THE SECOND LANE, not a new one:
//
//     // ⛔ AND A LOOK-AHEAD READ OF THE CHART'S OWN TIMEFRAME IS NOTHING TO
//     // MODEL: there is no period to be part-way through.
//
// At the chart's own period there is no aggregation, so the request IS the
// expression — and the unmeasured realtime `lookahead` alignment, which is a
// question about two DIFFERENT timeframes, does not arise.
//
// ⛔ NOTHING ELSE IS WIDENED. A genuinely higher timeframe still refuses, and
// the controls below are what say so; without them this file would read as
// "requests are served now", which is false.
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

import { buildRuntimeIr } from '../../ast/pineRuntimeFrontend.js'
import { runtimeClockOpts } from '../../ast/pineRuntimeClock.js'

const N = 8
const BARS = Array.from({ length: N }, (_, i) => ({
  t: 1700000000 + i * 86400, o: 100, h: 102 + i, l: 98, c: 100 + i, v: 1000,
}))
const MEMBER = path.resolve(__dirname, '../../../../../../../tests/fixtures/member')
/** ⭐ THE STORE'S SPELLING, as `symbolScope.json` is keyed: `NYSE Arca` is a
 *  CONFIRMED row (witness `AMEX:SPY`, captured 2026-09-10). */
const SYMBOL = Object.freeze({ ticker: 'SPY', exchange: 'NYSE Arca' })

const build = (src, extra) => buildRuntimeIr(src, {
  ...runtimeClockOpts(false), tf: 'D', symbol: SYMBOL, bars: BARS, inputs: {}, ...extra,
})
const HEAD = ['//@version=5', 'indicator("t")'].join('\n') + '\n'
/** `plot(request.security(<sym>, <tf>, close[, lookahead = <x>]))` */
const req = (sym, tf, look) => `${HEAD}plot(request.security(${sym}, ${tf}, close`
  + (look ? `, lookahead = ${look}` : '') + '))\n'

describe('⭐⭐ a request for this chart, at this chart\'s period', () => {
  it('⛔⛔ CONTROL — A GENUINELY HIGHER TIMEFRAME IS STILL REFUSED', () => {
    // ⚰️ THE HALF THAT KEEPS THE GUARD, first. A weekly request off a daily
    // chart really does need the symbol as text and really does have a realtime
    // alignment nobody has measured. Nothing here serves it.
    const r = build(req('syminfo.tickerid', "'W'", null))
    expect(r.ok).toBe(false)
  })

  it('⭐⭐ the identity: it compiles, and IS the bare expression', () => {
    // ⭐ ASSERTED AS AN IDENTITY, not as "it compiles". A request that built but
    // produced some other program would pass a mere `ok` check while meaning
    // something else entirely.
    const got = build(req('syminfo.tickerid', "'D'", null))
    expect(got.ok, got.ok ? '' : `${got.refusal.guard}: ${got.refusal.message}`).toBe(true)
    expect(JSON.stringify(got.ir)).toBe(JSON.stringify(build(`${HEAD}plot(close)\n`).ir))
  })

  it('⭐ `syminfo.ticker` and `timeframe.period` reach the same answer', () => {
    // ⛔ ONE READER FOR "THIS CHART'S PERIOD" and one for "this chart's symbol":
    // a script may write either spelling and must not get two answers.
    const base = build(req('syminfo.tickerid', "'D'", null))
    // ⛔ `ok` FIRST. Comparing `ir` alone passes VACUOUSLY while all three
    // refuse — `undefined === undefined` — so the case could not distinguish
    // the fix from its absence (`lesson_a_fixture_that_cannot_distinguish_is_not_a_rail`).
    expect(base.ok, base.ok ? '' : `${base.refusal.guard}`).toBe(true)
    expect(JSON.stringify(build(req('syminfo.ticker', "'D'", null)).ir))
      .toBe(JSON.stringify(base.ir))
    expect(JSON.stringify(build(req('syminfo.tickerid', 'timeframe.period', null)).ir))
      .toBe(JSON.stringify(base.ir))
  })

  it('⭐⭐ `lookahead` is INERT here — on, off and absent are one program', () => {
    // ⭐ THE RC-H RULING, DERIVED RATHER THAN RESTATED: not "lookahead_on emits
    // X" but "it emits whatever the others emit". There is no period to be
    // part-way through, so the unmeasured realtime alignment does not arise.
    const off = build(req('syminfo.tickerid', "'D'", 'barmerge.lookahead_off'))
    const on = build(req('syminfo.tickerid', "'D'", 'barmerge.lookahead_on'))
    const bare = build(req('syminfo.tickerid', "'D'", null))
    expect(off.ok && on.ok && bare.ok,
      off.ok ? '' : `${off.refusal.guard}: ${off.refusal.message}`).toBe(true)
    expect(JSON.stringify(off.ir)).toBe(JSON.stringify(bare.ir))
    expect(JSON.stringify(on.ir)).toBe(JSON.stringify(bare.ir))
  })

  it('⛔ CONTROL — a FOREIGN symbol is untouched, and still takes the request path', () => {
    // ⭐ NON-VACUITY FOR THE IDENTITY: if every request now folded to its value
    // argument, this would ALSO equal `plot(close)` — and it must not, because
    // AAPL's close is not this chart's close.
    const foreign = build(req('"AAPL"', "'D'", null))
    expect(foreign.ok, foreign.ok ? '' : `${foreign.refusal.guard}`).toBe(true)
    expect(JSON.stringify(foreign.ir))
      .not.toBe(JSON.stringify(build(`${HEAD}plot(close)\n`).ir))
  })

  it('⛔⛔ CONTROL — A REBOUND `period` IS NOT THE CHART PERIOD', () => {
    // ⚰️ THE HAZARD `pine.js` NAMES IN SO MANY WORDS: *"a script may write
    // `period = \"60\"`"*. `OWN_TF_NAMES` holds the BARE `period` as well as
    // `timeframe.period`, and a bare identifier can be shadowed — so folding it
    // to the chart's period without asking the scope would answer with the
    // wrong series under the right name, which is the one outcome this lane
    // refuses to trade for coverage.
    const src = `${HEAD}period = "W"`
      + '\nplot(request.security(syminfo.tickerid, period, close))\n'
    const r = build(src)
    // It must NOT silently become the identity. Either it refuses, or it is a
    // real weekly request — what it must never be is `plot(close)`.
    expect(JSON.stringify(r.ir))
      .not.toBe(JSON.stringify(build(`${HEAD}plot(close)
`).ir))
  })

  it('⛔ CONTROL — the deprecated bare spelling is unchanged', () => {
    // It already worked through the columnar lane; this change must not move it.
    const bare = build(`${HEAD}plot(security(syminfo.tickerid, 'D', close))\n`)
    expect(bare.ok, bare.ok ? '' : `${bare.refusal.guard}`).toBe(true)
  })

  it('⭐⭐ THE PRODUCT CLAIM — the firm\'s own indicator walks past v2:261', () => {
    // ⚠⚠ ON A DAILY BUILD, AND THE QUALIFIER IS THE POINT. v2 BRANCHES on the
    // chart's timeframe: `if isDaily` calls the helper directly, and line 261 is
    // the NON-DAILY arm. On a daily build the requested 'D' is this chart's own
    // period, so the request folds; on an intraday build it is a genuine higher
    // timeframe and the vendor measurement still stops it — pinned in
    // `irSymbolFold.test.js` with `basePeriod: '60'`.
    //
    // ⛔ `basePeriod`, NOT `tf`. `basePeriodOf` reads `opts.basePeriod`; passing
    // `tf: '5'` leaves the lane on its default and silently builds a DAILY
    // chart. That cost a wrong diagnosis while this change was being made.
    //
    // v2:261 is a same-timeframe self request:
    //   [a,…,h] = request.security(syminfo.tickerid, 'D', f_getDailyData(),
    //                              lookahead = barmerge.lookahead_off)
    const file = path.join(MEMBER, 'uncharted-volume-v2.pine')
    expect(fs.existsSync(file), 'the member fixture is missing').toBe(true)
    const r = build(fs.readFileSync(file, 'utf8'), { bars: undefined })
    // ⛔ IT NEED NOT BUILD — this script has further walls, and saying otherwise
    // would be the build-count overreach this programme keeps correcting. What
    // must be true is that 261 is no longer where it stops.
    if (!r.ok) {
      expect(r.refusal.message, `still stopped at ${r.refusal.line}`)
        .not.toMatch(/realtime half of this alignment/)
    }
  })
})
