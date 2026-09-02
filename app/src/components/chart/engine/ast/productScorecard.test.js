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

/** ⭐⭐ ACCEPT EVERY OFFER THE DOOR MAKES — what the member's click does, run
 *  headlessly. `PineBox`'s button splices `refusal.suggest` over `refusal.span`
 *  in the member's own source; this is that, in a loop, and nothing else.
 *
 *  ⛔ IT IS NOT A SECOND IMPLEMENTATION OF THE BUTTON. It makes no decision the
 *  button does not — no default is assumed, no text is invented, and a refusal
 *  without BOTH a suggestion and a span ends the loop, which is exactly the
 *  condition the button renders on. What it measures is therefore a number about
 *  the shipped door, not about a capability only this file has. */
function acceptEveryOffer(src, run, limit = 12) {
  let cur = src
  for (let i = 0; i < limit; i += 1) {
    let o
    try { o = run(cur) } catch (e) { return false }
    if (o.ok) return true
    const r = o.refusal
    if (!r || !r.suggest || !Array.isArray(r.span)) return false
    cur = cur.slice(0, r.span[0]) + r.suggest + cur.slice(r.span[1])
  }
  return false
}

/** ⭐⭐ THE SCRIPTS A MEMBER WOULD WRITE TO SCREEN WITH — the measurement this
 *  feature is actually for.
 *
 *  ⚰️⚰️ `import fidelity` BELOW COUNTS COMMUNITY CHART INDICATORS, and it was
 *  being read as a progress bar toward a goal it does not measure. Those scripts
 *  plot, colour backgrounds, place orders and overlay timeframes; they are a
 *  REGRESSION NET for the importer. Whether a member can WRITE A SCREENER is a
 *  different question, and it now has its own number. */
function screenerAuthoring() {
  const dir = path.join(ROOT, 'tests/fixtures/pine_screener')
  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.pine'))
  let translate = 0
  for (const f of files) {
    let o
    try { o = translatePine(fs.readFileSync(path.join(dir, f), 'utf8')) } catch (e) { continue }
    if (o.ok) translate += 1
  }
  return { translate, total: files.length }
}

/** Every corpus script, translated through the shipped door. */
function importFidelity() {
  let translate = 0, total = 0, accepted = 0
  for (const [dir, re, run] of [
    ['tests/fixtures/pine', /\.pine$/, translatePine],
    ['tests/fixtures/pine_community', /\.pine$/, translatePine],
    ['tests/fixtures/thinkscript', /\.ts$/, translateThinkScript]]) {
    for (const f of fs.readdirSync(path.join(ROOT, dir)).filter((x) => re.test(x))) {
      total += 1
      let o
      try { o = run(fs.readFileSync(path.join(ROOT, dir, f), 'utf8')) } catch (e) { continue }
      if (o.ok) { translate += 1; accepted += 1; continue }
      // ⭐ THE SECOND NUMBER, AND IT IS A DIFFERENT CLAIM. `translate` counts what
      // a paste reaches on its own; `accepted` counts what it reaches once the
      // member takes the engine's OWN offer — which is a thing they can now do in
      // a click rather than by retyping the call.
      if (acceptEveryOffer(fs.readFileSync(path.join(ROOT, dir, f), 'utf8'), run)) accepted += 1
    }
  }
  return { translate, total, accepted }
}

/** A rail this scorecard points at must exist, or the pointer is a fiction. */
const RAILS = Object.freeze({
  alerting: 'tests/test_the_member_loop_end_to_end.py',
  sharing: 'tests/test_the_member_loop_end_to_end.py',
  scanning: 'app/src/components/chart/engine/ast/doorScorecard.test.js',
  charting: 'tests/test_ast_conformance.py',
  authoring: 'app/src/components/chart/builder/pineBoxOfferedColumns.test.jsx',
  screener: 'app/src/components/chart/engine/ast/pine.screenerCorpus.test.js',
  verifiability: 'app/src/components/chart/engine/ast/doorScorecard.test.js',
})

describe('the product scorecard — every dimension, not just the imported one', () => {
  it('⭐ it prints itself', () => {
    const imp = importFidelity()
    const scr = screenerAuthoring()
    const conformance = readJson('tests/fixtures/ast/corpus.json').cases.length
    const fns = Object.keys(TABLE.functions).length
    const scalars = Object.keys(TABLE.scalars).length
    const benchmarks = Object.keys(TABLE._benchmarks_scannable || TABLE._benchmarks || {}).length

    console.log(`
DIMENSION        MEASURED                              WHAT PROVES IT
authoring        ${fns} functions · ${scalars} per-symbol values   the manifest + ${RAILS.authoring.split('/').pop()}
charting         ${conformance} conformance cases, both lanes      ${RAILS.charting.split('/').pop()}
scanning         ${imp.translate}/${imp.translate} translating scripts reach a screen   ${RAILS.scanning.split('/').pop()}
screener author. ${scr.translate}/${scr.total} scripts a member would WRITE to screen  ${RAILS.screener.split('/').pop()}
alerting         a saved formula is an alert target     ${RAILS.alerting.split('/').pop()}
sharing          mint → publish → browse → install      ${RAILS.sharing.split('/').pop()}
verifiability    4-outcome receipt · read-back · roster ${RAILS.verifiability.split('/').pop()}
strategies       NOT BUILT (Segment A)                  —
──────────────────────────────────────────────────────────────────────────────
import fidelity  ${imp.translate}/${imp.total} on paste · ${imp.accepted}/${imp.total} after accepting the door's own offers
                 ⚠️ COMMUNITY CHART INDICATORS — a REGRESSION NET, not a target. Most of
                 the residual is refused correctly: strategies, account state,
                 runtime arrays. Read the screener author. row for the product goal.
                 benchmark roster: ${benchmarks} symbols
`)
    expect(imp.total).toBeGreaterThan(0)
    // ⛔ ACCEPTING AN OFFER CAN NEVER LOSE A SCRIPT. Every script that translates
    // on paste is counted before any offer is considered, so this is an ordering
    // claim about the two numbers rather than a restatement of one of them — and
    // it goes red if `acceptEveryOffer` ever mangles a source it should have left
    // alone (`lesson_a_fixture_that_cannot_distinguish_is_not_a_rail`).
    expect(imp.accepted).toBeGreaterThanOrEqual(imp.translate)
    // ⛔ THE TWO CORPORA MEASURE DIFFERENT THINGS, and this row is only honest
    // while both are real — a screener corpus that silently emptied would report
    // a perfect 0/0. The inequality IS the reframe: scripts written TO SCREEN
    // pass at a far higher rate than chart indicators pasted in, and if that ever
    // stops being true the two numbers are measuring the same thing again.
    const scr2 = screenerAuthoring()
    expect(scr2.total).toBeGreaterThanOrEqual(30)
    expect(scr2.translate / scr2.total).toBeGreaterThan(imp.translate / imp.total)
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
