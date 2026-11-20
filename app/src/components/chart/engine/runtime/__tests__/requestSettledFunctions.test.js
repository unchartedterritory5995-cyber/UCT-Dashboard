// app/src/components/chart/engine/runtime/__tests__/requestSettledFunctions.test.js
//
// ─── ⭐⭐ (request unit PR 2, NUMBER PENDING) — A REQUEST'S TIMEFRAME WRITTEN AS A CALL TO THE SCRIPT'S OWN FUNCTION ───
//
// The runtime lane's resolver environment holds pure expression bindings and no user function, so a timeframe written
// as a call was unreadable there and the request refused (`runtime:request`, `lookahead`):
//   * Saty ATR Levels: `request.security(ticker, timeframe_func(), …)`, where `timeframe_func()` is `timeframe = 'D'`
//     then an `if` / `else if` / `else` chain of `timeframe := '<text>'` over an input string;
//   * TehThomas aligned-timeframe FVGs: `alignedTF = getAlignedTimeframe()` (`string result = ""`, a chain over
//     `timeframe.in_seconds()`, then `result`), and the request reads `alignedTF`.
// The runtime lane now hands the request reader its kept function bodies (`pine.js::settledRequestFunctionOf`: an
// expression body, or that one statement shape; anything else refused by name). Pine returns a function's last value
// and an `if` takes the arm whose test holds, so a call that settles IS the text it settles to: each rail compares the
// call with the same request WRITTEN with that text (derived, never restated), on the runtime lane's own run.
// ⭐ EXT-OWN: `ticker.new(syminfo.prefix, syminfo.ticker, session.extended)` at the chart's own "D" on a daily chart is
// the chart's own daily bars (Saty's ticker), and nothing wider.
// ⛔ Both are the runtime lane's alone: the plot lane is held byte-identical over the corpus by
// `requestTimeframeReader.test.js` (every runtime-lane reader stubbed out, same bytes), and refuses each shape here.

import { describe, it, expect, beforeEach } from 'vitest'
import { computeRuntimeColumns, probeRuntimeProgram, resetRuntimeSessions, resetRuntimeLedgers } from '../runtimeColumns.js'
import { translatePine, Resolver } from '../../ast/pine.js'
import { buildRuntimeIr } from '../../ast/pineRuntimeFrontend.js'

beforeEach(() => { resetRuntimeSessions(); resetRuntimeLedgers() })

const LF = String.fromCharCode(10)

/** Weekday ISO dates from `from` (a Monday), `n` sessions: several weeks and months. */
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
const CHART = weekdays(70).map((t, i) => {
  const c = 100 + i + (i % 3) * 0.5 - (i % 7) * 0.25
  return { t, o: c - 0.25, h: c + 1 + (i % 4) * 0.1, l: c - 1 - (i % 5) * 0.1, c, v: 1000 + i }
})
const ctx = { tf: 'D', newestBarIsForming: false, historyFromListing: true, symbol: { ticker: 'RDDT', exchange: 'NYSE' } }
const docOf = (source, outputs = { a: 0 }) => ({
  id: 'tf-settled', meta: { runtimeHistory: 'listing' }, compute: { kind: 'runtime', fn: 'runtime:tf-settled', outputs, source },
})
const run = (source, outputs) => {
  resetRuntimeSessions()
  const out = computeRuntimeColumns(docOf(source, outputs), CHART, ctx)
  return Object.fromEntries(Object.entries(out).map(([k, v]) => [k, Array.from(v)]))
}
const probe = (source) => probeRuntimeProgram(source)
const codes = (p) => (p.requestTargets || []).map((t) => t && t.code)
/** The plot lane's own answer (the host translator, as the member door asks it). */
const plotLane = (source) => translatePine(source, { strict: true, paramManifest: true })
const refusedGuards = (t) => (t.refusals || []).map((r) => r.guard)

