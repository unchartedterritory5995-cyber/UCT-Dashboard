import { it } from 'vitest'
import { translatePine } from './ast/pine'
it('si2', () => {
  for (const src of [
    ['//@version=5', 'indicator("x")', "t = input('SP:SPX', title='X')", 'plot(request.security(t, timeframe.period, close))'].join('\n'),
    ['//@version=5', 'indicator("x")', "t = input.symbol('AMEX:SPY', title='X')", 'plot(request.security(t, timeframe.period, close))'].join('\n'),
  ]) {
    const t = translatePine(src)
    console.log('SI2 ' + JSON.stringify({ si: t.symbolInputs, other: t.otherSymbols, ok: !t.refusal }))
  }
})
