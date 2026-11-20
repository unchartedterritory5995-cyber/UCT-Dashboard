// app/src/components/chart/engine/ast/htfLiveFirstPeriod.test.js
//
// ─── ⭐⭐ HTF-LIVE-FIRST-PERIOD (2026-11-19) — A LOOK-AHEAD READ OF A PERIOD BUILT FROM PART OF IT IS WITHHELD ON THE ─────
//     HOST COLUMN, BY NAME, EXCEPT WHERE IT READS ONLY `close`
//
// `request.security(…, 'W' | 'M', x, lookahead = barmerge.lookahead_on)` is `tf_live`: each chart bar reads the period
// it is INSIDE (`tfLiveReads`). On a chart that does not begin at the listing, whose first bar does not certainly open
// its week or month, that first period's higher-timeframe bar is built from PART of the period (`resampleTo`): its
// `close` (the period's last session's close) and its `t` are the whole period's; its `open`, `high`, `low` and
// `volume` are not. The run's request withheld those bars by name (`request:htf-lookahead-first-period-partial`,
// `tfLiveFirstPeriodMask`); the HOST column drew them. Measured by the truth proxy (120 daily charts cut from three
// longer histories, each against its longer chart, which holds the period whole as TradingView does): `tf_live('W',
// high)` drew 147 wrong bars on 64 charts, `tf_live('W', high[1])` (the second period reads the first) 320 on 64,
// `tf_live('W', close)` 0.
// Now (`interpret.js::tfLiveFirstPeriodReadMask`, twin `ast_interpret._tf_live_first_period_read_mask`): each `tf_live`
// child is walked on the higher-timeframe bars with every field but `close` (and every bar reader) unknown on the
// first one (engine 56's walk, taken exactly), each chart bar reads its own period's answer, and the root bars that
// read an unknown one are withheld (engine 56's walk again: `x[k]` moves them k bars later). `close`, `close[1]`,
// `sma(close, 2)`, `close * 2 + 1` keep their picture. A running value over a partial field (`ema(high, 3)`) is withheld
// where its argument is and not after: what it carries of the partial period is an open question (item 4), not settled
// here, so only its WITHHELD bars are written.
//
// THE SHARED FIXTURE `tests/fixtures/ast/htf_live_first_period.json` is WRITTEN here (HTF_LIVE_FIRST_PERIOD_WRITE=1) and
// READ by `tests/test_pine_htf_live_first_period.py`: every case's tree, the hand-written expectation (`expect` over
// `window`, written below, never computed) and the column the chart serves (`computeFor`), which the Python lane must
// equal bar for bar.
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import * as registry from '../nativeRegistry'
import { interpret, tfLiveMask, TF_LIVE_FIRST_CODE, TF_LIVE_FIRST_SENTENCE, CHART_CLOCK_WITHHELD, requestAlignment }
  from './interpret'
import { memberPaneDefinition } from '../../builder/memberPane/memberPaneDefinition'

const FIXTURE = path.resolve(process.cwd(), '..', 'tests', 'fixtures', 'ast', 'htf_live_first_period.json')
const CPR = path.resolve(process.cwd(), '..', 'corpus', 'committed',
  'cpr-with-mas-super-trend-vwap-by-guruprasadmeduri__htrxxqBqNz.pine')

