// app/src/components/chart/engine/runtime/__tests__/objectLaneDrawerCensus.measure.test.js
//
// ─── ⭐⭐ HOW MANY OF THESE SCRIPTS COULD EVER DRAW — THE CEILING, MEASURED ──
//
// `objectLaneCensus.measure.test.js` prints where the drawing dies, over all 266
// committed scripts. `objectLaneCallSites.measure.test.js` opens one guard's row
// so a count cannot be mistaken for a sizing. Both answer questions about the
// NUMERATOR, and neither can say the thing a work queue most needs:
//
//     ⛔⛔ A SCRIPT WITH NO `line.new` / `label.new` / `box.new` / `table.new` /
//     `linefill.new` CANNOT DRAW ON THIS LANE, EVER. `OBJECT_FAMILIES` holds
//     exactly those five, `buildObjectLane` refuses a program with zero ops, and
//     a `plot()` is not an object. Fixing its refusal moves it to the NEXT
//     refusal and never to "draws end to end".
//
// Measured 2026-09-21: **190 of 266** contain a drawing call at all. So 76
// scripts — 29% of the denominator the census reports against — are outside the
// reachable set by construction, and several whole guard rows are made ENTIRELY
// of them:
//
//   objects/objects:nothing-drawn        13 scripts,  0 drawers
//   objects/pine:declaration-strategy    13 scripts,  0 drawers
//   objects/pine:module                   6 scripts,  0 drawers
//   objects/pine:function                 6 scripts,  0 drawers
//   objects/pine:state                    7 scripts,  1 drawer
//
// ⭐ THAT IS THE POINT OF THE TABLE, AND IT IS A WORK-QUEUE FACT, NOT A TRIVIA
// ONE. `pine:module` is six scripts that `import` another author's library, and
// resolving those imports — a real capability, and a large one — would move the
// object-lane census by exactly zero, because not one of the six draws anything.
// A row sized on its count alone reads as six scripts of upside.
//
// ⛔ AND THE OPPOSITE READING IS ALSO AVAILABLE FROM THE SAME COLUMN. A row that
// is ALL drawers — `objects:iterated-tree-not-last-bar` is 12 of 12 — is a row
// where every script blocked is a script that really wants to draw.
//
// ⛔ IT ASSERTS NO COUNT, for the reason both its siblings do not: a census
// pinned to a number goes red every time the pipeline improves. What is asserted
// is what must be true of any honest run — the corpus was found, the matcher can
// still see a real drawing call AND still refuses a commented-out one, and the
// answer is neither "all of them" nor "none of them".
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

import { buildObjectLane } from '../objectLane.js'
import { OBJECT_FAMILIES } from '../../ast/objectProgram.js'

const REPO = path.resolve(process.cwd(), '..')
const DIR = path.join(REPO, 'corpus/committed')

const SCRIPTS = fs.existsSync(DIR)
  ? fs.readdirSync(DIR).filter((f) => f.endsWith('.pine')).sort()
  : []

/**
 * Drop `//` comments WITHOUT eating a `//` that sits inside a string literal.
 *
 * ⛔ CODE, NEVER PROSE. A commented-out `box.new` must not count as a drawing,
 * or the ceiling is inflated by scripts whose author deleted the drawing.
 *
 * ⚠️ AND THE QUOTE AWARENESS IS NOT DEMONSTRABLE ON THIS CORPUS — SAID PLAINLY,
 * because the first cut of this file implied the opposite. Measured 2026-09-21
 * over all 266 scripts: the naive `line.replace(/\/\/.*$/, '')` and the reader
 * below answer **190 both ways, with zero disagreements**. A `//` inside a
 * string only costs a drawing call when it sits BEFORE the `.new` ON THE SAME
 * LINE, and Pine allows one statement per line, so the shape is legal (a URL in
 * a ternary condition) and absent here.
 *
 * ⭐ IT IS KEPT BECAUSE IT IS CORRECT AND FREE, and the control below carries a
 * SYNTHETIC case that really does separate the two — so swapping in the naive
 * form goes red instead of silently passing. ⛔ The first version of that
 * control could NOT separate them: both of its cases put the `.new` before the
 * string, where truncating the tail leaves the match intact. The mutation
 * survived, which is the only reason this note exists.
 */
function stripComments(src) {
  const out = []
  for (const raw of String(src).split('\n')) {
    let quote = null
    let cut = raw.length
    for (let i = 0; i < raw.length; i += 1) {
      const c = raw[i]
      if (quote) {
        if (c === '\\') { i += 1; continue }
        if (c === quote) quote = null
        continue
      }
      if (c === '"' || c === "'") { quote = c; continue }
      if (c === '/' && raw[i + 1] === '/') { cut = i; break }
    }
    out.push(raw.slice(0, cut))
  }
  return out.join('\n')
}

