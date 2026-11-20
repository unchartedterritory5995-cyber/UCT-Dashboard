// app/src/components/chart/engine/ast/htfPartialThroughOffset.test.js
//
// ─── ⭐⭐ HTF-PARTIAL-THROUGH-OFFSET (2026-11-19) — THE FIRST PARTIAL PERIOD'S VALUE IS WITHHELD WHEREVER A ROOT ───────
//     READS IT, NOT ONLY ON THE BARS WHERE THE MERGE STANDS
//
// On a chart that does not begin at the listing, a weekly / monthly merge (`tf_merge`, Pine's `request.security(…,
// 'W' | 'M')`, look-ahead off) builds its FIRST period from part of it when the first bar does not open that period.
// The bars that show that value (the period's closing bar and the next period's other bars) are withheld by name,
// `request:htf-first-period-partial` (review L2). The mask was applied at the ROOT's own positions, so a history read
// moved the value out from under it: on these Wednesday-start bars `x = tf_merge(high, 'W')` is withheld on bars 2-5,
// yet `x[1]` DREW 3.5 on bar 6, the partial week's high, where TradingView (holding the whole week) draws another
// (PR #2049's finding, both lanes). Which root bars read a withheld merge bar is now engine 56's walk
// (`interpret.js::firstPeriodPartialReadMask`, twin `ast_interpret._first_period_partial_read_mask`): `x[k]` moves the
// bars k later, a computed expression reads them on its bar, a window over its own span; `barsAgo` reads the bar its
// count lands on and `c ? a : b` the arm its known condition takes, so a bar whose read lands on a WHOLE period stays
// drawn. A running value (`ema`, `cum`) keeps the rule it had: withheld where its argument is, never from there on
// (that would take away bars a smoother has forgotten the partial week in); what it carries afterwards is an open
// question this change does not settle.
//
// THE SHARED FIXTURE `tests/fixtures/ast/htf_partial_through_offset.json` is WRITTEN here
// (HTF_PARTIAL_THROUGH_OFFSET_WRITE=1) and READ by `tests/test_pine_htf_partial_through_offset.py`: every case's tree,
// the hand-written expectation (`expect` over `window`, written below, never computed) and the column the chart serves
// (`computeFor`), which the Python lane must equal bar for bar.
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import * as registry from '../nativeRegistry'
import { interpret, TF_MERGE_FIRST_CODE } from './interpret'
import { memberPaneDefinition } from '../../builder/memberPane/memberPaneDefinition'

const FIXTURE = path.resolve(process.cwd(), '..', 'tests', 'fixtures', 'ast', 'htf_partial_through_offset.json')

const CLOSE = { type: 'series', name: 'close' }
const HIGH = { type: 'series', name: 'high' }
const num = (value) => ({ type: 'num', value })
const merge = (code = 'W', arg = HIGH) => ({ type: 'tf_merge', value: code, args: [arg] })
const off = (k, a) => ({ type: 'offset', value: k, args: [a] })
const call = (name, ...args) => ({ type: 'call', name, args })
const op = (name, ...args) => ({ type: 'op', name, args })
const X = () => merge('W')
const n = null

/** Weekdays from `start` to `end` (ISO), the holidays left out. */
function weekdays(start, end, holidays = []) {
  const out = []
  for (let d = new Date(`${start}T00:00:00Z`); d.toISOString().slice(0, 10) <= end; d.setUTCDate(d.getUTCDate() + 1)) {
    const iso = d.toISOString().slice(0, 10)
    if (d.getUTCDay() !== 0 && d.getUTCDay() !== 6 && !holidays.includes(iso)) out.push(iso)
  }
  return out
}
// ⭐ PR #2049's Tuesday set: it starts on WEDNESDAY 2026-09-02, so its first week (Wed-Fri) and its first month are
// partial; bar 2 (Fri 09-04) closes week 0, bar 6 (Fri 09-11) closes week 1 (Labour Day 09-07 is a holiday), bar 19
// (Wed 09-30) closes September, bar 41 (Fri 10-30) closes October; the newest bar is a finished Tuesday.
// The Monday set starts on Monday 2026-09-14: its first week is whole (the CONTROL).
const DAYS = {
  wednesday: weekdays('2026-09-02', '2026-11-17', ['2026-09-07']),
  monday: weekdays('2026-09-14', '2026-11-17'),
}
const barsOn = (days) => days.map((t, i) => ({ t, o: i + 0.5, h: i + 1.5, l: i, c: i + 1, v: 100 + i }))
const CHART = { tf: 'D', newestBarIsForming: false }

