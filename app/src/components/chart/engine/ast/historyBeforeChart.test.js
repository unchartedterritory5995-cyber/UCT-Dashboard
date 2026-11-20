// app/src/components/chart/engine/ast/historyBeforeChart.test.js
//
// ─── ⭐⭐ PERIOD −1 (coordinator ruling 2026-11-19) — A READ OF THE BAR, OR THE WEEK OR MONTH, BEFORE THE CHART'S FIRST IS
//     WITHHELD BY NAME WHERE IT WOULD DRAW, OFF THE LISTING ─────────────────────────────────────────────────────────────
//
// On a chart whose history does not begin at the symbol's listing, `x[1]` on bar 0 reads a bar this chart does not hold.
// The evaluator answers `NaN` there, which downstream is Pine's `na`; TradingView holds the bar (its history begins at the
// listing) and reads a VALUE. Where the script turns that `na` into something it draws — `nz(x[1])`, `na(x[1])`, a test
// `x != x[1]` choosing a colour — the chart drew a value TradingView cannot agree with. Measured by the truth proxy (120
// daily charts cut from three longer histories, each against its longer chart): the served cpr script's `out30`-`out38`
// (`pivot != pivot[1] ? na : color`, the daily pivot read through `[1]`) drew a colour on bars 0-1 of all 120 charts where
// the longer chart draws none; its weekly / monthly colours `out39`-`out52` did the same through the week or month
// before the first. The same holds one timeframe up: a `tf_merge` bar before the first period's close reads the period
// before the first, and `tf_live('W', x[1])` reads it on the first period.
// Now (`interpret.js::historyBeforeChartMask`, twin `ast_interpret.history_before_chart_mask`): in a Pine document, off
// the listing, those reads are unknown, and the root bars that read them (engine 56's walk, taken exactly) are withheld,
// named `history:before-chart` where a value is taken away. From the listing TradingView reads `na` there too and the
// chart keeps its picture; a formula document's `x[1]` means its own series and is untouched; another symbol's series
// (`sym`) is never the chart's listing (C26), so a read before ITS first bar is unknown even from the chart's listing.
// ⭐ FINDING 3 (the same ruling): the Python lane's `sym` arm kept the CHART's `historyFromListing` for the other symbol,
// where the chart lane clears it; the `sym(…, barindex)` cases below are the twin rail for it.
// ⛔ A running value carrying such a read (`ema(nz(close[1]), 3)`) is withheld where its argument is and not after: what
// it carries is item 4's question (two starts), not settled here.
//
// THE SHARED FIXTURE `tests/fixtures/ast/history_before_chart.json` is WRITTEN here (HISTORY_BEFORE_CHART_WRITE=1) and READ
// by `tests/test_pine_history_before_chart.py`: every case's tree, its `opts`, the hand-written expectation (`expect`
// over `window`, written below, never computed), the evaluator's column (`served`) and the codes it named; the Python
// lane must equal the column bar for bar and name the same code.
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import * as registry from '../nativeRegistry'
import { interpret, historyBeforeChartMask, HISTORY_BEFORE_CHART_CODE, HISTORY_BEFORE_CHART_SENTENCE,
  CHART_CLOCK_WITHHELD } from './interpret'
import { memberPaneDefinition } from '../../builder/memberPane/memberPaneDefinition'

const FIXTURE = path.resolve(process.cwd(), '..', 'tests', 'fixtures', 'ast', 'history_before_chart.json')
const CPR = path.resolve(process.cwd(), '..', 'corpus', 'committed',
  'cpr-with-mas-super-trend-vwap-by-guruprasadmeduri__htrxxqBqNz.pine')

