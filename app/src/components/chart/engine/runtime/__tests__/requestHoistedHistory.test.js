// app/src/components/chart/engine/runtime/__tests__/requestHoistedHistory.test.js
//
// ─── ⭐⭐ U-REQ-HOIST-COLUMN, THE GUARD HALF (docs/pine/PARITY-ROADMAP-2026-11-18.md) ───
//
// A requested function whose body lowers as STATEMENTS (a `var`, or a recurrence such as PA ZigZag's
// `int _dir = na , _dir := … nz(_dir[1])`) is hoisted into the request's own region. There, a history read of a
// body binding (`_isUp[1]`) was lowered as a COLUMN of the columnar lane, which is computed once over THIS chart's
// bars; the request's sub-run read it at the requested bar's index. So on weekly bar j, `_isUp[1]` was the CHART's
// daily bar j-1 (measured on PA ZigZag Fibonacci FAN at 1W / 1M, RDDT and SPY: the model reproduces our column on
// 140 / 140 weeks and 33 / 33 months). The column guard walked the request's VALUE only. It now walks the hoisted
// statements too, and such a request refuses by name, `runtime:request-hoisted-history`, instead of drawing.
//
// Pinned here, each by a case only that rule passes:
//   * the PA ZigZag shape refuses, by name, at the build and at the run;
//   * a hoisted body with NO history read (a `var` accumulator) still serves, with the requested bars' values;
//   * a hoisted body whose history read is the region's own SLOT history (`nz(d[1])` on a recurrence) still serves,
//     with the requested bars' values: the guard is the column, not "any history read";
//   * the same function at the chart's own period (the identity, no region) still serves.
import { describe, it, expect, beforeEach } from 'vitest'
import { computeRuntimeColumns, resetRuntimeSessions, resetRuntimeLedgers } from '../runtimeColumns.js'
import { requestAlignment } from '../../ast/interpret.js'
import { buildRuntimeIr } from '../../ast/pineRuntimeFrontend.js'
import { EXPR } from '../ir.js'

beforeEach(() => { resetRuntimeSessions(); resetRuntimeLedgers() })

/** Weekday ISO dates from 2026-01-05 (a Monday), `n` sessions. */
function weekdays(n, from = '2026-01-05') {
  const out = []
  const d = new Date(`${from}T00:00:00Z`)
  while (out.length < n) {
    const w = d.getUTCDay()
    if (w !== 0 && w !== 6) out.push(d.toISOString().slice(0, 10))
    d.setUTCDate(d.getUTCDate() + 1)
  }
  return out
}
// closes that turn up and down from week to week, so a zigzag has pivots and a direction has turns
const WAVE = [0, 3, 1, 4, -2, 2, 5, -1, 3, 0, 6, -3]
const DAYS = weekdays(60)                  // Mon 2026-01-05 .. twelve whole weeks
const CHART = DAYS.map((t, i) => {
  const wk = Math.floor(i / 5)
  const c = 100 + WAVE[wk % WAVE.length] * 2 + (i % 5) * 0.25 * (wk % 3 === 1 ? -1 : 1)  // some weeks drift down
  return { t, o: c + ((i % 2) ? 0.5 : -0.5), h: c + 1.5, l: c - 1.5, c, v: 1000 + i }
})
const ctx = { tf: 'D', newestBarIsForming: false, historyFromListing: true, symbol: { ticker: 'RDDT', exchange: 'NYSE' } }
const doc = (body) => ({
  id: 'hoist', meta: { runtimeHistory: 'listing' },
  compute: { kind: 'runtime', fn: 'runtime:hoist', outputs: { a: 0 }, source: `//@version=6\nindicator("hoist")\n${body}` },
})
const run = (body) => computeRuntimeColumns(doc(body), CHART, ctx)
const build = (body) => buildRuntimeIr(`//@version=6\nindicator("hoist")\n${body}`, { bars: CHART, inputs: {}, pane: true, historyFromListing: true })

const hasKind = (e, kind, seen = new Set()) => {
  if (!e || typeof e !== 'object' || seen.has(e)) return false
  seen.add(e)
  if (e.kind === kind) return true
  return Object.values(e).some((v) => v && typeof v === 'object' && hasKind(v, kind, seen))
}

