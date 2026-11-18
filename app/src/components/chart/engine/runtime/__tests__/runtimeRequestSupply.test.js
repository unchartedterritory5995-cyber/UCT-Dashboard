// ─── ⭐⭐ RS RATING L5 — THE RUN READS ANOTHER SYMBOL AND TIMEFRAME, ALIGNED BY THE HOST ───
//
// The per-bar lane's `request.security` (vm.js `OP.REQUEST`) is handed its bars by
// `requestSupply.js::runtimeRequestSupply`, and every rule in it is the host lane's:
//   * which symbol: the host translator's reading (`requestTargetOf`, `target` on the request);
//   * served or refused: the host bind (`otherSymbols.js::resolveOtherSymbols`);
//   * which requested bar each chart bar reads, and which are withheld:
//     `interpret.js::requestAlignment` over `tfMergeReads` / `tfMergeMask` / `symAlignmentMask`.
// Each rail below has a case that serves and one that refuses or a control.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { computeRuntimeColumns, resetRuntimeSessions, resetRuntimeLedgers } from '../runtimeColumns.js'
import { requestAlignment, tfMergeReads, tfBucket, interpret } from '../../ast/interpret.js'
import { runtimeRequestSupply, requestTargetsUnservable } from '../requestSupply.js'
import { memberPaneDefinition } from '../../../builder/memberPane/memberPaneDefinition'
import { buildRuntimeIr } from '../../ast/pineRuntimeFrontend.js'
import { lowerIrProgram } from '../lowerIr.js'

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
const barsOn = (days, base) => days.map((t, i) => {
  const c = base + i + (i % 3) * 0.5
  return { t, o: c - 0.25, h: c + 1, l: c - 1, c, v: 1000 + i }
})
const DAYS = weekdays(30)                 // Mon 2026-01-05 .. Fri 2026-02-13
const CHART = barsOn(DAYS, 100)
const SPY = barsOn(DAYS, 500)
const STORE = { SPY: 'NYSE Arca' }
const ctxOf = (over = {}) => ({
  tf: 'D', newestBarIsForming: false, historyFromListing: true,
  symbol: { ticker: 'RDDT', exchange: 'NYSE' },
  secondary: new Map([['SPY', { bars: SPY, status: 'available' }]]),
  exchangeOf: (t) => STORE[t] || null,
  ...over,
})
const doc = (body, outputs = { a: 0 }) => ({
  id: 'l5', meta: { runtimeHistory: 'listing' },
  compute: { kind: 'runtime', fn: 'runtime:l5', outputs, source: `//@version=5\nindicator("l5")\n${body}` },
})
const runDoc = (body, ctx = ctxOf(), outputs) => computeRuntimeColumns(doc(body, outputs), CHART, ctx)

