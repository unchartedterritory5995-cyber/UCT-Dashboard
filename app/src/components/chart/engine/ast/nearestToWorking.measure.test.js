// app/src/components/chart/engine/ast/nearestToWorking.measure.test.js
//
// ─── ⭐⭐ WHICH SCRIPT IS ABOUT TO WORK, AND WHAT IS THE LAST WALL ───────────
//
// ⛔⛔ THIS FILE EXISTS BECAUSE THE FIRST-BLOCKER CENSUS PICKED TEN LOSING JOBS
// IN A ROW. Ranking guards by how many scripts they block is the obvious way to
// choose work, it is what every wave of this programme used, and it is wrong.
// Measured with `guardUpperBound.measure.test.js` on 2026-09-22, the three
// LARGEST rows in the object lane — 64 scripts between them — are each worth
// exactly nothing:
//
//     runtime:declaration   refuses 35 scripts   gain at best  0
//     runtime:statement     refuses 15 scripts   gain at best  0
//     pine:builtin          refuses 14 scripts   gain at best  0
//
// `runtime:colour` refuses THREE and was worth +1 — and building it moved this
// programme's product metric for the first time, 1 -> 2 scripts drawing end to
// end. The difference is not the size of the row. It is that for one script the
// colour guard was the LAST wall instead of the first.
//
//     ⭐⭐ PICK THE GUARD THAT COMPLETES A SCRIPT,
//        NOT THE ONE THAT BLOCKS THE MOST.
//
// A first-blocker census cannot see that, by construction: a build stops at the
// first refusal, so a script with nine walls reports only its first, and the
// guard standing between it and working is invisible until the other eight go.
//
//     node node_modules/vitest/vitest.mjs run \
//       src/components/chart/engine/ast/nearestToWorking.measure.test.js
//
// ⭐ IT SHARES ONE PEELER WITH ITS SIBLING, via `peelToBuilding.js`. Two
// peelers would be two opinions about what "distance" means, and that module's
// header records three separate versions of the measurement that were WRONG
// before their controls caught them — not a history worth forking
// (`lesson_a_second_authority_over_one_value`).
//
// ⚠️ AND IT INHERITS THAT SIBLING'S LIMIT: neutralising a line changes the
// program, so a wall found after a peel may be a consequence of the edit. The
// LIST is a queue to read, not a work ticket to hand over — every row is worth
// confirming with `guardUpperBound` before anyone builds it, which costs five
// minutes and is the whole reason that file exists.
//
// ⛔ IT ASSERTS NO COUNT, like every census here. A queue pinned to a number
// goes red the day someone works it.
import { describe, it, expect } from 'vitest'

import { peel, SCRIPTS, readScript } from './peelToBuilding.js'

const LF = String.fromCharCode(10)

/** How far to look.
 *
 *  ⚠️ `cap` COUNTS PEELS, so a cap of 12 admits scripts up to distance
 *  ELEVEN — the build that would report a twelfth as reached never runs.
 *  Measured in the cap control below, and left alone rather than corrected:
 *  changing `peel` moves every number its sibling has ever published.
 *
 *  ⭐ DELIBERATELY SHORTER THAN THE SIBLING'S 20: this file is
 *  a shortlist of what is nearly working, and a script twelve walls out is not
 *  nearly working. The sibling answers the "how far is the whole corpus"
 *  question and keeps the longer reach. */
const CAP = 12

/** Every script that reaches a build within `cap`, nearest first.
 *
 *  ⭐ `names` IS A PARAMETER SO THE CONTROL CAN USE THREE SCRIPTS INSTEAD OF
 *  266. The first version of this control walked the whole corpus twice and
 *  died on vitest's 15s ceiling — which reads, in a summary, exactly like a
 *  failing assertion. */
export function shortlist(cap = CAP, names = SCRIPTS) {
  const rows = []
  for (const name of names) {
    const r = peel(readScript(name), cap)
    if (r.reached) rows.push({ name, distance: r.distance, walls: [...new Set(r.guards)] })
  }
  return rows.sort((a, b) => a.distance - b.distance)
}

