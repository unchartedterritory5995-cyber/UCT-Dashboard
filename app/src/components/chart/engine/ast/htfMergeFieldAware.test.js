// app/src/components/chart/engine/ast/htfMergeFieldAware.test.js
//
// ─── ⭐⭐ HTF-MERGE-FIELD-AWARE (items 2 + 3, coordinator rulings 2026-11-19) — A MERGE'S FIRST PARTIAL PERIOD IS ────────
//     WITHHELD FIELD BY FIELD: WHERE IT IS READ THROUGH A HISTORY INSIDE THE MERGE, AND NOWHERE FOR A MERGE OF CLOSE
//
// A weekly / monthly merge (`tf_merge`, Pine's `request.security(…, 'W' | 'M')`, look-ahead off) on a chart that does not
// begin at the listing, whose first bar does not certainly open its period, builds that first period from PART of it.
// Review L2 withheld, field-unaware, the bars that SHOW the first period (its closing bar, the next period's other bars),
// whatever the merge reads. Two things were wrong with that (truth proxy, 120 daily charts cut from three longer
// histories, each against its longer chart):
//   - item 2: a history INSIDE the merge (`tf_merge(high[1])`, `tf_merge(sma(high, 2))`) reads the partial period on
//     the NEXT period's bars, which L2 drew: 320 wrong bars on 64 charts;
//   - item 3: a merge of `close` alone reads the period's own close (its last session's), which L2 withheld: correct
//     pictures taken away (0 wrong bars when drawn).
// Now (`interpret.js::firstPeriodPartialReadMask`'s `mergeOwn`, twin `ast_interpret._first_period_partial_read_mask`) a
// merge's own bars are HTF-LIVE-FIRST-PERIOD's walk: the child on the higher-timeframe bars with every field but `close`
// (and every bar reader) unknown on the first one, each chart bar reading the period the merge hands it
// (`tfMergeReads`). A merge holding another request, a merge under another request (`sym`), and the run's request
// (`requestAlignment`, a stand-in leaf) keep review L2's field-unaware bars. A running value inside is withheld where its
// argument is and not after (item 4, open): only its withheld bars are written.
//
// THE SHARED FIXTURE `tests/fixtures/ast/htf_merge_field_aware.json` is WRITTEN here (HTF_MERGE_FIELD_AWARE_WRITE=1) and
// READ by `tests/test_pine_htf_merge_field_aware.py`.
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import * as registry from '../nativeRegistry'
import { interpret, requestAlignment, TF_MERGE_FIRST_CODE } from './interpret'
import { memberPaneDefinition } from '../../builder/memberPane/memberPaneDefinition'

const FIXTURE = path.resolve(process.cwd(), '..', 'tests', 'fixtures', 'ast', 'htf_merge_field_aware.json')

const S = (name) => ({ type: 'series', name })
const CLOSE = S('close')
const HIGH = S('high')
const num = (value) => ({ type: 'num', value })
const merge = (arg = HIGH, code = 'W') => ({ type: 'tf_merge', value: code, args: [arg] })
const off = (k, a) => ({ type: 'offset', value: k, args: [a] })
const call = (name, ...args) => ({ type: 'call', name, args })
const op = (name, ...args) => ({ type: 'op', name, args })
const sym = (ticker, arg) => ({ type: 'sym', value: ticker, args: [arg] })
const hlc3 = () => op('/', op('+', op('+', HIGH, S('low')), CLOSE), num(3))
const n = null

function weekdays(start, end, holidays = []) {
  const out = []
  for (let d = new Date(`${start}T00:00:00Z`); d.toISOString().slice(0, 10) <= end; d.setUTCDate(d.getUTCDate() + 1)) {
    const iso = d.toISOString().slice(0, 10)
    if (d.getUTCDay() !== 0 && d.getUTCDay() !== 6 && !holidays.includes(iso)) out.push(iso)
  }
  return out
}
// ⭐ #2071's sets. Wednesday 2026-09-02 start: week 0 is bars 0-2 (PARTIAL; bar 2 closes it), week 1 bars 3-6 (bar 6
// closes it; Labour Day 09-07 is a holiday), week 2 bars 7-11, week 3 bars 12-16. A weekly merge hands bars 0-1 nothing,
// bars 2-5 week 0, bars 6-10 week 1, bars 11-15 week 2. September (bars 0-19) is partial; bar 19 closes it, bars 20-40
// read it, bar 41 (10-30) closes October. Bar i: o = i + 0.5, h = i + 1.5, l = i, c = i + 1, v = 100 + i, so
//   week 0 (partial): o 0.5, h 3.5, l 0, c 3, v 303     week 1: o 3.5, h 7.5, l 3, c 7, v 418
//   week 2: o 7.5, h 12.5, l 7, c 12, v 545             September close 20, October high 42.5, close 42.
// The Monday set starts on Monday 2026-09-14: its first week is whole (the CONTROL).
const DAYS = {
  wednesday: weekdays('2026-09-02', '2026-11-17', ['2026-09-07']),
  monday: weekdays('2026-09-14', '2026-11-17'),
}
const barsOn = (days) => days.map((t, i) => ({ t, o: i + 0.5, h: i + 1.5, l: i, c: i + 1, v: 100 + i }))
const CHART = { tf: 'D', newestBarIsForming: false }

