import { describe, it, expect } from 'vitest'
import { quickReplies } from './quickReplies'

const chart = (symbol, tf = 'D', chartType = 'candles') => ({ symbol, tf, cs: { chartType } })

describe('welcome quick replies fit the board on screen', () => {
  it('one chart: a two-change tap the chart is not already in, and its own symbol', () => {
    expect(quickReplies([chart('SPY')])).toEqual(['Switch this chart to weekly bars', 'Why is SPY moving today?', 'Build an indicator that flags volume spikes'])
    expect(quickReplies([chart('AAPL', 'W', 'bars')])[0]).toBe('Switch this chart to daily candles')
  })
  it('several charts: never an ambiguous "this chart" — add a symbol not already on the board', () => {
    const r = quickReplies([chart('QQQ'), chart('SPY')])
    expect(r[0]).toBe('Add a chart for IWM')
    expect(r[1]).toBe('Why is QQQ moving today?')
  })
  it('no charts yet: still three sensible replies', () => {
    expect(quickReplies([])).toEqual(['Add a chart for QQQ', 'Why is SPY moving today?', 'Build an indicator that flags volume spikes'])
  })
})
