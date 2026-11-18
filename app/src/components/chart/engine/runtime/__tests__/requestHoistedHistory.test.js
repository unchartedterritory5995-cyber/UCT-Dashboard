// app/src/components/chart/engine/runtime/__tests__/requestHoistedHistory.test.js
//
// ─── ⭐⭐ U-REQ-HOIST-COLUMN (docs/pine/PARITY-ROADMAP-2026-11-18.md): THE LOWERING, AND THE GUARD BEHIND IT ───
//
// A requested function whose body lowers as STATEMENTS (a `var`, or a recurrence such as PA ZigZag's
// `int _dir = na , _dir := … nz(_dir[1])`) is hoisted into the request's own region. There, a history read of a
// pure body binding (`_isUp[1]`) used to be lowered as a COLUMN of the columnar lane, computed once over THIS chart's
// bars, and the request's sub-run read it at the requested bar's index: on weekly bar j, `_isUp[1]` was the CHART's
// daily bar j-1 (PA ZigZag Fibonacci FAN at 1W / 1M, RDDT and SPY: that model reproduced our column on 140 / 140
// weeks and 33 / 33 months). Engine 78's guard refused it by name (`runtime:request-hoisted-history`).
//
// ⭐ THE LOWERING: inside a request region a pure expression's `[k]` (a static offset) is declared into the
// region's OWN committed series and read through that slot's ring, committed once per REQUESTED bar, exactly as a
// window's source already is there. And the last line of a hoisted body declares ITS committed series into the
// region too (it used to land in the main program, which a sub-run never runs: `na` on every requested bar).
//
// Pinned here, each by a case only that rule passes:
//   * the PA ZigZag shape SERVES, with TradingView's zigzag over the weekly and monthly bars (look-ahead on and off);
//   * a pure expression's `[1]` in a request's VALUE serves the requested bars' past;
//   * a hoisted body's last line `(d * 2)[1]` serves the requested bars' past (not `na`);
//   * the e78 guard stays the backstop: a DYNAMIC offset over an expression in a hoisted body still refuses by name;
//   * a hoisted `var` accumulator and a hoisted slot recurrence still serve, right;
//   * the same function at the chart's own period (the identity, no region) still serves.
import { describe, it, expect, beforeEach } from 'vitest'
import { computeRuntimeColumns, resetRuntimeSessions, resetRuntimeLedgers } from '../runtimeColumns.js'
import { requestAlignment } from '../../ast/interpret.js'
import { buildRuntimeIr } from '../../ast/pineRuntimeFrontend.js'
import { EXPR } from '../ir.js'

beforeEach(() => { resetRuntimeSessions(); resetRuntimeLedgers() })

/** Weekday ISO dates from 2025-01-06 (a Monday), `n` sessions. */
function weekdays(n, from = '2025-01-06') {
  const out = []
  const d = new Date(`${from}T00:00:00Z`)
  while (out.length < n) {
    const w = d.getUTCDay()
    if (w !== 0 && w !== 6) out.push(d.toISOString().slice(0, 10))
    d.setUTCDate(d.getUTCDate() + 1)
  }
  return out
}
// closes that turn up and down from week to week, so a zigzag has pivots and a direction has turns; some weeks
// drift down inside the week, so a weekly open and close disagree in both directions
const WAVE = [0, 3, 1, 4, -2, 2, 5, -1, 3, 0, 6, -3, 2, -4, 1]
const DAYS = weekdays(300)                 // sixty whole weeks, fourteen months
const CHART = DAYS.map((t, i) => {
  const wk = Math.floor(i / 5)
  const c = 100 + WAVE[wk % WAVE.length] * 2 + Math.floor(wk / WAVE.length) * 3 + (i % 5) * 0.25 * (wk % 3 === 1 ? -1 : 1)
  return { t, o: c + ((i % 2) ? 0.5 : -0.5), h: c + 1.5 + (i % 7) * 0.1, l: c - 1.5 - (i % 4) * 0.1, c, v: 1000 + i }
})
const ctx = { tf: 'D', newestBarIsForming: false, historyFromListing: true, symbol: { ticker: 'RDDT', exchange: 'NYSE' } }
const doc = (body) => ({
  id: 'hoist', meta: { runtimeHistory: 'listing' },
  compute: { kind: 'runtime', fn: 'runtime:hoist', outputs: { a: 0 }, source: `//@version=6\nindicator("hoist")\n${body}` },
})
const run = (body) => Array.from(computeRuntimeColumns(doc(body), CHART, ctx).a)
const build = (body) => buildRuntimeIr(`//@version=6\nindicator("hoist")\n${body}`, { bars: CHART, inputs: {}, pane: true, historyFromListing: true })

