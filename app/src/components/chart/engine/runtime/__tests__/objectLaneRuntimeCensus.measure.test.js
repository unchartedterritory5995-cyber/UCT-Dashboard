// app/src/components/chart/engine/runtime/__tests__/objectLaneRuntimeCensus.measure.test.js
//
// ─── ⭐⭐ DOES IT ACTUALLY DRAW — THE CENSUS THAT EXECUTES ──────────────────
//
// ⚰️ ITS SIBLING'S HEADLINE READ "draws end to end" AND COUNTED BUILDS.
// `objectLaneCensus.measure.test.js` does `if (r.ok) drew.push(name)` where `r`
// is `buildObjectLane(...)` — it never executes anything, so a script that
// builds and then throws, or runs and emits no object, was counted as drawing.
// That number was quoted as the product metric in the programme doc, in a dozen
// commit messages and in five session reports before anyone ran the two scripts
// it named. This is the missing half, and the two stay separate on purpose: a
// build result and a run result are different facts about a script.
//
// ⛔⛔ THE OUTCOMES ARE NOT COLLAPSED, AND THAT IS THE DESIGN. `CoverageLine`
// exists in this repo because "we could not compute it" and "there is nothing
// there" are different facts to a trader, and a screen that silently loses
// symbols looks like a quiet market. The same applies here:
//
//   BUILD-REFUSED     the object lane refused — the sibling census's subject
//   BUILD-THREW       the object lane RAISED — a translator crash, not a
//                     refusal, and not the same fact as a run that raises
//   INCONCLUSIVE      the script needs data this harness does not supply
//   THREW             it ran and raised
//   RAN-DREW-NOTHING  it ran clean and emitted no object
//   DREW-NOTHING-KEPT it emitted objects and the RENDERER kept none
//   DREW              it ran clean and the renderer KEPT at least one object
//
// ⚰️⚰️ AND THIS FILE MADE ITS SIBLING'S MISTAKE ONE LAYER DOWN. The header
// above mocked a census that "counted builds" — and then counted EMISSION,
// which is just as far from paint. `liquidity-pools` emits 500 objects and the
// renderer keeps NONE: every one is a linefill anchored to a line no create
// ever made. That 500 was reported as this programme's largest win, in a
// session report, before anyone asked the renderer.
//
// ⭐⭐ SO `DREW` NOW MEANS THE RENDERER KEPT SOMETHING, and it is the
// product's OWN answer — the real `toRenderState`, the real `paintObjects`,
// the real `layoutTables`, read through their own counters
// (`lesson_did_it_render_needs_the_products_own_answer`). The honest drawer
// set is THREE, and one of the three loses a quarter of its objects:
//
//   makuchaku fair-value-gaps   212 objects, all kept
//   trendlines                    6 of 8 kept
//   inside-bar-range-mother       2 objects, all kept
//
// ⛔ `6 of 8` IS THE NUMBER THAT JUSTIFIES THE WHOLE CHANGE. A census counting
// emission reports `trendlines` as 8 and is wrong by two objects a member
// never sees — a partial loss, which is the kind that never announces itself.
//
// ⭐ INCONCLUSIVE IS THE LOAD-BEARING ONE. `4c-nyse-market-breadth-ratio` makes
// FIVE `request.security` calls; with no request data its requests answer `na`,
// a `str.tostring` of that reaches a plot, and it throws. Filing that as THREW
// would blame the script for a gap in the harness.
//
// ⛔ IT ASSERTS NO COUNT, like its siblings. What it asserts is that the corpus
// and the bars are real, and that the classifier can TELL THE BUCKETS APART —
// the one way this instrument could be quietly worthless.
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

import { buildObjectLane, runObjectLane } from '../objectLane.js'
import { toRenderState } from '../../objectRenderState.js'
import { paintObjects, layoutTables } from '../../objectCanvas.js'

const REPO = path.resolve(process.cwd(), '..')
const DIR = path.join(REPO, 'corpus/committed')
const SCRIPTS = fs.existsSync(DIR)
  ? fs.readdirSync(DIR).filter((f) => f.endsWith('.pine')).sort()
  : []

// ⭐ REAL BARS, NOT SYNTHETIC ONES, AND THE DIFFERENCE IS NOT COSMETIC. A
// fair-value-gap detector finds no gaps in a sine wave and reports DREW-NOTHING
// honestly — which reads as a product failure and is an artifact of the fixture.
const BARS_FIX = JSON.parse(fs.readFileSync(
  path.join(REPO, 'tests/fixtures/vendor/spy-1d-bars-3000-2026-09-13.json'), 'utf8'))

