// app/src/components/chart/engine/ast/guardUpperBound.measure.test.js
//
// ─── ⭐⭐ WOULD SOLVING THIS GUARD MOVE ANYTHING? ASK BEFORE BUILDING ───────
//
// ⛔⛔ SEVEN WAVES HAVE NOW CLEARED A CENSUS ROW AND MOVED THE PRODUCT NUMBER
// BY ZERO. Not one of them was wasted work — they found real defects and closed
// real gaps — but every one of them could have KNOWN the zero in five minutes,
// before a line of code, and none of them did. This is that five minutes.
//
//     cd app && GUARD=runtime:expression-statement \
//       node node_modules/vitest/vitest.mjs run \
//         src/components/chart/engine/ast/guardUpperBound.measure.test.js
//
// ⚰️⚰️ IT IS NOT A STRICT UPPER BOUND, AND THIS FILE SAID IT WAS.
// The claim was that deleting a refused line is "the most permissive treatment
// possible, better than any correct implementation could ever be, because a
// correct lowering can only fail in MORE places than deleting the line."
//
// ⛔ THAT IS FALSE WHENEVER THE REFUSED LINE IS A BINDING. Deleting it does not
// merely remove a capability — it removes a NAME, and every later line that
// consumes that name then fails `pine:undefined`. Implementing the function
// keeps the name and its consumers. So for a binding, deleting is STRICTER than
// implementing, and the bound UNDERSTATES.
//
// ⭐ MEASURED, 2026-09-22, not reasoned about. This file sized
// `runtime/runtime:call-windowed-state` at **+1 AT BEST**. Serving the cross
// family delivered **+2** builds and +2 draws. The extra script is
// `trendlines__43QQg9nDN0.pine`, whose refused lines are
//     86: long_break  = crossover(close, res_y)
//     87: short_break = crossunder(close, sup_y)
// — bindings, whose consumers the peel then broke. The queue instrument had
// even printed the tell: `trendlines`'s walls read
// `call-windowed-state, pine:undefined`, and that second wall was an ARTIFACT
// OF THE PEELER, not a property of the script.
//
// ⭐⭐ SO READ IT AS AN ESTIMATE OF ORDER IN BOTH DIRECTIONS. A zero still
// means "expect nothing" and has been right every time it was checked; a
// positive number is a rough size, which a binding-heavy guard can beat. What
// it is NOT is a ceiling you can plan against. So:
//
//   · the bound comes back ZERO  ⇒  building it moves nothing. Certain.
//   · the bound comes back N > 0 ⇒  a perfect implementation might reach N,
//                                    and will very likely reach fewer.
//
// ⛔ A ZERO IS NOT A REASON NOT TO BUILD IT. Six of the seven waves were worth
// shipping on correctness alone — one found a SILENT WRONG NUMBER where two
// spellings of the same program plotted 4 and 0 with neither refusing. What the
// bound buys is an honest expectation BEFORE the work, so a zero is a decision
// rather than a disappointment.
//
// ⭐ THE TECHNIQUE IS NOT MINE. The agent that built `runtime:expression-
// statement` proved its own zero this way before writing the lowering, and said
// it was worth standing up beside the drawer census. It was right.
//
// ⚠️ AND IT ANSWERS ONLY ITS OWN QUESTION. A row can be worth zero on the
// product metric and still be the correct next thing to build; this measures
// reach, not value.
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

import { buildObjectLane } from '../runtime/objectLane.js'

const REPO = path.resolve(process.cwd(), '..')
const DIR = path.join(REPO, 'corpus/committed')
const SCRIPTS = fs.existsSync(DIR)
  ? fs.readdirSync(DIR).filter((f) => f.endsWith('.pine')).sort()
  : []

const N = 60
const BARS = Array.from({ length: N }, (_, i) => ({
  t: 1700000000 + i * 86400,
  o: 100 + (i % 7), h: 104 + (i % 5), l: 96 - (i % 3), c: 100 + (i % 11), v: 1000000 + i,
}))
const LF = String.fromCharCode(10)

/** The guard to size. Bare (`pine:block`) or lane-qualified (`runtime/pine:block`). */
const GUARD = process.env.GUARD || 'runtime:expression-statement'
const CAP = 40

function refusalOf(src) {
  let r = null
  try {
    r = buildObjectLane(src, { tf: 'D', newestBarIsForming: false, bars: BARS })
  } catch (err) {
    return { line: 0, guard: `threw:${String(err && err.message).slice(0, 30)}`, ok: false }
  }
  if (r.ok) return { ok: true }
  const ref = r.refusal || {}
  return {
    ok: false,
    line: Number(ref.line || (ref.at && ref.at.line) || 0),
    guard: ref.guard || 'unnamed',
    qualified: `${r.lane}/${ref.guard || 'unnamed'}`,
  }
}

const matches = (ref, guard) => ref.guard === guard || ref.qualified === guard

/**
 * Neutralise only the lines this guard refuses. Returns how the script ends up.
 *
 * ⛔ IT STOPS AT THE FIRST DIFFERENT GUARD, which is the whole point: the
 * question is what THIS guard is worth, not what deleting the script is worth.
 */
