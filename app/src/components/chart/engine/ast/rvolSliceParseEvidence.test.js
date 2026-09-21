// app/src/components/chart/engine/ast/rvolSliceParseEvidence.test.js
//
// ─── THE ACCEPTANCE SCRIPT IS REFUSED BY CAPABILITY, NEVER BY LINE SHAPE ────
//
// F2 of the RVOL slice — "Strong Start RVOL Dashboard" (MPL-2.0, © finallynitin),
// already in `corpus/committed`. It is a watchlist dashboard: typed user
// functions, generic arrays, a loop of `request.security` calls, one table.
//
// None of that is built yet and this file does not pretend otherwise. What it
// pins is the DIFFERENCE between "this Pine line is not a shape the translator
// reads" and "we do not do collections yet": the first is a dead end for the
// member and for us, the second is a capability with a name, a census row and a
// wave. Typed parameters and generic syntax were the two reasons this script
// used to fail the first way.
//
// ⛔ IT MUST STILL BE REFUSED. Collections, loops, requests and tables are the
// rest of the wave; a green verdict here would mean the door had begun accepting
// a script it cannot actually run.
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { translatePine } from './pine.js'
import { buildRuntimeIr } from './pineRuntimeFrontend.js'

const F2 = path.resolve(
  process.cwd(),
  '../corpus/committed/strong-start-rvol-dashboard__36140b1cbe.pine')

describe('RVOL slice parse evidence (F2)', () => {
  const src = fs.readFileSync(F2, 'utf8')
  const out = translatePine(src, { strict: true })
  const rows = [...(out.refusals || []), ...(out.notes || [])].filter((r) => r && r.message)
  const sentences = rows.map((r) => r.message).join(' | ')

  it('carries NO shape refusals at all — measured 3 before, 0 after', () => {
    // ⭐ THE DISCRIMINATING NUMBER. At f34b1830c this script produced three
    // "not a shape the translator reads" sentences; with typed parameters and
    // generic syntax read, it produces none. A count is what makes this rail
    // able to fail, and it failed at baseline when it was run there.
    const shape = rows.filter((r) => /not a shape the translator reads/.test(r.message))
    expect(shape.map((r) => `L${r.line}`)).toEqual([])
  })

  it('moves the runtime lane past the header and onto a real capability', () => {
    // ⚰️ A TYPED HEADER USED TO READ AS AN ARITY ERROR — `calcDaily(simple int N)`
    // counted as two parameters. That specific defect is railed, non-vacuously,
    // by `udfTypedParams.test.js`; asserting it HERE proves nothing, because F2
    // refuses earlier than its own function definitions in both builds, so the
    // assertion is green on the broken one too
    // (`lesson_a_fixture_that_cannot_distinguish_is_not_a_rail`).
    // What this script CAN say is WHERE THE RUNTIME WALL NOW STANDS, and that
    // is this rail's whole job — it is a measurement that moves as capabilities
    // land, not a fixed expectation.
    //
    // ⭐ THE LEDGER OF WHERE IT HAS STOOD, newest last:
    //   · the text value model (2026-09-19, when this rail was written)
    //   · `input.text_area` — the paste box itself — once text, arrays, split
    //     and the loop had landed
    //   · L79 `runtime:tuple` (2026-09-20), after the text-input door opened.
    //     50 of the script's statements now compile.
    //   · L79 `runtime:request-with-state`, once tuples landed — the request
    //     whose value is `calcDaily(lookback)`.
    //   · L57 `runtime:history-expression` (2026-09-20), once `request.security`
    //     landed and the state check narrowed to `readsOuterSlot`: a user
    //     function inside a request is the documented shape, so the lane walked
    //     through L79 and into `calcDaily`'s own body.
    //
    // ⭐⭐ AND THE NEW WALL IS THE HONEST ONE, which is worth saying because it
    // reads like a step BACKWARDS — the line number fell from 79 to 57. It did
    // not: 57 is `ta.sma(volume[1], N)` inside `calcDaily`, which has never
    // compiled in ANY context. Its definition was skipped and the refusal
    // deferred to the call site; L79 was simply refusing first. A window whose
    // LENGTH is a `simple int` parameter cannot fold before bar 0, so the ring
    // cannot be sized — which needs the body lowered per CALL SITE, not once.
    // That is the next capability, and it is named rather than approximated.
    //
    //   · L96 `runtime:statement` — a symbol field (2026-09-20), once three
    //     things landed together: a request carrying a TUPLE from a helper, that
    //     helper lowered AT THE CALL SITE (so its columns are the requested
    //     symbol's, which is what `carriesColumn` named as the next capability),
    //     and a window's source HOISTED into its own committed series inside the
    //     request. L57 is gone.
    //
    // ⚰️ AND THE RECORDED DIAGNOSIS ABOVE WAS WRONG, which is worth keeping
    // rather than quietly deleting. "A window whose LENGTH is a `simple int`
    // parameter cannot fold" — measured 2026-09-20, a PLAIN `int` parameter
    // fails identically, and without history it fails as `function-global-state`
    // instead. `simple` was never the discriminator; ANY parameter used as a
    // length was. Substituting the argument at the call site is what fixed it.
    //
    // ⚠️ THE NEW WALL IS NOT A CAPABILITY. `syminfo.tickerid` is a value the
    // BINDING supplies, and this rail calls `buildRuntimeIr(src)` with no opts —
    // so the script now reaches the first line that needs to know which symbol
    // the chart is on. That is a harness condition, and saying so is the point:
    // the next step for this script is data, not grammar.
    //
    // ⛔ THE ASSERTION NAMES THE CAPABILITY, NOT THE LINE. A line number would
    // move on any edit to the script and would have to be re-pinned for reasons
    // that say nothing about the engine.
    const rt = buildRuntimeIr(src)
    expect(rt.ok).toBe(false)
    expect(rt.refusal.message).toMatch(
      /tuple|text|value-model|collection|loop|request|drawing|history|committed series|symbol/i)
    // ⭐ AND IT GETS FURTHER THAN THE HEADER: a floor, so a regression that put
    // the wall back at the first input block fails here rather than passing on
    // a vaguer sentence.
    expect(rt.diagnostics.statements).toBeGreaterThanOrEqual(50)
  })

  it('reads its generic declaration lines', () => {
    // `array<string> toks = str.split(norm, ",")` and friends. A shape refusal
    // on one of THOSE lines is the regression this test exists to catch.
    const genericLines = src.split('\n')
      .map((line, i) => [i + 1, line])
      .filter(([, line]) => /\barray<|\barray\.new</.test(line))
      .map(([n]) => n)
    expect(genericLines.length).toBeGreaterThan(0)
    for (const n of genericLines) {
      const here = rows.filter((r) => r.line === n).map((r) => r.message).join(' | ')
      expect(here).not.toMatch(/not a shape the translator reads/)
    }
  })

  it('still refuses it, by capabilities that have names', () => {
    expect(out.ok).toBe(false)
    expect(sentences).toMatch(/array|collection|vector|loop|request|drawing|table/i)
  })
})
