// app/src/components/chart/engine/ast/irSymbolFold.test.js
//
// ─── ⭐⭐ STEP-5 FOLLOW-THROUGH — THE IR LANE READS THE SYMBOL, ONE AUTHORITY ─
//
// ⚰️ THE IR LANE HAD NO SYMBOL PLUMBING AT ALL, and the cost was measured on the
// member's own script. `buildRuntimeIr(uncharted-volume-v2.pine)`, told the
// clock, stopped at **v2:249** — `if not isRatioSymbol`, where `isRatioSymbol` is
// v2:224's `str.contains(syminfo.ticker, "/") or str.contains(syminfo.tickerid,
// "/")` — with *"a value that a symbol settles reached the evaluator unsettled"*.
//
// ⭐ THAT REFUSAL WAS CORRECT AND THE WIRE WAS MISSING, which is the R-K shape
// exactly: a `symtext` reaching the evaluator means the BINDING could not settle
// it. The definition lane has folded these since R-K (`computeFor`), the object
// lane since step 6 (`objectColumns`), and this one never did.
//
// ⛔⛔ THE FIX IS ONE AUTHORITY, NOT A THIRD READER. `bindConstsFor` moved from
// `nativeRegistry` to `bind.js` — beside `bindingConstants` and
// `symbolConstantsWith`, whose vocabulary it assembles — so a standalone front
// end can reach it without importing the indicator table, the server compute lane
// and the whole native roster behind one call for four constants. The registry
// re-exports the same binding; it is an alias, never a copy.
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { buildRuntimeIr } from './pineRuntimeFrontend'
import { runtimeClockOpts } from './pineRuntimeClock'
import { bindConstsFor } from './bind'
import { bindConstsFor as viaRegistry } from '../nativeRegistry'

const REPO = path.resolve(process.cwd(), '..')
const V2 = fs.readFileSync(
  path.join(REPO, 'tests/fixtures/member/uncharted-volume-v2.pine'), 'utf8')

/** ⭐ THE STORE'S SPELLING, NOT PINE'S. `symbolScope.json::confirmed` is keyed by
 *  what our own `ticker_meta` holds — SPY's exchange is `'NYSE Arca'`, witnessed
 *  as Pine's `AMEX`. Handing `'AMEX'` here would look more correct and resolve
 *  NOTHING, because the map's keys are the other vocabulary. */
const SYMBOL = Object.freeze({ ticker: 'SPY', exchange: 'NYSE Arca' })

const build = (extra) => buildRuntimeIr(V2, { ...runtimeClockOpts(false), tf: 'D', ...extra })