describe('L5 (a) — one alignment authority, the host lane\'s', () => {
  it('a same-timeframe other symbol reads its OWN session date, never yesterday', () => {
    const { index, withheld } = requestAlignment({ chartBars: CHART, srcBars: SPY, other: 'SPY' })
    for (let i = 0; i < CHART.length; i += 1) {
      expect(index[i], `bar ${i}`).toBe(i)
      expect(withheld[i]).toBe(0)
    }
  })

  it('the run serves it: `request.security("AMEX:SPY", timeframe.period, close)` is SPY\'s close that day', () => {
    const out = runDoc('plot(request.security("AMEX:SPY", timeframe.period, close))')
    expect(Array.from(out.a)).toEqual(SPY.map((b) => b.c))
  })

  it("a `'D'` literal on a daily chart is the same read (the host folds it to the chart's own period)", () => {
    const out = runDoc('plot(request.security("AMEX:SPY", "D", close))')
    expect(Array.from(out.a)).toEqual(SPY.map((b) => b.c))
  })

  it('an expression runs in the requested symbol\'s context, with its own history', () => {
    const out = runDoc('plot(request.security("AMEX:SPY", timeframe.period, close[1] + high - low))')
    expect(out.a[0]).toBeNaN()
    for (let i = 1; i < SPY.length; i += 1) expect(out.a[i]).toBeCloseTo(SPY[i - 1].c + SPY[i].h - SPY[i].l, 9)
  })

  it('a weekly merge: the bar that closes its week reads that week, every other bar the last closed week', () => {
    const isos = CHART.map((b) => b.t)
    // every series here is Mon..Fri, so week k holds bars 5k..5k+4 and its Friday is 5k+4
    const { index, runBars } = requestAlignment({ chartBars: CHART, srcBars: CHART, code: 'W' })
    expect(runBars).toHaveLength(6)
    const at = new Map(runBars.map((w, j) => [tfBucket(w.t, 'W'), j]))
    expect(Array.from(index)).toEqual(Array.from(tfMergeReads(isos, 'W', at)))
    for (let i = 0; i < isos.length; i += 1) {
      const wk = Math.floor(i / 5)
      const fri = i % 5 === 4
      expect(index[i], `bar ${i} (${isos[i]})`).toBe(fri ? wk : wk - 1)
    }
  })

  it('⭐ the run and the host draw the SAME weekly merge on every bar both serve', () => {
    const out = runDoc('plot(request.security(syminfo.tickerid, "W", close))')
    const host = interpret({ type: 'tf_merge', value: 'W', args: [{ type: 'series', name: 'close' }] }, CHART, {}, undefined,
      undefined, { tf: 'D', newestBarIsForming: false, historyFromListing: true })
    let compared = 0
    for (let i = 0; i < CHART.length; i += 1) {
      if (Number.isNaN(host[i]) && Number.isNaN(out.a[i])) continue
      expect(out.a[i], `bar ${i}`).toBe(host[i])
      compared += 1
    }
    expect(compared).toBeGreaterThan(20)
  })

  it('the newest bar of a merge is withheld unless it certainly closes its period (2026-02-13 is a Friday: served)', () => {
    const served = runDoc('plot(request.security(syminfo.tickerid, "W", close))')
    expect(Number.isNaN(served.a[CHART.length - 1])).toBe(false)
    const thursday = CHART.slice(0, -1)
    const out = computeRuntimeColumns(doc('plot(request.security(syminfo.tickerid, "W", close))'), thursday, ctxOf())
    expect(Number.isNaN(out.a[thursday.length - 1])).toBe(true)
    expect(Number.isNaN(out.a[thursday.length - 2])).toBe(false)
  })

  it('⛔ off the listing, a partial first week refuses the run by name (its state would carry the guess)', () => {
    const fromWed = CHART.slice(2)
    expect(() => computeRuntimeColumns(doc('plot(request.security(syminfo.tickerid, "W", close))'), fromWed,
      ctxOf({ historyFromListing: false }))).toThrow(/request:htf-first-period-partial/)
  })

  it('⛔ a gap in the other series after its history began refuses the run by name', () => {
    const gapped = SPY.filter((_, i) => i !== 10)
    expect(() => runDoc('plot(request.security("AMEX:SPY", timeframe.period, close))',
      ctxOf({ secondary: new Map([['SPY', { bars: gapped, status: 'available' }]]) }))).toThrow(/no bar on 2026-01-19/)
  })
})

