// app/src/components/chart/engine/intradayHtfDoor.test.js
//
// ─── ⭐⭐ E101 INTRADAY-HTF — THE MEMBER DOOR LETS A HIGHER INTRADAY TIMEFRAME READ THROUGH (2026-11-28) ─────────────
//
// ⚰️ FOUND LIVE (write-capability w02 / w19 re-asked on production after #2988 shipped, smoke@, a 15 minute chart): the
// assistant's script `request.security(syminfo.tickerid, htf, ta.ema(src, len))` with `htf = input.string("60", ...)`
// was refused at the door with the host's sentence ("`60` is not one of them"). The door's run probe translates with no
// chart in hand, on the default daily base, where `"60"` read as a timeframe BELOW the chart. These rails hold:
//   * the door (`memberPaneDefinition`) now draws that exact script on the per-bar lane, with the capability live;
//   * closed by a measurement, the door refuses it exactly as before;
//   * the run on a 15 minute chart draws the 60 minute merge bar for bar (values written out by hand);
//   * the run on a DAILY chart refuses it by name (the supply's `intradayHtfRefusal`), never a blank line.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { memberPaneDefinition } from '../builder/memberPane/memberPaneDefinition'
import { computeRuntimeColumns, resetRuntimeSessions, resetRuntimeLedgers } from './runtime/runtimeColumns'
import { __permitRuntimePaneForTests } from './runtimePaneGate'
import { __allowEveryRuntimeScriptForTests, setRuntimeKillList } from './runtimeKill'
import { clearSecondaryBars } from './secondaryBars'
import { setIntradayHtfAdmissionForMeasurement } from './intradayHtfGate'

vi.setConfig({ testTimeout: 120000 })

// the script the live assistant wrote for w02 (2026-11-28, `recheck-mtf-2026-11-28/w02-0.pine`), verbatim
const W02 = `//@version=5
indicator("1H 50 EMA with background shading", overlay=true)

htf = input.string("60", "Higher timeframe", options=["60", "120", "240", "D"])
len = input.int(50, "EMA length", minval=1)
src = input.source(close, "Source")

emaHtf = request.security(syminfo.tickerid, htf, ta.ema(src, len))

plot(emaHtf, "1H 50 EMA", color=color.orange, linewidth=2)

bgcolor(close > emaHtf ? color.new(color.green, 85) : na, title="Above EMA shading")
`
const MERGE = `//@version=5
indicator("ihtf door", overlay=false)
plot(request.security(syminfo.tickerid, "60", close), "h")
`

const ET = (day, hh, mm) => { const [y, m, d] = day.split('-').map(Number); return Date.UTC(y, m - 1, d, hh + 5, mm) / 1000 }
const day = (d) => Array.from({ length: 26 }, (_, k) => ET(d, 9, 30) + k * 900)
const ROWS = [...day('2026-01-12'), ...day('2026-01-13')].map((t, i) => ({ t, o: i + 1, h: i + 1.5, l: i + 0.5, c: i + 1, v: 1 }))
const DAILY = ['2026-01-12', '2026-01-13', '2026-01-14'].map((t, i) => ({ t, o: i + 1, h: i + 2, l: i, c: i + 1, v: 1 }))
const SYMBOL = { ticker: 'SPY', exchange: 'AMEX', securityType: 'fund' }
const ctxOf = (tf) => ({ tf, newestBarIsForming: false, historyFromListing: true, symbol: SYMBOL, secondary: new Map(), exchangeOf: () => null })
const door = (source) => memberPaneDefinition({ source, id: 'u_ihtf_door', name: 'ihtf door' })

beforeEach(() => {
  vi.stubEnv('VITE_PINE_OBJECTS_ONLY_PANE_ENABLED', '1')
  vi.stubEnv('VITE_PINE_RUNTIME_PANE_ENABLED', '1')
  __permitRuntimePaneForTests()
  __allowEveryRuntimeScriptForTests()
  setRuntimeKillList([])
})
afterEach(() => {
  setIntradayHtfAdmissionForMeasurement(null)
  resetRuntimeSessions()
  resetRuntimeLedgers()
  clearSecondaryBars()
  vi.unstubAllEnvs()
})

describe('the member door, live', () => {
  it('⭐ the script the assistant wrote for w02 is drawn bar by bar, not refused with the host\'s sentence', () => {
    const r = door(W02)
    expect(r.ok, r.reason || '').toBe(true)
    expect(r.definition.compute.kind).toBe('runtime')
  })
  it('⛔ closed by a measurement, the door refuses it as before the unit', () => {
    setIntradayHtfAdmissionForMeasurement(false)
    const r = door(W02)
    expect(r.ok).toBe(false)
  })
})