const S = (name) => ({ type: 'series', name })
const CLOSE = S('close')
const HIGH = S('high')
const num = (value) => ({ type: 'num', value })
const live = (arg = HIGH, code = 'W') => ({ type: 'tf_live', value: code, args: [arg] })
const off = (k, a) => ({ type: 'offset', value: k, args: [a] })
const call = (name, ...args) => ({ type: 'call', name, args })
const op = (name, ...args) => ({ type: 'op', name, args })
const sym = (ticker, arg) => ({ type: 'sym', value: ticker, args: [arg] })
const hlc3 = () => op('/', op('+', op('+', HIGH, S('low')), CLOSE), num(3))
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
// ⭐ #2071's sets. The Wednesday set starts on WEDNESDAY 2026-09-02: week 0 is bars 0-2 (Wed-Fri, PARTIAL), week 1
// bars 3-6 (Labour Day 09-07 is a holiday), week 2 bars 7-11, week 3 bars 12-16; September (bars 0-19) is partial,
// October is bars 20-41. Bar i: o = i + 0.5, h = i + 1.5, l = i, c = i + 1, v = 100 + i, so the weekly bars are
//   week 0 (partial): o 0.5, h 3.5, l 0, c 3, v 303     week 1: o 3.5, h 7.5, l 3, c 7, v 418
//   week 2: o 7.5, h 12.5, l 7, c 12, v 545             week 3: o 12.5, h 17.5, l 12, c 17, v 570
// The Monday set starts on Monday 2026-09-14: its first week is whole (the CONTROL).
const DAYS = {
  wednesday: weekdays('2026-09-02', '2026-11-17', ['2026-09-07']),
  monday: weekdays('2026-09-14', '2026-11-17'),
}
const barsOn = (days) => days.map((t, i) => ({ t, o: i + 0.5, h: i + 1.5, l: i, c: i + 1, v: 100 + i }))
const CHART = { tf: 'D', newestBarIsForming: false }

/** The Pine door's own tree for a one-plot script (the member pane, as a member's chart builds it). */
function pineTree(body, version = 5) {
  const head = version === 5 ? '//@version=5\nindicator("p")' : '//@version=4\nstudy("p")'
  const pane = memberPaneDefinition({ source: `${head}\n${body}`, id: 'u_0000hlf00000', name: 'p' })
  const def = pane && pane.definition
  if (!def || !def.compute || def.compute.kind !== 'ast') throw new Error(`not a host-lane document: ${body}`)
  return def.compute.trees ? def.compute.trees[def.plots[0].key] : def.compute.ast
}
const LIVE_HIGH = 'request.security(syminfo.tickerid, "W", high, lookahead = barmerge.lookahead_on)'

