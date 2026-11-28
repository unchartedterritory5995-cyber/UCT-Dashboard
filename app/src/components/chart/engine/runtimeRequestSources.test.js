// app/src/components/chart/engine/runtimeRequestSources.test.js
//
// ─── ⭐⭐ (2026-11-28) A SOURCE INPUT AND PINE'S PRICE MEANS, READ INSIDE A REQUEST ON THE RUNTIME LANE ────────────────
//
// ⚰️ FOUND by re-asking write-capability w02 live on production: `src = input.source(close, "Source")` then
// `request.security(syminfo.tickerid, htf, ta.ema(src, len))` refused `runtime:input-state`, and NOT only for an intraday
// timeframe: inside EVERY request (weekly included) a source input fell through to the stateful-builtin refusal, and
// `hl2` / `hlc3` / `ohlc4` / `hlcc4` were "a name nothing in this script binds", while the five bar fields read fine.
// These rails hold, on the runtime lane itself (the document is a runtime one, so no other lane can answer for it):
//   * a source input inside a request is the bar series it names, of the requested bars (the author's default, and the
//     member's choice: `hl2` is the request of `hl2`, not of `close`);
//   * each mean inside a request is exactly its written arithmetic (`pine.js::derivedSeriesTree`'s);
//   * weekly on a daily chart and 60 minutes on a 15 minute chart alike.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { computeRuntimeColumns, resetRuntimeSessions, resetRuntimeLedgers } from './runtime/runtimeColumns'
import { __permitRuntimePaneForTests } from './runtimePaneGate'
import { __allowEveryRuntimeScriptForTests, setRuntimeKillList } from './runtimeKill'
import { clearSecondaryBars } from './secondaryBars'

vi.setConfig({ testTimeout: 120000 })

const ET = (day, hh, mm) => { const [y, m, d] = day.split('-').map(Number); return Date.UTC(y, m - 1, d, hh + 5, mm) / 1000 }
const day = (d) => Array.from({ length: 26 }, (_, k) => ET(d, 9, 30) + k * 900)
// bars whose hl2 is half a point above the close (h = c + 2, l = c - 1), so the two read differently
const shape = (t, i) => ({ t, o: i + 1, h: i + 3, l: i, c: i + 1, v: 10 + i })
const INTRADAY = [...day('2026-01-12'), ...day('2026-01-13')].map(shape)
const DAYS = []
for (let t = Date.UTC(2026, 0, 5); DAYS.length < 40; t += 86400000) {
  const d = new Date(t)
  if (d.getUTCDay() !== 0 && d.getUTCDay() !== 6) DAYS.push(d.toISOString().slice(0, 10))
}
const DAILY = DAYS.map(shape)
const SYMBOL = { ticker: 'SPY', exchange: 'AMEX', securityType: 'fund' }
const ctxOf = (tf, inputs) => ({ tf, newestBarIsForming: false, historyFromListing: true, symbol: SYMBOL, secondary: new Map(),
  exchangeOf: () => null, runtimeInputs: inputs || {} })
const runDef = (source, inputs = []) => ({
  id: 'u_req_src', compute: { kind: 'runtime', fn: 'runtime:u_req_src', rev: 1, source, objects: true, outputs: { x: 0 } },
  inputs, meta: { runtimeHistory: 'listing' },
})
const SRC_SPEC = [{ key: 'src', type: 'enum', default: 'close', options: ['open', 'high', 'low', 'close', 'hl2', 'hlc3', 'ohlc4', 'hlcc4'],
  label: 'Source', source: true }]
const srcScript = (tf) => `//@version=5
indicator("src in request", overlay=false)
src = input.source(close, "Source")
plot(request.security(syminfo.tickerid, "${tf}", src), "x")
`
const fixed = (tf, series) => `//@version=5
indicator("src fixed", overlay=false)
plot(request.security(syminfo.tickerid, "${tf}", ${series}), "x")
`
const CHARTS = [['W', 'D', DAILY], ['60', '15', INTRADAY]]
const run = (source, chartTf, rows, inputs, specs) => Array.from(
  computeRuntimeColumns(runDef(source, specs), rows, ctxOf(chartTf, inputs), { now: () => 0 }).x)
const same = (a, b) => a.length === b.length && a.every((v, i) => (Number.isNaN(v) && Number.isNaN(b[i])) || v === b[i])

beforeEach(() => {
  vi.stubEnv('VITE_PINE_OBJECTS_ONLY_PANE_ENABLED', '1')
  vi.stubEnv('VITE_PINE_RUNTIME_PANE_ENABLED', '1')
  __permitRuntimePaneForTests()
  __allowEveryRuntimeScriptForTests()
  setRuntimeKillList([])
})
afterEach(() => {
  resetRuntimeSessions()
  resetRuntimeLedgers()
  clearSecondaryBars()
  vi.unstubAllEnvs()
})

describe('a source input inside a request is the bar series it names, of the requested bars', () => {
  for (const [tf, chartTf, rows] of CHARTS) {
    it(`⭐ ${tf} on a ${chartTf} chart, at the author default (close): exactly the request of close`, () => {
      const a = run(srcScript(tf), chartTf, rows, {}, SRC_SPEC)
      const b = run(fixed(tf, 'close'), chartTf, rows)
      expect(a.some(Number.isFinite)).toBe(true)
      expect(same(a, b)).toBe(true)
    })
    it(`⭐ ${tf} on a ${chartTf} chart, at the member choice (hl2): the request of hl2, not of close`, () => {
      const a = run(srcScript(tf), chartTf, rows, { src: 'hl2' }, SRC_SPEC)
      expect(same(a, run(fixed(tf, 'hl2'), chartTf, rows))).toBe(true)
      expect(same(a, run(fixed(tf, 'close'), chartTf, rows))).toBe(false)
    })
  }
})

describe('Pine price means inside a request are their arithmetic of the requested bars', () => {
  for (const [name, written] of [['hl2', '(high + low) / 2'], ['hlc3', '(high + low + close) / 3'],
    ['ohlc4', '(open + high + low + close) / 4'], ['hlcc4', '(high + low + 2 * close) / 4']]) {
    for (const [tf, chartTf, rows] of CHARTS) {
      it(`⭐ ${name} at ${tf} on a ${chartTf} chart: exactly ${written}`, () => {
        const a = run(fixed(tf, name), chartTf, rows)
        expect(a.some(Number.isFinite)).toBe(true)
        expect(same(a, run(fixed(tf, written), chartTf, rows))).toBe(true)
      })
    }
  }
  it('⛔ a name the script binds itself wins over the mean', () => {
    const own = `//@version=5
indicator("own hl2", overlay=false)
hl2 = close * 10
plot(request.security(syminfo.tickerid, "W", hl2), "x")
`
    expect(same(run(own, 'D', DAILY), run(fixed('W', 'close * 10'), 'D', DAILY))).toBe(true)
  })
})
