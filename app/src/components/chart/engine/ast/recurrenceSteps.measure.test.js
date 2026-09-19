// app/src/components/chart/engine/ast/recurrenceSteps.measure.test.js
//
// ─── ⭐⭐ R-Q — WHAT `MAX_RECURRENCE_STEPS` HAS TO BE, MEASURED ──────────────
//
// ⚰️ THE CEILING WAS 1,000,000 AND NOTHING BEHIND IT WAS A MEASUREMENT. It was
// picked when the only recurrence anybody had written was small, and the way
// that surfaced was a member's chart: `uncharted-volume-v2.pine` on SPY 1D — the
// timeframe a chart opens on — refused 22 of its 133 graph nodes and drew `NaN`
// in every dashboard cell. Not a wrong number: the four characters `NaN`, in the
// place a volume goes.
//
// ⭐ SO IT IS DERIVED THE WAY `TEXT_MAX_DEPTH` WAS: instrument the real cost on
// every recurrence the corpus declares, take the deepest REAL shape, and set the
// ceiling at a stated multiple of it that still bounds a runaway. The instrument
// is `opts.stepSink` in `interpret.js` — it records EVERY recurrence, not only
// the ones that refuse, because a guard that speaks only when it fires cannot be
// calibrated.
//
// ⛔⛔ AND THE BARS ARE NOT THE ONES ON SCREEN. `barsBackfill.fullBarsFor` is
// what a member reaches by panning left: 12,500 on daily and 32,000 on 30- and
// 60-minute. Deriving this against the 8,000 the first fetch happens to bring
// would set a ceiling that a scroll walks straight through — the defect this
// wave already paid for once at 8,000.
//
// ⚠️ ONE NUMBER FOR BOTH LANES, AND THE PYTHON LANE IS THE ONE IT BOUNDS.
// `MAX_RECURRENCE_STEPS`'s own docblock says so: the Python walker is plain
// loops on purpose (numpy would change summation order and cost the 1e-9
// parity), so it is ~40× slower per step. Raising the number is therefore a
// claim about Python seconds, and this file measures the JS side and states the
// implied Python cost rather than quietly ignoring the lane the cap exists for.
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { translatePine } from './pine'
import { interpret, MAX_RECURRENCE_STEPS } from './interpret'
import { fullBarsFor } from '../../../../utils/barsBackfill'
import { DEFAULT_BUDGET } from './budget'
import { ALL_MENU_CODES } from '../../timeframes'
import { timeframeFlags } from '../../indicators'

const REPO = path.resolve(process.cwd(), '..')
const OOS = path.join(REPO, 'tests/fixtures/pine_oos')
const SCRIPTS = fs.readdirSync(OOS).filter((f) => f.endsWith('.pine')).sort()
const V2 = fs.readFileSync(
  path.join(REPO, 'tests/fixtures/member/uncharted-volume-v2.pine'), 'utf8')

/** ⭐ THE FOUR TIMEFRAMES THE RULING NAMES, WITH THE DEPTH EACH ONE REACHES.
 *  ⛔ The depths are READ from `fullBarsFor`, never retyped: it is the function
 *  the chart's own backfill calls, so a change there moves this measurement
 *  instead of silently invalidating it. 30- and 60-minute are the two most-used
 *  intraday timeframes on this product's own bar (`1m 5m 15m 30m 1h 1D 1W 1M`)
 *  and they are also the two DEEPEST, at 32,000 bars each — so taking them makes
 *  this the worst case rather than a convenient one. */
const TIMEFRAMES = ['D', 'W', '60', '30']
const DEPTH = Object.fromEntries(TIMEFRAMES.map((tf) => [tf, fullBarsFor(tf)]))

/** Every recurrence a script declares, with its warm-up.
 *  ⭐ MEASURED OVER A SHORT SERIES ON PURPOSE. `warmup` is a property of the
 *  TREE and `bars` is the caller's, so the product is arithmetic once the
 *  warm-up is known — and running the corpus at 32,000 bars to learn a number
 *  the tree already carries would cost minutes to measure nothing extra. */
const SHORT_BARS = 320
const bars = Array.from({ length: SHORT_BARS }, (_, i) => ({
  t: 1_600_000_000 + i * 86400,
  o: 100 + Math.sin(i / 8) * 3,
  h: 104 + Math.sin(i / 8) * 3,
  l: 96 + Math.sin(i / 8) * 3,
  c: 100 + Math.sin(i / 6) * 4,
  v: 10_000_000 + i * 7_000,
}))

function warmupsIn(source) {
  const out = []
  let t = null
  try { t = translatePine(source, { strict: true }) } catch { return out }
  if (!t || !t.ok) return out
  // ⛔⛔ THE OBJECT TREES COUNT TOO, AND LEAVING THEM OUT MADE v2 READ ZERO.
  // The first cut of this walked `t.outputs` only — the PLOTS — and reported
  // `v2: []`, which would have derived a ceiling from a corpus that excluded the
  // one script the ruling is about. v2's `accum` is behind a TABLE CELL, not a
  // plot, and the object program carries its own `trees` array.
  const trees = [
    ...(t.outputs || []).filter((o) => o && o.ast).map((o) => o.ast),
    ...((t.objects && Array.isArray(t.objects.trees) ? t.objects.trees : []).filter(Boolean)),
  ]
  for (const ast of trees) {
    const stepSink = []
    try {
      interpret(ast, bars, {}, undefined, undefined, { tf: 'D', stepSink })
    } catch { /* a tree that refuses for some other reason still reported what it reached */ }
    for (const r of stepSink) out.push(r.warmup)
  }
  return out
}