// ⭐ THE SHAPES AND WHAT EACH SHOWS, WRITTEN BY HAND over `window` (null = blank or withheld).
const W13 = [0, 13]
const SHAPES = [
  // ⭐ THE DEFECT: the partial week's fields on its own bars, and on the next period's through a history inside
  { name: 'live(high) (bars 0-2 read the partial week: withheld)', tree: () => live(), window: W13,
    expect: [n, n, n, 7.5, 7.5, 7.5, 7.5, 12.5, 12.5, 12.5, 12.5, 12.5, 17.5] },
  { name: 'live(open)', tree: () => live(S('open')), window: W13,
    expect: [n, n, n, 3.5, 3.5, 3.5, 3.5, 7.5, 7.5, 7.5, 7.5, 7.5, 12.5] },
  { name: 'live(volume)', tree: () => live(S('volume')), window: W13,
    expect: [n, n, n, 418, 418, 418, 418, 545, 545, 545, 545, 545, 570] },
  { name: 'live(hlc3)', tree: () => live(hlc3()), window: W13,
    expect: [n, n, n, 17.5 / 3, 17.5 / 3, 17.5 / 3, 17.5 / 3, 10.5, 10.5, 10.5, 10.5, 10.5, 15.5] },
  { name: 'live(bop(1)) (a bar reader reads the bar\'s own open, high and low)', tree: () => live(call('bop', num(1))),
    window: W13, expect: [n, n, n, 7 / 9, 7 / 9, 7 / 9, 7 / 9, 9 / 11, 9 / 11, 9 / 11, 9 / 11, 9 / 11, 9 / 11] },
  { name: 'live(close + high) (close inside an expression with a partial field: withheld)',
    tree: () => live(op('+', CLOSE, HIGH)), window: W13,
    expect: [n, n, n, 14.5, 14.5, 14.5, 14.5, 24.5, 24.5, 24.5, 24.5, 24.5, 34.5] },
  { name: 'live(high)[1] (a history outside: bars 1-3 read week 0)', tree: () => off(1, live()), window: W13,
    expect: [n, n, n, n, 7.5, 7.5, 7.5, 7.5, 12.5, 12.5, 12.5, 12.5, 12.5] },
  // ⭐ PERIOD −1 (2026-11-19): bar 0 reads the bar before the chart, which it does not hold: withheld by name
  { name: 'nz(live(high)[1], 0) (bar 0 reads the bar before the chart: withheld, PERIOD −1)', tree: () => call('nz', off(1, live()), num(0)),
    window: W13, expect: [n, n, n, n, 7.5, 7.5, 7.5, 7.5, 12.5, 12.5, 12.5, 12.5, 12.5] },
  { name: 'live(high[1]) (a history inside: week 1 reads the partial week\'s high)', tree: () => live(off(1, HIGH)),
    window: W13, expect: [n, n, n, n, n, n, n, 7.5, 7.5, 7.5, 7.5, 7.5, 12.5] },
  { name: 'live(sma(high, 2)) (a window inside: week 1 reads week 0)', tree: () => live(call('sma', HIGH, num(2))),
    window: W13, expect: [n, n, n, n, n, n, n, 10, 10, 10, 10, 10, 15] },
  { name: 'live(hlc3[1]) (the served cpr script\'s weekly pivot)', tree: () => live(off(1, hlc3())), window: W13,
    expect: [n, n, n, n, n, n, n, 17.5 / 3, 17.5 / 3, 17.5 / 3, 17.5 / 3, 17.5 / 3, 10.5] },
  // ⭐⭐ ITEM 4 (2026-11-19): A RUNNING VALUE is drawn only where two starts agree (`walkTwoStarts`, `htfTwoStarts.test.js`
  // holds the acceptance measure): its partial-week start and a later one do not agree, bit for bit, before ~50 bars of its
  // own timeframe, so this window is withheld whole (it drew from week 2 on, from a seed holding the partial week)
  { name: 'live(ema(high, 3)) (a running value: withheld until its two starts agree, ITEM 4)',
    tree: () => live(call('ema', HIGH, num(3))), window: W13, held: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12] },
  { name: 'ema(live(high), 3) (a running value over the read: withheld until its two starts agree, ITEM 4)',
    tree: () => call('ema', live(), num(3)), window: W13, held: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12] },
  // the monthly read: September (bars 0-19) is partial, October is bars 20-41 (h of bar 41: 42.5)
  { name: "live(high, 'M') (September, bars 0-19, withheld)", tree: () => live(HIGH, 'M'), window: [17, 23],
    expect: [n, n, n, 42.5, 42.5, 42.5] },
  // ⭐ KEPT: a read of `close` alone is the whole period's close on the partial period too
  { name: 'KEPT live(close) (the partial week\'s close is the week\'s)', tree: () => live(CLOSE), window: W13,
    expect: [3, 3, 3, 7, 7, 7, 7, 12, 12, 12, 12, 12, 17] },
  { name: 'KEPT live(close * 2 + 1)', tree: () => live(op('+', op('*', CLOSE, num(2)), num(1))), window: W13,
    expect: [7, 7, 7, 15, 15, 15, 15, 25, 25, 25, 25, 25, 35] },
  { name: 'KEPT live(close[1])', tree: () => live(off(1, CLOSE)), window: W13,
    expect: [n, n, n, 3, 3, 3, 3, 7, 7, 7, 7, 7, 12] },
  { name: 'KEPT live(sma(close, 2))', tree: () => live(call('sma', CLOSE, num(2))), window: W13,
    expect: [n, n, n, 5, 5, 5, 5, 9.5, 9.5, 9.5, 9.5, 9.5, 14.5] },
  { name: "KEPT live(close, 'M') (September's close is bar 19's)", tree: () => live(CLOSE, 'M'), window: [17, 23],
    expect: [20, 20, 20, 42, 42, 42] },
  // another request holding a look-ahead read: the field-unaware rule (its first period's bars), as `tf_merge` keeps it.
  // ⛔ Under `nz`: the read inside `sym` runs through `interpret` on SPY's bars and withholds there too, but a value
  // withheld INSIDE a request reaches the root as Pine's `na`, which `nz` turns into a confident 0; the outer site is
  // what withholds the ROOT bar (without it bars 0-2 draw 0)
  { name: "nz(sym('SPY', live(high))) (under another request: the first period's bars, field-unaware)", symbols: true,
    tree: () => call('nz', sym('SPY', live()), num(0)), window: W13,
    expect: [n, n, n, 7.5, 7.5, 7.5, 7.5, 12.5, 12.5, 12.5, 12.5, 12.5, 17.5] },
  { name: "KEPT sym('SPY', live(close))", symbols: true, tree: () => sym('SPY', live(CLOSE)), window: W13,
    expect: [3, 3, 3, 7, 7, 7, 7, 12, 12, 12, 12, 12, 17] },
  // the Pine door's own trees (the `periodseconds` door reads the arm it takes on a daily chart)
  { name: 'the Pine door: request.security(syminfo.tickerid, "W", high, lookahead = barmerge.lookahead_on)',
    tree: () => pineTree(`plot(${LIVE_HIGH})`), window: W13,
    expect: [n, n, n, 7.5, 7.5, 7.5, 7.5, 12.5, 12.5, 12.5, 12.5, 12.5, 17.5] },
  { name: 'the Pine door: nz(w[1]) of w = request.security(…, "W", high, lookahead = barmerge.lookahead_on)',
    tree: () => pineTree(`w = ${LIVE_HIGH}\nplot(nz(w[1]))`), window: W13,
    expect: [n, n, n, n, 7.5, 7.5, 7.5, 7.5, 12.5, 12.5, 12.5, 12.5, 12.5] },
  { name: 'the Pine door (v4, the cpr shape): security(syminfo.tickerid, "W", hlc3[1], gaps_off, lookahead_on)',
    tree: () => pineTree('plot(security(syminfo.tickerid, "W", hlc3[1], barmerge.gaps_off, barmerge.lookahead_on))', 4),
    window: W13, expect: [n, n, n, n, n, n, n, 17.5 / 3, 17.5 / 3, 17.5 / 3, 17.5 / 3, 17.5 / 3, 10.5] },
  { name: 'KEPT the Pine door: request.security(syminfo.tickerid, "W", close, lookahead = barmerge.lookahead_on)',
    tree: () => pineTree('plot(request.security(syminfo.tickerid, "W", close, lookahead = barmerge.lookahead_on))'),
    window: W13, expect: [3, 3, 3, 7, 7, 7, 7, 12, 12, 12, 12, 12, 17] },
  // CONTROLS: nothing partial, nothing withheld for it
  { name: 'CONTROL live(high) on the Monday set (the first bar opens its week)', set: 'monday', tree: () => live(),
    window: [0, 12], expect: [5.5, 5.5, 5.5, 5.5, 5.5, 10.5, 10.5, 10.5, 10.5, 10.5, 15.5, 15.5] },
  { name: 'CONTROL live(high[1]) on the Monday set', set: 'monday', tree: () => live(off(1, HIGH)),
    window: [0, 12], expect: [n, n, n, n, n, 5.5, 5.5, 5.5, 5.5, 5.5, 10.5, 10.5] },
  { name: 'CONTROL live(high) from the listing (the first week is the whole week)', opts: { historyFromListing: true },
    tree: () => live(), window: W13, expect: [3.5, 3.5, 3.5, 7.5, 7.5, 7.5, 7.5, 12.5, 12.5, 12.5, 12.5, 12.5, 17.5] },
  { name: 'CONTROL live(high[1]) from the listing', opts: { historyFromListing: true }, tree: () => live(off(1, HIGH)),
    window: W13, expect: [n, n, n, 3.5, 3.5, 3.5, 3.5, 7.5, 7.5, 7.5, 7.5, 7.5, 12.5] },
]

