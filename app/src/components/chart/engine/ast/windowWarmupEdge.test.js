// app/src/components/chart/engine/ast/windowWarmupEdge.test.js
//
// ─── ⭐⭐ RULING 1 (coordinator, 2026-11-20) — EVERY WINDOW IN THE TABLE, MEASURED AT THE LEFT EDGE ──────────────────────
//
// Off the listing, a call whose window reaches before the chart's first bar answers from bars the chart does not hold:
// the evaluator answers `na` through its warm-up, where a longer chart answers a number, and a script that turns the `na`
// into something drawn (`nz`, a comparison, a colour) drew a value TradingView cannot agree with. The walk
// (`interpret.js::windowEdgeLookback` inside `witnessMask`'s `walk.beforeFirst`, twin `ast_interpret._window_edge_lookback`)
// holds such a bar unknown, and the root bar drawn from it is withheld by name (`history:before-chart`).
//
// This rail is the measurement, not a hand list. For EVERY function of the closed table whose window can reach before the
// first bar, a canonical call is evaluated on charts cut from a longer history, wrapped in `nz(…, SENTINEL)` so a blank
// bar would be drawn, and each bar of the cut chart is compared with the same bar of the longer chart:
//   - WARM: the cut chart answers `na`, the longer chart a number. It must be withheld.
//   - EDGE NUMBER: both answer a number and they differ, the call's differences all within its reach (`rising`,
//     `falling`, `mfiPine`: `WINDOW_EDGE_FINITE`). It must be withheld.
//   - SEED: a smoother whose differences run past its reach (`ema`, `rsi`, `atr`, …: its state after the warm-up). That
//     is FINDING 2, ruled no action: those bars are NOT asserted, its WARM bars are.
//   - no bar past the call's reach (its declared lookback) is withheld unless it is one of the above: inside the reach a
//     bar the longer chart happens to agree with is still unknown (a pivot the cut chart cannot see is `na` on both when
//     the longer chart has none there either).
// A function added to the table with a window is measured here by name the day it lands.
//
// THE SHARED FIXTURE `tests/fixtures/ast/window_warmup_edge.json` is WRITTEN here (WINDOW_WARMUP_EDGE_WRITE=1) and READ by
// `tests/test_pine_window_warmup_edge.py`: one cut chart's bars and, per function, its tree and the column this lane
// serves; the Python lane must serve the same column and name the same code.
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { interpret, windowEdgeLookback, WINDOW_EDGE_FINITE, HISTORY_BEFORE_CHART_CODE } from './interpret'

const FIXTURE = path.resolve(process.cwd(), '..', 'tests', 'fixtures', 'ast', 'window_warmup_edge.json')
const TABLE = JSON.parse(fs.readFileSync(path.resolve(process.cwd(), 'src/components/chart/engine/ast/closedTable.json'), 'utf8'))

const S = (name) => ({ type: 'series', name })
const num = (value) => ({ type: 'num', value })
const off = (k, a) => ({ type: 'offset', value: k, args: [a] })
const call = (name, ...args) => ({ type: 'call', name, args })
const op = (name, ...args) => ({ type: 'op', name, args })
const SENTINEL = -12345.25
const CHART = { tf: 'D', newestBarIsForming: false }
const PINE = { barIndexAbsolute: true, varOriginAbsolute: true }

function weekdays(start, count) {
  const out = []
  for (let d = new Date(`${start}T00:00:00Z`); out.length < count; d.setUTCDate(d.getUTCDate() + 1)) {
    if (d.getUTCDay() !== 0 && d.getUTCDay() !== 6) out.push(d.toISOString().slice(0, 10))
  }
  return out
}
/** The truth proxy's seeded random walk, 4 decimals. */
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
const LONGS = [walk(weekdays('2022-01-03', 360), 7), walk(weekdays('2021-06-01', 360), 11)]
const CUTS = [100, 103, 106, 109, 112, 115, 118, 121]

// the canonical call: each argument by its role in the table, a condition that is true about half the time and reads
// no window of its own (the call's own edge is what is measured)
const COND = op('>', S('close'), S('open'))
const BY_ROLE = { high: S('high'), low: S('low'), close: S('close'), volume: S('volume'), source: S('close'),
  left: S('close'), right: S('open'), condition: COND }