describe('L5 (b)(c) — the supply is the host bind\'s decision', () => {
  it('⛔ a symbol whose bars are not in hand is refused by name, never drawn as `na`', () => {
    expect(() => runDoc('plot(request.security("AMEX:SPY", timeframe.period, close))',
      ctxOf({ secondary: new Map([['SPY', { bars: [], status: 'no_data' }]]) }))).toThrow(/other-symbol:no-bars/)
  })

  it('⛔ a spelling the host refuses (venue mismatch) is refused with the host\'s code', () => {
    expect(() => runDoc('plot(request.security("NASDAQ:SPY", timeframe.period, close))'))
      .toThrow(/other-symbol:venue-mismatch/)
  })

  it('⛔ a symbol computed per bar is refused: which bars it needs is unknown before the run', () => {
    expect(() => runDoc('s = close > open ? "AMEX:SPY" : "NASDAQ:QQQ"\nplot(request.security(s, timeframe.period, close))'))
      .toThrow(/runtime:request|cannot be read before/)
  })

  it('while the other symbol is still loading, the run waits (named, never an `na` line)', () => {
    expect(() => runDoc('plot(request.security("AMEX:SPY", timeframe.period, close))',
      ctxOf({ secondary: new Map([['SPY', { bars: [], status: 'loading' }]]) }))).toThrow(/loading|waiting/)
  })

  it('that wait says it is a wait (`pending`), and a refusal does not', () => {
    const caught = (fn) => { try { fn() } catch (err) { return err } return null }
    const wait = caught(() => runDoc('plot(request.security("AMEX:SPY", timeframe.period, close))',
      ctxOf({ secondary: new Map([['SPY', { bars: [], status: 'loading' }]]) })))
    expect(wait && wait.guard).toBe('runtime:request')
    expect(wait && wait.pending).toBe(true)
    const refused = caught(() => runDoc('plot(request.security("AMEX:SPY", timeframe.period, close))',
      ctxOf({ secondary: new Map([['SPY', { bars: [], status: 'no_data' }]]) })))
    expect(refused && typeof refused.guard).toBe('string')
    expect(refused && refused.pending).toBeUndefined()
  })

  it('CONTROL: a script with no request runs exactly as before', () => {
    const out = runDoc('plot(close * 2)')
    expect(Array.from(out.a)).toEqual(CHART.map((b) => b.c * 2))
  })

  it('the supply names one entry per request site, with the host\'s target recorded', () => {
    const built = buildRuntimeIr('//@version=5\nindicator("x")\nplot(request.security("AMEX:SPY", timeframe.period, close))',
      { bars: CHART, inputs: {}, tf: 'D', basePeriod: 'D', symbol: { ticker: 'RDDT', exchange: 'NYSE' } })
    expect(built.ok, built.ok ? '' : built.refusal.message).toBe(true)
    const program = lowerIrProgram(built.ir)
    expect(program.requests[0].target).toMatchObject({ ticker: 'SPY', venue: 'AMEX', code: null })
    const sup = runtimeRequestSupply(program.requests, CHART, ctxOf())
    expect(sup.refusal).toBe(null)
    expect(sup.supply).toHaveLength(1)
    expect(Array.from(sup.supply[0].index)).toEqual(CHART.map((_, i) => i))
  })
})

describe('L5 (d) — the run half is minted when its requests are servable by the host\'s rules', () => {
  const LF = String.fromCharCode(10)
  const SRC = (req) => ['//@version=5', 'indicator("rh req", overlay = true)', `w = ${req}`, 'plot(w, "w")',
    'if barstate.islast', '    for i = 0 to 4', '        if close[i] > open[i]', '            label.new(bar_index - i, high[i], "up")'].join(LF)
  beforeEach(() => {
    vi.stubEnv('VITE_PINE_OBJECTS_ONLY_PANE_ENABLED', '1')
    vi.stubEnv('VITE_PINE_RUNTIME_PANE_ENABLED', '1')
  })
  afterEach(() => { vi.unstubAllEnvs() })

  it('an own-symbol weekly merge: minted', () => {
    const d = memberPaneDefinition({ source: SRC('request.security(syminfo.tickerid, "W", close)'), id: 'u_l5rh1', name: 'm' })
    expect(d.ok, d.reason).toBe(true)
    expect(d.runHalfDeclined).toBeUndefined()
    expect(d.definition.compute.runtimeObjects).toBeTruthy()
  })

  it('another symbol at the chart\'s own timeframe: minted (the bind serves it per chart)', () => {
    const d = memberPaneDefinition({ source: SRC('request.security("AMEX:SPY", timeframe.period, close)'), id: 'u_l5rh2', name: 'm' })
    expect(d.ok, d.reason).toBe(true)
    expect(d.runHalfDeclined).toBeUndefined()
    expect(d.definition.compute.runtimeObjects).toBeTruthy()
  })

  it('⛔ CONTROL: a request the host cannot read (a computed symbol) still declines runtime:request', () => {
    const d = memberPaneDefinition({ source: SRC('request.security(close > open ? "AMEX:SPY" : "NASDAQ:QQQ", timeframe.period, close)'), id: 'u_l5rh3', name: 'm' })
    if (d.runHalfDeclined) expect(d.runHalfDeclined.code).not.toBe(undefined)
    expect(d.definition ? d.definition.compute.runtimeObjects : undefined).toBeUndefined()
  })
})

