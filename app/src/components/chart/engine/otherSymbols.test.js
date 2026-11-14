// ─── ⭐⭐ C26 — WHICH OTHER SYMBOLS A PINE DOCUMENT MAY READ ────────────────────
//
// Rails for `otherSymbols.js` (the bind's one decision), the spelling the
// translator records beside each `sym` node (`pine.js::otherSymbolOf`, surfaced as
// `translatePine(...).otherSymbols`), and the fetch list the chart derives from it
// (`sourceRef.symbolsNeeded`). Every rule has a case that SERVES and a case that
// REFUSES, so none of them can pass by answering one way for everything.

import { describe, it, expect } from 'vitest'
import { translatePine } from './ast/pine'
import {
  resolveOtherSymbols, otherSymbolRequestsOf, fetchableOtherSymbols, symTickersOf,
  OTHER_SYMBOL_REFUSAL as R, CHART_PREFIX_VENUE,
} from './otherSymbols'
import { symbolsNeeded } from './sourceRef'

const pine = (lines) => ['//@version=5', 'indicator("c26")', ...lines].join('\n')

/** A member-door-shaped document over one translation: its trees plus the
 *  spelling table `memberPaneDefinition` stamps (`meta.otherSymbols`). */
function docOf(src) {
  const t = translatePine(src, { strict: true })
  const trees = {}
  ;(t.outputs || []).forEach((o, i) => { if (o && o.ast) trees[`p${i}`] = o.ast })
  return {
    t,
    def: {
      id: 'u_c26', compute: { kind: 'ast', trees },
      meta: { recurrenceOrigin: 'pine', ...(t.otherSymbols ? { otherSymbols: t.otherSymbols } : {}) },
    },
  }
}

const BARS = [{ t: '2026-01-02', c: 1 }, { t: '2026-01-05', c: 2 }]
const STORE = { SPY: 'NYSE Arca', AAPL: 'NASDAQ', IMO: 'NYSE American', LVMUY: 'OTC', XYZ: 'Frankfurt' }
const ctxOf = (over = {}) => ({
  symbol: { ticker: 'RDDT', exchange: 'NYSE' },
  exchangeOf: (t) => STORE[t] || null,
  secondary: new Map(Object.keys(STORE).map((t) => [t, { bars: BARS, status: 'available' }])),
  ...over,
})
const decide = (src, over) => resolveOtherSymbols(docOf(src).def, ctxOf(over))
const codes = (r) => r.refused.map((x) => `${x.ticker}:${x.code}`)

describe('the translator records how each other symbol was SPELLED', () => {
  it('a prefixed string, a bare one, ticker.new with a literal and with syminfo.prefix', () => {
    const { t } = docOf(pine([
      'a = request.security("AMEX:SPY", timeframe.period, close)',
      'b = request.security("AAPL", timeframe.period, close)',
      'c = request.security(ticker.new("NASDAQ", "QQQ"), timeframe.period, close)',
      'd = request.security(ticker.new(syminfo.prefix, "IWM"), timeframe.period, close)',
      'plot(a)', 'plot(b)', 'plot(c)', 'plot(d)',
    ]))
    expect(t.otherSymbols).toEqual([
      { ticker: 'AAPL', spellings: [''] },
      { ticker: 'IWM', spellings: [CHART_PREFIX_VENUE] },
      { ticker: 'QQQ', spellings: ['NASDAQ'] },
      { ticker: 'SPY', spellings: ['AMEX'] },
    ])
  })

  it('an input.symbol default is recorded with its own spelling', () => {
    const { t } = docOf(pine(['s = input.symbol("NASDAQ:AAPL", "S")', 'plot(request.security(s, timeframe.period, close))']))
    expect(t.otherSymbols).toEqual([{ ticker: 'AAPL', spellings: ['NASDAQ'] }])
  })

  it('a script that reads no other symbol carries no table at all (every other result unchanged)', () => {
    const { t } = docOf(pine(['plot(request.security(syminfo.tickerid, "W", close))']))
    expect(t).not.toHaveProperty('otherSymbols')
  })

  it('every ticker a tree reads is a requested ticker (the table and the trees agree)', () => {
    const { def } = docOf(pine(['plot(request.security("AMEX:SPY", timeframe.period, close) / close)']))
    expect(symTickersOf(def)).toEqual(['SPY'])
    expect(otherSymbolRequestsOf(def)).toEqual([{ ticker: 'SPY', spellings: ['AMEX'] }])
  })
})

