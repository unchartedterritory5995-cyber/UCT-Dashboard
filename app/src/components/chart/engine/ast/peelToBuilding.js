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

/**
 * Peel one script. Returns `{distance, guards, reached}`.
 *
 * ⛔ A REFUSAL WITH NO LINE CANNOT BE PEELED, and that is reported rather than
 * skipped. Whole-program refusals (`objects:no-objects-in-source`,
 * `pine:declaration-strategy`) name no line by construction — peeling would
 * loop forever or, worse, neutralise an arbitrary line and call it progress.
 */
export function peel(source, cap = DEFAULT_CAP) {
  const lines = source.split(LF)
  const guards = []
  const killed = new Set()
  for (let step = 0; step < cap; step += 1) {
    const src = lines.map((l, i) => (killed.has(i) ? '' : l)).join(LF)
    const ref = refusalOf(src)
    if (!ref) return { distance: step, guards, reached: true }
    guards.push(ref.guard)
    const idx = ref.line - 1
    // no line, or a line already neutralised → we cannot make progress
    if (!(idx >= 0 && idx < lines.length) || killed.has(idx)) {
      return { distance: step, guards, reached: false, stuck: ref.guard }
    }
    killed.add(idx)
  }
  return { distance: cap, guards, reached: false, stuck: 'cap' }
}