// ── the Saty shape: a no-argument function settling its result in an `if` chain over an input string ──────────────
const fnSource = (def, tfExpr = 'tf_func()') => [
  '//@version=5',
  'indicator("tf fn", overlay=true)',
  `tt = input.string("${def}", "Trading Type", options=["Day", "Multiday", "Swing"])`,
  'tf_func() =>',
  "    timeframe = 'D'",
  '    if tt == "Day"',
  "        timeframe := 'D'",
  '    else if tt == "Multiday"',
  "        timeframe := 'W'",
  '    else if tt == "Swing"',
  "        timeframe := 'M'",
  '    else',
  "        timeframe := 'D'",
  `pc = request.security(syminfo.tickerid, ${tfExpr}, close[1], gaps=barmerge.gaps_off, lookahead=barmerge.lookahead_on)`,
  'plot(pc)',
].join(LF)

// ── the TehThomas shape: typed, over the chart's own timeframe, ending in the name, read through a top-level name ────
const alignedSource = (tfExpr = 'alignedTF', extra = []) => [
  '//@version=6',
  'indicator("tf aligned", overlay=true)',
  'getAlignedTimeframe() =>',
  '    string result = ""',
  '    if timeframe.in_seconds() <= 3600  // <= 1 hour',
  '        result := "D"',
  '    else if timeframe.in_seconds() <= 14400',
  '        result := "W"',
  '    else',
  '        result := "M"',
  '    result',
  'alignedTF = getAlignedTimeframe()',
  ...extra,
  `[lo, hi] = request.security(syminfo.tickerid, ${tfExpr}, [low[1], high[1]], lookahead=barmerge.lookahead_on)`,
  'plot(lo)',
  'plot(hi)',
].join(LF)

describe('a request timeframe written as a call to the script\'s own function (Saty ATR Levels)', () => {
  for (const [def, code] of [['Day', "'D'"], ['Multiday', "'W'"], ['Swing', "'M'"]]) {
    it(`input "${def}": the call reads what ${code} written out reads`, () => {
      const p = probe(fnSource(def))
      expect(p.ok, JSON.stringify(p.refusal)).toBe(true)
      expect(run(fnSource(def)).a).toEqual(run(fnSource(def, code)).a)
    })
  }
  it('the arms are distinct reads (the rail can tell the function\'s answers apart)', () => {
    const d = run(fnSource('Day')).a
    const w = run(fnSource('Multiday')).a
    const m = run(fnSource('Swing')).a
    expect(d).not.toEqual(w)
    expect(w).not.toEqual(m)
    expect(codes(probe(fnSource('Multiday')))).toEqual(['W'])
  })
  it('an expression body, and one called with a constant argument, read as their text written out', () => {
    const src = (arg, tfExpr = `tf_of(${arg})`) => [
      '//@version=5', 'indicator("arg", overlay=true)',
      'tf_of(int k) =>', "    k == 1 ? 'W' : 'M'",
      `pc = request.security(syminfo.tickerid, ${tfExpr}, close[1], lookahead=barmerge.lookahead_on)`, 'plot(pc)',
    ].join(LF)
    expect(run(src(1)).a).toEqual(run(src(1, "'W'")).a)
    expect(run(src(2)).a).toEqual(run(src(2, "'M'")).a)
    expect(run(src(1)).a).not.toEqual(run(src(2)).a)
  })
  it('⛔ the plot lane reads no call: the script refuses there as it did (and the text written out does not)', () => {
    expect(refusedGuards(plotLane(fnSource('Multiday')))).toContain('pine:request')
    expect(refusedGuards(plotLane(fnSource('Multiday', "'W'")))).not.toContain('pine:request')
  })
  it('⛔ CONTROL: the reader is the live path (stubbed out, the call is refused again)', () => {
    const orig = Resolver.prototype.throughSettledCall
    Resolver.prototype.throughSettledCall = function () { return null }
    try { expect(probe(fnSource('Multiday')).ok).toBe(false) } finally { Resolver.prototype.throughSettledCall = orig }
  })
})