describe('⭐⭐ v2:249 clears when the IR lane is told the symbol', () => {
  const without = build({})
  const withSym = build({ symbol: SYMBOL })

  it('⛔ CONTROL — with NO symbol it still refuses at 249, by name', () => {
    // ⭐ THE HALF THAT MAKES THE NEXT CASE A MEASUREMENT. Without this, "249
    // cleared" could be true because something unrelated moved, and a fold that
    // did nothing would read identically. R-K's deliberate choice is a LOUD
    // refusal naming the field rather than a half-resolved string.
    expect(without.ok).toBe(false)
    expect(without.refusal.line).toBe(249)
    expect(without.refusal.message).toContain('syminfo.ticker')
    // ⚰️ 2026-09-23: 77 → 75, AND THE CODE WAS CHECKED BEFORE THE NUMBER WAS.
    // `f_getVolumeUnit` (v2:161) ends in an `if`/`else if`/`else` chain. That
    // now lowers through the VALUE path — one `lowerExpr` per arm, as the
    // block-valued BINDING has always done — instead of `lowerStmts`, and this
    // counter only ticks inside `lowerStmts`. Two lines the lane still
    // processes are no longer counted.
    //
    // ⛔ THE LANE'S REACH IS UNCHANGED, and that was measured, not assumed:
    // same refusal guard, same line, and a BYTE-IDENTICAL skipped-function set
    // (names, lines, guards). Both member scripts moved by exactly 2
    // (v2 77→75, v1 76→74), so the differential this file reasons about holds.
    //
    // ⛔ THIS IS NOT THE 2026-09-20 INCIDENT. That one moved the number UP
    // because an `if`'s BODY was lowered before its TEST, so the lane stopped
    // CHECKING and looked like it had gone further. Source order is preserved
    // here and is now railed DIRECTLY — `functionBodyBlockValue.test.js`,
    // "SOURCE ORDER" — with a tuple in both positions and the test's line
    // required to win. A count could never have said which way round they ran.
    expect(without.diagnostics.statements).toBe(75)
  })

  it('⭐⭐ …and WITH the symbol, 249 is gone and the lane walks further', () => {
    expect(withSym.refusal.line).not.toBe(249)
    expect(withSym.refusal.message).not.toContain('unsettled')
    // ⛔ FURTHER, NOT MERELY DIFFERENT. Two more statements lowered than the
    // control — a refusal that moved without the lane advancing would be a
    // different defect wearing this one's clothes.
    expect(withSym.diagnostics.statements).toBeGreaterThan(without.diagnostics.statements)
    // ⭐ A FLOOR, NOT A FIXED NUMBER. This pinned 79; tuples and the text-input
    // door carried it to 88, and re-pinning an exact figure after every
    // capability turns a measurement into maintenance. What the case is about
    // is that the symbol makes the lane go FURTHER, and a floor says that
    // while still failing if the lane goes backwards.
    expect(withSym.diagnostics.statements).toBeGreaterThanOrEqual(79)
  })

  it('⛔⛔ THE NEXT BLOCKER IS NAMED TO ITS LINE — v2:261, and it is a VENDOR FACT', () => {
    // ⚠ THIS CASE'S SUBJECT KEEPS MOVING, AND THAT IS THE MEASUREMENT.
    // It pinned `runtime:tuple` at 251; tuples landed, so it became the REQUEST
    // the destructure reads from (`runtime:request-with-state`); the state check
    // then narrowed from `readsSlot` to `readsOuterSlot` — a user function inside
    // a request is the documented shape, not this script's state — and the lane
    // walked past that too.
    //
    // ⭐⭐ WHERE IT STOPS NOW IS NOT A MISSING CAPABILITY. v2:261 passes
    // `lookahead = barmerge.lookahead_on`, and vendor packet M1 measured only the
    // HISTORICAL half of that alignment — the realtime half needs an open market
    // and is still owed. Serving it on a guess would put a number on screen that
    // nobody could have traded on, which is the most valuable-LOOKING wrong
    // answer this engine could give. So this blocker clears with a MEASUREMENT,
    // not with code, and it is the one shape that should never be 'fixed' by
    // making the lane go further.
    //
    // ⛔ STILL OFF THE CRITERION (owner, 2026-09-13; ruling D2). The pane is
    // driven by the DEFINITION lane, which renders this script's four plots and
    // both tables today. Naming it here is what stops it being rediscovered as a
    // mystery; chasing it is not this wave's work.
    // ⚰️ 2026-09-23 — THE BLOCKER IS TIMEFRAME-CONDITIONAL, AND THE WARNING
    // ABOVE IS HONOURED RATHER THAN OVERRIDDEN. It still clears only with the
    // MEASUREMENT, for the builds that need one.
    //
    // v2 BRANCHES ON THE CHART TIMEFRAME ITSELF — read the script at 247:
    //     if isDaily
    //         [a…h] = f_getDailyData()                  // direct call
    //     else
    //         [a…h] = request.security(…, 'D', …)       // line 261
    // Line 261 is the NON-DAILY arm. On a daily build the requested 'D' IS this
    // chart's period, so there is no higher-timeframe bar to be part-way through
    // and no alignment to measure. On an INTRADAY build it is a genuine higher
    // timeframe and the vendor fact still stops it.
    //
    // ⛔⛔ THE DAILY HALF IS A PROPERTY, NOT A LINE, AND THAT IS THIS FILE'S OWN
    // RULE: *"A FLOOR, NOT A FIXED NUMBER — re-pinning an exact figure after
    // every capability turns a measurement into maintenance."* It was pinned at
    // 261 twice in two commits and moved both times (to the tuple shape, then
    // past it to `ta.cum` at 227) — which is the lane ADVANCING, exactly what
    // this case wants to see. What must stay true is that the daily build is no
    // longer stopped by the VENDOR fact.
    expect(withSym.ok).toBe(false)
    expect(withSym.refusal.message,
      `daily build still on the vendor fact at ${withSym.refusal.line}`)
      .not.toMatch(/realtime half of this alignment/)
    // ⭐ AND IT GOT FURTHER THAN THE NO-SYMBOL CONTROL — a floor, so a lane that
    // went BACKWARDS still fails here.
    expect(withSym.diagnostics.statements)
      .toBeGreaterThan(without.diagnostics.statements)

    // ⭐⭐ THE VENDOR FACT, PINNED EXACTLY, WHERE IT GENUINELY APPLIES. This half
    // does NOT drift with capability: it clears only when the realtime half of
    // the alignment is measured on an open market.
    // ⛔ `basePeriod` — NOT `tf`. `basePeriodOf` reads `opts.basePeriod`; passing
    // `tf: '5'` leaves the lane on its default and silently builds a DAILY
    // chart, which cost a wrong diagnosis while this was being written.
    const intraday = build({ symbol: SYMBOL, basePeriod: '60' })
    expect(intraday.refusal.guard).toBe('runtime:request')
    expect(intraday.refusal.line).toBe(261)
    expect(intraday.refusal.message).toMatch(/lookahead/)
    // ⭐ AND THE FUNCTIONS BEHIND IT WERE ALREADY REPORTED, so the two facts
    // agree: nothing was swallowed on the way to the blocker.
    // ⭐ The skip list moves with the capabilities too, so this asserts the
    // PROPERTY the case is about — every skipped definition named, with its line
    // and its guard — rather than a frozen string.
    expect(withSym.diagnostics.skippedFunctions.length).toBeGreaterThan(0)
    for (const entry of withSym.diagnostics.skippedFunctions) {
      expect(entry).toMatch(/^\w+@\d+ [a-z]+:[a-z-]+$/)
    }
  })

  it('⛔ ONE AUTHORITY — the registry re-exports the SAME function object', () => {
    // ⚰️ The defect this guards against has already happened once on this exact
    // call: the plot lane's `symbol` was fixed at R-K and the object lane's was
    // never written, so v2 drew four correct columns and no table. Identity, not
    // equality — two functions that agree today are the shape that drifts.
    expect(viaRegistry).toBe(bindConstsFor)
  })

  it('⛔ and the fold is REAL — the same assembly settles the field it names', () => {
    // Non-vacuity for the wiring above: the constants actually carry
    // `syminfo.ticker`, and carry nothing symbol-shaped when no symbol is given.
    const withK = bindConstsFor({ tf: 'D', inputs: {}, symbol: SYMBOL })
    const withoutK = bindConstsFor({ tf: 'D', inputs: {} })
    expect(Object.keys(withK)).toContain('syminfo.ticker')
    expect(Object.keys(withoutK).some((k) => k.startsWith('syminfo.'))).toBe(false)
  })
})