/** The Pine door's own tree for a one-plot script (the member pane, as a member's chart builds it). */
function pineTree(body) {
  const pane = memberPaneDefinition({ source: `//@version=5\nindicator("p")\n${body}`, id: 'u_0000hpo00000', name: 'p' })
  const def = pane && pane.definition
  if (!def || !def.compute || def.compute.kind !== 'ast') throw new Error(`not a host-lane document: ${body}`)
  return def.compute.trees ? def.compute.trees[def.plots[0].key] : def.compute.ast
}

// ⭐ THE SHAPES AND WHAT EACH SHOWS, WRITTEN BY HAND over `window` (null = blank or withheld). On the Wednesday set
// x = tf_merge(high, 'W') is, before any mask: na on bars 0-1 (no earlier week), 3.5 on bars 2-5 (week 0, PARTIAL),
// 7.5 on bars 6-10 (week 1), 12.5 on bars 11-15 (week 2); bar i closes at i + 1.
const W16 = [0, 16]
const SHAPES = [
  // CONTROL: the merge's own bars are what they were (review L2)
  { name: 'x (a direct read: bars 2-5 withheld, as before)', tree: () => X(), window: W16,
    expect: [n, n, n, n, n, n, 7.5, 7.5, 7.5, 7.5, 7.5, 12.5, 12.5, 12.5, 12.5, 12.5] },
  // ⭐ THE DEFECT: bar 6 drew 3.5
  { name: 'x[1] (bars 3-6 withheld; bar 7 reads the whole week 1)', tree: () => off(1, X()), window: W16,
    expect: [n, n, n, n, n, n, n, 7.5, 7.5, 7.5, 7.5, 7.5, 12.5, 12.5, 12.5, 12.5] },
  { name: 'x[2] (bars 4-7 withheld)', tree: () => off(2, X()), window: W16,
    expect: [n, n, n, n, n, n, n, n, 7.5, 7.5, 7.5, 7.5, 7.5, 12.5, 12.5, 12.5] },
  { name: 'x[1] * 2 - close (a computed expression over x[1])', tree: () => op('-', op('*', off(1, X()), num(2)), CLOSE),
    window: W16, expect: [n, n, n, n, n, n, n, 7, 6, 5, 4, 3, 12, 11, 10, 9] },
  { name: 'sma(x[1], 3) - close (a window over x[1]: bars 3-8 withheld)',
    tree: () => op('-', call('sma', off(1, X()), num(3)), CLOSE), window: W16,
    expect: [n, n, n, n, n, n, n, n, n, -2.5, -3.5, -4.5, (7.5 + 7.5 + 12.5) / 3 - 13, (7.5 + 12.5 + 12.5) / 3 - 14, -2.5, -3.5] },
  { name: '(x[1])[1] (a nested offset: as x[2])', tree: () => off(1, off(1, X())), window: W16,
    expect: [n, n, n, n, n, n, n, n, 7.5, 7.5, 7.5, 7.5, 7.5, 12.5, 12.5, 12.5] },
  { name: '(x[1] + close)[1] (a nested offset over an expression)', tree: () => off(1, op('+', off(1, X()), CLOSE)),
    window: W16, expect: [n, n, n, n, n, n, n, n, 15.5, 16.5, 17.5, 18.5, 19.5, 25.5, 26.5, 27.5] },
  { name: 'barsAgo(x, 1, 5) (a count read per bar: the bar it lands on, not its whole buffer)',
    tree: () => call('barsAgo', X(), num(1), num(5)), window: W16,
    expect: [n, n, n, n, n, n, n, 7.5, 7.5, 7.5, 7.5, 7.5, 12.5, 12.5, 12.5, 12.5] },
  { name: 'barsAgo(x, mod(close, 2) + 1, 5) (a count that moves: 2 on even bars, 1 on odd)',
    tree: () => call('barsAgo', X(), op('+', call('mod', CLOSE, num(2)), num(1)), num(5)), window: W16,
    expect: [n, n, n, n, n, n, n, 7.5, 7.5, 7.5, 7.5, 7.5, 7.5, 12.5, 12.5, 12.5] },
  // ⭐ PERIOD −1 (2026-11-19): bars 0-2 read the week BEFORE the first, which this chart does not hold (TradingView reads
  // a value there): withheld by name (`history:before-chart`), no longer drawn as `nz`'s 0
  { name: 'nz(x[1], 0) (bars 0-2 read the week before the first: withheld, PERIOD −1)', tree: () => call('nz', off(1, X()), num(0)),
    window: W16, expect: [n, n, n, n, n, n, n, 7.5, 7.5, 7.5, 7.5, 7.5, 12.5, 12.5, 12.5, 12.5] },
  { name: 'na(x[1]) ? x[2] : x[1] (the arm a known condition takes: bar 7 reads x[1], a whole week)',
    tree: () => op('?:', call('na', off(1, X())), off(2, X()), off(1, X())), window: W16,
    expect: [n, n, n, n, n, n, n, 7.5, 7.5, 7.5, 7.5, 7.5, 12.5, 12.5, 12.5, 12.5] },
  // ⭐⭐ ITEM 4 (2026-11-19): A RUNNING VALUE is drawn only where two starts agree (`walkTwoStarts`; the acceptance measure is
  // `htfTwoStarts.test.js`'s): it carried the partial week after its withheld bars, and its partial and later starts do not
  // agree, bit for bit, inside this window, so only the WITHHELD bars are written (`held`): all of them
  { name: 'ema(x, 3) (a running value: withheld until its two starts agree, ITEM 4)', tree: () => call('ema', X(), num(3)),
    window: W16, held: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15] },
  { name: 'ema(x[1], 3) (a running value over x[1]: withheld until its two starts agree, ITEM 4)',
    tree: () => call('ema', off(1, X()), num(3)), window: W16, held: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15] },
  // the monthly merge: September is partial; bar 19 (09-30) closes it, bars 20-40 show it, bar 41 (10-30) closes October
  { name: "close > tf_merge(high, 'M')[1] (bars 20-41 withheld; 17-19 read the month before the first: withheld, PERIOD −1)",
    tree: () => op('>', CLOSE, off(1, merge('M'))), window: [17, 44],
    expect: [n, n, n, n, n, n, n, n, n, n, n, n, n, n, n, n, n, n, n, n, n, n, n, n, n, 1, 1] },
  // the Pine door's own trees
  { name: 'the Pine door: request.security(syminfo.tickerid, "W", high)[1]',
    tree: () => pineTree('plot(request.security(syminfo.tickerid, "W", high)[1])'), window: W16,
    expect: [n, n, n, n, n, n, n, 7.5, 7.5, 7.5, 7.5, 7.5, 12.5, 12.5, 12.5, 12.5] },
  { name: 'the Pine door: nz(w[1]) of w = request.security(syminfo.tickerid, "W", high)',
    tree: () => pineTree('w = request.security(syminfo.tickerid, "W", high)\nplot(nz(w[1]))'), window: W16,
    expect: [n, n, n, n, n, n, n, 7.5, 7.5, 7.5, 7.5, 7.5, 12.5, 12.5, 12.5, 12.5] },
  // CONTROLS: nothing partial, nothing withheld for it
  { name: 'CONTROL x[1] on the Monday set (the first bar opens its week)', set: 'monday', tree: () => off(1, X()),
    window: [0, 12], expect: [n, n, n, n, n, 5.5, 5.5, 5.5, 5.5, 5.5, 10.5, 10.5] },
  { name: 'CONTROL x[1] from the listing (the first week is the whole week)', opts: { historyFromListing: true },
    tree: () => off(1, X()), window: W16,
    expect: [n, n, n, 3.5, 3.5, 3.5, 3.5, 7.5, 7.5, 7.5, 7.5, 7.5, 12.5, 12.5, 12.5, 12.5] },
]