// ⭐ BUILT FROM `OBJECT_FAMILIES`, never typed out. The families this lane can
// draw are decided in `objectProgram.js`; a sixth added there must widen this
// scan on the same day, or the ceiling silently under-reports.
const NEW_RE = new RegExp(`\\b(?:${OBJECT_FAMILIES.join('|')})\\.new\\b`)

const isDrawer = (src) => NEW_RE.test(stripComments(src))

describe('⭐⭐ the drawable ceiling, cross-tabbed against where the drawing dies', () => {
  it('⛔ CONTROL — the corpus is actually on disk', () => {
    expect(SCRIPTS.length).toBeGreaterThan(200)
  })

  it('⛔ CONTROL — the matcher still SEES a real call, and still refuses a commented one', () => {
    // An empty result is a failed invocation until proven otherwise, and a
    // stripper that ate everything would report a ceiling of zero — which reads
    // exactly like "no script in this corpus draws".
    expect(isDrawer('a = box.new(1, 2, 3, 4)')).toBe(true);
    ['line', 'label', 'table', 'linefill'].forEach((fam) => {
      expect(isDrawer(`x = ${fam}.new()`), `${fam}.new is not being seen`).toBe(true)
    })
    expect(isDrawer('// a = box.new(1, 2, 3, 4)')).toBe(false)
    expect(isDrawer('plot(close)\nhline(0)')).toBe(false)
    // ⛔⛔ THE ONE CASE THAT SEPARATES THIS READER FROM A NAIVE `//`-TO-EOL CUT,
    // and it is SYNTHETIC: the string must come BEFORE the `.new` on the SAME
    // line. Both of these read `true` here and `false` under the naive form.
    // ⚠️ No committed script has this shape (see the note on `stripComments`),
    // so it is a guard on the reader, not a measurement of the corpus.
    expect(isDrawer('b := str.contains(note, "//") ? box.new(1, 2, 3, 4) : na')).toBe(true)
    expect(isDrawer('x = f("http://a") and g(label.new(0, 0, "y"))')).toBe(true)
    // ⛔ …and the ordinary direction still holds: a trailing comment after a
    // real call does not hide it.
    expect(isDrawer('a = label.new(0, 0, "see https://x")  // note')).toBe(true)
  })

  it('⭐⭐ prints the ceiling and the per-guard drawer count', () => {
    const byGuard = new Map()
    let drawers = 0

    for (const name of SCRIPTS) {
      const src = fs.readFileSync(path.join(DIR, name), 'utf8')
      const draws = isDrawer(src)
      if (draws) drawers += 1
      let key
      try {
        const r = buildObjectLane(src, { tf: 'D', newestBarIsForming: false })
        key = r.ok ? 'DREW' : `${r.lane}/${(r.refusal && r.refusal.guard) || 'unnamed-refusal'}`
      } catch (err) {
        // ⛔ A THROW IS A RESULT, NOT A GAP — the same contract the sibling
        // census keeps, for the same reason: swallowing it shrinks the
        // denominator and flatters whichever side it dropped.
        key = `threw/${String((err && err.message) || err).slice(0, 40)}`
      }
      if (!byGuard.has(key)) byGuard.set(key, { n: 0, drawers: 0 })
      const e = byGuard.get(key)
      e.n += 1
      if (draws) e.drawers += 1
    }

    const rows = [...byGuard.entries()]
      .sort((a, b) => (b[1].drawers - a[1].drawers) || (b[1].n - a[1].n))
    const pct = (n) => `${((n / SCRIPTS.length) * 100).toFixed(1)}%`
    const lines = [
      '',
      `DRAWABLE CEILING  —  ${SCRIPTS.length} scripts, tf=D, clock told`,
      `contain a drawing call : ${drawers}  (${pct(drawers)})   <- nothing above this can ever draw`,
      `contain none           : ${SCRIPTS.length - drawers}  (${pct(SCRIPTS.length - drawers)})`,
      '',
      '  n  drawers  lane / guard',
      ...rows.map(([k, e]) => `${String(e.n).padStart(3)}  ${String(e.drawers).padStart(7)}  ${k}`),
      '',
      '⭐ a row whose drawer count is 0 cannot move "draws end to end", however',
      '   large its n — its scripts have nothing for this lane to draw.',
      '',
    ]
    // eslint-disable-next-line no-console
    console.log(lines.join('\n'))

    const total = rows.reduce((n, [, e]) => n + e.n, 0)
    expect(total, 'a script went missing between the two passes').toBe(SCRIPTS.length)
    // ⛔ BOTH ENDS. A matcher that matched everything is as broken as one that
    // matched nothing, and only one of those looks like a failure.
    expect(drawers).toBeGreaterThan(0)
    expect(drawers).toBeLessThan(SCRIPTS.length)
  })
})