const S = (name) => ({ type: 'series', name })
const CLOSE = S('close')
const HIGH = S('high')
const num = (value) => ({ type: 'num', value })
const off = (k, a) => ({ type: 'offset', value: k, args: [a] })
const call = (name, ...args) => ({ type: 'call', name, args })
const op = (name, ...args) => ({ type: 'op', name, args })
const live = (arg, code = 'W') => ({ type: 'tf_live', value: code, args: [arg] })
const merge = (arg, code = 'W') => ({ type: 'tf_merge', value: code, args: [arg] })
const sym = (ticker, arg) => ({ type: 'sym', value: ticker, args: [arg] })
const hlc3 = () => op('/', op('+', op('+', HIGH, S('low')), CLOSE), num(3))
// the Pine door's daily-request door (`periodseconds` is 86400 on a daily chart: the value arm)
const door = (x) => op('?:', op('!=', num(86400), S('periodseconds')), op('/', num(0), num(0)), x)
// the cpr colour shape: `x != x[1] ? na : color`, the colour index 1 where the pivot did not move
const moved = (x) => op('?:', op('!=', x, off(1, x)), num(0), num(1))
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
// ⭐ #2071's sets. Wednesday 2026-09-02: week 0 is bars 0-2 (Wed-Fri), week 1 bars 3-6 (Labour Day 09-07 is a holiday),
// week 2 bars 7-11. Bar i: o = i + 0.5, h = i + 1.5, l = i, c = i + 1, v = 100 + i, so `close[1]` on bar i is i, the
// weekly closes are 3, 7, 12 and hlc3 of a bar is (3i + 2.5) / 3. Monday 2026-09-14: its first week is whole.
const DAYS = {
  wednesday: weekdays('2026-09-02', '2026-11-17', ['2026-09-07']),
  monday: weekdays('2026-09-14', '2026-11-17'),
}
const barsOn = (days) => days.map((t, i) => ({ t, o: i + 0.5, h: i + 1.5, l: i, c: i + 1, v: 100 + i }))
const CHART = { tf: 'D', newestBarIsForming: false }
// a Pine document's lane facts (`astColumns.js::barIndexAbsoluteFor` / `varOriginAbsoluteFor`, what `computeFor` hands)
const PINE = { barIndexAbsolute: true, varOriginAbsolute: true }
const LISTING = { ...PINE, historyFromListing: true }