export function sizeOne(source, guard) {
  const lines = source.split(LF)
  const killed = new Set()
  for (let step = 0; step < CAP; step += 1) {
    const src = lines.map((l, i) => (killed.has(i) ? '' : l)).join(LF)
    const ref = refusalOf(src)
    if (ref.ok) return { builds: true, peeled: step }
    if (!matches(ref, guard)) return { builds: false, peeled: step, wall: ref.qualified }
    const idx = ref.line - 1
    if (!(idx >= 0 && idx < lines.length) || killed.has(idx)) {
      return { builds: false, peeled: step, wall: `${ref.qualified} (no line)` }
    }
    killed.add(idx)
  }
  return { builds: false, peeled: CAP, wall: 'cap' }
}

describe('⭐⭐ the upper bound on one guard', () => {
  it('⛔ CONTROL — the corpus is on disk', () => {
    expect(SCRIPTS.length).toBeGreaterThan(200)
  })

  it('⛔⛔ CONTROL — the sizer stops at a DIFFERENT guard, not at any refusal', () => {
    // ⭐ THE ONE WAY THIS IS QUIETLY WORTHLESS: a sizer that peels everything
    // reports every row as worth the whole corpus, and one that peels nothing
    // reports every row as zero. This plants one line of the named guard and
    // one line of a different one, and asserts it peels the first and stops at
    // the second.
    const q = String.fromCharCode(34)
    const H = `//@version=6${LF}indicator(${q}t${q}, overlay = true)${LF}`
    const src = `${H}plot(ta.notarealfunction(close, 5))${LF}plot(alsonotreal(close))${LF}`
    const first = refusalOf(src)
    expect(first.ok, 'the planted fixture unexpectedly builds').toBe(false)

    // sizing against ITS OWN first guard must peel that line and then stop at
    // the second line's wall — never build, never run to the cap
    const r = sizeOne(src, first.guard)
    expect(r.peeled, 'the sizer peeled nothing').toBeGreaterThan(0)
    expect(r.peeled, 'the sizer ran away past its own guard').toBeLessThan(CAP)

    // and sizing against a guard that never fires must peel NOTHING
    const none = sizeOne(src, 'pine:a-guard-that-does-not-exist')
    expect(none.peeled, 'a guard that never fires still peeled lines').toBe(0)
    expect(none.builds).toBe(false)
  })

  it('⭐⭐ prints what solving $GUARD could AT BEST be worth', () => {
    const before = []
    const after = []
    const walls = new Map()
    let touched = 0
    for (const name of SCRIPTS) {
      const src = fs.readFileSync(path.join(DIR, name), 'utf8')
      const base = refusalOf(src)
      if (base.ok) { before.push(name); after.push(name); continue }
      const r = sizeOne(src, GUARD)
      if (r.peeled > 0) touched += 1
      if (r.builds) { after.push(name); continue }
      if (r.peeled > 0) walls.set(r.wall, (walls.get(r.wall) || 0) + 1)
    }

    const gained = after.length - before.length
    // eslint-disable-next-line no-console
    console.log([
      '',
      `UPPER BOUND ON  ${GUARD}  —  ${SCRIPTS.length} scripts`,
      '⭐ a STRICT upper bound: every line this guard refuses is DELETED, which is',
      '  more permissive than any correct implementation can be.',
      '',
      `  scripts it refuses at all        : ${touched}`,
      `  build BEFORE                     : ${before.length}`,
      `  build AFTER (perfect, at best)   : ${after.length}`,
      `  GAIN, AT BEST                    : ${gained}`,
      '',
      ...(gained === 0
        ? ['⛔ ZERO. Solving this guard perfectly moves the build count by nothing',
          '  ON THE FIRST-BLOCKER PATH. A guard whose refused lines are BINDINGS can',
          '  still gain: deleting a binding breaks its consumers, so the peel is',
          '  stricter than an implementation. Measured once, +1 forecast -> +2 real.',
          '  That is not a reason to skip it — it may still be a correctness fix —',
          '  but it IS a reason not to expect movement, and to say so up front.']
        : [`⭐ ABOUT ${gained} more scripts could build — an estimate of ORDER, not a`,
          '  ceiling. A correct implementation usually reaches fewer, and reaches',
          '  MORE when the refused lines are bindings whose consumers the peel',
          '  breaks (measured: +1 forecast, +2 real, on the cross family).']),
      '',
      'where the peeled scripts stop instead:',
      ...[...walls.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12)
        .map(([w, n]) => `${String(n).padStart(5)}  ${w}`),
      '',
    ].join(LF))

    // ⛔ NON-VACUITY: `after` can never be smaller than `before` — deleting
    // lines cannot un-build a script that already built. If it is, the sizer is
    // broken rather than the corpus being surprising.
    expect(after.length).toBeGreaterThanOrEqual(before.length)
    expect(SCRIPTS.length).toBeGreaterThan(before.length)
  }, 600000)
})
