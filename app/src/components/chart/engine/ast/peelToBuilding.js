// app/src/components/chart/engine/ast/peelToBuilding.js
//
// ─── ⭐⭐ ONE PEELER, SHARED BY THE TWO CENSUSES THAT ASK ABOUT DISTANCE ─────
//
// `distanceToWorking.measure.test.js` asks how far the WHOLE corpus is;
// `nearestToWorking.measure.test.js` asks which scripts are ABOUT to work. Both
// need the same walk, and the walk has a history: its own header records three
// versions that were WRONG before their controls caught them. Two copies of
// that would be two opinions about what "distance" means
// (`lesson_a_second_authority_over_one_value`), so it lives here and both
// import it.
//
// ⛔ IT WAS EXTRACTED VERBATIM, NOT REWRITTEN. The controls that caught the
// three wrong versions stay in `distanceToWorking.measure.test.js` and still
// exercise this code — moving the function without moving its rails would have
// left the repo with an unproved peeler and a file full of green.
//
// ⭐ AND THE EXTRACTION IS WHY IT IS A MODULE AND NOT AN IMPORT BETWEEN TEST
// FILES: importing one `.test.js` from another RUNS it, so the 42-second corpus
// histogram executed twice on every suite run.
import fs from 'node:fs'
import path from 'node:path'

import { buildObjectLane } from '../runtime/objectLane.js'

export const REPO = path.resolve(process.cwd(), '..')
export const DIR = path.join(REPO, 'corpus/committed')

/** The committed corpus, sorted, or `[]` when it is not on disk. */
export const SCRIPTS = fs.existsSync(DIR)
  ? fs.readdirSync(DIR).filter((f) => f.endsWith('.pine')).sort()
  : []

/** One corpus script's source. */
export const readScript = (name) => fs.readFileSync(path.join(DIR, name), 'utf8')

const N = 60
/** ⚠️ SYNTHETIC BARS, DELIBERATELY. This walk asks whether a script BUILDS, and
 *  a build reads no data — the executing census supplies real SPY bars because
 *  its question is different. */
export const BARS = Array.from({ length: N }, (_, i) => ({
  t: 1700000000 + i * 86400,
  o: 100 + (i % 7), h: 104 + (i % 5), l: 96 - (i % 3), c: 100 + (i % 11), v: 1000000 + i,
}))

const LF = String.fromCharCode(10)
export const DEFAULT_CAP = 20

/** One build attempt → `null` when it built, else `{line, guard}`. */
export function refusalOf(src) {
  let r = null
  try {
    r = buildObjectLane(src, { tf: 'D', newestBarIsForming: false, bars: BARS })
  } catch (err) {
    return { line: 0, guard: `threw:${String(err && err.message).slice(0, 40)}` }
  }
  if (r.ok) return null
  const ref = r.refusal || {}
  const line = Number(ref.line || (ref.at && ref.at.line) || 0)
  return { line, guard: `${r.lane}/${ref.guard || 'unnamed'}` }
}

/** The name a line BINDS, or null. `x = e` / `x := e` / `var float x = e`.
 *
 *  ⛔ IT STRIPS THE COMMENT FIRST. A `//` line mentioning `foo = bar` is prose,
 *  and matching it would invent a binding nobody wrote — the CODE-NEVER-PROSE
 *  rule this repo has paid for repeatedly. */
export function bindingNameOf(line) {
  const hash = line.indexOf('//')
  const bare = hash >= 0 ? line.slice(0, hash) : line
  const m = bare.match(
    /^(\s*)(?:(?:var|varip)\s+)?(?:(?:float|int|bool|string|color|line|label|box|table)\s+)?([A-Za-z_]\w*)\s*:?=(?!=)/)
  return m ? { indent: m[1], name: m[2] } : null
}

/**
 * Peel one script. Returns `{distance, guards, reached}`.
 *
 * A REFUSAL WITH NO LINE CANNOT BE PEELED, and that is reported rather than
 * skipped. Whole-program refusals (`objects:no-objects-in-source`,
 * `pine:declaration-strategy`) name no line by construction — peeling would
 * loop forever or, worse, neutralise an arbitrary line and call it progress.
 *
 * A FAILING BINDING IS REPLACED, NOT DELETED, AND THAT IS THE WHOLE ACCURACY OF
 * THIS WALK. Blanking `x = <unsupported>` removes the NAME as well as the
 * capability, so every later line that reads `x` then refuses `pine:undefined`
 * — and each of those costs another peel. One unreadable expression
 * manufactures a cascade of walls that are not in the script.
 *
 * MEASURED 2026-09-22, and the scale is not subtle. Comparing the FIRST-BLOCKER
 * census (no peeling, so no cascade) against this walk's cumulative guard hits:
 *
 *     runtime/pine:undefined    14 scripts first-blocker   1,075 peel hits   77x
 *     runtime/pine:statement     3 scripts first-blocker     768 peel hits  256x
 *
 * Those are the top two rows of the guards-hit table, and they are the two most
 * inflated in it. A reader treating that table as a work queue is pointed
 * straight at the cascade rather than at the corpus.
 *
 * SWITCHING TO REPLACEMENT MOVED REAL NUMBERS: 4 scripts went UNREACHED ->
 * reached, 4 more got shorter, mean distance 7.09 -> 5.45 across the scripts
 * both methods reach, and NO script that used to reach stopped reaching.
 * `position-size-calc` went 12 -> 2, `wyckoff-accumulation-distribution`
 * UNREACHED -> 2.
 *
 * IT IS STILL AN ESTIMATE, and the substitution has its own bias: `0.0` keeps
 * the NAME but not the TYPE, so a binding that held a string or a drawing
 * handle comes back a float and its consumers may refuse for a new reason.
 * `preserveBindings` is a parameter for that reason — not because the old
 * behaviour is better, but because a reader comparing an old number with a new
 * one has to be able to reproduce the old one.
 */
export function peel(source, cap = DEFAULT_CAP, preserveBindings = true) {
  const work = source.split(LF)
  const guards = []
  for (let step = 0; step < cap; step += 1) {
    const ref = refusalOf(work.join(LF))
    if (!ref) return { distance: step, guards, reached: true }
    guards.push(ref.guard)
    const idx = ref.line - 1
    if (!(idx >= 0 && idx < work.length)) {
      return { distance: step, guards, reached: false, stuck: ref.guard }
    }
    const bound = preserveBindings ? bindingNameOf(work[idx]) : null
    const next = bound ? `${bound.indent}${bound.name} = 0.0` : ''
    if (work[idx] === next) {
      return { distance: step, guards, reached: false, stuck: ref.guard }
    }
    work[idx] = next
  }
  return { distance: cap, guards, reached: false, stuck: 'cap' }
}