const W8 = [0, 8]
const SHAPES = [
  // ⭐ THE DEFECT, on the chart's own bars
  { name: 'nz(close[1]) (bar 0 reads the bar before the chart: withheld, never 0)', tree: () => call('nz', off(1, CLOSE), num(0)),
    window: W8, expect: [n, 1, 2, 3, 4, 5, 6, 7] },
  { name: 'na(close[1]) (bar 0: withheld, never a confident 1)', tree: () => call('na', off(1, CLOSE)),
    window: W8, expect: [n, 0, 0, 0, 0, 0, 0, 0] },
  { name: 'close > close[2] ? 1 : 0 (bars 0-1 read before the chart)', tree: () => op('?:', op('>', CLOSE, off(2, CLOSE)), num(1), num(0)),
    window: W8, expect: [n, n, 1, 1, 1, 1, 1, 1] },
  { name: 'the cpr daily colour: door(hlc3[1]) != door(hlc3[1])[1] ? 0 : 1 (bars 0-1)', tree: () => moved(door(off(1, hlc3()))),
    window: W8, expect: [n, n, 0, 0, 0, 0, 0, 0] },
  { name: 'nz(barsAgo(close, 1, 400)) (a per-bar count reaching before bar 0)',
    tree: () => call('nz', call('barsAgo', CLOSE, num(1), num(400)), num(0)), window: W8, expect: [n, 1, 2, 3, 4, 5, 6, 7] },
  // ⭐ ONE TIMEFRAME UP
  { name: 'nz(tf_merge(W, close)) (bars 0-1 read the week before the first: withheld)', tree: () => call('nz', merge(CLOSE), num(0)),
    window: W8, expect: [n, n, 3, 3, 3, 3, 7, 7] },
  { name: 'nz(tf_merge(W, close)) on the Monday set (a whole first week still reads the week before it on bars 0-3)',
    set: 'monday', tree: () => call('nz', merge(CLOSE), num(0)), window: [0, 7], expect: [n, n, n, n, 5, 5, 5] },
  { name: 'nz(tf_live(W, close[1])) (week 0 reads the week before the first: bars 0-2 withheld)',
    tree: () => call('nz', live(off(1, CLOSE)), num(0)), window: W8, expect: [n, n, n, 3, 3, 3, 3, 7] },
  { name: 'the cpr weekly colour: door(tf_live(W, hlc3[1])) moved (week 0 the week before, week 1 the partial week)',
    tree: () => moved(door(live(off(1, hlc3())))), window: [0, 12], expect: [n, n, n, n, n, n, n, n, 1, 1, 1, 1] },
  // ⛔ A RUNNING VALUE: withheld where its argument is (bar 0), not after (item 4's question); its warm-up is blank
  { name: 'ema(nz(close[1]), 3) (a running value: withheld where its argument is, blank through its warm-up)',
    tree: () => call('ema', call('nz', off(1, CLOSE), num(0)), num(3)), window: W8, held: [0, 1] },
  // ⭐ ANOTHER SYMBOL: its series is never the chart's listing (C26)
  { name: "nz(sym('SPY', close[1])) (SPY's bar 0 reads before SPY's first bar)", symbols: true,
    tree: () => call('nz', sym('SPY', off(1, CLOSE)), num(0)), window: W8, expect: [n, 1, 2, 3, 4, 5, 6, 7] },
  { name: "nz(sym('SPY', close[1])) from the chart's listing (SPY's history is not the chart's: still withheld)", symbols: true,
    opts: LISTING, tree: () => call('nz', sym('SPY', off(1, CLOSE)), num(0)), window: W8, expect: [n, 1, 2, 3, 4, 5, 6, 7] },
  // ⭐ FINDING 3 — the other symbol's `bar_index` is not counted from the chart's listing in either lane (C26)
  { name: "FINDING-3 sym('SPY', barindex) from the chart's listing (SPY's count is not known: withheld)", symbols: true,
    opts: LISTING, tree: () => sym('SPY', S('barindex')), window: W8, expect: [n, n, n, n, n, n, n, n] },
  { name: "FINDING-3 CONTROL barindex from the chart's listing (the chart's own count is TradingView's)",
    opts: LISTING, tree: () => S('barindex'), window: W8, expect: [0, 1, 2, 3, 4, 5, 6, 7] },
  // ⭐ KEPT: a read that stays `na` stays blank, and is not named; a read after the first bar is drawn
  { name: 'KEPT close[1] (blank on bar 0 as before, nothing named)', tree: () => off(1, CLOSE),
    window: W8, expect: [n, 1, 2, 3, 4, 5, 6, 7] },
  { name: 'KEPT close - close[1] (blank on bar 0 as before, nothing named)', tree: () => op('-', CLOSE, off(1, CLOSE)),
    window: W8, expect: [n, 1, 1, 1, 1, 1, 1, 1] },
  { name: 'KEPT tf_merge(W, close) (blank before the first close as before, nothing named for it)', tree: () => merge(CLOSE),
    window: W8, expect: [n, n, 3, 3, 3, 3, 7, 7] },
  { name: 'KEPT sma(close, 3) (no read before the chart: drawn from bar 2)', tree: () => call('sma', CLOSE, num(3)),
    window: W8, expect: [n, n, 2, 3, 4, 5, 6, 7] },
  // ⛔ a read on other bars is never walked into: with no other symbol supplied the caller gets the column it always
  // got (C26: `symAlignmentMask` is asked only when the caller supplies symbols), the child's history read unjudged
  { name: "KEPT nz(sym('SPY', close[1])) with no symbol supplied (the column the caller always got)",
    tree: () => call('nz', sym('SPY', off(1, CLOSE)), num(0)), window: W8, expect: [0, 0, 0, 0, 0, 0, 0, 0] },
  // CONTROLS: TradingView reads `na` there too, or the document does not mean Pine's history
  { name: 'CONTROL nz(close[1]) from the listing (TradingView reads na: 0 is its answer)', opts: LISTING,
    tree: () => call('nz', off(1, CLOSE), num(0)), window: W8, expect: [0, 1, 2, 3, 4, 5, 6, 7] },
  { name: 'CONTROL the cpr daily colour from the listing', opts: LISTING, tree: () => moved(door(off(1, hlc3()))),
    window: W8, expect: [1, 1, 0, 0, 0, 0, 0, 0] },
  { name: 'CONTROL nz(tf_merge(W, close)) from the listing', opts: LISTING, tree: () => call('nz', merge(CLOSE), num(0)),
    window: W8, expect: [0, 0, 3, 3, 3, 3, 7, 7] },
  { name: 'CONTROL nz(close[1]) when the first bar is TradingView\'s bar 0 (barIndexFromFirstBar: no barIndexAbsolute)',
    opts: { varOriginAbsolute: true }, tree: () => call('nz', off(1, CLOSE), num(0)), window: W8, expect: [0, 1, 2, 3, 4, 5, 6, 7] },
  { name: 'CONTROL nz(close[1]) in a formula document (its `x[1]` means its own series)', opts: {},
    tree: () => call('nz', off(1, CLOSE), num(0)), window: W8, expect: [0, 1, 2, 3, 4, 5, 6, 7] },
]

const optsOf = (c) => ({ ...CHART, ...(c.opts === undefined ? PINE : c.opts),
  ...(c.symbols ? { symbols: { SPY: barsOn(DAYS[c.set || 'wednesday']) } } : {}) })