const INT_ROLE = { period: 5, fastPeriod: 3, slowPeriod: 6, mult: 2, percentage: 30, leftPeriod: 3, rightPeriod: 2,
  tenkanPeriod: 3, kijunPeriod: 5, senkouBPeriod: 7, windowPeriod: 6, warmupPeriod: 6, stateIndex: 0, offset: 2,
  occurrence: 1, weightCentre: 0.85, weightSpread: 6 }
// (a multi-state's `stateIndex` counts from 1: the first state is the output)
const half = (bind) => op('+', op('*', S(bind), num(0.5)), op('*', S('close'), num(0.5)))
const SPECIAL = {
  accum: () => call('accum', S('close'), half('self'), num(6)),
  accum2: () => call('accum2', num(1), num(6), S('close'), S('open'), half('state1'), half('state2')),
  accum3: () => call('accum3', num(1), num(6), S('close'), S('open'), S('high'), half('state1'), half('state2'), half('state3')),
  accum4: () => call('accum4', num(1), num(6), S('close'), S('open'), S('high'), S('low'), half('state1'), half('state2'),
    half('state3'), half('state4')),
  alma: () => call('alma', S('close'), num(5), num(0.85), num(6)),
  // a 2-step run: a random walk rises 5 bars in a row too seldom for the measurement to see its edge
  rising: () => call('rising', S('close'), num(2)),
  falling: () => call('falling', S('close'), num(2)),
  barssince: () => call('barssince', COND, num(8)),
  valuewhen: () => call('valuewhen', COND, S('close'), num(8)),
  valuewhenOccurrence: () => call('valuewhenOccurrence', COND, S('close'), num(1)),
}
function canonical(name, spec) {
  if (SPECIAL[name]) return SPECIAL[name]()
  const roles = spec.argRoles || []
  return call(name, ...(spec.args || []).map((kind, i) => (kind === 'series'
    ? (BY_ROLE[roles[i]] || S('close')) : num(INT_ROLE[roles[i]] ?? 5))))
}

const asNulls = (col) => Array.from(col || []).map((v) => (Number.isFinite(v) ? v : null))
const differ = (a, b) => Math.abs(a - b) > 1e-9 * Math.max(1, Math.abs(a))

/** Every function whose canonical call has a window that can reach before the first bar. */
const NAMES = Object.keys(TABLE.functions).filter((name) => windowEdgeLookback(canonical(name, TABLE.functions[name])) > 0)

function measure(name) {
  const tree = canonical(name, TABLE.functions[name])
  const drawn = call('nz', tree, num(SENTINEL))
  const r = { name, warm: 0, edgeNumber: 0, seed: false, withheld: 0, missed: [], taken: [] }
  for (const long of LONGS) {
    const full = asNulls(interpret(tree, long, {}, undefined, undefined, CHART))
    for (const k of CUTS) {
      const cutBars = long.slice(k)
      const raw = asNulls(interpret(tree, cutBars, {}, undefined, undefined, CHART))
      const served = asNulls(interpret(drawn, cutBars, {}, undefined, undefined, { ...CHART, ...PINE }))
      // where the call's differences end: past its reach they are a smoother's seed (FINDING 2)
      let lastDiff = -1
      for (let j = 0; j < raw.length - 1; j++) {
        const a = full[k + j]
        const b = raw[j]
        if (a !== null && b !== null && differ(a, b)) lastDiff = j
      }
      const reach = windowEdgeLookback(tree)
      const seed = lastDiff >= Math.min(reach, 60) + 25
      if (seed) r.seed = true
      for (let j = 0; j < raw.length - 1; j++) {
        const a = full[k + j]
        const b = raw[j]
        const held = served[j] === null
        if (held) r.withheld += 1
        const warm = b === null && a !== null
        const edgeNumber = !seed && a !== null && b !== null && differ(a, b)
        if (warm) r.warm += 1
        if (edgeNumber) r.edgeNumber += 1
        if ((warm || edgeNumber) && !held) r.missed.push(`k${k} bar ${j}: cut ${b} longer ${a}`)
        if (held && j >= reach && !warm && !edgeNumber && !(seed && a !== null && b !== null && differ(a, b))) {
          r.taken.push(`k${k} bar ${j}: cut ${b} longer ${a}`)
        }
      }
    }
  }
  return r
}

const RESULTS = NAMES.map(measure)