function pineTree(body, version = 5) {
  const head = version === 5 ? '//@version=5\nindicator("p")' : '//@version=4\nstudy("p")'
  const pane = memberPaneDefinition({ source: `${head}\n${body}`, id: 'u_0000hmf00000', name: 'p' })
  const def = pane && pane.definition
  if (!def || !def.compute || def.compute.kind !== 'ast') throw new Error(`not a host-lane document: ${body}`)
  return def.compute.trees ? def.compute.trees[def.plots[0].key] : def.compute.ast
}

const W13 = [0, 13]
const SR_SHAPE = "plot(security(syminfo.tickerid, 'W', valuewhen(high >= highest(high, 3), high, 0)))"
const SHAPES = [
  // review L2's own bars, unchanged for a partial field
  { name: 'merge(high) (bars 2-5 show the partial week: withheld, as before)', tree: () => merge(), window: W13,
    expect: [n, n, n, n, n, n, 7.5, 7.5, 7.5, 7.5, 7.5, 12.5, 12.5] },
  { name: 'merge(open)', tree: () => merge(S('open')), window: W13,
    expect: [n, n, n, n, n, n, 3.5, 3.5, 3.5, 3.5, 3.5, 7.5, 7.5] },
  { name: 'merge(volume)', tree: () => merge(S('volume')), window: W13,
    expect: [n, n, n, n, n, n, 418, 418, 418, 418, 418, 545, 545] },
  { name: 'merge(hlc3)', tree: () => merge(hlc3()), window: W13,
    expect: [n, n, n, n, n, n, 17.5 / 3, 17.5 / 3, 17.5 / 3, 17.5 / 3, 17.5 / 3, 10.5, 10.5] },
  { name: 'merge(close + high) (close in an expression with a partial field: withheld)',
    tree: () => merge(op('+', CLOSE, HIGH)), window: W13,
    expect: [n, n, n, n, n, n, 14.5, 14.5, 14.5, 14.5, 14.5, 24.5, 24.5] },
  // ⭐ ITEM 2: a history inside the merge reads the partial week on week 1's bars, which L2 drew (3.5, 5.5)
  { name: 'merge(high[1]) (item 2: bars 6-10 read the partial week\'s high)', tree: () => merge(off(1, HIGH)),
    window: W13, expect: [n, n, n, n, n, n, n, n, n, n, n, 7.5, 7.5] },
  { name: 'merge(sma(high, 2)) (item 2: a window inside)', tree: () => merge(call('sma', HIGH, num(2))), window: W13,
    expect: [n, n, n, n, n, n, n, n, n, n, n, 10, 10] },
  // ⭐⭐ ITEM 4 (2026-11-19): withheld until the child's two starts agree (`walkTwoStarts`), past this window
  { name: 'merge(ema(high, 3)) (a running value inside: withheld until its two starts agree, ITEM 4)',
    tree: () => merge(call('ema', HIGH, num(3))), window: W13, held: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12] },
  // ⭐ ITEM 3: a merge of close alone is the period's own close: drawn
  { name: 'KEPT merge(close) (item 3: bars 2-5 draw the partial week\'s close, the week\'s)', tree: () => merge(CLOSE),
    window: W13, expect: [n, n, 3, 3, 3, 3, 7, 7, 7, 7, 7, 12, 12] },
  { name: 'KEPT merge(close)[1] (item 3: #2049\'s x[1], 3 on bar 6)', tree: () => off(1, merge(CLOSE)), window: W13,
    expect: [n, n, n, 3, 3, 3, 3, 7, 7, 7, 7, 7, 12] },
  { name: 'KEPT merge(close * 2)', tree: () => merge(op('*', CLOSE, num(2))), window: W13,
    expect: [n, n, 6, 6, 6, 6, 14, 14, 14, 14, 14, 24, 24] },
  { name: 'KEPT merge(close[1])', tree: () => merge(off(1, CLOSE)), window: W13,
    expect: [n, n, n, n, n, n, 3, 3, 3, 3, 3, 7, 7] },
  { name: 'KEPT merge(sma(close, 2))', tree: () => merge(call('sma', CLOSE, num(2))), window: W13,
    expect: [n, n, n, n, n, n, 5, 5, 5, 5, 5, 9.5, 9.5] },
  { name: "KEPT merge(close, 'M') (September's close on bars 19-40)", tree: () => merge(CLOSE, 'M'), window: [17, 23],
    expect: [n, n, 20, 20, 20, 20] },
  { name: "merge(high, 'M') (September, bars 19-40, withheld as before)", tree: () => merge(HIGH, 'M'), window: [38, 44],
    expect: [n, n, n, 42.5, 42.5, 42.5] },
  // review L2's field-unaware bars, kept: another request around or inside the merge
  { name: "sym('SPY', merge(close)) (under another request: review L2's bars, kept)", symbols: true,
    tree: () => sym('SPY', merge(CLOSE)), window: W13, expect: [n, n, n, n, n, n, 7, 7, 7, 7, 7, 12, 12] },
  // the Pine door's own trees
  { name: 'KEPT the Pine door: request.security(syminfo.tickerid, "W", close)',
    tree: () => pineTree('plot(request.security(syminfo.tickerid, "W", close))'), window: W13,
    expect: [n, n, 3, 3, 3, 3, 7, 7, 7, 7, 7, 12, 12] },
  { name: 'the Pine door: request.security(syminfo.tickerid, "W", high[1]) (item 2)',
    tree: () => pineTree('plot(request.security(syminfo.tickerid, "W", high[1]))'), window: W13,
    expect: [n, n, n, n, n, n, n, n, n, n, n, 7.5, 7.5] },
  // ⭐⭐ COORDINATOR RULING (S&R, 2026-11-19): a window that reaches into the partial first period (support-and-
  // resistance-multi-time-frame's `valuewhen(high >= highest(high, n), high, 0)`) is UNPROVABLE on a chart whose
  // history starts after the listing (TradingView holds the whole period): withheld until a known new extreme (weeks
  // 0-2 here: bars 2-15). On a chart that reaches the listing TradingView's first period is partial too: drawn, nothing
  // extra withheld (week 2's 12.5 on bars 11-15; weeks 0-1 read na: `highest` over fewer than 3 weeks)
  { name: 'S&R shape: security(…, "W", valuewhen(high >= highest(high, 3), high, 0)) on a partial start (withheld)',
    tree: () => pineTree(SR_SHAPE, 4), window: [0, 18], expect: [n, n, n, n, n, n, n, n, n, n, n, n, n, n, n, n, 17.5, 17.5] },
  { name: 'CONTROL S&R shape from the listing (a listing-reaching chart: drawn, nothing extra withheld)',
    opts: { historyFromListing: true }, tree: () => pineTree(SR_SHAPE, 4), window: [0, 18],
    expect: [n, n, n, n, n, n, n, n, n, n, n, 12.5, 12.5, 12.5, 12.5, 12.5, 17.5, 17.5] },
  // CONTROLS: nothing partial
  { name: 'CONTROL merge(high[1]) on the Monday set', set: 'monday', tree: () => merge(off(1, HIGH)), window: [0, 12],
    expect: [n, n, n, n, n, n, n, n, n, 5.5, 5.5, 5.5] },
  { name: 'CONTROL merge(high[1]) from the listing', opts: { historyFromListing: true }, tree: () => merge(off(1, HIGH)),
    window: W13, expect: [n, n, n, n, n, n, 3.5, 3.5, 3.5, 3.5, 3.5, 7.5, 7.5] },
]