describe('L5 (d) — requestTargetsUnservable, the door\'s static half of the supply\'s rules', () => {
  it('serves own merges and other symbols; refuses an unread, a look-ahead and an unmerged timeframe', () => {
    expect(requestTargetsUnservable([{ own: true, ticker: null, venue: null, code: 'W', live: false }], 1)).toBe(null)
    expect(requestTargetsUnservable([{ own: false, ticker: 'SPY', venue: 'AMEX', code: null, live: false }], 1)).toBe(null)
    expect(requestTargetsUnservable([null], 1)).toMatch(/cannot be read before/)
    // ⭐ REQ — look-ahead at a weekly / monthly period is served (`vw-request-htf-alignment-spy-1d`);
    // look-ahead at any other code keeps its refusal, by name
    expect(requestTargetsUnservable([{ own: true, ticker: null, venue: null, code: 'W', live: true }], 1)).toBe(null)
    expect(requestTargetsUnservable([{ own: true, ticker: null, venue: null, code: 'M', live: true }], 1)).toBe(null)
    expect(requestTargetsUnservable([{ own: true, ticker: null, venue: null, code: '3M', live: true }], 1)).toMatch(/looks ahead/)
    expect(requestTargetsUnservable([{ own: true, ticker: null, venue: null, code: '3M', live: false }], 1)).toMatch(/weekly or monthly/)
    expect(requestTargetsUnservable([], 1)).toMatch(/not recorded/)
  })
})

describe('L5 — `lookahead = barmerge.lookahead_off` written out is the default merge', () => {
  it('served exactly as the call without it', () => {
    const plain = runDoc('plot(request.security("AMEX:SPY", timeframe.period, close))')
    const off = runDoc('plot(request.security("AMEX:SPY", timeframe.period, close, lookahead = barmerge.lookahead_off))')
    expect(Array.from(off.a)).toEqual(Array.from(plain.a))
    const wOff = runDoc('plot(request.security(syminfo.tickerid, "W", close, lookahead = barmerge.lookahead_off))')
    const w = runDoc('plot(request.security(syminfo.tickerid, "W", close))')
    expect(Array.from(wOff.a)).toEqual(Array.from(w.a))
  })

  // ⭐⭐ REQ (coverage unit, 2026-11-16) — `lookahead = barmerge.lookahead_on` at a weekly / monthly period
  // reads the period each bar is INSIDE (`interpret.js::tfLiveReads`), the reading TradingView was captured
  // giving (`vw-request-htf-alignment-spy-1d-2026-10-02` A01 / A04, `vendorHarness.reqLookaheadAlignment`).
  // ⚰️ It was refused here whatever the period ("the realtime half of that alignment is not measured yet").
  it('`lookahead = barmerge.lookahead_on` at "W" reads the week each bar is inside: the last close of that week', () => {
    const on = runDoc('plot(request.security(syminfo.tickerid, "W", close, lookahead = barmerge.lookahead_on))')
    const lastOfWeek = new Map()
    for (const b of CHART) lastOfWeek.set(tfBucket(b.t, 'W'), b.c)
    expect(Array.from(on.a)).toEqual(CHART.map((b) => lastOfWeek.get(tfBucket(b.t, 'W'))))
    const off = runDoc('plot(request.security(syminfo.tickerid, "W", close))')
    expect(Array.from(on.a)).not.toEqual(Array.from(off.a))
  })
  it('⛔ the newest bar, still FORMING, is withheld by name (no capture shows that bar); every finished bar is drawn', () => {
    const body = 'plot(request.security(syminfo.tickerid, "W", close, lookahead = barmerge.lookahead_on))'
    const finished = Array.from(runDoc(body).a)
    const forming = Array.from(runDoc(body, ctxOf({ newestBarIsForming: true })).a)
    expect(Number.isNaN(forming[forming.length - 1])).toBe(true)
    expect(forming.slice(0, -1)).toEqual(finished.slice(0, -1))
    expect(Number.isFinite(finished[finished.length - 1])).toBe(true)
  })
  it('⛔ CONTROL: a run with no warm-up curtain whose first week is partial refuses by that name', () => {
    // a document with no `listing` history is run as it is (no `computeOffListing` curtain); its chart
    // begins on a TUESDAY, so the first week's bar would be built from part of the week
    const body = 'plot(request.security(syminfo.tickerid, "W", close, lookahead = barmerge.lookahead_on))'
    const bare = { ...doc(body), meta: {} }
    expect(() => computeRuntimeColumns(bare, CHART.slice(1), ctxOf({ historyFromListing: false })))
      .toThrow(/request:htf-lookahead-first-period-partial/)
    // and the same chart begun on the Monday is served
    expect(() => computeRuntimeColumns(bare, CHART, ctxOf({ historyFromListing: false }))).not.toThrow()
  })
  it('⛔ CONTROL: a look-ahead spelling the host cannot read keeps its refusal', () => {
    expect(() => runDoc('la = input.bool(true)\nplot(request.security(syminfo.tickerid, "W", close, lookahead = la))'))
      .toThrow(/lookahead/)
  })
})

