// app/src/components/chart/engine/runtime/__tests__/objectLaneCallSites.measure.test.js
//
// ─── ⭐⭐ READ THE CALL SITES BEFORE YOU OPEN A LANE ────────────────────────
//
// `objectLaneCensus.measure.test.js` says WHICH GUARD blocks how many scripts.
// It cannot say WHAT THE WORK IS, and this repo has now paid twice for the
// difference:
//
//   ⚰️ `16  [` in the demand census was read as "the history operator blocks 16
//      scripts" and an agent was dispatched against it. Fifteen of the sixteen
//      call sites were TUPLE DESTRUCTURING. The true count was 1.
//   ⚰️ `pine:input-kind` was read as "input.* is unsupported". Every kind was
//      already supported; the refusals were a `group=` label.
//
// ⭐ A COUNT IS A PROMPT TO GO LOOK, NEVER A SIZING. This prints, for one
// guard, every script that dies on it WITH the refusal's own message and the
// offending source line — which is the cheapest thing that can tell you
// whether a row is one job or five unrelated ones.
//
//     GUARD=pine:character node node_modules/vitest/vitest.mjs run \
//       src/components/chart/engine/runtime/__tests__/objectLaneCallSites.measure.test.js
//
// ⛔ IT ASSERTS NO COUNT. Same contract as both censuses: the numbers are
// PRINTED. What is asserted is that the corpus was found, that a guard was
// named, and — the load-bearing one — that the named guard actually OCCURS.
// A typo'd guard name otherwise prints an empty list, which reads exactly like
// "that guard is fixed" (`lesson_a_saturated_instrument_reports_zero`).
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

import { buildObjectLane } from '../objectLane.js'

const REPO = path.resolve(process.cwd(), '..')
const DIR = path.join(REPO, 'corpus/committed')
const SCRIPTS = fs.existsSync(DIR)
  ? fs.readdirSync(DIR).filter((f) => f.endsWith('.pine')).sort()
  : []

/** The guard to open up. Defaults to the largest object-pass row.
 *
 *  ⭐⭐ IT WAS `pine:character` UNTIL 2026-09-21, AND THE DEFAULT MOVING IS THE
 *  RESULT, not maintenance. Reading its 23 call sites is what this file is for,
 *  and all 23 turned out to be one construct — a member read on the result of an
 *  expression (`array.get(lines, i).set_x2(…)`, `htfFVGs.first().area.delete()`,
 *  `(l[1]).delete()`). The lexer only ever admitted a `.` between two idents, so
 *  a dot every Pine author writes was refused as a character Pine does not have.
 *  With the postfix rule that row is 0 and the assertion below fired, exactly as
 *  designed — an instrument that says "already fixed?" and means it.
 *
 *  ⛔ THE 23 DID NOT START DRAWING. Every one meets a SECOND blocker behind the
 *  dot, which is why the default now points at the largest surviving row rather
 *  than at anything this lane closed. Their new walls, measured: 7
 *  `runtime:declaration`, 6 `runtime:udt`, 4 `objects/pine:no-output`, 2
 *  `objects:iterated-tree-not-last-bar`, 2 `pine:input-kind`, 1
 *  `runtime:input-state`, 1 `pine:builtin`. */
const GUARD = process.env.GUARD || 'runtime:declaration'

/** Every refusal, with the source line it names. */
function refusals() {
  const out = []
  for (const name of SCRIPTS) {
    const src = fs.readFileSync(path.join(DIR, name), 'utf8')
    let r
    try {
      r = buildObjectLane(src, { tf: 'D', newestBarIsForming: false })
    } catch (err) {
      out.push({ name, guard: `threw:${err && err.message}`, message: '', line: 0, text: '' })
      continue
    }
    if (r.ok) continue
    const ref = r.refusal || {}
    const line = Number(ref.line || (ref.at && ref.at.line) || 0)
    const text = line > 0 ? (src.split('\n')[line - 1] || '').trim() : ''
    out.push({
      name,
      guard: ref.guard || 'unnamed',
      lane: r.lane || ref.lane || '?',
      message: String(ref.message || ''),
      line,
      text,
    })
  }
  return out
}

describe('⭐⭐ the call sites behind one guard', () => {
  it('⛔ CONTROL — the corpus is on disk', () => {
    expect(SCRIPTS.length).toBeGreaterThan(200)
  })

  it('⭐⭐ prints every script that dies on $GUARD, with its line', () => {
    const all = refusals()
    const hits = all.filter((r) => r.guard === GUARD)

    const lines = ['', `CALL SITES — guard=${GUARD}   (${hits.length} scripts)`, '']
    for (const h of hits) {
      lines.push(`  ${h.name}  [lane ${h.lane}]`)
      // ⛔ A WHOLE-PROGRAM REFUSAL HAS NO SOURCE LINE, AND SAYING SO IS THE
      // POINT. This printed a bare `L0:` with an empty tail for guards like
      // `objects:nothing-drawn` and `objects:iterated-tree-not-last-bar`, which
      // reads as "the reader could not find it" — missing data — when the truth
      // is that the guard refuses the PROGRAM, not a token. A reader who takes a
      // blank for a failed lookup goes hunting for a line that cannot exist.
      lines.push(h.line > 0
        ? `    L${h.line}: ${h.text.slice(0, 120)}`
        : '    (no source line — this guard refuses the whole program, not a token)')
      if (h.message) lines.push(`    why: ${h.message.slice(0, 200)}`)
      lines.push('')
    }
    // eslint-disable-next-line no-console
    console.log(lines.join('\n'))

    // ⛔ THE ONE ASSERTION WORTH MAKING, and it is about the INSTRUMENT: a
    // guard name that occurs nowhere prints an empty list indistinguishable
    // from a guard that has been fixed. Name a guard that is really there.
    const known = new Set(all.map((r) => r.guard))
    expect(
      known.has(GUARD),
      `guard "${GUARD}" blocks no script — typo, or already fixed? `
      + `Live guards: ${[...known].sort().join(', ')}`,
    ).toBe(true)
  })
})