const N = 600
const RAW = BARS_FIX.bars.slice(-N)
const BARS = RAW.map((b) => ({
  t: Math.floor(Date.parse(`${b.t}T00:00:00Z`) / 1000),
  o: b.o, h: b.h, l: b.l, c: b.c, v: b.v,
}))
const SERIES = ['o', 'h', 'l', 'c', 'v'].map((k) => Float64Array.from(BARS.map((b) => b[k])))

const QUOTES = [String.fromCharCode(34), String.fromCharCode(39)]
const LF = String.fromCharCode(10)

/** Comments and strings removed, so a tooltip naming `request.security` is not
 *  read as a call. Strings become a space so nothing is glued across a quote. */
function stripped(src) {
  const out = []
  let quote = null
  for (let i = 0; i < src.length; i += 1) {
    const c = src[i]
    if (quote) { if (c === quote) quote = null; out.push(' '); continue }
    if (QUOTES.includes(c)) { quote = c; out.push(' '); continue }
    if (c === '/' && src[i + 1] === '/') {
      while (i < src.length && src[i] !== LF) i += 1
      out.push(LF)
      continue
    }
    out.push(c)
  }
  return out.join('')
}

const REQUEST_RE = /\brequest\.(security|financial|dividends|earnings|splits|quandl)\b/

/**
 * How many of the emitted objects the RENDERER actually keeps.
 *
 * ⭐⭐ THE PRODUCT'S OWN ANSWER, NOT A SECOND OPINION. This drives the real
 * `toRenderState` and the real `paintObjects` — the two stages that drop — and
 * reads their own counters. A re-implementation of "is this object anchored?"
 * here would be a second authority over the keep rule and would drift from the
 * renderer the first time either was touched.
 *
 * ⛔ BOTH STAGES DROP, AND FOR DIFFERENT REASONS. `toRenderState` drops an
 * object whose coordinates do not resolve; `paintObjects` drops a linefill
 * whose two anchor lines are not on the pane. Counting only the first would
 * have missed the entire 500-object false positive.
 *
 * ⛔⛔ AND THERE ARE TWO SURFACES, NOT ONE — THE CONTROL CAUGHT ME ASSUMING
 * OTHERWISE. A table is no longer painted on the canvas: R2 step 6 moved it to
 * `objectTableDom.js`, which reads the SAME `layoutTables(state)` and builds a
 * real `<table>`. So `paintObjects` never tallies one, and a keep-count that
 * asks only the painter reports ZERO for every table-drawing script — which
 * is most of the drawers. The first version of this helper did exactly that
 * and classified a real `table.cell` as DREW-NOTHING-KEPT; the bucket-
 * discrimination control failed on it immediately. ⭐ An instrument written to
 * catch a false positive had manufactured its own, in the same shape, one
 * function later. The product reads both counters (`data-uct-objects-drawn`
 * and `data-uct-objects-tables` in `objectLayer.js`) and so does this.
 */
export function renderKept(live) {
  if (!Array.isArray(live) || live.length === 0) return 0
  let state
  try { state = toRenderState(live, { bars: BARS }) } catch { return 0 }
  // a recording context: the painter needs the calls to go somewhere, and
  // nothing here asserts on them — only on the painter's own tallies.
  const sink = () => {}
  const ctx = {
    save: sink, restore: sink, beginPath: sink, closePath: sink,
    moveTo: sink, lineTo: sink, stroke: sink, fill: sink,
    fillRect: sink, strokeRect: sink, fillText: sink, setLineDash: sink,
    measureText: (s) => ({ width: String(s).length * 6 }),
  }
  const mapping = {
    timeToX: (t) => Number(t) / 1000,
    priceToY: (p) => 500 - Number(p),
    width: 1000,
    height: 500,
  }
  let painted = 0
  try {
    const res = paintObjects(ctx, state, mapping)
    painted = Object.values((res && res.drawn) || {})
      .reduce((a, b) => a + (Number(b) || 0), 0)
  } catch { painted = 0 }

  // the DOM half — a table that lays out is a table the member sees
  let tables = 0
  try { tables = (layoutTables(state) || []).length } catch { tables = 0 }

  return painted + tables
}

