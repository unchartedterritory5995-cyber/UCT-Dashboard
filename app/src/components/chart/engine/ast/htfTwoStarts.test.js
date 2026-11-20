// app/src/components/chart/engine/ast/htfTwoStarts.test.js
//
// ─── ⭐⭐ ITEM 4 (coordinator rulings 2026-11-19) — A RUNNING VALUE THAT CARRIES A PARTIAL FIRST PERIOD, OR A READ BEFORE
//     THE CHART, IS DRAWN ONLY WHERE TWO STARTS AGREE ─────────────────────────────────────────────────────────────────
//
// The walks over a partial first period (#2071 / #2101 / #2111) and over a read before the chart (#PERIOD −1) took a running
// value (`ema`, `rma`, `cum`, a recurrence) pointwise: withheld where its argument was unknown and drawn after, still
// carrying the unknown. Measured by the truth proxy (120 daily charts cut from three longer histories): `ema(x, 3)` over a
// weekly merge drew 2,533 wrong bars, `rma(x, 5)` 8,306, `tf_live('W', ema(high, 3))` 13,485, `ema(nz(close[1]), 3)` 3,480.
// Now (`interpret.js::walkTwoStarts`, twin `ast_interpret._walk_two_starts`): where an unknown reaches a running value the
// tree is evaluated twice, A as built and B with each such running value STARTED LATER (its argument `NaN` on the bars
// the walk found unknown, each site `NaN` on its own: the engine's own "this series starts later", ruling 1), and a bar
// where A and B are not bit-equal (ruling 2: `listingSame`, no tolerance) is withheld beside the walk's own bars, by the
// walk's code. Over `MAX_RECURRENCE_STEPS` (`twoStartSteps`) B is not run and a running value is withheld from its first
// unknown bar on (ruling 4's bound), never drawn.
//
// ⭐ THE ACCEPTANCE MEASURE IS IN THE RAIL: every case is computed on the cut chart AND on the same series with 200 earlier
// bars (the longer chart, which holds the first week whole and the bars before the cut), and every bar the cut chart DRAWS
// must equal the longer chart's (1e-9 relative) — 0 wrong bars drawn — while each running case still draws once its starts
// agree (it is not withheld whole: the rule withholds what it cannot prove, not everything).
//
// THE SHARED FIXTURE `tests/fixtures/ast/htf_two_starts.json` is WRITTEN here (HTF_TWO_STARTS_WRITE=1) and READ by
// `tests/test_pine_htf_two_starts.py`: every case's tree, its served column on the cut chart, and the bound's column; the
// Python lane must equal both bar for bar.
import { describe, it, expect, afterEach } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { interpret, __twoStartCeilingForTests, twoStartSteps, MAX_RECURRENCE_STEPS } from './interpret'

const FIXTURE = path.resolve(process.cwd(), '..', 'tests', 'fixtures', 'ast', 'htf_two_starts.json')

const S = (name) => ({ type: 'series', name })
const CLOSE = S('close')
const HIGH = S('high')
const num = (value) => ({ type: 'num', value })
const off = (k, a) => ({ type: 'offset', value: k, args: [a] })
const call = (name, ...args) => ({ type: 'call', name, args })
const op = (name, ...args) => ({ type: 'op', name, args })
const live = (arg, code = 'W') => ({ type: 'tf_live', value: code, args: [arg] })
const merge = (arg, code = 'W') => ({ type: 'tf_merge', value: code, args: [arg] })

// the New York exchange's full closures in the span, left out: a session the vendor never held is not a bar (a Good
// Friday bar would put the merge's period end where TradingView's calendar does not, `htfClosesOnNextBar`)
const CLOSED = new Set(['2023-04-07', '2023-05-29', '2023-06-19', '2023-07-04', '2023-09-04', '2023-11-23', '2023-12-25',
  '2024-01-01', '2024-01-15', '2024-02-19', '2024-03-29', '2024-05-27', '2024-06-19', '2024-07-04', '2024-09-02',
  '2024-11-28', '2024-12-25', '2025-01-01', '2025-01-09', '2025-01-20', '2025-02-17', '2025-04-18', '2025-05-26',
  '2025-06-19', '2025-07-04', '2025-09-01', '2025-11-27', '2025-12-25', '2026-01-01', '2026-01-19', '2026-02-16'])
