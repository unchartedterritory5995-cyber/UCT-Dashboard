// app/src/components/chart/engine/ast/runtimeCorpusCensus.measure.test.js
//
// ─── ⭐⭐ WHERE THE RUNTIME LANE DIES, RE-MEASURED ON DEMAND ─────────────────
//
// `docs/pine/RVOL-SLICE-RESUME.md` carries a corpus map under the instruction
// "⭐ Re-measure, do not quote." It had no way to re-measure: the map was
// hand-recorded prose, so every reader either trusted numbers that predated
// several waves of work or re-derived the harness from scratch.
//
// This is that command. Run it and read the printed table:
//
//     node node_modules/vitest/vitest.mjs run \
//       src/components/chart/engine/ast/runtimeCorpusCensus.measure.test.js
//
// ⛔⛔ IT ASSERTS NO COUNT, DELIBERATELY. A census pinned to a number is a
// ledger that goes red every time the lane improves, and this repo has several
// `.measure` files sitting in the failing baseline for exactly that reason. The
// numbers are PRINTED; what is asserted is only what must be true of any honest
// run of it — that the corpus was found, that every script was accounted for,
// and that the harness told the lane about the clock.
//
// ⛔⛔ THE CENSUS CAN CONTAMINATE ITSELF, and that is the one thing rail-worthy
// here. Run without `runtimeClockOpts`, it reports `runtime:realtime-untold` as
// a top blocker — which is the harness failing to say whether the newest bar is
// still forming, NOT a property of the corpus. A census that measures its own
// omission and files it as a finding about the subject is the failure mode this
// codebase keeps paying for, so the contamination is reproduced below and
// asserted to differ from the clean run.
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

import { buildRuntimeIr } from './pineRuntimeFrontend.js'
import { runtimeClockOpts } from './pineRuntimeClock.js'

const REPO = path.resolve(process.cwd(), '..')
const DIR = path.join(REPO, 'corpus/committed')

const SCRIPTS = fs.existsSync(DIR)
  ? fs.readdirSync(DIR).filter((f) => f.endsWith('.pine')).sort()
  : []

/** First blocker per script, or null when the whole script compiled. */
const census = (opts) => {
  const blockers = new Map()
  let compiled = 0
  for (const name of SCRIPTS) {
    const src = fs.readFileSync(path.join(DIR, name), 'utf8')
    let guard
    try {
      const built = buildRuntimeIr(src, opts)
      if (built.ok) { compiled += 1; continue }
      guard = (built.refusal && built.refusal.guard) || 'runtime:unnamed-refusal'
    } catch (err) {
      // ⛔ A THROW IS A RESULT, NOT A GAP. Swallowing it would quietly shrink
      // the denominator and make the lane look better than it is.
      guard = `threw:${(err && err.message ? err.message : String(err)).slice(0, 40)}`
    }
    blockers.set(guard, (blockers.get(guard) || 0) + 1)
  }
  return { compiled, blockers }
}

const CLEAN_OPTS = { tf: 'D', ...runtimeClockOpts(false) }

/** ⛔⛔ THE SECOND WAY THE CENSUS CONTAMINATES ITSELF, and it is the same
 *  disease as the clock: the harness fails to say something, and the lane's
 *  correct answer about the harness is filed as a finding about the corpus.
 *
 *  `objectTrees` is the caller SAYING it has already run the object pass and
 *  owns every `line|label|box|table|linefill` call in the source. On that
 *  promise those STATEMENTS become no-ops in this lane. `buildObjectLane`
 *  declares it on every call; a bare `buildRuntimeIr` does not, so the census
 *  above asks a two-lane pipeline with one lane and reports the missing half as
 *  a blocked script.
 *
 *  ⛔ AN EMPTY ARRAY STILL MEANS OWNERSHIP — `Array.isArray([])`, never
 *  `.length` — so this measures the VALUE half of every drawing script without
 *  needing the object pass to have run.
 *
 *  ⚠️ AND IT MEASURES ONLY THAT HALF, WHICH IS WHY IT IS A SECOND NUMBER AND
 *  NOT A REPLACEMENT. The real path hands over the actual trees, each of which
 *  must lower, and a tree that cannot lower is its own refusal. So the owned
 *  pass is a CEILING on the drawing scripts, not a promise about them. */
const OWNED_OPTS = { ...CLEAN_OPTS, objectTrees: [] }

