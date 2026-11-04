// app/src/components/chart/engine/runtime/__tests__/runtimeRealtimeWse.test.js
//
// ⭐ P3 WS-F x WS-E — the calc_bars_count window (`calcBarsWindow.js`) runs through
// `computeRuntimeColumns`, and its `bar_index` probe re-runs the script with
// `opts.barIndexShift`. Neither may touch the realtime session's state wrongly:
//   * a shifted build is a measurement: it never keeps a session (build, checkpoint,
//     ledger), so it can never be reused as the real run's build;
//   * a `varip` inside the window is REFUSED by name before any probe runs: the window slides
//     one bar on every new bar (re-review M2).
import { describe, it, expect, beforeEach } from 'vitest'
import {
  computeRuntimeColumns, resetRuntimeSessions, resetRuntimeLedgers, runtimeIncrementalOf, runtimeSessionStats,
  SLIDING_VARIP_WHY,
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

describe('⛔ a `varip` inside a calc_bars_count window is refused by name (the window slides)', () => {
  const CB = 'indicator("w", calc_bars_count = 20)'
  it('a plain `varip` counter', () => {
    const d = doc('varip int b = 0\nb += 1\nplot(b)\nplot(close)\n', { a: 0, b: 1 }, CB)
    let err = null
    try { computeRuntimeColumns(d, mk(50), LIVE) } catch (e) { err = e }
    expect(err && err.guard).toBe('runtime:varip')
    expect(String(err.message)).toContain(SLIDING_VARIP_WHY)
  })
  it('one that also reads bar_index: still `runtime:varip`, before the bar_index probe runs', () => {
    const d = doc('varip int b = 0\nb += bar_index > 1000000 ? 1 : 1\nplot(b + bar_index)\nplot(close)\n', { a: 0, b: 1 }, CB)
    let err = null
    try { computeRuntimeColumns(d, mk(50), LIVE) } catch (e) { err = e }
    expect(err && err.guard).toBe('runtime:varip')
  })
  it('a chart that grows past the window: the build made before it (with a ledger) is never reused by the window', () => {
    const d = doc('varip int b = 0\nb += 1\nplot(b)\nplot(close)\n', { a: 0, b: 1 }, CB)
    expect(computeRuntimeColumns(d, mk(20), LIVE).a[19], '20 bars: no window, a plain chart').toBe(20)
    let err = null
    try { computeRuntimeColumns(d, mk(50), LIVE) } catch (e) { err = e }
    expect(err && err.guard, '50 bars: the window slides').toBe('runtime:varip')
  })
  it('CONTROL — the same counter with `var` runs in the window', () => {
    const d = doc('var int b = 0\nb += 1\nplot(b)\nplot(close)\n', { a: 0, b: 1 }, CB)
    const out = computeRuntimeColumns(d, mk(50), LIVE)
    expect(Number.isNaN(out.a[0])).toBe(true)
    expect(out.a[49]).toBe(20)
  })
})