const definitionOf = (tree, i) => {
  const id = `u_0000hlf${String(i + 1).padStart(5, '0')}`
  return { id, name: id, version: 1, plots: [{ key: 'value', style: 'line' }],
    compute: { kind: 'ast', fn: id, source: id, ast: tree }, meta: { recurrenceOrigin: 'pine' } }
}
const asNulls = (col) => Array.from(col || []).map((v) => (Number.isFinite(v) ? v : null))
// ⭐ PERIOD −1 — a Pine document's lane facts, what `computeFor` hands it (`astColumns.js::barIndexAbsoluteFor` /
// `varOriginAbsoluteFor`), so the evaluator's column below is the chart's
const chartOf = (c) => ({ ...CHART, barIndexAbsolute: true, varOriginAbsolute: true, ...(c.opts || {}),
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
    _about: 'HTF-LIVE-FIRST-PERIOD (2026-11-19). WRITTEN by '
      + 'app/src/components/chart/engine/ast/htfLiveFirstPeriod.test.js (HTF_LIVE_FIRST_PERIOD_WRITE=1), READ by it and '
      + 'by tests/test_pine_htf_live_first_period.py. `expect`: the hand-written answer over `window` (null = blank or '
      + 'withheld); `held` (a running value: its values after the withheld bars are not written): the bars of `window` '
      + 'that are blank or withheld, every other bar drawn. `served`: the chart\'s column (computeFor, `chart` + the '
      + 'case\'s `opts`; a `symbols` case: the evaluator\'s column, interpret, with SPY supplied as the same bars) on '
      + '`days[set]` (ISO keys; bar i: o = i + 0.5, '
      + 'h = i + 1.5, l = i, c = i + 1, v = 100 + i); the Python lane (ast_interpret.interpret, newest_bar_is_forming '
      + 'false) must equal it bar for bar.',
    chart: CHART,
    days: DAYS,
    cases,
  }
}

