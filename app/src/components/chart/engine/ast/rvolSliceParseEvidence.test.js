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
    //
    // ⛔ THE ASSERTION NAMES THE CAPABILITY, NOT THE LINE. A line number would
    // move on any edit to the script and would have to be re-pinned for reasons
    // that say nothing about the engine.
    const rt = buildRuntimeIr(src)
    expect(rt.ok).toBe(false)
    expect(rt.refusal.message).toMatch(/tuple|text|value-model|collection|loop|request|drawing/i)
    // ⭐ AND IT GETS FURTHER THAN THE HEADER: a floor, so a regression that put
    // the wall back at the first input block fails here rather than passing on
    // a vaguer sentence.
    expect(rt.diagnostics.statements).toBeGreaterThan(40)
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
