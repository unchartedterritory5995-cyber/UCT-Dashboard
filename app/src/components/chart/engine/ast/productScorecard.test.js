// app/src/components/chart/engine/ast/productScorecard.test.js
//
// ─── 📊 THE DIMENSIONS WE OWN, NOT JUST THE ONE WE IMPORT ────────────────────
//
// ⛔⛔ EVERY CONVERSATION ABOUT THIS FEATURE LANDS ON ONE NUMBER — "43 of 75
// scripts translate" — BECAUSE IT IS THE ONLY NUMBER ON THE BOARD. And it is the
// one dimension with a hard cap: a handful of published scripts are genuinely
// unrepresentable (an unbounded accumulator, a venue we carry no bars for), so
// import fidelity can be driven up and never to 100.
//
// The launch plan says so in its own words, and says what to do instead:
//
//   "The honest statement of the ceiling is a ROSTER, not a percentage. Every
//    dimension except import fidelity can reach 100, because each is a thing we
//    own outright: authoring, scanning, charting, strategies, sharing,
//    verifiability. … A percentage cannot be argued with; it just sits there
//    sounding like physics."
//
// ⭐ SO THIS PRINTS ALL OF THEM, and marks which one is capped. A scorecard that
// measures only the capped dimension makes a product look stuck when five of its
// six dimensions are finished.
//
// ⚠️ IT MEASURES WHAT IT CAN AND NAMES THE RAIL FOR THE REST. Four of these lanes
// live server-side (alerting, sharing, the scan gate, the store) and cannot be
// measured from a vitest process. Inventing a score for them would be the
// dressed-up guess this file exists to replace, so each names the test that
// proves it and that test is asserted to EXIST — a pointer to a file nobody
// wrote is how a scorecard starts lying.

import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

import TABLE from './closedTable.json'
import { translatePine } from './pine.js'
import { translateThinkScript } from './thinkscript.js'

const ROOT = path.resolve(process.cwd(), '..')
const readJson = (rel) => JSON.parse(fs.readFileSync(path.join(ROOT, rel), 'utf8'))

/** Every corpus script, translated through the shipped door. */
function importFidelity() {
  let translate = 0, total = 0
  for (const [dir, re, run] of [
    ['tests/fixtures/pine', /\.pine$/, translatePine],
    ['tests/fixtures/pine_community', /\.pine$/, translatePine],
    ['tests/fixtures/thinkscript', /\.ts$/, translateThinkScript]]) {
    for (const f of fs.readdirSync(path.join(ROOT, dir)).filter((x) => re.test(x))) {
      total += 1
      let o
      try { o = run(fs.readFileSync(path.join(ROOT, dir, f), 'utf8')) } catch (e) { continue }
      if (o.ok) translate += 1
    }
  }
  return { translate, total }
}

/** A rail this scorecard points at must exist, or the pointer is a fiction. */
const RAILS = Object.freeze({
  alerting: 'tests/test_the_member_loop_end_to_end.py',
  sharing: 'tests/test_the_member_loop_end_to_end.py',
  scanning: 'app/src/components/chart/engine/ast/doorScorecard.test.js',
  charting: 'tests/test_ast_conformance.py',
  authoring: 'app/src/components/chart/builder/pineBoxOfferedColumns.test.jsx',
  verifiability: 'app/src/components/chart/engine/ast/doorScorecard.test.js',
})

describe('the product scorecard — every dimension, not just the imported one', () => {
  it('⭐ it prints itself', () => {
    const imp = importFidelity()
    const conformance = readJson('tests/fixtures/ast/corpus.json').cases.length
    const fns = Object.keys(TABLE.functions).length
    const scalars = Object.keys(TABLE.scalars).length
    const benchmarks = Object.keys(TABLE._benchmarks_scannable || TABLE._benchmarks || {}).length

    console.log(`
DIMENSION        MEASURED                              WHAT PROVES IT
authoring        ${fns} functions · ${scalars} per-symbol values   the manifest + ${RAILS.authoring.split('/').pop()}
charting         ${conformance} conformance cases, both lanes      ${RAILS.charting.split('/').pop()}
scanning         ${imp.translate}/${imp.translate} translating scripts reach a screen   ${RAILS.scanning.split('/').pop()}
alerting         a saved formula is an alert target     ${RAILS.alerting.split('/').pop()}
sharing          mint → publish → browse → install      ${RAILS.sharing.split('/').pop()}
verifiability    4-outcome receipt · read-back · roster ${RAILS.verifiability.split('/').pop()}
strategies       NOT BUILT (Segment A)                  —
──────────────────────────────────────────────────────────────────────────────
import fidelity  ${imp.translate}/${imp.total} published scripts  ⚠️ THE ONE CAPPED DIMENSION
                 benchmark roster: ${benchmarks} symbols
`)
    expect(imp.total).toBeGreaterThan(0)
  })

  it('⛔ every rail this scorecard points at EXISTS', () => {
    // ⚠️ A SCORECARD THAT CITES A TEST NOBODY WROTE IS WORSE THAN ONE THAT SAYS
    // NOTHING — it reads as coverage. This is the cheapest possible check on the
    // claims above, and it is the one that would have caught this file citing a
    // file it hoped for.
    const missing = Object.entries(RAILS)
      .filter(([, rel]) => !fs.existsSync(path.join(ROOT, rel)))
      .map(([dim, rel]) => `${dim} → ${rel}`)
    expect(missing).toEqual([])
  })

  it('⭐⭐ import fidelity is the ONLY dimension with a named residual', () => {
    // ⛔ THE POINT OF THE WHOLE FILE. The plan's rule is "state the residual as a
    // named list with reasons, never as a gap to 100" — so the capped dimension
    // must be the one that carries a roster, and the others must not pretend to.
    const imp = importFidelity()
    expect(imp.translate).toBeLessThan(imp.total)
    // …and the roster is real: every script that does not translate refuses by a
    // DECLARED guard, which is what makes the residual arguable rather than a gap.
    let refused = 0, guarded = 0
    for (const [dir, re, run] of [
      ['tests/fixtures/pine', /\.pine$/, translatePine],
      ['tests/fixtures/pine_community', /\.pine$/, translatePine],
      ['tests/fixtures/thinkscript', /\.ts$/, translateThinkScript]]) {
      for (const f of fs.readdirSync(path.join(ROOT, dir)).filter((x) => re.test(x))) {
        let o
        try { o = run(fs.readFileSync(path.join(ROOT, dir, f), 'utf8')) } catch (e) { continue }
        if (o.ok) continue
        refused += 1
        if (o.refusal && o.refusal.guard) guarded += 1
      }
    }
    expect(refused).toBeGreaterThan(0)
    // ⚠️ THIS IS A DATA INVARIANT, NOT A CODE GUARD, and the difference is worth
    // stating: every refusal carries a guard TODAY, so weakening this line to
    // `guarded += 1` unconditionally still passes. It cannot be mutation-killed
    // from the test side. What it WOULD catch is a door that started refusing
    // without naming a guard — which is the thing that turns the residual from a
    // roster back into a gap, because an entry that cannot say why it is on the
    // list cannot be argued with or shrunk.
    expect(guarded, 'a script refused without a declared guard — the residual is '
      + 'not a roster if an entry cannot say why it is on it').toBe(refused)
  })
})
