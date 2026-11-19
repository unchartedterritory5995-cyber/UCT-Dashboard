// ─── ⭐⭐ RS RATING L12 PR 2 (U-DAILY) — A DAILY READ ABOVE AN INTRADAY CHART ─────────────────────────────────────────
//
// Fred RS's rating reads `request.security(syminfo.tickerid, 'D', close)` and `request.security(comparativeTickerId,
// 'D', close)`. On an intraday chart TradingView reads them (`l12-is-2026-11-18`, look-ahead off, extended-hours chart):
//   * this chart's OWN symbol: every bar of a session reads the PREVIOUS session's daily close, except the session's
//     LAST chart bar, which reads its own (5m 19:55 on 95 of 95 days, 60m 19:00 on 656), and the newest bar, which
//     reads the session in progress (the developing day);
//   * SP:SPX: a bar opening before the session's close the previous session's close, from the close the day's own.
// `pine.js` mints such a read as an `above` target (a BARE open / high / low / close, look-ahead off); the host lane
// never draws it (the daily gate); the run's supply serves it from the symbol's held daily rows
// (`requestSupply.js::aboveChartRead`): SP:SPX's under `SPX@D` (the intraday block's `D: session-completed`), the
// chart symbol's own under `OWN_DAILY_KEY`, which the chart fetches only for a run that reads it
// (`useSecondarySources::ownDailyNeeded`, `runtimeColumns.js::runtimeReadsOwnDaily`).
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { computeRuntimeColumns, resetRuntimeSessions, resetRuntimeLedgers, runtimeReadsOwnDaily, probeRuntimeProgram } from './runtime/runtimeColumns'
import { requestTargetsUnservable } from './runtime/requestSupply'
import { __permitRuntimePaneForTests } from './runtimePaneGate'
import { __allowEveryRuntimeScriptForTests, setRuntimeKillList } from './runtimeKill'
import { OWN_DAILY_KEY, otherSymbolsSignature, setRequestWitnessRows, heldDepthOf } from './otherSymbols'
import { ownDailyNeeded, ensureChartSources } from './useSecondarySources'
import { clearSecondaryBars, secondaryBarsUrl } from './secondaryBars'

vi.setConfig({ testTimeout: 120000 })

const ET = (day, hh, mm) => {
  const [y, m, d] = day.split('-').map(Number)
  return Date.UTC(y, m - 1, d, hh + 5, mm) / 1000   // EST (UTC-5) in November
}
const utcMid = (day) => Date.parse(`${day}T00:00:00Z`) / 1000
const D0 = '2026-11-13'
const D1 = '2026-11-16'
const D2 = '2026-11-17'
const FIVE = 300
// The chart: day 1 pre 08:00..08:55, regular 09:30..10:25, post 16:00..16:55; day 2 the same up to 16:25 (the newest bar)
const slab = (day, hh, mm, n) => Array.from({ length: n }, (_, k) => ET(day, hh, mm) + k * FIVE)
const DAY1 = [...slab(D1, 8, 0, 12), ...slab(D1, 9, 30, 12), ...slab(D1, 16, 0, 12)]
const DAY2 = [...slab(D2, 8, 0, 12), ...slab(D2, 9, 30, 12), ...slab(D2, 16, 0, 6)]
const ROWS = [...DAY1, ...DAY2].map((t, i) => ({ t, o: 50, h: 51, l: 49, c: 50 + i * 0.01, v: 1 }))
const OWN_D = [{ t: D0, o: 1, h: 1, l: 1, c: 90, v: 1 }, { t: D1, o: 1, h: 1, l: 1, c: 91, v: 1 }, { t: D2, o: 1, h: 1, l: 1, c: 92, v: 1 }]
const SPX_D = [{ t: utcMid(D0), o: 1, h: 1, l: 1, c: 7561.67, v: 1 }, { t: utcMid(D1), o: 1, h: 1, l: 1, c: 7416.59, v: 1 },
  { t: utcMid(D2), o: 1, h: 1, l: 1, c: 7340.53, v: 1 }]
const SPX_5 = [...slab(D1, 9, 30, 78), ...slab(D2, 9, 30, 78)].map((t, k) => ({ t, o: 1, h: 1, l: 1, c: 7300 + k, v: 1 }))