describe('the bind serves a read only when the spelling is witnessed AND is our listing', () => {
  it('SERVED: the witnessed spelling of our listing, prefix string or ticker.new', () => {
    const r = decide(pine([
      'plot(request.security("AMEX:SPY", timeframe.period, close))',
      'plot(request.security(ticker.new("NASDAQ", "AAPL"), timeframe.period, close))',
      'plot(request.security("AMEX:IMO", timeframe.period, close))',
      'plot(request.security("OTC:LVMUY", timeframe.period, close))',
    ]))
    expect(r.refused).toEqual([])
    expect(r.served).toEqual(['AAPL', 'IMO', 'LVMUY', 'SPY'])
    expect(r.symbols.SPY).toBe(BARS)
  })

  // ⚰️ C29 (measured, `vw-other-symbol-rddt-1d-2026-09-30`: bare "SPY" == "AMEX:SPY"
  // on all 634 bars): a bare ticker our store holds on a witnessed exchange is SERVED.
  it('C29 — SERVED bare: an unprefixed ticker is the listing its witnessed spelling reads', () => {
    const r = decide(pine(['plot(request.security("SPY", timeframe.period, close))']))
    expect(codes(r)).toEqual([])
    expect(r.served).toEqual(['SPY'])
  })

  // ⭐⭐ ENGINE 55 — FLIPPED DELIBERATELY: a bare spelling no binding can serve (`XAUUSD`, not
  // shaped like a US listing) is refused AT TRANSLATE now (`staticallyUnservable`), so no
  // `sym` node is written; a document saved before engine 55 still carries one and the bind
  // refuses it with the same code, from the same helper.
  it('REFUSED bare: a bare spelling no binding can serve — at translate, and at the bind for an older document', () => {
    const t = translatePine(pine(['plot(request.security("XAUUSD", timeframe.period, close))']), { strict: true })
    const refusal = t.refusal || ((t.outputs || []).find((o) => o && o.refusal) || {}).refusal
    expect(refusal && refusal.guard).toBe('pine:request')
    expect(refusal.message).toContain(`${R.BARE} — `)
    expect(t.otherSymbols || []).toEqual([])
    const older = { id: 'u_c26', compute: { kind: 'ast', trees: { p0: { type: 'sym', value: 'XAUUSD', args: [{ type: 'series', name: 'close' }] } } },
      meta: { recurrenceOrigin: 'pine', otherSymbols: [{ ticker: 'XAUUSD', spellings: [''] }] } }
    const r = resolveOtherSymbols(older, ctxOf())
    expect(codes(r)).toEqual([`XAUUSD:${R.BARE}`])
    expect(r.symbols).toEqual({})
  })
  it('SERVED bare (C29 control): a bare US-shaped ticker the store holds on a witnessed exchange', () => {
    const r = decide(pine(['plot(request.security("SPY", timeframe.period, close))']))
    expect(r.served).toEqual(['SPY'])
    expect(codes(r)).toEqual([])
  })

  it('REFUSED venue mismatch: a witnessed spelling that is not our listing', () => {
    const r = decide(pine(['plot(request.security("NASDAQ:SPY", timeframe.period, close))']))
    expect(codes(r)).toEqual([`SPY:${R.VENUE_MISMATCH}`])
  })

  it('REFUSED unconfirmed venue: a spelling TradingView was never measured answering', () => {
    for (const v of ['NYSEARCA', 'ARCA', 'BATS', 'IEX']) {
      const r = decide(pine([`plot(request.security("${v}:SPY", timeframe.period, close))`]))
      expect(codes(r), v).toEqual([`SPY:${R.VENUE_UNCONFIRMED}`])
    }
  })

  it('syminfo.prefix: served when the chart\'s exchange IS the listing\'s, refused otherwise', () => {
    const src = pine(['plot(request.security(ticker.new(syminfo.prefix, "AAPL"), timeframe.period, close))'])
    expect(decide(src, { symbol: { ticker: 'MSFT', exchange: 'NASDAQ' } }).served).toEqual(['AAPL'])
    expect(codes(decide(src))).toEqual([`AAPL:${R.VENUE_MISMATCH}`])
    expect(codes(decide(src, { symbol: { ticker: 'X', exchange: 'Frankfurt' } }))).toEqual([`AAPL:${R.CHART_PREFIX}`])
  })

  it('REFUSED: a listing our store does not hold, one on an unwitnessed exchange, and one with no bars', () => {
    expect(codes(decide(pine(['plot(request.security("NASDAQ:ZZZZ", timeframe.period, close))']))))
      .toEqual([`ZZZZ:${R.NOT_HELD}`])
    expect(codes(decide(pine(['plot(request.security("NYSE:XYZ", timeframe.period, close))']))))
      .toEqual([`XYZ:${R.EXCHANGE_UNCONFIRMED}`])
    const noBars = decide(pine(['plot(request.security("AMEX:SPY", timeframe.period, close))']),
      { secondary: new Map([['SPY', { bars: [], status: 'loading' }]]) })
    expect(codes(noBars)).toEqual([`SPY:${R.NO_BARS}`])
  })

  // ⚰️ C29: bare and `AMEX:` now name ONE listing, so one ticker spelled both ways
  // is served; spelled with two DIFFERENT venues it still refuses whole.
  it('one ticker spelled bare and with its witnessed venue is one listing; two venues refuse', () => {
    const r = decide(pine([
      'plot(request.security("AMEX:SPY", timeframe.period, close))',
      'plot(request.security("SPY", timeframe.period, high))',
    ]))
    expect(r.served).toEqual(['SPY'])
    const two = decide(pine([
      'plot(request.security("AMEX:SPY", timeframe.period, close))',
      'plot(request.security("NASDAQ:SPY", timeframe.period, high))',
    ]))
    expect(codes(two)).toEqual([`SPY:${R.VENUE_MISMATCH}`])
  })

  it('REFUSED: a class share, a framed instance, and a document saved without the spelling table', () => {
    // ⚰️ C29: `BRK.B` is our store's `BRK-B` (measured) — refused here only because
    // this context's store does not hold it; the hyphen spelling is the class refusal.
    const cls = decide(pine(['plot(request.security("NYSE:BRK.B", timeframe.period, close))']))
    expect(codes(cls)).toEqual([`BRK.B:${R.NOT_HELD}`])
    // ⭐ ENGINE 55 — the hyphen spelling names no listing in any binding: refused at
    // translate (`pine:request`, `other-symbol:class-share`); an older document's bind says the same.
    const hyT = translatePine(pine(['plot(request.security("NYSE:BRK-B", timeframe.period, close))']), { strict: true })
    const hyRefusal = hyT.refusal || ((hyT.outputs || []).find((o) => o && o.refusal) || {}).refusal
    expect(hyRefusal && hyRefusal.message).toContain(`${R.CLASS_SHARE} — `)
    const hy = resolveOtherSymbols({ id: 'u_c26', compute: { kind: 'ast', trees: { p0: { type: 'sym', value: 'BRK-B', args: [{ type: 'series', name: 'close' }] } } },
      meta: { recurrenceOrigin: 'pine', otherSymbols: [{ ticker: 'BRK-B', spellings: ['NYSE'] }] } }, ctxOf())
    expect(codes(hy)).toEqual([`BRK-B:${R.CLASS_SHARE}`])
    const framed = decide(pine(['plot(request.security("AMEX:SPY", timeframe.period, close))']), { framed: true })
    expect(codes(framed)).toEqual([`SPY:${R.FRAMED}`])
    const { def } = docOf(pine(['plot(request.security("AMEX:SPY", timeframe.period, close))']))
    delete def.meta.otherSymbols
    expect(codes(resolveOtherSymbols(def, ctxOf()))).toEqual([`SPY:${R.UNSPELLED}`])
  })
})

describe('the chart fetches only what the bind could serve', () => {
  it('fetchableOtherSymbols: witnessed spellings, the chart prefix and (C29) a bare US-shaped ticker; never unconfirmed', () => {
    const { def } = docOf(pine([
      'plot(request.security("AMEX:SPY", timeframe.period, close))',
      'plot(request.security("EURUSD", timeframe.period, close))',
      'plot(request.security("NYSEARCA:QQQ", timeframe.period, close))',
      'plot(request.security(ticker.new(syminfo.prefix, "IWM"), timeframe.period, close))',
    ]))
    expect(fetchableOtherSymbols(def)).toEqual(['IWM', 'SPY'])
    // ⭐ and the chart's secondary-bars list is exactly that, beside its own sources
    expect(symbolsNeeded([{ defId: 'u_c26', inputs: {} }], () => def)).toEqual(['IWM', 'SPY'])
  })

  it('a document with no spelling table asks for nothing', () => {
    expect(fetchableOtherSymbols({ meta: {} })).toEqual([])
    expect(fetchableOtherSymbols(null)).toEqual([])
  })
})
