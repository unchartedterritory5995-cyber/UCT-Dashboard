// app/src/components/chart/engine/runtime/__tests__/objectLaneCensus.measure.test.js
//
// ─── ⭐⭐ WHERE THE *DRAWING* DIES — THE PRODUCT PATH, MEASURED ON DEMAND ────
//
// `runtimeCorpusCensus.measure.test.js` measures ONE LANE. `buildObjectLane`
// is the pipeline a drawing actually goes through: the object pass reads what
// the script DRAWS, the runtime lane computes the NUMBERS it draws with, and
// either of them can refuse. A script the runtime lane compiles end to end can
// still draw nothing, and a script the runtime lane refuses can be blocked in
// the object pass forty lines earlier.
//
// ⛔⛔ AND THAT GAP IS NOT THEORETICAL — IT IS THE WHOLE RESULT OF 2026-09-21.
// Two capabilities landed that moved the runtime-lane census
// (`runtime:array` 8 -> 3, `runtime:object-op` reclassified out of
// `pine:drawing`), and the number below did not move at all: 2 of 266 drew
// before and 2 of 266 draw after, the SAME two. Measuring only the runtime
// lane would have reported that work as progress toward a drawing.
//
// ⭐ THE `lane` TAG IS THE POINT OF THE TABLE. `buildObjectLane` already tags
// every refusal with WHICH lane said no, and "the object pass found nothing to
// draw" and "the runtime lane cannot compile this" are different problems with
// different owners. Counting them together is how a work queue ends up
// pointing at the wrong half of the pipeline.
//
// ⛔⛔ IT ASSERTS NO COUNT, for the same reason its sibling does not: a census
// pinned to a number goes red every time the pipeline improves. What is
// asserted is what must be true of any honest run — the corpus was found, and
// every script is accounted for.
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

import { buildObjectLane } from '../objectLane.js'

const REPO = path.resolve(process.cwd(), '..')
const DIR = path.join(REPO, 'corpus/committed')

const SCRIPTS = fs.existsSync(DIR)
  ? fs.readdirSync(DIR).filter((f) => f.endsWith('.pine')).sort()
  : []

describe('⭐⭐ the object lane, measured over the committed corpus', () => {
  it('⛔ CONTROL — the corpus is actually on disk', () => {
    // An empty result is a failed invocation until proven otherwise.
    expect(SCRIPTS.length).toBeGreaterThan(200)
  })

  it('⭐⭐ prints where the DRAWING dies, by lane, and accounts for every script', () => {
    const by = new Map()
    const drew = []
    for (const name of SCRIPTS) {
      const src = fs.readFileSync(path.join(DIR, name), 'utf8')
      let r
      try {
        r = buildObjectLane(src, { tf: 'D', newestBarIsForming: false })
      } catch (err) {
        // ⛔ A THROW IS A RESULT, NOT A GAP — swallowing it would shrink the
        // denominator and flatter whichever side it dropped.
        r = {
          ok: false,
          lane: 'threw',
          refusal: { guard: `threw:${(err && err.message ? err.message : String(err)).slice(0, 40)}` },
        }
      }
      if (r.ok) { drew.push(name); continue }
      const key = `${r.lane}/${(r.refusal && r.refusal.guard) || 'unnamed-refusal'}`
      by.set(key, (by.get(key) || 0) + 1)
    }

    const rows = [...by.entries()].sort((a, b) => b[1] - a[1])
    const pct = (n) => `${((n / SCRIPTS.length) * 100).toFixed(1)}%`
    const lines = [
      '',
      `OBJECT-LANE CENSUS  —  ${SCRIPTS.length} scripts, tf=D, clock told`,
      `draws end to end : ${drew.length}  (${pct(drew.length)})`,
      '  n  lane / guard',
      ...rows.map(([k, n]) => `${String(n).padStart(3)}  ${k}`),
      '',
      ...(drew.length ? ['drawn:', ...drew.map((n) => `  ${n}`), ''] : []),
    ]
    // eslint-disable-next-line no-console
    console.log(lines.join('\n'))

    const total = rows.reduce((n, [, c]) => n + c, 0) + drew.length
    expect(total).toBe(SCRIPTS.length)
  })

  it('⛔ CONTROL — the lane tag is real, and BOTH lanes appear in the table', () => {
    // ⭐ Without this the table above is satisfied by a run in which one lane
    // never got a turn — which is exactly what would happen if the object pass
    // started refusing everything, and the census would read as a story about
    // the runtime lane going quiet. Measured 2026-09-21: roughly half the
    // corpus dies in each.
    const lanes = new Set()
    for (const name of SCRIPTS) {
      const src = fs.readFileSync(path.join(DIR, name), 'utf8')
      try {
        const r = buildObjectLane(src, { tf: 'D', newestBarIsForming: false })
        if (!r.ok) lanes.add(r.lane)
      } catch { /* a throw carries no lane — deliberately not counted here */ }
    }
    expect(lanes.has('objects')).toBe(true)
    expect(lanes.has('runtime')).toBe(true)
  })
})