describe('a request timeframe read through a name bound once to such a call (TehThomas aligned-timeframe FVGs)', () => {
  it('on a daily chart `getAlignedTimeframe()` is "M": `alignedTF` reads what `"M"` written out reads', () => {
    const folded = run(alignedSource(), { a: 0, b: 1 })
    expect(folded).toEqual(run(alignedSource('"M"'), { a: 0, b: 1 }))
    expect(folded.a).not.toEqual(run(alignedSource('"W"'), { a: 0, b: 1 }).a)
    expect(codes(probe(alignedSource()))).toEqual(['M'])
  })
  it('the call written in the request reads the same', () => {
    expect(run(alignedSource('getAlignedTimeframe()'), { a: 0, b: 1 })).toEqual(run(alignedSource('"M"'), { a: 0, b: 1 }))
  })
  it('⛔ CONTROL: a name the script reassigns is not that call, and stays refused', () => {
    const p = probe(alignedSource('alignedTF', ['if close > open', '    alignedTF := "W"']))
    expect(p.ok).toBe(false)
  })
  it('⛔ CONTROL: a frame that declares the same name shadows it (never read as the top-level call)', () => {
    // `g(alignedTF)`'s own parameter is the caller's "W", held in the frame: never the top-level call's "M"
    const src = alignedSource('alignedTF', ['g(alignedTF) =>', '    request.security(syminfo.tickerid, alignedTF, close[1], lookahead=barmerge.lookahead_on)', 'plot(g("W"))'])
    const p = probe(src)
    expect(p.ok && codes(p).filter((c) => c === 'M').length > 1).toBe(false)
    // and its refusal does not blame the top-level call
    if (!p.ok) expect(String(p.refusal.message)).not.toContain('getAlignedTimeframe')
  })
  it('⛔ CONTROL: the name reader is the live path (stubbed out, `alignedTF` is refused again)', () => {
    const orig = Resolver.prototype.settledAliasOf
    Resolver.prototype.settledAliasOf = function () { return null }
    try { expect(probe(alignedSource()).ok).toBe(false) } finally { Resolver.prototype.settledAliasOf = orig }
  })
})

describe('⛔ anything else is refused, and the refusal names the function and why', () => {
  const refusalOf = (src) => {
    const p = probe(src)
    expect(p.ok).toBe(false)
    expect(p.refusal.guard).toMatch(/^runtime:request|^pine:request/)
    return String(p.refusal.message || '')
  }
  it('a test that varies per bar: not fixed before the first bar', () => {
    const msg = refusalOf(fnSource('Multiday').replace('if tt == "Day"', 'if close > open'))
    expect(msg).toContain('`tf_func()`')
    expect(msg).toContain('not fixed before the first bar')
  })
  it('a per-bar argument: not fixed before the first bar', () => {
    const msg = refusalOf([
      '//@version=5', 'indicator("arg", overlay=true)',
      'tf_of(int k) =>', "    k == 1 ? 'W' : 'M'",
      'pc = request.security(syminfo.tickerid, tf_of(bar_index % 2), close[1], lookahead=barmerge.lookahead_on)', 'plot(pc)',
    ].join(LF))
    expect(msg).toContain('`tf_of()`')
  })
  const shapes = [
    ['a chain with no `else`', (s) => s.replace(`    else${LF}        timeframe := 'D'${LF}`, ''), 'has no `else`'],
    ['an arm of two statements', (s) => s.replace(`        timeframe := 'W'${LF}`, `        timeframe := 'W'${LF}        timeframe := 'M'${LF}`),
      'is not the one statement'],
    ['an arm writing something other than text', (s) => s.replace("timeframe := 'W'", 'timeframe := tt'), 'other than text'],
    ['a first line that is not text', (s) => s.replace("    timeframe = 'D'", '    timeframe = tt'), 'does not start as text'],
    ['more after the chain', (s) => s.replace(`        timeframe := 'D'${LF}pc =`, `        timeframe := 'D'${LF}    timeframe${LF}    timeframe${LF}pc =`),
      'more follows'],
  ]
  for (const [what, edit, why] of shapes) {
    it(`${what}: refused, named`, () => {
      const src = edit(fnSource('Multiday'))
      expect(src).not.toBe(fnSource('Multiday'))
      const msg = refusalOf(src)
      expect(msg).toContain('`tf_func()`')
      expect(msg).toContain(why)
    })
  }
})