const asNulls = (col) => Array.from(col || []).map((v) => (Number.isFinite(v) ? v : null))
const run = (tree, c, sink) => asNulls(interpret(tree, barsOn(DAYS[c.set || 'wednesday']), {}, undefined, undefined,
  { ...optsOf(c), ...(sink ? { chartClockSink: sink } : {}) }))

function build() {
  const cases = SHAPES.map((shape) => {
    const set = shape.set || 'wednesday'
    const tree = shape.tree()
    const sink = new Map()
    const served = run(tree, shape, sink)
    return { name: shape.name, set, opts: shape.opts === undefined ? PINE : shape.opts, symbols: !!shape.symbols, tree,
      window: shape.window, ...(shape.held ? { held: shape.held } : { expect: shape.expect }), served,
      named: sink.has(HISTORY_BEFORE_CHART_CODE) }
  })
  return {
    _about: 'PERIOD -1 (2026-11-19). WRITTEN by app/src/components/chart/engine/ast/historyBeforeChart.test.js '
      + '(HISTORY_BEFORE_CHART_WRITE=1), READ by it and by tests/test_pine_history_before_chart.py. `expect`: the '
      + 'hand-written answer over `window` (null = blank or withheld); `held` (a running value): the bars of `window` '
      + 'that are blank or withheld, every other bar drawn. `served`: the evaluator\'s column (interpret, `chart` + the '
      + 'case\'s `opts`; a `symbols` case supplies SPY as the same bars) on `days[set]` (ISO keys; bar i: o = i + 0.5, '
      + 'h = i + 1.5, l = i, c = i + 1, v = 100 + i); `named`: whether it named `history:before-chart`. The Python lane '
      + '(ast_interpret.interpret, newest_bar_is_forming false) must equal both.',
    chart: CHART,
    days: DAYS,
    cases,
  }
}

const TEXT = `${JSON.stringify(build(), null, 1)}\n`
if (process.env.HISTORY_BEFORE_CHART_WRITE === '1') fs.writeFileSync(FIXTURE, TEXT)
const COMMITTED = fs.existsSync(FIXTURE) ? fs.readFileSync(FIXTURE, 'utf8') : ''

