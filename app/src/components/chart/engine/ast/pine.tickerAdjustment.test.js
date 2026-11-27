// app/src/components/chart/engine/ast/pine.tickerAdjustment.test.js
//
// ─── ⭐⭐ e97 U4 — A TICKER'S `adjustment` IS HONOURED, NEVER IGNORED ─────────────────────────────────────────
//
// ⚰️ `tickerCallArg` read a `ticker.new` / `tickerid` call's session and venue and never its `adjustment`, so
// `ticker.new(syminfo.prefix, syminfo.ticker, session.regular, adjustment.dividends)` folded onto the plain symbol:
// a real and DIFFERENT number on every bar before an ex-dividend date, served without a word.
//
// ⭐ MEASURED BASIS (2026-11-25, the store's daily bars against TradingView 1D captures): our bars are
// SPLIT-ADJUSTED and NOT dividend-adjusted, TradingView's default for a stock (ratio 1.0000 across AAPL 2020-08-31
// 4:1, NVDA 2024-06-10 10:1 and 2021-07-20 4:1, and across SPY's and AAPL's 2025 ex-dividend dates; SPY's yearly
// median ratio 1.0000 back to 1996). So `adjustment.splits` is the identity; `adjustment.dividends` and
// `adjustment.none` are refused BY NAME; a spelling this door cannot read is refused too.
// ⛔ DECIDED, NOT MISSED: `backadjustment` / `settlement_as_close` are futures-only. On a US stock TradingView
// applies neither, and a futures symbol is refused as a foreign venue, so they are not read (a case below).

import { describe, it, expect } from 'vitest'

import { translatePine } from './pine.js'

const src = (body, v = 6) => (v >= 5
  ? `//@version=${v}\nindicator("t")\n${body}\n`
  : `//@version=${v}\nstudy("t")\n${body}\n`)

/** Each output's tree, or `{refused, message}` (the member door's translation: `strict`). */
function outputsOf(body, v = 6) {
  const t = translatePine(src(body, v), { basePeriod: 'D', strict: true })
  return t.outputs.map((o) => (o.refusal ? { refused: o.refusal.guard, message: o.refusal.message } : o.ast))
}
const req = (sym, tf = '"D"') => `plot(request.security(${sym}, ${tf}, close))`
const OWN = 'ticker.new(syminfo.prefix, syminfo.ticker, session.regular'

describe('e97 U4 — adjustment.splits is the series our bars are: served as the bare request', () => {
  const bare = outputsOf(req('syminfo.tickerid'))
  it('the bare request itself is served (the comparison is not vacuous)', () => {
    expect(bare[0].refused).toBeUndefined()
  })
  it.each([
    ['ticker.new, positional', `${OWN}, adjustment.splits)`],
    ['ticker.new, named', `${OWN}, adjustment = adjustment.splits)`],
    ['ticker.new, no adjustment written (the default)', `${OWN})`],
    ['ticker.modify, named', 'ticker.modify(syminfo.tickerid, adjustment = adjustment.splits)'],
  ])('%s', (_, sym) => {
    expect(outputsOf(req(sym))).toEqual(bare)
  })
  it('through a plain binding', () => {
    expect(outputsOf(`adj = adjustment.splits\nt = ${OWN}, adjustment = adj)\n${req('t')}`)).toEqual(bare)
  })
  it('v4 `tickerid(prefix, ticker, session, adjustment)`', () => {
    const v4bare = outputsOf('plot(security(tickerid, "D", close))', 4)
    expect(v4bare[0].refused).toBeUndefined()
    expect(outputsOf('t = tickerid(syminfo.prefix, syminfo.ticker, session.regular, adjustment.splits)\n'
      + 'plot(security(t, "D", close))', 4)).toEqual(v4bare)
  })
  it('another symbol, and another period', () => {
    const aapl = outputsOf(req('"NASDAQ:AAPL"'))
    expect(aapl[0].refused).toBeUndefined()
    expect(outputsOf(req('ticker.new("NASDAQ", "AAPL", session.regular, adjustment.splits)'))).toEqual(aapl)
    expect(outputsOf(req(`${OWN}, adjustment.splits)`, '"W"'))).toEqual(outputsOf(req('syminfo.tickerid', '"W"')))
  })
  it('⛔ DECIDED, NOT MISSED: backadjustment / settlement_as_close are futures-only and not read on a stock', () => {
    // On a US stock TradingView applies neither, so the request is the bare one; and a futures symbol, where
    // they would matter, is refused as a foreign venue before they could.
    expect(outputsOf(req(`${OWN}, adjustment.splits, backadjustment.on, settlement_as_close.on)`))).toEqual(bare)
    const [fut] = outputsOf(req('"CME_MINI:ES1!"'))
    expect(fut.refused).toBe('pine:request')
  })
})

describe('e97 U4 — any other adjustment is refused, naming the argument and why', () => {
  const refusedWith = (body) => {
    const [o] = outputsOf(body)
    expect(o.refused, body).toBe('pine:request')
    return o.message
  }
  it('adjustment.dividends: splits AND dividends, a different number before each ex-dividend date', () => {
    for (const sym of [`${OWN}, adjustment.dividends)`, `${OWN}, adjustment = adjustment.dividends)`]) {
      expect(refusedWith(req(sym))).toContain(
        'the `adjustment` argument of `ticker.new`: `adjustment.dividends` asks for prices adjusted for dividends as well as splits')
    }
    expect(refusedWith(req('ticker.modify(syminfo.tickerid, adjustment = adjustment.dividends)'))).toContain(
      'the `adjustment` argument of `ticker.modify`: `adjustment.dividends`')
    expect(refusedWith(`adj = adjustment.dividends\nt = ${OWN}, adjustment = adj)\n${req('t')}`)).toContain(
      '`adjustment.dividends` asks for prices adjusted for dividends')
  })
  it('adjustment.none: prices as traded, a different number before each split', () => {
    expect(refusedWith(req(`${OWN}, adjustment.none)`))).toContain(
      'the `adjustment` argument of `ticker.new`: `adjustment.none` asks for prices as traded, with no split adjustment')
  })
  it('a spelling this door cannot read is refused, never guessed', () => {
    expect(refusedWith(`adj = close > open ? adjustment.splits : adjustment.dividends\n${req(`${OWN}, adjustment = adj)`)}`))
      .toContain('`adj` is not an adjustment this door can read')
  })
  it('the refusal holds for another symbol and another period too', () => {
    expect(refusedWith(req('ticker.new("NASDAQ", "AAPL", session.regular, adjustment.dividends)'))).toContain('`adjustment.dividends`')
    expect(refusedWith(req(`${OWN}, adjustment.dividends)`, '"W"'))).toContain('`adjustment.dividends`')
  })
})