const definitionOf = (tree, i) => {
  const id = `u_0000hmf${String(i + 1).padStart(5, '0')}`
  return { id, name: id, version: 1, plots: [{ key: 'value', style: 'line' }],
    compute: { kind: 'ast', fn: id, source: id, ast: tree }, meta: { recurrenceOrigin: 'pine' } }
}
const asNulls = (col) => Array.from(col || []).map((v) => (Number.isFinite(v) ? v : null))
const chartOf = (c) => ({ ...CHART, ...(c.opts || {}),
  ...(c.symbols ? { symbols: { SPY: barsOn(DAYS[c.set || 'wednesday']) } } : {}) })
const served = (tree, i, c) => asNulls(registry.computeFor(definitionOf(tree, i), barsOn(DAYS[c.set || 'wednesday']), {},
  chartOf(c)).value)

function build() {
  const cases = SHAPES.map((shape, i) => {
    const set = shape.set || 'wednesday'
    const tree = shape.tree()
    return { name: shape.name, set, opts: shape.opts || {}, symbols: !!shape.symbols, tree, window: shape.window,
      ...(shape.held ? { held: shape.held } : { expect: shape.expect }),
      // a `sym` case is the evaluator's column (`interpret`, `symbols` in its opts): the registry's `computeFor` takes its
      // other symbols from the chart's binding, not from these opts
      served: shape.symbols ? asNulls(interpret(tree, barsOn(DAYS[set]), {}, undefined, undefined, chartOf(shape)))
        : served(tree, i, shape) }
  })
  return {
    _about: 'HTF-MERGE-FIELD-AWARE (items 2 + 3, 2026-11-19). WRITTEN by '
      + 'app/src/components/chart/engine/ast/htfMergeFieldAware.test.js (HTF_MERGE_FIELD_AWARE_WRITE=1), READ by it and '
      + 'by tests/test_pine_htf_merge_field_aware.py. `expect`: the hand-written answer over `window` (null = blank or '
      + 'withheld); `held` (a running value): the bars of `window` that are blank or withheld, every other bar drawn. '
      + '`served`: the chart\'s column (computeFor, `chart` + the case\'s `opts`; a `symbols` case: the evaluator\'s '
      + 'column, interpret, with SPY supplied as the same bars) on `days[set]` (ISO keys; bar i: o = i + 0.5, h = i + 1.5, l = i, c = i + 1, v = 100 + i); the Python lane '
      + '(ast_interpret.interpret, newest_bar_is_forming false) must equal it bar for bar.',
    chart: CHART,
    days: DAYS,
    cases,
  }
}

