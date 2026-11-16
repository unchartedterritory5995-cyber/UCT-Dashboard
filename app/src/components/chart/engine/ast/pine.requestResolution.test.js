import { describe, it, expect } from 'vitest'
import { translatePine } from './pine.js'
import { buildRuntimeIr } from './pineRuntimeFrontend.js'

// ─── ⭐⭐ REQ (coverage unit `request.security`, 2026-11-16) — REQUESTS THE HOST CAN RESOLVE BEFORE BAR 0 ──
//
// Each shape below names one symbol or one timeframe that is known before the first bar — a `simple` /
// `input` value by Pine's own definition — and was refused "could not be resolved to one symbol and one
// servable timeframe". Each is read only as far as the reference sentence quoted beside it, and each has a
// CONTROL that stays refused, so the rail cannot pass by reading everything.
//   * an empty symbol: `request.security`, `symbol`: "Use an empty string or `syminfo.tickerid` to request
//     data using the chart's symbol";
//   * `ticker.modify(<symbol>)` with nothing modified: "If session is not given, then `syminfo.session` value
//     is used", "If adjustment is not given, then default adjustment value is used";
//   * a `session` / `gaps` / `lookahead` CONSTANT written through a plain binding is that constant.
// The served trees are the existing `sym` / identity / `tf_merge` nodes, whose readings are witnessed
// (`vw-other-symbol-rddt-1d-2026-09-30` O02 / O03; engine 55's merge captures).

const src = (body, v = 5) => `//@version=${v}\n${v >= 5 ? 'indicator' : 'study'}("t")\n${body}\n`
const treeOf = (out) => {
  expect(out.refusal, out.refusal && out.refusal.message).toBe(null)
  const first = out.outputs.find((o) => o.refusal === null)
  expect(first, `no output translated: ${JSON.stringify(out.outputs.map((o) => o.refusal && o.refusal.message))}`).toBeTruthy()
  return first.ast
}
const refusedAt = (out) => {
  const o = out.outputs.find((x) => x.refusal) || {}
  return (o.refusal || out.refusal || {}).guard
}
const CLOSE = { type: 'series', name: 'close' }

describe('REQ (a) — the symbol, known before bar 0', () => {
  it('⭐ an empty symbol is the chart\'s own: the identity', () => {
    expect(treeOf(translatePine(src("plot(request.security('', timeframe.period, close))")))).toEqual(CLOSE)
    expect(treeOf(translatePine(src("s = input.symbol('')\nplot(request.security(s, timeframe.period, close))")))).toEqual(CLOSE)
  })

  it('⭐ `ticker.modify(<symbol>)` with nothing modified is that symbol', () => {
    expect(treeOf(translatePine(src("plot(request.security(ticker.modify(input.symbol('SPY')), timeframe.period, close))"))))
      .toEqual({ type: 'sym', value: 'SPY', args: [CLOSE] })
    expect(treeOf(translatePine(src("plot(request.security(ticker.modify(syminfo.tickerid), timeframe.period, close))"))))
      .toEqual(CLOSE)
  })

  it('⛔ CONTROL: `ticker.modify` that modifies (a session, an adjustment) stays refused', () => {
    expect(refusedAt(translatePine(src(
      "plot(request.security(ticker.modify(syminfo.tickerid, session.extended), timeframe.period, close))")))).toBe('pine:request')
    expect(refusedAt(translatePine(src(
      "plot(request.security(ticker.modify('SPY', adjustment = adjustment.dividends), timeframe.period, close))")))).toBe('pine:request')
  })

  it('⛔ a v3 / v4 `input(…, type = …)` is its own declaration, never read as a symbol here', () => {
    // measured: reading `type = input.symbol` sent pmax-explorer's twenty symbol inputs into twenty
    // per-symbol requests and moved its PMax plot MATCH -> DIVERGE on the production lane
    expect(refusedAt(translatePine(src("s = input('SPY', type = input.symbol)\nplot(security(s, timeframe.period, close))", 4))))
      .toBe('pine:request')
    expect(refusedAt(translatePine(src("s = input('SPY', type = input.resolution)\nplot(security(s, timeframe.period, close))", 4))))
      .toBe('pine:request')
  })
})

describe('REQ (a) — constants written through a plain binding', () => {
  it('⭐ `session = isess` with `isess = session.regular` is the regular session', () => {
    expect(treeOf(translatePine(src(
      "isess = session.regular\nt = tickerid(syminfo.prefix, syminfo.ticker, session = isess)\nplot(security(t, 'W', close))", 4))).type)
      .toBe('tf_merge')
  })

  it('⛔ CONTROL: `isess = session.extended` stays refused (another series)', () => {
    expect(refusedAt(translatePine(src(
      "isess = session.extended\nt = tickerid(syminfo.prefix, syminfo.ticker, session = isess)\nplot(security(t, 'W', close))", 4))))
      .toBe('pine:request')
  })

  it('⭐ `lookahead = la` with `la = barmerge.lookahead_on` is look-ahead on (`tf_live`)', () => {
    expect(treeOf(translatePine(src(
      "la = barmerge.lookahead_on\nplot(request.security(syminfo.tickerid, 'W', close, lookahead = la))"))).type).toBe('tf_live')
  })

  it('⛔ CONTROL: a `barmerge.gaps_*` constant in the `lookahead` slot is not read (Q-REQ2)', () => {
    expect(refusedAt(translatePine(src(
      "la = barmerge.gaps_on\nplot(request.security(syminfo.tickerid, 'W', close, lookahead = la))")))).toBe('pine:request')
  })
})

describe('REQ (b) — a v1-v4 bare `security(…)` over state stays refused until a capture witnesses it (Q-REQ4)', () => {
  const head = (v) => `//@version=${v}\nstudy("t")\n`
  it('⛔ at the chart\'s own period, a value that reads this run\'s own state is refused by name', () => {
    const body = 'x = 0.0\nx := nz(x[1]) + 1\nr = security(tickerid, period, sma(x, 3))\nplot(r)\n'
    const r = buildRuntimeIr(`${head(3)}${body}`, { bars: [], inputs: {} })
    expect(r.ok).toBe(false)
    expect(r.refusal.guard).toBe('runtime:request-with-state')
  })

  it('⛔ and at another period too', () => {
    const body = 'x = 0.0\nx := nz(x[1]) + 1\nr = security(tickerid, "W", x)\nplot(r)\n'
    const r = buildRuntimeIr(`${head(4)}${body}`, { bars: [], inputs: {} })
    expect(r.ok).toBe(false)
    expect(r.refusal.guard).toBe('runtime:request-with-state')
  })
})
