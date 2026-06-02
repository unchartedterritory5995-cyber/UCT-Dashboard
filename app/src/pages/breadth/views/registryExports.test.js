import { describe, it, expect } from 'vitest'
import { HM_METRICS, PCTILE_KEYS, FFILL_KEYS } from '../../Breadth'

describe('Breadth registry exports', () => {
  it('exports the metric registry with pair + polarity metadata attached', () => {
    const byKey = Object.fromEntries(HM_METRICS.filter(m => !m.isHeader).map(m => [m.key, m]))
    expect(byKey.up_4pct_today.pair).toEqual({ partnerKey: 'down_4pct_today', side: 'up' })
    expect(byKey.down_4pct_today.pair).toEqual({ partnerKey: 'up_4pct_today', side: 'down' })
    expect(byKey.vix.polarity).toBe('bear')
    expect(byKey.pct_above_50sma.polarity).toBe('bull')
  })
  it('exports the percentile + forward-fill key sets', () => {
    expect(PCTILE_KEYS.has('vix')).toBe(true)
    expect(Array.isArray(FFILL_KEYS)).toBe(true)
  })
})
