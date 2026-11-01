// app/src/components/chart/engine/runtime/__tests__/runtimeBuildCache.test.js
//
// ⭐⭐ P3 WS-F (B5) — A SESSION KEEPS ITS BUILD, AND A TICK RE-EVALUATES ONLY THE COLUMNS
// IT CAN MOVE — WITHOUT CHANGING ONE NUMBER.
//
// `runtimeColumns.js` records each precomputed column's folded tree at a session's cold
// build and, on its later runs, re-evaluates those trees instead of rebuilding the script;
// on a tick (same bar times) a column that reads no price (`tickInvariant`) is the
// previous run's column. Each step of a chart's life is compared, bit for bit, with a
// clean cold run of the same bars (`incremental: false`: no session, a full build).
import { describe, it, expect, beforeEach } from 'vitest'
import {
  computeRuntimeColumns, resetRuntimeSessions, resetRuntimeLedgers, runtimeIncrementalOf, tickInvariant,
} from '../runtimeColumns.js'

const doc = (body, outputs = { a: 0, b: 1, c: 2 }) => ({
  id: 'bc', meta: { runtimeHistory: 'listing' },
  compute: { kind: 'runtime', fn: 'runtime:bc', outputs, source: `//@version=5\nindicator("bc")\n${body}` },
})
let seed = 3
const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647 }
const mk = (n) => {
  seed = 3
  let p = 50
  return Array.from({ length: n }, (_, i) => {
    const c = p + (rnd() - 0.5)
    const b = { t: 1700000000 + i * 300, o: p, h: Math.max(p, c) + rnd(), l: Math.min(p, c) - rnd(), c, v: 100 + i }
    p = c
    return b
  })
}
const LIVE = { tf: '5', newestBarIsForming: true, historyFromListing: true }
const same = (x, y, at) => {
  expect(Object.keys(x), at).toEqual(Object.keys(y))
  for (const k of Object.keys(y)) {
    expect(x[k].length, at).toBe(y[k].length)
    for (let i = 0; i < y[k].length; i += 1) if (!Object.is(x[k][i], y[k][i])) expect.fail(`${at}: ${k}[${i}] ${x[k][i]} vs ${y[k][i]}`)
  }
}

beforeEach(() => { resetRuntimeSessions(); resetRuntimeLedgers() })

// clock columns (bar_index, time, the barstate tri-state, constants) beside price columns
// (an ema, a highest, a raw close) and a var recurrence the VM carries
const MIXED = doc(
  'var float s = 0.0\ns := 0.9 * s + 0.1 * ta.ema(close, 9)\n'
  + 'k = bar_index % 7 == 0 ? 1.0 : 0.0\n'
  + 'plot(s + k)\nplot(ta.highest(high, 12) - (barstate.isconfirmed ? 0 : 1) + time % 11)\nplot(close * 2 + bar_index)\n')

describe('⭐⭐ the session-kept build draws exactly what a cold build draws', () => {
  it('ticks, a new bar, more ticks: every step bit for bit, with the build reused and clock columns carried', () => {
    let rows = mk(400)
    const step = (label, expectReuse) => {
      const inc = computeRuntimeColumns(MIXED, rows, LIVE)
      same(inc, computeRuntimeColumns(MIXED, rows, LIVE, { incremental: false }), label)
      const info = runtimeIncrementalOf(inc)
      if (expectReuse) {
        expect(info.rebuilt, `${label}: the front end did not run`).toBe(false)
        expect(info.columnsReused, `${label}: the price-free columns were carried`).toBeGreaterThan(0)
      }
      return info
    }
    expect(step('cold').rebuilt).toBe(true)
    for (let t = 0; t < 3; t += 1) {
      const last = rows[rows.length - 1]
      const c = last.c + 0.3 * (t + 1)
      rows = [...rows.slice(0, -1), { ...last, c, h: Math.max(last.h, c), l: Math.min(last.l, c) }]
      step(`tick ${t}`, true)
    }
    rows = [...rows, { ...mk(401)[400], o: rows[rows.length - 1].c }]
    const opened = step('a new bar', false)
    expect(opened.rebuilt, 'a new bar re-evaluates the kept build too').toBe(false)
    expect(opened.columnsReused, 'the times moved: nothing carried').toBe(0)
    const last = rows[rows.length - 1]
    rows = [...rows.slice(0, -1), { ...last, c: last.c - 0.2, l: Math.min(last.l, last.c - 0.2) }]
    step('a tick after the new bar', true)
  })

  it('an old bar corrected (same times, an old price moved): carried clock columns, re-evaluated price columns, still exact', () => {
    let rows = mk(300)
    computeRuntimeColumns(MIXED, rows, LIVE)
    rows = rows.map((b, i) => (i === 40 ? { ...b, c: b.c + 2, h: b.h + 2 } : b))
    const inc = computeRuntimeColumns(MIXED, rows, LIVE)
    same(inc, computeRuntimeColumns(MIXED, rows, LIVE, { incremental: false }), 'corrected')
    expect(runtimeIncrementalOf(inc).resumedFrom).toBeNull()
    expect(runtimeIncrementalOf(inc).rebuilt).toBe(false)
  })

  it('a different timeframe or source is a different session: a cold build', () => {
    const rows = mk(200)
    computeRuntimeColumns(MIXED, rows, LIVE)
    expect(runtimeIncrementalOf(computeRuntimeColumns(MIXED, rows, { ...LIVE, tf: '15' })).rebuilt).toBe(true)
    const edited = { ...MIXED, compute: { ...MIXED.compute, source: MIXED.compute.source.replace('0.9', '0.8') } }
    expect(runtimeIncrementalOf(computeRuntimeColumns(edited, rows, LIVE)).rebuilt).toBe(true)
  })
})

describe('⛔ tickInvariant — an allowlist: only a tree that reads no price is carried', () => {
  const s = (name) => ({ type: 'series', name })
  const num = (value) => ({ type: 'num', value })
  it('constants, the clock and operators over them: carried', () => {
    expect(tickInvariant(num(5))).toBe(true)
    expect(tickInvariant(s('barindex'))).toBe(true)
    expect(tickInvariant({ type: 'op', name: '+', args: [s('barindex'), num(1)] })).toBe(true)
    expect(tickInvariant({ type: 'offset', value: 1, args: [s('islast')] })).toBe(true)
  })
  it('any price, a bar reader, an unknown call or node type: re-evaluated', () => {
    expect(tickInvariant(s('close'))).toBe(false)
    expect(tickInvariant({ type: 'op', name: '+', args: [s('barindex'), s('volume')] })).toBe(false)
    expect(tickInvariant({ type: 'call', name: 'vwap', args: [] })).toBe(false)
    expect(tickInvariant({ type: 'call', name: 'notATableFunction', args: [num(1)] })).toBe(false)
    expect(tickInvariant({ type: 'sym', value: 'SPY', args: [s('barindex')] })).toBe(false)
    expect(tickInvariant(null)).toBe(false)
  })
})
