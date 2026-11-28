// app/src/components/chart/engine/intradayHtfRuntime.test.js
//
// ─── ⭐⭐ E101 INTRADAY-HTF (NUMBER PENDING) — THE RUNTIME LANE'S `request.security(…, "60", x)` ON A 15 MINUTE CHART ────
//
// CLOSED (as committed, `intradayHtfWitness.json`): the door declines it, as it always did, and the run refuses by name.
// OPENED for a measurement (`setIntradayHtfAdmissionForMeasurement`, the vendor harness's door): the run draws each 15
// minute bar the 60 minute bucket TradingView merges, by the host's own alignment (`requestAlignment`), with the values
// written out by hand below. A 45 -> 60 read, another symbol, and a daily chart stay refused.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { computeRuntimeColumns, resetRuntimeSessions, resetRuntimeLedgers } from './runtime/runtimeColumns'
import { __permitRuntimePaneForTests } from './runtimePaneGate'
import { __allowEveryRuntimeScriptForTests, setRuntimeKillList } from './runtimeKill'
import { clearSecondaryBars } from './secondaryBars'
import { setOffListingCurtainEnabled } from './runtime/runtimeColumns.js'
import {
  intradayHtfAdmitted, intradayHtfAdmissionReasons, setIntradayHtfAdmissionForMeasurement, INTRADAY_HTF_WITNESS,
  INTRADAY_HTF_CAPABILITY,
} from './intradayHtfGate'

vi.setConfig({ testTimeout: 120000 })

const ET = (day, hh, mm) => {
  const [y, m, d] = day.split('-').map(Number)
  return Date.UTC(y, m - 1, d, hh + 5, mm) / 1000   // EST (UTC-5) in January
}
const QUARTER = 900
// two regular sessions of 15 minute bars, 09:30-15:45 New York (26 a day); closes 1..52 in order
const day = (d) => Array.from({ length: 26 }, (_, k) => ET(d, 9, 30) + k * QUARTER)
const ROWS = [...day('2026-01-12'), ...day('2026-01-13')].map((t, i) => ({ t, o: i + 1, h: i + 1.5, l: i + 0.5, c: i + 1, v: 1 }))
const SYMBOL = { ticker: 'SPY', exchange: 'AMEX', securityType: 'fund' }
const ctxOf = (tf = '15') => ({ tf, newestBarIsForming: false, historyFromListing: true, symbol: SYMBOL, secondary: new Map(), exchangeOf: () => null })
const pine = (lines) => ['//@version=5', 'indicator("ihtf", overlay = false)', ...lines].join('\n')
const runDef = (source) => ({
  id: 'u_ihtf', compute: { kind: 'runtime', fn: 'runtime:u_ihtf', rev: 1, source, objects: true, outputs: { x: 0 } },
  inputs: [], meta: { runtimeHistory: 'listing' },
})
const run = (lines, ctx = ctxOf(), rows = ROWS) => computeRuntimeColumns(runDef(pine(lines)), rows, ctx, { now: () => 0 })
const MERGE = ['plot(request.security(syminfo.tickerid, "60", close))']

beforeEach(() => {
  vi.stubEnv('VITE_PINE_OBJECTS_ONLY_PANE_ENABLED', '1')
  vi.stubEnv('VITE_PINE_RUNTIME_PANE_ENABLED', '1')
  __permitRuntimePaneForTests()
  __allowEveryRuntimeScriptForTests()
  setRuntimeKillList([])
  setOffListingCurtainEnabled(true)
})
afterEach(() => {
  setIntradayHtfAdmissionForMeasurement(null)
  setOffListingCurtainEnabled(false)
  resetRuntimeSessions()
  resetRuntimeLedgers()
  clearSecondaryBars()
  vi.unstubAllEnvs()
})

describe('CLOSED, as committed: nothing a member sees moves', () => {
  it('⛔ the capability is not admitted, and its row says why', () => {
    expect(intradayHtfAdmitted()).toBe(false)
    expect(INTRADAY_HTF_WITNESS.capability).toBe(INTRADAY_HTF_CAPABILITY)
    expect(intradayHtfAdmissionReasons()).toContain('not marked admitted')
  })
  it('⛔ a 60 minute read on a 15 minute chart is refused by name, as before', () => {
    expect(() => run(MERGE)).toThrow(/60/)
  })
})

describe('OPENED for a measurement: the 60 minute merge, bar by bar', () => {
  beforeEach(() => setIntradayHtfAdmissionForMeasurement(true))

  it('⭐ look-ahead off: the bar closing its bucket reads it, the rest the last closed bucket (short 15:30 bucket included)', () => {
    const cols = run(MERGE)
    // Monday buckets: 09:30 {1-4} 10:30 {5-8} 11:30 {9-12} 12:30 {13-16} 13:30 {17-20} 14:30 {21-24} 15:30 {25,26}
    const want = [NaN, NaN, NaN, 4, 4, 4, 4, 8]
    want.forEach((w, i) => (Number.isNaN(w) ? expect(Number.isNaN(cols.x[i]), `bar ${i}`).toBe(true) : expect(cols.x[i], `bar ${i}`).toBe(w)))
    expect(cols.x[24]).toBe(24)           // Monday 15:30 reads the 14:30 bucket
    expect(cols.x[25]).toBe(26)           // Monday 15:45 closes the short 15:30 bucket
    expect(cols.x[26]).toBe(26)           // Tuesday 09:30 reads Monday's last bucket
    expect(cols.x[29]).toBe(30)           // Tuesday 10:15 closes its own
  })

  it('⭐ the child runs on the 60 minute bars: ta.sma(close, 2) of the hourly closes', () => {
    const cols = run(['plot(request.security(syminfo.tickerid, "60", ta.sma(close, 2)))'])
    expect(cols.x[7]).toBe(6)             // (4 + 8) / 2 on the bar closing the 10:30 bucket
    expect(cols.x[25]).toBe(25)           // (24 + 26) / 2
  })

  it('⭐ look-ahead on: every bar reads the bucket it is inside', () => {
    const cols = run(['plot(request.security(syminfo.tickerid, "60", close, lookahead = barmerge.lookahead_on))'])
    expect([0, 1, 2, 3].map((i) => cols.x[i])).toEqual([4, 4, 4, 4])
    expect(cols.x[4]).toBe(8)
  })

  it('⛔ still refused: 60 above a 45 minute chart (not a whole multiple), another symbol, and a daily chart', () => {
    const fortyFive = ROWS.filter((_, i) => i % 3 === 0)
    expect(() => run(MERGE, ctxOf('45'), fortyFive)).toThrow()
    expect(() => run(['plot(request.security("NASDAQ:QQQ", "60", close))'])).toThrow()
  })
})