// ⭐ the weekly bars and the chart bar -> weekly bar pick the run's supply uses (look-ahead off: the bar that closes
// its week reads that week, every other bar the last closed week), for the expected values below
const { runBars: WEEKS, index: PICK } = requestAlignment({ chartBars: CHART, srcBars: CHART, code: 'W' })
const onChart = (perWeek) => CHART.map((_, i) => (PICK[i] >= 0 ? perWeek[PICK[i]] : NaN))
const same = (got, want) => {
  let compared = 0
  for (let i = 0; i < want.length; i += 1) {
    if (Number.isNaN(want[i])) continue
    expect(got[i], `bar ${i} (${CHART[i].t})`).toBe(want[i])
    compared += 1
  }
  expect(compared).toBeGreaterThan(40)
}

const ZIGZAG = [
  'zigzag () =>',
  '    bool _isUp = close >= close[1]',
  '    bool _isDown = close <= close[1]',
  '    int _dir = na , _dir := _isUp[1] and _isDown ? -1 : _isDown[1] and _isUp ? 1 : nz(_dir[1])',
  '    float _hh = ta.highest(2)',
  '    float _ll = ta.lowest(2)',
  '    float _zz = _isUp[1] and _isDown and _dir[1] != -1 ? _hh : _isDown[1] and _isUp and _dir[1] != 1 ? _ll : na',
  '    _zz',
].join('\n')

describe('⭐⭐ the PA ZigZag shape refuses by name: its hoisted history would be read from the chart', () => {
  const body = `${ZIGZAG}\nplot(request.security(syminfo.tickerid, "W", zigzag(), barmerge.gaps_off, barmerge.lookahead_on))`

  it('the build refuses `runtime:request-hoisted-history`, with the sentence a member reads', () => {
    const b = build(body)
    expect(b.ok).toBe(false)
    expect(b.refusal.guard).toBe('runtime:request-hoisted-history')
    expect(b.refusal.message).toMatch(/earlier values/)
    expect(b.refusal.message).toMatch(/nothing is drawn rather than a wrong value/)
  })

  it('the run refuses by the same name (never a column read at the wrong bars)', () => {
    expect(() => run(body)).toThrow(/runtime:request-hoisted-history|earlier values/)
  })

  it('look-ahead off refuses too: the guard is the region, not the merge', () => {
    const b = build(`${ZIGZAG}\nplot(request.security(syminfo.tickerid, "W", zigzag()))`)
    expect(b.ok).toBe(false)
    expect(b.refusal.guard).toBe('runtime:request-hoisted-history')
  })

  it('CONTROL: at the chart\'s own period (the identity, no region) the same function still serves', () => {
    const b = build(`${ZIGZAG}\nplot(request.security(syminfo.tickerid, timeframe.period, zigzag()))`)
    expect(b.ok).toBe(true)
    expect(b.ir.requests || []).toHaveLength(0)
  })
})

describe('⭐ a hoisted body that reads no column still serves, with the requested bars\' values', () => {
  it('a `var` accumulator: hoisted, no history read, the running sum of the weekly closes', () => {
    const body = [
      'acc () =>',
      '    var float s = 0.0',
      '    s := s + close',
      '    s',
      'plot(request.security(syminfo.tickerid, "W", acc()))',
    ].join('\n')
    const b = build(body)
    expect(b.ok).toBe(true)
    const req = b.ir.requests[0]
    expect(req.statements.length).toBeGreaterThan(0)          // the shape under test: a hoisted body
    expect(req.statements.some((s) => hasKind(s, EXPR.COLUMN))).toBe(false)
    let sum = 0
    const perWeek = WEEKS.map((w) => { sum += w.c; return sum })
    same(Array.from(run(body).a), onChart(perWeek))
  })

  it('a recurrence whose history read is the region\'s OWN slot (`nz(d[1])`): hoisted, served, right', () => {
    const body = [
      'turn () =>',
      '    int d = na , d := close > open ? 1 : close < open ? -1 : nz(d[1])',
      '    d',
      'plot(request.security(syminfo.tickerid, "W", turn()))',
    ].join('\n')
    const b = build(body)
    expect(b.ok).toBe(true)
    const req = b.ir.requests[0]
    expect(req.statements.length).toBeGreaterThan(0)
    expect(req.statements.some((s) => hasKind(s, EXPR.COLUMN))).toBe(false)
    let d = 0
    const perWeek = WEEKS.map((w) => { d = w.c > w.o ? 1 : w.c < w.o ? -1 : d; return d })
    expect(new Set(perWeek).size).toBeGreaterThan(1)          // the weeks turn both ways, so a wrong read shows
    same(Array.from(run(body).a), onChart(perWeek))
  })
})
