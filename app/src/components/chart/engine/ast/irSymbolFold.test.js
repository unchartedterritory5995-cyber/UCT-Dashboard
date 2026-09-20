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
    expect(without.diagnostics.statements).toBe(77)
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

  it('⛔⛔ THE NEXT BLOCKER IS NAMED TO ITS LINE — v2:251, and it is STRUCTURAL', () => {
    // ⭐ `[a, b, c, d, e, f, g, h] = f_getDailyData()` — an eight-value destructure
    // from a user function. `runtime:tuple` is *"a tuple — the runtime has no
    // multiple-value form yet"*, which is a CAPABILITY this lane does not have,
    // not a wire somebody forgot: the IR has no way to carry more than one value
    // out of a call.
    //
    // ⛔ AND IT IS OFF THE CRITERION (owner, 2026-09-13; ruling D2). The pane is
    // driven by the DEFINITION lane, which renders this script's four plots and
    // both tables today. Naming it here is what stops it being rediscovered as a
    // mystery; chasing it is not this wave's work.
    // ⚰️ THIS PINNED `runtime:tuple` AT 251, and the tuple capability landed
    // (runtime/__tests__/tuples.test.js): an eight-value destructure from a
    // user function now lowers. The blocker behind it is the REQUEST the
    // destructure reads from, which is the next capability and is still off
    // the criterion for the same ruling-D2 reason recorded above.
    expect(withSym.refusal.guard).toBe('runtime:request-with-state')
    // ⭐ AND THE FUNCTION BEHIND IT WAS ALREADY REPORTED, so the two facts agree:
    // the definition was skipped at 190 and its CALL is what the lane now reaches.
    // ⭐ The skip list moves with the capabilities too, so this asserts the
    // PROPERTY the case is about — the function behind the blocker was named,
    // with its line — rather than a frozen string.
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
