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

/** How far to look. ⭐ DELIBERATELY SHORTER THAN THE SIBLING'S 20: this file is
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
    // ⛔ THREE NAMED SCRIPTS, NOT THE CORPUS, and measured distances rather
    // than guesses: one builds already, one is two walls out, one is eleven.
    // Raising the cap past 2 must admit the middle one and must NOT admit the
    // far one — which is a property of the cap, not of how many rows come back.
    const near0 = 'makuchaku039s-trade-tools-fair-value-gaps__b951deedc8.pine'
    const near2 = 'liquidity-pools__fa7b28e733.pine'
    const far = 'inside-bar-boxes__2f747d848b.pine'
    const subset = [near0, near2, far]
    // ⛔ A CONTROL THAT SILENTLY SKIPS IS WORSE THAN NO CONTROL. If the corpus
    // no longer holds these, this must say so rather than pass vacuously.
    for (const n of subset) {
      expect(SCRIPTS.includes(n), `control fixture missing from the corpus: ${n}`).toBe(true)
    }

    const tight = shortlist(1, subset).map((r) => r.name)
    const loose = shortlist(3, subset).map((r) => r.name)

    expect(tight, 'a script that already builds was not admitted at cap 1').toContain(near0)
    expect(tight, 'a script two walls out was admitted at cap 1').not.toContain(near2)
    expect(loose, 'a script two walls out was not admitted at cap 3').toContain(near2)
    expect(loose, 'a script eleven walls out was admitted at cap 3').not.toContain(far)
  }, 120000)

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
    expect(rows.length).toBeGreaterThan(0)
    expect(rows.some((r) => r.walls.length > 0)).toBe(true)
  }, 900000)
})