const hasKind = (e, kind, seen = new Set()) => {
  if (!e || typeof e !== 'object' || seen.has(e)) return false
  seen.add(e)
  if (e.kind === kind) return true
  return Object.values(e).some((v) => v && typeof v === 'object' && hasKind(v, kind, seen))
}

/** The periods (`runBars`) and, per chart bar, the period it reads, by the run's own alignment authority
 *  (`requestAlignment`: look-ahead on reads the period the bar is inside; off, the last closed one). */
const periodsOf = (code, live) => {
  const a = requestAlignment({ chartBars: CHART, srcBars: CHART, code, live })
  return { P: a.runBars, onChart: (perPeriod) => CHART.map((_, i) => (a.withheld[i] || a.index[i] < 0 ? NaN : perPeriod[a.index[i]])) }
}
/** Every bar equal, `na` included (a missing pivot and an extra one both fail), with enough values compared. */
const sameEverywhere = (got, want, atLeast) => {
  let compared = 0
  for (let i = 0; i < want.length; i += 1) {
    const w = want[i]
    const g = got[i]
    if (Number.isNaN(w)) { expect(Number.isNaN(g), `bar ${i} (${CHART[i].t}): want na, got ${g}`).toBe(true); continue }
    expect(g, `bar ${i} (${CHART[i].t})`).toBe(w)
    compared += 1
  }
  expect(compared).toBeGreaterThanOrEqual(atLeast)
}