describe('⭐⭐ the runtime lane, measured over the committed corpus', () => {
  it('⛔ CONTROL — the corpus is actually on disk', () => {
    // An empty result is a failed invocation until proven otherwise: every
    // count below is trivially satisfied by a corpus of zero scripts.
    expect(SCRIPTS.length).toBeGreaterThan(200)
  })

  it('⭐⭐ prints the first-blocker map, and every script is accounted for', () => {
    const { compiled, blockers } = census(CLEAN_OPTS)
    const rows = [...blockers.entries()].sort((a, b) => b[1] - a[1])
    const total = rows.reduce((n, [, c]) => n + c, 0) + compiled

    const pct = (n) => `${((n / SCRIPTS.length) * 100).toFixed(1)}%`
    const lines = [
      '',
      `RUNTIME-LANE CORPUS CENSUS  —  ${SCRIPTS.length} scripts, tf=D, clock told`,
      `compiled end to end : ${compiled}  (${pct(compiled)})`,
      '  n  guard',
      ...rows.map(([g, n]) => `${String(n).padStart(3)}  ${g}`),
      '',
    ]
    // eslint-disable-next-line no-console
    console.log(lines.join('\n'))

    // ⛔ THE ONLY ARITHMETIC WORTH ASSERTING: nothing fell out of the walk.
    // A script that neither compiled nor produced a named blocker has been
    // lost, and a census that loses scripts flatters whichever side it drops.
    expect(total).toBe(SCRIPTS.length)
  })

  it('⛔⛔ the harness TELLS the lane about the clock — the contamination rail', () => {
    // Reproduces the documented trap: omit `runtimeClockOpts` and the census
    // reports `runtime:realtime-untold` scripts that the clean run does not.
    // If this ever stops differing, either the trap is fixed upstream (good,
    // and this rail should be re-read) or the clean run has silently stopped
    // passing the clock (bad, and every number above is contaminated).
    const told = census(CLEAN_OPTS).blockers.get('runtime:realtime-untold') || 0
    const untold = census({ tf: 'D' }).blockers.get('runtime:realtime-untold') || 0

    expect(told).toBe(0)
    expect(untold).toBeGreaterThan(0)
  })

  it('⭐⭐ prints the SAME map with the drawing OWNED — the product\'s own question', () => {
    const bare = census(CLEAN_OPTS)
    const owned = census(OWNED_OPTS)
    const rows = [...owned.blockers.entries()].sort((a, b) => b[1] - a[1])
    const pct = (n) => `${((n / SCRIPTS.length) * 100).toFixed(1)}%`
    const lines = [
      '',
      `OWNED-DRAWING CENSUS  —  ${SCRIPTS.length} scripts, tf=D, clock told, `
      + 'objectTrees supplied (the VALUE half only)',
      `compiled end to end : ${owned.compiled}  (${pct(owned.compiled)})`
      + `   [bare: ${bare.compiled}]`,
      '  n  guard',
      ...rows.map(([g, n]) => {
        const was = bare.blockers.get(g) || 0
        return `${String(n).padStart(3)}  ${g}${was === n ? '' : `   (bare ${was})`}`
      }),
      '',
    ]
    // eslint-disable-next-line no-console
    console.log(lines.join('\n'))

    const total = rows.reduce((n, [, c]) => n + c, 0) + owned.compiled
    expect(total).toBe(SCRIPTS.length)
  })

  it('⛔⛔ the harness TELLS the lane WHO OWNS THE DRAWING — the second contamination rail', () => {
    // ⭐⭐ MEASURED 2026-09-21: `runtime:object-op` is **12 bare and 1 owned**,
    // and FOUR of those twelve then compile end to end. The row is a property
    // of the HARNESS, not of the corpus, and read as a work queue it says
    // "teach the value runtime to draw" — the one thing this lane must never
    // learn. The single survivor is `liquidity-levels-sonarlab` @L170,
    // `array.push(highLineArray, line.new(…))`: a drawing used as a VALUE, the
    // one genuinely missing capability in this family.
    //
    // ⛔ THE ASSERTION IS A DIFFERENCE, NOT A NUMBER. Pinning the owned count
    // to zero would go red the day a corpus script gains a drawing used as a
    // VALUE — which is a real gap and belongs in the table, not in a broken
    // rail. What must stay true is that declaring ownership REMOVES blockers of
    // this family; if it ever stops doing so, either the skip has been deleted
    // (and eight scripts' worth of routing has quietly become real work) or the
    // census has stopped declaring it.
    const bare = census(CLEAN_OPTS)
    const owned = census(OWNED_OPTS)
    const bareOps = bare.blockers.get('runtime:object-op') || 0
    const ownedOps = owned.blockers.get('runtime:object-op') || 0

    expect(bareOps).toBeGreaterThan(0)
    expect(ownedOps).toBeLessThan(bareOps)

    // ⛔⛔ AND THE FAMILY COUNT ALONE IS NOT ENOUGH TO SEE THE SKIP GO. Measured
    // by deleting the statement-path skip outright: the family count still
    // FELL (12 → 11), because the `var`/`:=` handle-binding branches carry
    // their own skip and a script whose drawing calls are all bindings still
    // differs. The rail read green through a mutation that removed the very
    // thing it exists to watch — `lesson_a_fixture_that_cannot_distinguish_is_not_a_rail`.
    //
    // ⭐ What the same mutation DOES move is the compiled count, which fell
    // straight back to the bare number. So the load-bearing half is that
    // declaring ownership buys whole SCRIPTS, not merely a smaller row.
    expect(owned.compiled).toBeGreaterThan(bare.compiled)
  })
})