const definitionOf = (tree, i) => {
  const id = `u_0000hpo${String(i + 1).padStart(5, '0')}`
  return { id, name: id, version: 1, plots: [{ key: 'value', style: 'line' }],
    compute: { kind: 'ast', fn: id, source: id, ast: tree }, meta: { recurrenceOrigin: 'pine' } }
}
const asNulls = (col) => Array.from(col || []).map((v) => (Number.isFinite(v) ? v : null))
// ⭐ PERIOD −1 — a Pine document's lane facts, what `computeFor` hands it (`astColumns.js::barIndexAbsoluteFor` /
// `varOriginAbsoluteFor`), so the evaluator's column below is the chart's
const chartOf = (c) => ({ ...CHART, barIndexAbsolute: true, varOriginAbsolute: true, ...(c.opts || {}) })
const served = (tree, i, set, chart) => asNulls(registry.computeFor(definitionOf(tree, i), barsOn(DAYS[set]), {},
  chart).value)

function build() {
  const cases = SHAPES.map((shape, i) => {
    const set = shape.set || 'wednesday'
    const tree = shape.tree()
    return { name: shape.name, set, opts: shape.opts || {}, tree, window: shape.window,
      ...(shape.held ? { held: shape.held } : { expect: shape.expect }), served: served(tree, i, set, chartOf(shape)) }
  })
  return {
    _about: 'HTF-PARTIAL-THROUGH-OFFSET (2026-11-19). WRITTEN by '
      + 'app/src/components/chart/engine/ast/htfPartialThroughOffset.test.js (HTF_PARTIAL_THROUGH_OFFSET_WRITE=1), READ '
      + 'by it and by tests/test_pine_htf_partial_through_offset.py. `expect`: the hand-written answer over `window` '
      + '(null = blank or withheld); `held` (a running value: its values after the withheld bars are not written): '
      + 'the bars of `window` that are blank or withheld, every other bar drawn. `served`: the chart\'s column (computeFor, `chart` + the case\'s `opts`) on '
      + '`days[set]` (ISO keys; bar i: o = i + 0.5, h = i + 1.5, l = i, c = i + 1, v = 100 + i); the Python lane '
      + '(ast_interpret.interpret, newest_bar_is_forming false) must equal it bar for bar.',
    chart: CHART,
    days: DAYS,
    cases,
  }
}