const ctxOf = (over = {}) => ({
  tf: '5', newestBarIsForming: false, historyFromListing: true,
  symbol: { ticker: 'RDDT', exchange: 'NYSE', securityType: 'stock' },
  secondary: new Map([['SPX', { bars: SPX_5, status: 'available' }], ['SPX@D', { bars: SPX_D, status: 'available' }],
    [OWN_DAILY_KEY, { bars: OWN_D, status: 'available' }]]),
  exchangeOf: (t) => (t === 'SPX' ? 'SP' : null), ...over,
})
const pine = (lines) => ['//@version=5', 'indicator("udaily", overlay = false)', ...lines].join('\n')
const runDef = (source, keys) => ({
  id: 'u_udaily-run', compute: { kind: 'runtime', fn: 'runtime:u_udaily-run', rev: 1, source, objects: true,
    outputs: Object.fromEntries(keys.map((k, i) => [k, i])) },
  inputs: [], meta: { runtimeHistory: 'listing' },
})
const run = (lines, ctx = ctxOf(), rows = ROWS) => computeRuntimeColumns(runDef(pine(lines), ['x']), rows, ctx, { now: () => 0 })
const OWN_SRC = ['plot(request.security(syminfo.tickerid, "D", close))']
const SPX_SRC = ['plot(request.security("SP:SPX", "D", close))']

beforeEach(() => {
  vi.stubEnv('VITE_PINE_OBJECTS_ONLY_PANE_ENABLED', '1')
  vi.stubEnv('VITE_PINE_RUNTIME_PANE_ENABLED', '1')
  __permitRuntimePaneForTests()
  __allowEveryRuntimeScriptForTests()
  setRuntimeKillList([])
})
afterEach(() => {
  setRequestWitnessRows(null)
  resetRuntimeSessions()
  resetRuntimeLedgers()
  clearSecondaryBars()
  vi.unstubAllEnvs()
})

describe('the read is minted as an `above` target for a bare open / high / low / close only', () => {
  it('on an intraday timeframe the run reads its own daily rows; on D / W it does not; another expression declines', () => {
    expect(runtimeReadsOwnDaily(pine(OWN_SRC), '5')).toBe(true)
    expect(runtimeReadsOwnDaily(pine(['plot(request.security(syminfo.tickerid, "D", high))']), '60')).toBe(true)
    expect(runtimeReadsOwnDaily(pine(OWN_SRC), 'D')).toBe(false)
    expect(runtimeReadsOwnDaily(pine(OWN_SRC), 'W')).toBe(false)
    expect(runtimeReadsOwnDaily(pine(SPX_SRC), '5')).toBe(false)    // another symbol's read is not the chart's own
    expect(runtimeReadsOwnDaily(pine(['plot(request.security(syminfo.tickerid, "D", ta.sma(close, 5)))']), '5')).toBe(false)
    expect(runtimeReadsOwnDaily(pine(['plot(request.security(syminfo.tickerid, "D", close, lookahead = barmerge.lookahead_on))']), '5')).toBe(false)
  })

  it('the member door does not refuse a script for such a read before a chart is known', () => {
    const probe = probeRuntimeProgram(pine([...OWN_SRC, ...SPX_SRC.map((l) => l.replace('plot(', 'plot(0 * '))]))
    expect(probe.ok, JSON.stringify(probe.refusal)).toBe(true)
    expect(requestTargetsUnservable([{ own: true, ticker: null, code: 'D', above: true }], 1)).toBe(null)
  })
})

describe("this chart's own symbol at D: the previous session, the session's last bar its own, the newest bar the session's", () => {
  it('in the run', () => {
    const cols = run(OWN_SRC)
    ROWS.forEach((r, i) => {
      const last = i === ROWS.length - 1 || (i === DAY1.length - 1)
      const day2 = i >= DAY1.length
      const want = last ? (day2 ? 92 : 91) : (day2 ? 91 : 90)
      expect(cols.x[i], `${r.t}`).toBe(want)
    })
  })

  it('⛔ not handed the daily rows: refused by name; still loading: pending, never drawn from the intraday bars', () => {
    const without = ctxOf()
    without.secondary.delete(OWN_DAILY_KEY)
    expect(() => run(OWN_SRC, without)).toThrow(/own symbol at the `D` timeframe above this `5` chart.*not handed/)
    const loading = ctxOf()
    loading.secondary.set(OWN_DAILY_KEY, { bars: [], status: 'loading' })
    expect(() => run(OWN_SRC, loading)).toThrow(/still loading/)
  })

  it('⛔ a bar before the held daily rows is unknown: the run refuses rather than guess', () => {
    const shallow = ctxOf()
    shallow.secondary.set(OWN_DAILY_KEY, { bars: OWN_D.slice(1), status: 'available' })   // no 11-13 row: day 1 reads none
    expect(() => run(OWN_SRC, shallow)).toThrow(/cannot be read on every bar/)
  })
})