/** `count` sessions from `start` (ISO): weekdays the exchange was open. */
function weekdays(start, count) {
  const out = []
  for (let d = new Date(`${start}T00:00:00Z`); out.length < count; d.setUTCDate(d.getUTCDate() + 1)) {
    const iso = d.toISOString().slice(0, 10)
    if (d.getUTCDay() !== 0 && d.getUTCDay() !== 6 && !CLOSED.has(iso)) out.push(iso)
  }
  return out
}
/** A seeded random walk (the truth proxy's), 4 decimals, so both lanes read the same bars from the fixture. */
function walk(days, seed) {
  let s = seed >>> 0
  const rnd = () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296 }
  let p = 100
  return days.map((t) => {
    const o = p
    const c = Math.max(1, o * (1 + (rnd() - 0.5) * 0.04))
    const h = Math.max(o, c) * (1 + rnd() * 0.01)
    const l = Math.min(o, c) * (1 - rnd() * 0.01)
    p = c
    return { t, o: +o.toFixed(4), h: +h.toFixed(4), l: +l.toFixed(4), c: +c.toFixed(4), v: Math.round(1e6 * (0.5 + rnd())) }
  })
}
// the longer chart starts 200 weekdays before the cut; the cut's first bar, Wednesday 2024-01-03, opens a PARTIAL week
const CUT = 200
const DAYS = weekdays('2023-01-02', 900)
const AT = DAYS.indexOf('2024-01-03')
const LONG = walk(DAYS.slice(AT - CUT, AT + 520), 7)
const BARS = LONG.slice(CUT)
const CHART = { tf: 'D', newestBarIsForming: false, barIndexAbsolute: true, varOriginAbsolute: true }

const SHAPES = [
  { name: 'ema(tf_merge(W, high), 3) (a running value over a partial-week site)', tree: () => call('ema', merge(HIGH), num(3)), running: true },
  { name: 'ema(tf_live(W, high), 3)', tree: () => call('ema', live(HIGH), num(3)), running: true },
  { name: 'rma(tf_merge(W, high), 5)', tree: () => call('rma', merge(HIGH), num(5)), running: true },
  { name: 'ema(tf_merge(W, high)[1], 3)', tree: () => call('ema', off(1, merge(HIGH)), num(3)), running: true },
  { name: 'ema(nz(tf_merge(W, high)), 3) (through nz: the running value\'s own input starts later)',
    tree: () => call('ema', call('nz', merge(HIGH), num(0)), num(3)), running: true },
  { name: 'tf_live(W, ema(high, 3)) (a running value inside the read: the child\'s two starts)',
    tree: () => live(call('ema', HIGH, num(3))), running: true, slow: true },
  { name: 'tf_merge(W, ema(high, 3))', tree: () => merge(call('ema', HIGH, num(3))), running: true, slow: true },
  { name: 'ema(nz(close[1]), 3) (a running value carrying a read before the chart)',
    tree: () => call('ema', call('nz', off(1, CLOSE), num(0)), num(3)), running: true },
  { name: 'ema(nz(close[1]), 3) + nz(tf_live(W, nz(close[1]))) (one node read on the chart and inside a read)',
    tree: () => { const x = call('nz', off(1, CLOSE), num(0)); return op('+', call('ema', x, num(3)), call('nz', live(x), num(0))) },
    running: true },
  // a value that never forgets: withheld from the first unknown bar on, every bar of the cut chart
  { name: 'cum(tf_merge(W, high)) (never forgets: every bar withheld)', tree: () => call('cum', merge(HIGH)), never: true },
  // KEPT: no running value carries an unknown, so nothing changes
  // `firstDrawn`, by hand: ema(3) answers from its third value; the merge of close reads the week before the first on
  // bars 0-1 (`NaN`, blank) and the partial week's own close from bar 2 (item 3), so its ema starts on bar 4; the merge
  // of high is withheld through week 1 (bars 3-6 read the partial week; bar 7 closes week 1), so its `[1]` draws from bar 8
  { name: 'KEPT ema(tf_merge(W, close), 3) (a merge of close is no site; its blank bars start it later, as before)',
    tree: () => call('ema', merge(CLOSE), num(3)), kept: true, firstDrawn: 4 },
  { name: 'KEPT tf_merge(W, high)[1] (no running value)', tree: () => off(1, merge(HIGH)), kept: true, firstDrawn: 8, unbounded: true },
  { name: 'KEPT ema(close, 3)', tree: () => call('ema', CLOSE, num(3)), kept: true, firstDrawn: 2, unbounded: true },
]

const asNulls = (col) => Array.from(col || []).map((v) => (Number.isFinite(v) ? v : null))
const run = (tree, bars, extra = {}) => asNulls(interpret(tree, bars, {}, undefined, undefined, { ...CHART, ...extra }))

function build() {
  const cases = SHAPES.map((shape) => {
    const tree = shape.tree()
    __twoStartCeilingForTests(1)
    const bound = run(tree, BARS)
    __twoStartCeilingForTests(null)
    return { name: shape.name, tree, served: run(tree, BARS), bound }
  })
  return {
    _about: 'ITEM 4 (2026-11-19). WRITTEN by app/src/components/chart/engine/ast/htfTwoStarts.test.js '
      + '(HTF_TWO_STARTS_WRITE=1), READ by it and by tests/test_pine_htf_two_starts.py. `bars`: the cut chart (a seeded '
      + 'random walk; its first bar, Wednesday 2024-01-03, opens a partial week); `chart`: the lane facts handed to '
      + 'interpret. `served`: the evaluator\'s column on `bars`; `bound`: the same with the two-start ceiling at 1 step '
      + '(B is never run: a running value is withheld from its first unknown bar on). The Python lane '
      + '(ast_interpret.interpret, newest_bar_is_forming false; TWO_START_CEILING[0] = 1 for `bound`) must equal both.',
    chart: CHART,
    bars: BARS,
    cases,
  }
}