const TEXT = `${JSON.stringify(build(), null, 1)}\n`
if (process.env.HTF_PARTIAL_THROUGH_OFFSET_WRITE === '1') fs.writeFileSync(FIXTURE, TEXT)
const COMMITTED = fs.existsSync(FIXTURE) ? fs.readFileSync(FIXTURE, 'utf8') : ''

describe('the fixture both lanes read', () => {
  it('⭐ regenerates byte for byte (HTF_PARTIAL_THROUGH_OFFSET_WRITE=1 rewrites it)', () => {
    expect(COMMITTED).toBe(TEXT)
  })
})

// ⛔ the committed file, never this run's regeneration: a drift is red above, and every rail below reads what the
// Python lane reads
const FIX = JSON.parse(COMMITTED || '{"cases": []}')
const close = (got, want, label) => {
  expect(got.length, label).toBe(want.length)
  got.forEach((v, j) => {
    if (want[j] === null) expect(v, `${label} bar ${j}`).toBe(null)
    else expect(v, `${label} bar ${j}`).toBeCloseTo(want[j], 9)
  })
}

describe('the served column of every case is the hand-written answer', () => {
  it('is not vacuous: every case, a window inside its bars, the Monday control', () => {
    expect(FIX.cases.length).toBe(SHAPES.length)
    for (const c of FIX.cases) {
      if (c.held) expect(c.held.every((j) => j >= 0 && j < c.window[1] - c.window[0]), c.name).toBe(true)
      else expect(c.expect.length, c.name).toBe(c.window[1] - c.window[0])
      expect(c.served.length, c.name).toBe(DAYS[c.set].length)
    }
  })
  for (const c of FIX.cases) {
    it(c.name, () => {
      const got = c.served.slice(c.window[0], c.window[1])
      if (c.held) got.forEach((v, j) => expect(v === null, `${c.name} bar ${j}`).toBe(c.held.includes(j)))
      else close(got, c.expect, c.name)
      // the evaluator the chart's column is built from says the same, bar for bar
      close(asNulls(interpret(c.tree, barsOn(DAYS[c.set]), {}, undefined, undefined, chartOf(c))), c.served, `${c.name} interpret`)
    })
  }
})

describe('⭐ the defect, by name', () => {
  it('x[1] on bar 6 is withheld, never 3.5 (the partial week\'s high); bar 7 reads week 1 whole and draws 7.5', () => {
    const c = FIX.cases.find((x) => x.name.startsWith('x[1] (bars 3-6'))
    expect(c.served[6]).toBe(null)
    expect(c.served[7]).toBe(7.5)
    // the same shape from the listing draws 3.5 there: it is the partial week's value, not a hole
    const listing = FIX.cases.find((x) => x.name.startsWith('CONTROL x[1] from the listing'))
    expect(listing.served[6]).toBe(3.5)
  })
  it('the code and its sentence are named for x[1] (the same code and sentence as x); the Monday control names none', () => {
    const codesOf = (tree, set) => {
      const sink = new Map()
      interpret(tree, barsOn(DAYS[set]), {}, undefined, undefined, { ...CHART, chartClockSink: sink })
      return sink
    }
    const named = codesOf(off(1, X()), 'wednesday')
    const direct = codesOf(X(), 'wednesday')
    expect(named.has(TF_MERGE_FIRST_CODE)).toBe(true)
    expect(named.get(TF_MERGE_FIRST_CODE)).toBe(direct.get(TF_MERGE_FIRST_CODE))
    expect(String(named.get(TF_MERGE_FIRST_CODE)).length).toBeGreaterThan(20)
    expect(codesOf(off(1, X()), 'monday').has(TF_MERGE_FIRST_CODE)).toBe(false)
  })
  it('the newest bar is the newest-bar rule\'s, unchanged: x[1] draws it, x withholds it (a finished Tuesday)', () => {
    // bar 53 (Tue 11-17) reads bar 52 (Mon 11-16), which shows the week of 11-09..11-13 (bar 51 closes it: h = 52.5)
    const last = DAYS.wednesday.length - 1
    expect(last).toBe(53)
    expect(FIX.cases.find((x) => x.name.startsWith('x[1] (bars 3-6')).served[last]).toBe(52.5)
    expect(FIX.cases.find((x) => x.name.startsWith('x (a direct read')).served[last]).toBe(null)
  })
})
