// ─── ⭐⭐ (NUMBER PENDING) A NAME BOUND TO ANOTHER SYMBOL'S REQUEST, READ INSIDE A CALL, REACHES THE RUN'S SUPPLY ─────────
//
// On the runtime lane `e = request.security("AMEX:SPY", timeframe.period, close)` then `nz(e, -1)` / `na(e)` was routed
// to the columnar lane (`pineRuntimeFrontend.js::callArgReadsRequest` walked a call's arguments and never followed a
// name), which translated the request into a `sym` column and evaluated it with NO other-symbol supply: `na` on every
// bar, drawn, nothing said, while the same request written inline reached the supply. The follow
// (`readsOtherSeriesRequest`) sends it to the run: the value, or the supply's refusal / wait BY NAME, never a silent `na`.
// ⛔ ONLY a read of ANOTHER series' bars: a name bound to the chart's own request (the identity, its own higher
// timeframe) keeps the columnar lane, which computes it from the chart's own bars (measured: following it too moved a
// served script's correct identity read onto a refusal).
import { describe, it, expect, afterEach } from 'vitest'
import { computeRuntimeColumns, resetRuntimeSessions, resetRuntimeLedgers } from '../runtimeColumns.js'
import { __namedRequestFollowOffForTests } from '../../ast/pineRuntimeFrontend.js'

const DAYS = Array.from({ length: 12 }, (_, i) => new Date(Date.UTC(2026, 0, 5) + i * 86400000).toISOString().slice(0, 10))
const BARS = DAYS.map((t, i) => ({ t, o: 100, h: 102, l: 98, c: 100 + i, v: 1000 + i }))
const SPY = DAYS.map((t, i) => ({ t, o: 500, h: 505, l: 495, c: 500 + 2 * i, v: 9000 }))
const H = ['//@version=6', 'indicator("named request", overlay = true)']
const CTX = { tf: 'D', symbol: { ticker: 'AAPL', exchange: 'NASDAQ' }, historyFromListing: true, newestBarIsForming: false,
  exchangeOf: (t) => (t === 'SPY' ? 'NYSE Arca' : null),
  secondary: new Map([['SPY', { status: 'available', exchange: 'NYSE Arca', bars: SPY }]]) }
const REQ = 'request.security("AMEX:SPY", timeframe.period, close)'
let n = 0
const run = (lines, ctx = CTX) => {
  n += 1
  const id = `u_named${n}`
  const doc = { id, meta: { runtimeHistory: 'listing' }, compute: { kind: 'runtime', fn: `runtime:${id}`, outputs: { a: 0 }, source: [...H, ...lines].join('\n') } }
  return Array.from(computeRuntimeColumns(doc, BARS, ctx).a)
}
const SPY_CLOSE = SPY.map((b) => b.c)

afterEach(() => { __namedRequestFollowOffForTests(false); resetRuntimeSessions(); resetRuntimeLedgers() })

describe('the three shapes measured: inline, `nz(e, d)`, `na(e)`', () => {
  it('inline: the run reads SPY (the control: this shape was always served)', () => {
    expect(run([`plot(nz(${REQ}, -1))`])).toEqual(SPY_CLOSE)
  })

  it('named, inside `nz(e, -1)`: the same values as inline, never -1 on every bar', () => {
    expect(run([`e = ${REQ}`, 'plot(nz(e, -1))'])).toEqual(SPY_CLOSE)
  })

  it('named, inside `na(e)`: SPY is known on every bar, so `not na(e)` is true on every bar', () => {
    expect(run([`e = ${REQ}`, 'plot(not na(e) ? 1 : 0)'])).toEqual(SPY_CLOSE.map(() => 1))
  })

  it('a name bound through another name (`f = e * 2`) is followed too', () => {
    expect(run([`e = ${REQ}`, 'f = e * 2', 'plot(nz(f, -1))'])).toEqual(SPY_CLOSE.map((c) => c * 2))
  })

  it('SPY not supplied: the run refuses BY NAME (or waits), never a silent na', () => {
    const none = { ...CTX, secondary: new Map([['SPY', { status: 'no_data', exchange: 'NYSE Arca', bars: [] }]]) }
    expect(() => run([`e = ${REQ}`, 'plot(nz(e, -1))'], none)).toThrow(/SPY/)
  })

  it('⛔ CONTROL: with the follow off, the named shapes read the columnar lane\'s supply-less na (the defect)', () => {
    __namedRequestFollowOffForTests(true)
    expect(run([`e = ${REQ}`, 'plot(nz(e, -1))'])).toEqual(SPY_CLOSE.map(() => -1))
    expect(run([`e = ${REQ}`, 'plot(not na(e) ? 1 : 0)'])).toEqual(SPY_CLOSE.map(() => 0))
  })

  it('⛔ a name bound to the chart\'s OWN request keeps the columnar lane (the identity is computed from the chart\'s bars)', () => {
    expect(run(['e = request.security(syminfo.tickerid, timeframe.period, close)', 'plot(nz(e, -1))'])).toEqual(BARS.map((b) => b.c))
  })

  it('⛔ ...and so a call the run does not hold over it (`ta.correlation`) is still computed there, never refused', () => {
    // MEASURED on the runtime-served census: following the chart's own identity read moved such a script onto the run's
    // `runtime:call-undeclared-builtin-state`, where the columnar lane's fold was right
    const got = run(['e = request.security(syminfo.tickerid, timeframe.period, close)', 'plot(nz(ta.correlation(close, e, 3), -1))'])
    expect(got.length).toBe(BARS.length)
    expect(got.slice(3).every((v) => Math.abs(v - 1) < 1e-9)).toBe(true)
  })
})