const TEXT = `${JSON.stringify(build(), null, 1)}\n`
if (process.env.HTF_LIVE_FIRST_PERIOD_WRITE === '1') fs.writeFileSync(FIXTURE, TEXT)
const COMMITTED = fs.existsSync(FIXTURE) ? fs.readFileSync(FIXTURE, 'utf8') : ''

describe('the fixture both lanes read', () => {
  it('⭐ regenerates byte for byte (HTF_LIVE_FIRST_PERIOD_WRITE=1 rewrites it)', () => {
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
  it('is not vacuous: every case, a window inside its bars, the controls and the kept reads', () => {
    expect(FIX.cases.length).toBe(SHAPES.length)
    expect(FIX.cases.filter((c) => c.name.startsWith('KEPT')).length).toBeGreaterThanOrEqual(6)
    expect(FIX.cases.filter((c) => c.name.startsWith('CONTROL')).length).toBeGreaterThanOrEqual(4)
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

describe('⭐ the defect, by name', () => {
  it('live(high) on bar 0 is withheld, never 3.5 (the partial week\'s high); from the listing it is 3.5', () => {
    expect(FIX.cases.find((x) => x.name.startsWith('live(high) (bars 0-2')).served[0]).toBe(null)
    expect(FIX.cases.find((x) => x.name.startsWith('CONTROL live(high) from the listing')).served[0]).toBe(3.5)
  })
  it('live(high[1]) on bar 3 is withheld, never 3.5 (week 1 reading the partial week); bar 7 draws 7.5', () => {
    const c = FIX.cases.find((x) => x.name.startsWith('live(high[1]) (a history inside'))
    expect(c.served[3]).toBe(null)
    expect(c.served[7]).toBe(7.5)
    expect(FIX.cases.find((x) => x.name.startsWith('CONTROL live(high[1]) from the listing')).served[3]).toBe(3.5)
  })
  it('the code is named with the run\'s own sentence, one spelling; a kept read and the controls name none', () => {
    expect(CHART_CLOCK_WITHHELD[TF_LIVE_FIRST_CODE]()).toBe(TF_LIVE_FIRST_SENTENCE)
    expect(codesOf(live()).get(TF_LIVE_FIRST_CODE)).toBe(TF_LIVE_FIRST_SENTENCE)
    expect(codesOf(off(1, live())).has(TF_LIVE_FIRST_CODE)).toBe(true)
    expect(codesOf(live(off(1, HIGH))).has(TF_LIVE_FIRST_CODE)).toBe(true)
    expect(codesOf(live(CLOSE)).has(TF_LIVE_FIRST_CODE)).toBe(false)
    expect(codesOf(live(), 'monday').has(TF_LIVE_FIRST_CODE)).toBe(false)
    expect(codesOf(live(), 'wednesday', { historyFromListing: true }).has(TF_LIVE_FIRST_CODE)).toBe(false)
  })
  it('a bar reader inside reads the bar\'s own fields: withheld on the partial week, named', () => {
    expect(FIX.cases.find((x) => x.name.startsWith('live(bop(1))')).served.slice(0, 4).map((v) => v === null))
      .toEqual([true, true, true, false])
    expect(codesOf(live(call('bop', num(1)))).has(TF_LIVE_FIRST_CODE)).toBe(true)
  })
})

describe('⛔ the run\'s request is unchanged: it reads `tfLiveFirstPeriodMask` with a leaf child, as before', () => {
  it('requestAlignment(live) withholds the first period\'s bars 0-2 and names the code with the same sentence', () => {
    const bars = barsOn(DAYS.wednesday)
    const sink = new Map()
    const { withheld } = requestAlignment({ chartBars: bars, srcBars: bars, code: 'W', live: true,
      opts: { ...CHART, chartClockSink: sink } })
    expect(Array.from(withheld.slice(0, 4))).toEqual([1, 1, 1, 0])
    expect(sink.get(TF_LIVE_FIRST_CODE)).toBe(TF_LIVE_FIRST_SENTENCE)
  })
})

describe('⭐ the served cpr script (host lane): which of its columns move, by name', () => {
  // `cpr-with-mas-super-trend-vwap-by-guruprasadmeduri`: its weekly and monthly pivots are `security(…, "W" | "M",
  // pivot[1], gaps_off, lookahead_on)` = `tf_live(hlc3[1])`; with its default inputs those PLOTS are off (`0 / 0`), and
  // the reads stand in their colour columns (`x != x[1] ? na : color`), out39-out45 (weekly) and out46-out52 (monthly).
  const source = fs.readFileSync(CPR, 'utf8')
  const pane = memberPaneDefinition({ source, id: 'u_0000hlfcpr01', name: 'cpr' })
  const def = pane.definition
  const out = registry.computeFor(def, barsOn(DAYS.wednesday), {}, CHART)
  it('is a host-lane document whose weekly and monthly colour columns read tf_live', () => {
    expect(def.compute.kind).toBe('ast')
    expect(JSON.stringify(def.compute.trees.out39)).toContain('"tf_live"')
    expect(JSON.stringify(def.compute.trees.out46)).toContain('"tf_live"')
    expect(JSON.stringify(def.compute.trees.value)).not.toContain('"tf_live"')
  })
  it('the weekly colour column is withheld on week 1 (bars 3-6, reading the partial week\'s pivot) and the bar after', () => {
    const w = asNulls(out.out39)
    expect(w.slice(3, 8)).toEqual([n, n, n, n, n])
    expect(w.slice(8, 12).every((v) => v !== null)).toBe(true)
  })
  it('the monthly colour column is withheld on October (bars 20-41, reading partial September) and the bar after', () => {
    const m = asNulls(out.out46)
    expect(m.slice(20, 43).every((v) => v === null)).toBe(true)
    expect(m.slice(43, 50).every((v) => v !== null)).toBe(true)
  })
  it('its daily pivots, moving averages, SuperTrend and daily colours read no tf_live: this mask withholds none', () => {
    for (const key of ['value', 'out2', 'out24', 'out25', 'out26', 'out27', 'out30', 'out38', 'out53']) {
      expect(JSON.stringify(def.compute.trees[key]), key).not.toContain('"tf_live"')
      expect(tfLiveMask(def.compute.trees[key], barsOn(DAYS.wednesday), CHART), key).toBe(null)
    }
    expect(tfLiveMask(def.compute.trees.out39, barsOn(DAYS.wednesday), CHART)).not.toBe(null)
  })
})
