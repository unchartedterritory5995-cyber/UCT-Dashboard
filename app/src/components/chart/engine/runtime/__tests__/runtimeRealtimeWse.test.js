// app/src/components/chart/engine/runtime/__tests__/runtimeRealtimeWse.test.js
//
// ⭐ P3 WS-F x WS-E — the calc_bars_count window (`calcBarsWindow.js`) runs through
// `computeRuntimeColumns`, and its `bar_index` probe re-runs the script with
// `opts.barIndexShift`. Neither may touch the realtime session's state wrongly:
//   * a shifted build is a measurement: it never keeps a session (build, checkpoint,
//     ledger), so it can never be reused as the real run's build;
//   * a `varip` inside the window counts the window's updates once each, like anywhere.
import { describe, it, expect, beforeEach } from 'vitest'
import {
  computeRuntimeColumns, resetRuntimeSessions, resetRuntimeLedgers, runtimeIncrementalOf, runtimeSessionStats,
} from '../runtimeColumns.js'

const doc = (body, outputs = { a: 0, b: 1 }, head = 'indicator("w")') => ({
  id: 'rt-wse', meta: { runtimeHistory: 'listing' },
  compute: { kind: 'runtime', fn: 'runtime:rt-wse', outputs, source: `//@version=5\n${head}\n${body}` },
})
const mk = (n) => Array.from({ length: n }, (_, i) => {
  const c = 100 + 3 * Math.sin(i / 4) + i * 0.05
  return { t: 1700000000 + i * 86400, o: c - 0.3, h: c + 1, l: c - 1, c, v: 1000 + i }
})
const LIVE = { tf: 'D', newestBarIsForming: true, historyFromListing: true }
const tick = (rows, dc) => {
  const last = rows[rows.length - 1]
  const c = last.c + dc
  return [...rows.slice(0, -1), { ...last, c, h: Math.max(last.h, c), l: Math.min(last.l, c), v: last.v + 7 }]
}

beforeEach(() => { resetRuntimeSessions(); resetRuntimeLedgers() })

describe('⛔ a bar_index-shifted build is never kept as the real run\'s build', () => {
  it('a shifted run with sessions on keeps nothing; the next real run is a cold build and exact', () => {
    const d = doc('plot(bar_index * 1.0 + close)\nplot(close)\n')
    const rows = mk(40)
    const shifted = computeRuntimeColumns(d, rows, LIVE, { barIndexShift: 1 })
    expect(shifted.a[10]).toBe(11 + rows[10].c)
    expect(runtimeSessionStats().sessions, 'the shifted run kept no session').toBe(0)
    const real = computeRuntimeColumns(d, rows, LIVE)
    expect(runtimeIncrementalOf(real).rebuilt).toBe(true)
    expect(real.a[10]).toBe(10 + rows[10].c)
    expect(real.a).toEqual(computeRuntimeColumns(d, rows, LIVE, { incremental: false }).a)
  })
})

describe('⭐ a `varip` inside a calc_bars_count window', () => {
  const CB = 'indicator("w", calc_bars_count = 20)'
  it('counts the window\'s bars once each, and each real update of the forming bar once', () => {
    const d = doc('varip int b = 0\nb += 1\nplot(b)\nplot(close)\n', { a: 0, b: 1 }, CB)
    let rows = mk(50)
    const first = computeRuntimeColumns(d, rows, LIVE)
    expect(first.a.length).toBe(50)
    expect(Number.isNaN(first.a[0]), 'outside the window: nothing').toBe(true)
    expect(first.a[49]).toBe(20)
    expect(computeRuntimeColumns(d, rows.map((b) => ({ ...b })), LIVE).a[49], 'the same update again').toBe(20)
    rows = tick(rows, 0.2)
    expect(computeRuntimeColumns(d, rows, LIVE).a[49], 'one real update').toBe(21)
  })
  it('a `varip` script that reads bar_index in the window is refused by name, never served a guess', () => {
    const d = doc('varip int b = 0\nb += bar_index > 1000000 ? 1 : 1\nplot(b + bar_index)\nplot(close)\n', { a: 0, b: 1 }, CB)
    let err = null
    try { computeRuntimeColumns(d, mk(50), LIVE) } catch (e) { err = e }
    expect(err && err.guard).toBe('runtime:calc-bars-bar-index')
  })
})