describe('L5 — a request inside a call\'s arguments is the run\'s request, never a starved column', () => {
  it('`nz(request.security("AMEX:SPY", timeframe.period, close), -1)` reads SPY, as the bare call does', () => {
    const out = runDoc('plot(nz(request.security("AMEX:SPY", timeframe.period, close), -1))')
    expect(Array.from(out.a)).toEqual(SPY.map((b) => b.c))
  })
  it('⛔ and with SPY\'s bars not in hand it is refused by name, never drawn as -1 on every bar', () => {
    expect(() => runDoc('plot(nz(request.security("AMEX:SPY", timeframe.period, close), -1))',
      ctxOf({ secondary: new Map([['SPY', { bars: [], status: 'no_data' }]]) }))).toThrow(/other-symbol:no-bars/)
  })
})

// ─── ⭐ RS RATING L8 (4b) — THE CHART'S OWN SYMBOL IS THE REQUEST'S SYMBOL, AT ANY TIMEFRAME ───
// Peer report (engine-57 builder): `request.security(syminfo.tickerid, <tf>, close)` at a timeframe
// the host does not read (a daily read on a weekly chart, RS Rating line 187 `'D'` there; a daily
// read on an intraday chart) refused `interpret:bind-time-text` on `syminfo.tickerid`: the symbol
// was lowered as TEXT because the host had no reading of the request, so a binding that does not
// witness the exchange's `tickerid` spelling refused the symbol instead of the timeframe. The
// chart's own symbol needs no text: it is the chart's own series at that timeframe. The read
// itself is still not served (no lane reads a timeframe below a weekly chart, or a daily read on
// an intraday chart, bar by bar), so it is refused by THAT name, never drawn.
describe('L8 (4b) — the chart\'s own symbol at a timeframe the host does not read', () => {
  const SELF = (tf, expr = 'close') => `plot(request.security(syminfo.tickerid, "${tf}", ${expr}))`
  // ⭐ RS RATING L11 (Q-RS7 R3) — a bare `close` at "D" on a WEEKLY chart is now served (the weekly close is
  // the week's last daily close: `pine.js::dailyOnWeeklyTargetOf`, railed in `rsWeeklyWitness.test.js`), so the
  // weekly case of this rail reads another expression, which keeps the refusal by the timeframe.
  for (const [chartTf, asked, expr] of [['W', 'D', 'open'], ['60', 'D', 'close']]) {
    it(`a \`"${asked}"\` read (\`${expr}\`) on a \`${chartTf}\` chart refuses by the TIMEFRAME, never by the symbol's text`, () => {
      let err = null
      try { runDoc(SELF(asked, expr), ctxOf({ tf: chartTf })) } catch (e) { err = e }
      expect(err, 'the read is not served on this chart').toBeTruthy()
      expect(String(err.message)).not.toMatch(/syminfo\.tickerid|bind-time-text/)
      expect(err.guard || String(err.message)).toMatch(/runtime:request/)
      expect(String(err.message)).toContain(`\`${asked}\``)
    })
  }

  it('L11 R3: a bare `close` at "D" on a weekly chart IS the chart\'s own close (served, no request site)', () => {
    const built = buildRuntimeIr(`//@version=5\nindicator("x")\n${SELF('D')}`,
      { bars: CHART, inputs: {}, tf: 'W', basePeriod: 'W', symbol: { ticker: 'RDDT', exchange: 'NYSE' } })
    expect(built.ok, built.ok ? '' : built.refusal.message).toBe(true)
    expect(lowerIrProgram(built.ir).requests).toEqual([])
    const out = runDoc(SELF('D'), ctxOf({ tf: 'W' }))
    expect(Array.from(out.a)).toEqual(CHART.map((b) => b.c))
  })

  it('the door records the read as the chart\'s own, unread by the host (a static refusal names the timeframe)', () => {
    const built = buildRuntimeIr(`//@version=5\nindicator("x")\n${SELF('D', 'open')}`,
      { bars: CHART, inputs: {}, tf: 'W', basePeriod: 'W', symbol: { ticker: 'RDDT', exchange: 'NYSE' } })
    expect(built.ok, built.ok ? '' : built.refusal.message).toBe(true)
    const program = lowerIrProgram(built.ir)
    expect(program.requests[0].target).toMatchObject({ own: true, ticker: null, unread: true })
    expect(requestTargetsUnservable(program.requests.map((r) => r.target), 1)).toMatch(/`D`/)
  })

  it('⛔ CONTROL: another symbol at that timeframe is not the chart\'s own: a daily read below the chart, refused by name for a listing', () => {
    const built = buildRuntimeIr('//@version=5\nindicator("x")\nplot(request.security("AMEX:SPY", "D", close))',
      { bars: CHART, inputs: {}, tf: 'W', basePeriod: 'W', symbol: { ticker: 'RDDT', exchange: 'NYSE' } })
    expect(built.ok, built.ok ? '' : built.refusal.message).toBe(true)
    // ⭐ RS RATING L11 — the host reads it as another symbol's daily read below the chart (`below`), never as
    // the chart's own; the supply serves that only for a witnessed spelling (SP:SPX, the RS seed)
    expect(lowerIrProgram(built.ir).requests[0].target).toMatchObject({ own: false, ticker: 'SPY', code: 'D', below: true })
    expect(() => runDoc('plot(request.security("AMEX:SPY", "D", close))', ctxOf({ tf: 'W' })))
      .toThrow(/other-symbol:witness-timeframe — `SPY` is read at `"D"` below this `W` chart/)
  })

  it('⛔ an own read the host DECLINES for another reason (`gaps_on` on a merge) is never served as the merge', () => {
    const body = 'plot(request.security(syminfo.tickerid, "W", close, gaps = barmerge.gaps_on))'
    const built = buildRuntimeIr(`//@version=5\nindicator("x")\n${body}`,
      { bars: CHART, inputs: {}, tf: 'D', basePeriod: 'D', symbol: { ticker: 'RDDT', exchange: 'NYSE' } })
    expect(built.ok, built.ok ? '' : built.refusal.message).toBe(true)
    const target = lowerIrProgram(built.ir).requests[0].target
    expect(target).toMatchObject({ own: true, unread: true, code: 'W' })
    expect(requestTargetsUnservable([target], 1), 'the door does not mint it either').toMatch(/does not read either/)
    expect(() => runDoc(body)).toThrow(/host lane does not read either/)
  })

  it('CONTROL: the weekly merge on a daily chart is served exactly as before', () => {
    const out = runDoc(SELF('W'))
    expect(Number.isNaN(out.a[CHART.length - 1])).toBe(false)
  })
})