/** One script -> one outcome, with the reason it got that outcome. */
export function classify(src) {
  const needsRequests = REQUEST_RE.test(stripped(src))
  let lane
  try {
    lane = buildObjectLane(src, { tf: 'D', newestBarIsForming: false, bars: BARS })
  } catch (err) {
    // ⛔ A BUILD THAT RAISES IS NOT A RUN THAT RAISES. Collapsing them would
    // put a translator crash and a member's script misbehaving in one bucket,
    // which is the conflation this whole file exists to avoid.
    return { outcome: 'BUILD-THREW', detail: String(err && err.message).slice(0, 70) }
  }
  if (!lane.ok) {
    return {
      outcome: 'BUILD-REFUSED',
      detail: `${lane.lane}/${(lane.refusal && lane.refusal.guard) || 'unnamed'}`,
    }
  }
  let run
  try {
    run = runObjectLane(lane, {
      bars: N, series: SERIES, confirmed: true, readTime: (i) => BARS[i].t,
    })
  } catch (err) {
    // ⛔ A SCRIPT THAT ASKS FOR DATA WE DO NOT SUPPLY IS NOT A SCRIPT THAT FAILS.
    return needsRequests
      ? { outcome: 'INCONCLUSIVE', detail: 'threw, and it reads request.* we do not supply' }
      : { outcome: 'THREW', detail: String(err && err.message).slice(0, 70) }
  }
  const emitted = Array.isArray(run.live) ? run.live.length : 0
  const kept = renderKept(run.live)

  // ⚰️⚰️ EMITTED IS NOT PAINTED, AND THIS CENSUS REPORTED EMITTED FOR A DAY.
  // `liquidity-pools` emits 500 objects and the renderer keeps NONE of them:
  // every one is a linefill anchored to a line no create ever made
  // (`{family:'linefill', props:{line1:null, line2:null}}`, four `line`
  // registers declared and not one written). It was reported as this
  // programme's largest win — 500 objects — while painting nothing.
  //
  // ⛔ THE THREE OUTCOMES BELOW ARE NOT COLLAPSED, for the reason the header
  // gives: "it drew and the renderer dropped it all" and "it drew nothing" are
  // different facts with different fixes. The first is a half-built drawing
  // (a create the object pass cannot see); the second is a script that never
  // asked to draw. Collapsing them hides exactly the defect that produced
  // this comment.
  if (kept > 0) {
    return {
      outcome: 'DREW',
      detail: emitted === kept
        ? `${kept} object(s)`
        : `${kept} of ${emitted} object(s) kept`,
    }
  }
  if (emitted > 0) {
    return {
      outcome: 'DREW-NOTHING-KEPT',
      detail: `${emitted} object(s) emitted, the renderer kept NONE`,
    }
  }
  if (needsRequests) return { outcome: 'INCONCLUSIVE', detail: 'drew nothing, and it reads request.*' }
  return { outcome: 'RAN-DREW-NOTHING', detail: `status ${run.status}` }
}

