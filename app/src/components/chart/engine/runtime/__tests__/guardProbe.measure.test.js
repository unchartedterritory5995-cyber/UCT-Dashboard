// app/src/components/chart/engine/runtime/__tests__/guardProbe.measure.test.js
//
// ─── ⭐⭐ READ THE CALL SITES BEFORE SIZING A CENSUS ROW ────────────────────
//
// The object-lane census prints where the corpus dies, one line per guard. A
// row of that table is a COUNT OF A TOKEN, not a count of a capability — and
// planning from the count alone has already produced two wrong decisions:
//
//   ⚰️ `runtime:history-expression` was read as "the history operator blocks 16
//      scripts". Reading the call sites showed FIFTEEN were tuple destructuring
//      (`[a, b, c] = f(…)`) and exactly ONE was a history read. `[` is one
//      token spanning two unrelated capabilities.
//   ⚰️ `pine:input-kind` was read as a 10-script row with one named root cause
//      (`input.color`). It is THREE capabilities: `input.color` (4),
//      `input.timeframe` (4) and `input.symbol` (2) — and the latter two exist
//      to feed `request.security`, which has no feed here, so serving them
//      moves six scripts to a blocker they cannot pass either.
//
// ⭐ SO THIS IS THE CENSUS'S COMPANION, and it exists because "re-measure, do
// not quote" is worthless without a command. Name a guard and it prints every
// corpus script on it, GROUPED BY THE SHAPE OF THE REFUSAL — variable parts
// blanked, so two instances of one capability collapse and two capabilities do
// not. The number of shapes in a row is the number of jobs hiding in it.
//
//   PROBE_GUARD="pine:block,pine:function" npx vitest run …/guardProbe.measure.test.js
//   PROBE_DETAIL=1  — every script, not the first two of each shape
//
// ⛔ IT ASSERTS NO COUNT, deliberately: a census pinned to a number goes red
// every time the lane improves. What it does assert is that the corpus was
// found, so an empty run cannot read as a clean one.
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

import { buildObjectLane } from '../objectLane.js'

const REPO = path.resolve(process.cwd(), '..')
const DIR = path.join(REPO, 'corpus/committed')
const SCRIPTS = fs.readdirSync(DIR).filter((f) => f.endsWith('.pine')).sort()
const WANT = (process.env.PROBE_GUARD || 'pine:block').split(',')
const DETAIL = process.env.PROBE_DETAIL === '1'

/** The message with its variable parts blanked, so two instances of one
 *  capability collapse and two capabilities do not. */
const shapeOf = (msg) => String(msg || '')
  .replace(/`[^`]*`/g, '`X`')
  .replace(/\d+/g, 'N')
  .slice(0, 120)

describe('PROBE', () => {
  it('groups each guard by message shape', () => {
    expect(SCRIPTS.length).toBeGreaterThan(200)
    const byGuard = new Map()
    for (const name of SCRIPTS) {
      const src = fs.readFileSync(path.join(DIR, name), 'utf8')
      let r
      try {
        r = buildObjectLane(src, { tf: 'D', newestBarIsForming: false })
      } catch (err) { continue }
      if (r.ok) continue
      const g = String((r.refusal || {}).guard || '')
      if (!WANT.includes(g)) continue
      const shape = shapeOf((r.refusal || {}).message)
      if (!byGuard.has(g)) byGuard.set(g, new Map())
      const m = byGuard.get(g)
      if (!m.has(shape)) m.set(shape, [])
      const line = (r.refusal || {}).line
      const text = Number.isFinite(line) ? (src.split('\n')[line - 1] || '').trim() : ''
      m.get(shape).push({ name, line, lane: r.lane, text: text.slice(0, 100) })
    }
    for (const [g, m] of byGuard) {
      const total = [...m.values()].reduce((a, v) => a + v.length, 0)
      console.log(`\n================ ${g} — ${total} scripts, ${m.size} distinct shapes ================`)
      const rows = [...m.entries()].sort((a, b) => b[1].length - a[1].length)
      for (const [shape, hits] of rows) {
        console.log(`\n  [${hits.length}]  ${shape}`)
        for (const h of (DETAIL ? hits : hits.slice(0, 2))) {
          console.log(`        [${h.lane}] ${h.name} L${h.line}`)
          console.log(`          ${h.text}`)
        }
      }
    }
    expect(true).toBe(true)
  })
})
