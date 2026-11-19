// ⭐⭐ PARITY UNIT LF (2026-11-18, coordinator ruling) — the run's store withholds the LINEFILL family by name
// once its line collector deletes a line a fill spans (`objectStore.js::collect`). A linefill dies with either
// of its lines, so past that point the run holds fewer fills than TradingView shows (fvg-detector-tradingfinder,
// AMEX:SPY 1D 2026-11-18: 289 held, 250 here), and which fills TradingView keeps is not measured.
import { describe, it, expect } from 'vitest'
import { runtimeColumnsFor } from '../runtimeColumns'
import { RUNTIME_OBJECTS_KEY } from '../runtimeObjects'
import { LINEFILL_COUNT_AT_CAP_REASON } from '../objectStore'

const BARS = Array.from({ length: 60 }, (_, i) => {
  const c = 100 + 5 * Math.sin(i / 7) + i * 0.1
  return { t: 1704153600 + i * 86400, o: c - 0.4, h: c + 1, l: c - 1, c, v: 1e6 }
})
const CTX = Object.freeze({ tf: 'D', symbol: { ticker: 'SPY', exchange: 'AMEX' }, newestBarIsForming: false, historyFromListing: true })
const script = (cap, fill = true) => ['//@version=5', `indicator("lf cap", overlay = true, max_lines_count = ${cap})`,
  'l1 = line.new(bar_index, high, bar_index + 1, high)', 'l2 = line.new(bar_index, low, bar_index + 1, low)',
  ...(fill ? ['linefill.new(l1, l2, color.new(color.blue, 80))'] : []), 'plot(close)'].join('\n')
const payloadOf = (source) => {
  const def = { id: 'u_lfcap', compute: { kind: 'runtime', fn: 'runtime:u_lfcap', rev: 1, source, outputs: { v: 0 }, objects: true },
    meta: { runtimeHistory: 'listing' } }
  return runtimeColumnsFor(def, BARS, {}, CTX)[RUNTIME_OBJECTS_KEY]
}

describe('the linefill family past the line collector', () => {
  it('CONTROL: under the line cap every fill is kept and nothing is withheld', () => {
    const p = payloadOf(script(500))
    expect(p.status).toBe('ok')
    expect(p.withheld || {}).toEqual({})
    expect(p.live.filter((o) => o.family === 'linefill')).toHaveLength(60)
  })

  it('⛔ once the collector deletes a filled line, the linefill family is withheld by name', () => {
    const p = payloadOf(script(10))
    expect(Object.keys(p.withheld || {})).toContain('linefill')
    expect(JSON.stringify(p)).toContain(LINEFILL_COUNT_AT_CAP_REASON.slice(0, 40))
    expect(p.live.filter((o) => o.family === 'line').length, 'the lines themselves are kept by the collector').toBeGreaterThan(0)
  })

  it('CONTROL: the same line collector with no fill withholds nothing', () => {
    const p = payloadOf(script(10, false))
    expect(p.withheld || {}).toEqual({})
  })
})