describe('⭐⭐ the object lane, EXECUTED over the committed corpus', () => {
  it('⛔ CONTROL — the corpus and the bars are both real', () => {
    expect(SCRIPTS.length).toBeGreaterThan(200)
    expect(BARS.length).toBe(N)
    // ⛔ and the bars must MOVE. A flat series makes half the corpus draw
    // nothing for reasons that belong to the fixture.
    const closes = BARS.map((b) => b.c)
    expect(Math.max(...closes) - Math.min(...closes)).toBeGreaterThan(10)
    expect(BARS.every((b) => Number.isFinite(b.t) && b.t > 0)).toBe(true)
  })

  it('⛔⛔ CONTROL — the classifier can TELL THE BUCKETS APART', () => {
    // ⭐ THE ONE WAY THIS INSTRUMENT COULD BE QUIETLY WORTHLESS is a classifier
    // that answers the same thing for everything.
    const q = String.fromCharCode(34)
    const H = `//@version=6${LF}indicator(${q}t${q}, overlay = true)${LF}`
    const draws = `${H}var t = table.new(position.top_right, 1, 1)${LF}`
      + `if barstate.islast${LF}    table.cell(t, 0, 0, str.tostring(close))${LF}`
    const refused = `${H}this is not pine at all (((${LF}`
    const nothing = `${H}plot(close)${LF}`

    expect(classify(draws).outcome, 'a real table did not classify as DREW').toBe('DREW')
    expect(classify(refused).outcome).toBe('BUILD-REFUSED')
    expect(['BUILD-REFUSED', 'RAN-DREW-NOTHING']).toContain(classify(nothing).outcome)
  })

  it('⛔⛔ CONTROL — `classify` SEPARATES emitted from kept, end to end', () => {
    // ⚰️⚰️ THE RAIL THAT WAS MISSING, AND THE MUTATION THAT FOUND IT. The
    // first version of this fix changed `classify` to count kept objects and
    // was mutation-checked by reverting it to `const kept = emitted` — and
    // ALL FOUR TESTS STAYED GREEN. The controls exercised `renderKept`
    // directly, the corpus census asserts no counts, and nothing drove the
    // difference through `classify`. ⭐ A fix whose own revert leaves the
    // suite green is not railed, however carefully it was written
    // (`lesson_a_fixture_that_cannot_distinguish_is_not_a_rail`).
    //
    // This source EMITS one line and the renderer KEEPS none of it: the
    // coordinates are `na`, so `toRenderState` drops it. Counting emission
    // calls it DREW; counting paint calls it DREW-NOTHING-KEPT.
    const q = String.fromCharCode(34)
    const H = `//@version=6${LF}indicator(${q}t${q}, overlay = true)${LF}`
    const emitsButPaintsNothing = `${H}if barstate.islast${LF}`
      + `    line.new(bar_index, na, bar_index - 5, na)${LF}`

    const got = classify(emitsButPaintsNothing)
    expect(got.outcome, `expected the emitted-but-dropped bucket, got ${got.detail}`)
      .toBe('DREW-NOTHING-KEPT')
    expect(got.detail).toMatch(/emitted/)
  })

  it('⛔⛔ CONTROL — the KEEP count is real, and DREW-NOTHING-KEPT can FIRE', () => {
    // ⚰️ THE BUCKET EXISTS BECAUSE OF A SPECIFIC FALSE POSITIVE, so it has to
    // be shown firing on that exact shape. `liquidity-pools` emitted 500
    // linefills whose `line1`/`line2` were never written by any create —
    // reported as this programme's largest win while painting nothing.
    // A bucket nobody has seen fire is decoration (`lesson_gate_that_cannot_fail`).
    const unanchored = [
      { id: 1, family: 'linefill', props: { line1: null, line2: null } },
      { id: 2, family: 'linefill', props: { line1: null, line2: null } },
    ]
    expect(renderKept(unanchored), 'an unanchored linefill counted as kept').toBe(0)

    // ⛔ …AND THE OTHER DIRECTION, or the helper is just answering 0 to
    // everything and every script would read DREW-NOTHING-KEPT.
    const realLine = [{
      id: 3,
      family: 'line',
      props: { xloc: 'bar_index', x1: 10, y1: 100, x2: 20, y2: 110 },
    }]
    expect(renderKept(realLine), 'a well-formed line was not kept').toBeGreaterThan(0)

    // ⭐ AND THE MIXED CASE IS THE ONE THAT MATTERS MOST, because it is what
    // `trendlines` really is: some objects kept, some dropped, and a census
    // that counts emission reports the whole set as drawn.
    expect(renderKept([...realLine, ...unanchored])).toBe(renderKept(realLine))
  })

  it('⭐⭐ prints what every script does WHEN RUN, and accounts for all of them', () => {
    const buckets = new Map()
    const detail = new Map()
    const drew = []
    for (const name of SCRIPTS) {
      const src = fs.readFileSync(path.join(DIR, name), 'utf8')
      const r = classify(src)
      buckets.set(r.outcome, (buckets.get(r.outcome) || 0) + 1)
      if (r.outcome === 'DREW') drew.push(`${name}  ${r.detail}`)
      if (r.outcome === 'THREW' || r.outcome === 'RAN-DREW-NOTHING'
        || r.outcome === 'BUILD-THREW') {
        const k = `${r.outcome}: ${r.detail}`
        detail.set(k, (detail.get(k) || 0) + 1)
      }
    }
    const order = ['DREW', 'RAN-DREW-NOTHING', 'THREW', 'INCONCLUSIVE',
      'BUILD-THREW', 'BUILD-REFUSED']
    const pct = (n) => `${((n / SCRIPTS.length) * 100).toFixed(1)}%`

    // eslint-disable-next-line no-console
    console.log([
      '',
      `OBJECT-LANE RUNTIME CENSUS — ${SCRIPTS.length} scripts, ${N} REAL SPY daily bars`,
      '⛔ these five are kept apart on purpose — "could not compute" is not "nothing there"',
      '',
      ...order.map((o) => `${String(buckets.get(o) || 0).padStart(5)}  `
        + `${pct(buckets.get(o) || 0).padStart(6)}  ${o}`),
      '',
      'DREW:',
      ...drew.map((d) => `    ${d}`),
      '',
      'the non-refused tail, by reason:',
      ...[...detail.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12)
        .map(([k, n]) => `${String(n).padStart(5)}  ${k}`),
      '',
    ].join(LF))

    // ⛔ THE ONLY ARITHMETIC WORTH ASSERTING: nothing fell out of the walk.
    const total = order.reduce((n, o) => n + (buckets.get(o) || 0), 0)
    expect(total).toBe(SCRIPTS.length)
  }, 300000)
})
