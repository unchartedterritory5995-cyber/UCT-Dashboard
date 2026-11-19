import { describe, it, expect } from 'vitest'
import { COLS, widthGroupOf } from '../Breadth'

// Equal widths per visual group (owner 2026-11-19, round 11): one map, by metric key.
describe('width groups', () => {
  const keys = new Set(COLS.map(c => c.key))
  it('the default view groups as the owner asked', () => {
    const g = (...ks) => new Set(ks.map(widthGroupOf))
    expect(g('breadth_score', 'uct_exposure', 'up_4pct_today', 'down_4pct_today').size).toBe(1)
    expect(g('ratio_5day', 'ratio_10day').size).toBe(1)
    expect(g('up_25pct_quarter', 'down_25pct_quarter', 'magna_up', 'magna_down').size).toBe(1)
    expect(g('pct_above_20sma', 'pct_above_50sma', 'pct_above_200sma').size).toBe(1)
    expect(g('vix', 'cnn_fear_greed').size).toBe(1)
    // Universe and the dot columns keep their own widths
    expect(widthGroupOf('universe_count')).toBeNull()
    expect(widthGroupOf('spy_ma_stack')).toBeNull()
  })
  it('hidden families group within themselves', () => {
    expect(widthGroupOf('up_20pct_5d')).toBe(widthGroupOf('down_20pct_5d'))
    expect(widthGroupOf('up_50pct_month')).toBe(widthGroupOf('down_25pct_month'))
    expect(widthGroupOf('pct_above_150sma')).toBe(widthGroupOf('pct_above_20sma'))
    expect(widthGroupOf('new_52w_highs')).toBe(widthGroupOf('new_20d_lows'))
    expect(widthGroupOf('aaii_bulls')).toBe(widthGroupOf('aaii_spread'))
  })
  it('every grouped key is a real metric', () => {
    for (const c of COLS) if (widthGroupOf(c.key)) expect(keys.has(c.key)).toBe(true)
  })
})