describe('the run the door\'s document makes', () => {
  it('⭐ on a 15 minute chart: the bar closing its bucket reads it, the rest the last closed bucket', () => {
    const r = door(MERGE)
    expect(r.ok, r.reason || '').toBe(true)
    const cols = computeRuntimeColumns(r.definition, ROWS, ctxOf('15'), { now: () => 0 })
    const x = Object.values(cols).find((v) => v && typeof v.length === 'number' && v.length === ROWS.length)
    expect(Number.isNaN(x[0])).toBe(true)
    expect(x[3]).toBe(4)
    expect(x[7]).toBe(8)
    expect(x[25]).toBe(26)
  })
  it('⛔ on a daily chart it is refused by name: a 60 minute read is read from an intraday chart\'s own bars only', () => {
    const r = door(MERGE)
    expect(() => computeRuntimeColumns(r.definition, DAILY, ctxOf('D'), { now: () => 0 })).toThrow(/intraday chart/)
  })
})

// ⭐⭐ A SOURCE INPUT READ INSIDE A REQUEST (found by the same w02 re-ask: `input.source` inside ANY request refused
// `runtime:input-state`, weekly included). Bars whose hl2 is half a point above the close, so the two read differently.
const ROWS2 = ROWS.map((b) => ({ ...b, h: b.c + 2, l: b.c - 1 }))
const srcScript = (tf) => `//@version=5
indicator("src in request", overlay=false)
src = input.source(close, "Source")
plot(request.security(syminfo.tickerid, "${tf}", src), "x")
`
const fixed = (tf, series) => `//@version=5
indicator("src fixed", overlay=false)
plot(request.security(syminfo.tickerid, "${tf}", ${series}), "x")
`
const colOf = (cols) => Object.values(cols).find((v) => v && typeof v.length === 'number' && v.length === ROWS2.length)
const run = (source, inputs) => {
  const r = door(source)
  expect(r.ok, r.reason || '').toBe(true)
  return Array.from(colOf(computeRuntimeColumns(r.definition, ROWS2, { ...ctxOf('15'), runtimeInputs: inputs || {} }, { now: () => 0 })))
}
const same = (a, b) => a.every((v, i) => (Number.isNaN(v) && Number.isNaN(b[i])) || v === b[i])

describe('a source input inside a request is the bar series it names, of the requested bars', () => {
  it('⭐ at the author default (close): exactly the request of close', () => {
    const a = run(srcScript('60'))
    const b = run(fixed('60', 'close'))
    expect(a.some(Number.isFinite)).toBe(true)
    expect(same(a, b)).toBe(true)
  })
  it('⭐ at the member choice (hl2): exactly the request of hl2, and not of close', () => {
    const r = door(srcScript('60'))
    const key = (r.definition.inputs || []).find((i) => i && i.source === true).key   // the settings' source spec
    expect(key).toBe('src')
    const a = run(srcScript('60'), { [key]: 'hl2' })
    const b = run(fixed('60', 'hl2'))
    const c = run(fixed('60', 'close'))
    expect(same(a, b)).toBe(true)
    expect(same(a, c)).toBe(false)
  })
})

describe('the w19 table script the live assistant wrote passes the door', () => {
  it('⭐ the 1h / 4h / D / W trend table: request(...)[1] at a compile-only check is not refused for its missing chart', () => {
    const W19 = `//@version=5
indicator("Multi-timeframe 20 EMA trend table", overlay=true)
len = input.int(20, "EMA length", minval=1)
c60  = request.security(syminfo.tickerid, "60", close)[1]
e60  = request.security(syminfo.tickerid, "60", ta.ema(close, len))[1]
c240 = request.security(syminfo.tickerid, "240", close)[1]
e240 = request.security(syminfo.tickerid, "240", ta.ema(close, len))[1]
var table t = table.new(position.top_right, 2, 3, border_width=1)
table.cell(t, 0, 1, "1H")
table.cell(t, 1, 1, c60 > e60 ? "up" : "down")
table.cell(t, 0, 2, "4H")
table.cell(t, 1, 2, c240 > e240 ? "up" : "down")
plot((c60 > e60 ? 1 : 0) + (c240 > e240 ? 1 : 0), "score", color=color.new(color.gray, 100))
`
    const r = door(W19)
    expect(r.ok, r.reason || '').toBe(true)
  })
})

describe('Pine price means inside a request are their arithmetic of the requested bars', () => {
  for (const [name, written] of [['hl2', '(high + low) / 2'], ['hlc3', '(high + low + close) / 3'],
    ['ohlc4', '(open + high + low + close) / 4'], ['hlcc4', '(high + low + 2 * close) / 4']]) {
    it(`⭐ ${name} at 60 minutes: exactly ${written}`, () => {
      for (const tf of ['60']) {
        const a = run(fixed(tf, name))
        const b = run(fixed(tf, written))
        expect(a.some(Number.isFinite)).toBe(true)
        expect(same(a, b)).toBe(true)
      }
    })
  }
})