/** TradingView's PA ZigZag over a series of period bars, written out from the script (its own semantics). */
function zigzagOf(P) {
  const up = []; const dn = []; const dir = []; const zz = []
  for (let q = 0; q < P.length; q += 1) {
    up[q] = q > 0 && P[q].c >= P[q - 1].c
    dn[q] = q > 0 && P[q].c <= P[q - 1].c
    const u1 = q > 0 && up[q - 1]
    const d1 = q > 0 && dn[q - 1]
    const r1 = q > 0 ? dir[q - 1] : 0
    dir[q] = u1 && dn[q] ? -1 : d1 && up[q] ? 1 : r1
    const hh = q > 0 ? Math.max(P[q - 1].h, P[q].h) : NaN
    const ll = q > 0 ? Math.min(P[q - 1].l, P[q].l) : NaN
    zz[q] = u1 && dn[q] && r1 !== -1 ? hh : d1 && up[q] && r1 !== 1 ? ll : NaN
  }
  return zz
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

describe('⭐⭐ the PA ZigZag shape serves: its history is the REQUESTED bars\' history', () => {
  it('the build serves it, and no hoisted statement carries a column', () => {
    const b = build(`${ZIGZAG}\nplot(request.security(syminfo.tickerid, "W", zigzag(), barmerge.gaps_off, barmerge.lookahead_on))`)
    expect(b.ok, b.refusal && b.refusal.message).toBe(true)
    const req = b.ir.requests[0]
    expect(req.statements.length).toBeGreaterThan(0)
    expect(req.statements.some((s) => hasKind(s, EXPR.COLUMN))).toBe(false)
    expect(hasKind(req.value, EXPR.COLUMN)).toBe(false)
  })

  for (const [code, live, atLeast] of [['W', true, 40], ['W', false, 40], ['M', true, 40], ['M', false, 40]]) {
    it(`${code}, look-ahead ${live ? 'on' : 'off'}: every bar is TradingView's zigzag of the ${code === 'W' ? 'weeks' : 'months'}`, () => {
      const { P, onChart } = periodsOf(code, live)
      const want = onChart(zigzagOf(P))
      expect(want.filter((v) => !Number.isNaN(v)).length, 'the fixture has pivots to compare').toBeGreaterThanOrEqual(atLeast)
      const look = live ? ', barmerge.gaps_off, barmerge.lookahead_on' : ''
      sameEverywhere(run(`${ZIGZAG}\nplot(request.security(syminfo.tickerid, "${code}", zigzag()${look}))`), want, atLeast)
    })
  }
})

describe('⭐ a pure expression\'s past inside a request is the requested bars\' past', () => {
  it('`(close > open)[1]` as the request\'s value: last week\'s direction', () => {
    const { P, onChart } = periodsOf('W', false)
    const perWeek = P.map((_, j) => (j > 0 ? (P[j - 1].c > P[j - 1].o ? 1 : 0) : NaN))
    expect(new Set(perWeek.filter((v) => !Number.isNaN(v))).size).toBe(2)
    sameEverywhere(run('plot(request.security(syminfo.tickerid, "W", (close > open)[1] ? 1 : 0))'), onChart(perWeek), 200)
  })

  it('a hoisted body\'s LAST line `(d * 2)[1]` reads the region\'s series (it read `na` from the main program)', () => {
    const body = [
      'turn2 () =>',
      '    int d = na , d := close > open ? 1 : close < open ? -1 : nz(d[1])',
      '    (d * 2)[1]',
      'plot(request.security(syminfo.tickerid, "W", turn2()))',
    ].join('\n')
    const { P, onChart } = periodsOf('W', false)
    let d = 0
    const dirs = P.map((w) => { d = w.c > w.o ? 1 : w.c < w.o ? -1 : d; return d })
    const perWeek = dirs.map((_, j) => (j > 0 ? dirs[j - 1] * 2 : NaN))
    sameEverywhere(run(body), onChart(perWeek), 200)
  })
})

describe('⛔ the e78 guard stays the backstop for a shape the lowering does not serve', () => {
  // a DYNAMIC offset over an expression keeps its column (the lowering serves static offsets only)
  const body = [
    'dyn () =>',
    '    var int k = 0',
    '    k := bar_index % 2 == 0 ? 1 : 2',
    '    float x = (close > open)[k] ? 1 : 0',
    '    x',
    'plot(request.security(syminfo.tickerid, "W", dyn()))',
  ].join('\n')

  it('refuses `runtime:request-hoisted-history` by name, with the sentence a member reads', () => {
    const b = build(body)
    expect(b.ok).toBe(false)
    expect(b.refusal.guard).toBe('runtime:request-hoisted-history')
    expect(b.refusal.message).toMatch(/earlier values/)
    expect(b.refusal.message).toMatch(/nothing is drawn rather than a wrong value/)
  })

  it('and the run refuses by the same name', () => {
    expect(() => run(body)).toThrow(/runtime:request-hoisted-history|earlier values/)
  })
})

describe('⭐ CONTROLS: what never needed the lowering still serves, right', () => {
  it('at the chart\'s own period (the identity, no region) the same function serves', () => {
    const b = build(`${ZIGZAG}\nplot(request.security(syminfo.tickerid, timeframe.period, zigzag()))`)
    expect(b.ok).toBe(true)
    expect(b.ir.requests || []).toHaveLength(0)
  })

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
    expect(b.ir.requests[0].statements.length).toBeGreaterThan(0)
    const { P, onChart } = periodsOf('W', false)
    let sum = 0
    sameEverywhere(run(body), onChart(P.map((w) => { sum += w.c; return sum })), 200)
  })

  it('a recurrence whose history read is the region\'s OWN slot (`nz(d[1])`): hoisted, served, right', () => {
    const body = [
      'turn () =>',
      '    int d = na , d := close > open ? 1 : close < open ? -1 : nz(d[1])',
      '    d',
      'plot(request.security(syminfo.tickerid, "W", turn()))',
    ].join('\n')
    const { P, onChart } = periodsOf('W', false)
    let d = 0
    const perWeek = P.map((w) => { d = w.c > w.o ? 1 : w.c < w.o ? -1 : d; return d })
    expect(new Set(perWeek).size).toBeGreaterThan(1)
    sameEverywhere(run(body), onChart(perWeek), 200)
  })
})
