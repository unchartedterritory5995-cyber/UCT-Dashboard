// app/src/components/chart/engine/ast/pine.tickerStandard.test.js
//
// ─── ⭐⭐ e97 U2 — `ticker.standard(<symbol>)` IS THAT SYMBOL, SO A SAME-TIMEFRAME REQUEST OF IT IS THE IDENTITY ───
//
// ⚰️ TradingView's own `ticker.standard` example, on a daily chart, refused
// `request.security(ticker.standard(syminfo.tickerid), "1D", close)` while serving the line above it,
// `request.security(syminfo.tickerid, "1D", close)`, as the chart's own series (`requestTargetOf`: a code
// equal to the chart's period folds to the identity). The timeframe was never the problem: `ticker.standard`
// was not read as a symbol at all. Pine's reference: it "creates a ticker to request data from a standard
// chart that is unaffected by modifiers like extended session, dividend adjustment, currency conversion, and
// the calculations of non-standard chart types"; `symbol` defaults to `syminfo.tickerid`. Every bar this
// engine reads is the standard chart's, so the call names the series its symbol names.
//
// ⭐ READ THROUGH ONE FUNCTION (`unmodifiedTickerArg`), so the chart's own symbol, another symbol and the
// spelling reader agree. Each served shape is compared with the SAME request written with the bare symbol,
// so the identity's own semantics (the daily gate, look-ahead, gaps) are the bare request's, not restated.
// ⛔ CONTROLS: an extended session (written through `ticker.new` / `ticker.modify`, standard-wrapped or not)
// still refuses, a non-standard chart type still refuses, a read below the chart keeps its refusal, and on
// an intraday chart "1D" is not the chart's own period.

import { describe, it, expect } from 'vitest'

import { translatePine } from './pine.js'

const src = (body) => `//@version=6\nindicator("t")\n${body}\n`

/** Each output's tree, or `{refused, message}` (the member door's translation: `strict`). */
function outputsOf(body, basePeriod = 'D') {
  const t = translatePine(src(body), { basePeriod, strict: true })
  return t.outputs.map((o) => (o.refusal ? { refused: o.refusal.guard, message: o.refusal.message } : o.ast))
}

/** The same request written with the bare chart symbol. */
const bare = (tf, rest = '', basePeriod = 'D') =>
  outputsOf(`plot(request.security(syminfo.tickerid, ${tf}, close${rest}))`, basePeriod)[0]

describe('e97 U2 — ticker.standard folds to its symbol', () => {
  it('⭐ the reference example on a daily chart: both lines are the chart\'s own series', () => {
    const outs = outputsOf(
      'chartTypeValue = request.security(syminfo.tickerid, "1D", close)\n'
      + 'standardChartValue = request.security(ticker.standard(syminfo.tickerid), "1D", close)\n'
      + 'plot(chartTypeValue)\nplot(standardChartValue)')
    expect(outs[0].refused).toBeUndefined()
    expect(outs).toEqual([bare('"1D"'), bare('"1D"')])
  })

  it('⭐ at timeframe.period, with no argument, named `symbol =`, and through a binding: the identity', () => {
    const own = bare('timeframe.period')
    expect(own.refused).toBeUndefined()
    expect(outputsOf('plot(request.security(ticker.standard(syminfo.tickerid), timeframe.period, close))')).toEqual([own])
    expect(outputsOf('plot(request.security(ticker.standard(), timeframe.period, close))')).toEqual([own])
    expect(outputsOf('plot(request.security(ticker.standard(symbol = syminfo.tickerid), "D", close))')).toEqual([bare('"D"')])
    expect(outputsOf('t = ticker.standard(syminfo.tickerid)\nplot(request.security(t, "1D", close))')).toEqual([bare('"1D"')])
  })

  it('⭐ look-ahead and gaps at the chart\'s own period read exactly as the bare request reads them', () => {
    for (const rest of [', lookahead = barmerge.lookahead_on', ', gaps = barmerge.gaps_off', ', gaps = barmerge.gaps_on']) {
      const want = bare('"D"', rest)
      expect(outputsOf(`plot(request.security(ticker.standard(syminfo.tickerid), "D", close${rest}))`), rest).toEqual([want])
    }
  })

  it('⭐ the same rule as the bare symbol at another period, and for another symbol', () => {
    expect(outputsOf('plot(request.security(ticker.standard(syminfo.tickerid), "W", close))')).toEqual([bare('"W"')])
    const spy = outputsOf('plot(request.security("AMEX:SPY", "D", close))')
    expect(spy[0].refused).toBeUndefined()
    expect(outputsOf('plot(request.security(ticker.standard("AMEX:SPY"), "D", close))')).toEqual(spy)
  })

  it('⛔ CONTROL: an extended session stays refused, standard-wrapped or not', () => {
    const [a] = outputsOf('plot(request.security(ticker.modify(syminfo.tickerid, session.extended), "D", close))')
    expect(a.refused).toBe('pine:request')
    const [b] = outputsOf('t = ticker.new(syminfo.prefix, syminfo.ticker, session.extended)\n'
      + 'plot(request.security(ticker.standard(t), "D", close))')
    expect(b.refused).toBe('pine:request')
  })

  it('⛔ CONTROL: a non-standard chart type stays refused, and so does a second argument', () => {
    const [a] = outputsOf('plot(request.security(ticker.heikinashi(syminfo.tickerid), "D", close))')
    expect(a.refused).toBe('pine:request')
    const [b] = outputsOf('plot(request.security(ticker.standard(syminfo.tickerid, "x"), "D", close))')
    expect(b.refused).toBeTruthy()
  })

  it('⛔ CONTROL: below the chart it keeps a refusal (a `ticker.*` builder names a session there)', () => {
    const [a] = outputsOf('plot(request.security(ticker.standard(syminfo.tickerid), "60", close))')
    expect(a.refused).toBe('pine:request')
  })

  it('⛔ CONTROL: on a 5-minute chart "1D" is above the chart, not its own period: what the bare request gets', () => {
    const [a] = outputsOf('plot(request.security(ticker.standard(syminfo.tickerid), "1D", close))', '5')
    expect(a).not.toEqual(bare('timeframe.period', '', '5'))
    expect(a.refused).toBe(bare('"1D"', '', '5').refused)
  })
})