const TEXT = `${JSON.stringify(build(), null, 1)}\n`
if (process.env.HTF_MERGE_FIELD_AWARE_WRITE === '1') fs.writeFileSync(FIXTURE, TEXT)
const COMMITTED = fs.existsSync(FIXTURE) ? fs.readFileSync(FIXTURE, 'utf8') : ''

describe('the fixture both lanes read', () => {
  it('⭐ regenerates byte for byte (HTF_MERGE_FIELD_AWARE_WRITE=1 rewrites it)', () => {
    expect(COMMITTED).toBe(TEXT)
  })
})

const FIX = JSON.parse(COMMITTED || '{"cases": []}')
const close = (got, want, label) => {
  expect(got.length, label).toBe(want.length)
  got.forEach((v, j) => {
    if (want[j] === null) expect(v, `${label} bar ${j}`).toBe(null)
    else expect(v, `${label} bar ${j}`).toBeCloseTo(want[j], 9)
  })
}

describe('the served column of every case is the hand-written answer', () => {
  it('is not vacuous: every case, a window inside its bars, the controls and the kept reads', () => {
    expect(FIX.cases.length).toBe(SHAPES.length)
    expect(FIX.cases.filter((c) => c.name.startsWith('KEPT')).length).toBeGreaterThanOrEqual(6)
    expect(FIX.cases.filter((c) => c.name.startsWith('CONTROL')).length).toBeGreaterThanOrEqual(2)
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
      close(asNulls(interpret(c.tree, barsOn(DAYS[c.set]), {}, undefined, undefined, chartOf(c))), c.served,
        `${c.name} interpret`)
    })
  }
})

const codesOf = (tree, set = 'wednesday', opts = {}) => {
  const sink = new Map()
  interpret(tree, barsOn(DAYS[set]), {}, undefined, undefined, { ...CHART, ...opts, chartClockSink: sink })
  return sink
}

