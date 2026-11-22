// app/src/components/chart/engine/runtime/__tests__/runtimeRealtimeWse.test.js
//
// ⭐ P3 WS-F x WS-E — the calc_bars_count window (`engine/calcBarsWindow.js`) runs through
// `computeRuntimeColumns`. It may not touch the realtime session's state wrongly:
//   * a `varip` inside the window is REFUSED by name: the window slides one bar on every new
//     bar (re-review M2);
//   * ⭐⭐ CBC-FMT (realtime ruling) — the newest bar of a windowed run is withheld by name
//     while it may be forming: TradingView fixes its window at load and appends new bars,
//     which no capture has measured. (The `bar_index` probe's shifted build is gone with the
//     probe: the window's `bar_index` base is witnessed.)
import { describe, it, expect, beforeEach } from 'vitest'
import {
  computeRuntimeColumns, resetRuntimeSessions, resetRuntimeLedgers,
  SLIDING_VARIP_WHY,
} from '../runtimeColumns.js'
import { calcBarsWindowReport, CALC_BARS_FORMING_GUARD } from '../../calcBarsWindow.js'

const doc = (body, outputs = { a: 0, b: 1 }, head = 'indicator("w")') => ({
  id: 'rt-wse', meta: { runtimeHistory: 'listing', ...(/calc_bars_count = (\d+)/.test(head) ? { calcBarsCount: Number(/calc_bars_count = (\d+)/.exec(head)[1]) } : {}) },
  compute: { kind: 'runtime', fn: 'runtime:rt-wse', outputs, source: `//@version=5\n${head}\n${body}` },
})
const mk = (n) => Array.from({ length: n }, (_, i) => {
  const c = 100 + 3 * Math.sin(i / 4) + i * 0.05
  return { t: 1700000000 + i * 86400, o: c - 0.3, h: c + 1, l: c - 1, c, v: 1000 + i }
})
const LIVE = { tf: 'D', newestBarIsForming: true, historyFromListing: true }

beforeEach(() => { resetRuntimeSessions(); resetRuntimeLedgers() })

describe('⛔ a `varip` inside a calc_bars_count window is refused by name (the window slides)', () => {
  const CB = 'indicator("w", calc_bars_count = 20)'
  it('a plain `varip` counter', () => {
    const d = doc('varip int b = 0\nb += 1\nplot(b)\nplot(close)\n', { a: 0, b: 1 }, CB)
    let err = null
    try { computeRuntimeColumns(d, mk(50), LIVE) } catch (e) { err = e }
    expect(err && err.guard).toBe('runtime:varip')
    expect(String(err.message)).toContain(SLIDING_VARIP_WHY)
  })
  it('one that also reads bar_index: still `runtime:varip`', () => {
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
    expect(out.a[48]).toBe(19)
    // ⭐⭐ CBC-FMT — LIVE says the newest bar is forming: withheld by name
    expect(Number.isNaN(out.a[49]), 'the forming bar').toBe(true)
    expect(calcBarsWindowReport(out).rows.map((r) => r.code)).toContain(CALC_BARS_FORMING_GUARD)
    // a CLOSED newest bar is drawn
    expect(computeRuntimeColumns(d, mk(50), { ...LIVE, newestBarIsForming: false }).a[49]).toBe(20)
  })
})