// ── EXT-OWN: the chart's own symbol on the extended session, at the chart's own daily timeframe, on a daily chart ──
const extSource = (tickerExpr, tf = "'D'") => [
  '//@version=5',
  'indicator("ext own", overlay=true)',
  `tk = ${tickerExpr}`,
  `pc = request.security(tk, ${tf}, close[1], gaps=barmerge.gaps_off, lookahead=barmerge.lookahead_on)`,
  `hi = request.security(tk, ${tf}, high, gaps=barmerge.gaps_off, lookahead=barmerge.lookahead_on)`,
  'plot(pc)',
  'plot(hi)',
].join(LF)
const EXT = 'ticker.new(syminfo.prefix, syminfo.ticker, session=session.extended)'

describe('EXT-OWN: `ticker.new(syminfo.prefix, syminfo.ticker, session.extended)` at "D" on a daily chart (Saty ATR Levels)', () => {
  it('reads the chart\'s own daily bars: exactly what `syminfo.tickerid` reads', () => {
    const ext = run(extSource(EXT), { a: 0, b: 1 })
    const own = run(extSource('syminfo.tickerid'), { a: 0, b: 1 })
    expect(ext).toEqual(own)
    for (let i = 1; i < CHART.length; i += 1) expect(ext.a[i]).toBe(CHART[i - 1].c)
    expect(ext.b).toEqual(CHART.map((b) => b.h))
  })
  it('also through `timeframe.period`, and through the Saty function\'s "D"', () => {
    expect(run(extSource(EXT, 'timeframe.period'), { a: 0, b: 1 })).toEqual(run(extSource('syminfo.tickerid'), { a: 0, b: 1 }))
    const saty = fnSource('Day').replace('request.security(syminfo.tickerid,', `request.security(${EXT},`)
    expect(probe(saty).ok).toBe(true)
    expect(run(saty).a).toEqual(run(fnSource('Day')).a)
  })
  it('⛔ CONTROL: at "W" on a daily chart it stays refused (no capture reads an extended weekly series)', () => {
    expect(probe(extSource(EXT, "'W'")).ok).toBe(false)
    // and the regular spelling at "W" is served, so the refusal is the session's
    expect(probe(extSource('syminfo.tickerid', "'W'")).ok).toBe(true)
  })
  it('⛔ CONTROL: a literal prefix, a ticker other than the chart\'s, or an extra argument is not this spelling', () => {
    for (const t of [
      'ticker.new("NYSE", syminfo.ticker, session=session.extended)',
      'ticker.new(syminfo.prefix, "SPY", session=session.extended)',
      'ticker.new(syminfo.prefix, syminfo.ticker, session=session.extended, adjustment=adjustment.none)',
    ]) {
      const p = probe(extSource(t))
      const served = p.ok && (p.requestTargets || []).length === 0
      expect(served, t).toBe(false)
    }
  })
  it('⛔ CONTROL: on an intraday chart it stays refused (the extended series has bars the regular one does not)', () => {
    const own5 = (tickerExpr) => buildRuntimeIr(['//@version=5', 'indicator("ext 5m own", overlay=true)', `tk = ${tickerExpr}`,
      'plot(request.security(tk, timeframe.period, close))'].join(LF), { bars: [], inputs: {}, pane: true, symbolAtBind: true, basePeriod: '5' })
    const reg5 = own5('syminfo.tickerid')
    expect(reg5.ok).toBe(true)
    expect((reg5.ir.requests || []).length).toBe(0)
    const ext5 = own5(EXT)
    expect(ext5.ok && (ext5.ir.requests || []).length === 0).toBe(false)
  })
  it('⛔ CONTROL: the reader is the live path (stubbed out, the extended ticker is refused again)', () => {
    const orig = Resolver.prototype.extendedOwnTickerOf
    Resolver.prototype.extendedOwnTickerOf = function () { return false }
    try { expect(probe(extSource(EXT)).ok).toBe(false) } finally { Resolver.prototype.extendedOwnTickerOf = orig }
  })
  it('⛔ the plot lane keeps its refusal of the extended session', () => {
    expect(refusedGuards(plotLane(extSource(EXT)))).toContain('pine:request')
  })
})
