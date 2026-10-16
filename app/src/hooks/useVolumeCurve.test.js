// One request per symbol SET: the key is sorted + de-duplicated, so a chart re-render or a
// watchlist reorder is the same request, and a list is ONE batch request, never N.
import { describe, expect, it } from 'vitest'
import { volumeCurveKey } from './useVolumeCurve'

describe('volumeCurveKey', () => {
  it('is the bare market-curve URL with no symbols', () => {
    expect(volumeCurveKey()).toBe('/api/screener/volume-curve')
    expect(volumeCurveKey([])).toBe('/api/screener/volume-curve')
    expect(volumeCurveKey(['', null])).toBe('/api/screener/volume-curve')
  })
  it('asks for a whole list in ONE batch, order- and case-insensitive', () => {
    const k = volumeCurveKey(['nvda', 'AAPL', 'NVDA'])
    expect(k).toBe(`/api/screener/volume-curve?tickers=${encodeURIComponent('AAPL,NVDA')}`)
    expect(volumeCurveKey(['AAPL', 'nvda'])).toBe(k)
  })
})