describe('⭐⭐ the scripts nearest to working, and the walls between', () => {
  it('⛔ CONTROL — the corpus is on disk', () => {
    expect(SCRIPTS.length).toBeGreaterThan(200)
  })

  it('⛔⛔ CONTROL — the CAP really bounds the search', () => {
    // ⭐ THE ONE WAY THIS IS QUIETLY WORTHLESS: a shortlist that admits
    // everything ranks nothing, and one that admits nothing reports an empty
    // queue as "no work available". Both read as a finding rather than as a
    // broken instrument.
    //
    // ⚰️⚰️ THIS CONTROL NAMED THREE CORPUS SCRIPTS AT MEASURED DISTANCES
    // (0, 2 and 11) AND MY OWN NEXT COMMIT BROKE IT. Serving the cross family
    // moved two of those three, so a rail written to watch the instrument was
    // actually watching the CORPUS — and it went red for the programme working
    // exactly as intended. A queue instrument whose control breaks every time
    // the queue is worked is the pinned-count defect this file's own header
    // warns about, committed one screen below the warning.
    //
    // ⭐ SO THE CAP IS TESTED ON A PLANTED SOURCE, where the distance is a
    // property of the fixture rather than of the engine's current reach. Two
    // bad lines: a cap of 1 must NOT reach, a cap of 2 must.
    const q = String.fromCharCode(34)
    const H = `//@version=6${LF}indicator(${q}t${q}, overlay = true)${LF}`
    const twoBad = `${H}var t = table.new(position.top_right, 1, 1)${LF}`
      // ⛔ PLOTS, NOT BINDINGS — an UNUSED binding is elided before it can
      // refuse, so it would cost zero peels and this would measure dead-code
      // removal instead of the cap (the sibling's control records the same trap).
      + `plot(ta.notarealfunction(close, 5))${LF}`
      + `plot(alsonotreal(close))${LF}`
      + `if barstate.islast${LF}    table.cell(t, 0, 0, str.tostring(close))${LF}`

    // ⛔⛔ `cap` COUNTS PEELS, AND REPORTING "reached" NEEDS ONE BUILD MORE
    // THAN PEELS — measured here, not assumed. `peel`'s loop runs `cap` times
    // and the build that would answer "it works now" is the FIRST statement of
    // the NEXT iteration, so a script two walls out needs a cap of THREE to come
    // back reached. A cap of exactly 2 peels both lines and stops one build
    // short of the good news.
    // ⭐ THE CONSEQUENCE IS ON THE PRINTED HEADLINE: this file's CAP of 12
    // admits scripts up to distance ELEVEN, not twelve. Stated rather than
    // silently corrected — changing `peel` would move every number its sibling
    // has ever published.
    expect(peel(twoBad, 1).reached, 'a cap of 1 reached a 2-wall script').toBe(false)
    expect(peel(twoBad, 2).reached, 'a cap of 2 (2 peels, 2 builds) reported reached')
      .toBe(false)
    expect(peel(twoBad, 3).reached, 'a cap of 3 did not reach a 2-wall script').toBe(true)
    expect(peel(twoBad, 3).distance, 'the distance is a property of the fixture').toBe(2)
  })

  it('⭐⭐ prints the queue: nearest scripts, their walls, and the union', () => {
    const rows = shortlist()
    const union = new Map()
    for (const r of rows) for (const g of r.walls) union.set(g, (union.get(g) || 0) + 1)

    // eslint-disable-next-line no-console
    console.log([
      '',
      `NEAREST TO WORKING — ${SCRIPTS.length} scripts, peel cap ${CAP}`,
      '⭐ read the UNION as the work queue, not the first-blocker census.',
      `   ${rows.length} scripts are within ${CAP} walls of building.`,
      '',
      ...rows.flatMap((r) => [
        `${String(r.distance).padStart(3)}  ${r.name}`,
        `     walls: ${r.walls.join(', ') || '(builds already)'}`,
      ]),
      '',
      'UNION — each wall, and how many of the nearest scripts it stands in front of:',
      ...[...union.entries()].sort((a, b) => b[1] - a[1])
        .map(([g, n]) => `${String(n).padStart(4)}  ${g}`),
      '',
      '⚠️ confirm any row with guardUpperBound before building it — this list says',
      '   what is CLOSE, and that file says what a row is WORTH.',
      '',
    ].join(LF))

    // ⛔ NON-VACUITY: a shortlist with no walls in it is either a finished
    // corpus or a broken peeler, and the second is far likelier.
    // ⛔ NON-VACUITY, ON THE WALK THIS TEST ALREADY DID. It pins no distance
    // and names no script: both move every time this programme does its job,
    // and a control that breaks when the queue is WORKED is the pinned-count
    // defect this file's own header warns about. What must stay true is that
    // the word "nearest" still means something.
    expect(rows.length, 'empty — a broken peeler, or a finished corpus')
      .toBeGreaterThan(0)
    expect(rows.length, 'the shortlist admitted the whole corpus')
      .toBeLessThan(SCRIPTS.length)
    expect(rows.some((r) => r.walls.length > 0)).toBe(true)
  }, 900000)
})