describe('⭐⭐ the deepest recurrence any real script declares', () => {
  const perScript = new Map()
  for (const f of SCRIPTS) {
    const w = warmupsIn(fs.readFileSync(path.join(OOS, f), 'utf8'))
    if (w.length) perScript.set(f, w)
  }
  const v2Warmups = warmupsIn(V2)
  const all = [...[...perScript.values()].flat(), ...v2Warmups]
  const maxWarmup = all.length ? Math.max(...all) : 0

  it('the corpus is the one on disk, and it was actually walked', () => {
    // ⛔ THE DENOMINATOR, STATED. A measurement over a corpus that failed to load
    // is a measurement of nothing, and `Math.max()` of an empty list is
    // `-Infinity` — which would derive a ceiling of zero and look decisive.
    expect(SCRIPTS.length).toBe(59)
    expect(perScript.size, 'no script in the corpus declared a recurrence').toBeGreaterThan(0)
    expect(all.length).toBeGreaterThan(0)
    expect(v2Warmups.length, 'v2 declares the accum this ruling is about').toBeGreaterThan(0)
  })

  it('⭐⭐ THE DEEPEST REAL WARM-UP, and v2 is not an outlier in it', () => {
    // Measured 2026-09-13 across `tests/fixtures/pine_oos` (59 scripts) plus
    // `uncharted-volume-v2.pine`. v2's `accum` warms over 250 bars; nothing in
    // the corpus asks for more than the engine's own lookback cap allows.
    // ⭐ MEASURED 2026-09-13: two of the fifty-nine corpus scripts declare a
    // recurrence (`13-spma-trend`, `14-master-line-lite`), both at 250, and v2's
    // is 250 as well — reached through the OBJECT trees, not the plots.
    expect(maxWarmup).toBe(250)
    expect(perScript.size).toBe(2)
    expect(v2Warmups).toContain(250)
    // ⛔ AND THE CAP IS A REAL BOUND ON IT, not an accident of this corpus:
    // `warmup` is an `int` window like any other, so `budget:lookback` already
    // refuses one wider than the engine's declared maximum. That is what makes
    // "the deepest REAL shape" a bounded quantity rather than a sample.
    expect(maxWarmup).toBeLessThanOrEqual(5000)
  })

  it('⭐⭐ THE DERIVATION — the worst real product, and the ceiling above it', () => {
    // The cost is `bars × warmup`, and the bars are what a member can PAN to.
    const worst = Math.max(...TIMEFRAMES.map((tf) => DEPTH[tf] * maxWarmup))
    const table = TIMEFRAMES.map((tf) => `${tf}: ${DEPTH[tf]} × ${maxWarmup} = ${DEPTH[tf] * maxWarmup}`)
    // ⛔ THE OLD CEILING IS BELOW THE WORST REAL SHAPE, WHICH IS THE WHOLE FINDING.
    expect(worst, `\n${table.join('\n')}`).toBeGreaterThan(1_000_000)
    // ⭐ AND THE NEW ONE IS ABOVE IT, WITH HEADROOM STATED AS A MULTIPLE RATHER
    // THAN AS A ROUND NUMBER THAT HAPPENS TO FIT.
    expect(MAX_RECURRENCE_STEPS, `\n${table.join('\n')}`).toBeGreaterThanOrEqual(worst)
    expect(worst).toBe(8_000_000)
    const headroom = MAX_RECURRENCE_STEPS / worst
    expect(headroom).toBeGreaterThanOrEqual(1.5)
    // ⛔ AND IT STILL BOUNDS A RUNAWAY, AGAINST THE GRAMMAR'S OWN MAXIMUM rather
    // than an invented multiple: `budget.js::DEFAULT_BUDGET.maxLookback` is the
    // widest warm-up this engine will admit, and that shape on the deepest
    // timeframe must still refuse. A ceiling raised until one script passed would
    // have landed at 8,000,000 with nothing left bounded above it.
    const grammarMax = Math.max(...Object.values(DEPTH)) * DEFAULT_BUDGET.maxLookback
    expect(grammarMax).toBe(30_720_000)
    expect(grammarMax).toBeGreaterThan(MAX_RECURRENCE_STEPS)
    expect(grammarMax / MAX_RECURRENCE_STEPS).toBeGreaterThanOrEqual(2)
    // ⚠️ AND THE SWEEP LANE IS BOUNDED BY ITS OWN BAR COUNT, NOT BY THIS. It
    // fetches `min(5000, max(400, lookback + 400))`, so at the same 960 warm-up
    // it reads 1,360 bars — 1,305,600 steps, measured at 416 ms in Python and
    // REFUSED by the old 1,000,000 ceiling. Raising this did not widen that lane;
    // it stopped narrowing it below what its own grammar allows.
    expect(Math.min(5000, Math.max(400, DEFAULT_BUDGET.maxLookback + 400)) * DEFAULT_BUDGET.maxLookback)
      .toBeLessThan(MAX_RECURRENCE_STEPS)
  })

  it('⛔ CONTROL — the sink records EVERY recurrence, not only the ones that refuse', () => {
    // Without this the derivation could be over an empty list that never
    // recorded anything, and every bound above would hold vacuously.
    // ⛔ AN OBJECT TREE, NOT A PLOT. v2's `accum` is behind a table cell, and
    // reaching for `outputs[0]` here recorded nothing while looking thorough —
    // the same blind spot that made the first run of this file report `v2: []`.
    const t = translatePine(V2, { strict: true })
    const trees = (t.objects && t.objects.trees) || []
    const stepSink = []
    for (const ast of trees) {
      if (!ast) continue
      try { interpret(ast, bars, {}, undefined, undefined, { tf: 'D', stepSink }) } catch { /* noop */ }
    }
    expect(trees.length).toBeGreaterThan(0)
    expect(stepSink.length).toBeGreaterThan(0)
    expect(stepSink.every((r) => r.exceeded === false),
      'nothing should exceed at 320 bars').toBe(true)
    expect(stepSink[0]).toHaveProperty('name')
    expect(stepSink[0]).toHaveProperty('warmup')
    expect(stepSink[0]).toHaveProperty('steps')
  })

  it('⛔⛔ AND IT STILL FIRES, BY NAME — the guard is raised, not removed', () => {
    // ⭐ The shape at the grammar's own maximum, driven directly so the
    // arithmetic is what is under test. 13,000 bars is just past the daily
    // backfill target, so this is reachable rather than hypothetical.
    const deep = Array.from({ length: 13000 }, (_, i) => bars[i % SHORT_BARS])
    let msg = ''
    try {
      interpret({
        type: 'call',
        name: 'accum',
        args: [
          { type: 'series', name: 'close' },
          { type: 'op', name: '+', args: [{ type: 'series', name: 'self' }, { type: 'series', name: 'close' }] },
          { type: 'num', value: DEFAULT_BUDGET.maxLookback },
        ],
      }, deep, {}, { maxNodes: 1e6, maxLookback: DEFAULT_BUDGET.maxLookback, maxSeriesRefs: 64 },
      undefined, { tf: 'D' })
    } catch (e) { msg = String((e && e.message) || e) }
    expect(msg).toContain('steps')
    expect(msg).toContain(String(MAX_RECURRENCE_STEPS))
  })
})

