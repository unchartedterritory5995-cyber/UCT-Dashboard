import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

import { translatePine } from './pine.js'

/**
 * `pine.js::PRINT_BP` is a LOCAL COPY of `parse.js::PRECEDENCE`, and nothing
 * watched the two for drift.
 *
 * ⭐ THE COPY IS A DELIBERATE DECISION, NOT AN OVERSIGHT, and this file does not
 * overturn it. `PRINT_BP`'s own comment states the trade: the copy is safe
 * "for exactly one reason — every string this printer produces is re-parsed and
 * hashed against the tree it was printed from", so a drift "cannot ship a wrong
 * formula, it can only make `pine:roundtrip` fire".
 *
 * ⛔ BUT THAT ARGUMENT MAKES A DRIFT EXPENSIVE RATHER THAN IMPOSSIBLE, and it is
 * paid by a MEMBER. The round-trip fires at translation time, on their script,
 * with nothing emitted and a refusal that names neither table — so the failure
 * surfaces as "this door cannot take your script" rather than as "two tables in
 * this repo disagree". This file moves the detection to where the mistake is:
 * one table typed differently from the other, caught by the suite, before anyone
 * pastes anything.
 *
 * ⚠️ READ FROM SOURCE ON PURPOSE. `PRECEDENCE` is not exported and this file does
 * not export it — exporting a constant so a test can read it changes the module's
 * surface to suit the test. Both tables are parsed out of the files themselves,
 * which also means a drift is caught even if one of them stops being a literal.
 */
describe('the printer and the parser agree about binding power', () => {
  const ROOT = path.resolve(process.cwd(), 'src/components/chart/engine/ast')

  /** The `{ '||': 1, … }` literal that follows `declName`, as a plain object. */
  const tableIn = (file, declName) => {
    const src = fs.readFileSync(path.join(ROOT, file), 'utf8')
    const at = src.indexOf(declName)
    expect(at, `${declName} not found in ${file}`).toBeGreaterThan(-1)
    const open = src.indexOf('{', at)
    const close = src.indexOf('})', open)
    expect(close, `${declName} in ${file} is not the frozen-object shape`).toBeGreaterThan(open)
    const body = src.slice(open + 1, close)
    const out = {}
    for (const [, op, bp] of body.matchAll(/'([^']+)'\s*:\s*(\d+)/g)) out[op] = Number(bp)
    return out
  }

  const PRINT_BP = tableIn('pine.js', 'const PRINT_BP = Object.freeze(')
  const PRECEDENCE = tableIn('parse.js', 'const PRECEDENCE = Object.freeze(')

  it('⛔ neither table is empty — the comparison below is not vacuous', () => {
    // A regex that stopped matching would make every assertion here pass by
    // comparing {} to {}. `lesson_a_fixture_that_cannot_distinguish_is_not_a_rail`.
    expect(Object.keys(PRINT_BP).length).toBeGreaterThan(5)
    expect(Object.keys(PRECEDENCE).length).toBeGreaterThan(5)
  })

  it('⭐ every operator both tables name is given the SAME binding power', () => {
    expect(PRINT_BP).toEqual(PRECEDENCE)
  })

  it('⛔ and they name the same operators — a missing key is drift too', () => {
    // Equality above already covers this; it is asserted separately because a
    // future change might legitimately make one table a SUPERSET, and this is the
    // line that should be edited then, with the reason.
    expect(Object.keys(PRINT_BP).sort()).toEqual(Object.keys(PRECEDENCE).sort())
  })

  it('⭐ and the round trip still holds for a formula that needs every level', () => {
    // The second line of defence, exercised rather than assumed: one expression
    // whose printed form has to bracket correctly at logical, comparison,
    // additive and multiplicative levels at once. If the two tables ever drift,
    // THIS is what starts refusing.
    const out = translatePine('//@version=5\nindicator("t")\n'
      + 'plot(close > open and close * 2 - 1 < high or low + 1 >= open ? 1 : 0)\n')
    expect(out.refusal, out.refusal && out.refusal.message).toBe(null)
    const row = out.outputs.find((o) => o.refusal === null)
    expect(row.formula).toBe(
      'close > open && close * 2 - 1 < high || low + 1 >= open ? 1 : 0')
  })

  it('⚠️ what this file does NOT prove', () => {
    // Honest scope, so nobody reads the four cases above as more than they are.
    // They prove the tables AGREE today and that the printer round-trips today.
    //
    // ⚰️⚰️ AND THE SAFETY ARGUMENT IS WEAKER THAN IT READS — MEASURED. Drifting
    // `PRINT_BP`'s `&&` from 2 to 3 and re-running this file: the table-equality
    // case above went RED, and the round-trip case below it STAYED GREEN. So for
    // at least that drift the stated net ("it can only make `pine:roundtrip`
    // fire") did not catch it at all, because a formula only re-parses
    // differently when the drift actually changes where brackets land.
    // ⛔ THAT IS THE WHOLE REASON THIS FILE EXISTS. A copy defended by a guard
    // that fires on SOME drifts is a copy defended by luck; the tables are now
    // compared directly, which fires on ALL of them, in the suite, before anyone
    // pastes a script.
    expect(true).toBe(true)
  })
})