describe('⛔ the read is the RUN\'s request wherever it is used, never a column (Fred RS: `closeDa / closeDa[n63]`)', () => {
  // ⚰️ The chart's own read translated (for the columnar lane) to a plain gated `close`, which looked pure: bound as a
  // substituted macro, its history `y[n]` became a column the daily gate withheld whole, and the build refused
  // `runtime:request`; an expression over either read (`na(x) ? 1 : 0`) refused `pine:request` before both of the run's
  // resolvers read `above` (`pineRuntimeFrontend.js::needsRuntime`, `isAboveRequest`).
  it('history, an input offset, an inline offset and a derived expression all read the served rows', () => {
    const last = ROWS.length - 1
    const own = run(['y = request.security(syminfo.tickerid, "D", close)', 'plot(y / y[5])', 'plot(na(y) ? 1 : 0)'], ctxOf(), ROWS)
    expect(own.x[last]).toBeCloseTo(92 / 91, 12)          // the newest bar its own session's, 5 bars back the previous
    const n = run(['n = input.int(5)', 'y = request.security(syminfo.tickerid, "D", close)', 'plot(y / y[n])'])
    expect(n.x[last]).toBeCloseTo(92 / 91, 12)
    const inline = run(['plot(request.security(syminfo.tickerid, "D", close)[5])'])
    expect(inline.x[last]).toBe(91)
    const spx = run(['x = request.security("SP:SPX", "D", close)', 'plot(na(x) ? 1 : 0)'])
    expect(Array.from(spx.x).every((v) => v === 0)).toBe(true)
  })
})

describe('SP:SPX at D: the session it had completed', () => {
  it('in the run: before the close the previous session, from the close the session\'s own', () => {
    const cols = run(SPX_SRC)
    ROWS.forEach((r, i) => {
      const day2 = i >= DAY1.length
      const post = r.t >= ET(day2 ? D2 : D1, 16, 0)
      const want = post ? (day2 ? 7340.53 : 7416.59) : (day2 ? 7416.59 : 7561.67)
      expect(cols.x[i], `${r.t}`).toBe(want)
    })
  })

  it('⛔ a session still in progress is not a close: its post-market bars read the previous session', () => {
    const forming = ctxOf()
    forming.secondary.set('SPX@D', { bars: SPX_D, status: 'available', newestBarIsForming: true })
    const cols = run(SPX_SRC, forming)
    const i = ROWS.findIndex((r) => r.t === ET(D2, 16, 0))
    expect(cols.x[i]).toBe(7416.59)
  })
})

describe('the chart fetches its own daily rows only for a run that reads them', () => {
  const doc = (src) => ({ id: 'd1', compute: { kind: 'ast', runtimeObjects: { source: src } } })
  it('ownDailyNeeded: an instance whose run half reads its own symbol at D, on an intraday chart only', () => {
    const insts = [{ defId: 'd1' }]
    expect(ownDailyNeeded(insts, () => doc(pine(OWN_SRC)), '5')).toBe(true)
    expect(ownDailyNeeded(insts, () => doc(pine(OWN_SRC)), 'D')).toBe(false)
    expect(ownDailyNeeded(insts, () => doc(pine(['plot(close)'])), '5')).toBe(false)
    expect(ownDailyNeeded(insts, () => null, '5')).toBe(false)
  })

  it('OWN_DAILY_KEY is fetched as the chart symbol at D, as deep as a held daily read; never as a ticker', async () => {
    const asked = []
    const fetcher = (...a) => { asked.push(JSON.stringify(a)); return new Promise(() => {}) }
    const map = ensureChartSources([OWN_DAILY_KEY], '5', 5000, fetcher, 'rddt')
    expect(map.has(OWN_DAILY_KEY)).toBe(true)
    // the request is the chart symbol's DAILY series at a held daily read's depth
    await Promise.resolve()
    await new Promise((r) => setTimeout(r, 0))
    const want = secondaryBarsUrl('RDDT', 'D', heldDepthOf(5000, '5'))
    expect(asked.join(' '), asked.join(' | ')).toContain(want)
    expect(asked.some((u) => /OWN/.test(u))).toBe(false)
    expect(ensureChartSources([OWN_DAILY_KEY], '5', 5000, fetcher, null).has(OWN_DAILY_KEY)).toBe(false)
  })

  it('the binder recomputes when the own daily rows land', () => {
    const def = { meta: { otherSymbols: [] } }
    expect(otherSymbolsSignature(def, new Map(), '5')).toBe('')
    expect(otherSymbolsSignature(def, new Map([[OWN_DAILY_KEY, { bars: [], status: 'loading' }]]), '5'))
      .not.toBe(otherSymbolsSignature(def, new Map([[OWN_DAILY_KEY, { bars: OWN_D, status: 'available' }]]), '5'))
  })
})