// ─── ⚰️⚰️ AND R-Q's OWN INSTRUMENT FOUND A SECOND WAY TO A BLANK DASHBOARD ──
//
// The guard stamp the ruling asked for (`data-uct-objects-unreadable-guards`)
// went onto the pane and immediately reported a refusal that was NOT the step
// ceiling: on SPY at `2D`, six nodes refusing `resolve:window` —
// *"sma argument 1 must be a whole number of at least 1, got {type:'op',
// name:'?:'}"*. A `timeframe.isweekly ? 5 : 20` length that never folded.
//
// ⛔ THE CAUSE IS TWO VOCABULARIES FOR ONE TIMEFRAME. `TF_MENU` offers the member
// a catalog of codes; `timeframeFlags` answers for the five the clock knows and
// returns `null` for everything else — deliberately, because a guessed `isdaily`
// is a confident wrong length. So every catalog code outside that five folds
// NOTHING, and a script whose window depends on the timeframe blanks its cells.
//
// ⭐ MEASURED HERE RATHER THAN DESCRIBED, so the number moves when either side
// does. ⏭️ ROUTED: teaching the clock the catalog's shape (a `2D` bar IS daily;
// a `45` bar IS intraday) is its own capability with its own blast radius across
// every `timeframe.*` predicate in the corpus.
describe('⚠️ how much of the timeframe menu the bind-time fold understands', () => {
  it('the catalog is bigger than the clock, and this is by how much', () => {
    const known = ALL_MENU_CODES.filter((c) => timeframeFlags(c) !== null)
    const unknown = ALL_MENU_CODES.filter((c) => timeframeFlags(c) === null)
    // ⛔ NOT A HAND-TYPED PAIR OF NUMBERS: both sides are read from the modules
    // that own them, and the assertion is the RELATIONSHIP.
    expect(ALL_MENU_CODES.length).toBeGreaterThan(known.length)
    expect(known).toEqual(expect.arrayContaining(['D', 'W', 'M']))
    // ⭐ The four the ruling names are all in the KNOWN half — 1D, 1W and the two
    // most-used intraday codes — which is why the measurement above is sound and
    // why this is a routed gap rather than a hole under it.
    for (const tf of ['D', 'W', '60', '30']) expect(timeframeFlags(tf)).not.toBeNull()
    // ⚰️ …and `2D`, the one a member reached in the browser, is in the other half.
    expect(timeframeFlags('2D')).toBeNull()
    expect(unknown).toContain('2D')
  })
})