describe('the fixture both lanes read', () => {
  it('⭐ regenerates byte for byte (HISTORY_BEFORE_CHART_WRITE=1 rewrites it)', () => {
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

describe('the column of every case is the hand-written answer', () => {
  it('is not vacuous: every case, a window inside its bars, the controls and the kept reads', () => {
    expect(FIX.cases.length).toBe(SHAPES.length)
    expect(FIX.cases.filter((c) => c.name.startsWith('KEPT')).length).toBeGreaterThanOrEqual(4)
    expect(FIX.cases.filter((c) => c.name.startsWith('CONTROL')).length).toBeGreaterThanOrEqual(5)
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
    })
  }
})

const definitionOf = (tree, i, pine = true) => {
  const id = `u_0000hbc${String(i + 1).padStart(5, '0')}`
  return { id, name: id, version: 1, plots: [{ key: 'value', style: 'line' }],
    compute: { kind: 'ast', fn: id, source: id, ast: tree }, ...(pine ? { meta: { recurrenceOrigin: 'pine' } } : {}) }
}

describe('⭐ the chart serves the same column (`computeFor` hands a Pine document these facts)', () => {
  it('every case on the chart\'s own bars: the registry\'s column is the evaluator\'s', () => {
    let compared = 0
    FIX.cases.forEach((c, i) => {
      // another symbol is the binding's to supply (`otherSymbolsFor`), not these opts': the evaluator's column above
      if (c.symbols || JSON.stringify(c.tree).includes('"sym"')) return
      const pine = c.opts.varOriginAbsolute === true
      const ctx = { ...CHART, ...(c.opts.historyFromListing ? { historyFromListing: true } : {}),
        ...(pine && c.opts.barIndexAbsolute !== true ? { barIndexFromFirstBar: true } : {}) }
      const got = asNulls(registry.computeFor(definitionOf(c.tree, i, pine), barsOn(DAYS[c.set]), {}, ctx).value)
      close(got, c.served, `${c.name} computeFor`)
      compared += 1
    })
    expect(compared).toBeGreaterThanOrEqual(15)
  })
})

describe('⭐ the defect, by name', () => {
  it('the code is named with its sentence, one spelling, where a drawn value is taken away', () => {
    expect(CHART_CLOCK_WITHHELD[HISTORY_BEFORE_CHART_CODE]()).toBe(HISTORY_BEFORE_CHART_SENTENCE)
    expect(HISTORY_BEFORE_CHART_CODE).toBe('history:before-chart')
    const named = (prefix) => FIX.cases.find((c) => c.name.startsWith(prefix)).named
    expect(named('nz(close[1]) (bar 0')).toBe(true)
    expect(named('the cpr daily colour')).toBe(true)
    expect(named('nz(tf_merge(W, close)) (bars 0-1')).toBe(true)
    expect(named("nz(sym('SPY', close[1])) from the chart's listing")).toBe(true)
    // a per-bar count was withheld unnamed by `historyReadMask` (C38); it now carries this name
    expect(named('nz(barsAgo(close, 1, 400))')).toBe(true)
  })
  it('a read that stays `na` is blank as before and names nothing; the controls name nothing', () => {
    for (const c of FIX.cases.filter((x) => x.name.startsWith('KEPT') || x.name.startsWith('CONTROL'))) {
      expect(c.named, c.name).toBe(false)
    }
  })
  it('the mask still withholds a blank bar (the object lane reads it as unknown), naming nothing without a value', () => {
    const bars = barsOn(DAYS.wednesday)
    const sink = new Map()
    const mask = historyBeforeChartMask(off(1, CLOSE), bars, {}, undefined, undefined, { ...CHART, ...PINE,
      chartClockSink: sink }, interpret(off(1, CLOSE), bars, {}, undefined, undefined, { ...CHART, ...PINE }))
    expect(Array.from(mask.slice(0, 3))).toEqual([1, 0, 0])
    expect(sink.has(HISTORY_BEFORE_CHART_CODE)).toBe(false)
    // with no column it names whenever it withholds
    historyBeforeChartMask(off(1, CLOSE), bars, {}, undefined, undefined, { ...CHART, ...PINE, chartClockSink: sink })
    expect(sink.get(HISTORY_BEFORE_CHART_CODE)).toBe(HISTORY_BEFORE_CHART_SENTENCE)
  })
})

describe('⭐ the served cpr script (host lane): its daily, weekly and monthly colour columns, bars 0-1', () => {
  // `cpr-with-mas-super-trend-vwap-by-guruprasadmeduri`: its pivot colours are `pivot != pivot[1] ? na : color`; the
  // daily pivot is `security(…, "D", hlc3[1], lookahead_on)` folded onto the chart's own bars (out30-out38), the weekly
  // and monthly ones `tf_live(hlc3[1])` (out39-out52). Off the listing, bar 0's `pivot` and bar 1's `pivot[1]` are a
  // read before the chart: the colour index 1 ("draw") was drawn there, where the longer chart draws 0.
  const source = fs.readFileSync(CPR, 'utf8')
  const def = memberPaneDefinition({ source, id: 'u_0000hbccpr01', name: 'cpr' }).definition
  const bars = barsOn(DAYS.wednesday)
  const sink = new Map()
  const out = registry.computeFor(def, bars, {}, { ...CHART, chartClockSink: sink })
  const fromListing = registry.computeFor(def, bars, {}, { ...CHART, historyFromListing: true })
  it('is a Pine host-lane document', () => {
    expect(def.compute.kind).toBe('ast')
    expect(def.meta.recurrenceOrigin).toBe('pine')
  })
  it('out30-out38 are withheld on bars 0-1 and drawn from bar 2, by name; from the listing bars 0-1 draw 1', () => {
    for (let k = 30; k <= 38; k++) {
      const col = asNulls(out[`out${k}`])
      expect(col.slice(0, 2), `out${k}`).toEqual([n, n])
      expect(col[2], `out${k}`).not.toBe(null)
      expect(asNulls(fromListing[`out${k}`]).slice(0, 2), `out${k} from the listing`).toEqual([1, 1])
    }
    expect(sink.get(HISTORY_BEFORE_CHART_CODE)).toBe(HISTORY_BEFORE_CHART_SENTENCE)
  })
  it('the weekly colours are withheld through the bar after week 1; the monthly through the bar after October', () => {
    for (let k = 39; k <= 45; k++) {
      const col = asNulls(out[`out${k}`])
      expect(col.slice(0, 8).every((v) => v === null), `out${k}`).toBe(true)
      expect(col.slice(8, 12).every((v) => v !== null), `out${k}`).toBe(true)
    }
    for (let k = 46; k <= 52; k++) {
      const col = asNulls(out[`out${k}`])
      expect(col.slice(0, 43).every((v) => v === null), `out${k}`).toBe(true)
      expect(col.slice(43, 50).every((v) => v !== null), `out${k}`).toBe(true)
    }
  })
})