const TEXT = `${JSON.stringify(build(), null, 1)}\n`
if (process.env.HTF_TWO_STARTS_WRITE === '1') fs.writeFileSync(FIXTURE, TEXT)
const COMMITTED = fs.existsSync(FIXTURE) ? fs.readFileSync(FIXTURE, 'utf8') : ''

afterEach(() => __twoStartCeilingForTests(null))

describe('the fixture both lanes read', () => {
  it('⭐ regenerates byte for byte (HTF_TWO_STARTS_WRITE=1 rewrites it)', () => {
    expect(COMMITTED).toBe(TEXT)
  })
})

const FIX = JSON.parse(COMMITTED || '{"cases": []}')
const byName = (prefix) => FIX.cases.find((c) => c.name.startsWith(prefix))
const shapeOf = (c) => SHAPES.find((s) => s.name === c.name)

describe('⭐ the acceptance measure: 0 wrong bars drawn, against the longer chart', () => {
  it('is not vacuous: every shape, the running ones, the one that never forgets and the kept ones', () => {
    expect(FIX.cases.length).toBe(SHAPES.length)
    expect(SHAPES.filter((s) => s.running).length).toBeGreaterThanOrEqual(8)
    expect(SHAPES.filter((s) => s.kept).length).toBeGreaterThanOrEqual(3)
    for (const c of FIX.cases) expect(c.served.length, c.name).toBe(BARS.length)
  })
  // ⛔ the KEPT shapes carry nothing the walk calls unknown: a smoother started on the cut chart's own first bars keeps
  // the off-listing seed it always had (FINDING 2's class, ruled no action), so they are judged by `firstDrawn` below
  for (const shape of SHAPES.filter((s) => !s.kept)) {
    it(shape.name, () => {
      const c = byName(shape.name)
      const long = run(c.tree, LONG).slice(CUT)
      let drawn = 0
      c.served.forEach((v, j) => {
        if (v === null) return
        drawn += 1
        // a bar the cut chart draws is the longer chart's, which holds the bars before the cut
        expect(long[j], `${c.name} bar ${j}: the longer chart withholds it`).not.toBe(null)
        expect(Math.abs(v - long[j]) <= 1e-9 * Math.max(1, Math.abs(long[j])), `${c.name} bar ${j}: ${v} != ${long[j]}`).toBe(true)
      })
      if (shape.never) expect(drawn, c.name).toBe(0)
      // a running value draws once its starts agree (the slow ones, a weekly ema, within the 52 weeks held)
      else expect(drawn, c.name).toBeGreaterThan(0)
    })
  }
})

describe('⭐ what moved, by name', () => {
  it('a running value over a partial week is withheld until its starts agree, then drawn (not withheld whole)', () => {
    const c = byName('ema(tf_merge(W, high), 3)')
    const first = c.served.findIndex((v) => v !== null)
    // the pointwise rule drew it from the bar after the partial week's merge (bar 5); its starts agree only later
    expect(first).toBeGreaterThan(10)
    // drawn from there on, the newest bar aside (`request:htf-newest-unconfirmed`)
    expect(c.served.slice(first, -1).every((v) => v !== null)).toBe(true)
  })
  it('a running value carrying a read before the chart is withheld until its starts agree', () => {
    const c = byName('ema(nz(close[1]), 3) (a running')
    expect(c.served.slice(0, 10).every((v) => v === null)).toBe(true)
    expect(c.served.some((v) => v !== null)).toBe(true)
  })
  it('KEPT: where no running value carries a value the starts disagree on, it draws from the bar it always did', () => {
    for (const shape of SHAPES.filter((s) => s.kept)) {
      const c = byName(shape.name)
      expect(c.served.findIndex((v) => v !== null), c.name).toBe(shape.firstDrawn)
      // with no running value carrying an unknown at all, the bound changes nothing either
      if (shape.unbounded) expect(c.bound, c.name).toEqual(c.served)
    }
  })
})

describe('⭐ ruling 4: bounded like MAX_RECURRENCE_STEPS, over it withheld from the first unknown bar on', () => {
  it('the bound is the recurrence ceiling, and a small tree on 260 bars is far inside it', () => {
    expect(twoStartSteps(call('ema', merge(HIGH), num(3)), BARS.length)).toBeLessThan(MAX_RECURRENCE_STEPS)
    expect(twoStartSteps(call('ema', merge(HIGH), num(3)), 10)).toBe(4 * 10)
  })
  it('over the bound a running value is withheld from its first unknown bar on, never drawn from a guessed start', () => {
    for (const shape of SHAPES.filter((s) => s.running || s.never)) {
      const c = byName(shape.name)
      const first = c.bound.findIndex((v) => v === null)
      expect(c.bound.every((v) => v === null), c.name).toBe(true)
      expect(first, c.name).toBe(0)
    }
  })
  it('the bound withholds at least what two starts do (a superset: it never draws a bar they withhold)', () => {
    for (const c of FIX.cases) c.served.forEach((v, j) => { if (v === null) expect(c.bound[j], `${c.name} bar ${j}`).toBe(null) })
  })
})