describe('⭐⭐ RULING 1 — every window in the table, measured at the left edge of a cut chart', () => {
  it('is not vacuous: every finite-window function of the table is measured', () => {
    expect(NAMES.length).toBeGreaterThanOrEqual(55)
    for (const name of ['sma', 'ema', 'rsi', 'highest', 'pivothigh', 'rising', 'falling', 'mfiPine', 'barssince',
      'valuewhen', 'valuewhenOccurrence', 'change', 'crossOver', 'accum', 'accum2', 'stoch', 'macd']) {
      expect(NAMES, name).toContain(name)
    }
    // the ones with no such window: a pointwise call, a history read, an unbounded total, an anchored one, a session
    for (const name of ['abs', 'nz', 'barsAgo', 'cum', 'cumFrom', 'vwap', 'sessionHigh']) {
      if (TABLE.functions[name]) expect(NAMES, name).not.toContain(name)
    }
  })
  for (const r of RESULTS) {
    it(`${r.name}: every bar that answers before the chart is withheld, and nothing past its reach`, () => {
      expect(r.warm + r.edgeNumber, `${r.name} has a measured left edge`).toBeGreaterThan(0)
      expect(r.missed, `${r.name} drew a bar the longer chart does not`).toEqual([])
      expect(r.taken, `${r.name} withheld a bar the longer chart agrees with`).toEqual([])
    })
  }
  it('the finite-edge list is exactly the calls measured answering a number before the chart', () => {
    const measured = RESULTS.filter((r) => r.edgeNumber > 0).map((r) => r.name).sort()
    expect(measured).toEqual([...WINDOW_EDGE_FINITE].sort())
  })
  it('the smoothers keep their seed (FINDING 2): measured, not withheld past the warm-up', () => {
    const seeds = RESULTS.filter((r) => r.seed).map((r) => r.name)
    for (const name of ['ema', 'rma', 'rsi', 'atr', 'macd']) expect(seeds, name).toContain(name)
  })
})

// ── the fixture both lanes read: one cut chart, every function's served column ────────────────────────────────────────
function build() {
  const bars = LONGS[0].slice(CUTS[0], CUTS[0] + 90)
  const cases = NAMES.map((name) => {
    const tree = call('nz', canonical(name, TABLE.functions[name]), num(SENTINEL))
    const sink = new Map()
    const served = asNulls(interpret(tree, bars, {}, undefined, undefined, { ...CHART, ...PINE, chartClockSink: sink }))
    const listing = asNulls(interpret(tree, bars, {}, undefined, undefined, { ...CHART, ...PINE, historyFromListing: true }))
    return { name, tree, served, named: sink.has(HISTORY_BEFORE_CHART_CODE), listing }
  })
  return {
    _about: 'RULING 1 (2026-11-20). WRITTEN by app/src/components/chart/engine/ast/windowWarmupEdge.test.js '
      + '(WINDOW_WARMUP_EDGE_WRITE=1), READ by it and by tests/test_pine_window_warmup_edge.py. `bars`: a chart cut from '
      + 'a longer history (off the listing). Per function: `tree` (its canonical call in `nz(…, sentinel)`), `served` '
      + '(this lane\'s column, chart + a Pine document off the listing: barIndexAbsolute, varOriginAbsolute), `named` '
      + '(whether it named `history:before-chart`) and `listing` (the same from the listing: nothing withheld for a '
      + 'window). The Python lane (ast_interpret.interpret, newest_bar_is_forming false) must equal `served` and `named`, '
      + 'and withhold nothing from the listing either.',
    chart: CHART,
    pine: PINE,
    sentinel: SENTINEL,
    bars,
    cases,
  }
}

const TEXT = `${JSON.stringify(build(), null, 1)}\n`
if (process.env.WINDOW_WARMUP_EDGE_WRITE === '1') fs.writeFileSync(FIXTURE, TEXT)
const COMMITTED = fs.existsSync(FIXTURE) ? fs.readFileSync(FIXTURE, 'utf8') : ''

describe('the fixture both lanes read', () => {
  it('⭐ regenerates byte for byte (WINDOW_WARMUP_EDGE_WRITE=1 rewrites it)', () => {
    expect(COMMITTED).toBe(TEXT)
  })
  it('every function withholds its warm-up by name off the listing and nothing from the listing', () => {
    const fix = JSON.parse(COMMITTED || '{"cases": []}')
    expect(fix.cases.length).toBe(NAMES.length)
    for (const c of fix.cases) {
      expect(c.named, c.name).toBe(true)
      expect(c.served[0], c.name).toBe(null)
      expect(c.listing.every((v) => v !== null), `${c.name} from the listing`).toBe(true)
    }
  })
})