describe('⭐ the two rulings, by name', () => {
  it('item 2: merge(high[1]) on bar 6 is withheld, never 3.5 (week 1 reading the partial week); from the listing 3.5', () => {
    expect(FIX.cases.find((x) => x.name.startsWith('merge(high[1]) (item 2')).served[6]).toBe(null)
    expect(FIX.cases.find((x) => x.name.startsWith('CONTROL merge(high[1]) from the listing')).served[6]).toBe(3.5)
    expect(codesOf(merge(off(1, HIGH))).has(TF_MERGE_FIRST_CODE)).toBe(true)
  })
  it('item 3: merge(close) draws the partial week\'s close, 3, on bars 2-5, and names no first-period code', () => {
    expect(FIX.cases.find((x) => x.name.startsWith('KEPT merge(close) (item 3')).served.slice(2, 6)).toEqual([3, 3, 3, 3])
    expect(codesOf(merge(CLOSE)).has(TF_MERGE_FIRST_CODE)).toBe(false)
    expect(codesOf(off(1, merge(CLOSE))).has(TF_MERGE_FIRST_CODE)).toBe(false)
  })
})

describe('⭐⭐ the served support-and-resistance-multi-time-frame (coordinator ruling): withheld only off the listing', () => {
  // its weekly merges read `valuewhen(high >= highest(high, 34), high, 0)`: on rising weekly highs every week from
  // the 34th draws its own high; the 34-week window over the partial week 0 is unknown for weeks 0-33
  const SR = path.resolve(process.cwd(), '..', 'corpus', 'committed', 'support-and-resistance-multi-time-frame__Ph230jpfC9.pine')
  const def = memberPaneDefinition({ source: fs.readFileSync(SR, 'utf8'), id: 'u_0000hmfsr001', name: 'sr' }).definition
  const days = weekdays('2026-09-02', '2027-12-31', ['2026-09-07'])
  const bars = barsOn(days)
  const weekly = (opts) => asNulls(registry.computeFor(def, bars, {}, { ...CHART, ...opts }).out3)
  // the chart bar that CLOSES the k-th week (0-based): the last bar of that ISO week
  const weekKey = (iso) => { const d = new Date(`${iso}T00:00:00Z`); d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7)); return d.toISOString().slice(0, 10) }
  const closes = days.map((t, i) => i + 1 < days.length && weekKey(days[i + 1]) !== weekKey(t)).reduce((a, c, i) => (c ? [...a, i] : a), [])
  it('is the host lane, and out3 is its weekly resistance (a tf_merge over valuewhen and highest)', () => {
    expect(def.compute.kind).toBe('ast')
    expect(JSON.stringify(def.compute.trees.out3)).toContain('"tf_merge"')
    expect(JSON.stringify(def.compute.trees.out3)).toContain('"highest"')
  })
  // the code is asked of the evaluator (`interpret` names it in the chart-clock channel; `computeFor` reports otherwise)
  const named = (opts) => {
    const sink = new Map()
    interpret(def.compute.trees.out3, bars, {}, undefined, undefined, { ...CHART, ...opts, chartClockSink: sink })
    return sink.has(TF_MERGE_FIRST_CODE)
  }
  it('a listing-reaching chart: week 33 draws its high from its closing bar on, and no first-period code is named', () => {
    const col = weekly({ historyFromListing: true })
    const c33 = closes[33]
    expect(col[c33]).toBe(c33 + 1.5)
    expect(col.slice(c33, closes[34]).every((v) => v === c33 + 1.5)).toBe(true)
    expect(named({ historyFromListing: true })).toBe(false)
  })
  it('a partial-start chart: weeks 0-33 are withheld by name (the window reaches the partial week), week 34 is drawn', () => {
    const col = weekly({})
    const listing = weekly({ historyFromListing: true })
    expect(col.slice(0, closes[34]).every((v) => v === null)).toBe(true)
    expect(listing.slice(0, closes[34]).filter((v) => v !== null).length).toBeGreaterThan(0)
    expect(col[closes[34]]).toBe(closes[34] + 1.5)
    expect(col.slice(closes[34], -1)).toEqual(listing.slice(closes[34], -1))
    expect(named({})).toBe(true)
  })
})

describe('⛔ the run\'s request keeps review L2\'s field-unaware bars (its leaf stands in for any field)', () => {
  it('requestAlignment (look-ahead off) withholds bars 2-5 and names the code, as before', () => {
    const bars = barsOn(DAYS.wednesday)
    const sink = new Map()
    const { withheld } = requestAlignment({ chartBars: bars, srcBars: bars, code: 'W',
      opts: { ...CHART, chartClockSink: sink } })
    expect(Array.from(withheld.slice(0, 7))).toEqual([0, 0, 1, 1, 1, 1, 0])
    expect(sink.has(TF_MERGE_FIRST_CODE)).toBe(true)
  })
})
